import tempfile
import unittest
from pathlib import Path
import server

class DatabaseTest(unittest.TestCase):
    def test_persistence(self):
        old = server.DB
        try:
            with tempfile.TemporaryDirectory() as folder:
                server.DB = Path(folder) / "memory.db"
                server.init()
                with server.connect() as db:
                    db.execute("INSERT INTO memory(category,label) VALUES (?,?)", ("Знания", "Тест"))
                with server.connect() as db:
                    self.assertEqual(db.execute("SELECT label FROM memory").fetchone()[0], "Тест")
        finally:
            server.DB = old
