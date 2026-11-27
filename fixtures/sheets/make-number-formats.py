"""Writes number-formats.xls and number-formats.ods: one small sheet of numbers in the formats a reader expects to see
applied (a percentage, a currency, fixed decimals, thousands, a date, a time, a negative currency in its own section, a
column's default style and a style inherited from a common one). Constructed by hand, byte for byte: BIFF8 records in
an OLE compound file, and an ods's XML in a zip. Run from anywhere: python fixtures/sheets/make-number-formats.py

The expected display of each cell is in apps/desktop/src-tauri/src/tables/formats_tests.rs.
"""

import struct
import zipfile
from pathlib import Path

OUT = Path(__file__).resolve().parent

# ---- xls ----------------------------------------------------------------------------------------------------------


def rec(rid, data=b""):
    return struct.pack("<HH", rid, len(data)) + data


def bof(kind):
    return rec(0x0809, struct.pack("<HHHHLL", 0x0600, kind, 0x0DBB, 0x07CC, 0, 6))


def ustr16(t):
    return struct.pack("<HB", len(t), 1) + t.encode("utf-16-le")


def font():
    name = b"Arial"
    return rec(0x0031, struct.pack("<HHHHHBBBB", 200, 0, 0x7FFF, 400, 0, 0, 0, 0, 0) + struct.pack("<BB", len(name), 0) + name)


def xf(fmt, style=False):
    flags = 0x0001 | (0x0004 if style else 0) | ((0xFFF if style else 0) << 4)
    return rec(0x00E0, struct.pack("<HHHBBBBLLH", 0, fmt, flags, 0x20, 0, 0, 0 if style else 0x04, 0, 0, 0x40 | (0x41 << 7)))


# Formats the file writes itself (ids from 164, as Excel numbers them).
FORMATS = {164: '"£"#,##0.00', 165: 'd mmm yyyy', 166: 'hh:mm'}
# Cell XFs from 15 (0 to 14 are style XFs): the format each names.
CELL_XF = {"general": 15, "pct2": 16, "gbp": 17, "dec2": 18, "date": 19, "thou": 20, "pct0": 21, "time": 22}
CELL_FMT = {"general": 0, "pct2": 10, "gbp": 164, "dec2": 2, "date": 165, "thou": 3, "pct0": 9, "time": 166}

LABELS = ["Kind", "Value", "percent", "pounds", "two places", "a date", "thousands", "General", "several in a row", "worked out", "a time"]


def rk_int(n):
    return (n << 2) | 2


def rk_float(x):
    hi = struct.unpack("<Q", struct.pack("<d", x))[0] >> 32
    assert struct.pack("<Q", hi << 32) == struct.pack("<d", x), "not exact as an RK"
    return hi


def xls_stream():
    sst = rec(0x00FC, struct.pack("<LL", len(LABELS), len(LABELS)) + b"".join(ustr16(t) for t in LABELS))

    def sheet():
        out = [bof(0x0010), rec(0x0200, struct.pack("<LLHHH", 0, 10, 0, 4, 0))]
        for r, _ in enumerate(LABELS[:1] + LABELS[2:]):
            out.append(rec(0x00FD, struct.pack("<HHHL", r, 0, CELL_XF["general"], 0 if r == 0 else r + 1)))
        out.append(rec(0x00FD, struct.pack("<HHHL", 0, 1, CELL_XF["general"], 1)))
        n = lambda r, c, k, v: rec(0x0203, struct.pack("<HHHd", r, c, CELL_XF[k], v))
        out += [
            n(1, 1, "pct2", 0.0345),
            n(2, 1, "gbp", 1234.5),
            n(3, 1, "dec2", 3.14159),
            n(4, 1, "date", 46326.0),
            rec(0x027E, struct.pack("<HHHL", 5, 1, CELL_XF["thou"], rk_int(1234567))),
            n(6, 1, "general", 2.5),
            # MULRK: B8 0.5 as a percentage, C8 42 to two places.
            rec(0x00BD, struct.pack("<HH", 7, 1) + struct.pack("<HL", CELL_XF["pct0"], rk_float(0.5))
                + struct.pack("<HL", CELL_XF["dec2"], rk_int(42)) + struct.pack("<H", 2)),
        ]
        # B9: =B2*2 worked out as 0.069, as a percentage.
        rgce = struct.pack("<BHH", 0x24, 1, 1 | 0xC000) + struct.pack("<BH", 0x1E, 2) + b"\x05"
        out.append(rec(0x0006, struct.pack("<HHHdHLH", 8, 1, CELL_XF["pct2"], 0.069, 0, 0, len(rgce)) + rgce))
        out.append(n(9, 1, "time", 0.2708333333333333))
        out.append(rec(0x023E, struct.pack("<HHHLHHL", 0x06B6, 0, 0, 0x40, 0, 0, 0)))
        out.append(rec(0x000A))
        return b"".join(out)

    def globals_(offset):
        out = [bof(0x0005), rec(0x0042, struct.pack("<H", 1200)), rec(0x0022, struct.pack("<H", 0))]
        out += [font() for _ in range(5)]
        for fid, code in FORMATS.items():
            out.append(rec(0x041E, struct.pack("<H", fid) + ustr16(code)))
        out += [xf(0, style=True) for _ in range(15)]
        out += [xf(CELL_FMT[k]) for k in CELL_XF]
        out.append(rec(0x0293, struct.pack("<HBB", 0x8000, 0, 0xFF)))
        name = b"Formats"
        out.append(rec(0x0085, struct.pack("<LBBBB", offset, 0, 0, len(name), 0) + name))
        out += [sst, rec(0x000A)]
        return b"".join(out)

    body = sheet()
    offset = len(globals_(0))
    return globals_(offset) + body


def cfb(stream):
    size = max(4096, -(-len(stream) // 512) * 512)
    stream = stream + b"\x00" * (size - len(stream))
    nsec = size // 512
    END, FATSECT, FREE = 0xFFFFFFFE, 0xFFFFFFFD, 0xFFFFFFFF
    fat = [FATSECT, END] + [i + 3 for i in range(nsec - 1)] + [END]
    fat += [FREE] * (128 - len(fat))
    header = struct.pack("<8s16sHHHHH6sLLLLLLLLL", b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1", b"\0" * 16,
                         0x003E, 0x0003, 0xFFFE, 9, 6, b"\0" * 6, 0, 1, 1, 0, 4096, END, 0, END, 0)
    header += struct.pack("<109L", *([0] + [FREE] * 108))

    def dirent(name, typ, child, start, sz):
        nb = name.encode("utf-16-le") + b"\0\0" if name else b""
        return struct.pack("<64sHBBLLL16sLQQLQ", nb.ljust(64, b"\0"), len(nb), typ, 1 if name else 0,
                           FREE, FREE, child, b"\0" * 16, 0, 0, 0, start, sz)

    directory = dirent("Root Entry", 5, 1, END, 0) + dirent("Workbook", 2, FREE, 2, size) + dirent("", 0, FREE, 0, 0) * 2
    return header + struct.pack("<128L", *fat) + directory + stream


# ---- ods ----------------------------------------------------------------------------------------------------------

NS = ('xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
      'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" '
      'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" '
      'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" '
      'xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0" '
      'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" '
      'xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2"')
HEAD = '<?xml version="1.0" encoding="UTF-8"?>'


def s(text):
    return f'<table:table-cell office:value-type="string"><text:p>{text}</text:p></table:table-cell>'


def f(v, style=None, kind="float", extra=""):
    st = f' table:style-name="{style}"' if style else ""
    return f'<table:table-cell{st}{extra} office:value-type="{kind}" office:value="{v}"><text:p>{v}</text:p></table:table-cell>'


def row(*cells):
    return "<table:table-row>" + "".join(cells) + "</table:table-row>"


def ods():
    auto = (
        '<office:automatic-styles>'
        '<number:percentage-style style:name="N1"><number:number number:decimal-places="2" number:min-integer-digits="1"/><number:text>%</number:text></number:percentage-style>'
        '<number:currency-style style:name="N2"><number:currency-symbol number:language="en" number:country="GB">£</number:currency-symbol><number:number number:decimal-places="2" number:min-integer-digits="1" number:grouping="true"/></number:currency-style>'
        '<number:number-style style:name="N3"><number:number number:decimal-places="2" number:min-integer-digits="1"/></number:number-style>'
        '<number:date-style style:name="N4"><number:day/><number:text> </number:text><number:month number:textual="true"/><number:text> </number:text><number:year number:style="long"/></number:date-style>'
        '<number:number-style style:name="N5"><number:number number:decimal-places="0" number:min-integer-digits="1" number:grouping="true"/></number:number-style>'
        '<number:time-style style:name="N6"><number:hours number:style="long"/><number:text>:</number:text><number:minutes number:style="long"/></number:time-style>'
        '<number:currency-style style:name="N7P0" style:volatile="true"><number:currency-symbol>€</number:currency-symbol><number:number number:decimal-places="2" number:min-integer-digits="1" number:grouping="true"/></number:currency-style>'
        '<number:currency-style style:name="N7"><style:text-properties fo:color="#ff0000"/><number:text>-</number:text><number:currency-symbol>€</number:currency-symbol><number:number number:decimal-places="2" number:min-integer-digits="1" number:grouping="true"/><style:map style:condition="value()&gt;=0" style:apply-style-name="N7P0"/></number:currency-style>'
        '<style:style style:name="ce1" style:family="table-cell" style:data-style-name="N1"/>'
        '<style:style style:name="ce2" style:family="table-cell" style:data-style-name="N2"/>'
        '<style:style style:name="ce3" style:family="table-cell" style:data-style-name="N3"/>'
        '<style:style style:name="ce4" style:family="table-cell" style:data-style-name="N4"/>'
        '<style:style style:name="ce5" style:family="table-cell" style:data-style-name="N5"/>'
        '<style:style style:name="ce6" style:family="table-cell" style:data-style-name="N6"/>'
        '<style:style style:name="ce7" style:family="table-cell" style:data-style-name="N7"/>'
        '<style:style style:name="ce8" style:family="table-cell" style:parent-style-name="Share"/>'
        '</office:automatic-styles>')
    rows = [
        row(s("Kind"), s("Value")),
        row(s("percent"), f("0.0345", "ce1", "percentage")),
        row(s("pounds"), f("1234.5", "ce2", "currency", ' office:currency="GBP"')),
        row(s("two places"), f("3.14159", "ce3")),
        row(s("a date"), '<table:table-cell table:style-name="ce4" office:value-type="date" office:date-value="2026-10-31"><text:p>31 Oct 2026</text:p></table:table-cell>'),
        row(s("thousands"), f("1234567", "ce5")),
        row(s("General"), f("2.5")),
        row(s("a time"), '<table:table-cell table:style-name="ce6" office:value-type="time" office:time-value="PT06H30M00S"><text:p>06:30</text:p></table:table-cell>'),
        row(s("owed"), f("-12.5", "ce7", "currency", ' office:currency="EUR"')),
        row(s("a common style"), f("0.25", "ce8", "percentage")),
        # C11: no style of its own; its column's default is two places.
        row(s("the column's"), '<table:table-cell/>', f("7")),
    ]
    content = (f'{HEAD}<office:document-content {NS} office:version="1.2">{auto}<office:body><office:spreadsheet>'
               '<table:table table:name="Formats"><table:table-column table:number-columns-repeated="2"/>'
               '<table:table-column table:default-cell-style-name="ce3"/>'
               + "".join(rows) + '</table:table></office:spreadsheet></office:body></office:document-content>')
    styles = (f'{HEAD}<office:document-styles {NS} office:version="1.2"><office:styles>'
              '<number:percentage-style style:name="NS1"><number:number number:decimal-places="0" number:min-integer-digits="1"/><number:text>%</number:text></number:percentage-style>'
              '<style:style style:name="Share" style:family="table-cell" style:data-style-name="NS1"/>'
              '</office:styles></office:document-styles>')
    manifest = (f'{HEAD}<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">'
                '<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>'
                '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>'
                '<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>'
                '</manifest:manifest>')
    with zipfile.ZipFile(OUT / "number-formats.ods", "w") as z:
        def add(name, data, stored=False):
            info = zipfile.ZipInfo(name, (2026, 11, 9, 0, 0, 0))
            info.compress_type = zipfile.ZIP_STORED if stored else zipfile.ZIP_DEFLATED
            z.writestr(info, data)
        add("mimetype", "application/vnd.oasis.opendocument.spreadsheet", stored=True)
        add("META-INF/manifest.xml", manifest)
        add("styles.xml", styles)
        add("content.xml", content)


if __name__ == "__main__":
    (OUT / "number-formats.xls").write_bytes(cfb(xls_stream()))
    ods()
    print("wrote", OUT / "number-formats.xls", "and", OUT / "number-formats.ods")
