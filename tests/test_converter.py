"""Tests for the conversion engine.

Run with:  python -m pytest
"""
import math

import numpy as np
import pytest

from converter import in_range, parse_coordinate


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
