"""Tests for the conversion engine.

Run with:  python -m pytest
"""
import io
import math

import numpy as np
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


def approx(value, expected):
    assert value is not None
    assert math.isclose(value, expected, abs_tol=1e-6)


# --- Decimal ----------------------------------------------------------------

def test_decimal_positive():
    approx(parse_coordinate("38.708333"), 38.708333)


def test_decimal_negative():
    approx(parse_coordinate("-9.5"), -9.5)


def test_decimal_comma():
    approx(parse_coordinate("38,5"), 38.5)


def test_native_float():
    approx(parse_coordinate(-9.139), -9.139)


# --- DMS with hemisphere ----------------------------------------------------

def test_dms_north():
    approx(parse_coordinate('38° 42\' 30" N'), 38 + 42 / 60 + 30 / 3600)


def test_dms_west_english():
    approx(parse_coordinate('9° 30\' 0" W'), -(9 + 30 / 60))


def test_dms_west_portuguese():
    # "O" (Oeste) must be treated as negative.
    approx(parse_coordinate('9° 30\' 0" O'), -(9 + 30 / 60))


def test_dms_east_positive():
    approx(parse_coordinate('7° 30\' 0" L'), 7.5)
    approx(parse_coordinate('7° 30\' 0" E'), 7.5)


def test_direction_prefix():
    approx(parse_coordinate("W 9° 30'"), -9.5)


# --- Regression: negative sign without hemisphere ---------------------------

def test_dms_negative_sign_without_direction():
    # Previously returned +9.5 (sign dropped). Must be -9.5.
    approx(parse_coordinate('-9° 30\' 0"'), -9.5)


# --- Regression: hemisphere letter written against the number ----------------

def test_hemisphere_glued_to_digits():
    # "38.5W" previously returned +38.5: the word boundary failed because a
    # digit and a letter are both word characters, so the hemisphere was
    # dropped in silence. Writing the letter against the number is common and
    # must mean the same as writing it after a space.
    approx(parse_coordinate("38.5W"), -38.5)
    approx(parse_coordinate("9.5W"), -9.5)
    approx(parse_coordinate("15.25S"), -15.25)
    approx(parse_coordinate("38.5E"), 38.5)
    approx(parse_coordinate("38.5N"), 38.5)


def test_masculine_ordinal_is_accepted_as_a_degree_sign():
    # On a Portuguese keyboard "º" (U+00BA) is far easier to reach than "°"
    # (U+00B0), and the two are near-indistinguishable on screen. But "º" is a
    # letter to Unicode, so it used to shield an adjacent hemisphere letter from
    # the guard and "9ºO" read as +9.0 — the sign silently lost.
    approx(parse_coordinate("9ºO"), -9.0)
    approx(parse_coordinate("9º30'O"), -9.5)
    approx(parse_coordinate("38º42'30\"N"), 38 + 42 / 60 + 30 / 3600)
    # The feminine ordinal is on the same key and behaves the same way.
    approx(parse_coordinate("9ªO"), -9.0)
    # The real degree sign is unaffected.
    approx(parse_coordinate("9°O"), -9.0)


def test_small_float_is_not_read_as_exponent_digits():
    # A value below 1e-4 stringifies to exponential notation, and the digits of
    # the exponent used to be parsed as minutes: 1e-05 became 1.0833. Anything
    # already numeric is decimal degrees and must be taken as it stands.
    approx(parse_coordinate(1e-5), 1e-5)
    approx(parse_coordinate(1e-6), 1e-6)
    approx(parse_coordinate(1e-7), 1e-7)
    approx(parse_coordinate(1e16), 1e16)
    approx(parse_coordinate(-9.139), -9.139)
    approx(parse_coordinate(38), 38.0)


def test_hemisphere_inside_word_is_still_ignored():
    # The guard exists so a letter inside a word is not read as a hemisphere.
    # That must survive the fix above, accented words included.
    approx(parse_coordinate("38 Oeste"), 38.0)
    approx(parse_coordinate("38 Norte"), 38.0)
    approx(parse_coordinate("38 Nível"), 38.0)
    assert parse_coordinate("Norte") is None


# --- Degrees with decimal minutes (DM) --------------------------------------

def test_dm_decimal_minutes():
    approx(parse_coordinate("38° 42.5'"), 38 + 42.5 / 60)


def test_dm_negative():
    approx(parse_coordinate("-9° 8.34'"), -(9 + 8.34 / 60))


# --- Varied formats ---------------------------------------------------------

def test_no_spaces():
    approx(parse_coordinate('38°42\'30"N'), 38 + 42 / 60 + 30 / 3600)


def test_space_separated():
    approx(parse_coordinate("38 42 30 N"), 38 + 42 / 60 + 30 / 3600)


def test_degrees_only():
    approx(parse_coordinate("38°"), 38.0)


# --- Empty / invalid --------------------------------------------------------

@pytest.mark.parametrize("v", [None, "", "  ", "-", np.nan, float("nan"), "texto"])
def test_empty_and_invalid(v):
    assert parse_coordinate(v) is None


# --- Range validation -------------------------------------------------------

def test_in_range_lat():
    assert in_range(38.7, "lat")
    assert not in_range(95.0, "lat")
    assert not in_range(None, "lat")


def test_in_range_lon():
    assert in_range(-9.1, "lon")
    assert not in_range(200.0, "lon")


# --- DD -> DMS formatting (round-trip) --------------------------------------

@pytest.mark.parametrize("value,axis", [
    (38.708333, "lat"),
    (-9.136667, "lon"),
    (0.0, "lat"),
    (-0.5, "lon"),
    (89.999, "lat"),
])
def test_format_dms_round_trip(value, axis):
    text = format_dms(value, axis)
    assert text is not None
    assert text[-1] in "NSEW"
    back = parse_coordinate(text)
    assert math.isclose(back, value, abs_tol=1e-4)


def test_format_dms_hemisphere():
    assert format_dms(1.0, "lat").endswith("N")
    assert format_dms(-1.0, "lat").endswith("S")
    assert format_dms(1.0, "lon").endswith("E")
    assert format_dms(-1.0, "lon").endswith("W")


def test_format_dms_none():
    assert format_dms(None, "lat") is None
    assert format_dms(float("nan"), "lon") is None


# --- Tidying messy spreadsheet exports --------------------------------------

# A real-world Excel-exported CSV: a blank first line, a leading empty 'index'
# column, and decimal commas inside quoted fields.
MESSY_CSV = (
    ',,,\n'
    ',Amostras,Y,X\n'
    ',1,"33,6603","-15,9469"\n'
    ',2,"33,6664","-15,9364"\n'
)


def test_tidy_table_messy_export_recovers_header_and_columns():
    raw = pd.read_csv(io.StringIO(MESSY_CSV), sep=",", engine="python")
    tidy = tidy_table(raw)
    # The real header is recovered and the empty index column is gone.
    assert list(tidy.columns) == ["Amostras", "Y", "X"]
    assert len(tidy) == 2
    # Values keep their decimal comma; parse_coordinate understands them.
    approx(parse_coordinate(tidy["Y"].iloc[0]), 33.6603)
    approx(parse_coordinate(tidy["X"].iloc[0]), -15.9469)


def test_tidy_table_drops_empty_column_and_rows():
    df = pd.DataFrame({
        "idx": [None, None, None],
        "lat": ["39.0", None, "38.9"],
        "lon": ["-8.0", None, "-7.9"],
    })
    tidy = tidy_table(df)
    assert "idx" not in tidy.columns
    assert list(tidy.columns) == ["lat", "lon"]
    assert len(tidy) == 2  # the all-empty middle row is dropped


def test_tidy_table_leaves_clean_table_unchanged():
    df = pd.DataFrame({"lat": [39.0, 38.9], "lon": [-8.0, -7.9]})
    tidy = tidy_table(df)
    assert list(tidy.columns) == ["lat", "lon"]
    assert len(tidy) == 2
    assert tidy["lat"].tolist() == [39.0, 38.9]


def test_tidy_table_does_not_mutate_input():
    df = pd.DataFrame({"lat": [39.0], "lon": [-8.0]})
    before = df.copy()
    tidy_table(df)
    pd.testing.assert_frame_equal(df, before)


def test_tidy_table_promotes_header_only_when_all_placeholder():
    # A genuine header with one blank column name must NOT trigger promotion.
    df = pd.DataFrame({"lat": ["39.0"], "Unnamed: 1": ["x"], "lon": ["-8.0"]})
    tidy = tidy_table(df)
    assert "lat" in tidy.columns and "lon" in tidy.columns


def test_tidy_table_blank_promoted_header_is_not_named_nan():
    # A blank cell in the promoted header row used to become a column literally
    # named "nan" (str(NaN)), and two of them collided into duplicate names —
    # which silently breaks column selection downstream. Blank headers must get
    # distinct positional names instead, and their data must be kept.
    df = pd.DataFrame(
        [[None, "lat", None, "lon"],
         ["a", "39.0", "x", "-8.0"],
         ["b", "38.9", "y", "-7.9"]],
        columns=["Unnamed: 0", "Unnamed: 1", "Unnamed: 2", "Unnamed: 3"],
    )
    tidy = tidy_table(df)
    names = [str(c) for c in tidy.columns]
    assert "nan" not in names
    assert len(set(names)) == len(names)  # no duplicates
    assert ["lat", "lon"] == [c for c in names if c in ("lat", "lon")]
    assert tidy["lat"].tolist() == ["39.0", "38.9"]
    assert len(names) == 4  # the two unlabelled columns keep their data


def test_tidy_table_blank_promoted_header_over_empty_column_is_dropped():
    # A blank header over a column with no data carries nothing worth keeping.
    df = pd.DataFrame(
        [[None, "lat", "lon"],
         [None, "39.0", "-8.0"]],
        columns=["Unnamed: 0", "Unnamed: 1", "Unnamed: 2"],
    )
    tidy = tidy_table(df)
    assert list(tidy.columns) == ["lat", "lon"]


# --- Swapped lat/lon detection ----------------------------------------------

def test_detect_swaps_single_cluster_all_ok():
    lats = [39.0, 39.1, 38.9, 39.2, 38.8, 39.05]
    lons = [-8.0, -8.1, -7.9, -8.2, -7.8, -8.05]
    labels, center = detect_swaps(lats, lons)
    assert all(s == "ok" for s in labels)


def test_detect_swaps_range():
    labels, center = detect_swaps([150.0], [20.0])
    assert labels == ["swap_range"]


def test_detect_swaps_out_of_range_and_missing():
    labels, _ = detect_swaps([200.0, None, float("nan")], [400.0, 1.0, 2.0])
    assert labels[0] == "out_of_range"
    assert labels[1] == "missing"
    assert labels[2] == "missing"


def test_detect_swaps_cluster_majority():
    # 7 correct points near Portugal + 1 with X/Y swapped (lands in Africa).
    lats = [39.0, 39.1, 38.9, 39.2, 38.8, 39.05, 39.15, -8.0]
    lons = [-8.0, -8.1, -7.9, -8.2, -7.8, -8.05, -8.15, 39.0]
    labels, center = detect_swaps(lats, lons)
    assert labels[7] == "swap_cluster"
    assert all(labels[i] == "ok" for i in range(7))
    assert center is not None


def test_detect_swaps_reference_fixes_denser_wrong_cluster():
    # The swapped group (Africa) is *denser* than the correct group (Portugal),
    # so auto mode would anchor on the wrong side. A reference fixes it.
    lats = [39.0, 39.1, 38.9, -7.5, -7.6, -7.4, -7.55, -7.45]
    lons = [-8.0, -8.1, -7.9, 40.0, 40.1, 39.9, 40.05, 39.95]
    labels, center = detect_swaps(lats, lons, reference=(39.5, -8.0), region_radius=10.0)
    assert all(labels[i] == "ok" for i in range(3))
    assert all(labels[i] == "swap_cluster" for i in range(3, 8))
    assert center == (39.5, -8.0)


def test_detect_swaps_mask_flags_outside_but_swappable():
    # Portugal bbox. Correct PT points stay OK; points that fall outside but
    # land inside the mask when swapped are flagged.
    pt_mainland = (36.8, 42.2, -9.6, -6.1)
    lats = [39.0, 39.1, -7.485822]   # last: a swapped PT point (as-is in Africa)
    lons = [-8.0, -8.1, 40.692444]
    labels, center = detect_swaps(lats, lons, mask=[pt_mainland])
    assert labels[0] == "ok" and labels[1] == "ok"
    assert labels[2] == "swap_cluster"
    assert center is None


def test_detect_swaps_mask_multi_region_no_false_positive():
    # A genuine point inside one masked region (Mozambique) is not flagged.
    pt = (36.8, 42.2, -9.6, -6.1)
    mz = (-27.0, -10.4, 30.1, 41.0)
    lats = [39.0, 38.9, -18.0]   # PT, PT, genuine Mozambique
    lons = [-8.0, -7.9, 35.0]
    labels, _ = detect_swaps(lats, lons, mask=[pt, mz])
    assert "swap_cluster" not in labels


def test_detect_swaps_two_legit_clusters_no_false_positive():
    # Portugal (6) + a genuine, non-mirror cluster in Mozambique (3).
    lats = [39.0, 39.1, 38.9, 39.2, 38.8, 39.05, -25.0, -25.1, -24.9]
    lons = [-8.0, -8.1, -7.9, -8.2, -7.8, -8.05, 32.0, 32.1, 31.9]
    labels, center = detect_swaps(lats, lons)
    assert "swap_cluster" not in labels


# --- Region awareness (valid points outside the declared region) ------------

PT_MASK = [(36.8, 42.2, -9.6, -6.1)]
MZ_MASK = [(-27.0, -10.4, 30.1, 41.0)]
REGIONS = {"Portugal mainland": PT_MASK, "Moçambique": MZ_MASK}


def test_point_in_mask():
    assert point_in_mask(39.0, -8.0, PT_MASK)
    assert not point_in_mask(-15.94, 33.66, PT_MASK)


def test_identify_region():
    assert identify_region(39.0, -8.0, REGIONS) == "Portugal mainland"
    assert identify_region(-15.94, 33.66, REGIONS) == "Moçambique"
    assert identify_region(33.66, -15.94, REGIONS) is None  # Atlantic ocean


def test_region_check_flags_outside_and_names_actual_region():
    # An iron sample really in Mozambique, plus a Portugal point, mask = Portugal.
    out_idx, detected = region_check([-15.94, 39.0], [33.66, -8.0],
                                     ["ok", "ok"], REGIONS, mask=PT_MASK)
    assert out_idx == [0]
    assert detected == {"Moçambique": 1}


def test_region_check_outside_with_no_known_region():
    # The wrong (X/Y not swapped) orientation lands in the Atlantic: no region.
    out_idx, detected = region_check([33.66], [-15.94], ["ok"], REGIONS, mask=PT_MASK)
    assert out_idx == [0]
    assert detected == {None: 1}


def test_region_check_inside_region_not_flagged():
    out_idx, detected = region_check([39.0], [-8.0], ["ok"], REGIONS, mask=PT_MASK)
    assert out_idx == [] and detected == {}


def test_region_check_auto_mode_flags_nothing():
    # No declared region (no mask, no reference) -> no expectation to violate.
    out_idx, detected = region_check([-15.94], [33.66], ["ok"], REGIONS)
    assert out_idx == [] and detected == {}


def test_region_check_ignores_non_ok_rows():
    out_idx, detected = region_check([-15.94, 200.0], [33.66, 0.0],
                                     ["swap_cluster", "out_of_range"],
                                     REGIONS, mask=PT_MASK)
    assert out_idx == []


def test_region_check_reference_mode():
    out_idx, detected = region_check([-15.94, 39.5], [33.66, -8.0], ["ok", "ok"],
                                     REGIONS, reference=(39.5, -8.0), region_radius=5.0)
    assert out_idx == [0]
    assert detected == {"Moçambique": 1}
