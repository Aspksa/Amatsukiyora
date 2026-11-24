"""SQLite-backed overview, document catalogue and paged universe details."""
from pathlib import Path
import os
import sqlite3

GROUPS = ("Знания", "Навыки", "Опыт", "Личность", "Документы")
TEXT_EXTENSIONS = {".txt", ".md", ".csv", ".json", ".log"}
FILE_EXTENSIONS = TEXT_EXTENSIONS | {".pdf", ".docx", ".xlsx", ".pptx", ".rtf", ".odt", ".html"}
PAGE_SIZE = 80

def init(db):
    db.execute("CREATE INDEX IF NOT EXISTS memory_category_id ON memory(category,id)")
    db.execute("CREATE INDEX IF NOT EXISTS memory_links_target ON memory_links(target)")
    db.execute("""CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, size INTEGER NOT NULL,
        mtime INTEGER NOT NULL, present INTEGER NOT NULL DEFAULT 1,
        text_content TEXT NOT NULL DEFAULT '', indexed INTEGER NOT NULL DEFAULT 0)""")
    db.execute("""CREATE TABLE IF NOT EXISTS document_links (
        document INTEGER NOT NULL REFERENCES documents(id),
        memory INTEGER NOT NULL REFERENCES memory(id),
        PRIMARY KEY(document,memory))""")
    db.execute("CREATE INDEX IF NOT EXISTS document_links_memory ON document_links(memory)")

def scan(db, root):
    """Register local documents without following symlinks. Preserve IDs and links."""
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    if root.is_symlink():
        raise ValueError("Document root must not be a symlink")
    root = root.resolve()
    seen = set()
    errors = []
    for folder, dirs, names in os.walk(root, followlinks=False, onerror=errors.append):
        dirs[:] = [d for d in dirs if not (Path(folder)/d).is_symlink() and (Path(folder)/d).resolve().is_relative_to(root)]
        for name in names:
            p = Path(folder)/name
            if p.suffix.lower() not in FILE_EXTENSIONS or p.is_symlink():
                continue
            try:
                if not p.resolve().is_relative_to(root) or not p.is_file():
                    continue
                stat = p.stat()
                rel = p.relative_to(root).as_posix()
                seen.add(rel)
                old = db.execute("SELECT size,mtime,indexed FROM documents WHERE path=?", (rel,)).fetchone()
                if old and old[0] == stat.st_size and old[1] == stat.st_mtime_ns and (old[2] or p.suffix.lower() not in TEXT_EXTENSIONS):
                    db.execute("UPDATE documents SET present=1 WHERE path=?", (rel,))
                    continue
                text, indexed = "", 0
                if p.suffix.lower() in TEXT_EXTENSIONS:
                    with p.open("rb") as stream:
                        raw = stream.read(131072)
                    text, indexed = raw.decode("utf-8-sig", errors="replace"), 1
                db.execute("""INSERT INTO documents(path,size,mtime,text_content,indexed,present)
                    VALUES (?,?,?,?,?,1) ON CONFLICT(path) DO UPDATE SET
                    size=excluded.size,mtime=excluded.mtime,text_content=excluded.text_content,
                    indexed=excluded.indexed,present=1""", (rel,stat.st_size,stat.st_mtime_ns,text,indexed))
            except OSError as exc:
                errors.append(exc)
    # A partial scan must not mark unseen files as deleted.
    if not errors:
        db.executemany("UPDATE documents SET present=0 WHERE path=?",
            [(p,) for (p,) in db.execute("SELECT path FROM documents WHERE present=1") if p not in seen])
    return {"seen":len(seen), "errors":len(errors)}

def overview(db):
    counts = dict(db.execute("SELECT category,COUNT(*) FROM memory GROUP BY category"))
    docs, indexed = db.execute("SELECT COUNT(*),COALESCE(SUM(indexed),0) FROM documents WHERE present=1").fetchone()
    groups = []
    for name in GROUPS:
        is_doc = name == "Документы"
        count = docs if is_doc else counts.get(name,0)
        table, clause, args = ("documents","present=1",()) if is_doc else ("memory","category=?",(name,))
        maximum = db.execute(f"SELECT COALESCE(MAX(id),0) FROM {table} WHERE {clause}",args).fetchone()[0]
        width = 1
        while maximum > width * 16:
            width *= 2
        bins = [{"start":bucket*width+1,"end":(bucket+1)*width,"count":n}
                for bucket,n in db.execute(f"SELECT (id-1)/?,COUNT(*) FROM {table} WHERE {clause} GROUP BY 1 ORDER BY 1",(width,*args))]
        groups.append({"name":name,"count":count,"bins":bins})
    pairs = []
    for a,b,n in db.execute("""SELECT min(a.category,b.category),max(a.category,b.category),COUNT(*)
        FROM memory_links l JOIN memory a ON a.id=l.source JOIN memory b ON b.id=l.target GROUP BY 1,2"""):
        pairs.append({"source":a,"target":b,"count":n})
    for cat,n in db.execute("""SELECT m.category,COUNT(*) FROM document_links l JOIN memory m ON m.id=l.memory
        JOIN documents d ON d.id=l.document WHERE d.present=1 GROUP BY m.category"""):
        pairs.append({"source":"Документы","target":cat,"count":n})
    return {"memory":sum(counts.values()),"documents":docs,"indexed":indexed,"groups":groups,
            "links":sum(p["count"] for p in pairs),"routes":pairs}

def page(db, group, after=0, start=1, end=None):
    if group not in GROUPS or not 0 <= after <= 2**53-1 or not 1 <= start <= 2**53-1:
        raise ValueError("Invalid page")
    if end is None: end = 2**53-1
    if not start <= end <= 2**53-1: raise ValueError("Invalid range")
    is_doc = group == "Документы"
    if is_doc:
        rows = db.execute("SELECT id,path,size,indexed FROM documents WHERE present=1 AND id>? AND id BETWEEN ? AND ? ORDER BY id LIMIT ?",(after,start,end,PAGE_SIZE+1)).fetchall()
        items = [{"id":r[0],"label":r[1],"size":r[2],"indexed":bool(r[3])} for r in rows[:PAGE_SIZE]]
    else:
        rows = db.execute("SELECT id,label FROM memory WHERE category=? AND id>? AND id BETWEEN ? AND ? ORDER BY id LIMIT ?",(group,after,start,end,PAGE_SIZE+1)).fetchall()
        items = [{"id":r[0],"label":r[1]} for r in rows[:PAGE_SIZE]]
    ids = [x["id"] for x in items]
    links = []
    external = []
    if ids:
        slots = ",".join("?" for _ in ids)
        if is_doc:
            sql = f"""SELECT l.document,m.category,COUNT(*) FROM document_links l JOIN memory m ON m.id=l.memory
                WHERE l.document IN ({slots}) GROUP BY 1,2"""
            external = [{"id":i,"group":g,"count":n} for i,g,n in db.execute(sql,ids)]
        else:
            sql = f"SELECT source,target FROM memory_links WHERE source IN ({slots}) AND target IN ({slots})"
            links = [{"source":a,"target":b} for a,b in db.execute(sql,ids+ids)]
            sql = f"""SELECT endpoint,category,COUNT(*) FROM (
                SELECT l.source endpoint,m.category FROM memory_links l JOIN memory m ON m.id=l.target WHERE l.source IN ({slots})
                UNION ALL SELECT l.target,m.category FROM memory_links l JOIN memory m ON m.id=l.source WHERE l.target IN ({slots})
                UNION ALL SELECT l.memory,'Документы' FROM document_links l JOIN documents d ON d.id=l.document
                    WHERE d.present=1 AND l.memory IN ({slots})) GROUP BY 1,2"""
            external = [{"id":i,"group":g,"count":n} for i,g,n in db.execute(sql,ids*3)]
    return {"group":group,"items":items,"links":links,"external":external,
            "next":items[-1]["id"] if len(rows)>PAGE_SIZE else None}

def link_document(db, document, memory):
    if type(document) is not int or type(memory) is not int or not (0<document<=2**53-1 and 0<memory<=2**53-1):
        raise ValueError("Invalid document link")
    db.execute("INSERT OR IGNORE INTO document_links(document,memory) VALUES (?,?)",(document,memory))

def search_documents(db, text):
    if not isinstance(text,str) or not 1<=len(text.strip())<=200:
        raise ValueError("Invalid search")
    # Literal local search over the indexed prefix, not semantic search.
    db.create_function("casefold",1,lambda value: value.casefold(),deterministic=True)
    return [{"id":i,"label":p} for i,p in db.execute(
        "SELECT id,path FROM documents WHERE present=1 AND indexed=1 AND instr(casefold(text_content),casefold(?))>0 ORDER BY id LIMIT 80",(text.strip(),))]
