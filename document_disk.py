"""Local browsing and uploads under the configured documents folder."""
import os
import re
import tempfile
from pathlib import Path

UPLOAD_LIMIT = 32 * 1024 * 1024
UPLOAD_PREFIX = ".amatsukiyora-upload-"
WINDOWS_NAMES = re.compile(r"^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])$", re.I)


def name(value):
    if (not isinstance(value, str) or not 1 <= len(value) <= 240
            or value in (".", "..") or value.endswith((" ", "."))
            or value.startswith(UPLOAD_PREFIX)
            or re.search(r'[<>:"/\\|?*\x00-\x1f]', value)
            or WINDOWS_NAMES.fullmatch(value.split(".", 1)[0])):
        raise ValueError("Недопустимое имя файла или папки.")
    return value


def path_under(root, relative):
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    if root.is_symlink():
        raise ValueError("Папка документов должна быть локальным каталогом.")
    root = root.resolve()
    if not isinstance(relative, str) or len(relative) > 4096:
        raise ValueError("Недопустимый путь.")
    path = root
    for part in relative.split("/") if relative else ():
        path /= name(part)
        if path.is_symlink() or not path.resolve().is_relative_to(root):
            raise ValueError("Этот путь недоступен.")
    return root, path


def entry(path, root):
    stat = path.stat()
    folder = path.is_dir()
    return {"name": path.name, "path": path.relative_to(root).as_posix(),
            "folder": folder, "size": 0 if folder else stat.st_size, "modified": stat.st_mtime}


def browse(root, folder, query):
    root, current = path_under(root, folder)
    if not current.is_dir():
        raise FileNotFoundError()
    query = query.strip().casefold()
    if len(query) > 200:
        raise ValueError("Поисковая строка слишком длинная.")
    if query:
        def matches():
            for base, dirs, files in os.walk(current, followlinks=False):
                parent = Path(base)
                dirs[:] = sorted(d for d in dirs if visible(parent / d, root))
                for item in sorted(dirs + files):
                    path = parent / item
                    if query in item.casefold() and visible(path, root):
                        yield path
        candidates = matches()
    else:
        candidates = (path for path in current.iterdir() if visible(path, root))
    rows = []
    for path in candidates:
        try:
            rows.append(entry(path, root))
        except FileNotFoundError:
            continue
        if query and len(rows) == 501:
            break
    return {"items": sorted(rows[:500] if query else rows, key=lambda row: (not row["folder"], row["name"].casefold())),
            "truncated": len(rows) > 500 if query else False}


def visible(path, root):
    try:
        name(path.name)
        return not path.is_symlink() and path.resolve().is_relative_to(root) and (path.is_dir() or path.is_file())
    except (ValueError, OSError):
        return False


def folder_create(root, folder, title):
    _, parent = path_under(root, folder)
    (parent / name(title)).mkdir()


def upload(root, folder, title, stream, length):
    _, parent = path_under(root, folder)
    destination = parent / name(title)
    if not 0 <= length <= UPLOAD_LIMIT:
        raise ValueError("Размер файла превышает 32 МиБ.")
    with tempfile.NamedTemporaryFile(dir=parent, prefix=UPLOAD_PREFIX, delete=False) as temp:
        temporary = Path(temp.name)
        try:
            remaining = length
            while remaining:
                block = stream.read(min(remaining, 64 * 1024))
                if not block:
                    raise ValueError("Загрузка файла прервана.")
                temp.write(block)
                remaining -= len(block)
            temp.close()
            # Reserve the name exclusively so an existing file is never overwritten.
            with destination.open("xb"):
                pass
            try:
                os.replace(temporary, destination)
            except OSError:
                destination.unlink()
                raise
        finally:
            temp.close()
            temporary.unlink(missing_ok=True)


def inline_type(suffix, prefix):
    if suffix == ".pdf" and prefix.startswith(b"%PDF-"):
        return "application/pdf"
    if suffix == ".png" and prefix.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if suffix in (".jpg", ".jpeg") and prefix.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if suffix == ".gif" and prefix.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if suffix == ".webp" and prefix.startswith(b"RIFF") and prefix[8:12] == b"WEBP":
        return "image/webp"
    return None
