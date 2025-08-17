import json
import os
import re
import shutil
import tempfile
import zipfile
import time  # Import time module
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
import yt_dlp
import zipstream
from flask import Flask, request, jsonify, Response, stream_with_context

app = Flask(__name__)


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
        # yt-dlp options (extract info only; we'll pick a direct stream URL)
        ydl_opts = {
            "format": "bestaudio/best",
            "quiet": True,
            # 'verbose': True,
        }

        print(f"[Flask] Getting info for {video_url}")
        t_before_extract = time.time()
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info_dict = ydl.extract_info(video_url, download=False)
        t_after_extract = time.time()
        print(
            f"[Flask] Time for extract_info: {t_after_extract - t_before_extract:.2f}s"
        )

        # --- Format Selection Logic (robust version) ---
        t_before_format = time.time()
        chosen_format = None
        if "requested_formats" in info_dict:
            chosen_format = info_dict["requested_formats"][0]
        elif "formats" in info_dict:
            audio_formats = [
                f
                for f in info_dict["formats"]
                if f.get("acodec") != "none" and f.get("vcodec") == "none"
            ]
            if audio_formats:

                def get_sort_metric(fmt):
                    metric = fmt.get("abr") or fmt.get("filesize") or fmt.get("tbr")
                    return float(metric) if isinstance(metric, (int, float)) else 0.0

                audio_formats.sort(key=get_sort_metric, reverse=True)
                best_m4a = next(
                    (f for f in audio_formats if f.get("ext") == "m4a"), None
                )
                best_webm = next(
                    (f for f in audio_formats if f.get("ext") == "webm"), None
                )
                metric_m4a = get_sort_metric(best_m4a) if best_m4a else 0.0
                metric_webm = get_sort_metric(best_webm) if best_webm else 0.0
                # Prefer m4a if qualities are close; webm is frequently throttled more
                if best_m4a and best_webm and abs(metric_m4a - metric_webm) < 32:
                    chosen_format = best_m4a
                elif audio_formats:
                    chosen_format = audio_formats[0]
        else:
            chosen_format = info_dict

        if not chosen_format or not chosen_format.get("url"):
            print("[Flask] Could not find a suitable audio format URL.")
            return jsonify(
                {"error": "Could not find a suitable audio format URL."}
            ), 500
        t_after_format = time.time()
        print(
            f"[Flask] Time for format selection: {t_after_format - t_before_format:.2f}s"
        )
        # --- End Format Selection ---

        download_url = chosen_format["url"]
        file_ext = chosen_format.get("ext", "mp3")
        content_type = chosen_format.get("http_headers", {}).get(
            "Content-Type", "audio/mpeg"
        )
        content_length_est = str(
            chosen_format.get("filesize") or chosen_format.get("filesize_approx") or 0
        )

        print(
            f"[Flask] Found format URL for {file_ext}, estimated size: {content_length_est}"
        )
        # --- Remove the debug print ---
        # print(f"[Flask] DOWNLOAD URL TO TEST: {download_url}")
        # -------------------------------

        # Stream the download using requests and Flask's stream_with_context
        t_before_request = time.time()
        # Merge and normalize headers provided by yt_dlp with sensible defaults
        headers_from_ydl = dict(chosen_format.get("http_headers") or {})
        merged_headers = {
            "User-Agent": headers_from_ydl.get(
                "User-Agent",
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            ),
            "Accept": headers_from_ydl.get("Accept", "*/*"),
            "Accept-Language": headers_from_ydl.get(
                "Accept-Language", "en-US,en;q=0.9"
            ),
            "Referer": headers_from_ydl.get("Referer", "https://www.youtube.com/"),
        }
        # Include any additional headers yt_dlp provided (e.g., Cookie, X-YouTube-*), without overwriting above
        for k, v in headers_from_ydl.items():
            merged_headers.setdefault(k, v)

        # Default to Range requests which often trigger faster CDN paths
        merged_headers.setdefault("Range", "bytes=0-")
        req = requests.get(
            download_url,
            stream=True,
            headers=merged_headers,
            allow_redirects=True,
            timeout=120,
        )
        # If YouTube responds with non-success, retry once without Range as fallback
        if req.status_code >= 400:
            print(
                f"[Flask] First attempt failed: {req.status_code} {req.reason}. Retrying without Range header..."
            )
            merged_headers_no_range = dict(merged_headers)
            merged_headers_no_range.pop("Range", None)
            req = requests.get(
                download_url,
                stream=True,
                headers=merged_headers_no_range,
                allow_redirects=True,
                timeout=120,
            )
        req.raise_for_status()
        t_after_request_headers = time.time()
        print(
            f"[Flask] Time for requests.get (headers): {t_after_request_headers - t_before_request:.2f}s"
        )

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

        # Deduce a sane content type from extension if upstream didn't provide a strong one
        if not content_type or content_type == "audio/mpeg":
            if file_ext == "webm":
                content_type = "audio/webm"
            elif file_ext in ("m4a", "mp4"):
                content_type = "audio/mp4"
            else:
                content_type = "audio/mpeg"

        # Create the Flask response with streaming content
        response = Response(stream_with_context(generate()), mimetype=content_type)
        response.headers["Content-Disposition"] = (
            f'attachment; filename="audio.{file_ext}"'
        )
        # Only set Content-Length if known to avoid mismatches with chunked transfer
        if final_content_length and str(final_content_length) != "0":
            response.headers["Content-Length"] = final_content_length
        # Pass through Accept-Ranges if provided
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


def sanitize_filename(name: str) -> str:
    safe = re.sub(r"[\\/:*?\"<>|]+", " ", name).strip()
    safe = re.sub(r"\s+", " ", safe)
    if not safe:
        return "audio"
    return safe[:200]


@app.route("/download-mp3", methods=["GET"])
def download_mp3():
    t_start = time.time()
    video_id = request.args.get("videoId")
    if not video_id:
        return jsonify({"error": "Missing videoId parameter"}), 400
    url = f"https://www.youtube.com/watch?v={video_id}"
    print(f"[Single] Start download-mp3 for {video_id}")

    tmpdir = tempfile.mkdtemp(prefix="ytmp3_one_")
    try:
        # First, extract title for nicer filename
        title = video_id
        try:
            with yt_dlp.YoutubeDL({"quiet": True}) as ydl:
                info = ydl.extract_info(url, download=False)
                raw_title = info.get("title") or video_id
                title = sanitize_filename(raw_title)
        except Exception as e:
            print(f"[Single] Title extract failed, falling back to id: {e}")

        ydl_opts = {
            "format": "bestaudio/best",
            "quiet": True,
            "noprogress": True,
            "outtmpl": os.path.join(tmpdir, "%(id)s.%(ext)s"),
            "paths": {"home": tmpdir},
            "http_chunk_size": 5_000_000,
            "retries": 3,
            "fragment_retries": 10,
            "postprocessors": [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": "0",
                }
            ],
        }
        if shutil.which("aria2c"):
            ydl_opts["external_downloader"] = "aria2c"
            ydl_opts["external_downloader_args"] = {
                "http": ["-x16", "-k1M", "--summary-interval=5"],
                "https": ["-x16", "-k1M", "--summary-interval=5"],
            }

        t_dl_start = time.time()
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        # Find the mp3 path
        mp3_path = os.path.join(tmpdir, f"{video_id}.mp3")
        if not os.path.exists(mp3_path):
            for root, _dirs, files in os.walk(tmpdir):
                for f in files:
                    if f.endswith(".mp3") and (video_id in f or f.startswith(video_id)):
                        mp3_path = os.path.join(root, f)
                        break
        if not os.path.exists(mp3_path):
            shutil.rmtree(tmpdir, ignore_errors=True)
            return jsonify({"error": "MP3 output not found after conversion"}), 500

        size_bytes = os.path.getsize(mp3_path)
        arcname = f"{title}.mp3"
        print(
            f"[Single] Downloaded and converted in {time.time() - t_dl_start:.1f}s; size={size_bytes} bytes"
        )

        def generate_file_stream():
            try:
                with open(mp3_path, "rb") as f:
                    while True:
                        chunk = f.read(1024 * 1024)
                        if not chunk:
                            break
                        yield chunk
            finally:
                shutil.rmtree(tmpdir, ignore_errors=True)
                print(
                    f"[Single] Cleaned temp dir. Total time={time.time() - t_start:.1f}s"
                )

        response = Response(
            stream_with_context(generate_file_stream()), mimetype="audio/mpeg"
        )
        response.headers["Content-Disposition"] = f'attachment; filename="{arcname}"'
        response.headers["Content-Length"] = str(size_bytes)
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response
    except yt_dlp.utils.DownloadError as e:
        shutil.rmtree(tmpdir, ignore_errors=True)
        print(f"[Single] yt-dlp error: {e}")
        return jsonify({"error": "yt-dlp download error"}), 500
    except Exception as e:
        shutil.rmtree(tmpdir, ignore_errors=True)
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

        # Normalize items
        tasks = []
        for item in items:
            vid = (item.get("id") or "").strip()
            title = (item.get("title") or vid or "audio").strip()
            if not vid:
                continue
            tasks.append({"id": vid, "title": title})

        if not tasks:
            return jsonify({"error": "No valid items provided"}), 400

        print(f"[Batch] Starting batch for {len(tasks)} items")

        tmpdir = tempfile.mkdtemp(prefix="ytmp3_")
        try:
            mp3_files = []
            # Configure yt-dlp options
            # Base yt-dlp options
            ydl_opts = {
                "format": "bestaudio/best",
                "quiet": True,
                "noprogress": True,
                "outtmpl": os.path.join(tmpdir, "%(id)s.%(ext)s"),
                "paths": {"home": tmpdir},
                "http_chunk_size": 5_000_000,
                "retries": 3,
                "fragment_retries": 10,
                "postprocessors": [
                    {
                        "key": "FFmpegExtractAudio",
                        "preferredcodec": "mp3",
                        "preferredquality": "0",
                    }
                ],
            }

            # Enable aria2c only if available on system
            if shutil.which("aria2c"):
                ydl_opts["external_downloader"] = "aria2c"
                ydl_opts["external_downloader_args"] = {
                    "http": ["-x16", "-k1M", "--summary-interval=5"],
                    "https": ["-x16", "-k1M", "--summary-interval=5"],
                }

            # Download and convert sequentially (safer for now; can parallelize later)
            for idx, task in enumerate(tasks, start=1):
                vid = task["id"]
                title = task["title"]
                url = f"https://www.youtube.com/watch?v={vid}"
                print(f"[Batch] ({idx}/{len(tasks)}) Downloading: {title} [{vid}]")
                t_one_start = time.time()
                try:
                    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                        ydl.download([url])
                    # After post-processing, file should be at <tmp>/<id>.mp3
                    mp3_path = os.path.join(tmpdir, f"{vid}.mp3")
                    if not os.path.exists(mp3_path):
                        # Fallback: search for any mp3 produced
                        for root, _dirs, files in os.walk(tmpdir):
                            for f in files:
                                if f.endswith(".mp3") and (
                                    vid in f or f.startswith(vid)
                                ):
                                    mp3_path = os.path.join(root, f)
                                    break
                    if not os.path.exists(mp3_path):
                        raise FileNotFoundError("MP3 output not found after conversion")

                    arcname = sanitize_filename(title) + ".mp3"
                    mp3_files.append((mp3_path, arcname))
                    t_one_end = time.time()
                    size_mb = os.path.getsize(mp3_path) / (1024 * 1024)
                    print(
                        f"[Batch] Done: {title} in {t_one_end - t_one_start:.1f}s ({size_mb:.2f} MB)"
                    )
                except Exception as e:
                    t_one_end = time.time()
                    print(
                        f"[Batch] FAILED: {title} [{vid}] after {t_one_end - t_one_start:.1f}s -> {e}"
                    )

            if not mp3_files:
                shutil.rmtree(tmpdir, ignore_errors=True)
                return jsonify(
                    {"error": "No items could be processed. Try again or check logs."}
                ), 400

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
                    shutil.rmtree(tmpdir, ignore_errors=True)

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
            shutil.rmtree(tmpdir, ignore_errors=True)
            raise e
    except Exception as e:
        print(f"[Batch] Generic error: {e}")
        return jsonify({"error": f"Batch failed: {e}"}), 500


if __name__ == "__main__":
    # Get port from environment variable or default to 5328
    port = int(os.environ.get("PORT", 5328))
    # Run the app (debug=True helps with development, but disable for production)
    app.run(host="0.0.0.0", port=port, debug=True)
