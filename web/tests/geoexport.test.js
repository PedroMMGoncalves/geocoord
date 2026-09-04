import { describe, it, expect } from 'vitest'
import { cases } from './fixtures.js'
import { sanitizeFilename, toGeoJSON, toKML } from '../src/core/geoexport.js'

describe('sanitizeFilename', () => {
  it.each(cases('sanitize_filename'))('%s', (_id, c) => {
    const args = [c.name]
    if (c.kwargs && c.kwargs.default !== undefined) args.push(c.kwargs.default)
    expect(sanitizeFilename(...args)).toBe(c.expected)
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
