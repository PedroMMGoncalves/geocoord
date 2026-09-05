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
from xml.sax.saxutils import escape

import shapefile  # pyshp (pure Python)

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
# ...but a negative coordinate starts with a minus and must be left exactly as
# it is, decimal comma included. Anything made only of digits and the characters
# a number can contain is a number, not a formula.
_NUMERIC_LIKE_RE = re.compile(r"^[-+]?[0-9.,eE+-]*$")


def csv_safe(value):
    """A cell that a spreadsheet will display rather than execute.

    A converted file is usually somebody else's data, and it is opened in Excel
    the moment it is downloaded. A cell reading ``=HYPERLINK(...)`` or
    ``@SUM(...)`` came through the export verbatim and ran there. Prefixing an
    apostrophe is the standard remedy and is invisible in the spreadsheet.

    Numbers are never touched: ``-8.61`` and ``-8,61`` are coordinates, and a
    tool that quietly turned them into text would break the thing it exists to
    produce.
    """
    if not isinstance(value, str) or value == "":
        return value
    if not value.startswith(_FORMULA_START):
        return value
    if _NUMERIC_LIKE_RE.match(value):
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


def _safe_field_names(names):
    """Sanitise attribute names to valid, unique DBF field names (<= 10 chars)."""
    used = set()
    out = []
    for name in names:
        base = "".join(c if (c.isalnum() or c == "_") else "_" for c in str(name))[:10]
        if not base:
            base = "field"
        candidate = base
        i = 1
        while candidate.upper() in used:
            suffix = str(i)
            candidate = base[: 10 - len(suffix)] + suffix
            i += 1
        used.add(candidate.upper())
        out.append(candidate)
    return out


def _dbf_value(v):
    v = _json_safe(v)
    return "" if v is None else str(v)


def to_shapefile_zip(features, field_names, base_name: str = "coordinates") -> bytes:
    """Point shapefile (.shp/.shx/.dbf/.prj) bundled into a single .zip.

    ``base_name`` names the components inside the zip and therefore the layer
    name shown in GIS; it is sanitised, so passing the input file name yields a
    clean layer (e.g. ``"dados_das_areas_de_ferro"``).

    DBF field names are truncated to 10 characters; all attributes are written
    as text to avoid type/length surprises.
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
        z.writestr(f"{layer}.prj", WGS84_ESRI_WKT)
    return buf.getvalue()
