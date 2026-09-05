import { describe, it, expect } from 'vitest'
import { cases } from './fixtures.js'
import { tidyTable } from '../src/core/converter.js'
import { headerNames, readCsvBytes, readCsvText, sniffSeparator } from '../src/core/reader.js'

describe('readCsvText', () => {
  // The contract's expected value is the table after tidyTable, which is the
  // observable that matters downstream and the one both languages can express.
  it.each(cases('read_csv'))('%s', (_id, c) => {
    const table = readCsvText(c.text, { sep: c.sep, decimal: c.decimal })
    expect(tidyTable(table)).toEqual(c.expected)
  })
})

describe('headerNames', () => {
  // Not cosmetic: tidyTable decides whether to promote the first row by testing
  // for exactly these names.
  it('names an empty cell after its position', () => {
    expect(headerNames(['a', '', 'c'])).toEqual(['a', 'Unnamed: 1', 'c'])
    expect(headerNames(['', '', ''])).toEqual(['Unnamed: 0', 'Unnamed: 1', 'Unnamed: 2'])
  })

  it('disambiguates a repeat with a numeric suffix', () => {
    expect(headerNames(['a', 'a', 'b', 'a'])).toEqual(['a', 'a.1', 'b', 'a.2'])
  })

  it('leaves whitespace inside a name alone', () => {
    expect(headerNames([' a ', 'b'])).toEqual([' a ', 'b'])
  })
})

describe('sniffSeparator', () => {
  it.each([
    ['comma', 'a,b\n1,2\n', ','],
    ['semicolon', 'a;b\n1;2\n', ';'],
    ['tab', 'a\tb\n1\t2\n', '\t'],
    ['pipe', 'a|b\n1|2\n', '|'],
  ])('detects a %s', (_name, text, expected) => {
    expect(sniffSeparator(text)).toBe(expected)
  })

  it('falls back to a comma when there is nothing to detect', () => {
    // One column has no delimiter. Guessing one out of the header is how the
    // Python side used to cut "lat" down to "la".
    expect(sniffSeparator('lat\n39.0\n38.9\n')).toBe(',')
  })
})

describe('readCsvBytes', () => {
  // Not in the shared contract: its inputs travel as JSON strings, already
  // decoded, so there is nothing left for an encoding fallback to recover from.
  const encode = (s, encoding) => {
    if (encoding === 'utf-8') return new TextEncoder().encode(s)
    // windows-1252 for the characters used here: one byte per code point.
    return Uint8Array.from([...s].map((ch) => ch.charCodeAt(0)))
  }

  it('prefers utf-8', () => {
    const bytes = encode('nome,lat\nSão Tomé,0.18\n', 'utf-8')
    expect(readCsvBytes(bytes, { sep: ',' }).rows[0][0]).toBe('São Tomé')
  })

  it('falls back when the bytes are not valid utf-8', () => {
    const bytes = encode('nome,lat\nSão Tomé,0.18\n', 'latin1')
    expect(readCsvBytes(bytes, { sep: ',' }).rows[0][0]).toBe('São Tomé')
  })
})
