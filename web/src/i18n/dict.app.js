/**
 * Dictionary for the app shell: the header, the language selector, and the
 * line shown while there is no converter yet. Split out from i18n.jsx so
 * later areas (file import, results table, map) can each grow their own
 * dict.<area>.js instead of this one file becoming unwieldy.
 */
export default {
  'app.subtitle': {
    pt: 'Conversor de coordenadas GMS para graus decimais',
    en: 'DMS to decimal degrees coordinate converter',
  },
  'app.langLabel': {
    pt: 'Idioma',
    en: 'Language',
  },
  'app.comingSoon': {
    pt: 'O conversor chega em breve.',
    en: 'The converter is coming soon.',
  },
}
