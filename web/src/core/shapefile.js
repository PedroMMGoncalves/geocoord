/**
 * Binary Shapefile (.shp/.shx/.dbf) writers for GeoCoord (JavaScript port).
 *
 * On the Python side this work is pyshp's, not geocoord/geoexport.py's, so
 * there is no function here to keep in line with a Python original the way
 * the rest of this port does. It lives in its own file rather than inside
 * geoexport.js so that the byte-layout bookkeeping below doesn't get in the
 * way of reading geoexport.js side by side with geocoord/geoexport.py.
 *
 * The byte layout matches pyshp's point-shapefile output exactly (see
 * tests/fixtures/parity.json's to_shapefile_zip section, and the DBF write
 * date is the one difference the contract masks out before comparing). Only
 * what GeoCoord needs is implemented: a single shape type (point) and a
 * single field type (254-byte text).
 */

const HEADER_SIZE = 100 // .shp and .shx share this header layout
const FILE_CODE = 9994
const VERSION = 1000
const SHAPE_TYPE_POINT = 1

const SHX_RECORD_SIZE = 8 // offset + content length, both 4-byte big-endian ints
const SHP_RECORD_CONTENT_SIZE = 20 // shape type (4) + x (8) + y (8)
const SHP_RECORD_SIZE = 8 + SHP_RECORD_CONTENT_SIZE // record header (8) + content (28 total)
const POINT_CONTENT_LENGTH_WORDS = SHP_RECORD_CONTENT_SIZE / 2 // 10

const DBF_HEADER_SIZE = 32
const DBF_FIELD_DESCRIPTOR_SIZE = 32
const DBF_FIELD_NAME_SIZE = 11
const DBF_FIELD_LENGTH = 254
const DBF_TERMINATOR = 0x0d
const DBF_DELETION_FLAG = 0x20 // a plain space marks a record as not deleted

const utf8Encoder = new TextEncoder()

/** Bounding box across a list of [x, y] points; [0, 0, 0, 0] when there are none. */
function boundingBox(points) {
  if (points.length === 0) return [0, 0, 0, 0]
  let xmin = points[0][0]
  let ymin = points[0][1]
  let xmax = points[0][0]
  let ymax = points[0][1]
  for (const [x, y] of points) {
    if (x < xmin) xmin = x
    if (x > xmax) xmax = x
    if (y < ymin) ymin = y
    if (y > ymax) ymax = y
  }
  return [xmin, ymin, xmax, ymax]
}

/**
 * Write the 100-byte header shared by .shp and .shx. The file code and both
 * length fields are big-endian; everything else (version, shape type, the
 * bounding box) is little-endian - a mix pyshp inherits from the shapefile
 * spec itself, not a choice either writer makes.
 */
function writeHeader(view, fileLengthWords, points) {
  view.setInt32(0, FILE_CODE, false)
  // bytes 4..24 are five reserved words and stay zero
  view.setInt32(24, fileLengthWords, false)
  view.setInt32(28, VERSION, true)
  view.setInt32(32, SHAPE_TYPE_POINT, true)
  const [xmin, ymin, xmax, ymax] = boundingBox(points)
  view.setFloat64(36, xmin, true)
  view.setFloat64(44, ymin, true)
  view.setFloat64(52, xmax, true)
  view.setFloat64(60, ymax, true)
  // bytes 68..100 are zmin/zmax/mmin/mmax, unused for points, and stay zero
}

/** The .shp file: a header, then one 28-byte record per point. */
export function writeShp(points) {
  const totalSize = HEADER_SIZE + SHP_RECORD_SIZE * points.length
  const buf = new ArrayBuffer(totalSize)
  const view = new DataView(buf)
  writeHeader(view, totalSize / 2, points)

  let offset = HEADER_SIZE
  points.forEach(([x, y], i) => {
    view.setInt32(offset, i + 1, false) // record number, 1-based
    view.setInt32(offset + 4, POINT_CONTENT_LENGTH_WORDS, false)
    view.setInt32(offset + 8, SHAPE_TYPE_POINT, true)
    view.setFloat64(offset + 12, x, true)
    view.setFloat64(offset + 20, y, true)
    offset += SHP_RECORD_SIZE
  })
  return new Uint8Array(buf)
}

/**
 * The .shx index: a header identical to the .shp's but for the file length,
 * then one 8-byte (offset, content length) entry per point. Every point
 * record is the same fixed size, so each offset advances by the same 14
 * words (28 bytes) and the content length is always 10 words.
 */
export function writeShx(points) {
  const totalSize = HEADER_SIZE + SHX_RECORD_SIZE * points.length
  const buf = new ArrayBuffer(totalSize)
  const view = new DataView(buf)
  writeHeader(view, totalSize / 2, points)

  let offset = HEADER_SIZE
  let recordOffsetWords = HEADER_SIZE / 2 // the first record sits right after the header
  points.forEach(() => {
    view.setInt32(offset, recordOffsetWords, false)
    view.setInt32(offset + 4, POINT_CONTENT_LENGTH_WORDS, false)
    recordOffsetWords += SHP_RECORD_SIZE / 2
    offset += SHX_RECORD_SIZE
  })
  return new Uint8Array(buf)
}

/**
 * The .dbf attribute table: a header, one field descriptor per field (all
 * `C`, 254 bytes wide - GeoCoord writes every attribute as text), a 0x0D
 * terminator, then one fixed-width record per feature. pyshp writes no
 * end-of-file marker, so neither does this.
 *
 * `fieldNames` are the already-sanitised (safeFieldNames) DBF field names.
 * `records` is one array of already-stringified values (dbfValue) per
 * feature, in the same order as `fieldNames`.
 */
export function writeDbf(fieldNames, records) {
  const recordSize = 1 + DBF_FIELD_LENGTH * fieldNames.length // deletion flag + fields
  const headerSize = DBF_HEADER_SIZE + DBF_FIELD_DESCRIPTOR_SIZE * fieldNames.length + 1
  const totalSize = headerSize + recordSize * records.length

  const buf = new ArrayBuffer(totalSize)
  const view = new DataView(buf)
  const bytes = new Uint8Array(buf)

  bytes[0] = 0x03 // version 3, no memo (.dbt) file
  // bytes 1..4 are the write date (year - 1900, month, day); pyshp stamps
  // today's date here, the parity contract masks it, and no reader needs it
  // to be right, so it is left zero.
  view.setUint32(4, records.length, true)
  view.setUint16(8, headerSize, true)
  view.setUint16(10, recordSize, true)
  // bytes 12..32 are reserved and stay zero

  let offset = DBF_HEADER_SIZE
  for (const name of fieldNames) {
    const nameBytes = utf8Encoder.encode(name).slice(0, DBF_FIELD_NAME_SIZE)
    bytes.set(nameBytes, offset) // zero-padded on the right: the rest of the buffer is already zero
    bytes[offset + 11] = 0x43 // 'C'
    // bytes 12..16 (field address, unused when reading) stay zero
    bytes[offset + 16] = DBF_FIELD_LENGTH
    bytes[offset + 17] = 0 // decimal count: none, this is a text field
    // bytes 18..32 are reserved and stay zero
    offset += DBF_FIELD_DESCRIPTOR_SIZE
  }
  bytes[offset] = DBF_TERMINATOR
  offset += 1

  for (const record of records) {
    bytes[offset] = DBF_DELETION_FLAG
    offset += 1
    for (const value of record) {
      // UTF-8 bytes, not characters: a multi-byte character truncated at the
      // 254-byte boundary must not straddle it.
      const valueBytes = utf8Encoder.encode(value).slice(0, DBF_FIELD_LENGTH)
      bytes.set(valueBytes, offset)
      bytes.fill(0x20, offset + valueBytes.length, offset + DBF_FIELD_LENGTH) // left-aligned, space-padded
      offset += DBF_FIELD_LENGTH
    }
  }

  return bytes
}
