"""Geospatial exporters for GeoCoord (WGS84 / EPSG:4326).

Pure-Python writers so they also work in the stlite/Pyodide desktop build.
Each function takes ``features``: a list of ``(lon, lat, properties)`` tuples,
where ``properties`` is a dict of attribute name -> value.
"""
from __future__ import annotations

import io
import json
import math
import re
import unicodedata
import zipfile

import pandas as pd
import shapefile  # pyshp (pure Python)
from xml.sax.saxutils import escape  # pyshp (pure Python)

# ESRI WKT for WGS84, written to the shapefile .prj sidecar.
WGS84_ESRI_WKT = (
    'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",'
    'SPHEROID["WGS_1984",6378137.0,298.257223563]],'
    'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]'
)


# A cell a spreadsheet would execute rather than display. Excel, LibreOffice and
# Google Sheets all treat a leading =, +, - or @ as the start of a formula, and
# a leading tab or carriage return as an invitation to look at the next one.
_FORMULA_START = ("=", "+", "-", "@", "\t", "\r")

# Two of those five are also how a coordinate legitimately begins, and this is
# where the first attempt at this went wrong. It let a bare number through and
# nothing else, so a raw DMS column written with a minus instead of a hemisphere
# letter - which is how the southern hemisphere is normally written, and how
# most PALOP data arrives - came out of the export as "'-25° 58' 9\"". Reading
# that file back, the apostrophe stops the minus being leading, parse_coordinate
# finds no sign, and the point moves to the northern hemisphere. Fifty degrees
# of latitude, in silence, from a file the application itself had just written.
#
# So a whitelist rather than a pattern for numbers: every character a coordinate
# can contain, and nothing else. A value made only of these is data whatever it
# starts with; a value with anything else in it - a letter that is not a
# hemisphere, a bracket, a pipe - is prefixed.
_COORDINATE_CHARS = set(
    "0123456789 .,-+eE"
    "°ºª'\"′″ "   # degree marks, primes, nbsp
    "NSEWOLnsewol"                                # the hemisphere letters
)


def csv_safe(value):
    """A cell that a spreadsheet will display rather than execute.

    A converted file is usually somebody else's data, and it is opened in Excel
    the moment it is downloaded. A cell reading ``=HYPERLINK(...)`` or
    ``@SUM(...)`` came through the export verbatim and ran there. Prefixing an
    apostrophe is the standard remedy and is invisible in the spreadsheet.

    Coordinates are never touched, whatever they start with. See the note above
    for why that is the hard half.
    """
    if not isinstance(value, str) or value == "":
        return value
    if not value.startswith(_FORMULA_START):
        return value
    # "=" and "@" can only begin a formula; the others can begin a coordinate.
    if value[0] not in ("=", "@") and set(value) <= _COORDINATE_CHARS:
        return value
    return "'" + value


def _escape_attr(text: str) -> str:
    """Escape text going into an XML *attribute*, quotes included.

    ``escape`` leaves the double quote alone, which is right inside an element
    and wrong inside an attribute: a column named ``a"b`` produced
    ``<Data name="a"b">``, and the KML was not well-formed XML at all - no GIS
    would open the file, and nothing in the application said why.
    """
    return escape(text).replace('"', "&quot;")


def sanitize_filename(name, default: str = "converted", max_length: int = 60) -> str:
    """Turn an arbitrary name into a safe base name for output files / GIS layers.

    Useful for naming exports after the input file. Drops any directory and a
    single trailing extension, transliterates accents to ASCII (``á`` -> ``a``,
    ``ç`` -> ``c``), replaces every character other than ASCII letters, digits,
    ``-`` and ``_`` with ``_``, collapses repeats and trims to ``max_length``.
    Falls back to ``default`` when nothing usable remains. Idempotent.

    Example: ``"dados das áreas de ferro.csv"`` -> ``"dados_das_areas_de_ferro"``.
    """
    stem = str(name).replace("\\", "/").rsplit("/", 1)[-1]
    stem = re.sub(r"\.[^.]+$", "", stem)  # drop a single trailing extension
    stem = unicodedata.normalize("NFKD", stem).encode("ascii", "ignore").decode("ascii")
    stem = re.sub(r"[^A-Za-z0-9_-]+", "_", stem)
    stem = re.sub(r"_+", "_", stem).strip("_-")
    stem = stem[:max_length].strip("_-")
    return stem or default


def _json_safe(v):
    if v is None:
        return None
    if isinstance(v, (str, bool, int)):
        return v
    if isinstance(v, float):
        return v if math.isfinite(v) else None
    item = getattr(v, "item", None)
    if callable(item):
        try:
            return item()
        except (ValueError, TypeError):
            pass
    return str(v)


# The characters the XLSX format does not admit in a cell: the C0 controls,
# less tab, newline and carriage return. openpyxl refuses a workbook containing
# one, which took the whole download step down with it - a single stray byte in
# a notes column and nothing could be exported at all.
_ILLEGAL_IN_XLSX_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def to_excel_bytes(df):
    """The frame as an .xlsx, with two things the format makes necessary.

    A cell whose text begins with ``=`` is written as a *formula* by openpyxl,
    not as text. A converted file is usually somebody else's data being opened
    on your machine, so ``=HYPERLINK(...)`` in a name column arrived live and
    ran. The CSV export has been guarded by ``csv_safe`` for a while; this is
    the same hole in the other export, and it is closed differently: the cell
    keeps its exact text and is marked as a string, so nothing is altered and
    nothing executes. An apostrophe prefix would have been visible in the data.

    And a C0 control character makes openpyxl refuse the whole workbook, so one
    stray byte in a notes column meant no Excel download at all. They are
    dropped, which is what the format requires; every other export keeps them.
    """
    cleaned = df.map(
        lambda v: _ILLEGAL_IN_XLSX_RE.sub("", v) if isinstance(v, str) else v
    )
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        cleaned.to_excel(writer, index=False, sheet_name="converted")
        sheet = writer.book["converted"]
        for row in sheet.iter_rows():
            for cell in row:
                if cell.data_type == "f":
                    cell.data_type = "s"
    output.seek(0)
    return output.getvalue()


def to_geojson(features) -> bytes:
    """GeoJSON FeatureCollection of points."""
    fc = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [float(lon), float(lat)]},
                "properties": {str(k): _json_safe(v) for k, v in props.items()},
            }
            for lon, lat, props in features
        ],
    }
    # Compact separators: smaller files, and the byte-for-byte match with the
    # JavaScript port that lets the parity contract compare the text rather
    # than the parsed object. Comparing the parsed object hid a real defect -
    # see the note in the JavaScript toGeoJSON.
    return json.dumps(fc, ensure_ascii=False, allow_nan=False,
                      separators=(",", ":")).encode("utf-8")


def to_kml(features, name_key=None) -> bytes:
    """KML document of points (Google Earth / generic GIS)."""
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>',
    ]
    for lon, lat, props in features:
        name = ""
        if name_key is not None and props.get(name_key) is not None:
            name = escape(str(props[name_key]))
        data = "".join(
            f'<Data name="{_escape_attr(str(k))}"><value>{escape(str(_json_safe(v)))}</value></Data>'
            for k, v in props.items()
            if _json_safe(v) is not None
        )
        parts.append(
            "<Placemark>"
            f"<name>{name}</name>"
            f"<ExtendedData>{data}</ExtendedData>"
            f"<Point><coordinates>{float(lon)},{float(lat)},0</coordinates></Point>"
            "</Placemark>"
        )
    parts.append("</Document></kml>")
    return "".join(parts).encode("utf-8")


def _truncate_bytes(text: str, limit: int = 10) -> str:
    """Cut ``text`` to at most ``limit`` UTF-8 bytes, dropping whole characters.

    The DBF format measures a field name in bytes, not in characters, and every
    accented letter in Portuguese is two of them.
    """
    while text and len(text.encode("utf-8")) > limit:
        text = text[:-1]
    return text


def _safe_field_names(names):
    """Sanitise attribute names to valid, unique DBF field names.

    The limit is ten *bytes*, not ten characters, and that distinction was
    silently losing columns. Truncating to ten characters, ``Descrição_Amostra``
    and ``Descrição_Local`` became ``Descrição_`` and ``Descrição1`` - different,
    so the uniqueness check was satisfied - and then pyshp, which measures in
    bytes as the format requires, cut both to ``Descriçã``. The shapefile handed
    to a partner institution had two fields with the same name; QGIS shows one
    of them and the other column is simply gone.

    Portuguese field data routinely has several columns sharing an accented
    prefix, so this was not a corner case. De-duplicating on the byte-truncated
    name is the fix: what the check compares is now what the file will hold.
    """
    used = set()
    out = []
    for name in names:
        base = _truncate_bytes(
            "".join(c if (c.isalnum() or c == "_") else "_" for c in str(name))
        )
        if not base:
            base = "field"
        candidate = base
        i = 1
        while candidate.upper() in used:
            suffix = str(i)
            candidate = _truncate_bytes(base, 10 - len(suffix)) + suffix
            i += 1
        used.add(candidate.upper())
        out.append(candidate)
    return out


def _dbf_value(v):
    v = _json_safe(v)
    return "" if v is None else str(v)


def to_shapefile_zip(features, field_names, base_name: str = "coordinates",
                     prj: str = WGS84_ESRI_WKT) -> bytes:
    """Point shapefile (.shp/.shx/.dbf/.prj) bundled into a single .zip.

    ``base_name`` names the components inside the zip and therefore the layer
    name shown in GIS; it is sanitised, so passing the input file name yields a
    clean layer (e.g. ``"dados_das_areas_de_ferro"``).

    DBF field names are truncated to 10 characters; all attributes are written
    as text to avoid type/length surprises.

    ``prj`` is the ESRI WKT written to the sidecar, and describes the system
    the geometry is actually in. It defaults to WGS84, so every existing
    caller keeps its behaviour; a caller writing geometry in another system
    passes that system's WKT. A .prj naming a system the coordinates are not
    in is worse than none at all.
    """
    field_names = list(field_names)
    dbf_names = _safe_field_names(field_names)
    layer = sanitize_filename(base_name, default="coordinates")

    shp, shx, dbf = io.BytesIO(), io.BytesIO(), io.BytesIO()
    writer = shapefile.Writer(shp=shp, shx=shx, dbf=dbf, shapeType=shapefile.POINT)
    for dbf_name in dbf_names:
        writer.field(dbf_name, "C", size=254)
    for lon, lat, props in features:
        writer.point(float(lon), float(lat))
        writer.record(*[_dbf_value(props.get(orig)) for orig in field_names])
    writer.close()

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(f"{layer}.shp", shp.getvalue())
        z.writestr(f"{layer}.shx", shx.getvalue())
        z.writestr(f"{layer}.dbf", dbf.getvalue())
        z.writestr(f"{layer}.prj", prj)
    return buf.getvalue()
