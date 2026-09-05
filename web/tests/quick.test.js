import { describe, it, expect } from 'vitest'
import { readField } from '../src/components/QuickConvert.jsx'

describe('readField', () => {
  it('treats an empty field as not filled in, not as an error', () => {
    expect(readField('', 'lat')).toEqual({ empty: true })
    expect(readField('   ', 'lat')).toEqual({ empty: true })
  })

  it('reports text it cannot read', () => {
    expect(readField('nao e uma coordenada', 'lat')).toEqual({ unreadable: true })
  })

  it('reads every accepted format', () => {
    expect(readField('38.708333', 'lat').value).toBeCloseTo(38.708333, 6)
    expect(readField('38,5', 'lat').value).toBeCloseTo(38.5, 6)
    expect(readField("38° 42' 30\" N", 'lat').value).toBeCloseTo(38.708333, 5)
    expect(readField("9° 8.2' O", 'lon').value).toBeCloseTo(-9.136667, 5)
  })

  it('flags a value outside its axis but still reports the number', () => {
    const lat = readField('95', 'lat')
    expect(lat.value).toBe(95)
    expect(lat.outOfRange).toBe(true)
    // The same number is perfectly valid as a longitude.
    expect(readField('95', 'lon').outOfRange).toBe(false)
  })
})
