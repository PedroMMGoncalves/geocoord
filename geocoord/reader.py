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
behaviour.

CSV parsing is done with the standard library's :mod:`csv` rather than
``pd.read_csv``. Every cell is read as text (see :func:`read_csv_text`), so
pandas' parser was contributing only things this application does not want: it
raised ``ParserError`` on a row with more fields than its header, promoted a
stray field to a row index, inferred types that lose leading zeros, and made
the JavaScript side chase all of it. The stdlib parser does none of that and is
what PapaParse behaves like on the other side.

Where the two sides stop agreeing, stated plainly: on **malformed** CSV - an
unbalanced quote, or a quote character in a file whose real delimiter is not
the one guessed - :mod:`csv` and PapaParse disagree about where a field ends,
and no amount of care here changes that without reimplementing one parser in
the other language. A differential run over 2500 generated files put it at 15
cases, every one of them carrying a stray quote. Well-formed exports agree.
"""
from __future__ import annotations

import codecs
import csv
import datetime as _dt
import io
import sys

import pandas as pd

# The separators the application offers, and the only ones worth guessing at.
SEPARATORS = (",", ";", "\t", "|")

# A byte-order mark is not whitespace to Python and would otherwise become part
# of the first column's name.
_BOM = "﻿"

# Rows read while guessing the separator. Ten is what PapaParse uses.
_GUESS_ROWS = 10

# The stdlib parser refuses a field over 128 KB by default, which pandas did
# not: a single cell holding a long description - a WKT geometry, a pasted note
# - made the whole file unreadable with "field larger than field limit". The
# ceiling is raised rather than removed, so a malformed file still fails
# instead of consuming the machine.
csv.field_size_limit(min(sys.maxsize, 64 * 1024 * 1024))

# The five bytes windows-1252 leaves undefined. A browser's TextDecoder maps
# them to the C1 control characters of the same value rather than failing, and
# this handler does the same, so a byte sequence decodes identically on both
# sides. Without it Python fell back to latin1 for the whole file and a curly
# apostrophe (0x92) came out as an invisible control character on the desktop
# while the browser read it as the apostrophe Excel meant.
codecs.register_error(
    "geocoord_c1",
    lambda e: (e.object[e.start:e.end].decode("latin1"), e.end),
)


def _rows(text: str, sep: str, limit: int | None = None) -> list[list[str]]:
    """Parse ``text`` with ``sep``, honouring quotes, up to ``limit`` rows.

    A line with no characters at all is skipped rather than returned as a row.
    ``csv.reader`` yields ``[]`` for one while PapaParse yields ``['']``, and
    the difference is not cosmetic: an empty first line would become the header
    on one side and not the other, and the differing field count skews the
    separator guess below. Skipping on both sides is also what pandas did with
    its default ``skip_blank_lines``.
    """
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=sep)
    out = []
    for row in reader:
        if not row:
            continue
        out.append(row)
        if limit is not None and len(out) >= limit:
            break
    return out


def sniff_separator(text: str) -> str:
    """The delimiter used by ``text``, or a comma when none can be told apart.

    This mirrors PapaParse's heuristic rather than :class:`csv.Sniffer`, and
    deliberately so. The Sniffer works from character frequencies and is easily
    fooled: a tab-separated file whose cells hold decimal commas comes back as
    comma-separated, and every column is then wrong. PapaParse instead parses a
    preview with each candidate and keeps the one whose field count is most
    consistent from row to row, which is the question actually being asked.

    Falling back to a comma matters too. A file with a single column has no
    delimiter at all; pandas used to guess a character out of the data and cut
    the header "lat" down to "la".
    """
    best_delim = None
    best_delta = None
    best_avg = 0.0

    for delim in SEPARATORS:
        rows = _rows(text, delim, limit=_GUESS_ROWS)
        if not rows:
            continue

        delta = 0
        total = 0
        previous = None
        for row in rows:
            count = len(row)
            total += count
            if previous is None:
                previous = count
            elif count > 0:
                delta += abs(count - previous)
                previous = count

        average = total / len(rows)
        # Lowest delta - the most consistent field count - wins; the average
        # only breaks ties between delimiters that are equally consistent.
        if average > 1.99 and (
            best_delta is None
            or delta < best_delta
            or (delta == best_delta and average > best_avg)
        ):
            best_delim, best_delta, best_avg = delim, delta, average

    return best_delim if best_delim is not None else ","


def header_names(cells: list[str]) -> list[str]:
    """Column names the way pandas builds them from a header row.

    An empty cell becomes ``Unnamed: N`` and a repeat gains a ``.1``, ``.2``
    suffix. These are not cosmetic: :func:`geocoord.converter.tidy_table`
    decides whether to promote the first row by testing for exactly those
    names, so a reader that left an empty header as an empty string would
    change how every messy export is read.
    """
    # The generated names go through the same disambiguation as the written
    # ones. A header cell can literally contain "Unnamed: 0" - that is what a
    # file exported by pandas and opened again looks like - and it would
    # otherwise collide with the name generated for an empty cell, leaving two
    # columns sharing a label. Downstream, df[name] then returns a frame rather
    # than a series and tidy_table raises.
    raw = [str(cell) if str(cell) != "" else f"Unnamed: {i}"
           for i, cell in enumerate(cells)]
    seen: dict[str, int] = {}
    names = []
    for name in raw:
        count = seen.get(name, 0)
        seen[name] = count + 1
        names.append(name if count == 0 else f"{name}.{count}")
    return names


def read_csv_text(text: str, sep: str | None = None, decimal: str = ".") -> pd.DataFrame:
    """Parse CSV text into a dataframe of strings.

    ``sep`` of ``None`` means detect it; anything else is used as given.

    **Every cell is read as text.** GeoCoord converts the coordinate columns
    and carries the rest through unchanged, so inferring types on them buys
    nothing and costs three things. A sample code of ``"007"`` became the
    integer 7 and was exported that way, which corrupts an identifier in
    silence, and geological codes carry leading zeros as a matter of course. An
    integer past 2**53 cannot be represented exactly by a JavaScript number, so
    inferring one would guarantee a divergence with the browser port. And
    pandas' inference rules would have to be reimplemented in JavaScript to
    keep the two in step, which is a wide surface for exactly the kind of
    silent disagreement this port is built to prevent.

    A row with fewer fields than the header is padded, and one with more is
    truncated. ``pd.read_csv`` raised ``ParserError`` on the second case, or -
    with ``index_col`` left alone - quietly promoted the extra field to a row
    index and shifted every label off its data. Neither is a reasonable thing
    to do to somebody's spreadsheet.

    ``decimal`` is accepted because the interface offers it, but with
    everything read as text it has no effect on the parse.
    :func:`geocoord.converter.parse_coordinate` understands both a dot and a
    comma regardless, so the option records intent rather than changing it.
    """
    del decimal  # documented above: kept for the interface's sake

    if text.startswith(_BOM):
        text = text[len(_BOM):]
    if sep is None:
        sep = sniff_separator(text)

    rows = _rows(text, sep)
    while rows and all(cell == "" for cell in rows[-1]):
        rows.pop()
    if not rows:
        return pd.DataFrame()

    columns = header_names(rows[0])
    body = [
        [row[i] if i < len(row) else "" for i in range(len(columns))]
        for row in rows[1:]
    ]
    return pd.DataFrame(body, columns=columns, dtype=str)


def decode_csv_bytes(data: bytes) -> str:
    """Decode CSV bytes to text, by byte-order mark first and utf-8 second.

    A UTF-16 file starts with ``FF FE`` or ``FE FF``, which is not valid utf-8,
    so it used to fall through to the single-byte fallback and every column name
    came back interleaved with NUL bytes, so a column named ``codigo`` arrived
    as eleven characters of mojibake. Excel's "Unicode Text" export is
    UTF-16, so this is a format users produce without meaning to.

    The single-byte fallback is windows-1252, not latin1. Exports out of older
    Windows tooling are habitually called latin1 and almost never are: the two
    differ over bytes 0x80-0x9F, where cp1252 keeps the typographic characters
    Excel writes - the curly apostrophe, the en dash - and latin1 has control
    characters. The five bytes cp1252 leaves undefined fall back to their latin1
    meaning, which is exactly what a browser's TextDecoder does, so both halves
    of the port read the same bytes the same way.
    """
    for bom, encoding in ((codecs.BOM_UTF8, "utf-8-sig"),
                          (codecs.BOM_UTF32_LE, "utf-32"),
                          (codecs.BOM_UTF32_BE, "utf-32"),
                          (codecs.BOM_UTF16_LE, "utf-16"),
                          (codecs.BOM_UTF16_BE, "utf-16")):
        if data.startswith(bom):
            try:
                return data.decode(encoding)
            except UnicodeDecodeError:
                break
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("cp1252", errors="geocoord_c1")


def read_csv_bytes(data: bytes, sep: str | None = None, decimal: str = ".") -> pd.DataFrame:
    """Decode ``data`` (see :func:`decode_csv_bytes`) and parse it."""
    return read_csv_text(decode_csv_bytes(data), sep=sep, decimal=decimal)


def excel_engine(name: str) -> str:
    """The pandas engine for a workbook, chosen by extension.

    ``.xlsx`` goes to openpyxl and everything else to xlrd, which is what reads
    the legacy BIFF ``.xls`` files that still turn up in field data.
    """
    return "openpyxl" if name.lower().endswith(".xlsx") else "xlrd"


def _cell_text(value) -> str:
    """One spreadsheet cell as the text GeoCoord carries.

    The rule is the same one the JavaScript port applies in ``cellText``: a
    date by how it reads, everything else by the value actually stored.

    A date is written to the file as a count of days since 1900, so it has to
    be rendered or it arrives as ``45358``; midnight is dropped, because a date
    cell with no time is a date, not an instant. Everything else keeps its
    stored value: a number formatted to two decimals in the sheet still holds
    all its digits, and taking what the cell *displays* would move a coordinate
    of 38.7083335 to 38.71 - two and a half kilometres - with nothing to say so.
    """
    if value is None:
        return ""
    if isinstance(value, float) and value != value:      # NaN
        return ""
    if isinstance(value, bool):
        # Matching what SheetJS renders, so both halves of the port agree.
        return "TRUE" if value else "FALSE"
    if isinstance(value, _dt.datetime):
        if (value.hour, value.minute, value.second, value.microsecond) == (0, 0, 0, 0):
            return value.strftime("%Y-%m-%d")
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(value, _dt.date):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, _dt.time):
        return value.strftime("%H:%M:%S")
    return str(value)


def workbook_sheets(data: bytes, name: str) -> list[str]:
    """The sheet names of a workbook, in book order."""
    return pd.ExcelFile(io.BytesIO(data), engine=excel_engine(name)).sheet_names


def read_excel_bytes(data: bytes, name: str, sheet=0) -> pd.DataFrame:
    """Read one sheet of a workbook into a dataframe of strings.

    The same every-cell-is-text contract as :func:`read_csv_text`, and for the
    same reasons: a sample code of ``"0071"`` is an identifier, not the number
    71, and this path is how most field data actually arrives. Reading with
    pandas' own inference turned it into ``71`` and exported it that way, while
    an identifier column holding one blank cell became a float and exported
    ``20240001.0``.

    ``dtype=object`` rather than ``dtype=str``: it keeps whatever the workbook
    reader handed over - a string stays a string, a date stays a date - and
    :func:`_cell_text` then applies GeoCoord's own rule. ``dtype=str`` would
    stringify a date as ``2024-03-07 00:00:00``.

    One divergence from the browser is left standing and is recorded here
    rather than left to be found: a date is rendered ISO on this side and by
    the sheet's own display format on the other, so a cell formatted
    ``dd/mm/yyyy`` reads ``2024-03-07`` here and ``07/03/2024`` there. Excel
    reading sits outside the parity contract - openpyxl and SheetJS build
    different intermediate representations of the same workbook - and only
    attribute columns are affected; the coordinates agree.
    """
    frame = pd.ExcelFile(io.BytesIO(data), engine=excel_engine(name)).parse(
        sheet, dtype=object,
    )
    return pd.DataFrame(
        {col: [_cell_text(v) for v in frame[col]] for col in frame.columns},
        columns=frame.columns,
        dtype=str,
    )
