import shutil
import os
import time
import yt_dlp

from .utils import sanitize_filename


def get_video_info(video_url: str):
    ydl_opts = {
        "format": "bestaudio/best",
        "quiet": True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info_dict = ydl.extract_info(video_url, download=False)

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
            best_m4a = next((f for f in audio_formats if f.get("ext") == "m4a"), None)
            best_webm = next((f for f in audio_formats if f.get("ext") == "webm"), None)
            metric_m4a = get_sort_metric(best_m4a) if best_m4a else 0.0
            metric_webm = get_sort_metric(best_webm) if best_webm else 0.0
            if best_m4a and best_webm and abs(metric_m4a - metric_webm) < 32:
                chosen_format = best_m4a
            elif audio_formats:
                chosen_format = audio_formats[0]
    else:
        chosen_format = info_dict

    if not chosen_format or not chosen_format.get("url"):
        return None, None, None, None, None

    download_url = chosen_format["url"]
    file_ext = chosen_format.get("ext", "mp3")
    content_type = chosen_format.get("http_headers", {}).get(
        "Content-Type", "audio/mpeg"
    )
    content_length_est = str(
        chosen_format.get("filesize") or chosen_format.get("filesize_approx") or 0
    )

    if not content_type or content_type == "audio/mpeg":
        if file_ext == "webm":
            content_type = "audio/webm"
        elif file_ext in ("m4a", "mp4"):
            content_type = "audio/mp4"
        else:
            content_type = "audio/mpeg"

    headers_from_ydl = dict(chosen_format.get("http_headers") or {})
    merged_headers = {
        "User-Agent": headers_from_ydl.get(
            "User-Agent",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        ),
        "Accept": headers_from_ydl.get("Accept", "*/*"),
        "Accept-Language": headers_from_ydl.get("Accept-Language", "en-US,en;q=0.9"),
        "Referer": headers_from_ydl.get("Referer", "https://www.youtube.com/"),
    }
    for k, v in headers_from_ydl.items():
        merged_headers.setdefault(k, v)

    merged_headers.setdefault("Range", "bytes=0-")

    return (
        download_url,
        file_ext,
        content_type,
        content_length_est,
        merged_headers,
    )


def download_audio(video_id: str, output_dir: str):
    url = f"https://www.youtube.com/watch?v={video_id}"
    title = video_id
    try:
        with yt_dlp.YoutubeDL({"quiet": True}) as ydl:
            info = ydl.extract_info(url, download=False)
            raw_title = info.get("title") or video_id
            title = sanitize_filename(raw_title)
    except Exception as e:
        print(f"[YouTube] Title extract failed: {e}")

    final_mp3_path = os.path.join(output_dir, f"{video_id}.mp3")
    ydl_opts = {
        "format": "bestaudio/best",
        "quiet": True,
        "noprogress": True,
        "outtmpl": os.path.join(output_dir, "%(id)s.%(ext)s"),
        "paths": {"home": output_dir},
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

    if not os.path.exists(final_mp3_path):
        return None, None

    print(f"[YouTube] Downloaded {video_id} in {time.time() - t_dl_start:.1f}s")
    return final_mp3_path, title


def get_playlist_info(playlist_url: str):
    ydl_opts = {
        "quiet": True,
        "extract_flat": True,
        "force_generic_extractor": True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        playlist_dict = ydl.extract_info(playlist_url, download=False)
    return playlist_dict
