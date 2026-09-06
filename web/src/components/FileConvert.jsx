import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PointsMap from './PointsMap.jsx'
import { detectSwaps, inRange, regionCheck, tidyTable } from '../core/converter.js'
import { sanitizeFilename, toGeoJSON, toKML, toShapefileZip } from '../core/geoexport.js'
import {
  LAT_CANDIDATES,
  LON_CANDIDATES,
  REGION_MASKS,
  applySwaps,
  buildResult,
  countByStatus,
  featuresInRange,
  guessCoordinateColumns,
  pointsSummary,
  toCsv,
  toExcelBytes,
  toGpx,
} from '../core/pipeline.js'
import * as crs from '../core/crs.js'
import {
  SEPARATORS,
  WARN_ROWS,
  readCsvBytes,
  readCsvText,
  readWorkbook,
  workbookSheets,
} from '../core/reader.js'
import { useT } from '../i18n.jsx'

const SPREADSHEET = /\.(xlsx|xlsm|xlsb|xls|ods)$/i

/** A count for a message: cells plainly, bytes as megabytes. */
function formatCount(n, kind) {
  return kind === 'cells'
    ? n.toLocaleString()
    : `${Math.round(n / (1024 * 1024)).toLocaleString()} MB`
}
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
// A shape as well as a colour. Amber against green is a common pair to lose,
// and a table of numbers in two colours says nothing to a screen reader at all.
const STATUS_MARK = {
  ok: '',
  swap_axis: '\u25b2\u00a0',
  swap_range: '\u25b2\u00a0',
  swap_cluster: '\u25b2\u00a0',
  out_of_range: '\u2715\u00a0',
  missing: '\u2715\u00a0',
}

const STATUS_STYLE = {
  ok: 'text-accent',
  swap_axis: 'text-amber-400',
  swap_range: 'text-amber-400',
  swap_cluster: 'text-amber-400',
  out_of_range: 'text-red-400',
  missing: 'text-red-400',
}

// The status used to be in the row number alone, a coloured digit at the left
// edge of a wide scrolling table - easy to miss, and gone entirely once the
// table is scrolled sideways. The row now carries it: a tint across the whole
// row, and the failures in red rather than in the ordinary text colour.
const ROW_STYLE = {
  ok: '',
  swap_axis: 'bg-amber-500/10',
  swap_range: 'bg-amber-500/10',
  swap_cluster: 'bg-amber-500/10',
  out_of_range: 'bg-red-500/10 text-red-300',
  missing: 'bg-red-500/10 text-red-300',
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

/**
 * A coordinate-system chooser: the registry grouped by kind, then the two
 * escape hatches. The deprecated ones are marked rather than hidden - somebody
 * with a file in Madeira 1936 still has to be able to say so.
 */
function CrsSelect({ id, label, value, onChange, includeNone = false, t }) {
  const geographic = crs.systems('geographic')
  const projected = crs.systems('projected')
  return (
    // basis-full below the sm breakpoint: sharing a 390px row, the select
    // showed a value cut off exactly where the EPSG code is, which is the part
    // that tells one datum from the one next to it.
    <div className="min-w-0 basis-full sm:flex-1">
      <label htmlFor={id} className="mb-1 block text-xs text-slate-400">{label}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-edge bg-panel px-2 py-1.5 text-sm text-slate-100
                   focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        {includeNone && <option value="none">{t('crs.none')}</option>}
        <optgroup label={t('crs.geographic')}>
          {geographic.map((s) => (
            <option key={s.epsg} value={String(s.epsg)}>{s.pt} — EPSG:{s.epsg}</option>
          ))}
        </optgroup>
        <optgroup label={t('crs.projected')}>
          {projected.map((s) => (
            <option key={s.epsg} value={String(s.epsg)}>
              {s.pt} — EPSG:{s.epsg}{s.deprecated ? ` (${t('crs.deprecated')})` : ''}
            </option>
          ))}
        </optgroup>
        <optgroup label={t('crs.generic')}>
          <option value="utm">{t('crs.utm')}</option>
          <option value="custom">{t('crs.custom')}</option>
        </optgroup>
      </select>
    </div>
  )
}

function Step({ n, title, children }) {
  const t = useT()
  return (
    <section className="mt-6 rounded-lg border border-edge bg-surface p-4"
             aria-label={t('file.stepLabel', { n, title })}>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-200">
        {/* The badge is decoration: read out, the number ran straight into the
            title and the heading list said "1Ficheiro". */}
        <span
          aria-hidden="true"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full
                     bg-accent/15 text-xs font-semibold text-accent"
        >
          {n}
        </span>
        <span className="sr-only">{t('file.stepLabel', { n, title })}</span>
        <span aria-hidden="true">{title}</span>
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
  // Something worth saying that is not a failure: an empty first sheet,
  // a file large enough to be slow.
  const [notice, setNotice] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [pasting, setPasting] = useState(false)
  const [pasted, setPasted] = useState('')

  const [latCol, setLatCol] = useState('')
  const [lonCol, setLonCol] = useState('')
  const [region, setRegion] = useState('Portugal mainland')
  const [decimals, setDecimals] = useState(6)
  const [addDms, setAddDms] = useState(true)
  // Whether to take the sign from the declared region where the file gives
  // none. Set automatically the first time a file turns out to need it,
  // because the people this is for do not know to look for the option.
  const [applyRegionSign, setApplyRegionSign] = useState(true)
  const [accepted, setAccepted] = useState(() => new Set())

  // The coordinate systems. 'utm' and 'custom' are the two escape hatches: a
  // UTM zone by number, and a proj4 definition pasted whole. Neither needs this
  // application to have guessed at a national datum it cannot verify.
  const [inputSel, setInputSel] = useState(crs.WGS84)
  const [outputSel, setOutputSel] = useState('none')
  const [utmZone, setUtmZone] = useState('29')
  const [utmSouth, setUtmSouth] = useState(false)
  const [customProj4, setCustomProj4] = useState('')
  // The map is opened by hand. Until it is, the page has spoken to nobody,
  // and that is a promise worth keeping literally rather than nearly.
  const [showMap, setShowMap] = useState(false)

  /**
   * Turn a selection into `{ proj4, kind, suffix, label, epsg }`, or null when
   * it is not usable yet - an empty custom definition, a zone out of range.
   */
  const resolve = useCallback((selection) => {
    if (selection === 'none') return null
    if (selection === 'utm') {
      const zone = Number(utmZone)
      if (!Number.isInteger(zone) || zone < 1 || zone > 60) return null
      return {
        proj4: crs.utmProj4(zone, utmSouth),
        kind: 'projected',
        suffix: crs.utmLabel(zone, utmSouth),
        label: `UTM ${zone}${utmSouth ? 'S' : 'N'} (WGS84)`,
        epsg: null,
      }
    }
    if (selection === 'custom') {
      const definition = customProj4.trim()
      if (!definition.startsWith('+proj=')) return null
      return {
        proj4: definition,
        kind: definition.includes('+proj=longlat') ? 'geographic' : 'projected',
        suffix: 'custom',
        label: t('crs.custom'),
        epsg: null,
      }
    }
    const entry = crs.REGISTRY[selection]
    if (entry === undefined) return null
    return {
      proj4: entry.proj4,
      kind: entry.kind,
      suffix: String(entry.epsg),
      label: entry.pt,
      epsg: entry.epsg,
    }
  }, [customProj4, t, utmSouth, utmZone])

  const inputCrs = resolve(inputSel)
  const outputCrs = resolve(outputSel)
  const projectedInput = inputCrs !== null && inputCrs.kind === 'projected'

  const inputRef = useRef(null)
  // The file's name, outside React state: the re-read effect needs it without
  // taking a dependency on the source it is about to replace.
  const nameRef = useRef('')
  // setSheets does not land before loadFile looks at it, so the names are
  // carried across the same tick in a ref as well.
  const sheetsRef = useRef([])

  /** Read a table out of whatever is currently loaded, honouring the options.
   *  Asynchronous because SheetJS is fetched only when a workbook turns up. */
  const reread = useCallback(async (data, name, sheetName, separator) => {
    if (SPREADSHEET.test(name)) {
      const names = await workbookSheets(data)
      sheetsRef.current = names
      setSheets(names)
      const chosen = names.includes(sheetName) ? sheetName : names[0]
      setSheet(chosen ?? '')
      return tidyTable(await readWorkbook(data, chosen))
    }
    sheetsRef.current = []
    setSheets([])
    setSheet('')
    return tidyTable(readCsvBytes(data, { sep: separator === 'auto' ? null : separator }))
  }, [])

  /**
   * Everything loaded is thrown away first.
   *
   * It used to be thrown away only on success, so a file that failed to open
   * left the previous one on screen - the table, the map, the downloads, all
   * live and all belonging to the last job. A geologist finishing one survey
   * and starting the next got the previous survey's points under the new
   * name, with no error to say otherwise. That is the failure worth fearing:
   * not a crash, a plausible wrong answer.
   */
  const clearLoaded = useCallback(({ keepSheets = false } = {}) => {
    setSource(null)
    setBytes(null)
    if (!keepSheets) {
      setSheets([])
      setSheet('')
    }
    // The chosen columns are derived state too. Left behind, they made
    // buildResult succeed on an empty table, so an unreadable file produced
    // Result, Map and Download steps holding nothing - which reads as "your
    // file converted to zero rows" rather than "your file could not be read".
    setLatCol('')
    setLonCol('')
    setConverted(null)
    setFinal(null)
    setAccepted(new Set())
    setShowMap(false)
    setNotice(null)
  }, [])

  /** A read failure, said in the user's language rather than the exception's. */
  const reportReadError = useCallback((e) => {
    clearLoaded()
    if (e?.code === 'too-large') {
      setError(t('file.errTooLarge', {
        kind: t(e.kind === 'cells' ? 'file.unitCells' : 'file.unitBytes'),
        actual: formatCount(e.actual, e.kind),
        limit: formatCount(e.limit, e.kind),
      }))
      return
    }
    setError(t('file.errRead', { message: e?.message ?? String(e) }))
  }, [clearLoaded, t])

  const loadFile = useCallback(async (file) => {
    setError(null)
    setNotice(null)
    let data
    let table
    try {
      data = new Uint8Array(await file.arrayBuffer())
      table = await reread(data, file.name, '', sep)
    } catch (e) {
      reportReadError(e)
      return
    }
    if (table.columns.length === 0) {
      // An empty sheet is not a broken file when the workbook has others: a
      // cover page or a README tab as sheet one is how institutional workbooks
      // usually arrive. Keep the sheet names so the picker can offer the rest.
      const hasOtherSheets = sheetsRef.current.length > 1
      clearLoaded({ keepSheets: hasOtherSheets })
      if (hasOtherSheets) {
        nameRef.current = file.name
        setBytes(data)
        setNotice(t('file.noticeEmptySheet'))
      } else {
        setError(t('file.errEmpty'))
      }
      return
    }
    nameRef.current = file.name
    setBytes(data)
    setSource({ name: file.name, table })
    setAccepted(new Set())
    if (table.rows.length > WARN_ROWS) {
      setNotice(t('file.noticeLarge', { n: table.rows.length.toLocaleString() }))
    }
  }, [clearLoaded, reportReadError, reread, sep, t])

  const loadPasted = useCallback(() => {
    setError(null)
    setNotice(null)
    let table
    try {
      table = tidyTable(readCsvText(pasted, { sep: null }))
    } catch (e) {
      reportReadError(e)
      return
    }
    if (table.columns.length === 0) {
      clearLoaded()
      setError(t('file.errEmpty'))
      return
    }
    nameRef.current = 'colado.csv'
    setBytes(null)
    setSheets([])
    setSource({ name: 'colado.csv', table })
    setAccepted(new Set())
  }, [clearLoaded, pasted, reportReadError, t])

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
        if (!cancelled) reportReadError(e)
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
    if (columns.length === 0 || !source) return
    // The guess reads the values, not only the names, and takes the region
    // into account - which is why it re-runs when the region changes. On a
    // file whose columns are called "Condenadas" and "Unnamed: 2" the names
    // are no help at all, and the region is what says which of two magnitudes,
    // 15 and 33, is the latitude.
    const [a, b] = guessCoordinateColumns(
      columns, source.table.rows, region === 'auto' ? null : REGION_MASKS[region],
    )
    // The first selector is the latitude for a geographic system and the X -
    // the easting - for a projected one, so for a projected file the pair is
    // handed over the other way round.
    setLatCol(columns[projectedInput ? b : a])
    setLonCol(columns[projectedInput ? a : b])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnKey, projectedInput, region])

  // Building is asynchronous now: a coordinate system may have to be fetched.
  // A selection changed while an earlier build is still running must not have
  // the stale result land on top of the newer one.
  const [converted, setConverted] = useState(null)
  const [converting, setConverting] = useState(false)
  useEffect(() => {
    if (!source || !latCol || !lonCol) {
      setConverted(null)
      return undefined
    }
    let cancelled = false
    setConverting(true)
    buildResult(source.table, latCol, lonCol, {
      decimals,
      addDms,
      input: inputCrs,
      output: outputCrs,
      regionMask: region === 'auto' ? null : REGION_MASKS[region],
      applyRegionSign,
    }).then((result) => {
      if (cancelled) return
      setConverted(result)
      setError(null)
    }).catch((e) => {
      if (!cancelled) setError(t('crs.errTransform', { message: e?.message ?? String(e) }))
    }).finally(() => {
      if (!cancelled) setConverting(false)
    })
    return () => { cancelled = true }
    // inputCrs/outputCrs are rebuilt every render; their proj4 is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, latCol, lonCol, decimals, addDms, region, applyRegionSign,
      inputCrs?.proj4, inputCrs?.kind, outputCrs?.proj4, outputCrs?.suffix])

  const detection = useMemo(() => {
    if (!converted) return null
    const mask = region === 'auto' ? null : REGION_MASKS[region]
    const { labels } = detectSwaps(converted.lats, converted.lons, {
      mask,
      axis_mismatch: converted.axisMismatch,
    })
    const { detected } = regionCheck(converted.lats, converted.lons, labels, REGION_MASKS, { mask })
    return { labels, detected }
  }, [converted, region])

  // The count survives the checkbox being unticked: buildResult reports how
  // many rows the region *could* sign either way, so the offer does not
  // vanish the moment it is declined.
  const signable = converted?.signable ?? 0

  // The rows the user has agreed to invert, applied. Asynchronous for the same
  // reason as the build: the second system has to be recomputed.
  const [final, setFinal] = useState(null)
  useEffect(() => {
    if (!converted) {
      setFinal(null)
      return undefined
    }
    if (accepted.size === 0) {
      setFinal(converted)
      return undefined
    }
    let cancelled = false
    applySwaps(converted, accepted, { addDms }).then((r) => {
      if (!cancelled) setFinal(r)
    })
    return () => { cancelled = true }
  }, [converted, accepted, addDms])

  const suspects = useMemo(() => {
    if (!detection) return []
    return detection.labels
      .map((label, i) => ({ label, i }))
      .filter(({ label }) => label === 'swap_range' || label === 'swap_cluster'
        || label === 'swap_axis')
  }, [detection])

  const counts = detection ? countByStatus(detection.labels) : new Map()
  const summary = final ? pointsSummary(final) : null
  const baseName = sanitizeFilename((source?.name ?? 'coordinates').replace(/\.[^.]+$/, ''), 'coordinates')

  const exportable = useMemo(() => {
    if (!final) return null
    const { features, fieldNames } = featuresInRange(final)
    return { features, fieldNames }
  }, [final])

  // The status to show for a row, as opposed to the status detection gave it.
  // Detection runs on the data as it was read, so that unticking a row brings
  // its suggestion back; but once the user has accepted an inversion the row is
  // no longer pending review, and colouring it as suspect would say otherwise.
  const displayLabel = useCallback(
    (i) => (accepted.has(i) ? 'ok' : detection?.labels[i]),
    [accepted, detection],
  )

  // What to draw. A row flagged swap_range is drawn where it would be if the
  // columns were the other way round, which is the only place it could be: as
  // written it is not a point on Earth. Mirrors render_map in app.py.
  const mapPoints = useMemo(() => {
    if (!final || !detection) return []
    const out = []
    for (let i = 0; i < final.rows.length; i += 1) {
      const lat = final.lats[i]
      const lon = final.lons[i]
      const label = accepted.has(i) ? 'ok' : detection.labels[i]
      if (inRange(lat, 'lat') && inRange(lon, 'lon')) {
        out.push({ lat, lon, row: i, label, suspect: label !== 'ok' })
      } else if (inRange(lon, 'lat') && inRange(lat, 'lon')) {
        out.push({ lat: lon, lon: lat, row: i, label, suspect: true })
      }
    }
    return out
  }, [final, detection, accepted])

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) loadFile(file)
  }

  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
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
          <p className="mt-1 text-xs text-slate-400">{t('file.formats')}</p>
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
            // The visible button above is the control; this input is opened by
            // it. Left in the tab order it was a stop with no name at all.
            tabIndex={-1}
            aria-hidden="true"
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

        {sheets.length > 1 && (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <Select id="sheet" label={t('file.sheet')} value={sheet} onChange={setSheet}>
              {sheets.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
        )}

        {notice && (
          <p className="mt-3 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
            {notice}
          </p>
        )}

        {source && (
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <p className="text-sm text-slate-400">
              {t('file.loaded', { name: source.name, n: source.table.rows.length, cols: columns.length })}
            </p>

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
            <Select
              id="lat-col"
              label={projectedInput ? t('crs.xColumn') : t('file.latColumn')}
              value={latCol}
              onChange={setLatCol}
            >
              {columns.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Select
              id="lon-col"
              label={projectedInput ? t('crs.yColumn') : t('file.lonColumn')}
              value={lonCol}
              onChange={setLonCol}
            >
              {columns.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Select id="region" label={t('file.region')} value={region} onChange={setRegion}>
              <option value="auto">{t('file.regionAuto')}</option>
              {Object.keys(REGION_MASKS).map((r) => <option key={r} value={r}>{r}</option>)}
            </Select>
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            <CrsSelect
              id="crs-in"
              label={t('crs.input')}
              value={inputSel}
              onChange={setInputSel}
              t={t}
            />
            <CrsSelect
              id="crs-out"
              label={t('crs.output')}
              value={outputSel}
              onChange={setOutputSel}
              includeNone
              t={t}
            />
          </div>

          {(inputSel === 'utm' || outputSel === 'utm') && (
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="utm-zone" className="mb-1 block text-xs text-slate-400">
                  {t('crs.utmZone')}
                </label>
                <input
                  id="utm-zone"
                  type="number"
                  min="1"
                  max="60"
                  value={utmZone}
                  onChange={(e) => setUtmZone(e.target.value)}
                  className="w-24 rounded border border-edge bg-panel px-2 py-1.5 text-sm text-slate-100"
                />
              </div>
              <label className="flex items-center gap-2 pb-2 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={utmSouth}
                  onChange={(e) => setUtmSouth(e.target.checked)}
                  className="h-4 w-4 shrink-0 accent-accent"
                />
                {t('crs.utmSouth')}
              </label>
            </div>
          )}

          {(inputSel === 'custom' || outputSel === 'custom') && (
            <div className="mt-3">
              <label htmlFor="custom-proj4" className="mb-1 block text-xs text-slate-400">
                {t('crs.customLabel')}
              </label>
              <input
                id="custom-proj4"
                value={customProj4}
                onChange={(e) => setCustomProj4(e.target.value)}
                placeholder="+proj=utm +zone=33 +south +datum=WGS84 +units=m +no_defs"
                className="w-full rounded border border-edge bg-panel px-3 py-2 font-mono text-xs
                           text-slate-100 focus-visible:outline focus-visible:outline-2
                           focus-visible:outline-accent"
              />
            </div>
          )}

          {inputCrs !== null && inputCrs.epsg !== null && crs.REGISTRY[String(inputCrs.epsg)]?.note && (
            <p className="mt-3 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              {crs.REGISTRY[String(inputCrs.epsg)].note}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-slate-400">
              {t('file.decimals')}
              <input
                type="range"
                min="2"
                max="8"
                value={decimals}
                onChange={(e) => setDecimals(Number(e.target.value))}
                className="h-6 w-24 accent-accent"
              />
              <span className="w-4 font-mono text-slate-300">{decimals}</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={addDms}
                onChange={(e) => setAddDms(e.target.checked)}
                className="h-4 w-4 shrink-0 accent-accent"
              />
              {t('file.addDms')}
            </label>
            {signable > 0 && (
              <label className="flex items-center gap-2 text-xs text-amber-300">
                <input
                  type="checkbox"
                  checked={applyRegionSign}
                  onChange={(e) => setApplyRegionSign(e.target.checked)}
                  className="h-4 w-4 shrink-0 accent-accent"
                />
                {t('file.applyRegionSign', { n: signable, region })}
              </label>
            )}
          </div>
        </Step>
      )}

      {final && detection && (
        <>
          <Step n={3} title={t('file.step3')}>
            {/* Converting a large file takes a second or two, and transforming
                between coordinate systems is per-row work on top. A page that
                sits still without saying anything is a page people reload. */}
            {/* What goes in here has to *change* when the result changes, or a
                screen reader is told nothing after the first load. It used to
                say only the row count, which is the one number that does not
                move when the column mapping or the coordinate system does -
                the two settings most likely to be wrong. */}
            <p
              aria-live="polite"
              className={`mb-2 text-xs ${converting ? 'text-slate-400' : 'sr-only'}`}
            >
              {converting
                ? t('crs.converting')
                : t('file.doneCounts', {
                  n: final.rows.length,
                  ok: counts.get('ok') ?? 0,
                  swap: suspects.length,
                  bad: (counts.get('out_of_range') ?? 0) + (counts.get('missing') ?? 0),
                })}
            </p>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {['ok', 'swap_axis', 'swap_range', 'swap_cluster', 'out_of_range', 'missing'].map((s) => (
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
                  <span className="self-center text-xs text-slate-400">
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
                        className="h-4 w-4 shrink-0 accent-accent"
                      />
                      <label htmlFor={`swap-${i}`} className="font-mono text-slate-400">
                        {t('file.rowN', { n: i + 1 })}
                        {' · '}
                        {converted.lats[i]}, {converted.lons[i]}
                        {' → '}
                        <span className="text-accent">{converted.lons[i]}, {converted.lats[i]}</span>
                        {' · '}
                        <span className="text-slate-400">{t(`file.status.${label}`)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {summary && (
              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
                <div><dt className="text-slate-400">{t('file.valid')}</dt><dd className="font-mono text-slate-200">{summary.count}</dd></div>
                <div><dt className="text-slate-400">{t('file.latRange')}</dt><dd className="font-mono text-slate-200">{summary.latMin} … {summary.latMax}</dd></div>
                <div><dt className="text-slate-400">{t('file.lonRange')}</dt><dd className="font-mono text-slate-200">{summary.lonMin} … {summary.lonMax}</dd></div>
                <div><dt className="text-slate-400">{t('file.centroid')}</dt><dd className="font-mono text-slate-200">{summary.latMean.toFixed(5)}, {summary.lonMean.toFixed(5)}</dd></div>
              </dl>
            )}

            {/* Two views of one answer, together. The map is the instrument
                here: a point that landed in Sudan is obvious on it in a second
                and invisible in a column of numbers. The table is for the
                detail, which is the second question, not the first.

                Side by side above lg, and on a narrow screen the map comes
                first - order-1 - because that is the one worth seeing before
                scrolling. The table keeps its own scrollbar at the map's
                height so the two stay level instead of one running down the
                page. */}
            <div className="mt-4 grid gap-4 lg:grid-cols-5">
              <div className="order-2 min-w-0 lg:order-1 lg:col-span-3">
                <div
                  className="max-h-[420px] overflow-auto rounded border border-edge"
                  tabIndex={0}
                  role="region"
                  aria-label={t('file.tableRegion')}
                >
              <table className="w-full min-w-max text-xs">
                <caption className="sr-only">
                  {t('file.tableCaption', { shown: Math.min(PREVIEW_ROWS, final.rows.length), total: final.rows.length })}
                </caption>
                <thead>
                  <tr className="border-b border-edge bg-panel text-left">
                    <th scope="col" className="px-2 py-1.5 font-medium text-slate-400">
                      {t('file.rowHeader')}
                    </th>
                    {final.columns.map((c) => (
                      <th key={c} scope="col" className="whitespace-nowrap px-2 py-1.5 font-medium text-slate-300">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {final.rows.slice(0, PREVIEW_ROWS).map((row, i) => (
                    <tr
                      key={i}
                      className={`border-b border-edge/50 last:border-0
                                  ${ROW_STYLE[displayLabel(i)] ?? ''}`}
                    >
                      {/* The status was in the colour and nowhere else, so a
                          screen reader was told nothing and anyone who cannot
                          separate amber from green saw nothing either. The mark
                          carries it visually, the hidden text carries it
                          aloud. */}
                      <th
                        scope="row"
                        className={`whitespace-nowrap px-2 py-1 text-left font-mono font-normal
                                    ${STATUS_STYLE[displayLabel(i)] ?? 'text-slate-400'}`}
                      >
                        <span aria-hidden="true">{STATUS_MARK[displayLabel(i)] ?? ''}</span>
                        {i + 1}
                        <span className="sr-only">
                          {', '}
                          {t(`file.rowStatus.${displayLabel(i)}`)}
                        </span>
                      </th>
                      {row.map((v, c) => (
                        <td key={c} className="whitespace-nowrap px-2 py-1 font-mono">
                          {v === null || v === undefined ? '' : String(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
                </div>
                {final.rows.length > PREVIEW_ROWS && (
                  <p className="mt-2 text-xs text-slate-400">
                    {t('file.previewNote', { shown: PREVIEW_ROWS, total: final.rows.length })}
                  </p>
                )}
              </div>

              <div className="order-1 min-w-0 lg:order-2 lg:col-span-2">
                <h3 className="mb-2 text-sm font-medium text-slate-200">{t('file.stepMap')}</h3>
                {showMap ? (
                  <PointsMap points={mapPoints} />
                ) : (
                  <div className="rounded border border-dashed border-edge p-4">
                    <p className="text-xs text-slate-400">{t('map.optIn')}</p>
                    <button
                      type="button"
                      disabled={mapPoints.length === 0}
                      onClick={() => setShowMap(true)}
                      className="mt-3 rounded border border-accent/50 px-3 py-1.5 text-sm text-accent
                                 transition-colors hover:bg-accent hover:text-panel
                                 focus-visible:outline focus-visible:outline-2
                                 focus-visible:outline-accent
                                 disabled:cursor-not-allowed disabled:border-edge
                                 disabled:text-slate-600 disabled:hover:bg-transparent"
                    >
                      {mapPoints.length === 0
                        ? t('map.nothingToShow')
                        : t('map.show', { n: mapPoints.length })}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </Step>

          <Step n={4} title={t('file.step4')}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
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
                label="Excel"
                hint={t('file.xlsxHint')}
                onClick={async () => download(
                  await toExcelBytes(final),
                  `${baseName}_convertido.xlsx`,
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
                  // The .prj describes the system the geometry is written in.
                  // Shapefile geometry stays WGS84 here, so the sidecar does
                  // too: a .prj that names a system the coordinates are not in
                  // is worse than none.
                  await toShapefileZip(exportable.features, exportable.fieldNames, baseName,
                    crs.esriWkt(crs.WGS84).wkt),
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
            <p className="mt-3 text-xs text-slate-400">{t('file.exportNote')}</p>
          </Step>
        </>
      )}
    </section>
  )
}
