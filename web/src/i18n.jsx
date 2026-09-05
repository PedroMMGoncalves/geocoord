import { createContext, useContext } from 'react'
import appDict from './i18n/dict.app.js'
import fileDict from './i18n/dict.file.js'
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
  if (!entry) return key

  // Singular forms. An entry may carry a `ptOne`/`enOne` beside its plural,
  // used when the count is exactly one, because "1 linhas" is the kind of
  // thing that makes a tool look unfinished. The count is whichever of the
  // interpolated variables is named `n`; entries without a singular form, and
  // calls without an `n`, are unaffected.
  const singular = vars !== undefined && vars !== null && Number(vars.n) === 1
  let s
  if (singular && typeof entry[`${lang}One`] === 'string') s = entry[`${lang}One`]
  else if (singular && typeof entry.ptOne === 'string' && entry[lang] === undefined) s = entry.ptOne
  else s = entry[lang] ?? entry.pt

  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
  }
  return s
}

export function useT() {
  const lang = useContext(LangContext)
  return (key, vars) => translate(DICT, lang, key, vars)
}

const DICT = { ...appDict, ...fileDict, ...quickDict }

export default DICT
