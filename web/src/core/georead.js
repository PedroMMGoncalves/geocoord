/**
 * Reading the geospatial formats GeoCoord already writes: KML, KMZ, GeoJSON, GPX.
 *
 * The browser port of geocoord/georead.py, and the counterpart of geoexport.js.
 * Everything here turns a file into the same `{ columns, rows }` table the CSV
 * and workbook readers produce, so the whole pipeline after it - column
 * guessing, coordinate parsing, swap detection, the region check, the map,
 * every exporter - works unchanged. Nothing here parses or validates a
 * coordinate; it only knows where to find one.
 *
 * These formats are tables of points and nothing more. A KML holding polygons,
 * a GPX holding a track, a GeoJSON holding a MultiPolygon: the points come
 * through and the rest is counted and reported, not half-read. A row is a
 * point, and there is no honest way to fold a polygon into one.
 *
 * The columns are named "Latitude" and "Longitude" deliberately. Both are exact
 * entries in LAT_CANDIDATES / LON_CANDIDATES in converter.js, so
 * guessCoordinateColumns finds them by name and stops - no new mechanism was
 * needed to tell the application which column is which. They must NOT be named
 * Latitude_DD or X_DD: those match the pipeline's own derived names and
 * buildResult strips them from the result and from every export.
 *
 * XML is parsed with the platform's own DOMParser rather than a parser written
 * here. This is the same arrangement the CSV reader already has - Python's
 * stdlib csv on one side, PapaParse on the other - where what the contract pins
 * is the resulting table, not the parser. Shipping a hand-rolled XML parser to
 * users when the browser carries a tested one would be the worse trade. Node
 * has no DOMParser, so the tests for this module run under jsdom; that is
 * declared per file, not for the whole suite.
 */
import { pyFloat } from './geoexport.js'
import {
  FileTooLarge,
  MAX_XLSX_BYTES,
  checkCells,
  headerNames,
} from './reader.js'

/** The columns declared ahead of the file's own. */
export const LAT_COLUMN = 'Latitude'
export const LON_COLUMN = 'Longitude'
/**
 * What the two are called when the file declares a projected system: the values
 * are metres, and calling a northing of 68811.71 a latitude is a lie the rest of
 * the application would then act on. Both are exact entries in LON_CANDIDATES
 * and LAT_CANDIDATES too, so the guess still finds them.
 */
export const X_COLUMN = 'X'
export const Y_COLUMN = 'Y'
export const NAME_COLUMN = 'Nome'
export const ALT_COLUMN = 'Altitude'

/** Extensions this module reads, for the upload filter. */
export const EXTENSIONS = ['.kml', '.kmz', '.geojson', '.json', '.gpx']

const WGS84_URNS = new Set([
  'urn:ogc:def:crs:ogc:1.3:crs84',
  'urn:ogc:def:crs:ogc::crs84',
  'urn:ogc:def:crs:epsg::4326',
  'epsg:4326',
  'crs84',
  'wgs84',
])

const EPSG_IN_URN = /(?:epsg:*)(\d{4,6})\s*$/i

const note = (code, params = {}) => ({ code, ...params })

const empty = (notes = [], crs = null) => ({
  table: { columns: [], rows: [] }, notes, crs,
})

// ---------------------------------------------------------------------------
// Shared: turning points into the table
// ---------------------------------------------------------------------------

/**
 * Refuse a file too large to parse into memory.
 *
 * The cell limit downstream bounds the table, which is no help here: a document
 * is parsed whole into a tree before any row exists, so a 400 MB GeoJSON has
 * already taken the tab down by the time there is anything to count. Mirrors
 * _check_size() in geocoord/georead.py.
 */
function checkSize(bytes) {
  if (bytes.length > MAX_XLSX_BYTES) {
    throw new FileTooLarge('bytes', bytes.length, MAX_XLSX_BYTES)
  }
}

/**
 * Whether an altitude column is worth keeping.
 *
 * GeoCoord's own KML writer puts a literal 0 in every third position, so
 * reading back a file this application wrote would otherwise add a column of
 * zeros to the table and then to every export, for ever.
 */
function altitudesWorthKeeping(values) {
  for (const v of values) {
    if (v === '') continue
    const n = Number(v)
    if (Number.isNaN(n) || n !== 0) return true
  }
  return false
}

/**
 * Assemble the table from points, each `{ lat, lon, alt, name, props }` where
 * `props` is a Map so insertion order survives a numeric key.
 *
 * The property keys are unioned across every point in first-seen order, never
 * taken from the first one: KML omits a <Data> element where the value is
 * blank - GeoCoord's own writer does - so the first Placemark does not describe
 * the file, and a reader that trusted it would drop whole columns.
 *
 * Names go through headerNames for the reason the CSV reader does: buildResult
 * resolves a column with indexOf, so a duplicate name is a column that can
 * never be selected. The declared names are seeded first, so a file carrying
 * its own "Latitude" property is the one renamed, not ours.
 */
function build(points, notes, crs = null, projected = false) {
  if (points.length === 0) return empty(notes, crs)

  const keys = []
  const seen = new Set()
  for (const p of points) {
    for (const k of p.props.keys()) {
      if (!seen.has(k)) { seen.add(k); keys.push(k) }
    }
  }

  const hasName = points.some((p) => p.name !== '')
  const hasAlt = altitudesWorthKeeping(points.map((p) => p.alt))

  const declared = hasName ? [NAME_COLUMN] : []
  if (projected) declared.push(Y_COLUMN, X_COLUMN)
  else declared.push(LAT_COLUMN, LON_COLUMN)
  if (hasAlt) declared.push(ALT_COLUMN)

  const columns = headerNames([...declared, ...keys])
  checkCells(points.length, columns.length)

  const rows = points.map((p) => {
    const row = []
    if (hasName) row.push(p.name)
    row.push(p.lat, p.lon)
    if (hasAlt) row.push(p.alt)
    for (const k of keys) row.push(p.props.get(k) ?? '')
    return row
  })

  return { table: { columns, rows }, notes, crs }
}

// ---------------------------------------------------------------------------
// XML shared between KML and GPX
// ---------------------------------------------------------------------------

/** An element's name without its namespace. */
const local = (el) => el.localName ?? el.nodeName.replace(/^.*:/, '')

/** Direct children of `el` whose local name is `name`. */
function children(el, name) {
  return [...el.children].filter((c) => local(c) === name)
}

/** Every descendant of `el` whose local name is `name`. */
function descendants(el, name) {
  const out = []
  const walk = (node) => {
    for (const c of node.children) {
      if (local(c) === name) out.push(c)
      walk(c)
    }
  }
  walk(el)
  return out
}

const firstChild = (el, name) => children(el, name)[0] ?? null

/**
 * All the text under `el`, tags removed, whitespace collapsed.
 *
 * textContent rather than the first text node, because a value can be
 * interrupted by markup - a <description> holding an HTML table is the common
 * case, and reading only the first run would return whatever preceded the
 * first tag.
 */
const text = (el) => (el === null || el === undefined
  ? '' : (el.textContent ?? '').split(/\s+/).filter(Boolean).join(' '))

/**
 * Parse XML text into a document, with a readable failure.
 *
 * DOMParser does not throw on malformed input; it returns a document whose
 * root is a <parsererror>. Both jsdom and every browser do this, and the
 * element is in the XHTML namespace, so it is found by local name.
 */
function parseXml(source) {
  const doc = new DOMParser().parseFromString(source, 'application/xml')
  const failure = doc.getElementsByTagName('parsererror')[0]
    ?? doc.documentElement?.getElementsByTagName?.('parsererror')?.[0]
  if (failure || !doc.documentElement) {
    const detail = (failure?.textContent ?? '').split(/\s+/).join(' ').slice(0, 200)
    throw new Error(`the file is not valid XML: ${detail || 'unparseable'}`)
  }
  return doc.documentElement
}

/**
 * Bytes to text for an XML document.
 *
 * A UTF-16 file starts with a byte-order mark, and Excel and older Windows
 * tooling produce them; TextDecoder handles the rest, and windows-1252 is the
 * fallback for the single-byte exports that call themselves latin1. This is the
 * same chain decodeCsvBytes uses, kept here because an XML declaration may also
 * name the encoding and a future refinement belongs in one place.
 */
function decodeXml(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes)
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes)
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

// ---------------------------------------------------------------------------
// KML and KMZ
// ---------------------------------------------------------------------------

/**
 * The KML document inside a KMZ.
 *
 * The entry is conventionally doc.kml and is not required to be: the
 * specification says the first .kml file in the archive is the document, so
 * that is what this takes, preferring doc.kml when both exist.
 */
async function kmlFromKmz(bytes) {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(bytes)
  let expanded = 0
  zip.forEach((_path, file) => {
    if (!file.dir) expanded += file._data?.uncompressedSize ?? 0
  })
  if (expanded > MAX_XLSX_BYTES) {
    throw new FileTooLarge('expanded bytes', expanded, MAX_XLSX_BYTES)
  }
  const names = Object.keys(zip.files)
    .filter((n) => !zip.files[n].dir && n.toLowerCase().endsWith('.kml'))
  if (names.length === 0) throw new Error('the archive holds no .kml document')
  const preferred = names.find((n) => n.toLowerCase() === 'doc.kml') ?? names[0]
  return zip.files[preferred].async('uint8array')
}

/**
 * The first `lon,lat[,alt]` tuple of a <coordinates> element.
 *
 * The text is kept exactly as the file wrote it: parsing to a number and
 * printing it again would introduce a rounding the file did not have, and these
 * values go straight into a column the user reads. Whitespace separates tuples
 * and commas separate the parts, and real files indent across lines.
 */
function kmlCoordinates(source) {
  const first = source.split(/\s+/).filter(Boolean)[0]
  if (!first) return null
  const parts = first.split(',')
  if (parts.length < 2) return null
  const lon = parts[0].trim()
  const lat = parts[1].trim()
  const alt = parts.length > 2 ? parts[2].trim() : ''
  if (lon === '' || lat === '') return null
  return { lat, lon, alt }
}

/**
 * The attributes of a Placemark, whichever dialect wrote them.
 *
 * Three are in circulation and a reader that knows one returns empty columns
 * for the other two: <Data name><value> (what GeoCoord and ArcGIS write, with
 * an optional <displayName> before the value), <SchemaData><SimpleData name>
 * (what QGIS and ogr2ogr write), and a <description> holding prose or an HTML
 * table (what Google Earth writes, where there is nothing structured to
 * recover, so it is kept whole rather than guessed at).
 */
function kmlProperties(placemark) {
  const props = new Map()
  for (const ext of children(placemark, 'ExtendedData')) {
    for (const data of descendants(ext, 'Data')) {
      const key = data.getAttribute('name')
      if (!key) continue
      props.set(key, text(firstChild(data, 'value')))
    }
    for (const simple of descendants(ext, 'SimpleData')) {
      const key = simple.getAttribute('name')
      if (key) props.set(key, text(simple))
    }
  }
  const description = text(firstChild(placemark, 'description'))
  if (description && !props.has('description')) props.set('description', description)
  return props
}

/**
 * Read a KML or KMZ into a table of its point Placemarks.
 *
 * A KMZ is recognised by its bytes rather than by its name: it is a zip, and
 * zips start with "PK". A Placemark holding a LineString, a Polygon or a Track
 * has no single position and is skipped and counted, not reduced to a vertex.
 * A Point inside a <MultiGeometry> is read, that being only a wrapper.
 *
 * Mirrors read_kml_bytes() in geocoord/georead.py.
 */
export async function readKmlBytes(bytes, name = '') {
  checkSize(bytes)
  let data = bytes
  if ((data[0] === 0x50 && data[1] === 0x4b) || name.toLowerCase().endsWith('.kmz')) {
    data = await kmlFromKmz(data)
    checkSize(data)
  }

  const root = parseXml(decodeXml(data))
  const points = []
  let skipped = 0

  for (const placemark of descendants(root, 'Placemark')) {
    const pointCoords = descendants(placemark, 'Point')
      .flatMap((p) => descendants(p, 'coordinates'))
    const chosen = pointCoords[0]
    if (!chosen) {
      if (descendants(placemark, 'coordinates').length > 0) skipped += 1
      continue
    }
    const parsed = kmlCoordinates(text(chosen))
    if (parsed === null) { skipped += 1; continue }
    points.push({
      ...parsed,
      name: text(firstChild(placemark, 'name')),
      props: kmlProperties(placemark),
    })
  }

  const notes = []
  if (skipped) notes.push(note('geo_skipped_non_points', { count: skipped }))
  return build(points, notes)
}

// ---------------------------------------------------------------------------
// GPX
// ---------------------------------------------------------------------------

// The waypoint-like elements, in the order they are preferred. A file with
// marked waypoints is a file whose points somebody chose; a track is a
// recording of where the receiver happened to be, at a point a second.
const GPX_KINDS = [
  ['wpt', 'gpx_from_waypoints'],
  ['rtept', 'gpx_from_route'],
  ['trkpt', 'gpx_from_track'],
]

const GPX_FIELDS = ['name', 'cmt', 'desc', 'sym', 'type', 'time', 'src']

/**
 * Attribute columns hidden in <extensions>.
 *
 * ogr2ogr and QGIS put a layer's own fields there as <ogr:field>value, which is
 * where a GPX exported from a GIS keeps everything that made it worth
 * exporting. Garmin puts display preferences there instead, which are not
 * interesting but are harmless: leaf elements with text become columns and
 * anything with children is left alone.
 */
function gpxExtensions(point) {
  const props = new Map()
  for (const ext of children(point, 'extensions')) {
    const walk = (node) => {
      for (const c of node.children) {
        if (c.children.length > 0) { walk(c); continue }
        const value = text(c)
        if (value && !props.has(local(c))) props.set(local(c), value)
      }
    }
    walk(ext)
  }
  return props
}

/**
 * Read a GPX into a table of its points.
 *
 * Waypoints if the file has any; otherwise the points of its routes; otherwise
 * the points of its tracks. A receiver exports a day's walk as a track and
 * nothing else, so a reader that only understood <wpt> would hand back an empty
 * table from the most ordinary file there is. When waypoints and a track are
 * both present the waypoints win and the track is reported rather than silently
 * appended - a track is thousands of rows a second apart, which is not what
 * somebody converting a list of sample sites is asking for.
 *
 * Mirrors read_gpx_bytes() in geocoord/georead.py.
 */
export function readGpxBytes(bytes) {
  checkSize(bytes)
  const root = parseXml(decodeXml(bytes))

  const found = new Map(GPX_KINDS.map(([kind]) => [kind, descendants(root, kind)]))
  const chosenKind = GPX_KINDS.map(([k]) => k).find((k) => found.get(k).length > 0)
  const notes = []
  if (!chosenKind) return empty(notes)

  if (chosenKind !== 'wpt') {
    const code = GPX_KINDS.find(([k]) => k === chosenKind)[1]
    notes.push(note(code, { count: found.get(chosenKind).length }))
  } else {
    const ignored = found.get('trkpt').length + found.get('rtept').length
    if (ignored) notes.push(note('gpx_ignored_tracks', { count: ignored }))
  }

  const points = []
  let skipped = 0
  for (const node of found.get(chosenKind)) {
    const lat = node.getAttribute('lat')
    const lon = node.getAttribute('lon')
    if (!lat || !lon) { skipped += 1; continue }
    const props = new Map()
    for (const field of GPX_FIELDS) {
      const child = firstChild(node, field)
      if (child !== null) props.set(field, text(child))
    }
    for (const [k, v] of gpxExtensions(node)) if (!props.has(k)) props.set(k, v)
    const pointName = props.get('name') ?? ''
    props.delete('name')
    points.push({
      lat: lat.trim(),
      lon: lon.trim(),
      alt: text(firstChild(node, 'ele')),
      name: pointName,
      props,
    })
  }

  if (skipped) notes.push(note('geo_skipped_non_points', { count: skipped }))
  return build(points, notes)
}

// ---------------------------------------------------------------------------
// GeoJSON
// ---------------------------------------------------------------------------

/**
 * A JSON number as text, the way geoexport writes one.
 *
 * A whole number prints without a decimal point. JSON has one numeric type and
 * neither port can tell 7 from 7.0 after parsing, so this is the only rule both
 * can follow - and it is the better rule anyway: an identifier column of 1, 2,
 * 3 must not come out as 1.0, 2.0, 3.0, which is the corruption readCsvText was
 * written to prevent. Everything else goes through pyFloat, so a file read in
 * the browser and on the desktop gives the same table.
 */
function numberText(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Number.isInteger(value) && Math.abs(value) < 1e16) return String(value)
  return pyFloat(value)
}

/**
 * One property value as a cell.
 *
 * A GeoJSON property may hold an object or an array, which a table has no place
 * for. It is written back as compact JSON rather than dropped: it is usually an
 * identifier or a small list, and the user can see it and decide. One
 * divergence is left standing rather than hidden: a float *nested inside* such
 * an object prints as 1 here and 1.0 in Python, because each side uses its own
 * JSON writer for the nested value. Top-level properties, which is what a table
 * actually shows, agree exactly.
 */
function flatten(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return numberText(value)
  return JSON.stringify(value)
}

/**
 * Every Feature in a document, whatever it is rooted at.
 *
 * A FeatureCollection is the usual case; a bare Feature and a bare geometry are
 * both valid GeoJSON and both turn up, the second from tools that export "the
 * geometry" rather than "the layer".
 */
function geojsonFeatures(node) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return []
  const kind = node.type
  if (kind === 'FeatureCollection') {
    return Array.isArray(node.features)
      ? node.features.filter((f) => f !== null && typeof f === 'object')
      : []
  }
  if (kind === 'Feature') return [node]
  if (['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon',
    'MultiPolygon', 'GeometryCollection'].includes(kind)) {
    return [{ type: 'Feature', geometry: node, properties: {} }]
  }
  return []
}

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * The position of a Point, or of the first point of a MultiPoint. Anything with
 * an extent - a line, a polygon - returns null and is counted as skipped: a row
 * is a point, and a polygon has no row.
 */
function geojsonPosition(geometry) {
  if (geometry === null || typeof geometry !== 'object') return null
  let coords = geometry.coordinates
  if (geometry.type === 'MultiPoint') {
    if (!Array.isArray(coords) || coords.length === 0) return null
    coords = coords[0]
  } else if (geometry.type !== 'Point') {
    return null
  }
  if (!Array.isArray(coords) || coords.length < 2) return null
  const [lon, lat, alt] = coords
  if (!isNumber(lon) || !isNumber(lat)) return null
  return {
    lat: numberText(lat),
    lon: numberText(lon),
    alt: isNumber(alt) ? numberText(alt) : '',
  }
}

/**
 * An EPSG code the file declares, when it is not WGS84.
 *
 * RFC 7946 fixed GeoJSON at WGS84 and removed the member, but the 2008 form is
 * still what a lot of software writes, QGIS included, and a file in
 * ETRS89/PT-TM06 whose coordinates are metres would otherwise be read as
 * degrees and rejected row by row with nothing to explain why.
 */
function declaredCrs(document) {
  const crs = document?.crs
  if (crs === null || typeof crs !== 'object') return null
  const name = crs.properties?.name
  if (typeof name !== 'string') return null
  const trimmed = name.trim()
  if (WGS84_URNS.has(trimmed.toLowerCase())) return null
  const match = EPSG_IN_URN.exec(trimmed)
  return match ? `EPSG:${match[1]}` : trimmed
}

/**
 * Read a GeoJSON into a table of its point features.
 *
 * Properties keep the order they appear in, per feature, unioned across the
 * file. A feature's `id` sits outside `properties` in the specification and is
 * carried as a column of its own, because it is usually the only stable
 * identifier the file has.
 *
 * Mirrors read_geojson_bytes() in geocoord/georead.py.
 */
export function readGeoJsonBytes(bytes) {
  checkSize(bytes)
  let source = new TextDecoder('utf-8').decode(bytes)
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1)

  let document
  try {
    document = JSON.parse(source)
  } catch (e) {
    throw new Error(`the file is not valid JSON: ${e.message}`)
  }

  const crs = declaredCrs(document)
  const points = []
  let skipped = 0

  for (const feature of geojsonFeatures(document)) {
    const position = geojsonPosition(feature.geometry)
    if (position === null) { skipped += 1; continue }
    const props = new Map()
    if (feature.id !== null && feature.id !== undefined) {
      props.set('id', flatten(feature.id))
    }
    const raw = feature.properties
    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [key, value] of Object.entries(raw)) props.set(String(key), flatten(value))
    }
    points.push({ ...position, name: '', props })
  }

  const notes = []
  if (skipped) notes.push(note('geo_skipped_non_points', { count: skipped }))
  if (crs) notes.push(note('geojson_crs', { crs }))
  return build(points, notes, crs, crs !== null)
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/** Whether `name` is a file this module reads. */
export function isGeospatial(name) {
  const lowered = String(name).toLowerCase()
  return EXTENSIONS.some((ext) => lowered.endsWith(ext))
}

/** Read whichever of the three formats `name` says this is. */
export async function readGeospatialBytes(bytes, name) {
  const lowered = String(name).toLowerCase()
  if (lowered.endsWith('.kml') || lowered.endsWith('.kmz')) {
    return readKmlBytes(bytes, name)
  }
  if (lowered.endsWith('.gpx')) return readGpxBytes(bytes)
  if (lowered.endsWith('.geojson') || lowered.endsWith('.json')) {
    return readGeoJsonBytes(bytes)
  }
  throw new Error(`not a geospatial file this application reads: ${name}`)
}
