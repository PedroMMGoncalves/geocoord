"""Tests for the file-reading layer.

Reading is the one step the parity contract could not cover until now: it
starts at tidy_table, which receives a table that is already parsed. These
tests pin the Python side of the step before it; the shared cases live in
tests/fixtures/parity.json under "read_csv".
"""
import io

import pandas as pd
import pytest

from geocoord.converter import tidy_table

from geocoord.reader import (
    excel_engine,
    read_csv_bytes,
    read_csv_text,
    read_excel_bytes,
    sniff_separator,
    workbook_sheets,
)


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


# --- Everything is read as text ---------------------------------------------

CODES = "codigo,lat\n007,38.7\n042,41.2\n"


def test_leading_zeros_survive():
    # A sample code of "007" used to be inferred as the integer 7 and exported
    # that way. Geological sample and station codes carry leading zeros as a
    # matter of course, and losing them corrupts the identifier silently.
    df = read_csv_text(CODES, sep=",", decimal=".")
    assert df["codigo"].tolist() == ["007", "042"]


def test_large_integers_keep_every_digit():
    # Beyond 2**53 a JavaScript number cannot represent an integer exactly, so
    # inferring one here would guarantee a divergence with the browser port.
    df = read_csv_text("id\n9007199254740993\n", sep=",", decimal=".")
    assert df["id"].iloc[0] == "9007199254740993"


def test_numbers_are_not_coerced():
    df = read_csv_text("lat,lon,n\n39.5,-8.25,3\n", sep=",", decimal=".")
    assert [df[c].iloc[0] for c in ("lat", "lon", "n")] == ["39.5", "-8.25", "3"]
    # And parse_coordinate still gets what it needs out of them.
    from geocoord.converter import parse_coordinate
    assert parse_coordinate(df["lat"].iloc[0]) == 39.5


def test_na_is_kept_as_written():
    # pandas would read "NA" as a missing value. What the file says is what the
    # column carries; a coordinate of "NA" fails to parse and is reported as
    # such, which is more use than a blank.
    df = read_csv_text("nome,lat\nNA,38.7\n", sep=",", decimal=".")
    assert df["nome"].iloc[0] == "NA"


def test_empty_cells_are_still_empty():
    # Blank cells must still read as missing, or tidy_table would stop dropping
    # empty rows and columns.
    tidy = tidy_table(read_csv_text("a,b\n,1\n", sep=",", decimal="."))
    assert list(tidy.columns) == ["b"]


# --- Excel engine -----------------------------------------------------------

@pytest.mark.parametrize("name,expected", [
    ("dados.xlsx", "openpyxl"),
    ("DADOS.XLSX", "openpyxl"),
    ("dados.xls", "xlrd"),
    ("dados.XLS", "xlrd"),
])
def test_excel_engine(name, expected):
    assert excel_engine(name) == expected


# ---------------------------------------------------------------------------
# Excel
# ---------------------------------------------------------------------------
def _workbook(rows, formats=()):
    """An in-memory .xlsx built cell by cell, so the cell types are exact."""
    openpyxl = pytest.importorskip("openpyxl")
    wb = openpyxl.Workbook()
    ws = wb.active
    for row in rows:
        ws.append(row)
    for (r, c, fmt) in formats:
        ws.cell(row=r, column=c).number_format = fmt
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_read_excel_keeps_leading_zeros():
    """The corruption the CSV path was rewritten to stop, on the path most
    field data actually arrives by: pandas' inference read "0071" as 71."""
    data = _workbook(
        [["amostra", "lat", "lon"], ["0071", 38.5, -9.0], ["0072", 38.6, -9.1]],
        formats=[(2, 1, "@"), (3, 1, "@")],
    )
    df = read_excel_bytes(data, "f.xlsx")
    assert list(df["amostra"]) == ["0071", "0072"]


def test_read_excel_keeps_a_long_integer_whole():
    data = _workbook([["id"], [1234567890123456]])
    assert list(read_excel_bytes(data, "f.xlsx")["id"]) == ["1234567890123456"]


def test_read_excel_keeps_full_precision_under_a_short_format():
    """The cell displays 38.71; the file holds 38.7083335. Reading what is
    displayed would move the point two and a half kilometres."""
    data = _workbook([["lat"], [38.7083335]], formats=[(2, 1, "0.00")])
    assert list(read_excel_bytes(data, "f.xlsx")["lat"]) == ["38.7083335"]


def test_read_excel_blank_in_an_id_column_does_not_make_it_a_float():
    """With inference on, one blank cell typed the column float64 and every
    identifier gained a ".0"."""
    data = _workbook([["id_lab", "nota"], [20240001, "a"], [None, "b"], [20240003, "c"]])
    assert list(read_excel_bytes(data, "f.xlsx")["id_lab"]) == ["20240001", "", "20240003"]


def test_read_excel_renders_a_date_rather_than_its_day_count():
    import datetime

    data = _workbook([
        ["data", "hora"],
        [datetime.datetime(2024, 3, 7), datetime.datetime(2024, 3, 8, 14, 30)],
    ])
    df = read_excel_bytes(data, "f.xlsx")
    assert list(df["data"]) == ["2024-03-07"]
    assert list(df["hora"]) == ["2024-03-08 14:30:00"]


def test_read_excel_is_all_text():
    data = _workbook([["a", "b"], ["x", 1]])
    df = read_excel_bytes(data, "f.xlsx")
    assert set(df.dtypes.astype(str)) == {"object"}
    assert all(isinstance(v, str) for v in df.to_numpy().ravel())


def test_read_excel_survives_tidy_table():
    data = _workbook([["amostra", "lat", "lon"], ["0071", "38.5", "-9.0"]],
                     formats=[(2, 1, "@")])
    tidied = tidy_table(read_excel_bytes(data, "f.xlsx"))
    assert list(tidied["amostra"]) == ["0071"]


def test_workbook_sheets_lists_in_book_order():
    openpyxl = pytest.importorskip("openpyxl")
    wb = openpyxl.Workbook()
    wb.active.title = "Um"
    wb.create_sheet("Dois")
    buf = io.BytesIO()
    wb.save(buf)
    assert workbook_sheets(buf.getvalue(), "f.xlsx") == ["Um", "Dois"]


def test_read_excel_reads_the_named_sheet():
    openpyxl = pytest.importorskip("openpyxl")
    wb = openpyxl.Workbook()
    wb.active.title = "Um"
    wb.active.append(["a"])
    wb.active.append(["1"])
    second = wb.create_sheet("Dois")
    second.append(["b"])
    second.append(["2"])
    buf = io.BytesIO()
    wb.save(buf)
    assert list(read_excel_bytes(buf.getvalue(), "f.xlsx", "Dois").columns) == ["b"]
