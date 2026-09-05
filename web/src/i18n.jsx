import { createContext, useContext } from 'react'
import appDict from './i18n/dict.app.js'
import quickDict from './i18n/dict.quick.js'

/**
 * PT/EN internationalisation.
 *
 * Usage: wrap the app in <LangContext.Provider value={lang}> and, in
 * components, `const t = useT()` followed by `t('key')` or
 * `t('key', { n: 3 })` to interpolate `{n}`. A missing key falls back to
 * pt and, failing that, to the key itself (visible, so it gets noticed
 * and fixed).
 */

export const LANGS = [
  { code: 'pt', flag: '🇵🇹', label: 'Português' },
  { code: 'en', flag: '🇬🇧', label: 'English' },
]

export const LangContext = createContext('pt')

export function useLang() {
  return useContext(LangContext)
}

/**
 * Plain lookup + interpolation, factored out of useT so it is testable
 * without pulling in a React testing library: a dictionary, a language and
 * a key in, a string out, no hooks or component tree involved.
 */
export function translate(dict, lang, key, vars) {
  const entry = dict[key]
  let s = entry ? (entry[lang] ?? entry.pt) : key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
  }
  return s
}

export function useT() {
  const lang = useContext(LangContext)
  return (key, vars) => translate(DICT, lang, key, vars)
}

const DICT = { ...appDict, ...quickDict }

export default DICT
