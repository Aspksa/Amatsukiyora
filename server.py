from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import sqlite3
from contextlib import contextmanager
import json
import webbrowser
import argparse

ROOT = Path(__file__).resolve().parent
CATEGORIES = ("Знания", "Навыки", "Опыт", "Личность")
DB = ROOT / "data" / "memory.db"

@contextmanager
def connect():
    DB.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB)
    try:
        with db:
            yield db
    finally:
        db.close()

def init():
    with connect() as db:
        db.execute("CREATE TABLE IF NOT EXISTS memory (id INTEGER PRIMARY KEY, category TEXT NOT NULL, label TEXT NOT NULL)")

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / "web"), **kwargs)
    def reply(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)
    def do_GET(self):
        if self.path != "/api/memory":
            return super().do_GET()
        with connect() as db:
            db.row_factory = sqlite3.Row
            rows = db.execute("SELECT id,category,label FROM memory ORDER BY id DESC LIMIT 4800").fetchall()
        self.reply(200, [dict(row) for row in rows])
    def do_POST(self):
        if self.path != "/api/memory":
            return self.reply(404, {"error":"not found"})
        if self.headers.get("Origin") != f"http://127.0.0.1:{self.server.server_port}":
            return self.reply(403, {"error":"origin"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 4096 or self.headers.get_content_type() != "application/json":
                raise ValueError()
            data = json.loads(self.rfile.read(length))
            category, label = data["category"], data["label"]
            if category not in CATEGORIES or not isinstance(label, str) or not 1 <= len(label.strip()) <= 200:
                raise ValueError()
        except (ValueError, TypeError, KeyError, UnicodeError):
            return self.reply(400, {"error":"invalid input"})
        with connect() as db:
            cursor = db.execute("INSERT INTO memory(category,label) VALUES (?,?)", (category,label.strip()))
            ident = cursor.lastrowid
        self.reply(201, {"id":ident})

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    init()
    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        url = f"http://127.0.0.1:{server.server_port}"
        print(url, flush=True)
        if not args.no_browser:
            webbrowser.open(url)
        server.serve_forever()
