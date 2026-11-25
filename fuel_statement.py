"""Import the Excel 97–2003 fuel-card statement supplied by Айти."""
import hashlib
import json
import re
import struct
import sys
from collections import Counter
from datetime import datetime, time
from decimal import Decimal, InvalidOperation
from pathlib import Path

XLRD = Path(__file__).resolve().parent / "vendor" / "xlrd-2.0.2-py2.py3-none-any.whl"
sys.path.insert(0, str(XLRD))
try:
    import xlrd
finally:
    sys.path.remove(str(XLRD))

MAX_SIZE = 8 * 1024 * 1024
HEADERS = ("операция", "дата", "время", "азс", "топливо", "цена", "кол-во", "сумма")
CARD = re.compile(r"^карта\s*№\s*([0-9A-Z ]+?)(?:\s+авто\s*:|\s*$)", re.IGNORECASE)
OPERATIONS = {"отгрузка": "Отгрузка", "возврат": "Возврат"}


def clean(value):
    return " ".join(str(value).split())


def decimal(value, precision):
    result = Decimal(clean(value).replace(" ", "").replace(",", "."))
    if not result.is_finite() or abs(result) > 100_000_000:
        raise ValueError("число вне допустимого диапазона")
    rounded = result.quantize(Decimal(precision))
    if abs(result - rounded) > Decimal("0.000000001"):
        raise ValueError("слишком много знаков после запятой")
    return rounded


def when(day_cell, time_cell, datemode):
    if day_cell.ctype == xlrd.XL_CELL_DATE:
        day = xlrd.xldate_as_datetime(day_cell.value, datemode).date()
    else:
        day = datetime.strptime(clean(day_cell.value), "%d.%m.%Y").date()
    if time_cell.ctype == xlrd.XL_CELL_DATE or type(time_cell.value) is float and 0 <= time_cell.value < 1:
        hour = xlrd.xldate_as_datetime(time_cell.value, datemode).time()
    else:
        hour = time.fromisoformat(clean(time_cell.value))
    if hour.tzinfo is not None:
        raise ValueError("некорректное время")
    return day.isoformat(), hour.isoformat(timespec="seconds")


def parse(data):
    """Return canonical transaction rows. An invalid operation rejects the whole import."""
    if not data or len(data) > MAX_SIZE:
        raise ValueError("Размер выписки должен быть от 1 байта до 8 МиБ.")
    try:
        book = xlrd.open_workbook(file_contents=data, on_demand=True)
    except (xlrd.XLRDError, ValueError, EOFError, IndexError, OverflowError, struct.error, AssertionError) as error:
        raise ValueError("Не удалось открыть выписку Excel .xls.") from error

    result = []
    occurrence = Counter()
    try:
        for index in range(book.nsheets):
            sheet = book.sheet_by_index(index)
            if sheet.nrows > 50_000 or sheet.ncols > 256:
                raise ValueError("Выписка содержит слишком много строк или столбцов.")
            card = None
            columns = None
            for number, row in enumerate(sheet.get_rows(), 1):
                if not row:
                    continue
                lead = clean(row[0].value)
                key = lead.casefold()
                if key.startswith("карта") and "№" in key:
                    match = CARD.match(lead)
                    if not match:
                        raise ValueError(f"Строка {number}: не удалось определить номер топливной карты.")
                    card = match.group(1).replace(" ", "").upper()
                    if not 3 <= len(card) <= 32:
                        raise ValueError(f"Строка {number}: некорректный номер карты.")
                    columns = None
                    continue
                if key == "операция":
                    names = [clean(cell.value).casefold() for cell in row]
                    if not all(required in names for required in HEADERS):
                        raise ValueError(f"Строка {number}: не найдены все столбцы выписки.")
                    columns = [names.index(required) for required in HEADERS]
                    continue
                if key not in OPERATIONS:
                    if columns and key and len(row) > columns[1]:
                        date_cell = row[columns[1]]
                        if date_cell.ctype == xlrd.XL_CELL_DATE or re.fullmatch(r"\d{1,2}\.\d{1,2}\.\d{4}", clean(date_cell.value)):
                            raise ValueError(f"Строка {number}: неизвестный тип операции.")
                    continue
                if not card or not columns:
                    raise ValueError(f"Строка {number}: для операции не найдены карта и заголовок.")
                try:
                    _, date_cell, time_cell, station, fuel, price, quantity, amount = (row[col] for col in columns)
                    day, hour = when(date_cell, time_cell, book.datemode)
                    station, fuel = clean(station.value), clean(fuel.value)
                    price = decimal(price.value, ".01")
                    quantity = decimal(quantity.value, ".001")
                    amount = decimal(amount.value, ".01")
                    if key == "возврат":
                        quantity, amount = -abs(quantity), -abs(amount)
                    if not fuel or len(fuel) > 300 or len(station) > 500 or price < 0 or not quantity or (
                        key == "отгрузка" and (quantity < 0 or amount < 0)
                    ):
                        raise ValueError("некорректное количество, цена, сумма или топливо")
                except (IndexError, ValueError, TypeError, InvalidOperation) as error:
                    raise ValueError(f"Строка {number}: проверьте дату, время и данные заправки.") from error
                fields = (card, day, hour, OPERATIONS[key], station, fuel, str(price), str(quantity), str(amount))
                occurrence[fields] += 1
                fingerprint = hashlib.sha256(json.dumps((*fields, occurrence[fields]), ensure_ascii=False).encode()).hexdigest()
                result.append((fingerprint, card, day, hour, OPERATIONS[key], station, fuel,
                               float(price), float(quantity), int(amount * 100)))
    except (xlrd.XLRDError, EOFError, IndexError, OverflowError, struct.error, AssertionError) as error:
        raise ValueError("Не удалось прочитать строки выписки .xls.") from error
    finally:
        book.release_resources()
    if not result:
        raise ValueError("В выписке не найдены отгрузки или возвраты по топливным картам.")
    return result
