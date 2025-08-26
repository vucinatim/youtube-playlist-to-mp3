import re


def sanitize_filename(name: str) -> str:
    safe = re.sub(r'[\\/:*?"<>|]+', " ", name).strip()
    safe = re.sub(r"\s+", " ", safe)
    if not safe:
        return "audio"
    return safe[:200]
