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
_POSITIVE_DIRS = {"N", "E", "L"}
_ALL_DIRS = _NEGATIVE_DIRS | _POSITIVE_DIRS

# A single, isolated hemisphere letter (avoids matching letters in larger words).
_DIRECTION_RE = re.compile(r"\b([NSEWOL])\b", re.IGNORECASE)
# Numbers (integer or decimal, dot or comma), always unsigned.
_NUMBER_RE = re.compile(r"\d+(?:[.,]\d+)?")
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

    txt = str(value).strip()
    if txt in ("", "-", "—"):
        return None

    # 1) Hemisphere (prefix or suffix), if any.
    dir_match = _DIRECTION_RE.search(txt)
    direction = dir_match.group(1).upper() if dir_match else None

    # 2) Explicit minus sign before the first digit.
    has_minus = re.match(r"\s*-\s*\d", txt) is not None

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
    seconds = round((rem_minutes - minutes) * 60.0, seconds_decimals)

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
        df.columns = [str(h).strip() for h in header]
        df = df.dropna(axis=1, how="all")  # a header cell may itself be blank

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
         of the in-range points, assuming the correct data is the majority.

    Returns ``(labels, center)`` where ``center`` is the (lat, lon) used as the
    expected location, or ``None`` for mask mode / when no cluster step ran.

    Note: in auto mode, from coordinates alone the correct orientation is
    fundamentally ambiguous when about half the data is swapped (the densest
    cluster may be the swapped one), and a genuine point at the mirror of the
    cluster cannot be told apart from a swapped one. Treat ``swap_cluster`` as a
    suggestion to be reviewed; provide ``mask`` or ``reference`` when the region
    is known.
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
    for i in inrange_idx:
        la, lo = float(lats[i]), float(lons[i])
        d_as = math.hypot(la - center[0], lo - center[1])
        d_sw = math.hypot(lo - center[0], la - center[1])
        if d_as > outlier_factor * radius and d_sw <= return_factor * radius:
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
