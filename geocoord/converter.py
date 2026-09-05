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

    Decimal commas inside the data (``"33,6603"``) are left as-is;
    :func:`parse_coordinate` already understands them.
    """
    df = df.copy()

    # Treat blank / whitespace-only string cells as missing so they count as
    # empty for the row/column drops below.
    for c in df.select_dtypes(include="object").columns:
        stripped = df[c].astype(str).str.strip()
        df[c] = df[c].where(~stripped.isin(["", "nan", "None"]), np.nan)

    df = df.dropna(axis=1, how="all").dropna(axis=0, how="all")
    if df.empty:
        return df.reset_index(drop=True)

    # If no column carries a real name, the header is the first row of data.
    if all(_is_placeholder_name(c) for c in df.columns):
        header = df.iloc[0]
        df = df.iloc[1:].copy()
        # A promoted header cell may itself be blank. ``str(NaN)`` would name the
        # column "nan", and two such cells would collide into duplicate names,
        # which silently breaks column selection downstream. Give them distinct
        # positional names and let the drop below remove those carrying no data.
        df.columns = [
            str(h).strip() if not _is_placeholder_name(h) else f"Column {i + 1}"
            for i, h in enumerate(header)
        ]
        df = df.dropna(axis=1, how="all")

    return df.reset_index(drop=True)


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
                 region_radius: float = 10.0, mask=None):
    """Classify each row as ok / missing / out_of_range / swap_range / swap_cluster.

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

    if mask:
        for i in inrange_idx:
            la, lo = float(lats[i]), float(lons[i])
            if not _in_mask(la, lo, mask) and _in_mask(lo, la, mask):
                labels[i] = "swap_cluster"
        return labels, None

    if reference is not None:
        center = (float(reference[0]), float(reference[1]))
        tol = float(region_radius)
        for i in inrange_idx:
            la, lo = float(lats[i]), float(lons[i])
            d_as = math.hypot(la - center[0], lo - center[1])
            d_sw = math.hypot(lo - center[0], la - center[1])
            if d_as > tol and d_sw <= tol:
                labels[i] = "swap_cluster"
        return labels, center

    if len(inrange_idx) < min_cluster:
        return labels, None

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

    return labels, (float(center[0]), float(center[1]))


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
