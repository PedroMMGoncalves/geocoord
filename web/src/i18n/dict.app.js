/**
 * Dictionary for the app shell: the header, the language selector, and the
 * language selector. Split out from i18n.jsx so
 * later areas (file import, results table, map) can each grow their own
 * dict.<area>.js instead of this one file becoming unwieldy.
 */
export default {
  // The one promise the page makes, worn as a badge in the header. It used
  // to be said in each tab's own intro, in two different registers.
  'app.privacy': {
    pt: 'Nada é enviado para lado nenhum.',
    en: 'Nothing is sent anywhere.',
  },
  'app.skipToContent': {
    pt: 'Saltar para o conteúdo',
    en: 'Skip to content',
  },
  'app.sections': {
    pt: 'Secções',
    en: 'Sections',
  },
  'app.langLabel': {
    pt: 'Idioma',
    en: 'Language',
  },
}
