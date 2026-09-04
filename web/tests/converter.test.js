import { describe, it, expect } from 'vitest'
import { fixtures, cases } from './fixtures.js'

describe('parity fixtures', () => {
  it('loads the shared contract', () => {
    expect(fixtures.parse_coordinate.length).toBe(31)
    expect(cases('parse_coordinate')[0][0]).toBe('decimal_positive')
  })
})
