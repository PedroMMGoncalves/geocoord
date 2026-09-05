import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { detectSwaps, regionCheck, tidyTable } from '../core/converter.js'
import { sanitizeFilename, toGeoJSON, toKML, toShapefileZip } from '../core/geoexport.js'
import {
  LAT_CANDIDATES,
  LON_CANDIDATES,
  REGION_MASKS,
  applySwaps,
  buildResult,
  countByStatus,
  featuresInRange,
  guessColumn,
  pointsSummary,
  toCsv,
  toGpx,
} from '../core/pipeline.js'
import { SEPARATORS, readCsvBytes, readCsvText, readWorkbook, workbookSheets } from '../core/reader.js'
import { useT } from '../i18n.jsx'

const SPREADSHEET = /\.(xlsx|xlsm|xlsb|xls|ods)$/i
const PREVIEW_ROWS = 50

const SEPARATOR_LABELS = [
  { value: 'auto', key: 'file.sepAuto' },
  { value: ',', key: 'file.sepComma' },
  { value: ';', key: 'file.sepSemicolon' },
  { value: '\t', key: 'file.sepTab' },
  { value: '|', key: 'file.sepPipe' },
]

// The statuses detectSwaps can return, and the colour each gets. Amber for the
// two swap kinds because they are a question for the user, not a verdict;
// red only for what could not be used at all.
const STATUS_STYLE = {
  ok: 'text-accent',
  swap_range: 'text-amber-400',
  swap_cluster: 'text-amber-400',
  out_of_range: 'text-red-400',
  missing: 'text-red-400',
}

/** Hand `bytes` to the browser as a file the user can save. */
function download(bytes, filename, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoking immediately can cancel the download in some browsers; a turn of
  // the event loop is enough for it to have started.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function Step({ n, title, children }) {
  return (
    <section className="mt-6 rounded-lg border border-edge bg-surface p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-200">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full
                         bg-accent/15 text-xs font-semibold text-accent">
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  )
}

function Select({ id, label, value, onChange, children }) {
  return (
    <div className="min-w-0 flex-1">
      <label htmlFor={id} className="mb-1 block text-xs text-slate-400">{label}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-edge bg-panel px-2 py-1.5 text-sm text-slate-100
                   focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        {children}
      </select>
    </div>
  )
}

function DownloadButton({ label, hint, onClick, disabled }) {
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={async () => {
        setBusy(true)
        try {
          await onClick()
        } finally {
          setBusy(false)
        }
      }}
      className="flex flex-col items-start rounded border border-accent/50 px-3 py-2 text-left
                 transition-colors hover:bg-accent hover:text-panel
                 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent
                 disabled:cursor-not-allowed disabled:border-edge disabled:text-slate-600
                 disabled:hover:bg-transparent"
    >
      <span className="text-sm font-medium">{label}</span>
      <span className="text-xs opacity-70">{hint}</span>
    </button>
  )
}

export default function FileConvert() {
  const t = useT()

  const [source, setSource] = useState(null) // { name, table } after reading
  const [bytes, setBytes] = useState(null) // kept so a sheet or separator change can re-read
  const [sheets, setSheets] = useState([])
  const [sheet, setSheet] = useState('')
  const [sep, setSep] = useState('auto')
  const [error, setError] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [pasting, setPasting] = useState(false)
  const [pasted, setPasted] = useState('')

  const [latCol, setLatCol] = useState('')
  const [lonCol, setLonCol] = useState('')
  const [region, setRegion] = useState('Portugal mainland')
  const [decimals, setDecimals] = useState(6)
  const [addDms, setAddDms] = useState(true)
  const [accepted, setAccepted] = useState(() => new Set())

  const inputRef = useRef(null)
  // The file's name, outside React state: the re-read effect needs it without
  // taking a dependency on the source it is about to replace.
  const nameRef = useRef('')

  /** Read a table out of whatever is currently loaded, honouring the options.
   *  Asynchronous because SheetJS is fetched only when a workbook turns up. */
  const reread = useCallback(async (data, name, sheetName, separator) => {
    if (SPREADSHEET.test(name)) {
      const names = await workbookSheets(data)
      setSheets(names)
      const chosen = names.includes(sheetName) ? sheetName : names[0]
      setSheet(chosen ?? '')
      return tidyTable(await readWorkbook(data, chosen))
    }
    setSheets([])
    setSheet('')
    return tidyTable(readCsvBytes(data, { sep: separator === 'auto' ? null : separator }))
  }, [])

  const loadFile = useCallback(async (file) => {
    setError(null)
    try {
      const data = new Uint8Array(await file.arrayBuffer())
      const table = await reread(data, file.name, '', sep)
      if (table.columns.length === 0) {
        setError(t('file.errEmpty'))
        return
      }
      nameRef.current = file.name
      setBytes(data)
      setSource({ name: file.name, table })
      setAccepted(new Set())
    } catch (e) {
      setError(t('file.errRead', { message: e?.message ?? String(e) }))
    }
  }, [reread, sep, t])

  const loadPasted = useCallback(() => {
    setError(null)
    try {
      const table = tidyTable(readCsvText(pasted, { sep: null }))
      if (table.columns.length === 0) {
        setError(t('file.errEmpty'))
        return
      }
      nameRef.current = 'colado.csv'
      setBytes(null)
      setSheets([])
      setSource({ name: 'colado.csv', table })
      setAccepted(new Set())
    } catch (e) {
      setError(t('file.errRead', { message: e?.message ?? String(e) }))
    }
  }, [pasted, t])

  // Re-read when the sheet or the separator changes, which only applies to a
  // file that came from disk. The read is asynchronous, so a change made while
  // an earlier read is still in flight must not have the stale result land on
  // top of it.
  useEffect(() => {
    if (!bytes) return undefined
    let cancelled = false
    ;(async () => {
      try {
        const table = await reread(bytes, nameRef.current, sheet, sep)
        if (cancelled) return
        setSource((s) => (s === null ? s : { ...s, table }))
        setAccepted(new Set())
      } catch (e) {
        if (!cancelled) setError(t('file.errRead', { message: e?.message ?? String(e) }))
      }
    })()
    return () => { cancelled = true }
    // `source` is deliberately absent: including it would re-run on its own
    // update. The sheet and the separator are what should trigger a re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bytes, sheet, sep, reread])

  // Guess the coordinate columns whenever a new set of columns arrives.
  const columns = source?.table.columns ?? []
  const columnKey = JSON.stringify(columns)
  useEffect(() => {
    if (columns.length === 0) return
    setLatCol(columns[guessColumn(columns, LAT_CANDIDATES, 0)])
    setLonCol(columns[guessColumn(columns, LON_CANDIDATES, columns.length > 1 ? 1 : 0)])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnKey])

  const converted = useMemo(() => {
    if (!source || !latCol || !lonCol) return null
    return buildResult(source.table, latCol, lonCol, { decimals, addDms })
  }, [source, latCol, lonCol, decimals, addDms])

  const detection = useMemo(() => {
    if (!converted) return null
    const mask = region === 'auto' ? null : REGION_MASKS[region]
    const { labels } = detectSwaps(converted.lats, converted.lons, { mask })
    const { detected } = regionCheck(converted.lats, converted.lons, labels, REGION_MASKS, { mask })
    return { labels, detected }
  }, [converted, region])

  // The rows the user has agreed to invert, applied.
  const final = useMemo(() => {
    if (!converted) return null
    return accepted.size === 0 ? converted : applySwaps(converted, accepted, { addDms })
  }, [converted, accepted, addDms])

  const suspects = useMemo(() => {
    if (!detection) return []
    return detection.labels
      .map((label, i) => ({ label, i }))
      .filter(({ label }) => label === 'swap_range' || label === 'swap_cluster')
  }, [detection])

  const counts = detection ? countByStatus(detection.labels) : new Map()
  const summary = final ? pointsSummary(final) : null
  const baseName = sanitizeFilename((source?.name ?? 'coordinates').replace(/\.[^.]+$/, ''), 'coordinates')

  const exportable = useMemo(() => {
    if (!final) return null
    const { features, fieldNames } = featuresInRange(final)
    return { features, fieldNames }
  }, [final])

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) loadFile(file)
  }

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <h1 className="text-xl font-semibold text-slate-100">{t('file.title')}</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">{t('file.intro')}</p>

      <Step n={1} title={t('file.step1')}>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors
                      ${dragging ? 'border-accent bg-accent/5' : 'border-edge'}`}
        >
          <p className="text-sm text-slate-300">{t('file.dropHere')}</p>
          <p className="mt-1 text-xs text-slate-500">{t('file.formats')}</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="rounded border border-accent/50 px-3 py-1.5 text-sm text-accent
                         transition-colors hover:bg-accent hover:text-panel
                         focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              {t('file.choose')}
            </button>
            <button
              type="button"
              onClick={() => setPasting((v) => !v)}
              className="rounded border border-edge px-3 py-1.5 text-sm text-slate-400
                         transition-colors hover:border-accent hover:text-accent
                         focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              {t('file.paste')}
            </button>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.txt,.tsv,.xlsx,.xlsm,.xlsb,.xls,.ods"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) loadFile(file)
              e.target.value = ''
            }}
          />
        </div>

        {pasting && (
          <div className="mt-3">
            <label htmlFor="paste-box" className="mb-1 block text-xs text-slate-400">
              {t('file.pasteLabel')}
            </label>
            <textarea
              id="paste-box"
              rows={5}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder={'Amostra\tLatitude\tLongitude\nA1\t38° 42\' 30" N\t9° 8\' 12" W'}
              className="w-full rounded border border-edge bg-panel px-3 py-2 font-mono text-xs
                         text-slate-100 focus-visible:outline focus-visible:outline-2
                         focus-visible:outline-accent"
            />
            <button
              type="button"
              disabled={pasted.trim() === ''}
              onClick={loadPasted}
              className="mt-2 rounded border border-accent/50 px-3 py-1.5 text-sm text-accent
                         transition-colors hover:bg-accent hover:text-panel
                         disabled:cursor-not-allowed disabled:border-edge disabled:text-slate-600
                         disabled:hover:bg-transparent"
            >
              {t('file.pasteRead')}
            </button>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        {source && (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <p className="text-sm text-slate-400">
              {t('file.loaded', { name: source.name, n: source.table.rows.length, cols: columns.length })}
            </p>
            {sheets.length > 1 && (
              <Select id="sheet" label={t('file.sheet')} value={sheet} onChange={setSheet}>
                {sheets.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            )}
            {sheets.length === 0 && bytes && (
              <Select id="sep" label={t('file.separator')} value={sep} onChange={setSep}>
                {SEPARATOR_LABELS.filter((s) => s.value === 'auto' || SEPARATORS.includes(s.value))
                  .map((s) => <option key={s.value} value={s.value}>{t(s.key)}</option>)}
              </Select>
            )}
          </div>
        )}
      </Step>

      {source && columns.length > 0 && (
        <Step n={2} title={t('file.step2')}>
          <div className="flex flex-wrap gap-3">
            <Select id="lat-col" label={t('file.latColumn')} value={latCol} onChange={setLatCol}>
              {columns.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Select id="lon-col" label={t('file.lonColumn')} value={lonCol} onChange={setLonCol}>
              {columns.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Select id="region" label={t('file.region')} value={region} onChange={setRegion}>
              <option value="auto">{t('file.regionAuto')}</option>
              {Object.keys(REGION_MASKS).map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-slate-400">
              {t('file.decimals')}
              <input
                type="range"
                min="2"
                max="8"
                value={decimals}
                onChange={(e) => setDecimals(Number(e.target.value))}
                className="h-1 w-24 accent-accent"
              />
              <span className="w-4 font-mono text-slate-300">{decimals}</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={addDms}
                onChange={(e) => setAddDms(e.target.checked)}
                className="accent-accent"
              />
              {t('file.addDms')}
            </label>
          </div>
        </Step>
      )}

      {final && detection && (
        <>
          <Step n={3} title={t('file.step3')}>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {['ok', 'swap_range', 'swap_cluster', 'out_of_range', 'missing'].map((s) => (
                counts.get(s) ? (
                  <span key={s} className={STATUS_STYLE[s]}>
                    <span className="font-mono font-semibold">{counts.get(s)}</span>
                    {' '}
                    {t(`file.status.${s}`)}
                  </span>
                ) : null
              ))}
            </div>

            {detection.detected.size > 0 && (
              <p className="mt-3 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
                {[...detection.detected].map(([name, n]) => (
                  name
                    ? t('file.outsideNamed', { n, region: name })
                    : t('file.outsideUnknown', { n })
                )).join(' ')}
              </p>
            )}

            {suspects.length > 0 && (
              <div className="mt-4 rounded border border-amber-500/40 bg-amber-500/5 p-3">
                <p className="text-sm text-amber-200">{t('file.swapsFound', { n: suspects.length })}</p>
                <p className="mt-1 text-xs text-slate-400">{t('file.swapsHint')}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setAccepted(new Set(suspects.map((s) => s.i)))}
                    className="rounded border border-accent/50 px-3 py-1 text-xs text-accent
                               transition-colors hover:bg-accent hover:text-panel"
                  >
                    {t('file.swapAll')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccepted(new Set())}
                    className="rounded border border-edge px-3 py-1 text-xs text-slate-400
                               transition-colors hover:border-accent hover:text-accent"
                  >
                    {t('file.swapNone')}
                  </button>
                  <span className="self-center text-xs text-slate-500">
                    {t('file.swapChosen', { n: accepted.size })}
                  </span>
                </div>
                <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto text-xs">
                  {suspects.slice(0, 200).map(({ i, label }) => (
                    <li key={i} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id={`swap-${i}`}
                        checked={accepted.has(i)}
                        onChange={(e) => setAccepted((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(i)
                          else next.delete(i)
                          return next
                        })}
                        className="accent-accent"
                      />
                      <label htmlFor={`swap-${i}`} className="font-mono text-slate-400">
                        {t('file.rowN', { n: i + 1 })}
                        {' · '}
                        {converted.lats[i]}, {converted.lons[i]}
                        {' → '}
                        <span className="text-accent">{converted.lons[i]}, {converted.lats[i]}</span>
                        {' · '}
                        <span className="text-slate-600">{t(`file.status.${label}`)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {summary && (
              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
                <div><dt className="text-slate-500">{t('file.valid')}</dt><dd className="font-mono text-slate-200">{summary.count}</dd></div>
                <div><dt className="text-slate-500">{t('file.latRange')}</dt><dd className="font-mono text-slate-200">{summary.latMin} … {summary.latMax}</dd></div>
                <div><dt className="text-slate-500">{t('file.lonRange')}</dt><dd className="font-mono text-slate-200">{summary.lonMin} … {summary.lonMax}</dd></div>
                <div><dt className="text-slate-500">{t('file.centroid')}</dt><dd className="font-mono text-slate-200">{summary.latMean.toFixed(5)}, {summary.lonMean.toFixed(5)}</dd></div>
              </dl>
            )}

            <div className="mt-4 overflow-x-auto rounded border border-edge">
              <table className="w-full min-w-max text-xs">
                <thead>
                  <tr className="border-b border-edge bg-panel text-left">
                    <th className="px-2 py-1.5 font-medium text-slate-500">#</th>
                    {final.columns.map((c) => (
                      <th key={c} className="whitespace-nowrap px-2 py-1.5 font-medium text-slate-300">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {final.rows.slice(0, PREVIEW_ROWS).map((row, i) => (
                    <tr key={i} className="border-b border-edge/50 last:border-0">
                      <td className={`px-2 py-1 font-mono ${STATUS_STYLE[detection.labels[i]] ?? 'text-slate-500'}`}>
                        {i + 1}
                      </td>
                      {row.map((v, c) => (
                        <td key={c} className="whitespace-nowrap px-2 py-1 font-mono text-slate-300">
                          {v === null || v === undefined ? '' : String(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {final.rows.length > PREVIEW_ROWS && (
              <p className="mt-2 text-xs text-slate-500">
                {t('file.previewNote', { shown: PREVIEW_ROWS, total: final.rows.length })}
              </p>
            )}
          </Step>

          <Step n={4} title={t('file.step4')}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <DownloadButton
                label="CSV"
                hint={t('file.csvHint')}
                onClick={() => download(
                  // The byte-order mark is what makes Excel open a UTF-8 CSV
                  // with its accents intact instead of as mojibake.
                  new TextEncoder().encode(`﻿${toCsv(final)}`),
                  `${baseName}_convertido.csv`,
                  'text/csv;charset=utf-8',
                )}
              />
              <DownloadButton
                label="GeoJSON"
                hint={t('file.gisHint')}
                disabled={exportable.features.length === 0}
                onClick={() => download(
                  new TextEncoder().encode(toGeoJSON(exportable.features)),
                  `${baseName}.geojson`,
                  'application/geo+json',
                )}
              />
              <DownloadButton
                label="KML"
                hint={t('file.kmlHint')}
                disabled={exportable.features.length === 0}
                onClick={() => download(
                  new TextEncoder().encode(toKML(exportable.features, exportable.fieldNames[0] ?? null)),
                  `${baseName}.kml`,
                  'application/vnd.google-earth.kml+xml',
                )}
              />
              <DownloadButton
                label="Shapefile"
                hint={t('file.shpHint')}
                disabled={exportable.features.length === 0}
                onClick={async () => download(
                  await toShapefileZip(exportable.features, exportable.fieldNames, baseName),
                  `${baseName}_shapefile.zip`,
                  'application/zip',
                )}
              />
              <DownloadButton
                label="GPX"
                hint={t('file.gpxHint')}
                disabled={exportable.features.length === 0}
                onClick={() => download(
                  new TextEncoder().encode(toGpx(exportable.features, exportable.fieldNames[0] ?? null)),
                  `${baseName}.gpx`,
                  'application/gpx+xml',
                )}
              />
            </div>
            <p className="mt-3 text-xs text-slate-500">{t('file.exportNote')}</p>
          </Step>
        </>
      )}
    </section>
  )
}
