"""Generate tests/fixtures/parity.json — the pytest <-> vitest contract.

Run deliberately, review the diff by eye, then commit:

    python scripts/gen_parity_fixtures.py

The inputs below are chosen by hand; the expected values are computed with the
Python implementation. Once committed the file is frozen: if Python's behaviour
changes, tests/test_parity.py fails, which is the point.

Only JSON-representable inputs go in here. Language-specific empty values
(float('nan') on the Python side, NaN/undefined on the JavaScript side) stay in
each side's own tests.
"""
import json
import pathlib
import sys

import pandas as pd

# Run as a plain script (`python scripts/gen_parity_fixtures.py`), so the repo
# root — not on sys.path by default — must be added before `geocoord` is
# importable.
ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

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

OUT = ROOT / "tests" / "fixtures" / "parity.json"

PARSE_INPUTS = [
    ("decimal_positive", "38.708333"),
    ("decimal_negative", "-9.5"),
    ("decimal_comma", "38,5"),
    ("native_float", -9.139),
    ("native_int", 38),
    ("dms_north", '38° 42\' 30" N'),
    ("dms_west_english", '9° 30\' 0" W'),
    ("dms_west_portuguese", '9° 30\' 0" O'),
    ("dms_east_portuguese", '7° 30\' 0" L'),
    ("dms_east_english", '7° 30\' 0" E'),
    ("dms_south", '15° 30\' 0" S'),
    ("direction_prefix", "W 9° 30'"),
    ("minus_without_direction", '-9° 30\' 0"'),
    ("dm_decimal_minutes", "38° 42.5'"),
    ("dm_negative", "-9° 8.34'"),
    ("no_spaces", '38°42\'30"N'),
    # The negative counterpart of no_spaces. It exists because no_spaces uses N,
    # which is positive whichever way a port reads it: a port matching the
    # hemisphere on whitespace instead of a word boundary passes no_spaces and
    # still gets this one wrong, returning +38.5.
    ("no_spaces_negative_hemisphere", '38°30\'0"O'),
    ("space_separated", "38 42 30 N"),
    ("degrees_only", "38°"),
    ("four_numbers_extra_ignored", '38° 42\' 30" 5 N'),
    ("hemisphere_inside_word", "38 Oeste"),
    ("hemisphere_glued_to_digits", "38.5W"),
    ("hemisphere_after_space", "38.5 W"),
    ("word_only_no_digits", "Norte"),
    ("empty", ""),
    ("whitespace", "   "),
    ("lone_minus", "-"),
    ("em_dash", "—"),
    ("text", "texto"),
    ("null", None),
]

IN_RANGE_INPUTS = [
    ("lat_valid", 38.7, "lat"),
    ("lat_high", 95.0, "lat"),
    ("lat_boundary_low", -90.0, "lat"),
    ("lat_boundary_high", 90.0, "lat"),
    ("lat_null", None, "lat"),
    ("lon_valid", -9.1, "lon"),
    ("lon_high", 200.0, "lon"),
    ("lon_boundary_low", -180.0, "lon"),
    ("lon_boundary_high", 180.0, "lon"),
]

FORMAT_DMS_INPUTS = [
    ("lat_positive", 38.708333, "lat"),
    ("lon_negative", -9.136667, "lon"),
    ("zero_lat", 0.0, "lat"),
    ("half_degree_west", -0.5, "lon"),
    ("near_pole", 89.999, "lat"),
    ("one_north", 1.0, "lat"),
    ("one_south", -1.0, "lat"),
    ("one_east", 1.0, "lon"),
    ("one_west", -1.0, "lon"),
    ("rounding_rollover", 38.99999999, "lat"),
    ("null", None, "lat"),
]

PT = [36.8, 42.2, -9.6, -6.1]
MZ = [-27.0, -10.4, 30.1, 41.0]
REGIONS = {"Portugal mainland": [PT], "Moçambique": [MZ]}

DETECT_INPUTS = [
    {
        "id": "single_cluster_all_ok",
        "lats": [39.0, 39.1, 38.9, 39.2, 38.8, 39.05],
        "lons": [-8.0, -8.1, -7.9, -8.2, -7.8, -8.05],
        "kwargs": {},
    },
    {
        "id": "range_swap",
        "lats": [150.0],
        "lons": [20.0],
        "kwargs": {},
    },
    {
        "id": "out_of_range_and_missing",
        "lats": [200.0, None],
        "lons": [400.0, 1.0],
        "kwargs": {},
    },
    {
        "id": "below_min_cluster_no_cluster_step",
        "lats": [39.0, 39.1],
        "lons": [-8.0, -8.1],
        "kwargs": {},
    },
    {
        "id": "cluster_majority",
        "lats": [39.0, 39.1, 38.9, 39.2, 38.8, 39.05, 39.15, -8.0],
        "lons": [-8.0, -8.1, -7.9, -8.2, -7.8, -8.05, -8.15, 39.0],
        "kwargs": {},
    },
    {
        "id": "two_legit_clusters_no_false_positive",
        "lats": [39.0, 39.1, 38.9, 39.2, 38.8, 39.05, -25.0, -25.1, -24.9],
        "lons": [-8.0, -8.1, -7.9, -8.2, -7.8, -8.05, 32.0, 32.1, 31.9],
        "kwargs": {},
    },
    {
        "id": "reference_fixes_denser_wrong_cluster",
        "lats": [39.0, 39.1, 38.9, -7.5, -7.6, -7.4, -7.55, -7.45],
        "lons": [-8.0, -8.1, -7.9, 40.0, 40.1, 39.9, 40.05, 39.95],
        "kwargs": {"reference": [39.5, -8.0], "region_radius": 10.0},
    },
    {
        "id": "mask_flags_outside_but_swappable",
        "lats": [39.0, 39.1, -7.485822],
        "lons": [-8.0, -8.1, 40.692444],
        "kwargs": {"mask": [PT]},
    },
    {
        "id": "mask_multi_region_no_false_positive",
        "lats": [39.0, 38.9, -18.0],
        "lons": [-8.0, -7.9, 35.0],
        "kwargs": {"mask": [PT, MZ]},
    },
]

REGION_CHECK_INPUTS = [
    {
        "id": "flags_outside_and_names_actual_region",
        "lats": [-15.94, 39.0],
        "lons": [33.66, -8.0],
        "labels": ["ok", "ok"],
        "kwargs": {"mask": [PT]},
    },
    {
        "id": "outside_with_no_known_region",
        "lats": [33.66],
        "lons": [-15.94],
        "labels": ["ok"],
        "kwargs": {"mask": [PT]},
    },
    {
        "id": "inside_region_not_flagged",
        "lats": [39.0],
        "lons": [-8.0],
        "labels": ["ok"],
        "kwargs": {"mask": [PT]},
    },
    {
        "id": "auto_mode_flags_nothing",
        "lats": [-15.94],
        "lons": [33.66],
        "labels": ["ok"],
        "kwargs": {},
    },
    {
        "id": "ignores_non_ok_rows",
        "lats": [-15.94, 200.0],
        "lons": [33.66, 0.0],
        "labels": ["swap_cluster", "out_of_range"],
        "kwargs": {"mask": [PT]},
    },
    {
        "id": "reference_mode",
        "lats": [-15.94, 39.5],
        "lons": [33.66, -8.0],
        "labels": ["ok", "ok"],
        "kwargs": {"reference": [39.5, -8.0], "region_radius": 5.0},
    },
]

IDENTIFY_INPUTS = [
    ("portugal", 39.0, -8.0),
    ("mozambique", -15.94, 33.66),
    ("atlantic_no_region", 33.66, -15.94),
]

POINT_IN_MASK_INPUTS = [
    ("inside_portugal", 39.0, -8.0, [PT]),
    ("outside_portugal", -15.94, 33.66, [PT]),
    ("on_boundary", 36.8, -9.6, [PT]),
]

# tidy_table works on a neutral table shape so the fixture is language-agnostic:
# {"columns": [...], "rows": [[...], ...]}. The Python side converts to and from
# a DataFrame; the JavaScript side consumes the shape directly.
TIDY_INPUTS = [
    {
        "id": "messy_export_recovers_header",
        "table": {
            "columns": ["Unnamed: 0", "Unnamed: 1", "Unnamed: 2", "Unnamed: 3"],
            "rows": [
                [None, "Amostras", "Y", "X"],
                [None, "1", "33,6603", "-15,9469"],
                [None, "2", "33,6664", "-15,9364"],
            ],
        },
    },
    {
        "id": "drops_empty_column_and_rows",
        "table": {
            "columns": ["idx", "lat", "lon"],
            "rows": [
                [None, "39.0", "-8.0"],
                [None, None, None],
                [None, "38.9", "-7.9"],
            ],
        },
    },
    {
        "id": "leaves_clean_table_unchanged",
        "table": {
            "columns": ["lat", "lon"],
            "rows": [["39.0", "-8.0"], ["38.9", "-7.9"]],
        },
    },
    {
        "id": "promotes_header_only_when_all_placeholder",
        "table": {
            "columns": ["lat", "Unnamed: 1", "lon"],
            "rows": [["39.0", "x", "-8.0"]],
        },
    },
    {
        "id": "blank_strings_count_as_empty",
        "table": {
            "columns": ["lat", "blank", "lon"],
            "rows": [["39.0", "   ", "-8.0"], ["38.9", "", "-7.9"]],
        },
    },
    {
        "id": "all_empty_returns_empty_shape",
        "table": {
            "columns": ["a", "b"],
            "rows": [[None, None], ["", "   "]],
        },
    },
]


def table_to_df(table):
    return pd.DataFrame(table["rows"], columns=table["columns"])


def df_to_table(df):
    # astype(object) first: .values would otherwise find a common dtype and
    # upcast an int column to float, writing 1.0 into the frozen contract where
    # the value is an integer. The NaN guard is belt-and-braces; .where already
    # yields None on the pandas versions we support.
    #
    # Deliberately not shared with the test: a common normaliser would hide its
    # own bugs from the contract it is supposed to police.
    return {
        "columns": [str(c) for c in df.columns],
        "rows": [
            [None if v is None or (isinstance(v, float) and v != v) else v for v in row]
            for row in df.astype(object).where(df.notna(), None).values.tolist()
        ],
    }


def build():
    data = {
        "_readme": (
            "Shared contract between pytest (tests/test_parity.py) and vitest "
            "(web/tests/converter.test.js). Generated by "
            "scripts/gen_parity_fixtures.py, then frozen. Do not hand-edit: "
            "change the inputs in the generator and regenerate. Only "
            "JSON-representable inputs live here; NaN and undefined are covered "
            "by each side's own tests."
        ),
        "parse_coordinate": [
            {"id": i, "input": v, "expected": parse_coordinate(v)}
            for i, v in PARSE_INPUTS
        ],
        "in_range": [
            {"id": i, "value": v, "axis": a, "expected": in_range(v, a)}
            for i, v, a in IN_RANGE_INPUTS
        ],
        "format_dms": [
            {"id": i, "value": v, "axis": a, "expected": format_dms(v, a)}
            for i, v, a in FORMAT_DMS_INPUTS
        ],
        "point_in_mask": [
            {"id": i, "lat": la, "lon": lo, "mask": m,
             "expected": point_in_mask(la, lo, m)}
            for i, la, lo, m in POINT_IN_MASK_INPUTS
        ],
        "identify_region": [
            {"id": i, "lat": la, "lon": lo, "regions": REGIONS,
             "expected": identify_region(la, lo, REGIONS)}
            for i, la, lo in IDENTIFY_INPUTS
        ],
        "detect_swaps": [],
        "region_check": [],
        "tidy_table": [],
    }

    for case in DETECT_INPUTS:
        labels, center = detect_swaps(case["lats"], case["lons"], **case["kwargs"])
        data["detect_swaps"].append({
            "id": case["id"],
            "lats": case["lats"],
            "lons": case["lons"],
            "kwargs": case["kwargs"],
            "expected": {
                "labels": labels,
                "center": None if center is None else [center[0], center[1]],
            },
        })

    for case in REGION_CHECK_INPUTS:
        out_idx, detected = region_check(
            case["lats"], case["lons"], case["labels"], REGIONS, **case["kwargs"]
        )
        data["region_check"].append({
            "id": case["id"],
            "lats": case["lats"],
            "lons": case["lons"],
            "labels": case["labels"],
            "regions": REGIONS,
            "kwargs": case["kwargs"],
            # detected is a dict keyed by region name or None; JSON cannot hold a
            # null key, so it travels as an ordered list of pairs.
            "expected": {
                "out_idx": out_idx,
                "detected": [[k, v] for k, v in detected.items()],
            },
        })

    for case in TIDY_INPUTS:
        tidy = tidy_table(table_to_df(case["table"]))
        data["tidy_table"].append({
            "id": case["id"],
            "table": case["table"],
            "expected": df_to_table(tidy),
        })

    return data


if __name__ == "__main__":
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(build(), ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {OUT}")
