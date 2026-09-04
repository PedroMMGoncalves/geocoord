import { describe, it, expect } from 'vitest'
import { fixtures, cases } from './fixtures.js'
import { parseCoordinate, inRange, formatDms, pointInMask, identifyRegion } from '../src/core/converter.js'

describe('parity fixtures', () => {
  it('loads the shared contract', () => {
    expect(fixtures.parse_coordinate.length).toBe(31)
    expect(cases('parse_coordinate')[0][0]).toBe('decimal_positive')
  })
})

describe('parseCoordinate', () => {
  it.each(cases('parse_coordinate'))('%s', (_id, c) => {
    const got = parseCoordinate(c.input)
    if (c.expected === null) {
      expect(got).toBeNull()
    } else {
      expect(got).not.toBeNull()
      expect(Math.abs(got - c.expected)).toBeLessThan(1e-12)
    }
  })

  // Not in the shared contract: these values cannot travel through JSON.
  it('treats NaN and undefined as empty', () => {
    expect(parseCoordinate(NaN)).toBeNull()
    expect(parseCoordinate(undefined)).toBeNull()
  })
})

describe('inRange', () => {
  it.each(cases('in_range'))('%s', (_id, c) => {
    expect(inRange(c.value, c.axis)).toBe(c.expected)
  })
})

describe('formatDms', () => {
  it.each(cases('format_dms'))('%s', (_id, c) => {
    expect(formatDms(c.value, c.axis)).toBe(c.expected)
  })

  it('round-trips through parseCoordinate', () => {
    const text = formatDms(-9.136667, 'lon')
    expect(Math.abs(parseCoordinate(text) - -9.136667)).toBeLessThan(1e-4)
  })
})

describe('pointInMask', () => {
  it.each(cases('point_in_mask'))('%s', (_id, c) => {
    expect(pointInMask(c.lat, c.lon, c.mask)).toBe(c.expected)
  })
})

describe('identifyRegion', () => {
  it.each(cases('identify_region'))('%s', (_id, c) => {
    expect(identifyRegion(c.lat, c.lon, c.regions)).toBe(c.expected)
  })
})
