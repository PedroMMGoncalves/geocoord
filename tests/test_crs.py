"""Tests for the coordinate-system registry and its transformations.

The registry's own definitions are checked against the EPSG database rather
than against remembered numbers: pyproj is the authority here, and the point of
these tests is that the hand-assembled proj4 definitions - which exist because
proj4js has no transformation catalogue - still say what EPSG says.
"""
import json
import math
import pathlib

import pytest
from pyproj import CRS, Transformer

from geocoord import crs


def _distance_m(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def test_registry_is_not_empty_and_carries_wgs84():
    assert len(crs.REGISTRY) >= 17
    assert crs.WGS84 in crs.REGISTRY
    assert "+proj=longlat" in crs.WGS84_PROJ4


@pytest.mark.parametrize("code", sorted(crs.REGISTRY))
def test_every_entry_is_complete(code):
    entry = crs.get(code)
    assert entry["kind"] in ("geographic", "projected")
    assert entry["proj4"].startswith("+proj=")
    assert entry["esri_wkt"].startswith(("PROJCS[", "GEOGCS["))
    assert entry["control"], "every system needs control points"
    assert entry["pt"], "every system needs a name a Portuguese user recognises"


@pytest.mark.parametrize("code", sorted(c for c in crs.REGISTRY
                                        if crs.REGISTRY[c]["kind"] == "projected"))
def test_definition_agrees_with_epsg(code):
    """The hand-assembled definition must transform like the EPSG one.

    This is where a wrong +towgs84 rotation sign shows up: it is worth 50 m on
    Datum 73 and 61 m on Lisboa, which is small enough to pass unnoticed and
    large enough to matter.
    """
    entry = crs.get(code)
    authoritative = Transformer.from_crs(
        CRS.from_epsg(4326), CRS.from_epsg(int(code)), always_xy=True)
    for lon, lat in entry["control"]:
        assert _distance_m(authoritative.transform(lon, lat),
                           crs.from_wgs84(lon, lat, entry["proj4"])) < 0.001


@pytest.mark.parametrize("code", sorted(crs.REGISTRY))
def test_round_trip_returns_the_same_point(code):
    """Out and back must land within a centimetre.

    Not zero, and not a millimetre: a seven-parameter Helmert is applied in its
    linearised form, and the inverse uses the same parameters with the signs
    flipped rather than the true matrix inverse, so the round trip is not exact.
    The worst of these is 5.9 mm, on Porto Santo 1995 - whose own published
    accuracy is one metre, three orders of magnitude coarser. A centimetre is
    therefore comfortably inside the noise of the transformation itself, and
    tight enough that a real mistake could not hide under it.
    """
    entry = crs.get(code)
    for lon, lat in entry["control"]:
        x, y = crs.from_wgs84(lon, lat, entry["proj4"])
        back_lon, back_lat = crs.to_wgs84(x, y, entry["proj4"])
        east = abs(back_lon - lon) * 111320 * math.cos(math.radians(lat))
        north = abs(back_lat - lat) * 111320
        assert math.hypot(east, north) < 0.01


def test_madeira_1936_is_flagged_as_deprecated():
    """EPSG deprecated it and publishes no datum transformation for it, so the
    interface has to be able to say so."""
    entry = crs.get(2191)
    assert entry["deprecated"] is True
    assert "+towgs84" not in entry["proj4"]
    assert entry["note"] and "ballpark" in entry["note"]


def test_the_other_two_island_systems_are_not_deprecated():
    # The spec asked for this to be reconfirmed against the register.
    assert crs.get(2942)["deprecated"] is False
    assert crs.get(3061)["deprecated"] is False


def test_generic_utm_covers_the_palop():
    """Luanda in UTM zone 33S, checked against EPSG:32733."""
    definition = crs.utm_proj4(33, south=True)
    got = crs.from_wgs84(13.2894, -8.8390, definition)
    expected = Transformer.from_crs(
        CRS.from_epsg(4326), CRS.from_epsg(32733), always_xy=True).transform(13.2894, -8.8390)
    assert _distance_m(got, expected) < 0.001


def test_generic_utm_refuses_a_zone_that_does_not_exist():
    for zone in (0, 61, -1):
        with pytest.raises(ValueError):
            crs.utm_proj4(zone)


def test_utm_label():
    assert crs.utm_label(33, south=True) == "UTM33S"
    assert crs.utm_label(29) == "UTM29N"


def test_transform_returns_none_rather_than_infinity():
    """A point outside a projection's domain gives infinities from PROJ, which
    would travel silently into an export."""
    utm = crs.utm_proj4(29)
    assert crs.transform(None, 38.5, crs.WGS84_PROJ4, utm) == (None, None)
    x, y = crs.transform(1e30, 1e30, crs.WGS84_PROJ4, utm)
    assert x is None and y is None


def test_esri_wkt_comes_from_the_registry_for_a_known_system():
    assert crs.esri_wkt("3763") == crs.get("3763")["esri_wkt"]
    assert "ETRS" in crs.esri_wkt("3763")


def test_esri_wkt_can_be_derived_for_a_generic_zone():
    wkt = crs.esri_wkt(proj4=crs.utm_proj4(33, south=True))
    assert wkt.startswith("PROJCS[")


def test_unknown_system_is_an_error_not_a_silent_default():
    with pytest.raises(KeyError):
        crs.get(9999)


# ---------------------------------------------------------------------------
# The shared contract
# ---------------------------------------------------------------------------
_FIXTURES = json.loads(
    (pathlib.Path(__file__).parent / "fixtures" / "parity.json").read_text(encoding="utf-8")
)
_CRS = _FIXTURES["crs_transform"]


@pytest.mark.parametrize("case", _CRS["cases"], ids=[c["id"] for c in _CRS["cases"]])
def test_crs_contract(case):
    """The same control points the browser asserts against.

    This is the one section that cannot demand exact equality: the two sides run
    different libraries over the same proj4 definition. A tenth of a millimetre
    is four orders of magnitude looser than the measured disagreement and four
    orders tighter than the best of these transformations is published to.
    """
    x, y = crs.from_wgs84(case["lon"], case["lat"], case["proj4"])
    assert math.hypot(x - case["x"], y - case["y"]) < _CRS["tolerance_m"]
