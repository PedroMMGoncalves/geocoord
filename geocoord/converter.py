"""Coordinate conversion engine for GeoCoord.

Pure logic with no UI dependencies, so it can be tested in isolation. The
Streamlit application (`app.py`) imports these functions.

Supported input formats:
    - Decimal:                   38.7, -9,5, "38.708333"
    - Degrees + decimal minutes: 38° 42.5'
    - Degrees-minutes-seconds:   38° 42' 30" N
    - Hemisphere in PT or EN, as prefix or suffix: "9° 30' O", "W 9°30'"
      (N/E/L positive; S/W/O negative)
    - Explicit negative sign without a hemisphere: -9° 30' 0"
"""
from __future__ import annotations

import math
import re
from collections import Counter
from typing import Optional

import numpy as np
import pandas as pd

# Hemispheres that make the value negative (South, West/Oeste).
# Portuguese: O = Oeste (West), L = Leste (East); English: W, E.
_NEGATIVE_DIRS = {"S", "W", "O"}

# A hemisphere letter standing on its own. It may sit against digits or symbols
# ("38.5W", '30"O'), but not against another letter, so a word like "Oeste" or
# "Norte" in a name column is never read as a direction. ``[^\W\d_]`` is a
# Unicode letter, so accented words are excluded too. A plain ``\b`` would not
# do: a digit and a letter are both word characters, so "38.5W" had no boundary
# and silently lost its hemisphere.
_DIRECTION_RE = re.compile(r"(?<![^\W\d_])([NSEWOL])(?![^\W\d_])", re.IGNORECASE)
# Numbers (integer or decimal, dot or comma), always unsigned.
_NUMBER_RE = re.compile(r"\d+(?:[.,]\d+)?", re.ASCII)
# "º" and "ª" sit on a Portuguese keyboard where "°" does not, and read the same
# on screen. Unicode calls them letters, so left alone they shield an adjacent
# hemisphere letter from the guard above and "9ºO" comes back as +9.0.
_ORDINAL_SIGNS = str.maketrans({"º": "°", "ª": "°"})
# Characters whose whitespace status differs between Python and JavaScript;
# see parse_coordinate. Removed on both sides so neither can hide a sign.
_STRIP_CHARS_RE = re.compile("[﻿-]")
# Auto-generated column name pandas assigns to a header cell it found empty.
_PLACEHOLDER_COL_RE = re.compile(r"^Unnamed: \d+$")

# Valid geographic bounds.
LAT_RANGE = (-90.0, 90.0)
LON_RANGE = (-180.0, 180.0)


#: Column names that usually hold a latitude, in the order they are tried.
LAT_CANDIDATES = ["latitude", "lat", "coordenadas x", "latitude x", "coord_lat",
                  "lat_dms", "lat_gms", "y", "y_dd", "lat_y"]

#: Column names that usually hold a longitude, in the order they are tried.
LON_CANDIDATES = ["longitude", "lon", "long", "coordenadas y", "longitude y",
                  "coord_lon", "lon_dms", "lon_gms", "x", "x_dd", "lon_x"]

#: What a grid's two axes are called, in the order tried. Northing and
#: Easting, which nothing else is called; Y and X; and the names a Portuguese
#: military sheet gives its grid - P, the distance to the Perpendicular, is
#: the northing, and M, the distance to the Meridiana, the easting. They sit
#: in the latitude and longitude slots because that is where the northing and
#: the easting go.
#:
#: Consulted only for a file read in a projected system - in a geochemistry
#: table, P is phosphorus - and there they come before the names of the
#: degrees: a list of geodetic marks gives each one as Latitude and Longitude
#: and as M and P, side by side, and a file read in a grid wants the metres.
GRID_LAT_CANDIDATES = ["northing", "y", "p"]
GRID_LON_CANDIDATES = ["easting", "x", "m"]

# A unit written after a name - "Easting (m)", "Latitude (° ' '')" - is not
# part of the name. Only units a coordinate is written in: "Y (ppm)" keeps
# its own, because that column is yttrium and not a northing.
_UNIT_SUFFIX_RE = re.compile(
    r"\s*[(\[]\s*(?:m|km|metros|metres|meters|graus|deg|degrees|gms|dms|dd|[°º'\"′″\s]+)\s*[)\]]\s*$",
    re.IGNORECASE,
)

#: What a column of angles is called, for an angle split across cells.
_ANGLE_NAMES = frozenset({"latitude", "longitude", "lat", "lon", "long"})


def _column_key(name) -> str:
    """A column name as the candidate lists write it: lower case, no unit."""
    return _UNIT_SUFFIX_RE.sub("", str(name)).strip().lower()


def parse_coordinate(value) -> Optional[float]:
    """Convert a value (DMS/DM/decimal) into decimal degrees.

    Returns ``None`` when the value is empty or cannot be interpreted. The sign
    is taken from the hemisphere (N/S/E/W/O/L) when present; otherwise from an
    explicit leading minus sign.
    """
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None

    # A value that is already a number is already decimal degrees. Taking it as
    # it stands avoids a real trap: str() renders a magnitude below 1e-4 in
    # exponential form, and the digits of the exponent were then read as
    # minutes, so a latitude of 1e-05 came back as 1.0833.
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        v = float(value)
        return v if math.isfinite(v) else None

    # Characters the two languages disagree about. A byte-order mark left on the
    # first cell of a CSV is whitespace to JavaScript but not to Python; NEL and
    # the ASCII file separators are whitespace to Python but not to JavaScript.
    # Either way one side would leave the character sitting between the start of
    # the string and a leading minus sign, discarding the sign. Both sides drop
    # them outright.
    txt = _STRIP_CHARS_RE.sub("", str(value)).translate(_ORDINAL_SIGNS).strip()
    if txt in ("", "-", "—"):
        return None

    # 1) Hemisphere (prefix or suffix), if any.
    dir_match = _DIRECTION_RE.search(txt)
    direction = dir_match.group(1).upper() if dir_match else None

    # 2) Explicit minus sign before the first digit.
    has_minus = re.match(r"\s*-\s*\d", txt, re.ASCII) is not None

    # 3) Numeric components (magnitude, always positive).
    nums = [float(n.replace(",", ".")) for n in _NUMBER_RE.findall(txt)]
    if not nums:
        return None

    # Minutes and seconds are sexagesimal: sixty of either is the next unit up,
    # so "41 60' 00\"" is not a coordinate, it is a typo for 42°00' or 41°06'.
    # Carrying the arithmetic silently turned the digit transpositions that are
    # commonest in hand-copied field notebooks - 62 for 26, 90 for 09 - into a
    # well-formed coordinate that was in range, inside the declared region and
    # indistinguishable from good data, up to 111 km from where it belonged.
    if len(nums) >= 2 and nums[1] >= 60.0:
        return None
    if len(nums) >= 3 and nums[2] >= 60.0:
        return None

    if len(nums) == 1:
        magnitude = nums[0]
    elif len(nums) == 2:
        magnitude = nums[0] + nums[1] / 60.0
    else:  # >= 3: degrees, minutes, seconds (extras ignored)
        magnitude = nums[0] + nums[1] / 60.0 + nums[2] / 3600.0

    # 4) Sign: the hemisphere takes priority; otherwise the explicit minus.
    if direction is not None:
        negative = direction in _NEGATIVE_DIRS
    else:
        negative = has_minus

    return -magnitude if negative else magnitude



# Everything a spreadsheet might put between the digits of a metre value: the
# thin and non-breaking spaces Excel uses as a thousands separator, and the
# ordinary space somebody typed.
_PROJECTED_STRIP_RE = re.compile(r"[\s\u00a0\u202f\u2009']")


def parse_projected(value) -> Optional[float]:
    """Read a projected coordinate: a number of metres, not an angle.

    Tolerant of what a spreadsheet actually holds - a decimal comma, a thousands
    separator, a leading plus - and of nothing else. A value that is not a
    number comes back as ``None`` rather than as a guess.

    Which separator is the decimal one is decided by position, not by locale:
    whichever of ``.`` and ``,`` appears last is the decimal point, and any
    earlier ones are thousands separators. ``532.725,16`` and ``532,725.16``
    are therefore both 532725.16, which is what a person reading either would
    say, and ``532725,16`` is 532725.16 rather than 532725160.
    """
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        v = float(value)
        return v if math.isfinite(v) else None

    txt = _PROJECTED_STRIP_RE.sub("", _STRIP_CHARS_RE.sub("", str(value))).strip()
    if txt in ("", "-", "+"):
        return None

    last_dot = txt.rfind(".")
    last_comma = txt.rfind(",")
    if last_dot >= 0 and last_comma >= 0:
        decimal_at = max(last_dot, last_comma)
        txt = txt[:decimal_at].replace(".", "").replace(",", "") + "." + txt[decimal_at + 1:]
    elif last_comma >= 0:
        txt = txt.replace(",", ".")

    try:
        v = float(txt)
    except ValueError:
        return None
    return v if math.isfinite(v) else None

def hemisphere_axis(value) -> Optional[str]:
    """Which axis the hemisphere letter in ``value`` belongs to, if any.

    ``N``/``S`` can only be a latitude and ``E``/``W``/``O``/``L`` only a
    longitude, so the letter is free, decisive evidence of which column a value
    came from. Returns ``"lat"``, ``"lon"``, or ``None`` when there is no
    letter. Uses the same guarded match as :func:`parse_coordinate`, so a word
    like ``Norte`` or ``Oeste`` in a name column is not mistaken for one.
    """
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return None
    txt = _STRIP_CHARS_RE.sub("", str(value)).translate(_ORDINAL_SIGNS).strip()
    match = _DIRECTION_RE.search(txt)
    if match is None:
        return None
    return "lat" if match.group(1).upper() in ("N", "S") else "lon"




#: A column has to be mostly coordinates before it is taken for one.
_COLUMN_HIT_RATE = 0.6
#: ...and have enough values for that fraction to mean anything.
_COLUMN_MIN_VALUES = 3
#: Anything past this is not an angle in degrees, whichever axis it is.
_MAX_PLAUSIBLE_DEGREES = 180.0

# The marks that say "this is an angle, not a number": a degree sign, a prime,
# a hemisphere letter. A column carrying them is a coordinate column and a
# column of quantities is not, however well its numbers happen to parse.
_LOOKS_ANGULAR_RE = re.compile(r"[°º'\"′″]|[NSEWOL]\b", re.IGNORECASE)


def _blank(value) -> bool:
    """A cell with nothing in it, however the reader spelled that."""
    if value is None:
        return True
    if isinstance(value, float) and pd.isna(value):
        return True
    return str(value).strip() in ("", "nan", "None", "-")


def _column_score(values):
    """How much a column looks like coordinates, and its median magnitude.

    Returns ``(score, median)``. Parsing alone is not enough to go on: a column
    of row numbers parses perfectly, and on a real file it beat the actual
    coordinates because those had three blank rows. So the score also asks
    whether the values *look* like angles.
    """
    seen = [v for v in values if not _blank(v)]
    if len(seen) < _COLUMN_MIN_VALUES:
        return 0.0, None
    parsed = [parse_coordinate(v) for v in seen]
    good = [p for p in parsed if p is not None]
    if not good:
        return 0.0, None

    rate = len(good) / len(seen)
    if rate < _COLUMN_HIT_RATE:
        return 0.0, None

    magnitudes = sorted(abs(p) for p in good)
    median = magnitudes[len(magnitudes) // 2]
    score = rate

    # Degree signs, primes and hemisphere letters settle it outright.
    if sum(1 for v in seen if _LOOKS_ANGULAR_RE.search(str(v))) / len(seen) > 0.5:
        score += 1.0
    # A column of whole numbers is an identifier, a count or a year. A
    # coordinate has a fraction, unless somebody sampled exactly on a degree.
    elif all(float(p).is_integer() for p in good):
        score -= 0.5
    # And nothing past 180 degrees is an angle at all.
    if magnitudes[-1] > _MAX_PLAUSIBLE_DEGREES:
        score -= 1.0

    return score, median


def _abs_span(mask, axis: str):
    """The range of |value| a mask admits on one axis, as (low, high).

    Not min/max of the absolute bounds taken separately: for a longitude span
    of -9.6 to -6.1 that gives (9.6, 6.1), an interval that contains nothing,
    and every test against it silently fails. A box straddling zero admits
    magnitudes from zero up.
    """
    low = None
    high = 0.0
    for box in mask:
        lo, hi = (box[0], box[1]) if axis == "lat" else (box[2], box[3])
        box_low = 0.0 if lo <= 0 <= hi else min(abs(lo), abs(hi))
        box_high = max(abs(lo), abs(hi))
        low = box_low if low is None else min(low, box_low)
        high = max(high, box_high)
    return (0.0 if low is None else low), high


def _fits_region(median, mask):
    """Whether a magnitude could be a latitude or a longitude in ``mask``."""
    if not mask or median is None:
        return True
    lat_lo, lat_hi = _abs_span(mask, "lat")
    lon_lo, lon_hi = _abs_span(mask, "lon")
    return (lat_lo <= median <= lat_hi) or (lon_lo <= median <= lon_hi)


def guess_coordinate_columns(columns, rows, mask=None, projected=False):
    """Which two columns hold the coordinates. Returns ``(lat_index, lon_index)``.

    Names first, because a column called Latitude is not a guess. But names run
    out quickly on real files: a real spreadsheet had its two columns
    labelled ``Condenadas`` - a misspelling of Coordenadas, spanning both - and
    ``Unnamed: 2``, and matching on names put the *village name* in the latitude
    slot and reported every one of its rows as unreadable. No list of candidate
    names would have saved it.

    So when the names give nothing, the values do - but parsing alone is not
    enough to go on. On a second real file a column of row numbers parsed
    perfectly and beat the actual coordinates, which had three blank rows. What
    separates them is that a coordinate *looks* like an angle: a degree sign, a
    prime, a hemisphere letter, or at least a fraction. See ``_column_score``.

    Which of the two is the latitude is decided by the declared region when
    there is one - in central Moçambique the magnitudes are 19 and 34, and only
    one of those is a latitude between 10 and 27 degrees - and otherwise by
    magnitude and column order.

    ``projected`` says the file is being read in a grid, which puts a grid's
    own names first - Northing and Easting, then Y and X, then the military
    sheet's P and M - ahead of Latitude and Longitude, so a file that gives
    each point in degrees and in metres is read by the metres. Without it, a table typed off a
    1:25000 sheet with a column for the sheet number had that column taken for
    the northing.

    Falls back to the first two columns, which is what it did before, when
    neither the names nor the values are any use.
    """
    lat_names = GRID_LAT_CANDIDATES + LAT_CANDIDATES if projected else LAT_CANDIDATES
    lon_names = GRID_LON_CANDIDATES + LON_CANDIDATES if projected else LON_CANDIDATES
    by_name_lat = _named_column(columns, lat_names)
    by_name_lon = _named_column(columns, lon_names)
    if by_name_lat is not None and by_name_lon is not None and by_name_lat != by_name_lon:
        return by_name_lat, by_name_lon

    measured = []
    for i, _ in enumerate(columns):
        score, median = _column_score([row[i] if i < len(row) else None for row in rows])
        if score > 0.0 and median is not None:
            measured.append((i, score, median))

    scored = [m for m in measured if _fits_region(m[2], mask)]
    # A region that fits nothing is the wrong region, not a reason to give up:
    # the default is Portugal, and a file from Moçambique arrives with every column
    # outside it. Falling through to the first two columns there put the
    # village name in the latitude slot until the user noticed and changed the
    # region. The values still know which columns they are.
    if len(scored) < 2:
        scored = measured
        mask = None

    if len(scored) >= 2:
        best = sorted(scored, key=lambda s: (-s[1], s[0]))[:2]
        first, second = sorted(best, key=lambda s: s[0])
        return _order_by_region(first, second, mask)

    fallback_lat = by_name_lat if by_name_lat is not None else 0
    fallback_lon = by_name_lon if by_name_lon is not None else (1 if len(columns) > 1 else 0)
    return fallback_lat, fallback_lon


def _named_column(columns, candidates):
    """Index of the first column whose name matches a candidate, or None.

    A unit after the name does not count: ``Easting (m)`` is ``easting``.
    """
    lowered = [_column_key(c) for c in columns]
    for candidate in candidates:
        if candidate.lower() in lowered:
            return lowered.index(candidate.lower())
    return None


def _order_by_region(first, second, mask):
    """Which of two scored columns is the latitude."""
    (i_a, _, med_a), (i_b, _, med_b) = first, second
    if mask:
        lat_lo, lat_hi = _abs_span(mask, "lat")
        lon_lo, lon_hi = _abs_span(mask, "lon")
        a_lat, b_lat = lat_lo <= med_a <= lat_hi, lat_lo <= med_b <= lat_hi
        a_lon, b_lon = lon_lo <= med_a <= lon_hi, lon_lo <= med_b <= lon_hi
        if a_lat and b_lon and not (b_lat and a_lon):
            return i_a, i_b
        if b_lat and a_lon and not (a_lat and b_lon):
            return i_b, i_a
    # No region, or one that cannot tell them apart: a magnitude over 90 can
    # only be a longitude, and otherwise the left column is the latitude.
    if med_a > 90 >= med_b:
        return i_b, i_a
    return i_a, i_b


def _axis_bounds(mask, axis: str):
    """The span of ``mask`` on one axis, as (low, high)."""
    if not mask:
        return None
    if axis == "lat":
        return min(b[0] for b in mask), max(b[1] for b in mask)
    return min(b[2] for b in mask), max(b[3] for b in mask)


def unsigned_outside_region(values, axis: str, mask) -> list:
    """Rows whose magnitude only the declared region can put a sign on.

    A hard case that has nothing to do with parsing and everything to do with
    what the file leaves out. Field notebooks from the southern hemisphere are
    routinely written unsigned - ``18 55 18`` for a latitude in Moçambique, because
    everyone on the survey knew which side of the equator they were standing on
    - and nothing in the value says south. Read literally it is Sudan.

    The region the user has already declared is the missing information, and
    this is the only place it can come from. A row qualifies when all three
    hold:

    * the raw value carries no hemisphere letter and no sign, so the file is
      not being contradicted, only completed;
    * its magnitude falls outside the region on that axis, so there is
      something to fix;
    * the negated magnitude falls inside, so the fix is exactly a sign.

    Anything else is left alone. A value the file signed is never touched -
    that is data, and guessing over it would be the worst thing this tool
    could do.
    """
    bounds = _axis_bounds(mask, axis)
    out = []
    for value in values:
        if bounds is None:
            out.append(False)
            continue
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            text = ""
            magnitude = float(value) if value == value else None
            signed_already = magnitude is not None and magnitude < 0
        else:
            text = _STRIP_CHARS_RE.sub("", str(value)).translate(_ORDINAL_SIGNS).strip()
            magnitude = parse_coordinate(value)
            signed_already = text.lstrip().startswith("-") or hemisphere_axis(value) is not None
        if magnitude is None or signed_already:
            out.append(False)
            continue
        low, high = bounds
        out.append(not (low <= magnitude <= high) and low <= -magnitude <= high)
    return out

def axis_mismatch(lat_values, lon_values) -> list:
    """Rows whose hemisphere letters contradict the columns they sit in.

    A ``W`` in the latitude column, or an ``N`` in the longitude column, is not
    a guess about a swap - it is proof of one, and the only evidence in the file
    that costs nothing to read. It was being discarded: ``9° 8' 12" W`` chosen
    as a latitude became -9.136667, passed the range check, and was written back
    out as ``9° 8' 12" S``, so the exported file asserted a hemisphere that
    nobody had entered.
    """
    out = []
    for lat, lon in zip(lat_values, lon_values):
        out.append(hemisphere_axis(lat) == "lon" or hemisphere_axis(lon) == "lat")
    return out


def in_range(value: Optional[float], axis: str) -> bool:
    """Return whether ``value`` falls within the valid bounds of the axis.

    ``axis`` is 'lat' or 'lon'.
    """
    if value is None or pd.isna(value):
        return False
    low, high = LAT_RANGE if axis == "lat" else LON_RANGE
    return low <= value <= high


def format_dms(value, axis: str, seconds_decimals: int = 3) -> Optional[str]:
    """Format a decimal-degrees value back into a DMS string.

    Example: format_dms(-9.136667, 'lon') -> "9° 8' 12\" W".
    """
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None

    # A value outside its axis has no DMS form: writing 123° 30' 0" N into a
    # Latitude_GMS column states a latitude that does not exist, and the
    # exported file then carries an assertion nobody made.
    if not in_range(value, axis):
        return None

    positive, negative = ("N", "S") if axis == "lat" else ("E", "W")
    hemisphere = positive if value >= 0 else negative

    v = abs(float(value))
    degrees = int(v)
    rem_minutes = (v - degrees) * 60.0
    minutes = int(rem_minutes)
    # Both implementations have to round identically, or the same file exports
    # different DMS strings from the Python application and from the browser one.
    # Python's round() breaks a tie to even while JavaScript's Math.round() goes
    # up, so neither is used: this scaled form is plain IEEE-754 arithmetic that
    # both languages execute bit for bit alike, with the tie rule written out.
    factor = 10 ** seconds_decimals
    scaled = (rem_minutes - minutes) * 60.0 * factor
    whole = math.floor(scaled)
    frac = scaled - whole
    if frac > 0.5 or (frac == 0.5 and whole % 2 == 1):
        whole += 1
    seconds = whole / factor

    # Handle rounding roll-over (e.g. 59.9996 -> 60).
    if seconds >= 60.0:
        seconds -= 60.0
        minutes += 1
    if minutes >= 60:
        minutes -= 60
        degrees += 1

    return f"{degrees}° {minutes}' {seconds:g}\" {hemisphere}"


# ---------------------------------------------------------------------------
# Tidying messy spreadsheet exports
# ---------------------------------------------------------------------------
def _is_placeholder_name(name) -> bool:
    """True for an empty or pandas auto-generated ('Unnamed: N') column name."""
    s = str(name).strip()
    return s == "" or s.lower() == "nan" or bool(_PLACEHOLDER_COL_RE.match(s))


def tidy_table(df: pd.DataFrame) -> pd.DataFrame:
    """Clean a freshly-read table so messy spreadsheet exports load correctly.

    Excel/CSV exports often carry junk that breaks naive reading. This repairs
    the three most common cases, returning a new dataframe (the original is left
    untouched):

    - A leading empty 'index' column (every row starting with a separator) and
      any other fully empty columns are dropped.
    - Fully empty rows are dropped.
    - When a blank first line was mistaken for the header (so every column is
      named ``Unnamed: N``), the first surviving row is promoted to be the
      header.
    - Title lines above the header - ``Ilha da MADEIRA``, ``Sistema de
      Referência: ...`` - are set aside, and so is a row of group headings
      over the real one (see :func:`_title_rows`, :func:`_group_row`).
    - When the header takes two rows - ``COORDENADAS`` over ``M`` and ``P`` -
      the second is read as part of it (see :func:`_second_header_row`). Each
      column is named by its lower label, or by its upper one where it has
      none; a lower label that repeats is said with its upper one, and a
      repeat that remains gains a ``.1``.
    - An angle written across cells - degrees, minutes, seconds and the
      hemisphere letter, each in its own column under one merged heading - is
      put back together as one coordinate (see :func:`_join_split_angles`).

    Decimal commas inside the data (``"33,6603"``) are left as-is;
    :func:`parse_coordinate` already understands them.
    """
    df = df.copy()

    # Treat blank / whitespace-only string cells as missing so they count as
    # empty for the row/column drops below. Text columns are object columns in
    # pandas 2 but have their own dtype in pandas 3, which select_dtypes("object")
    # still includes only as a deprecated courtesy - so both are asked for by
    # name, in a form both versions accept.
    text_columns = [c for c in df.columns
                    if df[c].dtype == object or pd.api.types.is_string_dtype(df[c].dtype)]
    for c in text_columns:
        stripped = df[c].astype(str).str.strip()
        df[c] = df[c].where(~stripped.isin(["", "nan", "None"]), np.nan)

    df = df.dropna(axis=1, how="all").dropna(axis=0, how="all")
    if df.empty:
        return df.reset_index(drop=True)

    names, rows = _resolve_header(
        [str(c) for c in df.columns],
        [[None if pd.isna(v) else v for v in row] for row in df.itertuples(index=False, name=None)],
    )
    # Blank cells go back as NaN, in the dtype the reader chose, as they left.
    kinds = set(df.dtypes)
    out = pd.DataFrame([[np.nan if v is None else v for v in row] for row in rows],
                       columns=names, dtype=kinds.pop() if len(kinds) == 1 else object)
    return out.dropna(axis=1, how="all").reset_index(drop=True)


#: Rows looked at below a second header row, to see what its labels stand over.
_HEADER_LOOKAHEAD = 50

_DIGIT_RE = re.compile(r"[0-9]")

# A cell that is a number as a table writes one: a decimal point or a comma.
_PLAIN_NUMBER_RE = re.compile(r"^[+-]?(?:[0-9]+(?:[.,][0-9]*)?|[.,][0-9]+)$")


def _text(cell) -> Optional[str]:
    """A cell as stripped text, or None when it is blank."""
    if cell is None:
        return None
    s = str(cell).strip()
    return s or None


def _count(row) -> int:
    return sum(1 for cell in row if _text(cell))


def _has_number(row) -> bool:
    return any(_PLAIN_NUMBER_RE.match(_text(cell)) for cell in row if _text(cell))


def _resolve_header(names: list, rows: list):
    """The column names a table really has, and the rows that are its data.

    ``names`` are the names the reader gave the columns - the file's first row,
    with ``Unnamed: N`` for an empty cell - and ``rows`` the rows below, blank
    cells as None, with the empty rows and columns already gone. What comes
    back is the same table with its header found: title lines set aside, a
    header in the rows promoted, a second header row merged, split angles
    joined. Each step is strict about when it applies, because every one of
    them, applied to a table that only resembles its case, would rename the
    columns and lose a row of data. Mirrors resolveHeader() in converter.js.
    """
    blank = [_is_placeholder_name(n) for n in names]
    width = len(names)

    # Title lines: above the header, one cell to a row.
    named_row = [] if all(blank) else [[None if b else n for n, b in zip(names, blank)]]
    titles = _title_rows(named_row + rows[:_HEADER_LOOKAHEAD], width)
    if titles:
        rows = rows[titles - len(named_row):]
        blank = [True] * width

    # No name at all: the header is the first row of data - under a row of
    # group headings, when there is one.
    if all(blank) and rows:
        if _group_row(rows):
            rows = rows[1:]
        header, rows = [_text(h) for h in rows[0]], rows[1:]
        # A promoted header cell may itself be blank. Naming it "nan" would
        # collide two such cells into one name, which silently breaks column
        # selection downstream; each gets a positional name instead.
        blank = [h is None or _is_placeholder_name(h) for h in header]
        names = [f"Column {i + 1}" if b else h for i, (h, b) in enumerate(zip(header, blank))]
        names, blank, rows = _drop_empty_columns(names, blank, rows)

    if _second_header_row(names, blank, rows):
        labels, rows = [_text(v) for v in rows[0]], rows[1:]
        repeated = {label for label in labels if label and labels.count(label) > 1}
        merged = []
        for label, name, b in zip(labels, names, blank):
            if label is None:
                merged.append(name)
            elif label in repeated and not b:
                merged.append(f"{name} {label}")
            else:
                merged.append(label)
        blank = [b and label is None for label, b in zip(labels, blank)]
        names, blank, rows = _drop_empty_columns(merged, blank, rows)

    names, blank, rows = _join_split_angles(names, blank, rows)

    seen: dict = {}
    unique = []
    for name in names:
        count = seen.get(name, 0)
        seen[name] = count + 1
        unique.append(name if count == 0 else f"{name}.{count}")
    return unique, rows


def _drop_empty_columns(names, blank, rows):
    keep = [i for i in range(len(names)) if any(_text(row[i]) for row in rows)]
    return ([names[i] for i in keep], [blank[i] for i in keep],
            [[row[i] for i in keep] for row in rows])


def _title_rows(top: list, width: int) -> int:
    """How many rows at the top of a table are titles above its header.

    An official table rarely starts with its header: ``Ilha da MADEIRA``,
    ``Sistema de Referência: ITRF 93`` come first, one cell to a row, and read
    as written they become the header and the real one a row of data. They are
    counted as titles only when what follows says so: a table at least three
    columns wide, then a row of two or more labels with no number in it, then
    data - a number - within three rows. A file whose one named column sits
    directly over its data is a table with one name, and is left alone.
    """
    if width < 3:
        return 0
    count = 0
    while count < len(top) and _count(top[count]) == 1:
        count += 1
    if count == 0 or count >= len(top):
        return 0
    labels = top[count]
    if _count(labels) < 2 or _has_number(labels):
        return 0
    if not any(_has_number(row) for row in top[count + 1:count + 4]):
        return 0
    return count


def _group_row(rows: list) -> bool:
    """Whether the first row is a row of group headings over the real header.

    ``Coordenadas Geodésicas`` over Latitude and Longitude, ``Coordenadas
    Cartográficas`` over Easting and Northing: a heading for each group of
    columns, and under it the row that names them. It says nothing the names
    below do not, so it is set aside - when every heading stands over a name,
    the names are at least twice as many and have no digit in them, neither
    row holds a number, and data follows within three rows.
    """
    if len(rows) < 3:
        return False
    group, below = [_text(v) for v in rows[0]], [_text(v) for v in rows[1]]
    headed = [i for i, v in enumerate(group) if v]
    named = [i for i, v in enumerate(below) if v]
    if not headed or _has_number(group) or _has_number(below):
        return False
    if any(_DIGIT_RE.search(below[i]) for i in named):
        return False
    if not all(below[i] for i in headed) or 2 * len(headed) > len(named):
        return False
    return any(_has_number(row) for row in rows[2:5])


def _second_header_row(names: list, blank: list, rows: list) -> bool:
    """Whether the first row of data is the lower half of a two-row header.

    A table typed from a register often heads its columns in two rows: a cell
    reading ``COORDENADAS`` merged across two columns, with ``M`` and ``P``
    beneath, beside ``Data`` and ``Nº`` merged down through both rows. Read
    with one header row, the coordinates are ``COORDENADAS`` and
    an ``Unnamed: N``, ``M`` and ``P`` are the first row of data, and nothing
    finds the columns by name.

    Taking a row of data for a header loses the row and renames every column,
    so all four of these must hold, and a table that only resembles one is read
    as it always was:

    - the row has no digit anywhere - a row of data almost always has one, in
      a code, a date or a value;
    - it has a label under a blank header cell: the far side of a merged cell;
    - it is blank under a named header whose column has values below: a header
      merged down through both rows;
    - below one of its labels, most values have digits: labels over data.

    ``blank`` says which names are no name at all - the reader's
    ``Unnamed: N``, or the positional name given to a blank promoted cell.
    """
    if len(rows) < 2:
        return False
    first = [_text(v) for v in rows[0]]
    below = rows[1:1 + _HEADER_LOOKAHEAD]

    def filled(i):
        return [_text(row[i]) for row in below if _text(row[i])]

    labels = [i for i, v in enumerate(first) if v]
    if not labels or any(_DIGIT_RE.search(first[i]) for i in labels):
        return False
    if not any(blank[i] for i in labels):
        return False
    if not any(not first[i] and not blank[i] and filled(i) for i in range(len(names))):
        return False
    return any(0 < len(filled(i)) <= 2 * sum(bool(_DIGIT_RE.search(v)) for v in filled(i))
               for i in labels)


_WHOLE_RE = re.compile(r"^[+-]?[0-9]{1,3}(?:[.,]0+)?$")
_HEMISPHERES = frozenset("NSEWOL")


def _join_split_angles(names: list, blank: list, rows: list):
    """Put back together an angle written across cells.

    A list of geodetic marks writes ``32 | 47 | 35.39765 | N`` under one
    merged heading, ``Latitude (° ' '')``: degrees, minutes, seconds and the
    hemisphere, a column each, and only the first of them named. Nothing reads
    a coordinate out of four columns. They are joined into the one the heading
    names - ``32° 47' 35.39765" N`` - when the columns after the first carry no
    name of their own and every row that has the three has whole degrees to
    180, whole minutes under 60 and seconds under 60. Three such columns of
    small numbers can be other things, so there must also be a column of
    hemisphere letters after them, or a first column called latitude or
    longitude.
    """
    i = 0
    while i + 2 < len(names):
        parts = _split_angle_at(names, blank, rows, i)
        if parts is None:
            i += 1
            continue
        joined = []
        for row in rows:
            cells = [_text(row[i + k]) for k in range(parts)]
            if cells[0] is None:
                joined.append(None)
                continue
            degrees = cells[0].split(".")[0].split(",")[0]
            minutes = cells[1].split(".")[0].split(",")[0]
            text = f"{degrees}° {minutes}' {cells[2]}\""
            joined.append(f"{text} {cells[3].upper()}" if parts == 4 and cells[3] else text)
        rows = [row[:i] + [value] + row[i + parts:] for row, value in zip(rows, joined)]
        names = names[:i + 1] + names[i + parts:]
        blank = blank[:i + 1] + blank[i + parts:]
        i += 1
    return names, blank, rows


def _split_angle_at(names, blank, rows, i):
    """3 or 4 when columns i.. are one angle split across cells, else None."""
    if not (blank[i + 1] and blank[i + 2]):
        return None
    complete = 0
    for row in rows:
        d, m, s = (_text(row[i + k]) for k in range(3))
        if d is None and m is None and s is None:
            continue
        if d is None or m is None or s is None:
            return None
        if not (_WHOLE_RE.match(d) and _WHOLE_RE.match(m) and _PLAIN_NUMBER_RE.match(s)):
            return None
        if abs(int(d.split(".")[0].split(",")[0])) > 180 or not 0 <= int(m.split(".")[0].split(",")[0]) < 60:
            return None
        if not 0 <= float(s.replace(",", ".")) < 60:
            return None
        complete += 1
    if complete == 0:
        return None
    lettered = False
    if i + 3 < len(names) and blank[i + 3]:
        letters = [(_text(row[i]), _text(row[i + 3])) for row in rows]
        lettered = (all((d is None) == (h is None) for d, h in letters)
                    and all(h.upper() in _HEMISPHERES for _, h in letters if h))
    if lettered:
        return 4
    return 3 if _column_key(names[i]) in _ANGLE_NAMES else None


# ---------------------------------------------------------------------------
# Swapped latitude/longitude detection
# ---------------------------------------------------------------------------
def _is_number(x) -> bool:
    if x is None:
        return False
    try:
        return not math.isnan(float(x))
    except (TypeError, ValueError):
        return False


def _valid_pair(lat: float, lon: float) -> bool:
    return (LAT_RANGE[0] <= lat <= LAT_RANGE[1]) and (LON_RANGE[0] <= lon <= LON_RANGE[1])


def _in_mask(lat: float, lon: float, mask) -> bool:
    """True if (lat, lon) falls inside any bbox (lat_min, lat_max, lon_min, lon_max)."""
    for la0, la1, lo0, lo1 in mask:
        if la0 <= lat <= la1 and lo0 <= lon <= lo1:
            return True
    return False


def _dense_center(points: np.ndarray):
    """Find the centre and radius of the densest cluster of (lat, lon) points."""
    span = max(float(np.ptp(points[:, 0])), float(np.ptp(points[:, 1])))
    cell = max(0.5, span / 20.0)
    keys = np.floor(points / cell).astype(int)
    counts = Counter(map(tuple, keys))
    best = counts.most_common(1)[0][0]
    mask = (np.abs(keys[:, 0] - best[0]) <= 1) & (np.abs(keys[:, 1] - best[1]) <= 1)
    members = points[mask]
    center = np.median(members, axis=0)
    dist = np.hypot(members[:, 0] - center[0], members[:, 1] - center[1])
    radius = max(1.0, float(np.percentile(dist, 90)))
    return center, radius


def detect_swaps(lats, lons, min_cluster: int = 6, reference=None,
                 region_radius: float = 10.0, mask=None, axis_mismatch=None):
    """Classify each row as ok / missing / out_of_range / swap_range /
    swap_cluster / swap_axis.

    Two layers of detection:

    1. Range: if (lat, lon) is out of bounds but the swapped pair is valid, the
       row is ``swap_range`` (a longitude almost certainly ended up in the
       latitude column).
    2. Cluster: a row is ``swap_cluster`` when it sits away from the expected
       location but lands back inside it once its coordinates are swapped.

       - If ``mask`` (a list of bounding boxes ``(lat_min, lat_max, lon_min,
         lon_max)``) is given, the expected location is the union of those
         boxes. A row outside all boxes whose swapped pair is inside one is
         flagged. This is the most reliable mode and handles data spread over
         several regions (e.g. Portugal + PALOP).
       - Else if ``reference`` (a (lat, lon) the data should be near) is given,
         it is the expected location and ``region_radius`` (degrees) the
         tolerance.
       - Otherwise the expected location is auto-detected as the densest cluster
         of the in-range points, assuming the correct data is the majority, and
         a row is flagged when it sits beyond three core radii of the centre
         and its swapped position lands back inside the area the good data
         occupies.

    Returns ``(labels, center)`` where ``center`` is the (lat, lon) used as the
    expected location, or ``None`` for mask mode / when no cluster step ran.

    Note: in auto mode, from coordinates alone the correct orientation is
    fundamentally ambiguous when about half the data is swapped (the densest
    cluster may be the swapped one), and a genuine point at the mirror of the
    cluster cannot be told apart from a swapped one - a real point in the Congo
    basin at (-6, 41) is arithmetically indistinguishable from a Braganca row
    entered backwards. Widening the tolerance to cover the whole country widens
    that mirror with it, which is why ``swap_cluster`` is a suggestion to be
    reviewed rather than a correction to be applied. Provide ``mask`` or
    ``reference`` when the region is known: mask mode misses nothing and has no
    mirror.
    """
    n = len(lats)
    labels = ["missing"] * n
    inrange_idx = []
    mismatch = list(axis_mismatch) if axis_mismatch is not None else [False] * n

    for i in range(n):
        la, lo = lats[i], lons[i]
        if not (_is_number(la) and _is_number(lo)):
            labels[i] = "missing"
            continue
        la, lo = float(la), float(lo)
        if _valid_pair(la, lo):
            labels[i] = "ok"
            inrange_idx.append(i)
        elif _valid_pair(lo, la):
            labels[i] = "swap_range"
        else:
            labels[i] = "out_of_range"

    def _apply_axis_proof(lbls):
        """A hemisphere letter in the wrong column outranks every heuristic."""
        for i in inrange_idx:
            if mismatch[i]:
                lbls[i] = "swap_axis"
        return lbls

    if mask:
        for i in inrange_idx:
            la, lo = float(lats[i]), float(lons[i])
            if not _in_mask(la, lo, mask) and _in_mask(lo, la, mask):
                labels[i] = "swap_cluster"
        return _apply_axis_proof(labels), None

    if reference is not None:
        center = (float(reference[0]), float(reference[1]))
        tol = float(region_radius)
        for i in inrange_idx:
            la, lo = float(lats[i]), float(lons[i])
            d_as = math.hypot(la - center[0], lo - center[1])
            d_sw = math.hypot(lo - center[0], la - center[1])
            if d_as > tol and d_sw <= tol:
                labels[i] = "swap_cluster"
        return _apply_axis_proof(labels), center

    if len(inrange_idx) < min_cluster:
        return _apply_axis_proof(labels), None

    as_is = np.array([[float(lats[i]), float(lons[i])] for i in inrange_idx], dtype=float)
    center, radius = _dense_center(as_is)
    outlier_factor, return_factor = 3.0, 1.5

    distances = {i: (math.hypot(float(lats[i]) - center[0], float(lons[i]) - center[1]),
                     math.hypot(float(lons[i]) - center[0], float(lats[i]) - center[1]))
                 for i in inrange_idx}

    # How far the good data actually reaches from the centre. `radius` is the
    # radius of the dense *core*, and a country is much wider than its core: in
    # a survey around Lisbon with points nationwide the core radius came to
    # 1.85 degrees, so the old tolerance of 1.5 x radius was 2.78 degrees while
    # mainland Portugal is 5.4 degrees tall. A row reversed anywhere north of
    # Coimbra or along the eastern border landed outside that tolerance and was
    # reported as fine: 38% of genuinely reversed rows went undetected, and the
    # whole of Tras-os-Montes was a blind spot.
    #
    # The outliers are excluded from the measurement, so a reversed row cannot
    # inflate the tolerance that has to catch it. That also bounds the result:
    # an inlier is within outlier_factor x radius by definition, so the
    # tolerance never exceeds 4 x radius against an outlier threshold of 3.
    extent = max((d_as for i, (d_as, _) in distances.items()
                  if d_as <= outlier_factor * radius), default=0.0)
    return_tolerance = max(return_factor * radius, extent + radius)

    # The extent test needs the data to have some spread before it can help. A
    # single tight survey - one quarry, one municipality - has none, and a row
    # reversed there stays missed however the tolerance is written, because the
    # tolerance is derived from evidence the file does not contain. What that
    # row does show is that swapping it moves it enormously closer to the rest:
    # ten times closer is the threshold, chosen by measuring both sides of the
    # trade. Below it the tool starts accusing real places (a factor of 6 puts
    # 0.7% of the world's land under suspicion for a Portuguese survey); above
    # it recall falls away on compact data (a factor of 15 misses 8% of
    # reversals in a 2 km survey). At ten, recall is complete on every survey
    # shape tried - a quarry, a road transect, two towns, a sparse national
    # spread, an island group - and the cost is around one place in four
    # hundred, all of them in the mirror of the data.
    return_ratio = 10.0

    for i in inrange_idx:
        d_as, d_sw = distances[i]
        if d_as <= outlier_factor * radius:
            continue
        if d_sw <= return_tolerance or (d_sw > 0.0 and d_as >= return_ratio * d_sw):
            labels[i] = "swap_cluster"

    return _apply_axis_proof(labels), (float(center[0]), float(center[1]))


# ---------------------------------------------------------------------------
# Region awareness: did valid points land outside the declared region?
# ---------------------------------------------------------------------------
def point_in_mask(lat, lon, mask) -> bool:
    """True if (lat, lon) falls inside any bbox of ``mask``."""
    return _in_mask(float(lat), float(lon), mask)


def identify_region(lat, lon, regions):
    """Name of the first region containing (lat, lon), or ``None``.

    ``regions`` is a name -> mask mapping (mask = list of (lat_min, lat_max,
    lon_min, lon_max) boxes), e.g. the application's known regions.
    """
    for name, mask in regions.items():
        if _in_mask(float(lat), float(lon), mask):
            return name
    return None


def suggest_region(lat_values, lon_values, regions, chosen=None,
                   min_rows=3, min_share=0.8):
    """The known region whose own sign would put this file inside it.

    A field notebook from the southern hemisphere is routinely written without
    signs, because the survey knew which side of the equator it stood on. Read
    literally, central Moçambique is Sudan. :func:`unsigned_outside_region`
    fixes that, but only against the region the user has *declared* - it is the
    only place the information can come from - so a user who never touches the
    region picker gets the default's answer to a question they did not know was
    being asked.

    This does not answer it either. It asks it. For each known region it
    applies that region's sign to the unsigned values and counts how many rows
    would then fall inside; if one region takes nearly all of them and the
    declared region takes fewer, its name is returned so an interface can put
    the question to the user.

    **It cannot tell a Moçambique file from a Sudan file, and does not try.**
    Both are unsigned magnitudes near 15 N; only the person who collected them
    knows. What it can say is that one sign flip would put every point inside a
    country this application knows, which is a fact worth showing to somebody
    whose alternative is the silent reading - as written, in the sea south of
    Khartoum, with nothing to say why.

    ``regions`` is a name -> mask mapping. ``chosen`` is the declared region's
    name, excluded from the candidates and used as the bar to beat. Returns
    ``{"region", "inside", "readable", "flips"}`` or ``None``.

    Only a region that requires at least one sign flip is offered:
    :func:`region_check` already reports points that sit in another region as
    written, and saying it twice would train the reader to skip both.
    """
    parsed = [
        (parse_coordinate(a), parse_coordinate(b))
        for a, b in zip(lat_values, lon_values)
    ]
    readable = [i for i, (a, b) in enumerate(parsed) if a is not None and b is not None]
    if len(readable) < min_rows:
        return None

    def inside_with(mask):
        """Rows inside ``mask`` once its sign is applied, and how many flipped."""
        sign_lat = unsigned_outside_region(lat_values, "lat", mask)
        sign_lon = unsigned_outside_region(lon_values, "lon", mask)
        inside = 0
        flips = 0
        for i in readable:
            lat, lon = parsed[i]
            if sign_lat[i]:
                lat = -abs(lat)
                flips += 1
            if sign_lon[i]:
                lon = -abs(lon)
                flips += 1
            if point_in_mask(lat, lon, mask):
                inside += 1
        return inside, flips

    bar = inside_with(regions[chosen])[0] if chosen in regions else 0

    best = None
    for name, mask in regions.items():
        if name == chosen:
            continue
        inside, flips = inside_with(mask)
        if flips == 0 or inside <= bar or inside < min_share * len(readable):
            continue
        # A tie is not evidence: two regions fitting equally well means the
        # file could be in either, and naming one would be a guess.
        if best is not None and inside == best["inside"]:
            best = None
            break
        if best is None or inside > best["inside"]:
            best = {"region": name, "inside": inside,
                    "readable": len(readable), "flips": flips}
    return best


#: Grid coordinates are read off the margin of a map sheet in kilometres -
#: "M 252,52" is what is printed there - so a table typed from one is routinely
#: in kilometres where the system's units are metres. It is the only scale
#: error with a habit behind it, and every extra factor offered would widen the
#: space in which this can guess wrong.
KILOMETRE = 1000.0


def suggest_scale(as_written, scaled, mask, min_rows=3, min_share=0.8):
    """Whether a projected file reads better with its values multiplied.

    The dangerous thing about a grid coordinate written in kilometres is that
    it converts. 252.52 in the 1:25000 military grid is a real easting - 252 m
    east of the false origin - so the transformation succeeds, the row is
    valid, and the point lands in the Atlantic instead of inland. Nothing fails.

    This does not divide anything. It is handed the same points transformed
    twice - once from the values as they stand, once from the values
    multiplied - and reports whether the second reading puts them inside the
    declared region while the first does not. The caller does the projecting;
    keeping it out of here leaves this module free of pyproj and makes the
    decision, which is the part worth pinning, testable on its own.

    ``as_written`` and ``scaled`` are lists of ``(lat, lon)`` or ``None``.
    ``mask`` is the declared region. Returns ``{"inside", "was", "readable"}``
    or ``None``.
    """
    if mask is None:
        return None
    readable = [i for i, p in enumerate(as_written)
                if p is not None and p[0] is not None and p[1] is not None]
    if len(readable) < min_rows or len(scaled) != len(as_written):
        return None

    def count(points):
        n = 0
        for i in readable:
            p = points[i]
            if p is None or p[0] is None or p[1] is None:
                continue
            if point_in_mask(p[0], p[1], mask):
                n += 1
        return n

    was = count(as_written)
    inside = count(scaled)
    if inside <= was or inside < min_share * len(readable):
        return None
    return {"inside": inside, "was": was, "readable": len(readable)}


def region_check(lats, lons, labels, regions, mask=None, reference=None,
                 region_radius=10.0):
    """Find valid ('ok') points that fall outside the region the user declared.

    Describe the declared region with either ``mask`` (list of bboxes) or
    ``reference`` (lat, lon) plus ``region_radius`` (degrees); with neither
    (auto mode) nothing is flagged. ``regions`` is a name -> mask mapping of
    known regions, used to report where the outside points actually fall.

    Only points already classified ``ok`` are considered — swaps and invalid
    rows have their own handling. Returns ``(out_idx, detected)``: ``out_idx``
    are the indices of valid points outside the declared region, and
    ``detected`` maps each such point's actual region name (or ``None`` when it
    matches no known region) to a count.
    """
    out_idx = []
    detected = {}
    if mask is None and reference is None:
        return out_idx, detected
    for i, label in enumerate(labels):
        if label != "ok":
            continue
        la, lo = float(lats[i]), float(lons[i])
        if mask is not None:
            inside = _in_mask(la, lo, mask)
        else:
            inside = math.hypot(la - reference[0], lo - reference[1]) <= region_radius
        if not inside:
            out_idx.append(i)
            name = identify_region(la, lo, regions) if regions else None
            detected[name] = detected.get(name, 0) + 1
    return out_idx, detected
