import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { cases } from './fixtures.js'
import { sanitizeFilename, safeFieldNames, toGeoJSON, toKML, toShapefileZip } from '../src/core/geoexport.js'

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

describe('toGeoJSON', () => {
  it.each(cases('to_geojson'))('%s', (_id, c) => {
    expect(JSON.parse(toGeoJSON(c.features))).toEqual(c.expected)
  })
})

describe('toKML', () => {
  it.each(cases('to_kml'))('%s', (_id, c) => {
    expect(toKML(c.features, c.name_key)).toBe(c.expected)
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
})
