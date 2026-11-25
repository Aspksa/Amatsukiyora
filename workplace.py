"""SQLite registers for personnel, fleet, timesheets and fuel and lubricants."""
import math
import re
from datetime import date, timedelta

import work_reports

STATUSES = ("Работа", "Работа в выходной", "Выходной", "Отпуск", "Больничный", "Отсутствие")
WORK_DAYS = ('Работа', 'Работа в выходной')
UNITS = ("л", "кг")


def init(db):
    db.executescript("""
        CREATE TABLE IF NOT EXISTS work_employees (
            id INTEGER PRIMARY KEY, name TEXT NOT NULL, position TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS work_cards (
            number TEXT PRIMARY KEY, employee INTEGER NOT NULL REFERENCES work_employees(id)
        );
        CREATE TABLE IF NOT EXISTS work_vehicles (
            id INTEGER PRIMARY KEY, make TEXT NOT NULL, model TEXT NOT NULL, plate TEXT NOT NULL,
            driver INTEGER REFERENCES work_employees(id),
            summer REAL NOT NULL CHECK(summer>0), winter REAL NOT NULL CHECK(winter>0)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS work_vehicle_plate
            ON work_vehicles(plate) WHERE plate <> '';
        CREATE TABLE IF NOT EXISTS work_timesheet (
            id INTEGER PRIMARY KEY, employee INTEGER NOT NULL REFERENCES work_employees(id),
            day TEXT NOT NULL, status TEXT NOT NULL, hours REAL NOT NULL CHECK(hours BETWEEN 0 AND 24),
            UNIQUE(employee, day)
        );
        CREATE TABLE IF NOT EXISTS work_fuel (
            id INTEGER PRIMARY KEY, vehicle INTEGER NOT NULL REFERENCES work_vehicles(id),
            day TEXT NOT NULL, material TEXT NOT NULL, unit TEXT NOT NULL,
            quantity REAL NOT NULL CHECK(quantity>0), price REAL NOT NULL CHECK(price>=0),
            card TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS work_timesheet_day ON work_timesheet(day);
        CREATE INDEX IF NOT EXISTS work_fuel_day ON work_fuel(day);
        CREATE TABLE IF NOT EXISTS work_fuel_statement (
            id INTEGER PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE, card TEXT NOT NULL,
            day TEXT NOT NULL, hour TEXT NOT NULL, operation TEXT NOT NULL, station TEXT NOT NULL,
            material TEXT NOT NULL, price REAL NOT NULL, quantity REAL NOT NULL, amount_cents INTEGER NOT NULL,
            vehicle INTEGER REFERENCES work_vehicles(id), filename TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS work_fuel_statement_day ON work_fuel_statement(day);
        CREATE INDEX IF NOT EXISTS work_fuel_statement_card ON work_fuel_statement(card);
        CREATE TABLE IF NOT EXISTS work_fuel_import_runs (
            id INTEGER PRIMARY KEY, filename TEXT NOT NULL, created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            first_day TEXT NOT NULL, last_day TEXT NOT NULL, added INTEGER NOT NULL, duplicates INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS work_fuel_import_members (
            run INTEGER NOT NULL REFERENCES work_fuel_import_runs(id),
            operation INTEGER NOT NULL REFERENCES work_fuel_statement(id), PRIMARY KEY(run,operation)
        );
        CREATE INDEX IF NOT EXISTS work_fuel_member_operation ON work_fuel_import_members(operation);
        CREATE TABLE IF NOT EXISTS work_fuel_measurements (
            vehicle INTEGER NOT NULL REFERENCES work_vehicles(id), month TEXT NOT NULL,
            km REAL NOT NULL, diesel REAL NOT NULL, petrol REAL NOT NULL, season TEXT NOT NULL, norm REAL NOT NULL,
            PRIMARY KEY(vehicle,month)
        );
        CREATE TABLE IF NOT EXISTS work_fuel_card_vehicle (
            card TEXT PRIMARY KEY, vehicle INTEGER NOT NULL REFERENCES work_vehicles(id)
        );
    """)
    legacy = db.execute("""SELECT s.filename, MIN(s.day), MAX(s.day), COUNT(*)
        FROM work_fuel_statement s WHERE NOT EXISTS (
            SELECT 1 FROM work_fuel_import_members m WHERE m.operation=s.id)
        GROUP BY s.filename""").fetchall()
    for filename, first, last, count in legacy:
        run = db.execute("""INSERT INTO work_fuel_import_runs(filename,first_day,last_day,added,duplicates,created)
            VALUES (?,?,?,?,0,'')""", (filename,first,last,count)).lastrowid
        db.execute("""INSERT INTO work_fuel_import_members(run,operation)
            SELECT ?,s.id FROM work_fuel_statement s WHERE s.filename=? AND NOT EXISTS (
                SELECT 1 FROM work_fuel_import_members m WHERE m.operation=s.id)""", (run,filename))


def rows(db, query, *parameters):
    cursor = db.execute(query, parameters)
    keys = [column[0] for column in cursor.description]
    return [dict(zip(keys, row)) for row in cursor]


FUEL_ROWS = """SELECT id,vehicle,day,material,unit,quantity,price,card,
    ROUND(quantity*price,2) AS amount,'' AS operation,'' AS hour,'' AS station,'' AS filename, 0 AS imported
    FROM work_fuel WHERE {manual}
    UNION ALL SELECT id,vehicle,day,material,'л',quantity,price,card,
    amount_cents/100.0,operation,hour,station,filename,1
    FROM work_fuel_statement WHERE {statement} ORDER BY day DESC,hour DESC,id DESC"""


def validate_month(month):
    if not isinstance(month, str) or not re.fullmatch(r"\d{4}-\d{2}", month):
        raise ValueError("Укажите месяц.")
    date.fromisoformat(month + "-01")
    return month


def read(db, month, run=None):
    month = validate_month(month)
    data = {
        "employees": rows(db, "SELECT id,name,position FROM work_employees ORDER BY name,id"),
        "cards": rows(db, "SELECT number,employee FROM work_cards ORDER BY number"),
        "vehicles": rows(db, "SELECT id,make,model,plate,driver,summer,winter FROM work_vehicles ORDER BY make,model,id"),
        "timesheet": rows(db, "SELECT id,employee,day,status,hours FROM work_timesheet WHERE day LIKE ? ORDER BY day DESC,id DESC", month + "-%"),
        "fuel": rows(db, FUEL_ROWS.format(manual="day LIKE ?", statement="day LIKE ?"), month + "-%", month + "-%"),
        "cardVehicles": rows(db, "SELECT card,vehicle FROM work_fuel_card_vehicle ORDER BY card"),
        "measurements": rows(db, "SELECT vehicle,km,diesel,petrol,season,norm FROM work_fuel_measurements WHERE month=?", month),
        "runs": rows(db, """SELECT r.*, COUNT(CASE WHEN s.operation='Возврат' THEN 1 END) AS returns,
            COUNT(CASE WHEN s.id IS NOT NULL AND s.vehicle IS NULL THEN 1 END) AS unassigned
            FROM work_fuel_import_runs r LEFT JOIN work_fuel_import_members m ON m.run=r.id
            LEFT JOIN work_fuel_statement s ON s.id=m.operation GROUP BY r.id ORDER BY r.id DESC"""),
    }
    data["fleet"] = work_reports.fleet(data)
    if run is not None:
        data["runFuel"] = rows(db, FUEL_ROWS.format(manual="0", statement=
            "id IN(SELECT operation FROM work_fuel_import_members WHERE run=?)"), ident(run))
    return data


def recent_fuel(db, vehicle):
    return rows(db, FUEL_ROWS.format(manual="vehicle=?", statement="vehicle=?") + " LIMIT 6",
                ident(vehicle), vehicle)


def schedule(db, data):
    start, end = (date.fromisoformat(day(data.get(key))) for key in ("start", "end"))
    days = (end-start).days + 1
    if not 1 <= days <= 7:
        raise ValueError("Выберите от одного до семи дней.")
    hours = numeric(data.get("hours"), .01, 24, "Часы")
    employee_id = ident(data.get("employee"))
    added = 0
    skipped = 0
    for offset in range(days):
        current = start + timedelta(days=offset)
        weekend = current.weekday() >= 5
        if weekend and data.get("weekends") is not True:
            continue
        code = "Работа в выходной" if weekend else "Работа"
        cursor = db.execute("""INSERT INTO work_timesheet(employee,day,status,hours)
            VALUES (?,?,?,?) ON CONFLICT(employee,day) DO NOTHING""", (employee_id,current.isoformat(),code,hours))
        added += cursor.rowcount
        skipped += not cursor.rowcount
    return {"added": added, "skipped": skipped}


def measure(db, data):
    month = validate_month(data.get("month"))
    vehicle = ident(data.get("vehicle"))
    km = numeric(data.get("km"), 0, 1_000_000, "Пробег")
    diesel = numeric(data.get("diesel"), 0, 1_000_000, "Фактический расход ДТ")
    petrol = numeric(data.get("petrol"), 0, 1_000_000, "Фактический расход бензина")
    season = data.get("season")
    if season not in ("Лето", "Зима"):
        raise ValueError("Выберите сезон.")
    car = db.execute("SELECT summer,winter FROM work_vehicles WHERE id=?", (vehicle,)).fetchone()
    if car is None:
        raise ValueError("Автомобиль не найден.")
    db.execute("""INSERT INTO work_fuel_measurements(vehicle,month,km,diesel,petrol,season,norm)
        VALUES (?,?,?,?,?,?,?) ON CONFLICT(vehicle,month) DO UPDATE SET km=excluded.km,diesel=excluded.diesel,
        petrol=excluded.petrol,season=excluded.season,norm=excluded.norm""",
        (vehicle,month,km,diesel,petrol,season,car[0 if season == "Лето" else 1]))


def text(value, limit, label, optional=False):
    if not isinstance(value, str) or len(value.strip()) > limit or (not optional and not value.strip()):
        raise ValueError(f"Проверьте поле «{label}».")
    return value.strip()


def ident(value, optional=False):
    if optional and value is None:
        return None
    if type(value) is not int or not 1 <= value < 2**53:
        raise ValueError("Выберите запись из списка.")
    return value


def numeric(value, low, high, label):
    if type(value) not in (int, float) or not low <= value <= high or not math.isfinite(value):
        raise ValueError(f"Проверьте поле «{label}».")
    return value


def day(value):
    value = text(value, 10, "Дата")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("Укажите дату.")
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        raise ValueError("Укажите существующую дату.") from None


def card_number(value):
    number = re.sub(r"[ -]", "", text(value, 40, "Номер топливной карты")).upper()
    if not re.fullmatch(r"[0-9A-Z]{3,32}", number):
        raise ValueError("Номер топливной карты должен содержать от 3 до 32 цифр или латинских букв.")
    return number


def reconcile_statement(db):
    """Fill missing vehicle IDs without rewriting existing attribution."""
    db.execute("""UPDATE work_fuel_statement AS s SET vehicle=COALESCE(
        (SELECT b.vehicle FROM work_fuel_card_vehicle b WHERE b.card=s.card),
        (SELECT CASE WHEN COUNT(*)=1 THEN MIN(v.id) END
         FROM work_cards c JOIN work_vehicles v ON v.driver=c.employee WHERE c.number=s.card)
    ) WHERE s.vehicle IS NULL""")


def bind_card(db, data):
    card = card_number(data.get("card"))
    vehicle = ident(data.get("vehicle"), True)
    if not db.execute("SELECT 1 FROM work_fuel_statement WHERE card=? LIMIT 1", (card,)).fetchone():
        raise ValueError("В выписках нет такой карты.")
    if vehicle is None:
        db.execute("DELETE FROM work_fuel_card_vehicle WHERE card=?", (card,))
    else:
        db.execute("""INSERT INTO work_fuel_card_vehicle(card,vehicle) VALUES (?,?)
            ON CONFLICT(card) DO UPDATE SET vehicle=excluded.vehicle""", (card, vehicle))
    missing = "SELECT COUNT(*) FROM work_fuel_statement WHERE card=? AND vehicle IS NULL"
    before = db.execute(missing, (card,)).fetchone()[0]
    reconcile_statement(db)
    return {"attached": before - db.execute(missing, (card,)).fetchone()[0]}


def import_statement(db, records, filename):
    before = db.total_changes
    db.executemany("""INSERT INTO work_fuel_statement(
        fingerprint,card,day,hour,operation,station,material,price,quantity,amount_cents,filename)
        VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(fingerprint) DO NOTHING""",
        ((*record, filename) for record in records))
    added = db.total_changes - before
    reconcile_statement(db)
    dates = sorted({record[2] for record in records})
    run = db.execute("""INSERT INTO work_fuel_import_runs(filename,first_day,last_day,added,duplicates)
        VALUES (?,?,?,?,?)""", (filename,dates[0],dates[-1],added,len(records)-added)).lastrowid
    db.executemany("""INSERT INTO work_fuel_import_members(run,operation)
        SELECT ?,id FROM work_fuel_statement WHERE fingerprint=?""", ((run,record[0]) for record in records))
    months = sorted({value[:7] for value in dates}, reverse=True)
    return {"added": added, "duplicates": len(records) - added, "months": months, "run": run}


def employee(db, data, record_id):
    values = (text(data.get("name"), 150, "ФИО"), text(data.get("position", ""), 100, "Должность", True))
    cards = data.get("cards", [])
    vehicles = data.get("vehicles", [])
    if not isinstance(cards, list) or not isinstance(vehicles, list) or len(cards) > 40 or len(vehicles) > 250:
        raise ValueError("Слишком много карт или автомобилей.")
    codes = {card_number(card) for card in cards}
    vehicles = set(ident(value) for value in vehicles)
    if record_id is None:
        record_id = db.execute("INSERT INTO work_employees(name,position) VALUES (?,?)", values).lastrowid
    elif not db.execute("UPDATE work_employees SET name=?,position=? WHERE id=?", (*values, record_id)).rowcount:
        raise ValueError("Сотрудник не найден.")
    db.execute("DELETE FROM work_cards WHERE employee=?", (record_id,))
    for number in codes:
        if db.execute("SELECT 1 FROM work_cards WHERE number=?", (number,)).fetchone():
            raise ValueError(f"Карта {number} уже закреплена за другим сотрудником.")
        db.execute("INSERT INTO work_cards(number,employee) VALUES (?,?)", (number, record_id))
    db.execute("UPDATE work_vehicles SET driver=NULL WHERE driver=?", (record_id,))
    for vehicle in vehicles:
        changed = db.execute("UPDATE work_vehicles SET driver=? WHERE id=? AND driver IS NULL", (record_id, vehicle))
        if not changed.rowcount:
            raise ValueError("Автомобиль уже закреплён за другим водителем или недоступен. Измените назначение в разделе «Автомобили».")
    reconcile_statement(db)
    return record_id


def save(db, data):
    kind = data.get("kind")
    record_id = ident(data.get("id"), True)
    if kind == "employee":
        return employee(db, data, record_id)
    if kind == "fuel-bind-card":
        return bind_card(db, data)
    if kind == "vehicle":
        make = text(data.get("make"), 80, "Марка")
        model = text(data.get("model"), 80, "Модель")
        plate = text(data.get("plate", ""), 30, "Госномер", True).upper()
        values = (make, model, plate, ident(data.get("driver"), True),
                  numeric(data.get("summer"), .01, 1000, "Летняя норма"),
                  numeric(data.get("winter"), .01, 1000, "Зимняя норма"))
        if record_id is None:
            record_id = db.execute("INSERT INTO work_vehicles(make,model,plate,driver,summer,winter) VALUES (?,?,?,?,?,?)", values).lastrowid
            reconcile_statement(db)
            return record_id
        changed = db.execute("UPDATE work_vehicles SET make=?,model=?,plate=?,driver=?,summer=?,winter=? WHERE id=?", (*values, record_id))
    elif kind == "timesheet":
        status = data.get("status")
        if status not in STATUSES:
            raise ValueError("Выберите статус дня.")
        hours = numeric(data.get("hours"), 0, 24, "Часы")
        if status not in WORK_DAYS and hours:
            raise ValueError("Для нерабочего дня часы должны равняться нулю.")
        values = (ident(data.get("employee")), day(data.get("day")), status, hours)
        if record_id is None:
            db.execute("""INSERT INTO work_timesheet(employee,day,status,hours) VALUES (?,?,?,?)
                ON CONFLICT(employee,day) DO UPDATE SET status=excluded.status,hours=excluded.hours""", values)
            return db.execute("SELECT id FROM work_timesheet WHERE employee=? AND day=?", values[:2]).fetchone()[0]
        changed = db.execute("UPDATE work_timesheet SET employee=?,day=?,status=?,hours=? WHERE id=?", (*values, record_id))
    elif kind == "fuel":
        unit = data.get("unit")
        if unit not in UNITS:
            raise ValueError("Выберите единицу измерения.")
        card = text(data.get("card", ""), 32, "Топливная карта", True)
        if card and not db.execute("SELECT 1 FROM work_cards WHERE number=?", (card,)).fetchone():
            if not record_id or not db.execute("SELECT 1 FROM work_fuel WHERE id=? AND card=?", (record_id, card)).fetchone():
                raise ValueError("Топливная карта недоступна.")
        values = (ident(data.get("vehicle")), day(data.get("day")), text(data.get("material"), 80, "Материал"),
                  unit, numeric(data.get("quantity"), .001, 1000000, "Количество"),
                  numeric(data.get("price"), 0, 1000000, "Цена"), card)
        if record_id is None:
            return db.execute("INSERT INTO work_fuel(vehicle,day,material,unit,quantity,price,card) VALUES (?,?,?,?,?,?,?)", values).lastrowid
        changed = db.execute("UPDATE work_fuel SET vehicle=?,day=?,material=?,unit=?,quantity=?,price=?,card=? WHERE id=?", (*values, record_id))
    else:
        raise ValueError("Неизвестный раздел.")
    if not changed.rowcount:
        raise ValueError("Запись не найдена.")
    if kind == "vehicle":
        reconcile_statement(db)
    return record_id
