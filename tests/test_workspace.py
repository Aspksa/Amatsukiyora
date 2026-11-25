import io
import tempfile
import unittest
from zipfile import ZipFile
from pathlib import Path
from unittest.mock import patch

import document_disk
import server
import workplace
import work_reports


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


    def test_week_preserves_exceptions_and_report_uses_actual_consumption(self):
        with server.connect() as db:
            driver = workplace.save(db, {"kind": "employee", "name": "=1+1"})
            car = workplace.save(db, {"kind": "vehicle", "make": "ГАЗ", "model": "Next", "driver": driver,
                                      "summer": 12, "winter": 15})
            workplace.save(db, {"kind": "timesheet", "employee": driver, "day": "2026-10-06", "status": "Отпуск", "hours": 0})
            filled = workplace.schedule(db, {"employee": driver, "start": "2026-10-05", "end": "2026-10-11", "hours": 8})
            workplace.save(db, {"kind": "fuel", "vehicle": car, "day": "2026-10-05", "material": "Дизель", "unit": "л",
                                "quantity": 120, "price": 65})
            workplace.measure(db, {"vehicle": car, "month": "2026-10", "km": 500, "diesel": 70, "petrol": 0, "season": "Лето"})
            data = workplace.read(db, "2026-10")
        self.assertEqual(filled, {"added": 4, "skipped": 1})
        self.assertEqual(next(row["status"] for row in data["timesheet"] if row["day"] == "2026-10-06"), "Отпуск")
        row = data["fleet"][0]["row"]
        self.assertEqual((row[3], row[10], row[12], row[14], row[15], row[16]), (120, 70, 14, 12, 60, 10))
        with ZipFile(io.BytesIO(work_reports.excel([row]))) as archive:
            sheet = archive.read("xl/worksheets/sheet1.xml").decode()
            self.assertIn('r="C2" t="inlineStr"', sheet)
            self.assertIn("=1+1", sheet)
            self.assertNotIn("<f>", sheet)
