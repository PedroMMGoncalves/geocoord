import { describe, it, expect } from 'vitest'
import { fixtures, cases } from './fixtures.js'
import { parseCoordinate } from '../src/core/converter.js'

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
