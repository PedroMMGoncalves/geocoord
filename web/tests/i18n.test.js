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
