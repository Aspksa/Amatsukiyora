"""Local conversation storage and automatic routing for the map chat."""
import heapq
import json
import re
from pathlib import PurePosixPath

import cloudru
import universe

STOP_WORDS = set(
    "а без бы был была были быть в вам вас во вот все всего вы где да для до его еще есть же за и из или их к как какая какие какой когда кто ли мне может мои моих мой мы на над не него нет но о об он она они от по под про при с со так там то тут у уже чем что это этой этим этих эту этом практически мои найди покажи поиск заметки заметок документы документов записи записей объясни расскажи собери главное связан связано связанные связаны тема теме тему упоминается".split()
)
SEARCH = re.compile(r"^(?:(?:найди(?:те)?|покажи(?:те)?|поищи(?:те)?)(?:\s|$)|поиск:\s*)", re.I)
RELATED = re.compile(r"связ(?:ан|и)|сосед", re.I)
FOLLOW_UP = re.compile(r"\b(?:этим|этом|этой|этого|этих|здесь|ней|ним|нему|ними)\b|(?:расскажи|объясни) подробнее", re.I)


def init(db):
    db.executescript("""
        CREATE TABLE IF NOT EXISTS chat_sessions (
            id INTEGER PRIMARY KEY, title TEXT NOT NULL DEFAULT '', touched INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS chat_turns (
            id INTEGER PRIMARY KEY, session INTEGER NOT NULL REFERENCES chat_sessions(id),
            prompt TEXT NOT NULL, reply TEXT, mode TEXT, sources TEXT NOT NULL DEFAULT '[]'
        );
        CREATE INDEX IF NOT EXISTS chat_turns_session ON chat_turns(session,id);
        CREATE TABLE IF NOT EXISTS chat_preferences (
            id INTEGER PRIMARY KEY CHECK(id=1), active INTEGER REFERENCES chat_sessions(id),
            view TEXT NOT NULL DEFAULT 'null', folders TEXT NOT NULL DEFAULT '[]'
        );
        INSERT OR IGNORE INTO chat_preferences(id) VALUES (1);
    """)


def document_folders(db):
    """Return paths in the document catalogue, including intermediate folders."""
    folders = set()
    for (path,) in db.execute("SELECT path FROM documents WHERE present=1"):
        folders.update(str(parent) for parent in PurePosixPath(path).parents)
    allowed = json.loads(db.execute("SELECT folders FROM chat_preferences WHERE id=1").fetchone()[0])
    # Keep a configured folder visible even when it is temporarily empty.
    return {"folders": sorted(folders.union(allowed)), "allowed": allowed}


def view_state(value):
    if not isinstance(value, dict):
        raise ValueError("Invalid view")
    scale, x, y = (value.get(k) for k in ("scale", "x", "y"))
    if not all(type(v) in (int, float) and -100000 <= v <= 100000 for v in (scale, x, y)):
        raise ValueError("Invalid view")
    if not .65 <= scale <= 8:
        raise ValueError("Invalid scale")
    focus = value.get("focus")
    ids = [value.get(k, 0) for k in ("after", "chosen")]
    if focus is not None:
        if not isinstance(focus, dict) or focus.get("name") not in universe.GROUPS:
            raise ValueError("Invalid focus")
        start, end = focus.get("start"), focus.get("end")
        ids.extend((start, end))
    if not all(type(i) is int and 0 <= i < 2**53 for i in ids):
        raise ValueError("Invalid view IDs")
    if focus is not None and not 1 <= start <= end:
        raise ValueError("Invalid focus range")
    history = value.get("history", [])
    if not isinstance(history, list) or not all(type(i) is int and 0 <= i < 2**53 for i in history):
        raise ValueError("Invalid page history")
    state = {k: value.get(k) for k in ("scale", "x", "y", "focus")}
    return dict(state, after=ids[0], chosen=ids[1], history=history[-100:])


def conversations(db, session=None, turn=None):
    active, view = db.execute("SELECT active,view FROM chat_preferences WHERE id=1").fetchone()
    active = session if session is not None else active
    sessions = [{"id": i, "title": t or "Новый чат"} for i, t in db.execute(
        "SELECT id,title FROM chat_sessions ORDER BY touched DESC,id DESC"
    )]
    rows = db.execute("""SELECT prompt,reply,mode,sources FROM chat_turns WHERE session=?
        AND id=COALESCE(?,id) ORDER BY id""", (active, turn))
    turns = [{"prompt": p, "reply": r, "mode": m, "sources": json.loads(s)} for p, r, m, s in rows]
    return {"active": active, "view": json.loads(view), "sessions": sessions, "turns": turns}


def update_preferences(db, data):
    action = data.get("action")
    if action == "view":
        db.execute("UPDATE chat_preferences SET view=? WHERE id=1", (json.dumps(view_state(data.get("view"))),))
        return {"ok": True}
    if action == "folders":
        folders = data.get("folders")
        if not isinstance(folders, list) or not all(isinstance(v, str) for v in folders):
            raise ValueError("Invalid folders")
        if not set(folders).issubset(document_folders(db)["folders"]):
            raise ValueError("Unknown folder")
        db.execute("UPDATE chat_preferences SET folders=? WHERE id=1", (json.dumps(sorted(set(folders))),))
        return document_folders(db)
    if action == "new":
        session = db.execute("INSERT INTO chat_sessions DEFAULT VALUES").lastrowid
    elif action == "open":
        session = data.get("session")
        if type(session) is not int or not 0 < session < 2**53 or not db.execute(
            "SELECT 1 FROM chat_sessions WHERE id=?", (session,)
        ).fetchone():
            raise ValueError("Unknown chat")
    else:
        raise ValueError("Invalid action")
    db.execute("UPDATE chat_preferences SET active=? WHERE id=1", (session,))
    return conversations(db)


def selection(db, data):
    if data is None:
        return None
    if not isinstance(data, dict) or data.get("group") not in universe.GROUPS:
        raise ValueError("Invalid selection")
    group, ident = data["group"], data.get("id")
    if type(ident) is not int or not 0 < ident < 2**53:
        raise ValueError("Invalid selection ID")
    if group == "Документы":
        row = db.execute("SELECT path FROM documents WHERE id=? AND present=1", (ident,)).fetchone()
    else:
        row = db.execute("SELECT label FROM memory WHERE id=? AND category=?", (ident, group)).fetchone()
    return {"id": ident, "group": group, "label": row[0]} if row else None


def neighbors(db, node):
    if not node:
        return []
    ident = node["id"]
    if node["group"] == "Документы":
        rows = db.execute("""SELECT m.id,m.category,m.label FROM document_links l
            JOIN memory m ON m.id=l.memory WHERE l.document=? ORDER BY m.id LIMIT 12""", (ident,))
    else:
        rows = db.execute("""SELECT m.id,m.category,m.label FROM memory_links l JOIN memory m
            ON m.id=CASE WHEN l.source=? THEN l.target ELSE l.source END
            WHERE l.source=? OR l.target=?
            UNION ALL SELECT d.id,'Документы',d.path FROM document_links l
            JOIN documents d ON d.id=l.document WHERE l.memory=? AND d.present=1
            LIMIT 12""", (ident, ident, ident, ident))
    return [{"id": i, "group": g, "label": label} for i, g, label in rows]


def search(db, prompt, selected=None, previous=""):
    phrase = SEARCH.sub("", prompt).strip(" «»\"?.!:")
    query = " ".join((phrase, selected["label"] if selected else "", previous)).casefold()
    terms = list(dict.fromkeys(t for t in re.findall(r"\w{3,}", query) if t not in STOP_WORDS))[:16]
    # Longer words also match common inflections such as «орбиты» and «орбитах».
    terms = [t[:-2] if len(t) >= 6 and re.search(r"[а-яё]", t) else t for t in terms]
    if not terms:
        return universe.chat_search(db, phrase[:200]) if phrase else []

    def ranked_rows():
        rows = db.execute("""SELECT id,category,label,'' FROM memory
            UNION ALL SELECT id,'Документы',path,text_content FROM documents WHERE present=1""")
        for ident, group, label, content in rows:
            name, body = label.casefold(), content.casefold()
            hits = [body.find(term) for term in terms]
            offsets = [offset for offset in hits if offset >= 0]
            score = 5 * sum(term in name for term in terms) + 2 * len(offsets)
            if phrase and phrase.casefold() in name:
                score += 8
            if not score:
                continue
            match = {"id": ident, "group": group, "label": label}
            if content:
                offset = min(offsets, default=0)
                if len(body) != len(content):
                    position = 0
                    for index, character in enumerate(content):
                        position += len(character.casefold())
                        if position > offset:
                            offset = index
                            break
                start, end = max(0, offset - 75), offset + 250
                match["excerpt"] = " ".join(content[start:end].split())
            yield score, match
    return [match for _, match in heapq.nlargest(8, ranked_rows(), key=lambda row: row[0])]


def local_answer(db, prompt, selected):
    text = prompt.casefold().strip(" ?!.")
    overview = None
    if re.search(r"\bсколько\b", text) or text in ("обзор", "статистика", "что на карте", "где больше всего связей", "связи", "документы"):
        overview = universe.overview(db)
    if overview:
        if "документ" in text and ("запис" not in text and "связ" not in text):
            return f"Документов: {overview['documents']}. Поиск по тексту доступен для {overview['indexed']}.", []
        if "связ" in text and not (selected and FOLLOW_UP.search(text)):
            top = max(overview["routes"], key=lambda row: row["count"], default=None)
            extra = f"\nБольше всего: {top['source']} ↔ {top['target']} · {top['count']}." if top else ""
            return f"Связей на карте: {overview['links']}." + extra, []
        if re.search(r"запис|на карте|^обзор$|^статистика$", text):
            return f"Записи: {overview['memory']}\nДокументы: {overview['documents']}\nСвязи: {overview['links']}", []
    explicit = re.match(r"^(?:связи (?:узла|записи)|что с этим связано)", text)
    if explicit or (selected and RELATED.search(text) and (FOLLOW_UP.search(text) or text in ("связи", "соседи"))):
        if not selected:
            return "Выберите узел на карте, чтобы посмотреть его связи.", []
        sources = neighbors(db, selected)
        return (f"Связи узла «{selected['label']}»." if sources else "У выбранного узла нет связей."), sources
    return None


def permitted_source(source, folders):
    if source["group"] != "Документы":
        return True
    path = PurePosixPath(source["label"])
    return any(str(parent) in folders for parent in path.parents)


def answer(connect, credentials, data):
    prompt = data.get("prompt")
    if not isinstance(prompt, str) or not 1 <= len(prompt.strip()) <= 2000:
        raise ValueError("Invalid prompt")
    prompt = prompt.strip()
    active = data.get("session")
    if active is not None and (type(active) is not int or not 0 < active < 2**53):
        raise ValueError("Invalid chat session")
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        selected = selection(db, data.get("selection"))
        if active is None:
            active = db.execute("INSERT INTO chat_sessions DEFAULT VALUES").lastrowid
        elif not db.execute("SELECT 1 FROM chat_sessions WHERE id=?", (active,)).fetchone():
            raise ValueError("Unknown chat")
        previous = db.execute("""SELECT prompt,reply,mode FROM chat_turns WHERE session=? AND reply IS NOT NULL
            ORDER BY id DESC LIMIT 4""", (active,)).fetchall()
        turn = db.execute("INSERT INTO chat_turns(session,prompt) VALUES (?,?)", (active, prompt)).lastrowid
        db.execute("UPDATE chat_sessions SET title=CASE WHEN title='' THEN ? ELSE title END,touched=? WHERE id=?",
                   (prompt[:80], turn, active))
        db.execute("UPDATE chat_preferences SET active=? WHERE id=1", (active,))

    with connect() as db:
        local = local_answer(db, prompt, selected)
        folders = set(json.loads(db.execute("SELECT folders FROM chat_preferences WHERE id=1").fetchone()[0]))
        if local:
            reply, sources = local
        else:
            earlier = previous[0][0] if not selected and previous and FOLLOW_UP.search(prompt) else ""
            sources = search(db, prompt, selected, earlier)
            if selected and not SEARCH.match(prompt):
                candidates = [selected, *neighbors(db, selected), *sources]
                unique = {}
                for source in candidates:
                    key = source["group"], source["id"]
                    if key not in unique or source.get("excerpt"):
                        unique[key] = source
                sources = list(unique.values())[:8]
            reply = f"Совпадения на карте для «{prompt}»." if sources else "Совпадений на карте нет. Попробуйте название или короткую фразу."

    mode = "local"
    key, model = credentials() if not local and not SEARCH.match(prompt) else ("", "")
    shared = [source for source in sources if permitted_source(source, folders)][:6]
    requested_documents = bool(
        re.search(r"\b(?:моих|мои|этих|эти|своих|наших)\s+(?:документ|файл|замет)", prompt, re.I)
        or (selected and selected["group"] == "Документы" and FOLLOW_UP.search(prompt))
    )
    documents_found = any(source["group"] == "Документы" for source in sources)
    documents_shared = any(source["group"] == "Документы" for source in shared)
    if key and model and requested_documents and documents_found and not documents_shared:
        reply += "\nДля ответа по этим документам разрешите их папки в настройках Cloud.ru."
    elif key and model:
        with connect() as db:
            for source in shared:
                if source["group"] == "Документы" and not source.get("excerpt"):
                    row = db.execute("SELECT substr(text_content,1,350) FROM documents WHERE id=? AND present=1 AND indexed=1",
                                     (source["id"],)).fetchone()
                    if row and row[0].strip():
                        source["excerpt"] = " ".join(row[0].split())
        refs = [{"number": i, "group": s["group"], "name": s["label"][:400], "excerpt": s.get("excerpt", "")[:350]}
                for i, s in enumerate(shared, 1)]
        # Only plain cloud turns may be replayed. Previous snippets stay out of history replay.
        messages = []
        for old_prompt, old_reply, old_mode in reversed(previous):
            if old_mode == "cloud":
                messages += [{"role": "user", "content": old_prompt}, {"role": "assistant", "content": old_reply[:2000]}]
        messages.append({"role": "user", "content": prompt})
        context = "Источники: " + json.dumps(refs, ensure_ascii=False) if refs else ""
        try:
            try:
                reply = cloudru.chat(key, model, messages, context)
            except cloudru.TransientCloudError:
                # Refresh credentials and folder permissions before sending private data again.
                with connect() as db:
                    current = set(json.loads(db.execute("SELECT folders FROM chat_preferences WHERE id=1").fetchone()[0]))
                if credentials() != (key, model) or any(not permitted_source(source, current) for source in shared):
                    raise cloudru.CloudError("Настройки Cloud.ru изменились.")
                reply = cloudru.chat(key, model, messages, context)
            mode = "grounded" if refs else "cloud"
            used = {int(i) for i in re.findall(r"\[([1-6])\]", reply)}
            sources = [dict(source, citation=i) for i, source in enumerate(shared, 1) if i in used]
        except cloudru.CloudError as error:
            reply = f"{error}\n{reply}" if sources else f"{error}\nВопрос сохранён в истории."
            mode = "fallback"

    with connect() as db:
        db.execute("UPDATE chat_turns SET reply=?,mode=?,sources=? WHERE id=?",
                   (reply, mode, json.dumps(sources, ensure_ascii=False), turn))
        return conversations(db, session=active, turn=turn)
