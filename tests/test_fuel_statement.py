import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import fuel_statement
import server
import workplace


def fake_book(lines):
    class Sheet:
        nrows = len(lines)
        ncols = max(map(len, lines))

        def get_rows(self):
            for line in lines:
                yield [SimpleNamespace(ctype=1 if isinstance(value, str) else 2, value=value) for value in line]

    return SimpleNamespace(nsheets=1, datemode=0, sheet_by_index=lambda _: Sheet(), release_resources=lambda: None)


class FuelStatementTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        database = patch.object(server, "DB", Path(directory.name) / "memory.db")
        database.start()
        self.addCleanup(database.stop)
        server.init()

    def test_group_import_returns_duplicate_operations_and_later_matching(self):
        header = ["Операция", "Дата", "Время", "АЗС", "Топливо", "Цена", "Кол-во", "Сумма"]
        stock = ["Отгрузка", "03.10.2026", "09:30:04", "АЗС 9", "Дизель", 71.25, 50, 3562.5]
        refund = ["Возврат", "03.10.2026", "10:30:04", "АЗС 9", "Дизель", 71.25, -5, -356.25]
        lines = [["Карта № 000046        Авто:"], header, stock, stock, refund, ["Итого", "", "", "", "", "", 95, 6768.75]]
        with patch.object(fuel_statement.xlrd, "open_workbook", return_value=fake_book(lines)):
            records = fuel_statement.parse(b"fixture")
        self.assertEqual(len({row[0] for row in records}), 3)
        with server.connect() as db:
            self.assertEqual(workplace.import_statement(db, records, "выписка.xls")["added"], 3)
            self.assertEqual(workplace.import_statement(db, records, "копия.xls")["duplicates"], 3)
            self.assertTrue(all(row["vehicle"] is None for row in workplace.read(db, "2026-10")["fuel"]))
            vehicle = workplace.save(db, {"kind": "vehicle", "make": "ГАЗ", "model": "Next", "summer": 13, "winter": 15})
            workplace.save(db, {"kind": "employee", "name": "Тестовый водитель", "cards": ["000046"], "vehicles": [vehicle]})
            rows = workplace.read(db, "2026-10")["fuel"]
        self.assertEqual(len(rows), 3)
        self.assertEqual({row["vehicle"] for row in rows}, {vehicle})
        self.assertEqual(sum(row["quantity"] for row in rows), 95)
        self.assertEqual(sum(row["amount"] for row in rows), 6768.75)
        self.assertEqual({row["card"] for row in rows}, {"000046"})

    def test_invalid_file_is_reported_as_value_error(self):
        with self.assertRaisesRegex(ValueError, r"\.xls"):
            fuel_statement.parse(b"this is not Excel")
