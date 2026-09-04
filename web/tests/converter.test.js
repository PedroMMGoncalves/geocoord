import { describe, it, expect } from 'vitest'
import { fixtures, cases } from './fixtures.js'
import { parseCoordinate, inRange, formatDms, pointInMask, identifyRegion, detectSwaps, percentileLinear, median } from '../src/core/converter.js'

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

describe('detectSwaps', () => {
  it.each(cases('detect_swaps'))('%s', (_id, c) => {
    const { labels, center } = detectSwaps(c.lats, c.lons, c.kwargs)
    expect(labels).toEqual(c.expected.labels)
    if (c.expected.center === null) {
      expect(center).toBeNull()
    } else {
      expect(center[0]).toBeCloseTo(c.expected.center[0], 12)
      expect(center[1]).toBeCloseTo(c.expected.center[1], 12)
    }
  })
})

describe('numpy-compatible statistics', () => {
  it('interpolates percentiles the way numpy does', () => {
    expect(percentileLinear([1, 2, 3, 4], 90)).toBeCloseTo(3.7, 12)
    expect(percentileLinear([5], 90)).toBe(5)
  })

  it('averages the two middle values for an even count', () => {
    expect(median([1, 3])).toBeCloseTo(2, 12)
    expect(median([2, 4])).toBeCloseTo(3, 12)
    expect(median([1, 2, 3])).toBe(2)
  })
})
