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


def _dense_center(points: np.ndarray):
    """Find the centre and radius of the densest cluster of (lat, lon) points."""
    span = max(float(points[:, 0].ptp()), float(points[:, 1].ptp()))
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


def detect_swaps(lats, lons, min_cluster: int = 6, reference=None):
    """Classify each row as ok / missing / out_of_range / swap_range / swap_cluster.

    Two layers of detection:

    1. Range: if (lat, lon) is out of bounds but the swapped pair is valid, the
       row is ``swap_range`` (a longitude almost certainly ended up in the
       latitude column).
    2. Cluster: among in-range rows, find the main cluster of the *as-is* points
       (assumed to be the correct majority, or use ``reference`` if given). A row
       is ``swap_cluster`` when it is a clear outlier from that cluster *and*
       swapping its coordinates lands it back inside the cluster.

    Returns ``(labels, center)`` where ``center`` is the (lat, lon) of the main
    cluster (or ``reference``), or ``None`` when the cluster step was skipped.

    Note: from coordinates alone the correct orientation is fundamentally
    ambiguous when exactly half the data is swapped, and a genuine point that is
    the mirror of the cluster cannot be told apart from a swapped one. Callers
    should treat ``swap_cluster`` as a suggestion to be reviewed, not a fact.
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

    if len(inrange_idx) < min_cluster and reference is None:
        return labels, None

    if reference is not None:
        center = np.array([float(reference[0]), float(reference[1])], dtype=float)
        as_is = np.array([[float(lats[i]), float(lons[i])] for i in inrange_idx], dtype=float)
        if len(as_is):
            dist = np.hypot(as_is[:, 0] - center[0], as_is[:, 1] - center[1])
            radius = max(1.0, float(np.percentile(dist, 50)))
        else:
            radius = 1.0
    else:
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
