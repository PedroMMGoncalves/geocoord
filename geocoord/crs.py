"""Coordinate reference systems: the registry, and transformation to and from it.

Every system this application offers is described by one proj4 definition, and
both implementations run that same definition - pyproj here, proj4js in the
browser. That is deliberate and it is the only arrangement that keeps the two
halves in step.

Using ``CRS.from_epsg`` here instead would be more idiomatic and would silently
break the port. PROJ 9 keeps datum transformations in its own catalogue and
chooses among them *per point*, falling back to a ballpark offset outside an
operation's declared area; proj4js has no catalogue at all and applies whatever
``+towgs84`` term its definition carries, everywhere. Two points a kilometre
apart off Madeira can therefore be transformed by different operations on the
desktop and by the same one in the browser, and the results diverge by
hundreds of metres with nothing to indicate it. One fixed definition, used by
both, is deterministic.

The definitions live in ``crs_registry.json`` beside this file, generated from
the EPSG database and checked against it: every projected system agrees with
its authoritative EPSG transformation to zero metres over control points inside
its real coverage. The registry is data rather than code so that the browser
reads the identical bytes.

One trap worth naming, since it is invisible and expensive. ``+towgs84`` is read
with the position vector convention, while PROJ declares most of these
operations with the coordinate frame convention, and the two differ only in the
sign of the three rotations. With the signs the wrong way round Datum 73 lands
50 m out and Lisboa 61 m - errors small enough to look like ordinary survey
noise and large enough to matter. The registry generator negates them, and the
control points in the parity contract are what prove it stayed that way.
"""
from __future__ import annotations

import json
import pathlib
from functools import lru_cache

from pyproj import CRS, Transformer

_REGISTRY_PATH = pathlib.Path(__file__).with_name("crs_registry.json")

#: EPSG code (as a string) -> everything the application knows about it.
REGISTRY: dict = json.loads(_REGISTRY_PATH.read_text(encoding="utf-8"))

#: The system every internal coordinate is expressed in.
WGS84 = "4326"

#: proj4 definition of WGS84, the pivot every transformation passes through.
WGS84_PROJ4 = REGISTRY[WGS84]["proj4"]


def systems(kind: str | None = None) -> list:
    """The registry as a list, in registry order, optionally filtered by kind.

    ``kind`` is ``"geographic"`` or ``"projected"``; ``None`` returns both.
    """
    return [v for v in REGISTRY.values() if kind is None or v["kind"] == kind]


def get(code) -> dict:
    """One system's entry. Accepts the code as a string or an integer."""
    entry = REGISTRY.get(str(code))
    if entry is None:
        raise KeyError(f"unknown coordinate system: {code!r}")
    return entry


def utm_proj4(zone: int, south: bool = False, datum: str = "WGS84") -> str:
    """A proj4 definition for a UTM zone, on WGS84 or ETRS89.

    The generic escape hatch: zones 1 to 60, either hemisphere. It covers
    Angola (32S, 33S), Moçambique (36S, 37S), Cabo Verde, Guiné-Bissau and São
    Tomé e Príncipe the moment somebody needs them, without this application
    having to guess at national datums it cannot verify.
    """
    if not 1 <= int(zone) <= 60:
        raise ValueError(f"UTM zone must be between 1 and 60, got {zone!r}")
    ellipsoid = "+datum=WGS84" if datum.upper() == "WGS84" else "+ellps=GRS80"
    hemisphere = " +south" if south else ""
    return f"+proj=utm +zone={int(zone)}{hemisphere} {ellipsoid} +units=m +no_defs"


def utm_label(zone: int, south: bool = False) -> str:
    """The suffix used for a generic UTM zone's output columns, e.g. "UTM33S"."""
    return f"UTM{int(zone)}{'S' if south else 'N'}"


@lru_cache(maxsize=64)
def _transformer(source: str, target: str) -> Transformer:
    """Cached transformer between two proj4 definitions.

    Building one is expensive and the application builds the same handful over
    and over, once per column per rerun.
    """
    return Transformer.from_crs(CRS.from_proj4(source), CRS.from_proj4(target),
                                always_xy=True)


def transform(x, y, source: str, target: str):
    """Transform one coordinate between two proj4 definitions.

    Always x/y order - longitude then latitude for a geographic system, easting
    then northing for a projected one - regardless of what axis order the
    authority declares. Returns ``(None, None)`` for a value that cannot be
    transformed, which is what a point outside a projection's domain gives,
    rather than the infinities PROJ returns for one.
    """
    if x is None or y is None:
        return None, None
    try:
        out_x, out_y = _transformer(source, target).transform(float(x), float(y))
    except (ValueError, TypeError):
        return None, None
    if not (_finite(out_x) and _finite(out_y)):
        return None, None
    return out_x, out_y


def _finite(v) -> bool:
    return v is not None and v == v and abs(v) != float("inf")


def to_wgs84(x, y, source: str):
    """Transform into WGS84 longitude/latitude. Returns ``(lon, lat)``."""
    return transform(x, y, source, WGS84_PROJ4)


def from_wgs84(lon, lat, target: str):
    """Transform out of WGS84 into ``target``. Returns ``(x, y)``."""
    return transform(lon, lat, WGS84_PROJ4, target)


def esri_wkt(code=None, proj4: str | None = None) -> str:
    """ESRI WKT for a shapefile's ``.prj`` sidecar.

    Registry systems carry theirs precomputed, because only pyproj can produce
    it and the browser has to write the same bytes. For a generic UTM zone or a
    pasted definition there is nothing precomputed, so it is derived here - and
    the browser, which cannot, falls back to the WGS84 sidecar and says so.
    """
    if code is not None:
        return get(code)["esri_wkt"]
    if proj4 is None:
        raise ValueError("esri_wkt needs either a registry code or a proj4 string")
    return CRS.from_proj4(proj4).to_wkt("WKT1_ESRI")
