/**
 * Dictionary for the app shell: the header, the language selector, and the
 * language selector. Split out from i18n.jsx so
 * later areas (file import, results table, map) can each grow their own
 * dict.<area>.js instead of this one file becoming unwieldy.
 */
export default {
  // The one promise the page makes, worn as a badge in the header. Two lines:
  // what happens, then what does not.
  //
  // It said "Nada é enviado para lado nenhum", which was the least accurate
  // sentence on the page - the map fetches tiles, and that request carries the
  // area being looked at. The true claim, and the one worth making, is about
  // the *data*: it is processed here and goes nowhere. That stays true with
  // the map open, because a tile request carries no data of the user's.
  //
  // "no seu computador" rather than "neste computador": on a web page "this"
  // can point at the machine or at the site, and only one of those is meant.
  'app.privacy': {
    pt: 'Dados processados localmente, no seu computador.',
    en: 'Data processed locally, on your own computer.',
  },
  'app.privacyMore': {
    pt: 'Não são enviados para servidores externos.',
    en: 'Never sent to an external server.',
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
