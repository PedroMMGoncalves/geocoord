"""Tests for the coordinate-system registry and its transformations.

The registry's definitions are checked against an authority rather than against
remembered numbers. For the Portuguese datums that is the Direção-Geral do
Território: its own transformation service's answers, frozen in
``fixtures/dgt_reference.json``, which these definitions must reproduce to the
millimetre DGT rounds to. For everything else it is the EPSG database, through
pyproj: the hand-assembled proj4 definitions - which exist because proj4js has
no transformation catalogue - must still say what EPSG says.
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


#: Systems whose transformation is DGT's rather than EPSG's choice.
_FROM_DGT = sorted(c for c in crs.REGISTRY if "transformation" in crs.REGISTRY[c])


@pytest.mark.parametrize("code", sorted(c for c in crs.REGISTRY
                                        if crs.REGISTRY[c]["kind"] == "projected"
                                        and c not in _FROM_DGT))
def test_definition_agrees_with_epsg(code):
    """The hand-assembled definition must transform like the EPSG one.

    This is where a wrong +towgs84 rotation sign shows up: it is worth 50 m on
    Datum 73 and 61 m on Lisboa, which is small enough to pass unnoticed and
    large enough to matter. The Portuguese datums are not here: their
    transformations are DGT's, better than the ones EPSG would pick, and they
    are held to DGT's own answers below.
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
    The worst of these is 7 mm, on the Base SE datum of Madeira and Porto Santo,
    whose parameters carry a rotation of seventeen seconds. DGT's own service
    inverts them the same way - its answers back from PTRA08 are matched to the
    half millimetre it rounds to - and publishes them to 5 cm. A centimetre is
    inside that, and tight enough that a real mistake could not hide under it.
    """
    entry = crs.get(code)
    for lon, lat in entry["control"]:
        x, y = crs.from_wgs84(lon, lat, entry["proj4"])
        back_lon, back_lat = crs.to_wgs84(x, y, entry["proj4"])
        east = abs(back_lon - lon) * 111320 * math.cos(math.radians(lat))
        north = abs(back_lat - lat) * 111320
        assert math.hypot(east, north) < 0.01


def test_madeira_1936_is_porto_santo_1936_under_a_retired_code():
    """EPSG retired 2191 as a duplicate of 2942 - the same Base SE datum - so it
    takes the same definition, and the interface still marks the code."""
    entry = crs.get(2191)
    assert entry["deprecated"] is True
    assert entry["proj4"] == crs.get(2942)["proj4"]
    assert "2942" in entry["note"]


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
# DGT's own answers
# ---------------------------------------------------------------------------
_DGT = json.loads(
    (pathlib.Path(__file__).parent / "fixtures" / "dgt_reference.json").read_text(encoding="utf-8")
)


@pytest.mark.parametrize("case", _DGT["cases"], ids=[c["id"] for c in _DGT["cases"]])
def test_agrees_with_dgt(case):
    """Each synthetic point as DGT's transformation service moved it.

    Straight from one system to the other, as DGT does it - Lisboa to PT-TM06,
    PTRA08 back to an island datum - which also holds ``transform`` to going
    through WGS84 on its own. ``bursaWolf`` cases take the seven-parameter
    definition a point outside the grid falls back on, so the fallback is held
    to DGT as well. A millimetre and a half: DGT rounds to the millimetre.
    """
    source = crs.get(case["source"])["proj4"]
    target = crs.get(case["target"])["proj4"]
    if case["method"] == "bursaWolf":
        source, target = crs.FALLBACK.get(source, source), crs.FALLBACK.get(target, target)
    x, y = crs.transform(case["x"], case["y"], source, target)
    assert abs(x - case["x_dgt"]) < _DGT["tolerance_m"]
    assert abs(y - case["y_dgt"]) < _DGT["tolerance_m"]


@pytest.mark.parametrize("code", _FROM_DGT)
def test_every_dgt_system_is_held_to_dgt(code):
    """No system takes DGT's transformation without DGT's answers to check it -
    or the same definition as one that has them, as Porto Santo 1995 and
    Madeira 1936 share Porto Santo 1936's. A grid system needs both: the grid,
    and the parameters it falls back on."""
    definition = crs.get(code)["proj4"]
    checked = {crs.get(c[k])["proj4"]: set() for c in _DGT["cases"] for k in ("source", "target")}
    for c in _DGT["cases"]:
        for k in ("source", "target"):
            checked[crs.get(c[k])["proj4"]].add(c["method"])
    assert definition in checked
    if "+nadgrids=" in definition:
        assert checked[definition] == {"grelhas", "bursaWolf"}


@pytest.mark.parametrize("code", ["20790", "27493"])
def test_a_point_outside_the_grid_takes_dgts_parameters(code):
    """At sea, off the grid: the point still lands, by DGT's seven parameters -
    exactly where the fallback definition puts it. Inland the two differ by up
    to a metre and a half, which is the grid doing its work."""
    entry = crs.get(code)
    at_sea = crs.from_wgs84(-10.6, 38.6, entry["fallback"])
    assert crs.to_wgs84(*at_sea, entry["proj4"]) == crs.to_wgs84(*at_sea, entry["fallback"])
    inland = crs.from_wgs84(-8.0, 39.5, entry["proj4"])
    assert _distance_m(inland, crs.from_wgs84(-8.0, 39.5, entry["fallback"])) > 0.2


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
