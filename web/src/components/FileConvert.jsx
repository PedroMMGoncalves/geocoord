import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PointsMap, { COLOR_FIXED, COLOR_OK, COLOR_SUSPECT } from './PointsMap.jsx'
import ResultTable from './ResultTable.jsx'
import SheetReview, { describeSheetRow } from './SheetReview.jsx'
import {
  KILOMETRE,
  detectSwaps,
  inRange,
  parseCoordinate,
  regionCheck,
  suggestRegion,
  tidyTable,
} from '../core/converter.js'
import {
  sanitizeFilename,
  toGeoJSON,
  toGpx,
  toKML,
  toShapefileZip,
} from '../core/geoexport.js'
import {
  REGION_MASKS,
  applySwaps,
  buildResult,
  countByStatus,
  featuresInRange,
  findAzoresRows,
  guessCoordinateColumns,
  pointsSummary,
  toCsv,
  toExcelBytes,
} from '../core/pipeline.js'
import * as crs from '../core/crs.js'
import { isGeospatial, readGeospatialBytes } from '../core/georead.js'
import {
  SHEET_SOURCE,
  checkSheets,
  guessLabelColumn,
  guessSheetColumns,
  militaryKm,
  sheet25Key,
  sheetsOfPoints,
} from '../core/sheets.js'
import {
  SEPARATORS,
  WARN_ROWS,
  readCsvBytes,
  readCsvText,
  readWorkbook,
  workbookSheets,
} from '../core/reader.js'
import { provenance, today } from '../core/provenance.js'
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
  // 1, or KILOMETRE once the reader has agreed that the values are kilometres.
  const [scale, setScale] = useState(1)
  const [accepted, setAccepted] = useState(() => new Set())

  // The sheet columns - '' for none - and whether the user has set them; until
  // then they follow the guess, which can only be made once there are
  // coordinates to agree with.
  const [col25, setCol25] = useState('')
  const [col50, setCol50] = useState('')
  const sheetTouched = useRef(false)
  // What names a point on the map and in the lists: one column, or two read
  // together ("Troia · AC 3").
  const [labelA, setLabelA] = useState('')
  const [labelB, setLabelB] = useState('')
  // The sheet corrections the user accepted, and whether they have answered.
  const [fixAccepted, setFixAccepted] = useState(() => new Set())
  const [fixReviewed, setFixReviewed] = useState(false)
  // Rows in the Azores' UTM grid inside a file in another system, whether to
  // read them as such, and in which of the islands' systems.
  const [azoresOn, setAzoresOn] = useState(false)
  const [azoresSystem, setAzoresSystem] = useState('')
  // The point chosen on the map, in the table or in a list, and where.
  const [selection, setSelection] = useState({ row: null, from: null })
  const select = useCallback((row, from) => setSelection({ row, from }), [])

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

  const crsNote = useCallback((epsg) => {
    const key = `crs.note.${epsg}`
    const shown = t(key)
    return shown === key ? crs.REGISTRY[String(epsg)].note : shown
  }, [t])

  const inputCrs = resolve(inputSel)
  const outputCrs = resolve(outputSel)
  const projectedInput = inputCrs !== null && inputCrs.kind === 'projected'

  // A region's display name. The key is the identifier - it is contract data -
  // and this is what the reader sees; a key with no entry falls back to itself,
  // so a new mask shows its own name rather than "region.Whatever".
  const regionLabel = useCallback((name) => {
    if (name === 'auto') return t('file.regionAuto')
    const key = `region.${name}`
    const shown = t(key)
    return shown === key ? name : shown
  }, [t])

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
   * What belongs to one file's work, and must not carry over to the next. A
   * re-read of the same file - another sheet, another separator - keeps the
   * column choices: they follow the columns, and are guessed again if those
   * change.
   */
  const resetWork = useCallback(({ keepColumns = false } = {}) => {
    if (!keepColumns) {
      setCol25('')
      setCol50('')
      sheetTouched.current = false
      setLabelA('')
      setLabelB('')
    }
    setFixAccepted(new Set())
    setFixReviewed(false)
    setAzoresOn(false)
    setAzoresSystem('')
    setSelection({ row: null, from: null })
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
    setScale(1)
    resetWork()
    setNotice(null)
    touched.current = new Set()
    setOpenCards({ 1: true, 2: true, 3: true, 4: true })
  }, [resetWork])

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
    setScale(1)
    resetWork()
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
    setScale(1)
    resetWork()
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
        setScale(1)
        resetWork({ keepColumns: true })
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
      projectedInput,
    )
    // The first selector is the latitude for a geographic system and the X -
    // the easting - for a projected one, so for a projected file the pair is
    // handed over the other way round.
    setLatCol(columns[projectedInput ? b : a])
    setLonCol(columns[projectedInput ? a : b])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnKey, projectedInput, region])

  // The column that names a point, guessed once per set of columns.
  useEffect(() => {
    if (columns.length === 0 || !source) return
    setLabelA(guessLabelColumn(columns, source.table.rows) ?? '')
    setLabelB('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnKey])

  // The Azores rows, read in their own system once the user has said so.
  const [azores, setAzores] = useState(null)
  const rowInput = azoresOn && azores && azoresSystem && crs.REGISTRY[azoresSystem]
    ? { rows: new Set(azores.rows), proj4: crs.REGISTRY[azoresSystem].proj4 }
    : null

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
      scale,
      rowInput,
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
  }, [source, latCol, lonCol, decimals, addDms, region, applyRegionSign, scale,
      inputCrs?.proj4, inputCrs?.kind, outputCrs?.proj4, outputCrs?.suffix,
      rowInput?.proj4, azores?.rows.join(',')])

  // Rows that are the Azores' UTM grid in a file in another system. Looked for
  // while they are still read as the file's own system; once converted as the
  // Azores they are no longer outside, and the finding must not vanish.
  useEffect(() => {
    if (!converted || azoresOn) return undefined
    let cancelled = false
    findAzoresRows(converted.inputXY, converted.lats, converted.lons,
      region === 'auto' ? null : REGION_MASKS[region]).then((found) => {
      if (cancelled) return
      setAzores(found)
      if (found) setAzoresSystem((s) => (found.systems.includes(s) ? s : found.system))
    })
    return () => { cancelled = true }
  }, [converted, azoresOn, region])

  // Every row in the military grid, in km: what the sheets are measured in.
  const [gridKm, setGridKm] = useState(null)
  useEffect(() => {
    if (!converted) {
      setGridKm(null)
      return undefined
    }
    let cancelled = false
    militaryKm(converted.lats, converted.lons).then((km) => { if (!cancelled) setGridKm(km) })
    return () => { cancelled = true }
  }, [converted])

  // The sheet columns follow the guess until the user picks them.
  useEffect(() => {
    if (!gridKm || !source || sheetTouched.current) return
    const found = guessSheetColumns(columns, source.table.rows, gridKm, [latCol, lonCol])
    setCol25(found.s25 ?? '')
    setCol50(found.s50 ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridKm])

  // The check itself, and where each proposed correction would put its point.
  const [sheetCheck, setSheetCheck] = useState(null)
  const [fixPositions, setFixPositions] = useState(() => new Map())
  useEffect(() => {
    if (!gridKm || !source || (!col25 && !col50) || !converted) {
      setSheetCheck(null)
      setFixPositions(new Map())
      return undefined
    }
    let cancelled = false
    const at25 = source.table.columns.indexOf(col25)
    const at50 = source.table.columns.indexOf(col50)
    const projected = projectedInput && converted.inputXY
    ;(async () => {
      const check = await checkSheets({
        km: gridKm,
        declared25: at25 >= 0 ? source.table.rows.map((r) => r[at25]) : null,
        declared50: at50 >= 0 ? source.table.rows.map((r) => r[at50]) : null,
        xy: projected ? converted.inputXY : null,
        inputProj4: projected ? inputCrs.proj4 : null,
        military: inputCrs?.epsg === 20790,
        cells: source.table.rows,
      })
      const withFix = check.map((c, i) => [c, i]).filter(([c]) => c.fix)
      const wgs = projected && withFix.length
        ? await crs.transformAll(withFix.map(([c]) => [c.fix.x, c.fix.y]), inputCrs.proj4, crs.WGS84_PROJ4)
        : []
      if (cancelled) return
      setSheetCheck(check)
      setFixPositions(new Map(withFix.map(([, i], k) => [i, [wgs[k][1], wgs[k][0]]])))
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridKm, col25, col50])

  // The corrections it is sure of, which are a question; and what only the
  // source can settle, which is not.
  const sheetFixes = useMemo(() => (sheetCheck ?? [])
    .map((c, i) => ({ ...c, i }))
    .filter((c) => c.status === 'off' && c.fix && c.confidence === 'alta'), [sheetCheck])
  const sheetChecks = useMemo(() => (sheetCheck ?? [])
    .map((c, i) => ({ ...c, i }))
    .filter((c) => c.status === 'off' && !(c.fix && c.confidence === 'alta')), [sheetCheck])
  const fixKey = sheetFixes.map((c) => c.i).join(',')
  useEffect(() => {
    setFixReviewed(false)
  }, [fixKey])
  const answerFixes = useCallback((next) => {
    setFixAccepted(next)
    setFixReviewed(true)
  }, [])

  // The result with the accepted corrections in it: a second build, so the
  // check keeps reading the file as written and its lists do not empty
  // themselves as they are answered.
  const rowFixes = useMemo(() => {
    const m = new Map()
    for (const c of sheetFixes) if (fixAccepted.has(c.i)) m.set(c.i, [c.fix.x, c.fix.y])
    return m
  }, [sheetFixes, fixAccepted])
  const [fixedBase, setFixedBase] = useState(null)
  useEffect(() => {
    if (!converted) {
      setFixedBase(null)
      return undefined
    }
    if (rowFixes.size === 0) {
      setFixedBase(converted)
      return undefined
    }
    let cancelled = false
    buildResult(source.table, latCol, lonCol, {
      decimals,
      addDms,
      input: inputCrs,
      output: outputCrs,
      regionMask: region === 'auto' ? null : REGION_MASKS[region],
      applyRegionSign,
      scale,
      rowInput,
      rowFixes,
    }).then((result) => { if (!cancelled) setFixedBase(result) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [converted, rowFixes])

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

  // Which region's sign would put this file somewhere, if the declared one
  // leaves it nowhere. The raw column values, not the converted ones: the
  // question is about the sign the file was written without.
  const suggestion = useMemo(() => {
    if (!source || !latCol || !lonCol || projectedInput) return null
    const li = source.table.columns.indexOf(latCol)
    const oi = source.table.columns.indexOf(lonCol)
    if (li < 0 || oi < 0) return null
    return suggestRegion(
      source.table.rows.map((r) => r[li]),
      source.table.rows.map((r) => r[oi]),
      REGION_MASKS,
      region === 'auto' ? null : region,
    )
  }, [source, latCol, lonCol, region, projectedInput])

  // The count survives the checkbox being unticked: buildResult reports how
  // many rows the region *could* sign either way, so the offer does not
  // vanish the moment it is declined.
  const signable = converted?.signable ?? 0

  // The rows the user has agreed to invert, applied. Asynchronous for the same
  // reason as the build: the second system has to be recomputed.
  const [final, setFinal] = useState(null)
  useEffect(() => {
    if (!fixedBase) {
      setFinal(null)
      return undefined
    }
    if (accepted.size === 0) {
      setFinal(fixedBase)
      return undefined
    }
    let cancelled = false
    applySwaps(fixedBase, accepted, { addDms }).then((r) => {
      if (!cancelled) setFinal(r)
    })
    return () => { cancelled = true }
  }, [fixedBase, accepted, addDms])

  // A row the sheet check has an answer for is its question, not the swap
  // review's: reversing latitude and longitude is not the fix for M and P
  // written the other way round, and asking both would ask twice.
  const sheetOwned = useMemo(() => new Set(
    (sheetCheck ?? []).map((c, i) => (c.fix || c.numberSuspect ? i : -1)).filter((i) => i >= 0),
  ), [sheetCheck])
  const suspects = useMemo(() => {
    if (!detection) return []
    return detection.labels
      .map((label, i) => ({ label, i }))
      .filter(({ label, i }) => (label === 'swap_range' || label === 'swap_cluster'
        || label === 'swap_axis') && !sheetOwned.has(i))
  }, [detection, sheetOwned])

  // The question is asked once per set of suspect rows. Changing the decimal
  // places rebuilds the result but not the rows in doubt, and an answer already
  // given must not be taken back for that.
  const suspectsKey = suspects.map((s) => s.i).join(',')
  useEffect(() => {
    setReviewed(false)
    setRvOpen(true)
    rvTouched.current = false
  }, [suspectsKey])
  const reviewPending = (suspects.length > 0 && !reviewed) || (sheetFixes.length > 0 && !fixReviewed)

  /** The three ways of answering, and what each does to the panel. */
  const answer = useCallback((next) => {
    setAccepted(next)
    setReviewed(true)
    if (!rvTouched.current) setRvOpen(false)
  }, [])

  // The cards follow the work, with one deliberate exception.
  //
  // 01 folds once there is a file: nobody picks the same file twice. 04 waits
  // for the swap question and opens when it is answered.
  //
  // 02 never folds on its own. It is not a step that completes - it is where
  // the work is tuned. The guessed column is wrong, the region is not the
  // default, the file is in metres, six decimals is too many: every one of
  // those is a return to 02, and it is the *first* thing anyone does after
  // reading the result. Folding it away put the controls most likely to be
  // needed behind a click, to save a strip of screen the page was not short
  // of. It still closes if the user closes it.
  const hasSource = source !== null
  useEffect(() => {
    if (!touched.current.has(1)) setOpen(1, !hasSource)
  }, [hasSource, setOpen])
  useEffect(() => {
    if (!touched.current.has(4)) setOpen(4, !reviewPending)
  }, [reviewPending, final, setOpen])

  // The status to show for a row, as opposed to the status detection gave it.
  // Detection runs on the data as it was read, so that unticking a row brings
  // its suggestion back; but once the user has accepted an inversion the row is
  // no longer pending review, and colouring it as suspect would say otherwise.
  const displayLabels = useMemo(() => {
    if (!detection) return []
    return detection.labels.map((label, i) => (accepted.has(i) || sheetOwned.has(i) ? 'ok' : label))
  }, [accepted, detection, sheetOwned])

  // A row's standing in the sheet check, for the table and the map: 'fix'
  // waiting for an answer, 'fixed' once accepted, 'check' for the source to
  // settle, 'azores' for island rows not yet read as such, or null.
  const azoresRows = useMemo(() => new Set(azores?.rows ?? []), [azores])
  const sheetState = useCallback((i) => {
    if (azoresRows.has(i) && !azoresOn) return 'azores'
    const c = sheetCheck?.[i]
    if (!c || c.status !== 'off') return null
    if (c.fix && c.confidence === 'alta') return fixAccepted.has(i) ? 'fixed' : 'fix'
    return 'check'
  }, [azoresRows, azoresOn, sheetCheck, fixAccepted])

  // Points outside the declared region, less the rows the sheet check or the
  // Azores offer already speaks for: two boxes saying the same thing about
  // the same rows is one box too many.
  const regionDetected = useMemo(() => {
    if (!detection || !converted) return new Map()
    const spoken = (i) => azoresRows.has(i) || sheetCheck?.[i]?.status === 'off'
    const labels = detection.labels.map((l, i) => (spoken(i) ? 'missing' : l))
    const mask = region === 'auto' ? null : REGION_MASKS[region]
    return regionCheck(converted.lats, converted.lons, labels, REGION_MASKS, { mask }).detected
  }, [detection, converted, azoresRows, sheetCheck, region])

  const needsReview = useCallback(
    (i) => (displayLabels[i] ?? 'ok') !== 'ok' || ['fix', 'check', 'azores'].includes(sheetState(i)),
    [displayLabels, sheetState],
  )

  // What a point is called: the label column, or two read together.
  const labelOf = useCallback((i) => {
    if (!source) return ''
    const at = [labelA, labelB].filter(Boolean).map((c) => source.table.columns.indexOf(c)).filter((c) => c >= 0)
    return at.map((c) => source.table.rows[i]?.[c]).filter((v) => v !== null && v !== undefined && v !== '')
      .map(String).join(' · ')
  }, [source, labelA, labelB])
  const counts = useMemo(() => countByStatus(displayLabels), [displayLabels])
  const summary = final
    ? pointsSummary(azoresRows.size && !azoresOn
      ? { ...final, lats: final.lats.map((v, i) => (azoresRows.has(i) ? null : v)), lons: final.lons.map((v, i) => (azoresRows.has(i) ? null : v)) }
      : final)
    : null
  const baseName = sanitizeFilename((source?.name ?? 'coordinates').replace(/\.[^.]+$/, ''), 'coordinates')


  // What to draw. A row flagged swap_range is drawn where it would be if the
  // columns were the other way round, which is the only place it could be: as
  // written it is not a point on Earth. Mirrors render_map in app.py.
  const mapPoints = useMemo(() => {
    if (!final || !detection) return []
    const out = []
    for (let i = 0; i < final.rows.length; i += 1) {
      const lat = final.lats[i]
      const lon = final.lons[i]
      // Azores rows not yet read as such are not points anywhere: read as
      // the mainland's grid they are in the Arctic.
      if (sheetState(i) === 'azores') continue
      const fixed = sheetState(i) === 'fixed'
      const name = labelOf(i)
      if (inRange(lat, 'lat') && inRange(lon, 'lon')) {
        out.push({ lat, lon, row: i, label: name, fixed, suspect: needsReview(i) })
      } else if (inRange(lon, 'lat') && inRange(lat, 'lon')) {
        out.push({ lat: lon, lon: lat, row: i, label: name, fixed, suspect: true })
      }
    }
    return out
  }, [final, detection, sheetState, needsReview, labelOf])

  // Where the chosen row's proposed correction would put it, while unanswered.
  const preview = useMemo(() => {
    const i = selection.row
    if (i === null || !fixPositions.has(i) || sheetState(i) === 'fixed') return null
    return { to: fixPositions.get(i) }
  }, [selection.row, fixPositions, sheetState])

  // Which columns the pipeline added, as opposed to the file's own. They get
  // the accent rule in the header and the split cells, because they are what
  // the file was brought here for.
  const inputColumns = useMemo(() => new Set(source?.table.columns ?? []), [source])

  const describe = useCallback((c) => describeSheetRow(t, c, {
    cols: [latCol, lonCol],
    scale: projectedInput ? scale : 1,
    xy: converted?.inputXY?.[c.i] ?? null,
  }), [t, latCol, lonCol, projectedInput, scale, converted])

  /** The verdict written to the file: a word for the clean rows, a sentence for the rest. */
  const verdict = useCallback((i) => {
    const c = sheetCheck?.[i]
    if (azoresRows.has(i)) return azoresOn ? t('sheet.verdictAzores', { system: azoresSystem }) : t('sheet.verdictAzoresPending')
    if (!c || c.status === 'unknown' || c.status === 'none') return ''
    if (c.status === 'ok') return t('sheet.verdictOk')
    const d = describe({ ...c, i })
    const what = d.from !== undefined ? `${d.what}: ${d.from} → ${d.to}` : d.what
    if (sheetState(i) === 'fixed') return t('sheet.verdictFixed', { what })
    if (sheetState(i) === 'fix') return t('sheet.verdictNotFixed', { what })
    return t('sheet.verdictCheck', { what })
  }, [sheetCheck, azoresRows, azoresOn, azoresSystem, t, describe, sheetState])

  // The sheets each final point is in - after the swaps and corrections
  // accepted - for every file, sheet column or not. Kept with the result it
  // was measured on, so a newer result never shows an older one's sheets.
  const [finalSheets, setFinalSheets] = useState(null)
  useEffect(() => {
    if (!final) {
      setFinalSheets(null)
      return undefined
    }
    let cancelled = false
    const at = final.exact ?? final
    militaryKm(at.lats, at.lons).then((km) => {
      if (!cancelled) setFinalSheets({ of: final, sheets: sheetsOfPoints(km) })
    })
    return () => { cancelled = true }
  }, [final])

  // The table shown and written: the result, plus the sheets each point is
  // in, plus the check's verdict when there is a sheet column to check against.
  const output = useMemo(() => {
    if (!final) return null
    const sheets = finalSheets?.of === final ? finalSheets.sheets : null
    let { columns, rows } = final
    if (sheets) {
      columns = [...columns, 'Folha_25k', 'Folha_50k', 'Nome_50k']
      rows = rows.map((row, i) => [...row, ...sheets[i]])
    }
    if (sheetCheck) {
      columns = [...columns, 'Verificacao_folha']
      rows = rows.map((row, i) => [...row, verdict(i)])
    }
    return { ...final, columns, rows }
  }, [final, finalSheets, sheetCheck, verdict])

  const exportable = useMemo(() => {
    if (!output) return null
    const { features, fieldNames } = featuresInRange(output)
    return { features, fieldNames }
  }, [output])

  // What each download records about where it came from (core/provenance.js),
  // built at the moment of the download, so the date is the file's own.
  const metadata = useCallback(() => {
    const island = rowInput ? crs.REGISTRY[azoresSystem] : null
    return provenance(t, {
      version: import.meta.env.APP_VERSION,
      date: today(),
      fileName: source?.name ?? '',
      sheet: sheets.length > 1 ? sheet : null,
      input: inputCrs,
      output: outputCrs,
      scale: projectedInput ? scale : 1,
      swaps: accepted.size,
      sheetFixes: rowFixes.size,
      azores: island ? { count: rowInput.rows.size, system: { label: island.pt, epsg: island.epsg } } : null,
    })
  }, [t, source, sheets, sheet, inputCrs, outputCrs, projectedInput, scale, accepted, rowFixes,
    rowInput, azoresSystem])

  // The popup for a point: what it is, where its file says it is, where it is.
  const details = useCallback((i) => {
    const c = sheetCheck?.[i]
    const xy = converted?.inputXY?.[i]
    const state = sheetState(i)
    const rows = []
    if (c?.declared25) rows.push([t('sheet.pp25'), c.declared25])
    if (c?.declared50 || c?.at50) rows.push([t('sheet.pp50'), [c.declared50, c.at50name].filter(Boolean).join(' · ') || c.at50])
    if (source) {
      const xi = source.table.columns.indexOf(latCol)
      const yi = source.table.columns.indexOf(lonCol)
      rows.push([t('sheet.ppFile'), `${latCol} ${source.table.rows[i]?.[xi] ?? ''} · ${lonCol} ${source.table.rows[i]?.[yi] ?? ''}`])
    }
    if (state === 'fixed' && c?.fix && xy) {
      const s = projectedInput ? scale : 1
      rows.push([t('sheet.ppFixed'), `${latCol} ${Number((c.fix.x / s).toFixed(3))} · ${lonCol} ${Number((c.fix.y / s).toFixed(3))}`])
    }
    if (final) rows.push([t('sheet.ppConverted'), `${final.lats[i] ?? '—'}, ${final.lons[i] ?? '—'}`])
    let status = null
    if (state === 'azores') status = { text: t('sheet.ppAzores'), tone: 'bad' }
    else if (state === 'fixed') status = { text: t('sheet.ppFixedNow', { what: describe({ ...c, i }).what, sheet: c.declared25 ?? c.declared50 }), tone: 'ok' }
    else if (state === 'fix' || state === 'check') {
      const d = describe({ ...c, i })
      status = { text: `▲ ${d.what}${d.from !== undefined ? `: ${d.from} → ${d.to}` : ''}`, tone: 'bad' }
    } else if (c?.status === 'ok') status = { text: t('sheet.ppOk', { sheet: c.declared25 ?? c.declared50 }), tone: 'ok' }
    else if ((displayLabels[i] ?? 'ok') !== 'ok') status = { text: t(`file.status.${displayLabels[i]}`), tone: 'bad' }
    return {
      title: labelOf(i) || t('file.rowN', { n: i + 1 }),
      sub: labelOf(i) ? t('file.rowN', { n: i + 1 }) : '',
      rows,
      status,
    }
  }, [sheetCheck, converted, sheetState, t, source, latCol, lonCol, projectedInput, scale, final,
      describe, displayLabels, labelOf])

  const tableTone = useCallback((i) => {
    const s = sheetState(i)
    if (s === 'fix' || s === 'check' || s === 'azores') return 'review'
    return STATUS_TONE[displayLabels[i]] ?? ''
  }, [sheetState, displayLabels])
  const tableMark = useCallback((i) => {
    const s = sheetState(i)
    if (s === 'fix' || s === 'azores') return '▲ '
    if (s === 'check') return '? '
    if (s === 'fixed') return '✓ '
    return STATUS_MARK[displayLabels[i]] ?? ''
  }, [sheetState, displayLabels])
  const tableStatus = useCallback((i) => {
    const s = sheetState(i)
    if (s) return t(`sheet.rowStatus.${s}`)
    return t(`file.rowStatus.${displayLabels[i] ?? 'ok'}`)
  }, [sheetState, displayLabels, t])
  // The sheet filter: by the sheet the file names when it names one, and
  // otherwise by the sheet each point is in.
  const tableSheets = useMemo(() => {
    if (sheetCheck) return sheetCheck.map((c) => c.declared25 ?? null)
    const sheets = finalSheets?.of === final ? finalSheets.sheets : null
    return sheets ? sheets.map(([s25]) => s25 || null) : null
  }, [sheetCheck, finalSheets, final])

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) loadFile(file)
  }

  const okCount = counts.get('ok') ?? 0
  const badCount = (counts.get('out_of_range') ?? 0) + (counts.get('missing') ?? 0)
  const pendingCount = suspects.filter(({ i }) => !accepted.has(i)).length
    + sheetFixes.filter((c) => !fixAccepted.has(c.i)).length
  const sheetOk = sheetCheck ? sheetCheck.filter((c) => c.status === 'ok').length : 0

  // The summaries the closed cards show.
  const summary1 = source
    ? t('file.loaded', { name: source.name, n: source.table.rows.length, cols: columns.length })
    : null
  const summary2 = source && latCol && lonCol
    ? [
      `${latCol} / ${lonCol}`,
      regionLabel(region),
      inputCrs ? `${inputCrs.label}${inputCrs.epsg ? ` — EPSG:${inputCrs.epsg}` : ''}` : null,
      outputCrs ? `+ ${outputCrs.label}` : null,
      col25 || col50 ? t('sheet.summary', { cols: [col25, col50].filter(Boolean).join(' / ') }) : null,
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
  // What the downloads are waiting for, in the words of the question.
  const gateText = sheetFixes.length > 0 && !fixReviewed ? t('sheet.gateHint') : t('file.swapsHint')
  const summary4 = reviewPending
    ? <span className="m-review">{gateText}</span>
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
                {Object.keys(REGION_MASKS).map((r) => (
                  <option key={r} value={r}>{regionLabel(r)}</option>
                ))}
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
              <p className="notice">{crsNote(inputCrs.epsg)}</p>
            )}

            <div className="fields3 sheet-fields">
              <Select id="col-25" label={t('sheet.col25')} value={col25}
                      onChange={(v) => { sheetTouched.current = true; setCol25(v) }}>
                <option value="">{t('sheet.colNone')}</option>
                {columns.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
              <Select id="col-50" label={t('sheet.col50')} value={col50}
                      onChange={(v) => { sheetTouched.current = true; setCol50(v) }}>
                <option value="">{t('sheet.colNone')}</option>
                {columns.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
              <div className="field">
                <label htmlFor="label-a">{t('sheet.labelCols')}</label>
                <div className="two">
                  <select id="label-a" className="sel" value={labelA} onChange={(e) => setLabelA(e.target.value)}>
                    <option value="">{t('sheet.labelNone')}</option>
                    {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <span aria-hidden="true">+</span>
                  <select id="label-b" className="sel" value={labelB} aria-label={t('sheet.labelSecond')}
                          onChange={(e) => setLabelB(e.target.value)}>
                    <option value="">{t('sheet.labelNone')}</option>
                    {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
            </div>
            {(col25 || col50) && <p className="src">{t('sheet.source', { source: SHEET_SOURCE })}</p>}

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
                  <span>{t('file.applyRegionSign', { n: signable, region: regionLabel(region) })}</span>
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
                {sheetCheck && (
                  <>
                    <div className="stat">
                      <div className="n">{sheetOk}</div>
                      <div className="l">{t('sheet.statOk')}</div>
                    </div>
                    {sheetFixes.length > 0 && (fixReviewed ? (
                      <div className="stat">
                        <div className="n"><span className="mk" aria-hidden="true">✓</span>{rowFixes.size}</div>
                        <div className="l">{t('sheet.statFixed')}</div>
                      </div>
                    ) : (
                      <div className="stat review">
                        <div className="n"><span className="mk" aria-hidden="true">▲</span>{sheetFixes.length}</div>
                        <div className="l">{t('sheet.statFix')}</div>
                      </div>
                    ))}
                    {sheetChecks.length > 0 && (
                      <div className="stat">
                        <div className="n"><span className="mk" aria-hidden="true">?</span>{sheetChecks.length}</div>
                        <div className="l">{t('sheet.statCheck')}</div>
                      </div>
                    )}
                  </>
                )}
                {summary && (
                  <dl className="sum">
                    <div><dt>{t('file.valid')}</dt><dd className="count">{summary.count}</dd></div>
                    <div><dt>{t('file.latRange')}</dt><dd>{summary.latMin} … {summary.latMax}</dd></div>
                    <div><dt>{t('file.lonRange')}</dt><dd>{summary.lonMin} … {summary.lonMax}</dd></div>
                    <div><dt>{t('file.centroid')}</dt><dd>{summary.latMean.toFixed(5)}, {summary.lonMean.toFixed(5)}</dd></div>
                  </dl>
                )}
              </div>

              {/* The unnamed entry - points in no known region at all - is the
                  one the suggestion below is about, so it is dropped when
                  there is a suggestion rather than said twice in two stacked
                  boxes. Entries naming another region stay: they are a
                  different fact.

                  The kilometre offer counts as a suggestion here for the same
                  reason: driving the page showed the two stacked, the first
                  saying twelve coordinates are nowhere known and the second
                  saying what would put them somewhere. */}
              {(() => {
                const chosenName = regionLabel(region)
                const entries = [...regionDetected]
                  .filter(([name]) => name !== null
                    || (suggestion === null && !converted?.scaleSuggestion))
                if (entries.length === 0) return null
                return (
                  <p className="notice">
                    {entries.map(([name, n]) => (
                      name
                        ? t('file.outsideNamed', { n, region: regionLabel(name), chosen: chosenName })
                        : t('file.outsideUnknown', { n, chosen: chosenName })
                    )).join(' ')}
                  </p>
                )
              })()}

              {/* The application cannot tell a Moçambique file from a Sudan
                  one - both are unsigned magnitudes near 15 N - so it does not
                  try. It says what one sign flip would do and leaves the
                  answer where it belongs. */}
              {suggestion && (
                <div className="notice">
                  <p className="m-0">
                    {t('file.suggestRegion', { chosen: regionLabel(region) })}
                  </p>
                  <p className="mt-1">
                    {t(
                      // Every record fitting is the common case and reads
                      // better without the fraction; the guard allows a fifth
                      // of them not to, and then the fraction is the fact.
                      suggestion.inside === suggestion.readable
                        ? 'file.suggestRegionFit'
                        : 'file.suggestRegionFitSome',
                      {
                        region: regionLabel(suggestion.region),
                        inside: suggestion.inside,
                        readable: suggestion.readable,
                      },
                    )}
                  </p>
                  <button
                    type="button"
                    className="btn sm accent-line mt-2"
                    onClick={() => setRegion(suggestion.region)}
                  >
                    {t('file.suggestRegionUse', { region: regionLabel(suggestion.region) })}
                  </button>
                </div>
              )}

              {/* The same shape as the region offer above, and mutually
                  exclusive with it: that one is about a missing sign in a
                  geographic file, this one about the unit of a projected one.
                  A file cannot be both. */}
              {converted?.scaleSuggestion && (
                <div className="notice">
                  <p className="m-0">
                    {t('file.suggestRegion', { chosen: regionLabel(region) })}
                  </p>
                  <p className="mt-1">
                    {t(
                      converted.scaleSuggestion.inside === converted.scaleSuggestion.readable
                        ? 'file.suggestScaleFit'
                        : 'file.suggestScaleFitSome',
                      {
                        inside: converted.scaleSuggestion.inside,
                        readable: converted.scaleSuggestion.readable,
                      },
                    )}
                  </p>
                  <button
                    type="button"
                    className="btn sm accent-line mt-2"
                    onClick={() => setScale(KILOMETRE)}
                  >
                    {t('file.suggestScaleUse')}
                  </button>
                </div>
              )}

              {scale !== 1 && (
                <div className="notice">
                  <p className="m-0">{t('file.scaleOn')}</p>
                  <button
                    type="button"
                    className="btn sm mt-2"
                    onClick={() => setScale(1)}
                  >
                    {t('file.scaleOff')}
                  </button>
                </div>
              )}

              {azores && (
                <div className="notice">
                  <p className="m-0">
                    {azoresOn
                      ? t('sheet.azoresDone', { n: azores.rows.length, system: crs.REGISTRY[azoresSystem]?.pt ?? azoresSystem })
                      : t('sheet.azoresFound', {
                        n: azores.rows.length,
                        rows: azores.rows.length > 3
                          ? `${azores.rows[0] + 1}…${azores.rows[azores.rows.length - 1] + 1}`
                          : azores.rows.map((i) => i + 1).join(', '),
                      })}
                  </p>
                  <div className="row-actions">
                    <button type="button" className={`btn sm ${azoresOn ? '' : 'accent-line'}`}
                            onClick={() => setAzoresOn((v) => !v)}>
                      {azoresOn ? t('sheet.azoresUndo') : t('sheet.azoresUse', { n: azores.rows.length })}
                    </button>
                    <select className="sel sm" value={azoresSystem} aria-label={t('sheet.azoresSystem')}
                            onChange={(e) => setAzoresSystem(e.target.value)}>
                      {azores.systems.map((code) => (
                        <option key={code} value={code}>{crs.REGISTRY[code]?.pt} — EPSG:{code}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <SheetReview
                fixes={sheetFixes}
                checks={sheetChecks}
                accepted={fixAccepted}
                reviewed={fixReviewed}
                onAnswer={answerFixes}
                onPick={(i) => select(i, 'list')}
                selected={selection.row}
                labelOf={labelOf}
                describe={describe}
              />

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
                  {sheetFixes.length > 0 && (
                    <span className="legend"><i className="hollow" style={{ borderColor: COLOR_FIXED }} />{t('map.legendFixed')}</span>
                  )}
                  <span className="sub">{t('map.hint')}</span>
                </div>
                {mapPoints.length > 0 ? (
                  <div className="map-well">
                    <PointsMap
                      points={mapPoints}
                      selected={selection.row}
                      selectedFrom={selection.from}
                      onSelect={select}
                      preview={preview}
                      details={details}
                    />
                  </div>
                ) : (
                  <div className="pane-empty" style={{ minHeight: '200px' }}>
                    <b>{t('map.nothingToShow')}</b>
                    <span>{t('map.emptyHint')}</span>
                  </div>
                )}
              </div>

              <ResultTable
                columns={output.columns}
                rows={output.rows}
                inputColumns={inputColumns}
                tone={tableTone}
                mark={tableMark}
                statusText={tableStatus}
                needsReview={needsReview}
                sheets={tableSheets}
                selected={selection.row}
                selectedFrom={selection.from}
                onSelect={select}
                resetKey={`${source.name}|${columnKey}`}
              />
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
                <p className="gate"><span aria-hidden="true">▲</span>{gateText}</p>
              )}
              <div className="dl">
                <DownloadButton
                  label="Excel"
                  hint={t('file.xlsxHint')}
                  file={`${baseName}_convertido.xlsx`}
                  primary
                  disabled={reviewPending}
                  onClick={async () => download(
                    await toExcelBytes(output, metadata()),
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
                    new TextEncoder().encode(`﻿${toCsv(output)}`),
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
                    new TextEncoder().encode(toGeoJSON(exportable.features, metadata())),
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
                    new TextEncoder().encode(toKML(exportable.features, exportable.fieldNames[0] ?? null, metadata())),
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
                      crs.esriWkt(crs.WGS84).wkt, metadata()),
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
                    new TextEncoder().encode(toGpx(exportable.features, exportable.fieldNames[0] ?? null, metadata())),
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
