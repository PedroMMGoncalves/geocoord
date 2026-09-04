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

import JSZip from 'jszip'
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
 * GeoJSON FeatureCollection of points, as a string.
 * Mirrors to_geojson() in geocoord/geoexport.py. Coordinates are written as
 * JSON numbers, not through pyFloat: GeoJSON coordinates must be numbers, and
 * the parity contract compares the parsed object rather than raw bytes, so
 * Python's and JavaScript's differing number-to-string rendering never enters
 * the comparison here.
 */
export function toGeoJSON(features) {
  const fc = {
    type: 'FeatureCollection',
    features: features.map(([lon, lat, props]) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [Number(lon), Number(lat)] },
      properties: Object.fromEntries(
        Object.entries(props).map(([k, v]) => [String(k), jsonSafe(v)]),
      ),
    })),
  }
  return JSON.stringify(fc)
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
  const s = String(value)
  if (s.includes('e')) return s.replace(/e([+-])(\d)$/, 'e$10$2')
  if (s.includes('.') || s.includes('N') || s.includes('I')) return s
  return `${s}.0`
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
    if (nameKey !== null && nameKey !== undefined && props[nameKey] !== null && props[nameKey] !== undefined) {
      name = escapeXml(String(props[nameKey]))
    }
    const data = Object.entries(props)
      .filter(([, v]) => jsonSafe(v) !== null)
      .map(([k, v]) => `<Data name="${escapeXml(String(k))}"><value>${escapeXml(String(jsonSafe(v)))}</value></Data>`)
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
    let base = Array.from(String(name))
      .map((ch) => (isFieldNameChar(ch) ? ch : '_'))
      .slice(0, 10)
      .join('')
    if (!base) base = 'field'
    let candidate = base
    let i = 1
    while (used.has(candidate.toUpperCase())) {
      const suffix = String(i)
      candidate = base.slice(0, 10 - suffix.length) + suffix
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
 * Returns a Promise for the zipped bytes: JSZip's own writer is
 * asynchronous, unlike Python's zipfile.
 */
export async function toShapefileZip(features, fieldNames, baseName = 'coordinates') {
  fieldNames = Array.from(fieldNames)
  const dbfNames = safeFieldNames(fieldNames)
  const layer = sanitizeFilename(baseName, 'coordinates')

  const points = features.map(([lon, lat]) => [Number(lon), Number(lat)])
  const records = features.map(([, , props]) => fieldNames.map((name) => dbfValue(props[name])))

  const zip = new JSZip()
  zip.file(`${layer}.shp`, writeShp(points))
  zip.file(`${layer}.shx`, writeShx(points))
  zip.file(`${layer}.dbf`, writeDbf(dbfNames, records))
  zip.file(`${layer}.prj`, WGS84_ESRI_WKT)
  return zip.generateAsync({ type: 'uint8array' })
}
