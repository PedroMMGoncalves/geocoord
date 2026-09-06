import { useEffect, useState } from 'react'
import FileConvert from './components/FileConvert.jsx'
import QuickConvert from './components/QuickConvert.jsx'
import { LANGS, LangContext, useT } from './i18n.jsx'

const STORAGE_KEY = 'geocoord:lang'

const TABS = [
  { id: 'file', key: 'file.tabFile' },
  { id: 'quick', key: 'file.tabQuick' },
]

/** Coordinate-crosshair mark, echoing the favicon in index.html. */
function Mark() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      className="mark"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="7.25" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <path d="M12 1.5v5M12 17.5v5M1.5 12h5M17.5 12h5" />
    </svg>
  )
}

export default function App() {
  // The language persists across visits; a blocked or unavailable store
  // (private browsing) just means it resets to pt on the next load.
  const [lang, setLang] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) ?? 'pt'
    } catch {
      return 'pt'
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, lang)
    } catch {
      /* ignore */
    }
  }, [lang])

  return (
    <LangContext.Provider value={lang}>
      <AppInner lang={lang} setLang={setLang} />
    </LangContext.Provider>
  )
}

function AppInner({ lang, setLang }) {
  const t = useT()
  // A link carrying ?lat=&lon= is meant for the single-coordinate converter,
  // which reads them; anything else opens on the file flow, which is what
  // nearly every visit is for.
  const [tab, setTab] = useState(() => {
    const q = new URLSearchParams(window.location.search)
    return q.has('lat') || q.has('lon') ? 'quick' : 'file'
  })

  return (
    <div className="flex min-h-full flex-col">
      {/* Twenty-four things are focusable before the content starts. Without
          this, reaching the file input by keyboard means passing all of them
          on every visit. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50
                   focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-sm
                   focus:font-medium focus:text-accent-ink"
      >
        {t('app.skipToContent')}
      </a>

      {/* One row: the brand, the two sections, and the two things worth
          knowing at a glance. It used to be four rows - a header, a subtitle,
          a tab bar, then each tab's own heading and intro - before anything
          could be done. */}
      <header className="top">
        <div className="brand">
          <Mark />
          <span className="name">GeoCoord</span>
          <span className="ver">v{import.meta.env.APP_VERSION}</span>
        </div>

        <nav className="tabs" aria-label={t('app.sections')}>
          {TABS.map(({ id, key }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={tab === id ? 'page' : undefined}
              className={`tab ${tab === id ? 'is-active' : ''}`}
            >
              {t(key)}
            </button>
          ))}
        </nav>

        <div className="util">
          {/* The one promise this page makes, said once, where it is seen on
              either tab as the page opens. */}
          <span className="badge">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <rect x="3" y="7" width="10" height="7" rx="1.5" />
              <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
            </svg>
            {t('app.privacy')}
          </span>
          <label className="lang">
            <span>{t('app.langLabel')}</span>
            <select
              id="lang-select"
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              className="sel"
            >
              {LANGS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.flag} {l.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="flex-1">
        {tab === 'file' ? <FileConvert /> : <QuickConvert />}
      </main>
    </div>
  )
}
