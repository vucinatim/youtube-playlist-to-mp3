import os
import re
import shutil
import tempfile
import zipfile
import time  # Import time module
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock

import requests
import yt_dlp
import zipstream
from flask import Flask, request, jsonify, Response, stream_with_context, g

# Optional heavy imports for key detection (loaded lazily in the endpoint)
import subprocess
import sqlite3

app = Flask(__name__)


# --------------------
# SQLite Initialization
# --------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Allow overriding data dir when packaged (Electron/Tauri)
DATA_DIR = os.environ.get("APP_DATA_DIR", os.path.join(BASE_DIR, "data"))
MP3_DIR = os.path.join(DATA_DIR, "mp3")
DB_PATH = os.path.join(DATA_DIR, "app.db")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(MP3_DIR, exist_ok=True)


def get_db():
    if "db" not in g:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        g.db = conn
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DB_PATH)
    try:
        cur = db.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS playlists (
              id TEXT PRIMARY KEY,
              url TEXT,
              title TEXT,
              channel TEXT,
              thumbnail TEXT,
              video_count INTEGER,
              created_at TEXT DEFAULT (datetime('now')),
              updated_at TEXT DEFAULT (datetime('now'))
            )
            """
        )
        # Migration: ensure playlists table has a 'thumbnail' column
        try:
            cur.execute("PRAGMA table_info(playlists)")
            cols = [row[1] for row in cur.fetchall()]
            if "thumbnail" not in cols:
                cur.execute("ALTER TABLE playlists ADD COLUMN thumbnail TEXT")
        except Exception as e:
            print(f"[DB] Migration check/add thumbnail failed: {e}")
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS videos (
              video_id TEXT PRIMARY KEY,
              title TEXT,
              creator TEXT,
              views INTEGER,
              thumbnail TEXT,
              key TEXT,
              mp3_path TEXT,
              last_updated TEXT DEFAULT (datetime('now'))
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS playlist_items (
              playlist_id TEXT,
              video_id TEXT,
              position INTEGER,
              PRIMARY KEY (playlist_id, video_id)
            )
            """
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_playlist_items_pid ON playlist_items(playlist_id)"
        )
        db.commit()
    finally:
        db.close()


init_db()


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
        vkey = v.get("key") or None
        vmp3 = v.get("mp3_path") or None

        db.execute(
            """
            INSERT INTO videos(video_id, title, creator, views, thumbnail, key, mp3_path, last_updated)
            VALUES(?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(video_id) DO UPDATE SET
              title=excluded.title,
              creator=excluded.creator,
              views=excluded.views,
              thumbnail=excluded.thumbnail,
              key=COALESCE(excluded.key, videos.key),
              mp3_path=COALESCE(excluded.mp3_path, videos.mp3_path),
              last_updated=datetime('now')
            """,
            (vid, vtitle, vcreator, vviews, vthumb, vkey, vmp3),
        )
        db.execute(
            """
            INSERT INTO playlist_items(playlist_id, video_id, position)
            VALUES(?, ?, ?)
            ON CONFLICT(playlist_id, video_id) DO UPDATE SET position=excluded.position
            """,
            (playlist_id, vid, idx),
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
        SELECT v.video_id as id, v.title, v.creator, v.views, v.thumbnail, v.key, v.mp3_path, pi.position
        FROM playlist_items pi
        JOIN videos v ON v.video_id = pi.video_id
        WHERE pi.playlist_id = ?
        ORDER BY pi.position ASC
        """,
        (playlist_id,),
    ).fetchall()
    return jsonify(
        {
            "playlist": dict(pl),
            "videos": [dict(r) for r in items],
        }
    )


def _get_best_audio_info(video_url: str):
    """Return (download_url, ext) for the bestaudio stream using yt_dlp without full download."""
    ydl_opts = {
        "format": "bestaudio/best",
        "quiet": True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info_dict = ydl.extract_info(video_url, download=False)
    # Select final URL similar to logic in /download
    file_ext = None
    download_url = None
    requested_formats = info_dict.get("requested_formats")
    if requested_formats and isinstance(requested_formats, list):
        audio_candidates = [
            f for f in requested_formats if f and f.get("acodec") != "none"
        ]
        if audio_candidates:
            chosen = sorted(
                audio_candidates,
                key=lambda f: (
                    f.get("abr") or 0,
                    f.get("asr") or 0,
                    f.get("filesize") or 0,
                ),
                reverse=True,
            )[0]
            download_url = chosen.get("url")
            file_ext = chosen.get("ext") or info_dict.get("ext") or "webm"
    if not download_url:
        fmts = info_dict.get("formats") or []
        audio_fmts = [f for f in fmts if f and f.get("acodec") != "none"]
        if audio_fmts:
            chosen = sorted(
                audio_fmts,
                key=lambda f: (
                    f.get("abr") or 0,
                    f.get("asr") or 0,
                    f.get("filesize") or 0,
                ),
                reverse=True,
            )[0]
            download_url = chosen.get("url")
            file_ext = chosen.get("ext") or info_dict.get("ext") or "webm"
    return download_url, file_ext or "webm"


def _estimate_key_with_librosa(wav_path: str) -> str:
    """Basic key estimation using chroma features and Krumhansl-Schmuckler profiles."""
    import numpy as _np
    import librosa as _librosa

    # Use lower sample rate for speed
    y, sr = _librosa.load(wav_path, sr=11025, mono=True)
    if y.size == 0:
        return "unknown"
    # Use chroma_stft for speed
    chroma = _librosa.feature.chroma_stft(y=y, sr=sr)
    if chroma.size == 0:
        return "unknown"
    chroma_mean = chroma.mean(axis=1)
    # Krumhansl-Kessler key profiles (major/minor)
    major_profile = _np.array(
        [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
    )
    minor_profile = _np.array(
        [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
    )

    def best_key(profile: "_np.ndarray"):
        scores = []
        for i in range(12):
            rotated = _np.roll(profile, i)
            score = _np.corrcoef(chroma_mean, rotated)[0, 1]
            scores.append(score)
        best_index = int(_np.nanargmax(scores))
        best_score = float(scores[best_index])
        return best_index, best_score

    maj_index, maj_score = best_key(major_profile)
    min_index, min_score = best_key(minor_profile)

    pitch_classes = [
        "C",
        "C#",
        "D",
        "D#",
        "E",
        "F",
        "F#",
        "G",
        "G#",
        "A",
        "A#",
        "B",
    ]
    if _np.isnan(maj_score) and _np.isnan(min_score):
        return "unknown"
    if maj_score >= min_score:
        return f"{pitch_classes[maj_index]} major"
    else:
        return f"{pitch_classes[min_index]} minor"


@app.route("/detect-key", methods=["GET"])
def detect_key():
    """
    Detect musical key of a YouTube video's audio by sampling ~30 seconds via ffmpeg
    and estimating with librosa. Returns JSON: {"key": "C major"}.
    """
    video_id = request.args.get("videoId")
    if not video_id:
        return jsonify({"error": "Missing videoId parameter"}), 400

    video_url = f"https://www.youtube.com/watch?v={video_id}"
    try:
        # Get a direct audio URL
        audio_url, _ext = _get_best_audio_info(video_url)
        if not audio_url:
            return jsonify({"error": "Unable to resolve audio URL"}), 502

        tmpdir = tempfile.mkdtemp(prefix="yt_key_")
        wav_path = os.path.join(tmpdir, f"{video_id}.wav")

        # Use ffmpeg to grab the first 30 seconds and decode to wav for analysis
        ffmpeg_bin = shutil.which("ffmpeg")
        if not ffmpeg_bin:
            shutil.rmtree(tmpdir, ignore_errors=True)
            return jsonify({"error": "ffmpeg not found on server"}), 500

        # Some CDNs need a User-Agent; pass via headers if necessary
        ffmpeg_cmd = [
            ffmpeg_bin,
            "-y",
            "-ss",
            "5",  # skip first seconds to avoid intros
            "-t",
            "12",  # shorter window for faster analysis
            "-loglevel",
            "error",
            "-i",
            audio_url,
            "-vn",
            "-ac",
            "1",
            "-ar",
            "11025",
            wav_path,
        ]
        subprocess.run(
            ffmpeg_cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )

        # Analyze
        key_str = _estimate_key_with_librosa(wav_path)
        shutil.rmtree(tmpdir, ignore_errors=True)
        return jsonify({"key": key_str})
    except subprocess.CalledProcessError:
        return jsonify({"error": "Failed to sample audio via ffmpeg"}), 500
    except Exception as e:
        try:
            shutil.rmtree(tmpdir, ignore_errors=True)
        except Exception:
            pass
        return jsonify({"error": str(e)}), 500


# Simple in-memory cache for detected keys
_key_cache_lock = Lock()
_key_cache: dict[str, str] = {}


def _detect_key_for_video_id(video_id: str) -> tuple[str, str | None]:
    """Return (video_id, key or None). Uses cache to avoid recompute."""
    with _key_cache_lock:
        if video_id in _key_cache:
            return video_id, _key_cache[video_id]
    video_url = f"https://www.youtube.com/watch?v={video_id}"
    try:
        audio_url, _ext = _get_best_audio_info(video_url)
        if not audio_url:
            return video_id, None
        tmpdir = tempfile.mkdtemp(prefix="yt_key_")
        wav_path = os.path.join(tmpdir, f"{video_id}.wav")
        ffmpeg_bin = shutil.which("ffmpeg")
        if not ffmpeg_bin:
            shutil.rmtree(tmpdir, ignore_errors=True)
            return video_id, None
        ffmpeg_cmd = [
            ffmpeg_bin,
            "-y",
            "-ss",
            "5",
            "-t",
            "12",
            "-loglevel",
            "error",
            "-i",
            audio_url,
            "-vn",
            "-ac",
            "1",
            "-ar",
            "11025",
            wav_path,
        ]
        subprocess.run(
            ffmpeg_cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        key_str = _estimate_key_with_librosa(wav_path)
        shutil.rmtree(tmpdir, ignore_errors=True)
        with _key_cache_lock:
            _key_cache[video_id] = key_str
        return video_id, key_str
    except Exception:
        try:
            shutil.rmtree(tmpdir, ignore_errors=True)
        except Exception:
            pass
        return video_id, None


@app.route("/detect-keys", methods=["POST"])
def detect_keys_batch():
    """
    Batch-detect keys. Body: {"ids": ["vid1", ...], "maxWorkers": optional}
    Returns {"results": {"vid1": {"key": "C major"}, "vid2": {"error": "..."}}}
    """
    try:
        data = request.get_json(silent=True) or {}
        ids = data.get("ids") or []
        if not isinstance(ids, list) or not all(isinstance(v, str) for v in ids):
            return jsonify({"error": "ids must be a list of strings"}), 400
        max_workers_req = int(data.get("maxWorkers") or 0)
        max_workers_env = int(os.environ.get("YTMP3_MAX_WORKERS", "4"))
        max_workers = max(1, min(8, max_workers_req or max_workers_env, len(ids) or 1))

        results: dict[str, dict] = {}
        if not ids:
            return jsonify({"results": results})

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_id = {
                executor.submit(_detect_key_for_video_id, vid): vid for vid in ids
            }
            for future in as_completed(future_to_id):
                vid = future_to_id[future]
                try:
                    _vid, key = future.result()
                    if key is not None:
                        results[vid] = {"key": key}
                        # Persist key to DB best-effort
                        try:
                            db = get_db()
                            db.execute(
                                "UPDATE videos SET key=?, last_updated=datetime('now') WHERE video_id=?",
                                (key, vid),
                            )
                            db.commit()
                        except Exception as e:
                            print(f"[DB] failed to persist key for {vid}: {e}")
                    else:
                        results[vid] = {"error": "failed"}
                except Exception as e:
                    results[vid] = {"error": str(e)}

        return jsonify({"results": results})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


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

            # Download and convert in parallel using a thread pool
            def download_convert_one(task):
                vid = task["id"]
                title = task["title"]
                url = f"https://www.youtube.com/watch?v={vid}"
                print(f"[Batch] Downloading: {title} [{vid}]")
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
                    t_one_end = time.time()
                    size_mb = os.path.getsize(mp3_path) / (1024 * 1024)
                    print(
                        f"[Batch] Done: {title} in {t_one_end - t_one_start:.1f}s ({size_mb:.2f} MB)"
                    )
                    return (mp3_path, arcname)
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
            max_workers = max(1, min(requested_workers, 8, len(tasks)))
            print(f"[Batch] Using up to {max_workers} parallel workers")

            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                future_to_task = {
                    executor.submit(download_convert_one, task): task for task in tasks
                }
                for future in as_completed(future_to_task):
                    result = future.result()
                    if result:
                        mp3_files.append(result)

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
