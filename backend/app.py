import json
import os
import time  # Import time module
import yt_dlp
import requests
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
        # yt-dlp options
        ydl_opts = {
            "format": "bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio",
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
                best_webm = next(
                    (f for f in audio_formats if f.get("ext") == "webm"), None
                )
                best_m4a = next(
                    (f for f in audio_formats if f.get("ext") == "m4a"), None
                )
                metric_webm = get_sort_metric(best_webm) if best_webm else 0.0
                metric_m4a = get_sort_metric(best_m4a) if best_m4a else 0.0
                if best_webm and best_m4a and abs(metric_webm - metric_m4a) < 10:
                    chosen_format = best_webm
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

        req = requests.get(
            download_url,
            stream=True,
            headers=merged_headers,
            allow_redirects=True,
            timeout=30,
        )
        # If YouTube responds with non-success, retry once with a Range header which often triggers a 200/206
        if req.status_code >= 400:
            print(
                f"[Flask] First attempt failed: {req.status_code} {req.reason}. Retrying with Range header..."
            )
            merged_headers_with_range = {**merged_headers, "Range": "bytes=0-"}
            req = requests.get(
                download_url,
                stream=True,
                headers=merged_headers_with_range,
                allow_redirects=True,
                timeout=30,
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
            for chunk in req.iter_content(chunk_size=8192):
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


if __name__ == "__main__":
    # Get port from environment variable or default to 5328
    port = int(os.environ.get("PORT", 5328))
    # Run the app (debug=True helps with development, but disable for production)
    app.run(host="0.0.0.0", port=port, debug=True)
