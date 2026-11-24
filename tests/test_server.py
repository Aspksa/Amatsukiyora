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

    def test_links(self):
        old = server.DB
        try:
            with tempfile.TemporaryDirectory() as folder:
                server.DB = Path(folder) / "memory.db"
                server.init()
                with server.connect() as db:
                    db.execute("INSERT INTO memory(id,category,label) VALUES (1,'Знания','A'),(2,'Опыт','B')")
                server.add_link(2, 1)
                server.add_link(1, 2)
                with server.connect() as db:
                    self.assertEqual(db.execute("SELECT source,target FROM memory_links").fetchall(), [(1,2)])
                with self.assertRaises(ValueError):
                    server.add_link(1, 1)
                import sqlite3
                with self.assertRaises(sqlite3.IntegrityError):
                    server.add_link(1, 99)
        finally:
            server.DB = old
