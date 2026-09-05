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
  formatDms,
  inRange,
  parseCoordinate,
} from './converter.js'

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
 * Returns a fresh `{ columns, rows }`; the input is untouched. Any derived
 * column already present - because the user is re-running after changing an
 * option - is dropped first rather than duplicated.
 */
export function buildResult(table, latCol, lonCol, { decimals = 6, addDms = true } = {}) {
  const keep = table.columns
    .map((c, i) => [c, i])
    .filter(([c]) => !DERIVED.includes(c))

  const columns = keep.map(([c]) => c)
  const rows = table.rows.map((row) => keep.map(([, i]) => row[i] ?? null))

  const latAt = table.columns.indexOf(latCol)
  const lonAt = table.columns.indexOf(lonCol)

  const lats = table.rows.map((row) => roundHalfEven(parseCoordinate(row[latAt]), decimals))
  const lons = table.rows.map((row) => roundHalfEven(parseCoordinate(row[lonAt]), decimals))

  return withDerived({ columns, rows }, lats, lons, addDms)
}

/** Append Latitude_DD..Longitude_GMS to a table, given the parsed coordinates. */
function withDerived(table, lats, lons, addDms) {
  const columns = [...table.columns, 'Latitude_DD', 'Longitude_DD', 'X_DD', 'Y_DD', 'WKT']
  if (addDms) columns.push('Latitude_GMS', 'Longitude_GMS')

  const rows = table.rows.map((row, i) => {
    const lat = lats[i]
    const lon = lons[i]
    const valid = inRange(lat, 'lat') && inRange(lon, 'lon')
    const out = [...row, lat, lon, lon, lat, valid ? `POINT (${lon} ${lat})` : null]
    if (addDms) out.push(formatDms(lat, 'lat'), formatDms(lon, 'lon'))
    return out
  })

  return { columns, rows, lats, lons }
}

/**
 * Swap Latitude_DD and Longitude_DD on the given row indices and rebuild every
 * column derived from them. Mirrors apply_swaps() in app.py.
 */
export function applySwaps(result, indices, { addDms = true } = {}) {
  const swap = new Set(indices)
  const lats = result.lats.map((v, i) => (swap.has(i) ? result.lons[i] : v))
  const lons = result.lons.map((v, i) => (swap.has(i) ? result.lats[i] : v))

  const base = stripDerived(result)
  return withDerived(base, lats, lons, addDms)
}

/** The original columns of a result, with everything the pipeline added removed. */
function stripDerived(result) {
  const keep = result.columns
    .map((c, i) => [c, i])
    .filter(([c]) => !DERIVED.includes(c))
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
  const skip = new Set(['X_DD', 'Y_DD', 'WKT'])
  const fieldIdx = result.columns
    .map((c, i) => [c, i])
    .filter(([c]) => !skip.has(c))
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
 */
export function toCsv(table, delimiter = ',') {
  const cell = (v) => {
    if (v === null || v === undefined) return ''
    const s = String(v)
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
