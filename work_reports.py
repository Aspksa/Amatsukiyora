"""Monthly fleet reports and a small, local Excel export."""
from io import BytesIO
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile

MONTH_COLUMNS = ("Госномер", "Автомобиль", "Водитель", "Заправлено ДТ, л", "Возвраты ДТ, л",
                 "Заправлено бензина, л", "Возвраты бензина, л", "Прочее топливо, л нетто",
                 "Сумма ГСМ, ₽", "Пробег, км", "Расход факт ДТ, л", "Расход факт бензин, л",
                 "Расход факт, л/100 км", "Сезон", "Норма, л/100 км", "Расход по норме, л", "Отклонение, л")


def fleet(data):
    totals = {}
    for row in data["fuel"]:
        if row["vehicle"] is None:
            continue
        total = totals.setdefault(row["vehicle"], [0.0] * 6)
        total[5] += row["amount"]
        if row["unit"] != "л":
            continue
        name = row["material"].casefold()
        if "дизел" in name or name.startswith("дт"):
            total[0 if row["quantity"] >= 0 else 1] += abs(row["quantity"])
        elif "бензин" in name or name.startswith(("аи-", "аи ")):
            total[2 if row["quantity"] >= 0 else 3] += abs(row["quantity"])
        elif row["imported"] or name in ("газ", "метан", "пропан", "снг", "кпг") or name.startswith(("газ ", "пропан-", "метан ")):
            total[4] += row["quantity"]

    drivers = {row["id"]: row["name"] for row in data["employees"]}
    measures = {row["vehicle"]: row for row in data["measurements"]}
    output = []
    for vehicle in data["vehicles"]:
        issued_d, returned_d, issued_p, returned_p, other, amount = totals.get(vehicle["id"], [0.0] * 6)
        measure = measures.get(vehicle["id"])
        km, diesel, petrol, season, norm, actual, expected, delta = (None,) * 8
        if measure:
            km, diesel, petrol, season = (measure[key] for key in ("km", "diesel", "petrol", "season"))
            norm = measure["norm"]
            litres = diesel + petrol
            if km > 0:
                actual = litres * 100 / km
                expected = norm * km / 100
                delta = litres - expected
        output.append({"id": vehicle["id"], "row": [vehicle["plate"], f"{vehicle['make']} {vehicle['model']}",
            drivers.get(vehicle["driver"], ""), issued_d, returned_d, issued_p, returned_p, other, amount,
            km, diesel, petrol, actual, season, norm, expected, delta]})
    return output


def excel(rows):
    """Write a one-sheet OOXML workbook. Every user string is an inline string, never a formula."""
    content_types = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'
    rel_type = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
    package_rel = 'http://schemas.openxmlformats.org/package/2006/relationships'
    root_rel = f'<Relationships xmlns="{package_rel}"><Relationship Id="rId1" Type="{rel_type}officeDocument" Target="xl/workbook.xml"/></Relationships>'
    book_rel = f'<Relationships xmlns="{package_rel}"><Relationship Id="rId1" Type="{rel_type}worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="{rel_type}styles" Target="styles.xml"/></Relationships>'
    namespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    workbook = f'<workbook xmlns="{namespace}" xmlns:r="{rel_type[:-1]}"><sheets><sheet name="Сводка ГСМ" sheetId="1" r:id="rId1"/></sheets></workbook>'
    styles = f'<styleSheet xmlns="{namespace}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0C6558"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" fillId="2" borderId="0" numFmtId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
    worksheet = [f'<worksheet xmlns="{namespace}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>',
                 '<cols><col min="1" max="1" width="14" customWidth="1"/><col min="2" max="3" width="26" customWidth="1"/><col min="4" max="17" width="18" customWidth="1"/></cols><sheetData>']
    for number, row in enumerate([MONTH_COLUMNS, *rows], 1):
        row_style = ' ht="34" customHeight="1"' if number == 1 else ''
        header_style = ' s="1"' if number == 1 else ''
        worksheet.append(f'<row r="{number}"{row_style}>')
        for column, value in enumerate(row):
            ref = chr(65 + column) + str(number)
            if value is None:
                continue
            if type(value) in (int, float):
                worksheet.append(f'<c r="{ref}"><v>{round(value, 3)}</v></c>')
            else:
                safe = "".join(c for c in str(value) if ord(c) >= 32 or c in "\t\n\r")
                worksheet.append(f'<c r="{ref}"{header_style} t="inlineStr"><is><t xml:space="preserve">{escape(safe)}</t></is></c>')
        worksheet.append('</row>')
    worksheet.append(f'</sheetData><autoFilter ref="A1:Q{len(rows)+1}"/></worksheet>')
    output = BytesIO()
    with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
        for path, text in (('[Content_Types].xml', content_types), ('_rels/.rels', root_rel),
                           ('xl/workbook.xml', workbook), ('xl/_rels/workbook.xml.rels', book_rel), ('xl/styles.xml', styles),
                           ('xl/worksheets/sheet1.xml', ''.join(worksheet))):
            archive.writestr(path, text)
    return output.getvalue()
