"""Offline startup and diagnostics using the Python standard library."""
import argparse
import datetime
import runpy
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    log = ROOT / "logs" / "startup.log"
    try:
        log.parent.mkdir(parents=True, exist_ok=True)
        with log.open("w", encoding="utf-8") as f:
            f.write(f"{datetime.datetime.now().isoformat()} Python {sys.version}\n")
        for name in ("server.py", "web/index.html", "web/style.css", "web/universe.js", "web/chat.js", "web/cloud-settings.js", "cloudru.py", "map_chat.py", "web/universe.css", "universe.py"):
            if not (ROOT / name).is_file():
                raise FileNotFoundError(f"Missing {name}. Extract the complete project archive.")
        import server
        server.init()
        if args.check:
            print("Startup check OK: frontend, Python, SQLite.")
            return 0
        print("Starting Amatsukiyora. Keep this window open.", flush=True)
        sys.argv = [str(ROOT / "server.py")]
        runpy.run_path(str(ROOT / "server.py"), run_name="__main__")
        return 0
    except KeyboardInterrupt:
        return 0
    except Exception:
        message = traceback.format_exc()
        print(message, file=sys.stderr)
        try:
            with log.open("a", encoding="utf-8") as f:
                f.write(message)
        except OSError:
            pass
        return 1

if __name__ == "__main__":
    sys.exit(main())
