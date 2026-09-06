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
      strokeWidth="1.8"
      strokeLinecap="round"
      className="h-6 w-6 shrink-0 text-accent"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <path d="M12 1v4M12 19v4M1 12h4M19 12h4" />
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
                   focus:font-medium focus:text-panel"
      >
        {t('app.skipToContent')}
      </a>
      <header className="border-b border-edge bg-surface px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Mark />
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-semibold text-slate-100">GeoCoord</span>
                <span className="text-xs text-slate-400">v{import.meta.env.APP_VERSION}</span>
              </div>
              <p className="text-sm text-slate-400">{t('app.subtitle')}</p>
              {/* Stated once, here, as a property of the tool. It used to be
                  said only in the map's opt-in box, which meant the one real
                  guarantee this page offers was worded as an apology for a
                  button and seen only by whoever scrolled to step three. */}
              <p className="text-xs text-slate-500">{t('app.privacy')}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="lang-select" className="text-xs text-slate-400">
              {t('app.langLabel')}
            </label>
            <select
              id="lang-select"
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              className="rounded border border-edge bg-panel px-2 py-1 text-sm text-slate-200"
            >
              {LANGS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.flag} {l.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <nav className="border-b border-edge bg-surface px-4 sm:px-6" aria-label={t('app.sections')}>
        <div className="flex gap-1">
          {TABS.map(({ id, key }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={tab === id ? 'page' : undefined}
              className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors
                          focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent
                          ${tab === id
                            ? 'border-accent text-accent'
                            : 'border-transparent text-slate-400 hover:text-slate-200'}`}
            >
              {t(key)}
            </button>
          ))}
        </div>
      </nav>

      <main id="main" tabIndex={-1} className="flex-1">
        {tab === 'file' ? <FileConvert /> : <QuickConvert />}
      </main>
    </div>
  )
}
