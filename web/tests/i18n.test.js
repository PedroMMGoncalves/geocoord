import { describe, it, expect } from 'vitest'
import { translate } from '../src/i18n.jsx'

// A small fixture dict, independent of the real app dictionary, so this
// test does not need to change when web/src/i18n/dict.app.js grows.
const DICT = {
  greeting: { pt: 'Olá', en: 'Hello' },
  ptOnly: { pt: 'Só em português' },
  withVar: { pt: '{n} de {n}', en: '{n} of {n}' },
}

describe('translate', () => {
  it('returns the matching language for a key present in both', () => {
    expect(translate(DICT, 'pt', 'greeting')).toBe('Olá')
    expect(translate(DICT, 'en', 'greeting')).toBe('Hello')
  })

  it('falls back to pt when the key is missing in en', () => {
    expect(translate(DICT, 'en', 'ptOnly')).toBe('Só em português')
  })

  it('falls back to the key itself when missing entirely', () => {
    expect(translate(DICT, 'en', 'nonexistent.key')).toBe('nonexistent.key')
    expect(translate(DICT, 'pt', 'nonexistent.key')).toBe('nonexistent.key')
  })

  it('interpolates every occurrence of a {var} placeholder', () => {
    expect(translate(DICT, 'pt', 'withVar', { n: 3 })).toBe('3 de 3')
    expect(translate(DICT, 'en', 'withVar', { n: 3 })).toBe('3 of 3')
  })
})

describe('translate: singular forms', () => {
  const dict = {
    rows: {
      pt: '{n} linhas', ptOne: '{n} linha',
      en: '{n} rows', enOne: '{n} row',
    },
    plain: { pt: '{n} coisas', en: '{n} things' },
  }

  it('uses the singular when the count is exactly one', () => {
    expect(translate(dict, 'pt', 'rows', { n: 1 })).toBe('1 linha')
    expect(translate(dict, 'en', 'rows', { n: 1 })).toBe('1 row')
  })

  it('uses the plural for every other count, zero included', () => {
    expect(translate(dict, 'pt', 'rows', { n: 0 })).toBe('0 linhas')
    expect(translate(dict, 'pt', 'rows', { n: 2 })).toBe('2 linhas')
    expect(translate(dict, 'en', 'rows', { n: 11 })).toBe('11 rows')
  })

  it('leaves an entry without a singular form alone', () => {
    expect(translate(dict, 'pt', 'plain', { n: 1 })).toBe('1 coisas')
  })

  it('is unaffected by a call that carries no count', () => {
    expect(translate(dict, 'pt', 'rows', { x: 1 })).toBe('{n} linhas')
    expect(translate(dict, 'pt', 'rows')).toBe('{n} linhas')
  })
})
