"""Tests for the conversion engine.

Run with:  python -m pytest
"""
import math

import numpy as np
import pytest

from converter import detect_swaps, format_dms, in_range, parse_coordinate


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
