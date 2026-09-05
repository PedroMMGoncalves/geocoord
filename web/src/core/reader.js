/**
 * File reading for GeoCoord (JavaScript port).
 *
 * Mirrors `geocoord/reader.py`. The CSV half is covered by the shared parity
 * contract (`tests/fixtures/parity.json`, section "read_csv"): the same text
 * must produce the same table on both sides, once tidyTable has run.
 *
 * Where the two sides stop agreeing, stated plainly: on *malformed* CSV - an
 * unbalanced quote, or a quote character in a file whose real delimiter is not
 * the one guessed - Python's csv module and PapaParse disagree about where a
 * field ends, and no amount of care here changes that without reimplementing
 * one parser in the other language. A differential run over 2500 generated
 * files put it at 15 cases, every one carrying a stray quote. Well-formed
 * exports agree.
 *
 * The output shape is the neutral `{ columns, rows }` the rest of the port
 * uses, with every cell a string - GeoCoord converts the coordinate columns
 * and carries the rest through, so inferring types would only lose leading
 * zeros and the digits of large integers, and would put pandas' inference
 * rules on the list of things the two implementations have to agree about.
 */
import Papa from 'papaparse'

/**
 * SheetJS, loaded the first time a workbook actually turns up.
 *
 * It is 200 of the bundle's 216 kB gzipped - an order of magnitude more
 * than everything else on the page put together - and a good share of the
 * files that arrive here are CSV, which does not need a line of it. Behind a
 * dynamic import it becomes a second chunk that is fetched on demand, so the
 * page a CSV user waits for is small. The promise is kept so a second
 * workbook does not fetch it again.
 */
let sheetjs = null
function loadSheetJs() {
  if (sheetjs === null) sheetjs = import('xlsx')
  return sheetjs
}

// The separators the application offers, and the only ones worth guessing at.
export const SEPARATORS = [',', ';', '\t', '|']

// A byte-order mark is not whitespace to Python and would otherwise become
// part of the first column's name.
const BOM = '﻿'

/**
 * Column names the way pandas builds them from a header row.
 *
 * An empty cell becomes "Unnamed: N" and a repeat gains a ".1", ".2" suffix.
 * These are not cosmetic: tidyTable decides whether to promote the first row
 * by testing for exactly those names, so a reader that produced plain empty
 * strings would change how every messy export is read.
 */
export function headerNames(cells) {
  // The generated names go through the same disambiguation as the written
  // ones. A header cell can literally contain "Unnamed: 0" - that is what a
  // file exported by pandas and opened again looks like - and it would
  // otherwise collide with the name generated for an empty cell, leaving two
  // columns sharing a label.
  const raw = cells.map((cell, i) => {
    const name = String(cell ?? '')
    return name === '' ? `Unnamed: ${i}` : name
  })
  const seen = new Map()
  return raw.map((name) => {
    const count = seen.get(name) ?? 0
    seen.set(name, count + 1)
    return count === 0 ? name : `${name}.${count}`
  })
}

/**
 * The delimiter used by `text`, or a comma when there is nothing to detect.
 *
 * A file with a single column has no delimiter at all, and guessing one out of
 * the header is how pandas used to cut "lat" down to "la". Falling back to a
 * comma yields the one column the file actually has.
 */
export function sniffSeparator(text) {
  // The trailing newline has to go first. Papa counts a final empty line as a
  // row with one field, the delimiter counts stop being consistent across rows,
  // and it gives up with UndetectableDelimiter and falls back to a comma - so
  // "a;b\n1;2\n" would be read as one column while "a;b\n1;2" reads as two.
  const sample = text.slice(0, 8192).replace(/[\r\n]+$/, '')
  const { meta } = Papa.parse(sample, { delimitersToGuess: SEPARATORS, skipEmptyLines: true })
  return SEPARATORS.includes(meta.delimiter) ? meta.delimiter : ','
}

/**
 * Parse CSV text into the neutral table shape.
 *
 * `sep` of null means detect it. `decimal` is accepted to mirror the Python
 * signature and the option the interface offers, but has no effect on the
 * parse: every cell is read as text, and parseCoordinate understands both a
 * dot and a comma.
 */
export function readCsvText(text, { sep = null, decimal = '.' } = {}) {
  void decimal // documented above: kept for the mirrored signature

  let body = text
  if (body.startsWith(BOM)) body = body.slice(BOM.length)

  const delimiter = sep ?? sniffSeparator(body)
  // skipEmptyLines matches the Python side, where csv.reader yields nothing
  // for a line with no characters: an empty first line must not become the
  // header on one side and be skipped on the other.
  const { data } = Papa.parse(body, { delimiter, header: false, skipEmptyLines: true })

  // Papa keeps a trailing newline as one last empty row; pandas does not.
  while (data.length > 0 && data[data.length - 1].every((c) => c === '')) data.pop()
  if (data.length === 0) return { columns: [], rows: [] }

  const columns = headerNames(data[0])
  // Short rows are padded and long ones truncated, matching read_csv with
  // index_col=False: a stray extra field is dropped rather than promoted to a
  // row index, which would shift every label off its data.
  const rows = data.slice(1).map((row) => columns.map((_, i) => String(row[i] ?? '')))
  return { columns, rows }
}

/**
 * Decode `bytes` and parse, preferring utf-8 and falling back to windows-1252.
 *
 * Spreadsheet exports out of older Windows tooling are routinely latin1, and
 * failing on them would be worse than reading them slightly wrong. This is the
 * one part of reading the shared contract cannot cover: its inputs travel as
 * JSON strings, already decoded, so there is nothing left to recover from.
 */
export function readCsvBytes(bytes, options = {}) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return readCsvText(text, options)
  } catch {
    return readCsvText(new TextDecoder('windows-1252').decode(bytes), options)
  }
}

/**
 * The sheet names in a workbook, in book order.
 * Accepts the bytes of an .xlsx, .xls or any other format SheetJS reads.
 */
export async function workbookSheets(bytes) {
  const XLSX = await loadSheetJs()
  return XLSX.read(bytes, { type: 'array', bookSheets: true }).SheetNames
}

/**
 * The text of one cell, as GeoCoord wants to read it.
 *
 * SheetJS offers two views of a cell: the stored value `v` and the text `w`
 * that Excel would paint in the cell. Neither is right on its own.
 *
 * Taking `w` throughout - which is what `raw: false` does - reads a cell
 * through its display format, and that loses data twice over. A number of
 * twelve digits or more under the General format is painted in scientific
 * notation, so a lab number of 1234567890123456 arrives as "1.23457E+15" and
 * is gone. Worse for this application, a coordinate stored as 38.7083335 but
 * formatted to two decimals is painted "38.71", which is a different place on
 * the ground by two and a half kilometres, with nothing to say so.
 *
 * Taking `v` throughout loses the dates: a date is stored as the number of
 * days since 1900 and would arrive as 45358.
 *
 * So: dates by their displayed text, everything else by its stored value.
 * That is also what the desktop application sees, since openpyxl hands pandas
 * the underlying value.
 */
function cellText(cell) {
  if (cell === undefined || cell === null) return ''
  if (cell.t === 'd') return cell.w ?? String(cell.v)
  if (cell.v === undefined || cell.v === null) return ''
  if (cell.t === 'n') return String(cell.v)
  if (cell.t === 'b') return cell.w ?? (cell.v ? 'TRUE' : 'FALSE')
  return String(cell.v)
}

/**
 * Read one sheet of a workbook into the neutral table shape.
 *
 * The grid is walked cell by cell rather than through `sheet_to_json`, because
 * that helper only offers the all-`v` or all-`w` choice that cellText exists to
 * avoid.
 *
 * Asynchronous because SheetJS is fetched on demand; see loadSheetJs.
 */
export async function readWorkbook(bytes, sheetName = null) {
  const XLSX = await loadSheetJs()
  const book = XLSX.read(bytes, { type: 'array', cellDates: true, cellNF: true })
  const name = sheetName ?? book.SheetNames[0]
  const sheet = book.Sheets[name]
  if (!sheet || !sheet['!ref']) return { columns: [], rows: [] }

  const range = XLSX.utils.decode_range(sheet['!ref'])
  const grid = []
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const row = []
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      row.push(cellText(sheet[XLSX.utils.encode_cell({ r, c })]))
    }
    grid.push(row)
  }

  while (grid.length > 0 && grid[grid.length - 1].every((c) => c === '')) grid.pop()
  if (grid.length === 0) return { columns: [], rows: [] }

  const columns = headerNames(grid[0])
  const rows = grid.slice(1).map((row) => columns.map((_, i) => String(row[i] ?? '')))
  return { columns, rows }
}
