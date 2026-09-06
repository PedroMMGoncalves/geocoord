"""The pytest half of the parity contract.

Reads tests/fixtures/parity.json and checks the Python implementation against
it. The vitest half (web/tests/converter.test.js) reads the same file, so both
implementations are held to one frozen set of cases.

What that does and does not buy, stated plainly because the difference matters.
A JavaScript change that breaks a pinned case fails here. A Python change that
breaks one fails here too. But a Python change whose effect falls outside the
pinned cases passes everything, including --check, which only asserts that the
committed file matches what the *current* Python produces. The contract catches
drift on the behaviour it pins; widening behaviour safely means adding cases,
not merely regenerating. Read the regenerated diff.
"""
import io
import json
import math
import pathlib
import zipfile

import pandas as pd
import pytest

from geocoord.converter import (
    detect_swaps,
    guess_coordinate_columns,
    hemisphere_axis,
    unsigned_outside_region,
    format_dms,
    identify_region,
    in_range,
    parse_coordinate,
    parse_projected,
    point_in_mask,
    region_check,
    tidy_table,
)
from geocoord.reader import read_csv_text
from geocoord.geoexport import (
    sanitize_filename,
    to_geojson,
    csv_safe,
    to_kml,
    to_shapefile_zip,
    _safe_field_names,
)

FIXTURES = json.loads(
    (pathlib.Path(__file__).parent / "fixtures" / "parity.json").read_text(
        encoding="utf-8"
    )
)


def ids(cases):
    return [c["id"] for c in cases]


@pytest.mark.parametrize(
    "case", FIXTURES["parse_coordinate"], ids=ids(FIXTURES["parse_coordinate"])
)
def test_parse_coordinate(case):
    got = parse_coordinate(case["input"])
    if case["expected"] is None:
        assert got is None
    else:
        assert got is not None
        assert math.isclose(got, case["expected"], rel_tol=0, abs_tol=1e-12)


@pytest.mark.parametrize(
    "case", FIXTURES["parse_projected"], ids=ids(FIXTURES["parse_projected"])
)
def test_parse_projected(case):
    assert parse_projected(case["input"]) == case["expected"]


@pytest.mark.parametrize("case", FIXTURES["in_range"], ids=ids(FIXTURES["in_range"]))
def test_in_range(case):
    assert in_range(case["value"], case["axis"]) is case["expected"]


@pytest.mark.parametrize(
    "case", FIXTURES["format_dms"], ids=ids(FIXTURES["format_dms"])
)
def test_format_dms(case):
    assert format_dms(case["value"], case["axis"]) == case["expected"]


@pytest.mark.parametrize(
    "case", FIXTURES["point_in_mask"], ids=ids(FIXTURES["point_in_mask"])
)
def test_point_in_mask(case):
    mask = [tuple(b) for b in case["mask"]]
    assert point_in_mask(case["lat"], case["lon"], mask) is case["expected"]


@pytest.mark.parametrize(
    "case", FIXTURES["identify_region"], ids=ids(FIXTURES["identify_region"])
)
def test_identify_region(case):
    regions = {k: [tuple(b) for b in v] for k, v in case["regions"].items()}
    assert identify_region(case["lat"], case["lon"], regions) == case["expected"]


@pytest.mark.parametrize(
    "case", FIXTURES["detect_swaps"], ids=ids(FIXTURES["detect_swaps"])
)
def test_detect_swaps(case):
    kwargs = dict(case["kwargs"])
    if "mask" in kwargs:
        kwargs["mask"] = [tuple(b) for b in kwargs["mask"]]
    if "reference" in kwargs:
        kwargs["reference"] = tuple(kwargs["reference"])
    labels, center = detect_swaps(case["lats"], case["lons"], **kwargs)
    assert labels == case["expected"]["labels"]
    if case["expected"]["center"] is None:
        assert center is None
    else:
        assert center is not None
        assert math.isclose(
            center[0], case["expected"]["center"][0], rel_tol=0, abs_tol=1e-12
        )
        assert math.isclose(
            center[1], case["expected"]["center"][1], rel_tol=0, abs_tol=1e-12
        )


@pytest.mark.parametrize(
    "case", FIXTURES["region_check"], ids=ids(FIXTURES["region_check"])
)
def test_region_check(case):
    kwargs = dict(case["kwargs"])
    if "mask" in kwargs:
        kwargs["mask"] = [tuple(b) for b in kwargs["mask"]]
    if "reference" in kwargs:
        kwargs["reference"] = tuple(kwargs["reference"])
    regions = {k: [tuple(b) for b in v] for k, v in case["regions"].items()}
    out_idx, detected = region_check(
        case["lats"], case["lons"], case["labels"], regions, **kwargs
    )
    assert out_idx == case["expected"]["out_idx"]
    assert [[k, v] for k, v in detected.items()] == case["expected"]["detected"]


@pytest.mark.parametrize(
    "case", FIXTURES["read_csv"], ids=ids(FIXTURES["read_csv"])
)
def test_read_csv(case):
    # Reading is the step the contract could not reach until the reader was
    # pulled out of app.py. The JavaScript side parses the same text with
    # PapaParse and must arrive at the same table.
    tidy = tidy_table(
        read_csv_text(case["text"], sep=case["sep"], decimal=case["decimal"])
    )
    assert [str(c) for c in tidy.columns] == case["expected"]["columns"]
    rows = [
        [None if v is None or (isinstance(v, float) and v != v) else v for v in row]
        for row in tidy.astype(object).where(tidy.notna(), None).values.tolist()
    ]
    assert rows == case["expected"]["rows"]


@pytest.mark.parametrize(
    "case", FIXTURES["tidy_table"], ids=ids(FIXTURES["tidy_table"])
)
def test_tidy_table(case):
    df = pd.DataFrame(case["table"]["rows"], columns=case["table"]["columns"])
    tidy = tidy_table(df)
    assert [str(c) for c in tidy.columns] == case["expected"]["columns"]
    # Deliberately not shared with the generator: a common normaliser would
    # hide its own bugs from the contract it is supposed to police.
    rows = [
        [None if v is None or (isinstance(v, float) and v != v) else v for v in row]
        for row in tidy.astype(object).where(tidy.notna(), None).values.tolist()
    ]
    assert rows == case["expected"]["rows"]


@pytest.mark.parametrize(
    "case", FIXTURES["sanitize_filename"], ids=ids(FIXTURES["sanitize_filename"])
)
def test_sanitize_filename(case):
    assert sanitize_filename(case["name"], **case["kwargs"]) == case["expected"]


@pytest.mark.parametrize(
    "case", FIXTURES["safe_field_names"], ids=ids(FIXTURES["safe_field_names"])
)
def test_safe_field_names(case):
    assert _safe_field_names(case["names"]) == case["expected"]


@pytest.mark.parametrize(
    "case", FIXTURES["to_geojson"], ids=ids(FIXTURES["to_geojson"])
)
def test_to_geojson(case):
    # The text, not the parsed object. Parsing hoists integer-like keys to the
    # front on both sides, which cancelled out a real ordering divergence.
    got = to_geojson(case["features"]).decode("utf-8")
    assert got == case["expected"]


@pytest.mark.parametrize("case", FIXTURES["to_kml"], ids=ids(FIXTURES["to_kml"]))
def test_to_kml(case):
    got = to_kml(case["features"], name_key=case["name_key"]).decode("utf-8")
    assert got == case["expected"]


def _shapefile_components(data):
    """The four shapefile parts, hex-encoded, with the DBF write date zeroed.

    Mirrors the masking in scripts/gen_parity_fixtures.py: pyshp stamps bytes
    1..3 of the DBF header with today's date and zipfile.writestr stamps every
    entry with the local time, so neither the .zip nor the raw .dbf is
    reproducible. The parts are compared instead, with the date masked.
    Deliberately not shared with the generator: a common normaliser would hide
    its own bugs from the contract it is supposed to police.
    """
    out = {}
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for name in z.namelist():
            ext = name.rsplit(".", 1)[-1]
            raw = bytearray(z.read(name))
            if ext == "dbf":
                raw[1:4] = b"\x00\x00\x00"
            out[ext] = bytes(raw).hex()
    return out


@pytest.mark.parametrize(
    "case", FIXTURES["to_shapefile_zip"], ids=ids(FIXTURES["to_shapefile_zip"])
)
def test_to_shapefile_zip(case):
    data = to_shapefile_zip(
        case["features"], case["field_names"], base_name=case["base_name"]
    )
    assert _shapefile_components(data) == case["expected"]
@pytest.mark.parametrize(
    "case", FIXTURES["guess_coordinate_columns"],
    ids=ids(FIXTURES["guess_coordinate_columns"]),
)
def test_guess_coordinate_columns(case):
    mask = [tuple(b) for b in case["mask"]]
    got = guess_coordinate_columns(case["columns"], case["rows"], mask)
    assert list(got) == case["expected"]


@pytest.mark.parametrize(
    "case", FIXTURES["unsigned_outside_region"],
    ids=ids(FIXTURES["unsigned_outside_region"]),
)
def test_unsigned_outside_region(case):
    mask = [tuple(b) for b in case["mask"]]
    assert unsigned_outside_region(case["values"], case["axis"], mask) == case["expected"]


@pytest.mark.parametrize(
    "case", FIXTURES["hemisphere_axis"], ids=ids(FIXTURES["hemisphere_axis"])
)
def test_hemisphere_axis(case):
    assert hemisphere_axis(case["input"]) == case["expected"]


@pytest.mark.parametrize("case", FIXTURES["csv_safe"], ids=ids(FIXTURES["csv_safe"]))
def test_csv_safe(case):
    assert csv_safe(case["input"]) == case["expected"]


def test_limits_match_the_contract():
    """The two implementations must refuse the same files.

    A size a colleague's desktop opens and their browser refuses - or the other
    way round - would be its own kind of surprise, and the numbers are easy to
    change on one side only.
    """
    from geocoord import reader

    limits = FIXTURES["limits"]
    assert reader.WARN_ROWS == limits["warn_rows"]
    assert reader.MAX_CELLS == limits["max_cells"]
    assert reader.MAX_XLSX_BYTES == limits["max_xlsx_bytes"]
