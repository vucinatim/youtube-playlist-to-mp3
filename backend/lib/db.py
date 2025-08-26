import os
import sqlite3
from flask import g

# --------------------
# SQLite Initialization
# --------------------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
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
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS videos (
              video_id TEXT PRIMARY KEY,
              playlist_id TEXT,
              position INTEGER,
              title TEXT,
              creator TEXT,
              views INTEGER,
              thumbnail TEXT,
              mp3_path TEXT,
              analysis TEXT, -- JSON with key, bpm, cue_points etc.
              last_updated TEXT DEFAULT (datetime('now')),
              FOREIGN KEY (playlist_id) REFERENCES playlists (id)
            )
            """
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_videos_playlist_id ON videos(playlist_id)"
        )
        db.commit()
    finally:
        db.close()
