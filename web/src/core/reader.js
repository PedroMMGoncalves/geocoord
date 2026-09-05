/**
 * File reading for GeoCoord (JavaScript port).
 *
 * Mirrors `geocoord/reader.py`. The CSV half is covered by the shared parity
 * contract (`tests/fixtures/parity.json`, section "read_csv"): the same text
 * must produce the same table on both sides, once tidyTable has run.
 *
 * The output shape is the neutral `{ columns, rows }` the rest of the port
 * uses, with every cell a string - GeoCoord converts the coordinate columns
 * and carries the rest through, so inferring types would only lose leading
 * zeros and the digits of large integers, and would put pandas' inference
 * rules on the list of things the two implementations have to agree about.
 */
import Papa from 'papaparse'
import * as XLSX from 'xlsx'

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
  const seen = new Map()
  return cells.map((cell, i) => {
    const name = String(cell ?? '')
    if (name === '') return `Unnamed: ${i}`
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
  const { meta } = Papa.parse(sample, { delimitersToGuess: SEPARATORS })
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
  const { data } = Papa.parse(body, { delimiter, header: false, skipEmptyLines: false })

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
export function workbookSheets(bytes) {
  return XLSX.read(bytes, { type: 'array', bookSheets: true }).SheetNames
}

/**
 * Read one sheet of a workbook into the neutral table shape.
 *
 * `raw: false` with `defval: ''` asks SheetJS for the formatted text of each
 * cell rather than its underlying value, which is what keeps a date looking
 * like a date instead of arriving as a serial number, and keeps this side
 * producing strings like the CSV path does.
 */
export function readWorkbook(bytes, sheetName = null) {
  const book = XLSX.read(bytes, { type: 'array', cellDates: false })
  const name = sheetName ?? book.SheetNames[0]
  const sheet = book.Sheets[name]
  if (!sheet) return { columns: [], rows: [] }

  const grid = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: true,
  })
  while (grid.length > 0 && grid[grid.length - 1].every((c) => c === '')) grid.pop()
  if (grid.length === 0) return { columns: [], rows: [] }

  const width = Math.max(...grid.map((row) => row.length))
  const columns = headerNames(
    Array.from({ length: width }, (_, i) => grid[0][i] ?? ''),
  )
  const rows = grid.slice(1).map((row) => columns.map((_, i) => String(row[i] ?? '')))
  return { columns, rows }
}
