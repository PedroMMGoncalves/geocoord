import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { WorkbookProtected, aesEcbDecrypt, sha1 } from '../src/core/officecrypt.js'
import { readWorkbook, workbookSheets } from '../src/core/reader.js'

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
const unhex = (text) => Uint8Array.from(text.match(/../g), (pair) => Number.parseInt(pair, 16))
const fixture = (name) => new Uint8Array(readFileSync(new URL(`../../tests/fixtures/${name}`, import.meta.url)))

describe('the cipher', () => {
  // SHA-1 and AES are written out in officecrypt.js; these are the vectors
  // their standards publish (FIPS 180-4, FIPS 197 appendix C).
  it('hashes the published SHA-1 vectors', () => {
    const text = (s) => new TextEncoder().encode(s)
    expect(hex(sha1(text('abc')))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
    expect(hex(sha1(text('')))).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709')
    expect(hex(sha1(text('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))))
      .toBe('84983e441c3bd26ebaae4aa1f95129e5e54670f1')
  })

  it.each([
    ['AES-128', '000102030405060708090a0b0c0d0e0f', '69c4e0d86a7b0430d8cdb78070b4c55a'],
    ['AES-192', '000102030405060708090a0b0c0d0e0f1011121314151617', 'dda97ca4864cdfe06eaf70a0ec0d7191'],
    ['AES-256', '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
      '8ea2b7ca516745bfeafc49904b496089'],
  ])('decrypts the published %s vector', (_name, key, cipher) => {
    expect(hex(aesEcbDecrypt(unhex(key), unhex(cipher)))).toBe('00112233445566778899aabbccddeeff')
  })
})

describe('what a workbook is, whatever it is called', () => {
  // The same three synthetic workbooks pytest reads (tests/test_reader.py),
  // written by scripts/make_workbook_fixtures.mjs.
  const POINTS = [['A-1', '38.7', '-9.1'], ['A-2', '38.8', '-9.2'], ['A-3', '38.6', '-9']]

  it('reads a workbook Office encrypted with its default password', async () => {
    // To Excel an ordinary workbook; to SheetJS, "File is password-protected".
    const bytes = fixture('workbook_default_password.xlsx')
    expect(await workbookSheets(bytes)).toEqual(['pontos'])
    const table = await readWorkbook(bytes)
    expect(table.columns).toEqual(['Ponto', 'Latitude', 'Longitude'])
    expect(table.rows).toEqual(POINTS)
  })

  it('leaves a workbook with its owner\'s password closed, and says so', async () => {
    const bytes = fixture('workbook_own_password.xlsx')
    await expect(readWorkbook(bytes)).rejects.toBeInstanceOf(WorkbookProtected)
    await expect(workbookSheets(bytes)).rejects.toMatchObject({ code: 'protected' })
  })

  it('reads a legacy workbook called .xlsx as what it is', async () => {
    expect((await readWorkbook(fixture('workbook_legacy_named.xlsx'))).rows).toEqual(POINTS)
  })
})
