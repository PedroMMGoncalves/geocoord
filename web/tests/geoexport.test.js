import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { cases } from './fixtures.js'
import {
  csvSafe,
  safeFieldNames,
  sanitizeFilename,
  toGeoJSON,
  toKML,
  toShapefileZip,
} from '../src/core/geoexport.js'

describe('sanitizeFilename', () => {
  it.each(cases('sanitize_filename'))('%s', (_id, c) => {
    const args = [c.name]
    if (c.kwargs && c.kwargs.default !== undefined) args.push(c.kwargs.default)
    expect(sanitizeFilename(...args)).toBe(c.expected)
  })
})

describe('safeFieldNames', () => {
  it.each(cases('safe_field_names'))('%s', (_id, c) => {
    expect(safeFieldNames(c.names)).toEqual(c.expected)
  })
})

/**
 * Rebuild each feature's properties as a Map, in the order the contract
 * records. A plain object cannot carry that order: JavaScript hoists an
 * integer-like key to the front, and JSON.parse has already done so by the
 * time the fixture reaches here. This is also how the application calls the
 * exporters.
 */
function withOrder(c) {
  return c.features.map(([lon, lat, props], i) =>
    [lon, lat, new Map(c.prop_order[i].map((k) => [k, props[k]]))])
}

describe('toGeoJSON', () => {
  // The text, not the parsed object: parsing hoists the integer-like keys
  // again, which cancelled out a real ordering divergence inside the test.
  it.each(cases('to_geojson'))('%s', (_id, c) => {
    expect(toGeoJSON(withOrder(c))).toBe(c.expected)
  })

  it('keeps the column order a plain object would destroy', () => {
    const ordered = new Map([['2', 'b'], ['amostra', 'A'], ['1', 'a']])
    const text = toGeoJSON([[-8.0, 39.0, ordered]])
    expect(text).toContain('"properties":{"2":"b","amostra":"A","1":"a"}')
  })
})

describe('toKML', () => {
  it.each(cases('to_kml'))('%s', (_id, c) => {
    expect(toKML(withOrder(c), c.name_key)).toBe(c.expected)
  })

  it('hoists an integer-like key when given a plain object, which is why Maps are used', () => {
    const asObject = [[-8.0, 39.0, { local: 'Beja', 2024: '12', nota: 'x', 0: 'zero' }]]
    const order = [...toKML(asObject, 'local').matchAll(/<Data name="([^"]+)"/g)].map((m) => m[1])
    expect(order).toEqual(['0', '2024', 'local', 'nota'])
  })
})

function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The four shapefile parts, hex-encoded, with the DBF write date zeroed.
 * Mirrors _shapefile_components() in tests/test_parity.py: pyshp stamps
 * bytes 1..3 of the DBF header with today's date and JSZip stamps every
 * entry with the local time, so neither the .zip nor the raw .dbf is
 * reproducible - the parts are compared instead, with the date masked.
 */
async function shapefileComponents(zipBytes) {
  const zip = await JSZip.loadAsync(zipBytes)
  const out = {}
  for (const name of Object.keys(zip.files)) {
    const ext = name.split('.').pop()
    const bytes = await zip.files[name].async('uint8array')
    if (ext === 'dbf') bytes.set([0, 0, 0], 1)
    out[ext] = toHex(bytes)
  }
  return out
}

describe('toShapefileZip', () => {
  it.each(cases('to_shapefile_zip'))('%s', async (_id, c) => {
    const data = await toShapefileZip(c.features, c.field_names, c.base_name)
    expect(await shapefileComponents(data)).toEqual(c.expected)

    // Not compared above: the zip container itself isn't reproducible
    // either, so what's left to check is that it actually is one, with the
    // components named after the sanitised layer name.
    const layer = sanitizeFilename(c.base_name, 'coordinates')
    const zip = await JSZip.loadAsync(data)
    expect(Object.keys(zip.files).sort()).toEqual(
      [`${layer}.shp`, `${layer}.shx`, `${layer}.dbf`, `${layer}.prj`].sort(),
    )
  })

  // The fixtures above pass plain objects, so nothing there would notice if the
  // writer stopped reading Map properties - and the application passes Maps, to
  // keep the column order. A differential run against the Python caught exactly
  // that regression once; this pins it.
  it('reads properties from a Map as well as from a plain object', async () => {
    const asObject = [[-8.0, 39.0, { name: 'Porto', count: 3 }]]
    const asMap = [[-8.0, 39.0, new Map([['name', 'Porto'], ['count', 3]])]]
    const fields = ['name', 'count']
    expect(await shapefileComponents(await toShapefileZip(asMap, fields)))
      .toEqual(await shapefileComponents(await toShapefileZip(asObject, fields)))
  })
})

describe('csvSafe', () => {
  // A converted file is opened in Excel the moment it is downloaded, and a cell
  // beginning with =, +, - or @ is a formula there. Numbers are never touched:
  // a negative coordinate begins with a minus.
  it.each(cases('csv_safe'))('%s', (_id, c) => {
    expect(csvSafe(c.input)).toBe(c.expected)
  })
})
