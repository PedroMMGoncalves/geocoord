"""Geospatial exporters for GeoCoord (WGS84 / EPSG:4326).

Pure-Python writers so they also work in the stlite/Pyodide desktop build.
Each function takes ``features``: a list of ``(lon, lat, properties)`` tuples,
where ``properties`` is a dict of attribute name -> value.
"""
from __future__ import annotations

import io
import json
import math
import zipfile
from xml.sax.saxutils import escape

import shapefile  # pyshp (pure Python)

# ESRI WKT for WGS84, written to the shapefile .prj sidecar.
WGS84_ESRI_WKT = (
    'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",'
    'SPHEROID["WGS_1984",6378137.0,298.257223563]],'
    'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]'
)


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
    return json.dumps(fc, ensure_ascii=False, allow_nan=False).encode("utf-8")


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
            f'<Data name="{escape(str(k))}"><value>{escape(str(_json_safe(v)))}</value></Data>'
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


def to_shapefile_zip(features, field_names) -> bytes:
    """Point shapefile (.shp/.shx/.dbf/.prj) bundled into a single .zip.

    DBF field names are truncated to 10 characters; all attributes are written
    as text to avoid type/length surprises.
    """
    field_names = list(field_names)
    dbf_names = _safe_field_names(field_names)

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
        z.writestr("coordinates.shp", shp.getvalue())
        z.writestr("coordinates.shx", shx.getvalue())
        z.writestr("coordinates.dbf", dbf.getvalue())
        z.writestr("coordinates.prj", WGS84_ESRI_WKT)
    return buf.getvalue()
