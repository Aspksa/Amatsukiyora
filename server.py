from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import sqlite3
from contextlib import contextmanager
import json
import webbrowser
import argparse
from urllib.parse import urlsplit, parse_qs
import cloudru
import universe

ROOT = Path(__file__).resolve().parent
CATEGORIES = ("Знания", "Навыки", "Опыт", "Личность")
DB = ROOT / "data" / "memory.db"
DOCUMENTS = ROOT / "Aspksa" / "Документы"
CLOUD_SETTINGS = "/api/cloudru/settings"
CLOUD_CHAT = "/api/cloudru/chat"

@contextmanager
def connect():
    DB.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB)
    db.execute("PRAGMA foreign_keys=ON")
    try:
        with db:
            yield db
    finally:
        db.close()

def init():
    with connect() as db:
        db.execute("CREATE TABLE IF NOT EXISTS memory (id INTEGER PRIMARY KEY, category TEXT NOT NULL, label TEXT NOT NULL)")

        db.execute("""CREATE TABLE IF NOT EXISTS memory_links (
            source INTEGER NOT NULL REFERENCES memory(id),
            target INTEGER NOT NULL REFERENCES memory(id),
            CHECK(source < target), PRIMARY KEY(source,target))""")
        universe.init(db)
        db.execute("""CREATE TABLE IF NOT EXISTS cloudru_settings (
            id INTEGER PRIMARY KEY CHECK(id = 1),
            api_key TEXT NOT NULL,
            model TEXT NOT NULL DEFAULT '')""")

def add_link(source, target):
    if type(source) is not int or type(target) is not int or source == target:
        raise ValueError("Invalid endpoints")
    if not (0 < source <= 2**53-1 and 0 < target <= 2**53-1):
        raise ValueError("Invalid endpoints")
    source, target = sorted((source, target))
    with connect() as db:
        db.execute("INSERT OR IGNORE INTO memory_links(source,target) VALUES (?,?)", (source,target))

def cloud_settings():
    with connect() as db:
        return db.execute("SELECT api_key,model FROM cloudru_settings WHERE id=1").fetchone() or ("", "")


def update_cloud_settings(data):
    action = data.get("action")
    if action == "disconnect":
        with connect() as db:
            db.execute("PRAGMA secure_delete=ON")
            db.execute("DELETE FROM cloudru_settings WHERE id=1")
        return {"hasKey": False, "model": "", "models": []}

    if action not in ("models", "select"):
        raise ValueError()
    saved_key, saved_model = cloud_settings()
    key = data.get("apiKey", saved_key) if action == "models" else saved_key
    if not isinstance(key, str) or not 1 <= len(key) <= 2048 or not all(33 <= ord(ch) <= 126 for ch in key):
        raise ValueError()

    if action == "select":
        model = data.get("model")
        if not isinstance(model, str) or not 1 <= len(model) <= 250:
            raise ValueError()
        if model not in cloudru.models(key):
            raise cloudru.CloudError("Выберите доступную модель Cloud.ru.")
        with connect() as db:
            updated = db.execute("UPDATE cloudru_settings SET model=? WHERE id=1 AND api_key=?", (model, key))
            if not updated.rowcount:
                raise cloudru.CloudError("Настройки Cloud.ru изменились. Обновите список моделей.")
        return {"hasKey": True, "model": model}

    available = cloudru.models(key)
    model = saved_model if key == saved_key and saved_model in available else ""
    if "apiKey" not in data and model == saved_model:
        return {"hasKey": True, "model": model, "models": available}

    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        current = db.execute("SELECT api_key,model FROM cloudru_settings WHERE id=1").fetchone() or ("", "")
        if current != (saved_key, saved_model):
            raise cloudru.CloudError("Настройки Cloud.ru изменились. Обновите список моделей.")
        db.execute("PRAGMA secure_delete=ON")
        db.execute("""INSERT INTO cloudru_settings(id,api_key,model) VALUES (1,?,?)
            ON CONFLICT(id) DO UPDATE SET api_key=excluded.api_key, model=excluded.model""", (key, model))
    return {"hasKey": True, "model": model, "models": available}


def cloud_chat(data):
    messages = data.get("messages")
    map_context = data.get("mapContext", "")
    if not isinstance(messages, list) or not 1 <= len(messages) <= 9:
        raise ValueError()
    for index, message in enumerate(messages):
        role = "assistant" if index % 2 else "user"
        if not isinstance(message, dict) or message.get("role") != role:
            raise ValueError()
        content = message.get("content")
        if not isinstance(content, str) or not 1 <= len(content.strip()) <= 2000:
            raise ValueError()
    if len(messages) % 2 == 0 or not isinstance(map_context, str) or len(map_context) > 2000:
        raise ValueError()
    key, model = cloud_settings()
    if not key or not model:
        raise cloudru.CloudError("Подключите Cloud.ru и выберите модель в настройках.")
    messages = [{"role": msg["role"], "content": msg["content"]} for msg in messages]
    return {"answer": cloudru.chat(key, model, messages, map_context)}


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
        url = urlsplit(self.path)
        if url.path == CLOUD_SETTINGS:
            if self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}":
                return self.reply(403, {"error": "host"})
            key, model = cloud_settings()
            return self.reply(200, {"hasKey": bool(key), "model": model})
        if url.path in ("/api/universe", "/api/universe/page", "/api/universe/search", "/api/universe/chat-search"):
            try:
                q = parse_qs(url.query)
                with connect() as db:
                    db.execute("BEGIN")
                    if url.path == "/api/universe":
                        result = universe.overview(db)
                    elif url.path == "/api/universe/page":
                        result = universe.page(db,q.get("group",[""])[0],int(q.get("after",["0"])[0]),int(q.get("start",["1"])[0]),int(q["end"][0]) if "end" in q else None)
                    elif url.path == "/api/universe/search":
                        result = universe.search_documents(db,q.get("q",[""])[0])
                    else:
                        result = universe.chat_search(db,q.get("q",[""])[0])
                return self.reply(200,result)
            except (ValueError, OverflowError):
                return self.reply(400, {"error":"Invalid query"})
        if self.path == "/api/links":
            with connect() as db:
                rows = db.execute("SELECT source,target FROM memory_links ORDER BY source,target LIMIT 5000").fetchall()
            return self.reply(200, [{"source": a, "target": b} for a,b in rows])
        if self.path != "/api/memory":
            return super().do_GET()
        with connect() as db:
            db.row_factory = sqlite3.Row
            rows = db.execute("SELECT id,category,label FROM memory ORDER BY id DESC LIMIT 4800").fetchall()
        self.reply(200, [dict(row) for row in rows])
    def do_POST(self):
        if self.path not in ("/api/memory", "/api/links", "/api/universe/scan", "/api/universe/document-link", CLOUD_SETTINGS, CLOUD_CHAT):
            return self.reply(404, {"error":"not found"})
        if self.headers.get("Origin") != f"http://127.0.0.1:{self.server.server_port}":
            return self.reply(403, {"error":"origin"})
        cloud_request = self.path in (CLOUD_SETTINGS, CLOUD_CHAT)
        if cloud_request and self.headers.get("Host") != f"127.0.0.1:{self.server.server_port}":
            return self.reply(403, {"error": "host"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= (131072 if self.path == CLOUD_CHAT else 4096) or self.headers.get_content_type() != "application/json":
                raise ValueError()
            data = json.loads(self.rfile.read(length))
            if cloud_request:
                if not isinstance(data, dict):
                    raise ValueError()
                result = cloud_chat(data) if self.path == CLOUD_CHAT else update_cloud_settings(data)
                return self.reply(200, result)
            if self.path == "/api/universe/scan":
                with connect() as db:
                    result = universe.scan(db,DOCUMENTS)
                return self.reply(200,result)
            if self.path == "/api/universe/document-link":
                try:
                    with connect() as db:
                        universe.link_document(db,data["document"],data["memory"])
                except sqlite3.IntegrityError:
                    return self.reply(400,{"error":"Unknown endpoint"})
                return self.reply(201,{"ok":True})
            if self.path == "/api/links":
                try:
                    add_link(data["source"], data["target"])
                except sqlite3.IntegrityError:
                    return self.reply(400, {"error":"Unknown endpoint"})
                return self.reply(201, {"ok":True})
            category, label = data["category"], data["label"]
            if category not in CATEGORIES or not isinstance(label, str) or not 1 <= len(label.strip()) <= 200:
                raise ValueError()
        except cloudru.CloudError as error:
            return self.reply(502, {"error": str(error)})
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
    with connect() as db:
        universe.scan(db,DOCUMENTS)
    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        url = f"http://127.0.0.1:{server.server_port}"
        print(url, flush=True)
        if not args.no_browser:
            webbrowser.open(url)
        server.serve_forever()
