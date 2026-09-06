/**
 * Geospatial exporters for GeoCoord (JavaScript port).
 *
 * This file is a deliberate, function-by-function translation of
 * `geocoord/geoexport.py`, in the same function order. Keep the two in sync:
 * `tests/fixtures/parity.json` is the contract both implementations are
 * checked against, and any divergence fails both CIs.
 *
 * Ported so far: sanitizeFilename, jsonSafe, toGeoJSON, toKML, safeFieldNames,
 * dbfValue and toShapefileZip. The last three lean on shapefile.js for the
 * actual .shp/.shx/.dbf bytes - see that file for why the binary writers
 * live apart from this one.
 */

import { writeShp, writeShx, writeDbf } from './shapefile.js'

// ESRI WKT for WGS84, written to the shapefile .prj sidecar.
// Mirrors WGS84_ESRI_WKT in geocoord/geoexport.py.
export const WGS84_ESRI_WKT =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",'
  + 'SPHEROID["WGS_1984",6378137.0,298.257223563]],'
  + 'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]'

/**
 * Turn an arbitrary name into a safe base name for output files and GIS layers.
 *
 * Mirrors sanitize_filename() in geocoord/geoexport.py. The NFKD normalisation
 * followed by dropping every non-ASCII character is what transliterates the
 * accents: "á" decomposes into "a" plus a combining mark, and the mark goes.
 * It also folds compatibility forms, so "ﬁ" becomes "fi", "½" becomes "12" and
 * "Ⅻ" becomes "XII", while "ß" and "œ" do not decompose and disappear
 * entirely. A lookup table of accented letters would pass the easy cases and
 * quietly get all of those wrong.
 */
export function sanitizeFilename(name, defaultName = 'converted', maxLength = 60) {
  let stem = String(name).replace(/\\/g, '/').split('/').pop()
  stem = stem.replace(/\.[^.]+$/, '') // drop a single trailing extension
  stem = stem.normalize('NFKD').replace(/[^\x00-\x7F]/g, '')
  stem = stem.replace(/[^A-Za-z0-9_-]+/g, '_')
  stem = stem.replace(/_+/g, '_').replace(/^[_-]+|[_-]+$/g, '')
  stem = stem.slice(0, maxLength).replace(/^[_-]+|[_-]+$/g, '')
  return stem || defaultName
}

/**
 * Coerce an attribute value to something JSON (and KML) can carry.
 * Mirrors _json_safe() in geocoord/geoexport.py, minus the numpy-scalar
 * `.item()` branch: JavaScript has one number type, so there is no separate
 * numpy int64/float64 to unwrap.
 */
export function jsonSafe(v) {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' || typeof v === 'boolean') return v
  return String(v)
}

/**
 * A feature's properties in order, accepting either a Map or a plain object.
 *
 * Prefer a Map. JavaScript orders integer-like keys of a plain object first and
 * numerically, whatever the insertion order, while Python's dict preserves
 * insertion order for every key. A spreadsheet column named "2024" would jump
 * to the front of the exported KML here and stay put there, and JSON.parse
 * reorders it before the exporter ever sees it, so a plain object cannot carry
 * the column order at all.
 */
function propEntries(props) {
  return props instanceof Map ? [...props.entries()] : Object.entries(props)
}

/** Read one property, from either a Map or a plain object. */
function propGet(props, key) {
  return props instanceof Map ? props.get(key) : props[key]
}

/**
 * GeoJSON FeatureCollection of points, as a string.
 * Mirrors to_geojson() in geocoord/geoexport.py. Coordinates are written as
 * JSON numbers, not through pyFloat: GeoJSON coordinates must be numbers, and
 * the parity contract compares the parsed object rather than raw bytes, so
 * Python's and JavaScript's differing number-to-string rendering never enters
 * the comparison here.
 */
export function toGeoJSON(features) {
  // The properties object is written out by hand rather than through
  // JSON.stringify. JavaScript hoists integer-like keys to the front of an
  // object, so a table with a column named "1" came out of Object.fromEntries
  // reordered - "1","2","amostra" where Python wrote "2","amostra","1" - and
  // the Map that carries the column order this far was undone at the last
  // step. The parity contract could not see it either: it compares the parsed
  // objects, and parsing hoists the keys again.
  const body = features.map(([lon, lat, props]) => {
    const entries = propEntries(props)
      .map(([k, v]) => `${JSON.stringify(String(k))}:${JSON.stringify(jsonSafe(v))}`)
      .join(',')
    // pyFloat, not JSON.stringify: Python keeps the ".0" on an integral float
    // and pads an exponent to two digits, and JavaScript does neither, so the
    // same point would be written -8.0 there and -8 here. The KML writer has
    // needed this all along; the contract could not see that GeoJSON did too.
    const coords = `[${pyFloat(Number(lon))},${pyFloat(Number(lat))}]`
    return '{"type":"Feature","geometry":{"type":"Point","coordinates":'
      + `${coords}},"properties":{${entries}}}`
  }).join(',')
  return `{"type":"FeatureCollection","features":[${body}]}`
}

/**
 * Escape the way Python's xml.sax.saxutils.escape() does: only `&`, `<` and
 * `>`. Quotes pass through untouched, unlike a general-purpose XML escaper.
 * `&` must be replaced first, or the `&` introduced by the `<`/`>`
 * replacements would themselves get escaped into `&amp;lt;` / `&amp;gt;`.
 */
function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// A cell a spreadsheet would execute rather than display. Excel, LibreOffice
// and Google Sheets all treat a leading =, +, - or @ as the start of a formula,
// and a leading tab or carriage return as an invitation to look at the next one.
const FORMULA_START = ['=', '+', '-', '@', '\t', '\r']

// Two of those five are also how a coordinate legitimately begins, and this is
// where the first attempt at this went wrong. It let a bare number through and
// nothing else, so a raw DMS column written with a minus instead of a
// hemisphere letter - which is how the southern hemisphere is normally written,
// and how most PALOP data arrives - came out of the export as `'-25° 58' 9"`.
// Reading that file back, the apostrophe stops the minus being leading,
// parseCoordinate finds no sign, and the point moves to the northern
// hemisphere. Fifty degrees of latitude, in silence, from a file the
// application itself had just written.
//
// So a whitelist rather than a pattern for numbers: every character a
// coordinate can contain, and nothing else.
const COORDINATE_CHARS = new Set(
  `0123456789 .,-+eE°ºª'"′″\u00a0NSEWOLnsewol`,
)

/**
 * A cell that a spreadsheet will display rather than execute.
 *
 * A converted file is usually somebody else's data, and it is opened in Excel
 * the moment it is downloaded. A cell reading `=HYPERLINK(...)` or `@SUM(...)`
 * came through the export verbatim and ran there. Prefixing an apostrophe is
 * the standard remedy and is invisible in the spreadsheet.
 *
 * Coordinates are never touched, whatever they start with. See the note above
 * for why that is the hard half. Mirrors csv_safe() in geocoord/geoexport.py.
 */
export function csvSafe(value) {
  if (typeof value !== 'string' || value === '') return value
  if (!FORMULA_START.includes(value[0])) return value
  // "=" and "@" can only begin a formula; the others can begin a coordinate.
  if (value[0] !== '=' && value[0] !== '@'
      && [...value].every((c) => COORDINATE_CHARS.has(c))) {
    return value
  }
  return `'${value}`
}

/**
 * Escape text going into an XML *attribute*, quotes included.
 *
 * escapeXml leaves the double quote alone, which is right inside an element and
 * wrong inside an attribute: a column named `a"b` produced `<Data name="a"b">`
 * and the KML was not well-formed XML at all, so no GIS would open the file.
 * Mirrors _escape_attr() in geocoord/geoexport.py.
 */
function escapeAttr(s) {
  return escapeXml(s).replace(/"/g, '&quot;')
}

/**
 * Format a number the way Python's repr does, for the values a coordinate can
 * take: an integral float keeps its ".0", and an exponent is padded to two
 * digits. JavaScript omits both.
 *
 * Deliberately bounded to the coordinate domain. Outside it the two languages
 * also disagree about when to switch to exponential form at all — Python from
 * 1e16, JavaScript only from 1e21 — and no latitude or longitude gets there.
 */
export function pyFloat(value) {
  if (!Number.isFinite(value)) return String(value)
  if (value === 0) return Object.is(value, -0) ? '-0.0' : '0.0'

  // The two languages switch to exponential notation at different magnitudes:
  // Python once the decimal exponent drops below -4 or reaches 16, JavaScript
  // only below -6 and at 21. In the gap they print the same number entirely
  // differently - 1e-5 is "1e-05" there and "0.00001" here - so the threshold
  // is applied explicitly rather than left to String().
  const exponential = value.toExponential()
  const exponent = Number(exponential.slice(exponential.indexOf('e') + 1))
  if (exponent < -4 || exponent >= 16) {
    // Python pads the exponent to two digits and always writes its sign.
    return exponential.replace(
      /e([+-]?)(\d+)$/,
      (_match, sign, digits) => `e${sign === '-' ? '-' : '+'}${digits.padStart(2, '0')}`,
    )
  }

  const s = String(value)
  return s.includes('.') ? s : `${s}.0`
}

/**
 * KML document of points (Google Earth / generic GIS), as a string.
 * Mirrors to_kml() in geocoord/geoexport.py. Built by concatenation, so
 * (unlike toGeoJSON) it is compared byte for byte against the contract, and
 * pyFloat is what keeps the coordinates matching Python's rendering.
 */
export function toKML(features, nameKey = null) {
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>',
  ]
  for (const [lon, lat, props] of features) {
    let name = ''
    const nameValue = nameKey === null || nameKey === undefined ? null : propGet(props, nameKey)
    if (nameValue !== null && nameValue !== undefined) {
      name = escapeXml(String(nameValue))
    }
    const data = propEntries(props)
      .filter(([, v]) => jsonSafe(v) !== null)
      .map(([k, v]) => `<Data name="${escapeAttr(String(k))}"><value>${escapeXml(String(jsonSafe(v)))}</value></Data>`)
      .join('')
    parts.push(
      '<Placemark>'
      + `<name>${name}</name>`
      + `<ExtendedData>${data}</ExtendedData>`
      + `<Point><coordinates>${pyFloat(Number(lon))},${pyFloat(Number(lat))},0</coordinates></Point>`
      + '</Placemark>',
    )
  }
  parts.push('</Document></kml>')
  return parts.join('')
}

// A character kept as-is by _safe_field_names' substitution below. Python's
// str.isalnum() is Unicode-aware - "ç" and "õ" pass, only punctuation and
// whitespace turn into "_" - so \p{L}/\p{N} (any-language letter or digit)
// is the match, not a plain [A-Za-z0-9].
function isFieldNameChar(ch) {
  return ch === '_' || /[\p{L}\p{N}]/u.test(ch)
}

/**
 * Cut `text` to at most `limit` UTF-8 bytes, dropping whole characters.
 *
 * The DBF format measures a field name in bytes, not in characters, and every
 * accented letter in Portuguese is two of them. Truncating to ten characters,
 * "Descrição_Amostra" and "Descrição_Local" became "Descrição_" and
 * "Descrição1" - different, so the uniqueness check was satisfied - and then
 * the writer, which measures in bytes as the format requires, cut both to
 * "Descriçã". The file ended up with two fields of the same name and a column
 * a GIS cannot reach. Mirrors _truncate_bytes() in geocoord/geoexport.py.
 */
function truncateBytes(text, limit = 10) {
  const encoder = new TextEncoder()
  let out = text
  while (out.length > 0 && encoder.encode(out).length > limit) {
    out = Array.from(out).slice(0, -1).join('')
  }
  return out
}

/**
 * Sanitise attribute names to valid, unique DBF field names (<= 10 chars).
 * Mirrors _safe_field_names() in geocoord/geoexport.py.
 *
 * Substitution happens over the whole name first, and truncation to 10
 * characters after, so which characters survive depends on where they land
 * post-substitution, not in the original string. Collisions are resolved
 * case-insensitively, and a numeric suffix replaces the candidate's tail
 * rather than extending past it, so every result still fits in 10 chars.
 */
export function safeFieldNames(names) {
  const used = new Set()
  const out = []
  for (const name of names) {
    let base = truncateBytes(
      Array.from(String(name))
        .map((ch) => (isFieldNameChar(ch) ? ch : '_'))
        .join(''),
    )
    if (base === '') base = 'field'
    let candidate = base
    let i = 1
    while (used.has(candidate.toUpperCase())) {
      const suffix = String(i)
      candidate = truncateBytes(base, 10 - suffix.length) + suffix
      i += 1
    }
    used.add(candidate.toUpperCase())
    out.push(candidate)
  }
  return out
}

/**
 * Coerce an attribute value to the text a DBF field holds.
 * Mirrors _dbf_value() in geocoord/geoexport.py: every attribute is written
 * as text (see toShapefileZip), so there is no column type to get wrong.
 */
export function dbfValue(v) {
  const safe = jsonSafe(v)
  return safe === null ? '' : String(safe)
}

/**
 * Point shapefile (.shp/.shx/.dbf/.prj) bundled into a single .zip.
 * Mirrors to_shapefile_zip() in geocoord/geoexport.py. JSZip stands in for
 * Python's zipfile module; the binary .shp/.shx/.dbf bytes themselves come
 * from shapefile.js.
 *
 * `baseName` names the components inside the zip and therefore the layer
 * name shown in GIS; it is sanitised, so passing the input file name yields
 * a clean layer. DBF field names are truncated to 10 characters; all
 * attributes are written as text to avoid type/length surprises.
 *
 * `prj` is the ESRI WKT written to the sidecar and describes the system the
 * geometry is actually in. It defaults to WGS84, so every existing caller
 * keeps its behaviour. A .prj naming a system the coordinates are not in is
 * worse than none at all.
 *
 * Returns a Promise for the zipped bytes: JSZip's own writer is
 * asynchronous, unlike Python's zipfile.
 */
export async function toShapefileZip(features, fieldNames, baseName = 'coordinates',
  prj = WGS84_ESRI_WKT) {
  // JSZip is fetched on demand, like SheetJS: it is a hundred kilobytes that
  // only the Shapefile download needs, and most visitors take the CSV.
  const { default: JSZip } = await import('jszip')
  fieldNames = Array.from(fieldNames)
  const dbfNames = safeFieldNames(fieldNames)
  const layer = sanitizeFilename(baseName, 'coordinates')

  const points = features.map(([lon, lat]) => [Number(lon), Number(lat)])
  // propGet, not props[name]: the properties may be a Map, which is how the
  // application carries the column order (see propEntries).
  const records = features.map(([, , props]) => fieldNames.map((name) => dbfValue(propGet(props, name))))

  const zip = new JSZip()
  zip.file(`${layer}.shp`, writeShp(points))
  zip.file(`${layer}.shx`, writeShx(points))
  zip.file(`${layer}.dbf`, writeDbf(dbfNames, records))
  zip.file(`${layer}.prj`, prj)
  // DEFLATE, matching the Python side, which has always passed ZIP_DEFLATED.
  // Without it the archive was merely a container: a five-thousand-point survey
  // came out at 9 MB where the desktop wrote 0.07 MB, and the whole thing was
  // held as a blob in the browser first. For partner institutions on a metered
  // connection that is the difference between a download and a lost afternoon.
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
