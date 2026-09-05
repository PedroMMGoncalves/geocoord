import { describe, it, expect } from 'vitest'
import { fixtures, cases } from './fixtures.js'
import {
  axisMismatch,
  detectSwaps,
  formatDms,
  hemisphereAxis,
  identifyRegion,
  inRange,
  median,
  parseCoordinate,
  parseProjected,
  percentileLinear,
  pointInMask,
  regionCheck,
  tidyTable,
} from '../src/core/converter.js'

describe('parity fixtures', () => {
  // A tripwire against a truncated, empty or half-written contract, not a
  // census. Pinning an exact case count would make every deliberate addition
  // to the contract fail here first, which trains people to bump the number
  // without reading the diff.
  const SECTIONS = [
    'parse_coordinate', 'in_range', 'format_dms', 'point_in_mask',
    'identify_region', 'detect_swaps', 'region_check', 'tidy_table',
  ]

  it.each(SECTIONS)('has a populated %s section', (section) => {
    expect(Array.isArray(fixtures[section])).toBe(true)
    expect(fixtures[section].length).toBeGreaterThan(0)
  })

  it('exposes each case by id', () => {
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

describe('parseProjected', () => {
  // Metres, not degrees. Which separator is the decimal one is decided by
  // position rather than by locale, so both 532.725,16 and 532,725.16 are
  // 532725.16 - what a person reading either would say.
  it.each(cases('parse_projected'))('%s', (_id, c) => {
    expect(parseProjected(c.input)).toBe(c.expected)
  })
})

describe('hemisphereAxis', () => {
  // N/S can only be a latitude and E/W/O/L only a longitude, so the letter
  // names the column a value belongs in - the one piece of evidence about a
  // swapped pair of columns that costs nothing to read.
  it.each(cases('hemisphere_axis'))('%s', (_id, c) => {
    expect(hemisphereAxis(c.input)).toBe(c.expected)
  })
})

describe('axisMismatch', () => {
  it('flags a row whose letters contradict the columns they sit in', () => {
    expect(axisMismatch(["9\u00b0 8' 12\" W"], ["38\u00b0 42' 30\" N"])).toEqual([true])
    expect(axisMismatch(["38\u00b0 42' 30\" N"], ["9\u00b0 8' 12\" W"])).toEqual([false])
  })

  it('says nothing about a row with no letters at all', () => {
    expect(axisMismatch(['38.5'], ['-9.0'])).toEqual([false])
  })

  it('is not fooled by a word in a name column', () => {
    expect(axisMismatch(['Norte'], ['Oeste'])).toEqual([false])
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

describe('regionCheck', () => {
  it.each(cases('region_check'))('%s', (_id, c) => {
    const { outIdx, detected } = regionCheck(
      c.lats, c.lons, c.labels, c.regions, c.kwargs,
    )
    expect(outIdx).toEqual(c.expected.out_idx)
    expect([...detected.entries()]).toEqual(c.expected.detected)
  })
})

describe('tidyTable', () => {
  it.each(cases('tidy_table'))('%s', (_id, c) => {
    expect(tidyTable(c.table)).toEqual(c.expected)
  })

  it('does not mutate its input', () => {
    const table = { columns: ['lat', 'lon'], rows: [['39.0', '-8.0']] }
    const before = JSON.stringify(table)
    tidyTable(table)
    expect(JSON.stringify(table)).toBe(before)
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
