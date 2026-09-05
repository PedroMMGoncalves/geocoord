"""Tests for the file-reading layer.

Reading is the one step the parity contract could not cover until now: it
starts at tidy_table, which receives a table that is already parsed. These
tests pin the Python side of the step before it; the shared cases live in
tests/fixtures/parity.json under "read_csv".
"""
import io

import pandas as pd
import pytest

from geocoord.reader import excel_engine, read_csv_bytes, read_csv_text, sniff_separator


# --- Separator detection ----------------------------------------------------

@pytest.mark.parametrize("text,expected", [
    ("a,b\n1,2\n", ","),
    ("a;b\n1;2\n", ";"),
    ("a\tb\n1\t2\n", "\t"),
    ("a|b\n1|2\n", "|"),
    # Ambiguous: a comma and a semicolon both appear, and the comma wins on
    # both sides of the port. The column named "b;c" is the honest result.
    ("a,b;c\n1,2;3\n", ","),
])
def test_sniff_separator(text, expected):
    assert sniff_separator(text) == expected


def test_sniff_separator_falls_back_to_comma_with_nothing_to_detect():
    # A single column has no delimiter at all. Falling back to a comma yields
    # one column, which is right; guessing gets the header wrong.
    assert sniff_separator("lat\n39.0\n38.9\n") == ","


# --- Regression: the header was cut in half ---------------------------------

def test_single_column_csv_keeps_its_header():
    # pandas' own sniffing, when csv.Sniffer fails, guesses a character out of
    # the data: "lat\n39.0\n" came back as columns ['la', 'Unnamed: 1'] - the
    # header sliced at the "t", silently. A one-column file is useless to
    # GeoCoord either way, but it must not be quietly mangled on the way there.
    df = read_csv_text("lat\n39.0\n38.9\n", sep=None, decimal=".")
    assert list(df.columns) == ["lat"]
    assert len(df) == 2


# --- Reading ----------------------------------------------------------------

MESSY = (
    ',,,\n'
    ',Amostras,Y,X\n'
    ',1,"33,6603","-15,9469"\n'
    ',2,"33,6664","-15,9364"\n'
)


def test_read_csv_text_detects_the_separator_when_asked_to():
    df = read_csv_text("lat;lon\n39,0;-8,0\n", sep=None, decimal=",")
    assert list(df.columns) == ["lat", "lon"]


def test_read_csv_text_honours_an_explicit_separator():
    # With the separator forced to a comma, a semicolon file is one column.
    df = read_csv_text("lat;lon\n39.0;-8.0\n", sep=",", decimal=".")
    assert list(df.columns) == ["lat;lon"]


def test_read_csv_text_keeps_a_separator_inside_quotes():
    df = read_csv_text('nome,lat\n"Silva, Joao",39.0\n', sep=",", decimal=".")
    assert df["nome"].iloc[0] == "Silva, Joao"


def test_read_csv_text_leaves_quoted_decimal_commas_to_the_parser():
    # The decimal option has no effect here, and that is worth pinning: the
    # real header sits in the first data row, so the column is object dtype and
    # pandas never parses it as a number. parse_coordinate does the work.
    for decimal in (".", ","):
        df = read_csv_text(MESSY, sep=",", decimal=decimal)
        assert df.iloc[1, 2] == "33,6603"


def test_read_csv_bytes_recovers_from_a_failed_utf8_decode():
    # A latin1 file with an accented name: utf-8 raises, latin1 succeeds.
    data = "nome,lat\nSão Tomé,0.18\n".encode("latin1")
    df = read_csv_bytes(data, sep=",", decimal=".")
    assert df["nome"].iloc[0] == "São Tomé"


def test_read_csv_bytes_prefers_utf8():
    data = "nome,lat\nSão Tomé,0.18\n".encode("utf-8")
    df = read_csv_bytes(data, sep=",", decimal=".")
    assert df["nome"].iloc[0] == "São Tomé"


def test_read_csv_bytes_strips_a_byte_order_mark():
    data = "﻿nome,lat\nBeja,38.0\n".encode("utf-8")
    df = read_csv_bytes(data, sep=",", decimal=".")
    assert list(df.columns) == ["nome", "lat"]


# --- Excel engine -----------------------------------------------------------

@pytest.mark.parametrize("name,expected", [
    ("dados.xlsx", "openpyxl"),
    ("DADOS.XLSX", "openpyxl"),
    ("dados.xls", "xlrd"),
    ("dados.XLS", "xlrd"),
])
def test_excel_engine(name, expected):
    assert excel_engine(name) == expected
