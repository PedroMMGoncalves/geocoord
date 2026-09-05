/**
 * The conversion pipeline: a table of raw cells in, a table of results out.
 *
 * This is the part of `app.py` that is not Streamlit - the region masks, the
 * column guessing, the derived columns, the swap application, the feature list
 * the exporters want - lifted into pure functions over the neutral
 * `{ columns, rows }` shape so the browser and the desktop application do the
 * same thing to the same file, and so it can be tested without a UI.
 *
 * Nothing here reaches for React, the DOM, or a file. Everything is a value in
 * and a value out.
 */
import {
  axisMismatch,
  formatDms,
  inRange,
  parseCoordinate,
  parseProjected,
} from './converter.js'
import { WGS84_PROJ4, transformAll } from './crs.js'
import { csvSafe } from './geoexport.js'

/**
 * Expected-region masks for swap detection: name -> list of bounding boxes,
 * each (latMin, latMax, lonMin, lonMax). Mirrors REGION_MASKS in app.py.
 *
 * Insertion order matters: identifyRegion returns the first box a point falls
 * in, so the region a user is most likely to mean comes first.
 */
export const REGION_MASKS = {
  'Portugal mainland': [[36.8, 42.2, -9.6, -6.1]],
  Azores: [[36.9, 39.8, -31.3, -24.9]],
  // The Selvagens, the southernmost Portuguese territory, belong to the
  // Autonomous Region of Madeira and sit near 30.14 N, 15.87 W - well outside
  // the Madeira/Porto Santo/Desertas box, so they get their own.
  Madeira: [[32.3, 33.2, -17.3, -16.2], [30.0, 30.25, -16.1, -15.7]],
  Angola: [[-18.1, -4.3, 11.6, 24.2]],
  'Cabo Verde': [[14.7, 17.3, -25.5, -22.6]],
  'Guiné-Bissau': [[10.8, 12.8, -16.9, -13.5]],
  Moçambique: [[-27.0, -10.4, 30.1, 41.0]],
  'São Tomé e Príncipe': [[-0.1, 1.8, 6.4, 7.6]],
}

/** Column names that usually hold a latitude, in the order they are tried. */
export const LAT_CANDIDATES = [
  'latitude', 'lat', 'coordenadas x', 'latitude x', 'coord_lat',
  'lat_dms', 'lat_gms', 'y', 'y_dd', 'lat_y',
]

/** Column names that usually hold a longitude, in the order they are tried. */
export const LON_CANDIDATES = [
  'longitude', 'lon', 'long', 'coordenadas y', 'longitude y', 'coord_lon',
  'lon_dms', 'lon_gms', 'x', 'x_dd', 'lon_x',
]

/**
 * Index of the first column whose name matches a candidate, else `fallback`
 * (clamped to the last column). Mirrors guess_column() in app.py.
 */
export function guessColumn(columns, candidates, fallbackIndex) {
  const lowered = columns.map((c) => String(c).toLowerCase())
  for (const candidate of candidates) {
    const at = lowered.indexOf(candidate.toLowerCase())
    if (at !== -1) return at
  }
  return Math.min(fallbackIndex, columns.length - 1)
}

/** The columns the pipeline appends, in the order app.py appends them. */
export const DERIVED = [
  'Latitude_DD', 'Longitude_DD', 'X_DD', 'Y_DD', 'status', 'WKT',
  'Latitude_GMS', 'Longitude_GMS',
]

/**
 * Round to `decimals` places the way Python's round() does - half to even.
 *
 * The same reasoning as formatDms': Math.round breaks a tie upwards and
 * Python's round breaks it to even, so a coordinate ending in an exact half at
 * the rounding position would export differently from the desktop application.
 */
function roundHalfEven(value, decimals) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  const factor = 10 ** decimals
  const scaled = value * factor
  const whole = Math.floor(Math.abs(scaled))
  const frac = Math.abs(scaled) - whole
  let rounded = whole
  if (frac > 0.5 || (frac === 0.5 && whole % 2 === 1)) rounded += 1
  const out = (scaled < 0 ? -rounded : rounded) / factor
  // -0 is a valid IEEE-754 value but reads as "-0" in an export, which nobody
  // wants to see in a coordinate column.
  return out === 0 ? 0 : out
}

/**
 * Convert the chosen columns and append the derived ones.
 *
 * Returns a fresh table; the input is untouched. Any derived column already
 * present - because the user is re-running after changing an option - is
 * dropped first rather than duplicated.
 *
 * `input` says how to read the two chosen columns: `{ proj4, kind }`, where
 * kind is 'geographic' or 'projected'. Omitting it means WGS84 degrees, which
 * is what the application did before there were systems to choose from.
 * `output` adds columns in a second system: `{ proj4, suffix }`.
 *
 * Asynchronous because proj4 is fetched on demand, and because a file already
 * in WGS84 with no output system never touches it at all.
 */
export async function buildResult(table, xCol, yCol, {
  decimals = 6,
  addDms = true,
  input = null,
  output = null,
} = {}) {
  const keep = table.columns
    .map((c, i) => [c, i])
    .filter(([c]) => !isDerived(c))

  const columns = keep.map(([c]) => c)
  const rows = table.rows.map((row) => keep.map(([, i]) => row[i] ?? null))

  const xAt = table.columns.indexOf(xCol)
  const yAt = table.columns.indexOf(yCol)
  const rawX = table.rows.map((row) => row[xAt])
  const rawY = table.rows.map((row) => row[yAt])

  const projected = input !== null && input.kind === 'projected'
  // A projected value is a number of metres and must not go through the
  // degrees parser: "532725 4555481" would be read as degrees, minutes and
  // seconds, and it would be read successfully, which is worse.
  const read = projected ? parseProjected : parseCoordinate

  // The chosen columns are (lat, lon) for a geographic system and (X, Y) - so
  // (lon-ish, lat-ish) - for a projected one. proj4 wants x first either way.
  let firsts = rawX.map(read)
  let seconds = rawY.map(read)
  let lats
  let lons
  if (input === null || input.proj4 === WGS84_PROJ4) {
    lats = firsts
    lons = seconds
  } else if (projected) {
    const wgs = await transformAll(
      firsts.map((v, i) => [v, seconds[i]]), input.proj4, WGS84_PROJ4)
    lons = wgs.map((p) => p[0])
    lats = wgs.map((p) => p[1])
  } else {
    // Geographic but not WGS84: ETRS89 or PTRA08 read as degrees, then shifted.
    const wgs = await transformAll(
      seconds.map((v, i) => [v, firsts[i]]), input.proj4, WGS84_PROJ4)
    lons = wgs.map((p) => p[0])
    lats = wgs.map((p) => p[1])
  }

  lats = lats.map((v) => roundHalfEven(v, decimals))
  lons = lons.map((v) => roundHalfEven(v, decimals))

  const mismatch = projected ? rows.map(() => false) : axisMismatch(rawX, rawY)
  const extra = await outputColumns(lats, lons, output)

  return {
    ...withDerived({ columns, rows }, lats, lons, addDms, extra),
    axisMismatch: mismatch,
    output,
  }
}

/**
 * The X/Y pair in the output system, or null when there is no second system.
 *
 * Rounded to the millimetre. Metres carry their precision in the integer part,
 * so the sixteen digits a float can hold leave far more decimals than any
 * survey means, and writing them out only invites somebody to believe them.
 */
async function outputColumns(lats, lons, output) {
  if (output === null || output === undefined) return null
  if (output.proj4 === WGS84_PROJ4) return null
  const pairs = await transformAll(
    lats.map((lat, i) => (lat === null || lons[i] === null ? [null, null] : [lons[i], lat])),
    WGS84_PROJ4, output.proj4)
  return {
    suffix: output.suffix,
    xs: pairs.map(([x]) => (x === null ? null : roundHalfEven(x, 3))),
    ys: pairs.map(([, y]) => (y === null ? null : roundHalfEven(y, 3))),
  }
}

/** True for a column this pipeline appends, including the per-system ones. */
function isDerived(name) {
  return DERIVED.includes(name) || /^(X|Y|WKT)_[A-Za-z0-9]+$/.test(String(name))
}

/** Append Latitude_DD..Longitude_GMS to a table, given the parsed coordinates. */
function withDerived(table, lats, lons, addDms, extra = null) {
  const columns = [...table.columns, 'Latitude_DD', 'Longitude_DD', 'X_DD', 'Y_DD', 'WKT']
  if (addDms) columns.push('Latitude_GMS', 'Longitude_GMS')
  if (extra !== null) {
    columns.push(`X_${extra.suffix}`, `Y_${extra.suffix}`, `WKT_${extra.suffix}`)
  }

  const rows = table.rows.map((row, i) => {
    const lat = lats[i]
    const lon = lons[i]
    const valid = inRange(lat, 'lat') && inRange(lon, 'lon')
    const out = [...row, lat, lon, lon, lat, valid ? `POINT (${lon} ${lat})` : null]
    if (addDms) out.push(formatDms(lat, 'lat'), formatDms(lon, 'lon'))
    if (extra !== null) {
      const x = extra.xs[i]
      const y = extra.ys[i]
      out.push(x, y, x === null || y === null ? null : `POINT (${x} ${y})`)
    }
    return out
  })

  return { columns, rows, lats, lons, extra }
}

/**
 * Swap Latitude_DD and Longitude_DD on the given row indices and rebuild every
 * column derived from them, the output system's included.
 */
export async function applySwaps(result, indices, { addDms = true } = {}) {
  const swap = new Set(indices)
  const lats = result.lats.map((v, i) => (swap.has(i) ? result.lons[i] : v))
  const lons = result.lons.map((v, i) => (swap.has(i) ? result.lats[i] : v))

  const base = stripDerived(result)
  const extra = await outputColumns(lats, lons, result.output ?? null)
  return {
    ...withDerived(base, lats, lons, addDms, extra),
    axisMismatch: result.axisMismatch,
    output: result.output ?? null,
  }
}

/** The original columns of a result, with everything the pipeline added removed. */
function stripDerived(result) {
  const keep = result.columns
    .map((c, i) => [c, i])
    .filter(([c]) => !isDerived(c))
  return {
    columns: keep.map(([c]) => c),
    rows: result.rows.map((row) => keep.map(([, i]) => row[i])),
  }
}

/**
 * The features the exporters take, and the attribute names that go with them.
 *
 * Only rows whose coordinates are both in range become features - a row that
 * failed to parse has no place on a map. Mirrors features_in_range() in app.py.
 *
 * Properties travel as a Map rather than a plain object on purpose: a column
 * named "1" would be hoisted to the front of an object's key order by
 * JavaScript, silently reordering the attributes of every exported feature
 * against what the desktop application writes.
 */
export function featuresInRange(result) {
  // The second system's X/Y/WKT are geometry too, not attributes.
  const skip = new Set(['X_DD', 'Y_DD', 'WKT'])
  const fieldIdx = result.columns
    .map((c, i) => [c, i])
    .filter(([c]) => !skip.has(c) && !/^(X|Y|WKT)_[A-Za-z0-9]+$/.test(String(c)))
  const fieldNames = fieldIdx.map(([c]) => c)

  const features = []
  for (let i = 0; i < result.rows.length; i += 1) {
    const lat = result.lats[i]
    const lon = result.lons[i]
    if (!inRange(lat, 'lat') || !inRange(lon, 'lon')) continue
    const props = new Map(fieldIdx.map(([c, at]) => [c, result.rows[i][at]]))
    features.push([lon, lat, props])
  }
  return { features, fieldNames }
}

/**
 * Serialise a table to CSV text.
 *
 * A field is quoted when it holds the delimiter, a quote or a newline, which
 * is what Python's csv.writer does with its default dialect, and an embedded
 * quote is doubled. The caller adds the byte-order mark: Excel needs it to
 * open a UTF-8 file correctly, and every other consumer is happier without it.
 *
 * Cells go through csvSafe first, so a value a spreadsheet would run as a
 * formula is displayed instead. Numbers are left exactly as they are.
 */
export function toCsv(table, delimiter = ',') {
  const cell = (v) => {
    if (v === null || v === undefined) return ''
    const s = csvSafe(String(v))
    return /["\n\r]/.test(s) || s.includes(delimiter)
      ? `"${s.replaceAll('"', '""')}"`
      : s
  }
  const lines = [table.columns.map(cell).join(delimiter)]
  for (const row of table.rows) lines.push(row.map(cell).join(delimiter))
  return `${lines.join('\r\n')}\r\n`
}

/** Counts by status label, for the summary line. */
export function countByStatus(labels) {
  const counts = new Map()
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1)
  return counts
}

/** Bounding box and centroid of the valid points, or null when there are none. */
export function pointsSummary(result) {
  const lats = []
  const lons = []
  for (let i = 0; i < result.rows.length; i += 1) {
    const lat = result.lats[i]
    const lon = result.lons[i]
    if (inRange(lat, 'lat') && inRange(lon, 'lon')) {
      lats.push(lat)
      lons.push(lon)
    }
  }
  if (lats.length === 0) return null
  return {
    count: lats.length,
    latMin: Math.min(...lats),
    latMax: Math.max(...lats),
    lonMin: Math.min(...lons),
    lonMax: Math.max(...lons),
    latMean: lats.reduce((a, b) => a + b, 0) / lats.length,
    lonMean: lons.reduce((a, b) => a + b, 0) / lons.length,
  }
}

/**
 * Write the features as GPX 1.1 waypoints.
 *
 * GPX has no counterpart in the Python package, so it is outside the parity
 * contract - stated here rather than left to be discovered. It exists because
 * a handheld GPS and every field application read it, which is where these
 * coordinates are usually going next.
 *
 * Only `&`, `<` and `>` are escaped, matching the escaping the KML writer
 * inherits from Python's xml.sax.saxutils.escape.
 */
export function toGpx(features, nameKey = null) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="GeoCoord" xmlns="http://www.topografix.com/GPX/1/1">',
  ]
  for (const [lon, lat, props] of features) {
    const raw = nameKey === null || nameKey === undefined ? null : props.get(nameKey)
    const name = raw === null || raw === undefined ? '' : esc(raw)
    parts.push(`<wpt lat="${lat}" lon="${lon}"><name>${name}</name></wpt>`)
  }
  parts.push('</gpx>')
  return parts.join('')
}
