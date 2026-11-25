import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import document_disk
import server
import workplace


class WorkspaceTest(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        database = patch.object(server, "DB", self.root / "memory.db")
        database.start()
        self.addCleanup(database.stop)
        server.init()

    def test_disk_never_overwrites_and_rejects_path_escape(self):
        root = self.root / "docs"
        document_disk.folder_create(root, "", "Атлас")
        document_disk.upload(root, "Атлас", "Орбита.txt", io.BytesIO(b"original"), 8)
        with self.assertRaises(FileExistsError):
            document_disk.upload(root, "Атлас", "Орбита.txt", io.BytesIO(b"new"), 3)
        with self.assertRaises(ValueError):
            document_disk.path_under(root, "../memory.db")
        with self.assertRaises(ValueError):
            document_disk.upload(root, "Атлас", "broken.txt", io.BytesIO(b"x"), 2)
        listing = document_disk.browse(root, "", "ОРБИТА")
        self.assertEqual([row["path"] for row in listing["items"]], ["Атлас/Орбита.txt"])
        self.assertEqual((root / "Атлас" / "Орбита.txt").read_bytes(), b"original")
        self.assertEqual(list((root / "Атлас").iterdir()), [root / "Атлас" / "Орбита.txt"])

    def test_assignments_are_atomic_and_monthly_records_persist(self):
        with server.connect() as db:
            car = workplace.save(db, {"kind": "vehicle", "make": "ГАЗ", "model": "Next", "summer": 10.5, "winter": 12})
            driver = workplace.save(db, {"kind": "employee", "name": "Иван", "cards": ["000 123"], "vehicles": [car]})
        with self.assertRaises(ValueError):
            with server.connect() as db:
                workplace.save(db, {"kind": "employee", "name": "Пётр", "cards": ["999"], "vehicles": [car]})
        with server.connect() as db:
            workplace.save(db, {"kind": "timesheet", "employee": driver, "day": "2026-11-03", "status": "Работа", "hours": 8})
            workplace.save(db, {"kind": "fuel", "vehicle": car, "day": "2026-11-03", "material": "Дизель", "unit": "л",
                                "quantity": 48, "price": 71.2, "card": "000123"})
        server.init()
        with server.connect() as db:
            november = workplace.read(db, "2026-11")
            october = workplace.read(db, "2026-10")
        self.assertEqual([row["name"] for row in november["employees"]], ["Иван"])
        self.assertEqual(november["vehicles"][0]["driver"], driver)
        self.assertEqual(november["cards"][0]["number"], "000123")
        self.assertEqual(november["timesheet"][0]["hours"], 8)
        self.assertEqual(november["fuel"][0]["quantity"], 48)
        self.assertFalse(october["timesheet"])
        self.assertFalse(october["fuel"])
