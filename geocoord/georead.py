"""Reading the geospatial formats GeoCoord already writes: KML, KMZ, GeoJSON, GPX.

The counterpart of :mod:`geocoord.geoexport`. Everything here turns a file into
the same table the CSV and Excel readers produce - a dataframe of strings - so
the whole pipeline after it (column guessing, coordinate parsing, swap
detection, the region check, the map, every exporter) works unchanged. Nothing
in this module knows about coordinates beyond where to find them; it does not
parse, convert or validate a single one.

**These formats are tables of points and nothing more here.** A KML holding
polygons, a GPX holding a track, a GeoJSON holding a MultiPolygon: the points
come through and the rest is counted and reported, not half-read. GeoCoord's
model is a row per point and there is no honest way to fold a polygon into it.
Saying so plainly is better than emitting a centroid nobody asked for.

The columns are named ``Latitude`` and ``Longitude`` deliberately. Both are
exact entries in :data:`geocoord.converter.LAT_CANDIDATES` and
``LON_CANDIDATES``, so :func:`~geocoord.converter.guess_coordinate_columns`
finds them by name and stops - no new mechanism was needed to tell the
application which column is which. The names must NOT be ``Latitude_DD`` or
``X_DD``: those match the pipeline's own derived names and are stripped from the
result and from every export.

All three formats define their coordinates as WGS84 decimal degrees, so the
values arrive ready. Two of them carry the coordinate as *text* - KML in
``<coordinates>``, GPX in the ``lat``/``lon`` attributes - and that text is
carried through verbatim rather than parsed to a float and printed again, so no
rounding is introduced that the file did not have. GeoJSON holds real JSON
numbers and has to be formatted, which is done the way :mod:`geocoord.geoexport`
formats them, so both ports agree.

Pure Python on purpose, like the writers, so the stlite/Pyodide desktop build
keeps working: :mod:`xml.etree.ElementTree`, :mod:`json` and :mod:`zipfile` only.
"""
from __future__ import annotations

import io
import json
import re
import xml.etree.ElementTree as ET
import zipfile
from typing import NamedTuple

import pandas as pd

from .reader import FileTooLarge, MAX_XLSX_BYTES, _check_cells, header_names

#: The two columns every reader here declares, ahead of the file's own.
LAT_COLUMN = "Latitude"
LON_COLUMN = "Longitude"

#: What those two are called when the file declares a projected system: the
#: values are metres, and calling a northing of 68811.71 a latitude is a lie
#: the rest of the application would then act on. Both are exact entries in
#: LON_CANDIDATES and LAT_CANDIDATES too, so the guess still finds them.
X_COLUMN = "X"
Y_COLUMN = "Y"

#: The name column, when the file gives its points names.
NAME_COLUMN = "Nome"

#: Altitude, when the file carries one worth keeping. See :func:`_altitudes`.
ALT_COLUMN = "Altitude"

#: WGS84 by any of the names a GeoJSON file writes for it. Anything else is a
#: projected or otherwise different system and is reported rather than assumed.
_WGS84_URNS = {
    "urn:ogc:def:crs:ogc:1.3:crs84",
    "urn:ogc:def:crs:ogc::crs84",
    "urn:ogc:def:crs:epsg::4326",
    "epsg:4326",
    "crs84",
    "wgs84",
}

_EPSG_IN_URN = re.compile(r"(?:epsg:*)(\d{4,6})\s*$", re.IGNORECASE)


class GeoTable(NamedTuple):
    """What a reader in this module returns.

    ``table`` is the dataframe, and is the only part the pipeline needs. The
    rest is what the reader *learned* while reading and the interface should
    say out loud: a GPX whose points came from a track rather than from
    waypoints has not failed, but the user is entitled to know. ``notes`` are
    codes with parameters rather than sentences, so each interface writes them
    in its own language.
    """

    table: pd.DataFrame
    notes: list[dict]
    crs: str | None = None


def _note(code: str, **params) -> dict:
    return {"code": code, **params}


# ---------------------------------------------------------------------------
# Shared: turning points into the table
# ---------------------------------------------------------------------------

def _check_size(data: bytes) -> None:
    """Refuse a file too large to parse into memory.

    The cell limit downstream bounds the *table*, which is no help here: a
    document is fully parsed into a tree before any row exists, so a 400 MB
    GeoJSON has already taken the tab down by the time there is anything to
    count. This bounds the input instead. The ceiling is the one the workbook
    reader uses, for the same reason it was chosen there.
    """
    if len(data) > MAX_XLSX_BYTES:
        raise FileTooLarge("bytes", len(data), MAX_XLSX_BYTES)


def _altitudes(values: list[str]) -> bool:
    """Whether an altitude column is worth keeping.

    GeoCoord's own KML writer puts a literal ``0`` in every third position -
    ``<coordinates>lon,lat,0</coordinates>`` - so reading a file this
    application wrote would otherwise add a column of zeros to every table, and
    then to every export, for ever. A column is kept when at least one value is
    present and not zero.
    """
    for v in values:
        if v == "":
            continue
        try:
            if float(v) != 0.0:
                return True
        except ValueError:
            return True          # not a number, but the file said something
    return False


def _build(points: list[dict], notes: list[dict], crs: str | None = None,
           projected: bool = False) -> GeoTable:
    """Assemble the table from points, each ``{lat, lon, alt, name, props}``.

    The property keys are unioned across every point in first-seen order, not
    taken from the first one. KML omits a ``<Data>`` element entirely where the
    value is blank - GeoCoord's own writer does this - so the first Placemark
    is not a description of the file, and a reader that trusted it would drop
    whole columns.

    Names go through :func:`~geocoord.reader.header_names` for the same reason
    the CSV reader does: two properties can carry the same name, and the
    pipeline resolves a column by ``indexOf``, so a duplicate is a column that
    can never be selected. The declared names are seeded first so that a file
    with its own "Latitude" property is the one that gets renamed, not ours.
    """
    if not points:
        return GeoTable(pd.DataFrame(), notes, crs)

    keys: list[str] = []
    seen = set()
    for p in points:
        for k in p["props"]:
            if k not in seen:
                seen.add(k)
                keys.append(k)

    has_name = any(p["name"] for p in points)
    has_alt = _altitudes([p["alt"] for p in points])

    declared = [NAME_COLUMN] if has_name else []
    declared += [Y_COLUMN, X_COLUMN] if projected else [LAT_COLUMN, LON_COLUMN]
    if has_alt:
        declared.append(ALT_COLUMN)

    # header_names resolves the collisions; ours come first so ours keep the
    # plain names and a property called "Latitude" becomes "Latitude.1".
    columns = header_names(declared + keys)
    own, extra = columns[:len(declared)], columns[len(declared):]

    _check_cells(len(points), len(columns))

    body = []
    for p in points:
        row = []
        if has_name:
            row.append(p["name"])
        row += [p["lat"], p["lon"]]
        if has_alt:
            row.append(p["alt"])
        row += [p["props"].get(k, "") for k in keys]
        body.append(row)

    return GeoTable(
        pd.DataFrame(body, columns=own + extra, dtype=str), notes, crs,
    )


# ---------------------------------------------------------------------------
# XML shared between KML and GPX
# ---------------------------------------------------------------------------

def _local(tag) -> str:
    """An element's name without its namespace.

    KML in the wild carries at least four namespaces - the OGC 2.2 one, Google's
    2.0 and 2.1, and files with none at all - and GPX carries two. Matching the
    namespace URI would reject most real files for no benefit, since the element
    names do not collide.
    """
    if not isinstance(tag, str):
        return ""
    return tag.rsplit("}", 1)[-1]


def _children(elem, name: str):
    """Direct children of ``elem`` whose local name is ``name``."""
    return [c for c in elem if _local(c.tag) == name]


def _descendants(elem, name: str):
    """Every descendant of ``elem`` whose local name is ``name``."""
    return [c for c in elem.iter() if _local(c.tag) == name]


def _first(elem, name: str):
    found = _children(elem, name)
    return found[0] if found else None


def _text(elem) -> str:
    """All the text under ``elem``, tags removed, whitespace collapsed.

    ``itertext`` rather than ``.text`` because a value can be interrupted by
    markup - a ``<description>`` holding an HTML table is the common case, and
    ``.text`` would return only whatever preceded the first tag.
    """
    if elem is None:
        return ""
    return " ".join("".join(elem.itertext()).split())


def _parse_xml(data: bytes):
    """Parse bytes into an element tree, with a readable failure.

    The encoding is the document's own business: an XML declaration names it and
    the parser honours it, which is why this takes bytes rather than the decoded
    text the CSV reader works from.
    """
    try:
        return ET.fromstring(data)
    except ET.ParseError as e:
        raise ValueError(f"the file is not valid XML: {e}") from None


# ---------------------------------------------------------------------------
# KML and KMZ
# ---------------------------------------------------------------------------

def _kml_from_kmz(data: bytes) -> bytes:
    """The KML document inside a KMZ.

    The entry is conventionally ``doc.kml`` and is not required to be: the
    specification says the first ``.kml`` file in the archive is the document,
    so that is what this takes, with ``doc.kml`` preferred when both exist.
    """
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        expanded = sum(i.file_size for i in archive.infolist())
        if expanded > MAX_XLSX_BYTES:
            raise FileTooLarge("expanded_bytes", expanded, MAX_XLSX_BYTES)
        names = [n for n in archive.namelist() if n.lower().endswith(".kml")]
        if not names:
            raise ValueError("the archive holds no .kml document")
        preferred = next((n for n in names if n.lower() == "doc.kml"), names[0])
        return archive.read(preferred)


def _kml_coordinates(text: str) -> tuple[str, str, str] | None:
    """The first ``lon,lat[,alt]`` tuple of a ``<coordinates>`` element.

    The text is kept exactly as the file wrote it. Parsing it to a float and
    printing it again would introduce a rounding the file did not have, and
    these values go straight into a column the user reads.

    Whitespace separates tuples and commas separate the parts, and real files
    indent across lines, so both are treated as separators of their own kind.
    """
    first = text.split()
    if not first:
        return None
    parts = first[0].split(",")
    if len(parts) < 2:
        return None
    lon, lat = parts[0].strip(), parts[1].strip()
    alt = parts[2].strip() if len(parts) > 2 else ""
    if lon == "" or lat == "":
        return None
    return lat, lon, alt


def _kml_properties(placemark) -> dict:
    """The attributes of a Placemark, whichever dialect wrote them.

    Three are in circulation and a reader that knows one returns empty columns
    for the other two:

    * ``<ExtendedData><Data name="x"><value>v</value></Data>`` - what GeoCoord
      writes, and ArcGIS. A ``<displayName>`` may precede the value.
    * ``<ExtendedData><SchemaData><SimpleData name="x">v</SimpleData>`` - what
      QGIS and ogr2ogr write.
    * ``<description>`` holding prose or an HTML table - what Google Earth
      writes, and there is nothing structured to recover, so it is kept whole
      as one column rather than guessed at.
    """
    props: dict[str, str] = {}
    for ext in _children(placemark, "ExtendedData"):
        for data in _descendants(ext, "Data"):
            key = data.get("name")
            if not key:
                continue
            value = _first(data, "value")
            props[key] = _text(value) if value is not None else ""
        for simple in _descendants(ext, "SimpleData"):
            key = simple.get("name")
            if key:
                props[key] = _text(simple)

    description = _text(_first(placemark, "description"))
    if description:
        props.setdefault("description", description)
    return props


def read_kml_bytes(data: bytes, name: str = "") -> GeoTable:
    """Read a KML or KMZ into a table of its point Placemarks.

    A KMZ is recognised by its bytes rather than by ``name``: it is a zip, and
    zips start with ``PK``. The filename is accepted for symmetry with
    :func:`geocoord.reader.read_excel_bytes` and as a fallback.

    A Placemark holding a LineString, a Polygon or a Track has no single
    position and is skipped and counted, not reduced to a vertex. A Point inside
    a ``<MultiGeometry>`` is read, since that is only a wrapper.
    """
    _check_size(data)
    if data[:2] == b"PK" or name.lower().endswith(".kmz"):
        data = _kml_from_kmz(data)
        _check_size(data)

    root = _parse_xml(data)
    points: list[dict] = []
    skipped = 0

    for placemark in _descendants(root, "Placemark"):
        coordinates = _descendants(placemark, "coordinates")
        # A Point's own coordinates, not a LineString's: look for the Point.
        point_coords = [
            c for p in _descendants(placemark, "Point")
            for c in _descendants(p, "coordinates")
        ]
        chosen = point_coords[0] if point_coords else None
        if chosen is None:
            if coordinates:
                skipped += 1          # a line, a polygon, a ring
            continue
        parsed = _kml_coordinates(_text(chosen))
        if parsed is None:
            skipped += 1
            continue
        lat, lon, alt = parsed
        points.append({
            "lat": lat,
            "lon": lon,
            "alt": alt,
            "name": _text(_first(placemark, "name")),
            "props": _kml_properties(placemark),
        })

    notes = []
    if skipped:
        notes.append(_note("geo_skipped_non_points", count=skipped))
    return _build(points, notes)


# ---------------------------------------------------------------------------
# GPX
# ---------------------------------------------------------------------------

#: The waypoint-like elements, in the order they are preferred. A file with
#: marked waypoints is a file whose points somebody chose; a track is a
#: recording of where the receiver happened to be, at a point a second.
_GPX_KINDS = (("wpt", "gpx_from_waypoints"),
              ("rtept", "gpx_from_route"),
              ("trkpt", "gpx_from_track"))

#: Waypoint children worth a column. ``<extensions>`` is read separately.
_GPX_FIELDS = ("name", "cmt", "desc", "sym", "type", "time", "src")


def _gpx_extensions(point) -> dict:
    """Attribute columns hidden in ``<extensions>``.

    ogr2ogr and QGIS put a layer's own fields there as ``<ogr:field>value``,
    which is where a GPX exported from a GIS keeps everything that made it worth
    exporting. Garmin puts display preferences there instead, which are not
    interesting but are harmless: leaf elements with text become columns and
    anything with children is left alone.
    """
    props: dict[str, str] = {}
    for ext in _children(point, "extensions"):
        for node in ext.iter():
            if node is ext or len(node):
                continue
            text = _text(node)
            if text:
                props.setdefault(_local(node.tag), text)
    return props


def read_gpx_bytes(data: bytes) -> GeoTable:
    """Read a GPX into a table of its points.

    Waypoints if the file has any; otherwise the points of its routes; otherwise
    the points of its tracks. A receiver exports a day's walk as a track and
    nothing else, so a reader that only understood ``<wpt>`` would hand back an
    empty table from the most ordinary file there is. When waypoints *and* a
    track are both present the waypoints win and the track is reported rather
    than silently appended - a track is thousands of rows a second apart, which
    is not what somebody converting a list of sample sites is asking for.
    """
    _check_size(data)
    root = _parse_xml(data)

    found = {kind: _descendants(root, kind) for kind, _ in _GPX_KINDS}
    chosen_kind = next((k for k, _ in _GPX_KINDS if found[k]), None)
    notes: list[dict] = []
    if chosen_kind is None:
        return GeoTable(pd.DataFrame(), notes)

    code = dict(_GPX_KINDS)[chosen_kind]
    if chosen_kind != "wpt":
        notes.append(_note(code, count=len(found[chosen_kind])))
    else:
        ignored = len(found["trkpt"]) + len(found["rtept"])
        if ignored:
            notes.append(_note("gpx_ignored_tracks", count=ignored))

    points = []
    skipped = 0
    for node in found[chosen_kind]:
        lat, lon = node.get("lat"), node.get("lon")
        if not lat or not lon:
            skipped += 1
            continue
        props = {}
        for field in _GPX_FIELDS:
            child = _first(node, field)
            if child is not None:
                props[field] = _text(child)
        props.update(_gpx_extensions(node))
        points.append({
            "lat": lat.strip(),
            "lon": lon.strip(),
            "alt": _text(_first(node, "ele")),
            "name": props.pop("name", ""),
            "props": props,
        })

    if skipped:
        notes.append(_note("geo_skipped_non_points", count=skipped))
    return _build(points, notes)


# ---------------------------------------------------------------------------
# GeoJSON
# ---------------------------------------------------------------------------

def _number(value) -> str:
    """A JSON number as text, the way :mod:`geocoord.geoexport` writes one.

    GeoJSON holds real numbers rather than text, so unlike KML and GPX there is
    nothing verbatim to carry through and the value has to be printed. Both
    ports print it the same way - Python's ``repr`` of a float, which the
    JavaScript side reproduces in ``pyFloat`` - so a file read on the desktop
    and in the browser gives the same table.
    """
    if isinstance(value, bool):
        return "true" if value else "false"
    number = float(value)
    # A whole number prints without a decimal point. JSON has one numeric type
    # and JavaScript cannot tell 7 from 7.0 after parsing, so the only rule the
    # two ports can both follow is this one - and it is the better rule anyway:
    # an identifier column of 1, 2, 3 must not come out as 1.0, 2.0, 3.0, which
    # is the same corruption read_csv_text was written to prevent.
    if number.is_integer() and abs(number) < 1e16:
        return str(int(number))
    return repr(number)


def _flatten(value) -> str:
    """One property value as a cell.

    A GeoJSON property may hold an object or an array, which a table has no
    place for. It is written back as compact JSON rather than dropped: it is
    usually an identifier or a small list, and the user can see it and decide.
    """
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float)):
        return _number(value)
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _geojson_features(node) -> list:
    """Every Feature in a document, whatever it is rooted at.

    A FeatureCollection is the usual case; a bare Feature and a bare geometry
    are both valid GeoJSON and both turn up, the second from tools that export
    "the geometry" rather than "the layer".
    """
    if not isinstance(node, dict):
        return []
    kind = node.get("type")
    if kind == "FeatureCollection":
        features = node.get("features")
        return [f for f in features if isinstance(f, dict)] if isinstance(features, list) else []
    if kind == "Feature":
        return [node]
    if kind in ("Point", "MultiPoint", "LineString", "MultiLineString",
                "Polygon", "MultiPolygon", "GeometryCollection"):
        return [{"type": "Feature", "geometry": node, "properties": {}}]
    return []


def _geojson_position(geometry) -> tuple[str, str, str] | None:
    """The position of a Point, or of the first point of a MultiPoint.

    Anything with an extent - a line, a polygon - returns None and is counted as
    skipped by the caller. GeoCoord's row is a point; a polygon has no row.
    """
    if not isinstance(geometry, dict):
        return None
    kind = geometry.get("type")
    coords = geometry.get("coordinates")
    if kind == "MultiPoint" and isinstance(coords, list) and coords:
        coords = coords[0]
    elif kind != "Point":
        return None
    if not isinstance(coords, list) or len(coords) < 2:
        return None
    lon, lat = coords[0], coords[1]
    if not isinstance(lon, (int, float)) or not isinstance(lat, (int, float)):
        return None
    if isinstance(lon, bool) or isinstance(lat, bool):
        return None
    alt = ""
    if len(coords) > 2 and isinstance(coords[2], (int, float)) \
            and not isinstance(coords[2], bool):
        alt = _number(coords[2])
    return _number(lat), _number(lon), alt


def _declared_crs(document) -> str | None:
    """An EPSG code the file declares, when it is not WGS84.

    RFC 7946 fixed GeoJSON at WGS84 and removed the member, but the 2008 form is
    still what a lot of software writes, QGIS included, and a file in
    ETRS89/PT-TM06 whose coordinates are metres would otherwise be read as
    degrees and rejected row by row with nothing to explain why.
    """
    crs = document.get("crs") if isinstance(document, dict) else None
    if not isinstance(crs, dict):
        return None
    name = (crs.get("properties") or {}).get("name")
    if not isinstance(name, str):
        return None
    if name.strip().lower() in _WGS84_URNS:
        return None
    match = _EPSG_IN_URN.search(name.strip())
    return f"EPSG:{match.group(1)}" if match else name.strip()


def read_geojson_bytes(data: bytes) -> GeoTable:
    """Read a GeoJSON into a table of its point features.

    Properties keep the order they appear in, per feature, unioned across the
    file. A feature's ``id`` sits outside ``properties`` in the specification and
    is carried as a column of its own, because it is usually the only stable
    identifier the file has.
    """
    _check_size(data)
    text = data.decode("utf-8-sig", errors="replace")
    try:
        document = json.loads(text)
    except json.JSONDecodeError as e:
        raise ValueError(f"the file is not valid JSON: {e}") from None

    crs = _declared_crs(document)
    features = _geojson_features(document)
    points = []
    skipped = 0

    for feature in features:
        position = _geojson_position(feature.get("geometry"))
        if position is None:
            skipped += 1
            continue
        lat, lon, alt = position
        props: dict[str, str] = {}
        if feature.get("id") is not None:
            props["id"] = _flatten(feature["id"])
        raw = feature.get("properties")
        if isinstance(raw, dict):
            for key, value in raw.items():
                props[str(key)] = _flatten(value)
        points.append({
            "lat": lat, "lon": lon, "alt": alt,
            "name": "", "props": props,
        })

    notes = []
    if skipped:
        notes.append(_note("geo_skipped_non_points", count=skipped))
    if crs:
        notes.append(_note("geojson_crs", crs=crs))
    return _build(points, notes, crs, projected=crs is not None)


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

#: Extensions this module reads, for an interface's upload filter.
EXTENSIONS = (".kml", ".kmz", ".geojson", ".json", ".gpx")


def is_geospatial(name: str) -> bool:
    """Whether ``name`` is a file this module reads."""
    return name.lower().endswith(EXTENSIONS)


def read_geospatial_bytes(data: bytes, name: str) -> GeoTable:
    """Read whichever of the three formats ``name`` says this is."""
    lowered = name.lower()
    if lowered.endswith((".kml", ".kmz")):
        return read_kml_bytes(data, name)
    if lowered.endswith(".gpx"):
        return read_gpx_bytes(data)
    if lowered.endswith((".geojson", ".json")):
        return read_geojson_bytes(data)
    raise ValueError(f"not a geospatial file this application reads: {name}")
