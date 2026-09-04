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
import json
import math
import pathlib

import pandas as pd
import pytest

from geocoord.converter import (
    detect_swaps,
    format_dms,
    identify_region,
    in_range,
    parse_coordinate,
    point_in_mask,
    region_check,
    tidy_table,
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
