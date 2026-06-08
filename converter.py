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

import re
from typing import Optional

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
