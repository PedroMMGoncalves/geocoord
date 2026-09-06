import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PointsMap, { COLOR_OK, COLOR_SUSPECT } from './PointsMap.jsx'
import { detectSwaps, inRange, parseCoordinate, regionCheck, tidyTable } from '../core/converter.js'
import { sanitizeFilename, toGeoJSON, toKML, toShapefileZip } from '../core/geoexport.js'
import {
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
import { isGeospatial, readGeospatialBytes } from '../core/georead.js'
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

// What a reader learned while reading, and the string that says it. A reader
// returns codes rather than sentences so each interface writes them in its own
// language; these are the ones georead.js can return.
const NOTE_KEYS = {
  geo_skipped_non_points: 'file.noticeSkipped',
  gpx_from_track: 'file.noticeGpxTrack',
  gpx_from_route: 'file.noticeGpxRoute',
  gpx_ignored_tracks: 'file.noticeGpxIgnored',
  geojson_crs: 'file.noticeGeoCrs',
}

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

// The statuses detectSwaps can return, in the order the readout shows them.
const STATUSES = ['ok', 'swap_axis', 'swap_range', 'swap_cluster', 'out_of_range', 'missing']

// A shape as well as a colour. Amber against green is a common pair to lose,
// and a table of numbers in two colours says nothing to a screen reader at all.
const STATUS_MARK = {
  ok: '',
  swap_axis: '▲ ',
  swap_range: '▲ ',
  swap_cluster: '▲ ',
  out_of_range: '✕ ',
  missing: '✕ ',
}

// Colour marks exceptions only. A converted row is neutral; amber is a question
// for the user, not a verdict; red is what could not be used at all. It used
// to be green for the converted rows too, which left green meaning nothing.
const STATUS_TONE = {
  ok: '',
  swap_axis: 'review',
  swap_range: 'review',
  swap_cluster: 'review',
  out_of_range: 'fail',
  missing: 'fail',
}

// The worked example on the empty drop zone: the single-coordinate tab's first
// example, converted here rather than typed in, so it cannot drift from what
// the converter actually does.
const DEMO = { lat: '38° 42\' 30" N', lon: '9° 8\' 12" W' }

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

function Chevron() {
  return (
    <svg className="chev" viewBox="0 0 16 16" fill="none" stroke="currentColor"
         strokeWidth="1.6" aria-hidden="true">
      <path d="M4 6l4 4 4-4" />
    </svg>
  )
}

/** The reticle: coordinates are a grid, and this is where the grid points. */
function Reticle({ className }) {
  return (
    <svg className={className} viewBox="0 0 44 44" fill="none" stroke="currentColor"
         strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="22" cy="22" r="13" />
      <circle cx="22" cy="22" r="2" fill="currentColor" stroke="none" />
      <path d="M22 3v8M22 33v8M3 22h8M33 22h8" />
      <path d="M22 16v2M22 26v2M16 22h2M26 22h2" strokeOpacity=".6" />
    </svg>
  )
}

/**
 * A step, as a card that closes to a summary.
 *
 * Closed, a card is not hidden, it is summarised: a second line under the
 * title says what the step is set to, so a glance confirms every setting
 * without opening anything, and the page compresses as the work progresses.
 * The header is a real disclosure button, so it is a stop in the tab order
 * with a name and a state, and the panel keeps its contents mounted so a
 * select does not forget its value by being folded away.
 *
 * The numeral is decoration - read out, "01" ran straight into the title -
 * and the hidden text carries the ordinal instead. The state disc is the
 * same: a mark for the eye, with the summary line saying it in words.
 */
function Card({ n, title, state, summary, open, onToggle, className = '', children }) {
  const t = useT()
  const id = `card-${n}`
  return (
    <section className={`card ${className}`} aria-labelledby={`${id}-h`}>
      <h2 className="card-h">
        <button
          type="button"
          id={`${id}-h`}
          aria-expanded={open}
          aria-controls={`${id}-b`}
          onClick={onToggle}
        >
          <span className="num" aria-hidden="true">{String(n).padStart(2, '0')}</span>
          <span className="sep" aria-hidden="true" />
          <span className="ttl">
            <span className="sr-only">{t('file.stepLabel', { n, title })}</span>
            <span aria-hidden="true">{title}</span>
          </span>
          <span className={`st ${state ?? ''}`} aria-hidden="true">
            {state === 'ok' ? '✓' : state === 'warn' ? '▲' : ''}
          </span>
          <Chevron />
          {summary && <span className="sum">{summary}</span>}
        </button>
      </h2>
      <div className="card-b" id={`${id}-b`} hidden={!open}>
        {children}
      </div>
    </section>
  )
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
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="sel">
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

function Select({ id, label, value, onChange, children }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="sel">
        {children}
      </select>
    </div>
  )
}

/**
 * One download. It names the file it will write, because "Excel" is a format
 * and `amostras_tete_convertido.xlsx` is the thing that will appear in the
 * downloads folder, and the second is what somebody looks for afterwards.
 */
function DownloadButton({ label, hint, file, primary = false, onClick, disabled }) {
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
      className={`btn ${primary ? 'primary' : ''}`}
    >
      <span className="r1">
        <span className="fmt">{label}</span>
        <span className="hint">{hint}</span>
      </span>
      <span className="file">{file}</span>
    </button>
  )
}

/**
 * A converted value in the table, its integer part bright and its fraction
 * dimmer, so a column of decimals lines up and the eye lands on the degrees
 * before the millionths. Anything that is not a plain decimal is left alone.
 */
function Cell({ value }) {
  const s = value === null || value === undefined ? '' : String(value)
  const m = /^(-?\d+\.)(\d+)$/.exec(s)
  if (!m) return s
  return (
    <>
      <span className="i">{m[1]}</span>
      <span className="f">{m[2]}</span>
    </>
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

  // Which cards are open. A card opens until its step is satisfied and then
  // closes on its own; one the user has touched stays as they left it, until
  // the next file starts the sequence again.
  const [openCards, setOpenCards] = useState({ 1: true, 2: true, 3: true, 4: true })
  const touched = useRef(new Set())
  const setOpen = useCallback((n, open) => {
    setOpenCards((s) => (s[n] === open ? s : { ...s, [n]: open }))
  }, [])
  const toggleCard = useCallback((n) => {
    touched.current.add(n)
    setOpenCards((s) => ({ ...s, [n]: !s[n] }))
  }, [])

  // Whether the swap question has been answered. Downloads wait for it: the
  // one promise this application makes about the data is that nothing is
  // changed without the user's confirmation, and a download button above an
  // unanswered question is an invitation to take the file without deciding.
  const [reviewed, setReviewed] = useState(false)
  const [rvOpen, setRvOpen] = useState(true)
  const rvTouched = useRef(false)

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
      return { table: tidyTable(await readWorkbook(data, chosen)), notes: [], crs: null }
    }
    sheetsRef.current = []
    setSheets([])
    setSheet('')
    // KML, KMZ, GeoJSON and GPX. These come back with more than a table: a GPX
    // whose points came from a track rather than from waypoints has not failed,
    // and a GeoJSON that declares its own coordinate system has just answered a
    // question the user would otherwise have had to answer themselves.
    if (isGeospatial(name)) {
      const read = await readGeospatialBytes(data, name)
      return { table: tidyTable(read.table), notes: read.notes, crs: read.crs }
    }
    return {
      table: tidyTable(readCsvBytes(data, { sep: separator === 'auto' ? null : separator })),
      notes: [],
      crs: null,
    }
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
    setNotice(null)
    touched.current = new Set()
    setOpenCards({ 1: true, 2: true, 3: true, 4: true })
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
    let notes = []
    let declaredCrs = null
    try {
      data = new Uint8Array(await file.arrayBuffer())
      const read = await reread(data, file.name, '', sep)
      table = read.table
      notes = read.notes
      declaredCrs = read.crs
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
    setPasting(false)
    // A new file starts the sequence over: the file card folds to its
    // summary and the rest open as they are reached.
    touched.current = new Set()
    rvTouched.current = false
    setOpenCards({ 1: false, 2: true, 3: true, 4: true })

    // A file that names its own coordinate system has answered the question
    // step two asks. Taking it is only right when it is a system this build
    // knows; otherwise the note says what the file claimed and the choice stays
    // with the user.
    const known = declaredCrs && crs.REGISTRY[String(declaredCrs).replace(/^EPSG:/i, '')]
    if (known) setInputSel(String(declaredCrs).replace(/^EPSG:/i, ''))

    // `n` as well as `count`: the plural rule in translate() keys on a variable
    // named n, while the note carries the readable name it is written with on
    // both sides of the port.
    const messages = notes
      .map((note) => (NOTE_KEYS[note.code]
        ? t(NOTE_KEYS[note.code], { ...note, n: note.count })
        : null))
      .filter(Boolean)
    if (table.rows.length > WARN_ROWS) {
      messages.push(t('file.noticeLarge', { n: table.rows.length.toLocaleString() }))
    }
    setNotice(messages.length > 0 ? messages.join(' ') : null)
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
    setPasting(false)
    touched.current = new Set()
    rvTouched.current = false
    setOpenCards({ 1: false, 2: true, 3: true, 4: true })
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
        const { table } = await reread(bytes, nameRef.current, sheet, sep)
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

  // The question is asked once per set of suspect rows. Changing the decimal
  // places rebuilds the result but not the rows in doubt, and an answer already
  // given must not be taken back for that.
  const suspectsKey = suspects.map((s) => s.i).join(',')
  useEffect(() => {
    setReviewed(false)
    setRvOpen(true)
    rvTouched.current = false
  }, [suspectsKey])
  const reviewPending = suspects.length > 0 && !reviewed

  /** The three ways of answering, and what each does to the panel. */
  const answer = useCallback((next) => {
    setAccepted(next)
    setReviewed(true)
    if (!rvTouched.current) setRvOpen(false)
  }, [])

  // The cards follow the work. Each closes on its own once its step is done,
  // unless the user has taken it in hand.
  const hasSource = source !== null
  useEffect(() => {
    if (!touched.current.has(1)) setOpen(1, !hasSource)
  }, [hasSource, setOpen])
  useEffect(() => {
    if (!touched.current.has(2)) setOpen(2, final === null)
  }, [final, setOpen])
  useEffect(() => {
    if (!touched.current.has(4)) setOpen(4, !reviewPending)
  }, [reviewPending, final, setOpen])

  // The status to show for a row, as opposed to the status detection gave it.
  // Detection runs on the data as it was read, so that unticking a row brings
  // its suggestion back; but once the user has accepted an inversion the row is
  // no longer pending review, and colouring it as suspect would say otherwise.
  const displayLabels = useMemo(() => {
    if (!detection) return []
    return detection.labels.map((label, i) => (accepted.has(i) ? 'ok' : label))
  }, [accepted, detection])
  const counts = useMemo(() => countByStatus(displayLabels), [displayLabels])
  const summary = final ? pointsSummary(final) : null
  const baseName = sanitizeFilename((source?.name ?? 'coordinates').replace(/\.[^.]+$/, ''), 'coordinates')

  const exportable = useMemo(() => {
    if (!final) return null
    const { features, fieldNames } = featuresInRange(final)
    return { features, fieldNames }
  }, [final])

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

  // Which columns the pipeline added, as opposed to the file's own. They get
  // the accent rule in the header and the split cells, because they are what
  // the file was brought here for.
  const inputColumns = useMemo(() => new Set(source?.table.columns ?? []), [source])
  const firstOut = final ? final.columns.findIndex((c) => !inputColumns.has(c)) : -1

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) loadFile(file)
  }

  const okCount = counts.get('ok') ?? 0
  const badCount = (counts.get('out_of_range') ?? 0) + (counts.get('missing') ?? 0)
  const pendingCount = suspects.filter(({ i }) => !accepted.has(i)).length

  // The summaries the closed cards show.
  const summary1 = source
    ? t('file.loaded', { name: source.name, n: source.table.rows.length, cols: columns.length })
    : null
  const summary2 = source && latCol && lonCol
    ? [
      `${latCol} / ${lonCol}`,
      region === 'auto' ? t('file.regionAuto') : region,
      inputCrs ? `${inputCrs.label}${inputCrs.epsg ? ` — EPSG:${inputCrs.epsg}` : ''}` : null,
      outputCrs ? `+ ${outputCrs.label}` : null,
      `${decimals} ${t('file.decimals').toLowerCase()}`,
    ].filter(Boolean).join(' · ')
    : null
  const summary3 = final && detection ? (
    <>
      {okCount} {t('file.status.ok')}
      {pendingCount > 0 && (
        <> · <span className="m-review">▲ {pendingCount} {t('file.toReview')}</span></>
      )}
      {badCount > 0 && (
        <> · <span className="m-fail">✕ {badCount} {t('file.status.missing')}</span></>
      )}
    </>
  ) : null
  const summary4 = reviewPending
    ? <span className="m-review">{t('file.swapsHint')}</span>
    : 'Excel · CSV · GeoJSON · KML · Shapefile · GPX'

  const formats = t('file.formats').split(',').map((s) => s.trim())
  const demoLat = parseCoordinate(DEMO.lat)
  const demoLon = parseCoordinate(DEMO.lon)

  return (
    <div
      className="wb"
      // One column: the two input cards share a row when closed, the result
      // takes the full width below them. A file dropped anywhere on the page
      // is a file to open - the drop zone sits inside a card that folds away
      // once there is a file, and a second survey should not have to hunt for
      // it.
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false) }}
      onDrop={onDrop}
    >
      <h1 className="sr-only">{t('file.title')}</h1>

      <aside aria-label={t('file.sidebarLabel')}>
        <Card
          n={1}
          title={t('file.step1')}
          state={source ? 'ok' : null}
          summary={summary1}
          open={openCards[1]}
          onToggle={() => toggleCard(1)}
        >
          <div className={`c1 ${source ? 'has-file' : ''}`}>
            {source && (
              <div className="stack">
                <div className="filerow">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
                       strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 3h8l4 4v14H6z" />
                    <path d="M14 3v4h4M9 12h6M9 16h6" />
                  </svg>
                  <div className="min-w-0">
                    <b>{source.name}</b>
                    <span>{t('file.rowsCols', { n: source.table.rows.length, cols: columns.length })}</span>
                  </div>
                </div>
                {sheets.length > 1 && (
                  <Select id="sheet" label={t('file.sheet')} value={sheet} onChange={setSheet}>
                    {sheets.map((s) => <option key={s} value={s}>{s}</option>)}
                  </Select>
                )}
                {sheets.length === 0 && bytes && !isGeospatial(source.name) && (
                  <Select id="sep" label={t('file.separator')} value={sep} onChange={setSep}>
                    {SEPARATOR_LABELS.filter((s) => s.value === 'auto' || SEPARATORS.includes(s.value))
                      .map((s) => <option key={s.value} value={s.value}>{t(s.key)}</option>)}
                  </Select>
                )}
              </div>
            )}

            <div className={`drop ${source ? '' : 'is-empty'} ${dragging ? 'is-dragging' : ''}`}>
              <Reticle className="reticle" />
              <p className="h">{t('file.dropHere')}</p>
              <p className="s">
                {formats.slice(0, 5).map((f, i) => (
                  <span key={f}>{i > 0 && <i>·</i>}{f}</span>
                ))}
                <br />
                {formats.slice(5).map((f, i) => (
                  <span key={f}>{i > 0 && <i>·</i>}{f}</span>
                ))}
              </p>
              <div className="b">
                <button type="button" onClick={() => inputRef.current?.click()} className="btn primary">
                  {t('file.choose')}
                </button>
                <button type="button" onClick={() => setPasting((v) => !v)} className="btn">
                  {t('file.paste')}
                </button>
              </div>
              {!source && demoLat !== null && demoLon !== null && (
                <div className="demo" aria-hidden="true">
                  <span className="in">{DEMO.lat}&nbsp;&nbsp;{DEMO.lon}</span>
                  <span>
                    <span className="arr">→</span>
                    <span className="out">{demoLat.toFixed(6)}, {demoLon.toFixed(6)}</span>
                  </span>
                </div>
              )}
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.txt,.tsv,.xlsx,.xlsm,.xlsb,.xls,.ods,.kml,.kmz,.geojson,.json,.gpx"
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
          </div>

          {pasting && (
            <div className="field mt-3">
              <label htmlFor="paste-box">{t('file.pasteLabel')}</label>
              <textarea
                id="paste-box"
                rows={5}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder={'Amostra\tLatitude\tLongitude\nA1\t38° 42\' 30" N\t9° 8\' 12" W'}
                className="txt font-mono text-xs"
              />
              <button
                type="button"
                disabled={pasted.trim() === ''}
                onClick={loadPasted}
                className="btn sm self-start"
              >
                {t('file.pasteRead')}
              </button>
            </div>
          )}
        </Card>

        {source && columns.length > 0 && (
          <Card
            n={2}
            title={t('file.step2')}
            state={final ? 'ok' : null}
            summary={summary2}
            open={openCards[2]}
            onToggle={() => toggleCard(2)}
          >
            <div className="fields3">
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
              <CrsSelect id="crs-in" label={t('crs.input')} value={inputSel} onChange={setInputSel} t={t} />
              <CrsSelect
                id="crs-out"
                label={t('crs.output')}
                value={outputSel}
                onChange={setOutputSel}
                includeNone
                t={t}
              />

              {(inputSel === 'utm' || outputSel === 'utm') && (
                <div className="flex flex-wrap items-end gap-3">
                  <div className="field w-24">
                    <label htmlFor="utm-zone">{t('crs.utmZone')}</label>
                    <input
                      id="utm-zone"
                      type="number"
                      min="1"
                      max="60"
                      value={utmZone}
                      onChange={(e) => setUtmZone(e.target.value)}
                      className="txt"
                    />
                  </div>
                  <label className="flex items-center gap-2 pb-2 text-xs text-ink-2">
                    <input
                      type="checkbox"
                      checked={utmSouth}
                      onChange={(e) => setUtmSouth(e.target.checked)}
                      className="cb"
                    />
                    {t('crs.utmSouth')}
                  </label>
                </div>
              )}

              {(inputSel === 'custom' || outputSel === 'custom') && (
                <div className="field">
                  <label htmlFor="custom-proj4">{t('crs.customLabel')}</label>
                  <input
                    id="custom-proj4"
                    value={customProj4}
                    onChange={(e) => setCustomProj4(e.target.value)}
                    placeholder="+proj=utm +zone=33 +south +datum=WGS84 +units=m +no_defs"
                    className="txt font-mono text-xs"
                  />
                </div>
              )}
            </div>

            {inputCrs !== null && inputCrs.epsg !== null && crs.REGISTRY[String(inputCrs.epsg)]?.note && (
              <p className="notice">{crs.REGISTRY[String(inputCrs.epsg)].note}</p>
            )}

            <div className="opts">
              <span className="range">
                <span>{t('file.decimals')}</span>
                <input
                  type="range"
                  min="2"
                  max="8"
                  value={decimals}
                  onChange={(e) => setDecimals(Number(e.target.value))}
                  aria-label={t('file.decimals')}
                />
                <span className="v">{decimals}</span>
              </span>
              <label>
                <input
                  type="checkbox"
                  checked={addDms}
                  onChange={(e) => setAddDms(e.target.checked)}
                  className="cb"
                />
                <span>{t('file.addDms')}</span>
              </label>
              {signable > 0 && (
                <label className="text-review">
                  <input
                    type="checkbox"
                    checked={applyRegionSign}
                    onChange={(e) => setApplyRegionSign(e.target.checked)}
                    className="cb"
                  />
                  <span>{t('file.applyRegionSign', { n: signable, region })}</span>
                </label>
              )}
            </div>
          </Card>
        )}

        {/* Below both input cards, spanning the row, so a fold-away step
            cannot hide a thing that went wrong or a thing worth knowing. */}
        {error && <p role="alert" className="notice error">{error}</p>}
        {notice && <p className="notice">{notice}</p>}
      </aside>

      <div className="res">
        {!final || !detection ? (
          // Without a file the page is the drop zone and needs nothing under
          // it. With one, the result is a moment away and the space says so.
          source && (
            <div className="pane-empty" style={{ minHeight: '160px' }}>
              <b>{t('crs.converting')}</b>
            </div>
          )
        ) : (
          <>
            <Card
              n={3}
              title={t('file.step3')}
              state={reviewPending ? 'warn' : 'ok'}
              summary={summary3}
              open={openCards[3]}
              onToggle={() => toggleCard(3)}
            >
              {/* What goes in here has to *change* when the result changes, or a
                  screen reader is told nothing after the first load. It used to
                  say only the row count, which is the one number that does not
                  move when the column mapping or the coordinate system does -
                  the two settings most likely to be wrong. */}
              <p aria-live="polite" className={converting ? 'mb-2 text-xs text-ink-3' : 'sr-only'}>
                {converting
                  ? t('crs.converting')
                  : t('file.doneCounts', {
                    n: final.rows.length,
                    ok: okCount,
                    swap: pendingCount,
                    bad: badCount,
                  })}
              </p>

              <div className="readout">
                {STATUSES.map((s) => (
                  counts.get(s) ? (
                    <div key={s} className={`stat ${STATUS_TONE[s]}`}>
                      <div className="n">
                        {STATUS_MARK[s] && <span className="mk" aria-hidden="true">{STATUS_MARK[s].trim()}</span>}
                        {counts.get(s)}
                      </div>
                      <div className="l">{t(`file.status.${s}`)}</div>
                    </div>
                  ) : null
                ))}
                {summary && (
                  <dl className="sum">
                    <div><dt>{t('file.valid')}</dt><dd className="count">{summary.count}</dd></div>
                    <div><dt>{t('file.latRange')}</dt><dd>{summary.latMin} … {summary.latMax}</dd></div>
                    <div><dt>{t('file.lonRange')}</dt><dd>{summary.lonMin} … {summary.lonMax}</dd></div>
                    <div><dt>{t('file.centroid')}</dt><dd>{summary.latMean.toFixed(5)}, {summary.lonMean.toFixed(5)}</dd></div>
                  </dl>
                )}
              </div>

              {detection.detected.size > 0 && (
                <p className="notice">
                  {[...detection.detected].map(([name, n]) => (
                    name
                      ? t('file.outsideNamed', { n, region: name })
                      : t('file.outsideUnknown', { n })
                  )).join(' ')}
                </p>
              )}

              {suspects.length > 0 && (
                <div className={`rv ${reviewed ? 'resolved' : ''}`}>
                  <h3 className="rv-h">
                    <button
                      type="button"
                      aria-expanded={rvOpen}
                      aria-controls="rv-body"
                      onClick={() => { rvTouched.current = true; setRvOpen((v) => !v) }}
                    >
                      <span aria-hidden="true">{reviewed ? '✓' : '▲'}</span>
                      <span>{t('file.swapsFound', { n: suspects.length })}</span>
                      <span className="chosen">{t('file.swapChosen', { n: accepted.size })}</span>
                      <Chevron />
                    </button>
                  </h3>
                  <div className="rv-b" id="rv-body" hidden={!rvOpen}>
                    <p className="s">{t('file.swapsHint')}</p>
                    <div className="b">
                      <button
                        type="button"
                        onClick={() => answer(new Set(suspects.map((s) => s.i)))}
                        className="btn sm accent-line"
                      >
                        {t('file.swapAll')}
                      </button>
                      <button type="button" onClick={() => answer(new Set())} className="btn sm">
                        {t('file.swapNone')}
                      </button>
                      <span>{t('file.swapChosen', { n: accepted.size })}</span>
                    </div>
                    <ul>
                      {suspects.slice(0, 200).map(({ i, label }) => (
                        <li key={i}>
                          <input
                            type="checkbox"
                            id={`swap-${i}`}
                            checked={accepted.has(i)}
                            onChange={(e) => {
                              const next = new Set(accepted)
                              if (e.target.checked) next.add(i)
                              else next.delete(i)
                              answer(next)
                            }}
                            className="cb"
                          />
                          <label htmlFor={`swap-${i}`}>
                            {t('file.rowN', { n: i + 1 })}
                            {' · '}
                            {converted.lats[i]}, {converted.lons[i]}
                            {' → '}
                            <b>{converted.lons[i]}, {converted.lats[i]}</b>
                            {' · '}
                            <span className="st">{t(`file.status.${label}`)}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* The map is the instrument: a point that landed in Sudan is
                  obvious on it in a second and invisible in a column of numbers.
                  It takes the width of the pane; the table, which is the detail,
                  comes below it with every column in view. */}
              <div className="blk">
                <div className="cap">
                  <h3>{t('file.stepMap')}</h3>
                  <span className="legend"><i style={{ background: COLOR_OK }} />{t('map.legendOk')}</span>
                  <span className="legend"><i style={{ background: COLOR_SUSPECT }} />{t('map.legendSuspect')}</span>
                </div>
                {mapPoints.length > 0 ? (
                  <div className="map-well">
                    <PointsMap points={mapPoints} />
                  </div>
                ) : (
                  <div className="pane-empty" style={{ minHeight: '200px' }}>
                    <b>{t('map.nothingToShow')}</b>
                    <span>{t('map.emptyHint')}</span>
                  </div>
                )}
              </div>

              <div className="blk">
                <div className="cap">
                  <h3>{t('file.tableHeading')}</h3>
                  <span className="sub">
                    {final.rows.length > PREVIEW_ROWS
                      ? t('file.previewNote', { shown: PREVIEW_ROWS, total: final.rows.length })
                      : t('file.previewAll', { n: final.rows.length })}
                  </span>
                </div>
                <div className="tbl" tabIndex={0} role="region" aria-label={t('file.tableRegion')}>
                  <table>
                    <caption className="sr-only">
                      {t('file.tableCaption', { shown: Math.min(PREVIEW_ROWS, final.rows.length), total: final.rows.length })}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col" className="num">{t('file.rowHeader')}</th>
                        {final.columns.map((c, ci) => {
                          const out = !inputColumns.has(c)
                          const numeric = /_(DD|\d+)$|^(X|Y)_/.test(c) && !/WKT/.test(c)
                          return (
                            <th
                              key={c}
                              scope="col"
                              className={`${out ? 'out' : ''} ${numeric ? 'num' : ''} ${ci === firstOut ? 'first-out' : ''}`}
                            >
                              {c}
                            </th>
                          )
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {final.rows.slice(0, PREVIEW_ROWS).map((row, i) => (
                        <tr key={i} className={STATUS_TONE[displayLabels[i]] ?? ''}>
                          {/* The status was in the colour and nowhere else, so a
                              screen reader was told nothing and anyone who cannot
                              separate amber from green saw nothing either. The
                              mark carries it visually, the hidden text aloud. */}
                          <th scope="row">
                            <span aria-hidden="true">{STATUS_MARK[displayLabels[i]] ?? ''}</span>
                            {i + 1}
                            <span className="sr-only">
                              {', '}
                              {t(`file.rowStatus.${displayLabels[i]}`)}
                            </span>
                          </th>
                          {row.map((v, c) => {
                            const name = final.columns[c]
                            const out = !inputColumns.has(name)
                            const gms = /_GMS$/.test(name)
                            const numeric = out && !gms && !/WKT/.test(name)
                            return (
                              <td
                                key={c}
                                className={`${out ? 'out' : ''} ${numeric ? 'num' : ''} ${gms ? 'gms' : ''} ${c === firstOut ? 'first-out' : ''}`}
                              >
                                {out && numeric ? <Cell value={v} /> : (v === null || v === undefined ? '' : String(v))}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </Card>

            {/* Gated while the swap question is open: closed, marked, its
                summary is the question itself, and its buttons wait. Answering
                the question - either button, or a row's box - is what opens it. */}
            <Card
              n={4}
              title={t('file.step4')}
              state={reviewPending ? 'warn' : 'ok'}
              summary={summary4}
              open={openCards[4]}
              onToggle={() => toggleCard(4)}
              className={reviewPending ? 'gated' : ''}
            >
              {reviewPending && (
                <p className="gate"><span aria-hidden="true">▲</span>{t('file.swapsHint')}</p>
              )}
              <div className="dl">
                <DownloadButton
                  label="Excel"
                  hint={t('file.xlsxHint')}
                  file={`${baseName}_convertido.xlsx`}
                  primary
                  disabled={reviewPending}
                  onClick={async () => download(
                    await toExcelBytes(final),
                    `${baseName}_convertido.xlsx`,
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  )}
                />
                <DownloadButton
                  label="CSV"
                  hint={t('file.csvHint')}
                  file={`${baseName}_convertido.csv`}
                  disabled={reviewPending}
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
                  file={`${baseName}.geojson`}
                  disabled={reviewPending || exportable.features.length === 0}
                  onClick={() => download(
                    new TextEncoder().encode(toGeoJSON(exportable.features)),
                    `${baseName}.geojson`,
                    'application/geo+json',
                  )}
                />
                <DownloadButton
                  label="KML"
                  hint={t('file.kmlHint')}
                  file={`${baseName}.kml`}
                  disabled={reviewPending || exportable.features.length === 0}
                  onClick={() => download(
                    new TextEncoder().encode(toKML(exportable.features, exportable.fieldNames[0] ?? null)),
                    `${baseName}.kml`,
                    'application/vnd.google-earth.kml+xml',
                  )}
                />
                <DownloadButton
                  label="Shapefile"
                  hint={t('file.shpHint')}
                  file={`${baseName}_shapefile.zip`}
                  disabled={reviewPending || exportable.features.length === 0}
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
                  file={`${baseName}.gpx`}
                  disabled={reviewPending || exportable.features.length === 0}
                  onClick={() => download(
                    new TextEncoder().encode(toGpx(exportable.features, exportable.fieldNames[0] ?? null)),
                    `${baseName}.gpx`,
                    'application/gpx+xml',
                  )}
                />
              </div>
              <p className="note">{t('file.exportNote')}</p>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
