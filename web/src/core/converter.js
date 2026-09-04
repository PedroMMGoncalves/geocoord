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
// "Norte" in a name column is never read as a direction. A plain \b would not
// do: a digit and a letter are both word characters, so "38.5W" would have no
// boundary and would silently lose its hemisphere.
//
// The class is \p{L} plus \p{Nl} and \p{No} to match Python's [^\W\d_], which
// counts a Roman numeral or a superscript digit as alphanumeric. Without them
// "1²O" would read as -1 here and +1 there.
const DIRECTION_RE = /(?<![\p{L}\p{Nl}\p{No}])([NSEWOL])(?![\p{L}\p{Nl}\p{No}])/iu
// Numbers (integer or decimal, dot or comma), always unsigned. ASCII digits
// only, matching the Python side's re.ASCII.
const NUMBER_RE = /\d+(?:[.,]\d+)?/g
// An explicit minus sign before the first digit.
const LEADING_MINUS_RE = /^[ \t\n\r\f\v]*-[ \t\n\r\f\v]*\d/
// "º" and "ª" sit on a Portuguese keyboard where "°" does not, and read the same
// on screen. Unicode calls them letters, so left alone they shield an adjacent
// hemisphere letter from the guard above and "9ºO" comes back as +9.0.
const ORDINAL_SIGNS_RE = /[ºª]/g
// Characters whose whitespace status differs between the two languages; see
// parseCoordinate. Removed on both sides so neither can hide a sign.
const STRIP_CHARS_RE = /[﻿-]/g

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
 * Mirrors parse_coordinate() in geocoord/converter.py.
 */
export function parseCoordinate(value) {
  if (value === null || value === undefined) return null

  // A value that is already a number is already decimal degrees. Taking it as
  // it stands avoids a real trap on the Python side, where str() renders a
  // magnitude below 1e-4 in exponential form and the digits of the exponent
  // were then read as minutes, turning a latitude of 1e-05 into 1.0833.
  if (typeof value === 'number') return Number.isFinite(value) ? value : null

  // Characters the two languages disagree about. A byte-order mark left on the
  // first cell of a CSV is whitespace here but not to Python's strip(); NEL and
  // the ASCII file separators are whitespace there but not here. Either way one
  // side would leave the character sitting between the start of the string and a
  // leading minus sign, discarding the sign. Both sides drop them outright.
  const txt = String(value)
    .replace(STRIP_CHARS_RE, '')
    .replace(ORDINAL_SIGNS_RE, '°')
    .trim()
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
 * Format seconds the way Python's "%g" does: at most six significant digits,
 * trailing zeros trimmed, no ".0".
 *
 * The six-digit limit is not decoration. With secondsDecimals at 5 or more,
 * Python truncates 33.38305 to 33.3831 while JavaScript's shortest
 * round-tripping form would keep every digit, and the two DMS strings would
 * differ. Seconds are always rounded before they get here, so %g never reaches
 * its exponential threshold and only the precision limit matters.
 */
function formatG(value) {
  return String(Number(Number(value).toPrecision(6)))
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
  // Both implementations have to round identically, or the same file exports
  // different DMS strings from the Python application and from the browser one.
  // Python's round() breaks a tie to even while Math.round() goes up, so
  // neither is used: this scaled form is plain IEEE-754 arithmetic that both
  // languages execute bit for bit alike, with the tie rule written out.
  const factor = 10 ** secondsDecimals
  const scaled = (remMinutes - minutes) * 60.0 * factor
  let whole = Math.floor(scaled)
  const frac = scaled - whole
  if (frac > 0.5 || (frac === 0.5 && whole % 2 === 1)) whole += 1
  let seconds = whole / factor

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

/**
 * numpy.percentile with the default linear interpolation.
 * numpy.percentile([1,2,3,4], 90) is 3.7, not 4.
 */
export function percentileLinear(values, q) {
  const s = [...values].sort((a, b) => a - b)
  const n = s.length
  if (n === 1) return s[0]
  const idx = ((n - 1) * q) / 100
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return s[lo]
  return s[lo] + (s[hi] - s[lo]) * (idx - lo)
}

/** numpy.median: the 50th percentile with linear interpolation. */
export function median(values) {
  return percentileLinear(values, 50)
}

/** numpy.ptp: peak to peak, max minus min. */
function ptp(values) {
  let min = Infinity
  let max = -Infinity
  for (const v of values) {
    if (v < min) min = v
    if (v > max) max = v
  }
  return max - min
}

/**
 * Find the centre and radius of the densest cluster of [lat, lon] points.
 * Mirrors _dense_center() in geocoord/converter.py.
 */
function denseCenter(points) {
  const span = Math.max(ptp(points.map((p) => p[0])), ptp(points.map((p) => p[1])))
  const cell = Math.max(0.5, span / 20.0)

  const keys = points.map((p) => [Math.floor(p[0] / cell), Math.floor(p[1] / cell)])

  // Counter.most_common(1): on a tie the first-seen key wins, which a strict
  // greater-than comparison over an insertion-ordered Map reproduces.
  const counts = new Map()
  for (const [kx, ky] of keys) {
    const key = `${kx},${ky}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let bestKey = null
  let bestCount = -1
  for (const [key, count] of counts) {
    if (count > bestCount) {
      bestCount = count
      bestKey = key
    }
  }
  const [bx, by] = bestKey.split(',').map(Number)

  const members = points.filter(
    (_, i) => Math.abs(keys[i][0] - bx) <= 1 && Math.abs(keys[i][1] - by) <= 1,
  )

  const center = [
    median(members.map((m) => m[0])),
    median(members.map((m) => m[1])),
  ]
  const dist = members.map((m) => Math.hypot(m[0] - center[0], m[1] - center[1]))
  const radius = Math.max(1.0, percentileLinear(dist, 90))

  return { center, radius }
}

/**
 * Classify each row as ok / missing / out_of_range / swap_range / swap_cluster.
 *
 * Mirrors detect_swaps() in geocoord/converter.py. Options accept both the
 * snake_case names used by the Python signature (and therefore by
 * tests/fixtures/parity.json) and their camelCase equivalents.
 *
 * Returns { labels, center }, where center is the (lat, lon) used as the
 * expected location, or null for mask mode and when no cluster step ran.
 */
export function detectSwaps(lats, lons, options = {}) {
  const minCluster = options.min_cluster ?? options.minCluster ?? 6
  const reference = options.reference ?? null
  const regionRadius = options.region_radius ?? options.regionRadius ?? 10.0
  const mask = options.mask ?? null

  const n = lats.length
  const labels = new Array(n).fill('missing')
  const inrangeIdx = []

  for (let i = 0; i < n; i += 1) {
    const la = toNumber(lats[i])
    const lo = toNumber(lons[i])
    if (la === null || lo === null) {
      labels[i] = 'missing'
    } else if (validPair(la, lo)) {
      labels[i] = 'ok'
      inrangeIdx.push(i)
    } else if (validPair(lo, la)) {
      labels[i] = 'swap_range'
    } else {
      labels[i] = 'out_of_range'
    }
  }

  if (mask && mask.length) {
    for (const i of inrangeIdx) {
      const la = Number(lats[i])
      const lo = Number(lons[i])
      if (!inMask(la, lo, mask) && inMask(lo, la, mask)) {
        labels[i] = 'swap_cluster'
      }
    }
    return { labels, center: null }
  }

  if (reference !== null) {
    const center = [Number(reference[0]), Number(reference[1])]
    const tol = Number(regionRadius)
    for (const i of inrangeIdx) {
      const la = Number(lats[i])
      const lo = Number(lons[i])
      const dAs = Math.hypot(la - center[0], lo - center[1])
      const dSw = Math.hypot(lo - center[0], la - center[1])
      if (dAs > tol && dSw <= tol) labels[i] = 'swap_cluster'
    }
    return { labels, center }
  }

  if (inrangeIdx.length < minCluster) return { labels, center: null }

  const asIs = inrangeIdx.map((i) => [Number(lats[i]), Number(lons[i])])
  const { center, radius } = denseCenter(asIs)
  const outlierFactor = 3.0
  const returnFactor = 1.5
  for (const i of inrangeIdx) {
    const la = Number(lats[i])
    const lo = Number(lons[i])
    const dAs = Math.hypot(la - center[0], lo - center[1])
    const dSw = Math.hypot(lo - center[0], la - center[1])
    if (dAs > outlierFactor * radius && dSw <= returnFactor * radius) {
      labels[i] = 'swap_cluster'
    }
  }

  return { labels, center: [center[0], center[1]] }
}

/**
 * Find valid ('ok') points that fall outside the region the user declared.
 *
 * Mirrors region_check() in geocoord/converter.py. Returns { outIdx, detected },
 * where detected is a Map from the actual region name (or null when the point
 * matches no known region) to a count. A Map is used rather than a plain object
 * because null is a legitimate key here.
 */
export function regionCheck(lats, lons, labels, regions, options = {}) {
  const mask = options.mask ?? null
  const reference = options.reference ?? null
  const regionRadius = options.region_radius ?? options.regionRadius ?? 10.0

  const outIdx = []
  const detected = new Map()
  if (mask === null && reference === null) return { outIdx, detected }

  for (let i = 0; i < labels.length; i += 1) {
    if (labels[i] !== 'ok') continue
    const la = Number(lats[i])
    const lo = Number(lons[i])
    const inside = mask !== null
      ? inMask(la, lo, mask)
      : Math.hypot(la - reference[0], lo - reference[1]) <= regionRadius
    if (!inside) {
      outIdx.push(i)
      const name = regions ? identifyRegion(la, lo, regions) : null
      detected.set(name, (detected.get(name) ?? 0) + 1)
    }
  }
  return { outIdx, detected }
}

// Auto-generated column name pandas assigns to a header cell it found empty.
const PLACEHOLDER_COL_RE = /^Unnamed: \d+$/

/** True for an empty or pandas auto-generated ('Unnamed: N') column name. */
function isPlaceholderName(name) {
  const s = String(name ?? '').trim()
  return s === '' || s.toLowerCase() === 'nan' || PLACEHOLDER_COL_RE.test(s)
}

/** Blank / whitespace-only cells count as missing, as they do in tidy_table(). */
function isBlank(value) {
  if (value === null || value === undefined) return true
  if (typeof value === 'number') return Number.isNaN(value)
  const s = String(value).trim()
  return s === '' || s === 'nan' || s === 'None'
}

/**
 * Clean a freshly-read table so messy spreadsheet exports load correctly.
 *
 * Mirrors tidy_table() in geocoord/converter.py, operating on the neutral shape
 * { columns, rows } instead of a pandas DataFrame. Returns a new table; the
 * input is left untouched.
 *
 * Decimal commas inside the data ("33,6603") are left as-is; parseCoordinate
 * already understands them.
 */
export function tidyTable(table) {
  let columns = [...table.columns]
  let rows = table.rows.map((row) => row.map((v) => (isBlank(v) ? null : v)))

  // Drop columns that are entirely empty.
  const keep = columns.map((_, c) => rows.some((row) => row[c] !== null))
  columns = columns.filter((_, c) => keep[c])
  rows = rows.map((row) => row.filter((_, c) => keep[c]))

  // Drop rows that are entirely empty.
  rows = rows.filter((row) => row.some((v) => v !== null))

  if (rows.length === 0) return { columns, rows }

  // If no column carries a real name, the header is the first row of data.
  if (columns.every((c) => isPlaceholderName(c))) {
    const header = rows[0]
    rows = rows.slice(1)

    // A promoted header cell may itself be blank. Naming it str(NaN) would give
    // a column literally called "nan", and two such cells would collide into
    // duplicate names, which silently breaks column selection downstream. Give
    // them distinct positional names and let the drop below remove those that
    // carry no data.
    columns = header.map((h, i) => (isPlaceholderName(h) ? `Column ${i + 1}` : String(h).trim()))

    const keepAfter = columns.map((_, c) => rows.some((row) => row[c] !== null))
    columns = columns.filter((_, c) => keepAfter[c])
    rows = rows.map((row) => row.filter((_, c) => keepAfter[c]))
  }

  return { columns, rows }
}
