import os
import zipfile
import time  # Import time module
import json
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
import requests
import yt_dlp
import zipstream
from flask import Flask, request, jsonify, Response, stream_with_context

# Optional heavy imports for key detection (loaded lazily in the endpoint)
import sqlite3

from lib.db import (
    get_db,
    init_db as init_db_lib,
    close_db as close_db_lib,
    MP3_DIR,
    DB_PATH,
)
from lib.utils import sanitize_filename
from lib.analysis import perform_full_analysis
from lib.youtube import (
    get_video_info,
    download_audio as download_audio_lib,
)

app = Flask(__name__)


class NumpyEncoder(json.JSONEncoder):
    """Special json encoder for numpy types"""

    def default(self, obj):
        if isinstance(obj, np.integer):
            return int(obj)
        elif isinstance(obj, np.floating):
            return float(obj)
        elif isinstance(obj, np.ndarray):
            return obj.tolist()
        return json.JSONEncoder.default(self, obj)


app.json_encoder = NumpyEncoder


app.teardown_appcontext(close_db_lib)
init_db_lib()


# Define the route for downloading audio
@app.route("/download", methods=["GET"])
def download_audio():
    t_start = time.time()  # Start timer for whole request
    video_id = request.args.get("videoId")

    if not video_id:
        return jsonify({"error": "Missing videoId parameter"}), 400

    video_url = f"https://www.youtube.com/watch?v={video_id}"
    print(f"[Flask] Received request for videoId: {video_id}")

    try:
        (
            download_url,
            file_ext,
            content_type,
            content_length_est,
            headers,
        ) = get_video_info(video_url)

        if not download_url:
            print("[Flask] Could not find a suitable audio format URL.")
            return (
                jsonify({"error": "Could not find a suitable audio format URL."}),
                500,
            )

        print(
            f"[Flask] Found format URL for {file_ext}, estimated size: {content_length_est}"
        )

        req = requests.get(
            download_url,
            stream=True,
            headers=headers,
            allow_redirects=True,
            timeout=120,
        )
        if req.status_code >= 400:
            print(
                f"[Flask] First attempt failed: {req.status_code} {req.reason}. Retrying without Range header..."
            )
            headers.pop("Range", None)
            req = requests.get(
                download_url,
                stream=True,
                headers=headers,
                allow_redirects=True,
                timeout=120,
            )
        req.raise_for_status()

        final_content_length = req.headers.get("Content-Length") or content_length_est
        print(
            f"[Flask] Streaming {final_content_length} bytes... (status={req.status_code})"
        )

        t_before_stream = time.time()

        def generate():
            bytes_yielded = 0
            for chunk in req.iter_content(chunk_size=1024 * 1024):
                bytes_yielded += len(chunk)
                yield chunk
            t_after_stream = time.time()
            print(f"[Flask] Streaming finished. Total bytes: {bytes_yielded}")
            print(
                f"[Flask] Time for streaming loop: {t_after_stream - t_before_stream:.2f}s"
            )
            t_end = time.time()
            print(f"[Flask] Total request time: {t_end - t_start:.2f}s")

        response = Response(stream_with_context(generate()), mimetype=content_type)
        response.headers["Content-Disposition"] = (
            f'attachment; filename="audio.{file_ext}"'
        )
        if final_content_length and str(final_content_length) != "0":
            response.headers["Content-Length"] = final_content_length
        if req.headers.get("Accept-Ranges"):
            response.headers["Accept-Ranges"] = req.headers.get("Accept-Ranges")
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"

        return response

    except yt_dlp.utils.DownloadError as e:
        print(f"[Flask] yt-dlp download error: {e}")
        error_message = str(e)
        status_code = 500
        public_error_message = "yt-dlp download error"
        if "video is unavailable" in error_message.lower():
            status_code = 404
            public_error_message = "Video unavailable."
        elif "private video" in error_message.lower():
            status_code = 403
            public_error_message = "Video is private."
        elif "age restricted" in error_message.lower():
            status_code = 403
            public_error_message = "Video is age-restricted and requires login."
        elif "429" in error_message or "too many requests" in error_message.lower():
            status_code = 429
            public_error_message = "Rate limited by YouTube. Please try again later."
        return jsonify({"error": public_error_message}), status_code

    except requests.exceptions.RequestException as e:
        print(f"[Flask] Request error fetching audio stream: {e}")
        return jsonify({"error": f"Failed to fetch audio stream from source: {e}"}), 502

    except Exception as e:
        print(f"[Flask] Generic error: {e}")
        return jsonify({"error": f"An unexpected error occurred: {e}"}), 500


# Route for a simple health check or root
@app.route("/")
def root():
    return jsonify({"status": "Flask backend is running"})


# --------------------
# Playlist persistence endpoints
# --------------------


@app.route("/playlists", methods=["GET"])
def list_playlists():
    db = get_db()
    rows = db.execute(
        "SELECT id, url, title, channel, thumbnail, video_count, created_at, updated_at FROM playlists ORDER BY created_at DESC"
    ).fetchall()
    return jsonify({"playlists": [dict(r) for r in rows]})


@app.route("/playlists", methods=["POST"])
def upsert_playlist():
    data = request.get_json(silent=True) or {}
    playlist_id = (data.get("id") or "").strip()
    url = (data.get("url") or "").strip()
    title = (data.get("title") or "").strip()
    channel = (data.get("channel") or "").strip()
    videos = data.get("videos") or []

    if not playlist_id or not url:
        return jsonify({"error": "id and url are required"}), 400

    db = get_db()
    db.execute(
        """
        INSERT INTO playlists(id, url, title, channel, video_count, created_at, updated_at)
        VALUES(?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          url=excluded.url,
          title=excluded.title,
          channel=excluded.channel,
          video_count=excluded.video_count,
          updated_at=datetime('now')
        """,
        (playlist_id, url, title, channel, len(videos)),
    )
    # Update thumbnail separately to avoid altering existing schema ordering
    thumb = (data.get("thumbnail") or "").strip()
    if thumb:
        db.execute(
            "UPDATE playlists SET thumbnail=?, updated_at=datetime('now') WHERE id=?",
            (thumb, playlist_id),
        )

    for idx, v in enumerate(videos):
        vid = (v.get("id") or "").strip()
        if not vid:
            continue
        vtitle = (v.get("title") or "").strip()
        vcreator = (v.get("creator") or "").strip()
        vviews = int(v.get("views") or 0)
        vthumb = (v.get("thumbnail") or "").strip()
        vmp3 = v.get("mp3_path") or None

        # Handle analysis data - prefer `analysis` object, fallback to `key`
        analysis_str = None
        analysis_obj = v.get("analysis")
        if isinstance(analysis_obj, dict):
            analysis_str = json.dumps(analysis_obj)
        else:
            vkey = v.get("key")
            if vkey:
                analysis_str = json.dumps({"key": vkey})

        db.execute(
            """
            INSERT INTO videos(video_id, playlist_id, position, title, creator, views, thumbnail, mp3_path, analysis, last_updated)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(video_id) DO UPDATE SET
              playlist_id=excluded.playlist_id,
              position=excluded.position,
              title=excluded.title,
              creator=excluded.creator,
              views=excluded.views,
              thumbnail=excluded.thumbnail,
              mp3_path=COALESCE(excluded.mp3_path, videos.mp3_path),
              analysis=COALESCE(excluded.analysis, videos.analysis),
              last_updated=datetime('now')
            """,
            (
                vid,
                playlist_id,
                idx,
                vtitle,
                vcreator,
                vviews,
                vthumb,
                vmp3,
                analysis_str,
            ),
        )

    db.commit()
    return jsonify({"ok": True})


@app.route("/playlists/<playlist_id>", methods=["GET"])
def get_playlist_with_videos(playlist_id: str):
    db = get_db()
    pl = db.execute(
        "SELECT id, url, title, channel, thumbnail, video_count, created_at, updated_at FROM playlists WHERE id=?",
        (playlist_id,),
    ).fetchone()
    if not pl:
        return jsonify({"error": "not found"}), 404
    items = db.execute(
        """
        SELECT video_id as id, title, creator, views, thumbnail, analysis, mp3_path, position
        FROM videos
        WHERE playlist_id = ?
        ORDER BY position ASC
        """,
        (playlist_id,),
    ).fetchall()

    videos_list = []
    for r in items:
        video_dict = dict(r)
        analysis_str = video_dict.get("analysis")
        if analysis_str:
            try:
                video_dict["analysis"] = json.loads(analysis_str)
            except json.JSONDecodeError:
                video_dict["analysis"] = None  # or {}
        else:
            video_dict["analysis"] = None
        videos_list.append(video_dict)

    return jsonify(
        {
            "playlist": dict(pl),
            "videos": videos_list,
        }
    )


@app.route("/analyze", methods=["POST"])
def analyze():
    """
    Analyze videos.
    Body: {"ids": ["vid1", ...], "maxWorkers": optional}
    - run full analysis (bpm, key, cue points) on existing MP3s
    Returns {"results": {"vid": { ... } }}
    """
    try:
        data = request.get_json(silent=True) or {}
        ids = data.get("ids") or data.get("id") or data.get("videoId") or []
        if isinstance(ids, str):
            ids = [ids]
        if not isinstance(ids, list) or not all(isinstance(v, str) for v in ids):
            return (
                jsonify({"error": "ids must be a list of strings or a single id"}),
                400,
            )

        print(f"[Analyze] Received request for {len(ids)} video(s): {ids}")

        max_workers_req = int(data.get("maxWorkers") or 0)
        max_workers_env = int(os.environ.get("YTMP3_MAX_WORKERS", "4"))
        max_workers = max(1, min(8, max_workers_req or max_workers_env, len(ids) or 1))
        print(f"[Analyze] Using {max_workers} worker(s)")

        results: dict[str, dict] = {}
        if not ids:
            return jsonify({"results": results})

        def analyze_one(vid: str):
            t_start_one = time.time()
            try:
                with app.app_context():
                    print(f"[Analyze] Starting analysis for video_id: {vid}")
                    db = get_db()
                    row = db.execute(
                        "SELECT mp3_path FROM videos WHERE video_id = ?", (vid,)
                    ).fetchone()
                    if (
                        not row
                        or not row["mp3_path"]
                        or not os.path.exists(row["mp3_path"])
                    ):
                        mp3_path_val = row["mp3_path"] if row else "N/A"
                        exists_val = (
                            os.path.exists(row["mp3_path"])
                            if row and row["mp3_path"]
                            else "N/A"
                        )
                        print(
                            f"[Analyze] MP3 not found for {vid}. Path: {mp3_path_val}, Exists: {exists_val}"
                        )
                        return vid, {"error": "mp3_not_found"}

                    mp3_path = row["mp3_path"]
                    print(
                        f"[Analyze] Found MP3 for {vid} at {mp3_path}. Starting full analysis..."
                    )
                    analysis = perform_full_analysis(row["mp3_path"])
                    if analysis:
                        print(
                            f"[Analyze] Analysis complete for {vid}. Result: {analysis.get('key', 'N/A')}, {analysis.get('bpm', 'N/A')} BPM"
                        )
                    else:
                        print(f"[Analyze] Analysis returned no data for {vid}")

                    # Persist full analysis
                    try:
                        analysis_json = (
                            json.dumps(analysis, cls=NumpyEncoder) if analysis else None
                        )
                        db.execute(
                            """
                            UPDATE videos
                            SET analysis = ?, last_updated=datetime('now')
                            WHERE video_id=?
                            """,
                            (analysis_json, vid),
                        )
                        db.commit()
                        print(f"[Analyze] Successfully persisted analysis for {vid}")
                    except Exception as e:
                        print(f"[DB] failed to persist analysis for {vid}: {e}")
                    t_end_one = time.time()
                    print(
                        f"[Analyze] Finished analysis for {vid} in {t_end_one - t_start_one:.2f}s"
                    )
                    return vid, (analysis or {})
            except Exception as e:
                t_end_one = time.time()
                print(
                    f"[Analyze] FAILED analysis for {vid} in {t_end_one - t_start_one:.2f}s. Error: {e}"
                )
                return vid, {"error": str(e)}

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_id = {executor.submit(analyze_one, vid): vid for vid in ids}
            for future in as_completed(future_to_id):
                vid = future_to_id[future]
                try:
                    _vid, res = future.result()
                    results[vid] = res
                except Exception as e:
                    results[vid] = {"error": str(e)}
        print(
            f"[Analyze] Completed all analysis. Returning results for {len(results)} videos."
        )
        json_string = json.dumps({"results": results}, cls=NumpyEncoder)
        return Response(json_string, mimetype="application/json")
    except Exception as e:
        print(f"[Analyze] GENERIC ERROR in /analyze endpoint: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/download-mp3", methods=["GET"])
def download_mp3():
    t_start = time.time()
    video_id = request.args.get("videoId")
    if not video_id:
        return jsonify({"error": "Missing videoId parameter"}), 400

    # Check if we already have this file
    db = get_db()
    video_info = db.execute(
        "SELECT title, mp3_path FROM videos WHERE video_id = ?", (video_id,)
    ).fetchone()
    if video_info and video_info["mp3_path"] and os.path.exists(video_info["mp3_path"]):
        print(f"[Single] Serving existing file: {video_info['mp3_path']}")
        file_path = video_info["mp3_path"]
        title = sanitize_filename(video_info["title"] or video_id)
        size_bytes = os.path.getsize(file_path)
        arcname = f"{title}.mp3"

        # Support HTTP Range for seeking
        range_header = request.headers.get("Range", None)
        if range_header:
            try:
                # Example: Range: bytes=START-END
                bytes_unit, range_spec = range_header.split("=", 1)
                if bytes_unit.strip().lower() != "bytes":
                    raise ValueError("Unsupported range unit")
                start_str, end_str = (range_spec or "").split("-", 1)
                start = int(start_str) if start_str else 0
                end = int(end_str) if end_str else size_bytes - 1
                start = max(0, min(start, size_bytes - 1))
                end = max(start, min(end, size_bytes - 1))

                length = end - start + 1
                print(
                    f"[Single] Range request {start}-{end}/{size_bytes} (len={length})"
                )

                def generate_part():
                    with open(file_path, "rb") as f:
                        f.seek(start)
                        remaining = length
                        chunk_size = 1024 * 1024
                        while remaining > 0:
                            read_size = min(chunk_size, remaining)
                            data = f.read(read_size)
                            if not data:
                                break
                            remaining -= len(data)
                            yield data

                response = Response(
                    stream_with_context(generate_part()),
                    status=206,
                    mimetype="audio/mpeg",
                )
                response.headers["Content-Range"] = f"bytes {start}-{end}/{size_bytes}"
                response.headers["Accept-Ranges"] = "bytes"
                response.headers["Content-Length"] = str(length)
                response.headers["Content-Disposition"] = (
                    f'attachment; filename="{arcname}"'
                )
                # Cache headers (same as below)
                response.headers["Cache-Control"] = (
                    "no-cache, no-store, must-revalidate"
                )
                response.headers["Pragma"] = "no-cache"
                response.headers["Expires"] = "0"
                return response
            except Exception as e:
                print(f"[Single] Failed to handle Range header: {e}. Sending full file")

        def generate_existing_file_stream():
            with open(file_path, "rb") as f:
                yield from f

        response = Response(
            stream_with_context(generate_existing_file_stream()),
            mimetype="audio/mpeg",
        )
        response.headers["Content-Disposition"] = f'attachment; filename="{arcname}"'
        response.headers["Content-Length"] = str(size_bytes)
        response.headers["Accept-Ranges"] = "bytes"
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response

    print(f"[Single] Start download-mp3 for {video_id}")

    try:
        final_mp3_path, title = download_audio_lib(video_id, MP3_DIR)

        if not final_mp3_path:
            return jsonify({"error": "MP3 output not found after conversion"}), 500

        # Persist to DB
        db = get_db()
        db.execute(
            """
            INSERT INTO videos(video_id, title, mp3_path, last_updated)
            VALUES(?, ?, ?, datetime('now'))
            ON CONFLICT(video_id) DO UPDATE SET
              title=excluded.title,
              mp3_path=excluded.mp3_path,
              last_updated=datetime('now')
            """,
            (video_id, title, final_mp3_path),
        )
        db.commit()

        size_bytes = os.path.getsize(final_mp3_path)
        arcname = f"{title}.mp3"

        def generate_file_stream():
            try:
                with open(final_mp3_path, "rb") as f:
                    yield from f
            finally:
                print(
                    f"[Single] Stream finished. Total time={time.time() - t_start:.1f}s"
                )

        # Support Range for newly created file as well
        range_header = request.headers.get("Range", None)
        if range_header:
            try:
                bytes_unit, range_spec = range_header.split("=", 1)
                if bytes_unit.strip().lower() != "bytes":
                    raise ValueError("Unsupported range unit")
                start_str, end_str = (range_spec or "").split("-", 1)
                start = int(start_str) if start_str else 0
                end = int(end_str) if end_str else size_bytes - 1
                start = max(0, min(start, size_bytes - 1))
                end = max(start, min(end, size_bytes - 1))
                length = end - start + 1
                print(
                    f"[Single] Range request (new) {start}-{end}/{size_bytes} (len={length})"
                )

                def generate_part():
                    with open(final_mp3_path, "rb") as f:
                        f.seek(start)
                        remaining = length
                        chunk_size = 1024 * 1024
                        while remaining > 0:
                            read_size = min(chunk_size, remaining)
                            data = f.read(read_size)
                            if not data:
                                break
                            remaining -= len(data)
                            yield data

                response = Response(
                    stream_with_context(generate_part()),
                    status=206,
                    mimetype="audio/mpeg",
                )
                response.headers["Content-Range"] = f"bytes {start}-{end}/{size_bytes}"
                response.headers["Accept-Ranges"] = "bytes"
                response.headers["Content-Length"] = str(length)
                response.headers["Content-Disposition"] = (
                    f'attachment; filename="{arcname}"'
                )
                response.headers["Cache-Control"] = (
                    "no-cache, no-store, must-revalidate"
                )
                response.headers["Pragma"] = "no-cache"
                response.headers["Expires"] = "0"
                return response
            finally:
                pass

        response = Response(
            stream_with_context(generate_file_stream()), mimetype="audio/mpeg"
        )
        response.headers["Content-Disposition"] = f'attachment; filename="{arcname}"'
        response.headers["Content-Length"] = str(size_bytes)
        response.headers["Accept-Ranges"] = "bytes"
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response
    except yt_dlp.utils.DownloadError as e:
        print(f"[Single] yt-dlp error: {e}")
        return jsonify({"error": "yt-dlp download error"}), 500
    except Exception as e:
        print(f"[Single] Generic error: {e}")
        return jsonify({"error": f"An unexpected error occurred: {e}"}), 500


@app.route("/batch-zip", methods=["POST"])
def batch_zip():
    t_batch_start = time.time()
    try:
        data = request.get_json(force=True) or {}
        items = data.get("items")
        if not items or not isinstance(items, list):
            return jsonify({"error": "Body must include items: [{id, title}]"}), 400

        # Normalize items and check for existing files
        tasks_to_download = []
        mp3_files = []
        db = get_db()
        all_tasks = []
        for item in items:
            vid = (item.get("id") or "").strip()
            title = (item.get("title") or vid or "audio").strip()
            if not vid:
                continue
            all_tasks.append({"id": vid, "title": title})

        for task in all_tasks:
            vid = task["id"]
            video_info = db.execute(
                "SELECT mp3_path FROM videos WHERE video_id = ?", (vid,)
            ).fetchone()
            if (
                video_info
                and video_info["mp3_path"]
                and os.path.exists(video_info["mp3_path"])
            ):
                print(f"[Batch] Found existing file for {vid}")
                arcname = sanitize_filename(task["title"]) + ".mp3"
                mp3_files.append((video_info["mp3_path"], arcname))
            else:
                tasks_to_download.append(task)

        if not all_tasks:
            return jsonify({"error": "No valid items provided"}), 400

        print(
            f"[Batch] Starting batch for {len(all_tasks)} items ({len(tasks_to_download)} to download)"
        )

        if tasks_to_download:

            def download_convert_one(task):
                vid = task["id"]
                title = task["title"]
                print(f"[Batch] Downloading: {title} [{vid}]")
                t_one_start = time.time()
                try:
                    (
                        final_mp3_path,
                        _title,
                    ) = download_audio_lib(vid, MP3_DIR)
                    if not final_mp3_path:
                        raise FileNotFoundError("MP3 output not found after conversion")

                    # Persist to DB in this thread with a new connection
                    conn = sqlite3.connect(DB_PATH)
                    try:
                        conn.execute(
                            """
                            INSERT INTO videos(video_id, title, mp3_path, last_updated)
                            VALUES(?, ?, ?, datetime('now'))
                            ON CONFLICT(video_id) DO UPDATE SET
                              title=excluded.title,
                              mp3_path=excluded.mp3_path,
                              last_updated=datetime('now')
                            """,
                            (vid, title, final_mp3_path),
                        )
                        conn.commit()
                    finally:
                        conn.close()

                    arcname = sanitize_filename(title) + ".mp3"
                    t_one_end = time.time()
                    size_mb = os.path.getsize(final_mp3_path) / (1024 * 1024)
                    print(
                        f"[Batch] Done: {title} in {t_one_end - t_one_start:.1f}s ({size_mb:.2f} MB)"
                    )
                    return (final_mp3_path, arcname)
                except Exception as e:
                    t_one_end = time.time()
                    print(
                        f"[Batch] FAILED: {title} [{vid}] after {t_one_end - t_one_start:.1f}s -> {e}"
                    )
                    return None

            # Determine worker count: request body > env var > default
            max_workers_env = int(os.environ.get("YTMP3_MAX_WORKERS", "4"))
            max_workers_req_raw = data.get("maxWorkers")
            try:
                max_workers_req = int(max_workers_req_raw)
            except Exception:
                max_workers_req = 0
            requested_workers = (
                max_workers_req if max_workers_req > 0 else max_workers_env
            )
            max_workers = max(1, min(requested_workers, 8, len(tasks_to_download)))
            print(f"[Batch] Using up to {max_workers} parallel workers")

            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                future_to_task = {
                    executor.submit(download_convert_one, task): task
                    for task in tasks_to_download
                }
                for future in as_completed(future_to_task):
                    result = future.result()
                    if result:
                        mp3_files.append(result)

        if not mp3_files:
            return (
                jsonify(
                    {"error": "No items could be processed. Try again or check logs."}
                ),
                400,
            )

        # Prepare streaming ZIP
        z = zipstream.ZipFile(mode="w", compression=zipfile.ZIP_DEFLATED)
        for file_path, arcname in mp3_files:
            print(f"[Batch] Adding to ZIP: {arcname}")
            z.write(file_path, arcname)

        def generate_zip_stream():
            try:
                for chunk in z:
                    yield chunk
            finally:
                t_batch_end = time.time()
                print(
                    f"[Batch] ZIP streaming completed in {t_batch_end - t_batch_start:.1f}s"
                )
                # No temp dir to clean up

        response = Response(
            stream_with_context(generate_zip_stream()),
            mimetype="application/zip",
        )
        response.headers["Content-Disposition"] = (
            'attachment; filename="playlist.mp3.zip"'
        )
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response
    except Exception as e:
        print(f"[Batch] Generic error: {e}")
        return jsonify({"error": f"Batch failed: {e}"}), 500


if __name__ == "__main__":
    # Get port from environment variable or default to 5328
    port = int(os.environ.get("PORT", 5328))
    # Run the app (debug=True helps with development, but disable for production)
    app.run(host="0.0.0.0", port=port, debug=True)
