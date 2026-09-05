"""File reading for GeoCoord: CSV and Excel into a pandas DataFrame.

Pure functions over text and bytes, with no UI dependencies, so that the step
before :func:`geocoord.converter.tidy_table` can be tested on its own and
mirrored in the JavaScript port. Reading used to live inside `app.py` and take
a file object, which made it untestable and unportable.

The CSV half is covered by the shared parity contract
(`tests/fixtures/parity.json`, section "read_csv"): the JavaScript port reads
the same text with PapaParse and must produce the same table. The Excel half is
not, and cannot sensibly be - openpyxl and SheetJS build different intermediate
representations of the same workbook, and pinning them against each other would
freeze the internals of two third-party libraries rather than GeoCoord's own
behaviour. It is verified instead by reading one test workbook on both sides.
"""
from __future__ import annotations

import csv
import io

import pandas as pd

# The separators the application offers, and the only ones worth sniffing for.
SEPARATORS = (",", ";", "\t", "|")

# A byte-order mark is not whitespace to Python and would otherwise become part
# of the first column's name.
_BOM = "﻿"


def sniff_separator(sample: str) -> str:
    """The delimiter used by ``sample``, or a comma when there is none to find.

    Sniffing is done here rather than left to ``pd.read_csv(sep=None)`` because
    of what pandas does when :class:`csv.Sniffer` fails: it guesses a character
    out of the data itself. ``"lat\\n39.0\\n"`` came back as the columns
    ``['la', 'Unnamed: 1']`` - the header cut in half at the "t", in silence. A
    file with a single column is useless to GeoCoord either way, but it should
    not be quietly mangled on the way to being useless.
    """
    try:
        return csv.Sniffer().sniff(sample, delimiters="".join(SEPARATORS)).delimiter
    except csv.Error:
        return ","


def read_csv_text(text: str, sep: str | None = None, decimal: str = ".") -> pd.DataFrame:
    """Parse CSV text into a dataframe.

    ``sep`` of ``None`` means detect it; anything else is used as given.

    ``decimal`` is passed through to pandas, but note that it does nothing on
    the messy-export path this application exists to handle: when the real
    header sits in the first data row, the column is object dtype and pandas
    never parses it as a number. ``"33,6603"`` arrives at
    :func:`geocoord.converter.parse_coordinate` as a string either way. The
    option only bites on a clean file whose column really is numeric.
    """
    if text.startswith(_BOM):
        text = text[len(_BOM):]
    if sep is None:
        sep = sniff_separator(text[:8192])
    return pd.read_csv(io.StringIO(text), sep=sep, decimal=decimal)


def read_csv_bytes(data: bytes, sep: str | None = None, decimal: str = ".") -> pd.DataFrame:
    """Decode ``data`` and parse it, preferring utf-8 and falling back to latin1.

    Spreadsheet exports out of older Windows tooling are routinely latin1, and
    failing on them would be worse than reading them slightly wrong: latin1
    decodes any byte sequence, so this always produces something.
    """
    for encoding in ("utf-8", "latin1"):
        try:
            return read_csv_text(data.decode(encoding), sep=sep, decimal=decimal)
        except UnicodeDecodeError:
            continue
    return read_csv_text(data.decode("latin1", errors="replace"), sep=sep, decimal=decimal)


def excel_engine(name: str) -> str:
    """The pandas engine for a workbook, chosen by extension.

    ``.xlsx`` goes to openpyxl and everything else to xlrd, which is what reads
    the legacy BIFF ``.xls`` files that still turn up in field data.
    """
    return "openpyxl" if name.lower().endswith(".xlsx") else "xlrd"
