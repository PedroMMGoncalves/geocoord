"""Where a converted file came from, written into the file itself.

A converted table outlives the session that made it: it goes into a report, to
a colleague, into a GIS project a year later. What it cannot say on its own is
how its coordinates were obtained - from which system, by which
transformation, read in which unit, with which rows corrected - and that is
what a reader checking it needs. :func:`provenance` says it, and the writers in
:mod:`geocoord.geoexport` place it in each format that has room.

The desktop's version, in English, as that interface is. The page builds the
same list in the reader's language (``web/src/core/provenance.js``).
"""
from __future__ import annotations

from geocoord import __version__, crs

APP_URL = "https://pedrommgoncalves.github.io/geocoord/"


def system_name(system):
    """A resolved system ({proj4, label, epsg, ...}, or None for WGS 84) by name."""
    if system is None:
        return "WGS 84 (EPSG:4326)"
    return f"{system['label']} (EPSG:{system['epsg']})" if system.get("epsg") else system["label"]


def transformation_of(system):
    """How a system's coordinates were moved onto WGS 84, in a sentence.
    Mirrors transformationOf() in web/src/core/provenance.js."""
    if system is None or system["proj4"] == crs.WGS84_PROJ4 or "+datum=WGS84" in system["proj4"]:
        return "none: already WGS 84"
    entry = crs.REGISTRY.get(str(system["epsg"])) if system.get("epsg") else None
    if entry and entry.get("transformation"):
        return entry["transformation"]["accuracy"]
    if "+towgs84=" in system["proj4"] or "+nadgrids=" in system["proj4"]:
        return "the definition's own"
    return "ETRS89 / PTRA08 taken as WGS 84 (under 1 m apart)"


def provenance(*, date, file_name, sheet=None, source=None, target=None, scale=1.0, swaps=0):
    """What each download records about where it came from, as (label, value)
    pairs - a tuple, so the cached exporters can key on it.

    A converted table outlives the session that made it, and what it cannot
    say on its own is how its coordinates were obtained. Mirrors provenance()
    in web/src/core/provenance.js, in English, as this interface is; the
    writers in geocoord/geoexport.py place it in each format.
    """
    pairs = [
        ("Converted with", f"GeoCoord {__version__} ({APP_URL})"),
        ("Converted on", date),
        ("Source file", f"{file_name}, sheet {sheet}" if sheet else file_name),
        ("Source system", system_name(source)),
        ("Transformation to WGS 84", transformation_of(source)),
    ]
    entry = crs.REGISTRY.get(str(source["epsg"])) if source and source.get("epsg") else None
    if entry and entry.get("transformation"):
        pairs.append(("Source of the transformation", entry["transformation"]["source"]))
    if source is not None and source["proj4"] != crs.WGS84_PROJ4:
        pairs.append(("proj4 definition", source["proj4"]))
    if scale != 1:
        pairs.append(("Unit read", "kilometres (values multiplied by 1000)"))
    if swaps:
        rows = "row" if swaps == 1 else "rows"
        pairs.append(("Corrections accepted", f"{swaps} {rows} with latitude and longitude swapped"))
    pairs.append(("Degrees and geometry",
                  "Latitude_DD, Longitude_DD and the geometry in WGS 84 (EPSG:4326)"))
    if target is not None and target["proj4"] != crs.WGS84_PROJ4:
        pairs.append(("Extra system",
                      f"{system_name(target)}, in columns X_{target['suffix']} and "
                      f"Y_{target['suffix']}; from WGS 84: {transformation_of(target)}"))
    return tuple(pairs)
