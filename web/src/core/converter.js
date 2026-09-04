/**
 * Coordinate conversion engine for GeoCoord (JavaScript port).
 *
 * This file is a deliberate, function-by-function translation of
 * `geocoord/converter.py`. Keep the two in the same order and keep the
 * behaviour identical: `tests/fixtures/parity.json` is the contract both
 * implementations are checked against, and any divergence fails both CIs.
 */

// Hemispheres that make the value negative (South, West/Oeste).
// Portuguese: O = Oeste (West), L = Leste (East); English: W, E.
const NEGATIVE_DIRS = new Set(['S', 'W', 'O'])

// A hemisphere letter standing on its own. It may sit against digits or symbols
// ("38.5W", '30"O'), but not against another letter, so a word like "Oeste" or
// "Norte" in a name column is never read as a direction. \p{L} is Unicode-aware,
// so accented words are excluded too. A plain \b would not do: a digit and a
// letter are both word characters, so "38.5W" would have no boundary and would
// silently lose its hemisphere.
const DIRECTION_RE = /(?<!\p{L})([NSEWOL])(?!\p{L})/iu
// Numbers (integer or decimal, dot or comma), always unsigned.
const NUMBER_RE = /\d+(?:[.,]\d+)?/g
// An explicit minus sign before the first digit.
const LEADING_MINUS_RE = /^\s*-\s*\d/

// Valid geographic bounds.
export const LAT_RANGE = [-90.0, 90.0]
export const LON_RANGE = [-180.0, 180.0]

/**
 * Convert a value (DMS/DM/decimal) into decimal degrees.
 *
 * Returns null when the value is empty or cannot be interpreted. The sign comes
 * from the hemisphere (N/S/E/W/O/L) when present, otherwise from an explicit
 * leading minus sign.
 *
 * Mirrors parse_coordinate() in geocoord/converter.py. Numbers are stringified
 * rather than short-circuited, exactly as the Python does, so that both sides
 * agree even on odd inputs such as 1e-7.
 */
export function parseCoordinate(value) {
  if (value === null || value === undefined) return null

  const txt = String(value).trim()
  if (txt === '' || txt === '-' || txt === '—') return null

  // 1) Hemisphere (prefix or suffix), if any.
  const dirMatch = DIRECTION_RE.exec(txt)
  const direction = dirMatch ? dirMatch[1].toUpperCase() : null

  // 2) Explicit minus sign before the first digit.
  const hasMinus = LEADING_MINUS_RE.test(txt)

  // 3) Numeric components (magnitude, always positive).
  const nums = [...txt.matchAll(NUMBER_RE)].map((m) => parseFloat(m[0].replace(',', '.')))
  if (nums.length === 0) return null

  let magnitude
  if (nums.length === 1) {
    magnitude = nums[0]
  } else if (nums.length === 2) {
    magnitude = nums[0] + nums[1] / 60.0
  } else {
    // >= 3: degrees, minutes, seconds (extras ignored)
    magnitude = nums[0] + nums[1] / 60.0 + nums[2] / 3600.0
  }

  // 4) Sign: the hemisphere takes priority; otherwise the explicit minus.
  const negative = direction !== null ? NEGATIVE_DIRS.has(direction) : hasMinus

  return negative ? -magnitude : magnitude
}

/**
 * Whether the value falls within the valid bounds of the axis ('lat' or 'lon').
 * Mirrors in_range() in geocoord/converter.py.
 */
export function inRange(value, axis) {
  if (value === null || value === undefined) return false
  const v = Number(value)
  if (!Number.isFinite(v)) return false
  const [low, high] = axis === 'lat' ? LAT_RANGE : LON_RANGE
  return low <= v && v <= high
}

/**
 * Format seconds the way Python's "%g" does: shortest round-tripping form, no
 * trailing ".0". Seconds are rounded to at most `secondsDecimals` first, so the
 * exponential threshold of %g is never reached.
 */
function formatG(value) {
  return String(Number(value))
}

/**
 * Format a decimal-degrees value back into a DMS string.
 * Example: formatDms(-9.136667, 'lon') -> "9° 8' 12.001\" W".
 * Mirrors format_dms() in geocoord/converter.py.
 */
export function formatDms(value, axis, secondsDecimals = 3) {
  if (value === null || value === undefined) return null
  const num = Number(value)
  if (!Number.isFinite(num)) return null

  const [positive, negative] = axis === 'lat' ? ['N', 'S'] : ['E', 'W']
  const hemisphere = num >= 0 ? positive : negative

  const v = Math.abs(num)
  let degrees = Math.trunc(v)
  const remMinutes = (v - degrees) * 60.0
  let minutes = Math.trunc(remMinutes)
  const factor = 10 ** secondsDecimals
  let seconds = Math.round((remMinutes - minutes) * 60.0 * factor) / factor

  // Handle rounding roll-over (e.g. 59.9996 -> 60).
  if (seconds >= 60.0) {
    seconds -= 60.0
    minutes += 1
  }
  if (minutes >= 60) {
    minutes -= 60
    degrees += 1
  }

  return `${degrees}° ${minutes}' ${formatG(seconds)}" ${hemisphere}`
}

/**
 * Coerce a value to a number, or null when it is not a number at all. Mirrors
 * _is_number() in geocoord/converter.py, including its quirk of accepting
 * infinities, which validPair then rejects. Empty strings are rejected here
 * because Number('') is 0 in JavaScript while float('') raises in Python.
 */
function toNumber(x) {
  if (x === null || x === undefined) return null
  let v
  if (typeof x === 'number') {
    v = x
  } else if (typeof x === 'boolean') {
    v = Number(x)
  } else {
    const s = String(x).trim()
    if (s === '') return null
    v = Number(s)
  }
  return Number.isNaN(v) ? null : v
}

function validPair(lat, lon) {
  return (
    LAT_RANGE[0] <= lat && lat <= LAT_RANGE[1]
    && LON_RANGE[0] <= lon && lon <= LON_RANGE[1]
  )
}

/** True if (lat, lon) falls inside any bbox [latMin, latMax, lonMin, lonMax]. */
function inMask(lat, lon, mask) {
  for (const [la0, la1, lo0, lo1] of mask) {
    if (la0 <= lat && lat <= la1 && lo0 <= lon && lon <= lo1) return true
  }
  return false
}

/** True if (lat, lon) falls inside any bbox of `mask`. */
export function pointInMask(lat, lon, mask) {
  return inMask(Number(lat), Number(lon), mask)
}

/**
 * Name of the first region containing (lat, lon), or null.
 * `regions` is a plain object mapping name -> mask; JavaScript preserves the
 * insertion order of string keys, matching Python's dict order.
 */
export function identifyRegion(lat, lon, regions) {
  for (const [name, mask] of Object.entries(regions)) {
    if (inMask(Number(lat), Number(lon), mask)) return name
  }
  return null
}
