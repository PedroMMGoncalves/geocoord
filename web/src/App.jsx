import { useEffect, useState } from 'react'
import QuickConvert from './components/QuickConvert.jsx'
import { LANGS, LangContext, useT } from './i18n.jsx'

const STORAGE_KEY = 'geocoord:lang'

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

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-edge bg-surface px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Mark />
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-semibold text-slate-100">GeoCoord</span>
                <span className="text-xs text-slate-500">v{import.meta.env.APP_VERSION}</span>
              </div>
              <p className="text-sm text-slate-400">{t('app.subtitle')}</p>
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

      <main className="flex-1">
        <QuickConvert />
      </main>
    </div>
  )
}
