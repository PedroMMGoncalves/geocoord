import { useMemo, useState } from 'react'
import { formatDms, inRange, parseCoordinate } from '../core/converter.js'
import { useT } from '../i18n.jsx'

const EXAMPLES = [
  { lat: '38° 42\' 30" N', lon: '9° 8\' 12" W' },
  { lat: '41,162222', lon: '-8,610833' },
  { lat: '38° 42.5\'', lon: '9° 8.2\' O' },
]

/**
 * Read one field into everything the display needs.
 *
 * `axis` is 'lat' or 'lon'. An empty field is not an error - it is simply not
 * filled in yet - so `empty` is kept apart from `unreadable`.
 */
export function readField(text, axis) {
  const trimmed = text.trim()
  if (trimmed === '') return { empty: true }
  const value = parseCoordinate(trimmed)
  if (value === null) return { unreadable: true }
  return { value, outOfRange: !inRange(value, axis) }
}

function CopyButton({ text, what }) {
  const t = useT()
  const [done, setDone] = useState(false)

  return (
    <button
      type="button"
      // Four of these sit in the results, all reading "Copiar". A screen
      // reader's button list said "Copiar" four times with nothing to say
      // which one copies the latitude and which the WKT, and pasting the
      // wrong one into a GIS is a silent error.
      aria-label={what ? t('quick.copyOf', { what }) : undefined}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        } catch {
          /* clipboard blocked: the value is on screen to select by hand */
        }
      }}
      className="rounded border border-edge px-2 py-1 text-xs text-slate-400
                 transition-colors hover:border-accent hover:text-accent
                 focus-visible:outline focus-visible:outline-2
                 focus-visible:outline-accent"
    >
      {done ? t('quick.copied') : t('quick.copy')}
    </button>
  )
}

function Field({ id, label, value, onChange, placeholder, state, rangeMessage }) {
  const t = useT()
  const bad = state.unreadable || state.outOfRange
  return (
    <div className="flex-1">
      <label htmlFor={id} className="mb-1 block text-sm text-slate-300">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="text"
        autoComplete="off"
        spellCheck="false"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={bad || undefined}
        className={`w-full rounded border bg-panel px-3 py-2 font-mono text-slate-100
                    placeholder:text-slate-600 focus:outline-none focus:ring-2
                    ${bad ? 'border-amber-500 focus:ring-amber-500/40'
                          : 'border-edge focus:border-accent focus:ring-accent/30'}`}
      />
      <p className="mt-1 min-h-[1.25rem] text-xs text-amber-400">
        {state.unreadable ? t('quick.unreadable') : state.outOfRange ? rangeMessage : ''}
      </p>
    </div>
  )
}

/** One labelled output row with its own copy button. */
function Output({ label, value, mono = true }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-edge py-2.5">
      <span className="shrink-0 text-sm text-slate-400">{label}</span>
      <span className={`min-w-0 flex-1 truncate text-right text-slate-100 ${mono ? 'font-mono' : ''}`}>
        {value}
      </span>
      <CopyButton text={value} what={label} />
    </div>
  )
}

/**
 * Initial field values, taken from the query string when it carries them.
 *
 * This is what makes a conversion shareable: send someone
 * ?lat=38%C2%B042'30%22N&lon=9%C2%B08'12%22W and they land on the answer. It
 * also gives the page a state that can be reached without typing, which is how
 * it gets checked in a browser.
 */
function initialFields() {
  try {
    const params = new URLSearchParams(window.location.search)
    return { lat: params.get('lat') ?? '', lon: params.get('lon') ?? '' }
  } catch {
    return { lat: '', lon: '' }
  }
}

export default function QuickConvert() {
  const t = useT()
  const initial = useMemo(initialFields, [])
  const [lat, setLat] = useState(initial.lat)
  const [lon, setLon] = useState(initial.lon)
  const [decimals, setDecimals] = useState(6)

  const latState = useMemo(() => readField(lat, 'lat'), [lat])
  const lonState = useMemo(() => readField(lon, 'lon'), [lon])

  // Both readable and both in range: only then is there something to show.
  const ready = latState.value !== undefined && lonState.value !== undefined
    && !latState.outOfRange && !lonState.outOfRange

  const latDd = ready ? latState.value.toFixed(decimals) : null
  const lonDd = ready ? lonState.value.toFixed(decimals) : null

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <h1 className="text-xl font-semibold text-slate-100">{t('quick.title')}</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">{t('quick.intro')}</p>

      <div className="mt-6 flex flex-col gap-4 sm:flex-row">
        <Field
          id="lat"
          label={t('quick.latitude')}
          value={lat}
          onChange={setLat}
          placeholder={'38° 42\' 30" N'}
          state={latState}
          rangeMessage={t('quick.outOfRangeLat')}
        />
        <Field
          id="lon"
          label={t('quick.longitude')}
          value={lon}
          onChange={setLon}
          placeholder={'9° 8\' 12" W'}
          state={lonState}
          rangeMessage={t('quick.outOfRangeLon')}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">{t('quick.hemisphereHint')}</p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">{t('quick.examples')}:</span>
          {EXAMPLES.map((ex, i) => (
            <button
              key={ex.lat}
              type="button"
              onClick={() => { setLat(ex.lat); setLon(ex.lon) }}
              aria-label={t('quick.exampleN', { n: i + 1, lat: ex.lat, lon: ex.lon })}
              className="rounded border border-edge px-2 py-1 text-xs text-slate-400
                         transition-colors hover:border-accent hover:text-accent"
            >
              {i + 1}
            </button>
          ))}
        </div>
      </div>

      {ready && (
        <div className="mt-6 rounded-lg border border-edge bg-surface px-4 pb-2 pt-3">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-sm font-medium text-accent">{t('quick.result')}</h2>
            <label className="flex items-center gap-2 text-xs text-slate-500">
              {t('quick.decimals')}
              <input
                type="range"
                min="2"
                max="10"
                value={decimals}
                onChange={(e) => setDecimals(Number(e.target.value))}
                className="h-1 w-24 accent-accent"
              />
              <span className="w-4 font-mono text-slate-400">{decimals}</span>
            </label>
          </div>

          <Output label={t('quick.latitude')} value={latDd} />
          <Output label={t('quick.longitude')} value={lonDd} />
          <Output label={t('quick.wkt')} value={`POINT (${lonDd} ${latDd})`} />
          <Output
            label={t('quick.dms')}
            value={`${formatDms(latState.value, 'lat')}, ${formatDms(lonState.value, 'lon')}`}
          />
        </div>
      )}

      <p className="mt-8 text-xs text-slate-600">{t('quick.privacy')}</p>
    </section>
  )
}
