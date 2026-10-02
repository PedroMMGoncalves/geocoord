import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useT } from '../i18n.jsx'

/**
 * Every row of the result, in one scroll.
 *
 * The table used to stop at fifty rows, because fifty thousand rows of DOM is
 * what takes a browser tab down. It no longer has to: only the rows in view are
 * drawn - about forty - with empty space above and below standing in for the
 * rest, so a file of any size scrolls whole. That is what lets a point clicked
 * on the map be shown in the table, wherever it is.
 *
 * Search keeps the rows with the text anywhere in them; the filters keep the
 * rows that need looking at, or one sheet's. The line number in the first
 * column is always the line in the file, never the position in the view.
 */

// Drawn above and below the rows in view, so a fast scroll does not show gaps.
const OVERSCAN = 10
// Before the table has a height to measure - in a test, or the first frame -
// this many rows are drawn.
const FALLBACK_ROWS = 60

/**
 * A converted value, its integer part bright and its fraction dimmer, so a
 * column of decimals lines up and the eye lands on the degrees before the
 * millionths. Anything that is not a plain decimal is left alone.
 */
export function Cell({ value }) {
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

/**
 * columns, rows: the table to show. `inputColumns`: the file's own columns;
 * the rest are the ones this application added. `tone(i)`, `mark(i)`,
 * `statusText(i)`: a row's colour, its visible mark and what a screen reader
 * hears. `needsReview(i)`: whether the "to review" filter keeps it.
 * `sheets`: the 1:25 000 sheet per row when there is a sheet column, for the
 * sheet filter. `selected`/`onSelect`: the chosen row, shared with the map.
 * `resetKey`: changes with the file, and clears the search and the filters.
 */
export default function ResultTable({
  columns, rows, inputColumns, tone, mark, statusText, needsReview,
  sheets = null, selected = null, selectedFrom = null, onSelect = null, resetKey = null,
}) {
  const t = useT()
  const [query, setQuery] = useState('')
  const [onlyReview, setOnlyReview] = useState(false)
  const [sheet, setSheet] = useState('')
  const [range, setRange] = useState([0, FALLBACK_ROWS])
  const boxRef = useRef(null)
  const rowHeight = useRef(31)

  useEffect(() => {
    setQuery('')
    setOnlyReview(false)
    setSheet('')
    if (boxRef.current) boxRef.current.scrollTop = 0
  }, [resetKey])

  const reviewCount = useMemo(
    () => rows.reduce((n, _, i) => n + (needsReview(i) ? 1 : 0), 0),
    [rows, needsReview],
  )
  const sheetOptions = useMemo(() => {
    if (!sheets) return []
    return [...new Set(sheets.filter(Boolean))]
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b))
  }, [sheets])

  // The rows in the view, as original indices.
  const view = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out = []
    for (let i = 0; i < rows.length; i += 1) {
      if (onlyReview && !needsReview(i)) continue
      if (sheet && sheets?.[i] !== sheet) continue
      if (q) {
        const text = `${i + 1} ${rows[i].map((v) => (v === null || v === undefined ? '' : String(v))).join(' ')}`
        if (!text.toLowerCase().includes(q)) continue
      }
      out.push(i)
    }
    return out
  }, [rows, query, onlyReview, sheet, sheets, needsReview])

  // Which slice of the view to draw, from the scroll position.
  const measure = () => {
    const box = boxRef.current
    if (!box) return
    const first = box.querySelector('tbody tr[data-row]')
    if (first && first.offsetHeight > 0) rowHeight.current = first.offsetHeight
    const h = box.clientHeight
    if (!h) {
      setRange([0, FALLBACK_ROWS])
      return
    }
    const top = Math.max(0, box.scrollTop - 34) // the sticky header
    const from = Math.max(0, Math.floor(top / rowHeight.current) - OVERSCAN)
    const to = Math.ceil((top + h) / rowHeight.current) + OVERSCAN
    setRange((r) => (r[0] === from && r[1] === to ? r : [from, to]))
  }
  useLayoutEffect(measure, [view])

  // A row chosen elsewhere - on the map, in a review list - is brought into
  // view. If the filters hide it, they give way: the user asked to see it.
  useEffect(() => {
    if (selected === null || selectedFrom === 'table') return
    let at = view.indexOf(selected)
    if (at < 0) {
      setQuery('')
      setOnlyReview(false)
      setSheet('')
      at = selected
    }
    const box = boxRef.current
    if (box) {
      box.scrollTop = Math.max(0, at * rowHeight.current - box.clientHeight / 2 + rowHeight.current)
      measure()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, selectedFrom])

  const firstOut = columns.findIndex((c) => !inputColumns.has(c))
  const [from, to] = range
  const drawn = view.slice(from, Math.min(to, view.length))
  const above = from * rowHeight.current
  const below = Math.max(0, (view.length - from - drawn.length) * rowHeight.current)

  return (
    <div className="blk">
      <div className="cap">
        <h3>{t('file.tableHeading')}</h3>
        <span className="sub">{t('file.tableAll')}</span>
      </div>
      <div className="tools">
        <input
          type="search"
          className="txt search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('file.searchPlaceholder')}
          aria-label={t('file.searchLabel')}
        />
        <div className="chips" role="group" aria-label={t('file.filterLabel')}>
          <button type="button" className={`chip ${onlyReview ? '' : 'on'}`} aria-pressed={!onlyReview}
                  onClick={() => setOnlyReview(false)}>
            {t('file.filterAll')}
          </button>
          {(reviewCount > 0 || onlyReview) && (
            <button type="button" className={`chip ${onlyReview ? 'on' : ''}`} aria-pressed={onlyReview}
                    onClick={() => setOnlyReview(true)}>
              {t('file.filterReview', { n: reviewCount })}
            </button>
          )}
        </div>
        {sheetOptions.length > 1 && (
          <select className="sel sm" value={sheet} onChange={(e) => setSheet(e.target.value)}
                  aria-label={t('file.filterSheetLabel')}>
            <option value="">{t('file.filterSheetAll')}</option>
            {sheetOptions.map((s) => <option key={s} value={s}>{t('file.filterSheetOne', { sheet: s })}</option>)}
          </select>
        )}
        <span className="count">{t('file.rowsOf', { n: view.length, total: rows.length })}</span>
      </div>
      <div className="tbl vt" ref={boxRef} onScroll={measure} tabIndex={0} role="region"
           aria-label={t('file.tableRegion')}>
        <table>
          <caption className="sr-only">{t('file.tableCaption', { shown: view.length, total: rows.length })}</caption>
          <thead>
            <tr>
              <th scope="col" className="num">{t('file.rowHeader')}</th>
              {columns.map((c, ci) => {
                const out = !inputColumns.has(c)
                const numeric = /_(DD|\d+)$|^(X|Y)_/.test(c) && !/WKT/.test(c)
                return (
                  <th key={c} scope="col"
                      className={`${out ? 'out' : ''} ${numeric ? 'num' : ''} ${ci === firstOut ? 'first-out' : ''}`}>
                    {c}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {above > 0 && <tr className="pad" aria-hidden="true" style={{ height: above }}><td colSpan={columns.length + 1} /></tr>}
            {drawn.map((i) => (
              <tr key={i} data-row={i}
                  className={`${tone(i)} ${i === selected ? 'is-sel' : ''}`}
                  aria-selected={i === selected}
                  onClick={onSelect ? () => onSelect(i, 'table') : undefined}>
                {/* The status was in the colour and nowhere else, so a screen
                    reader was told nothing and anyone who cannot separate amber
                    from green saw nothing either. The mark carries it visually,
                    the hidden text aloud. */}
                <th scope="row">
                  <span aria-hidden="true">{mark(i)}</span>
                  {i + 1}
                  <span className="sr-only">{', '}{statusText(i)}</span>
                </th>
                {rows[i].map((v, c) => {
                  const name = columns[c]
                  const out = !inputColumns.has(name)
                  const gms = /_GMS$/.test(name)
                  const numeric = out && !gms && !/WKT|Folha|Verificacao/.test(name)
                  return (
                    <td key={c}
                        className={`${out ? 'out' : ''} ${numeric ? 'num' : ''} ${gms ? 'gms' : ''} ${c === firstOut ? 'first-out' : ''}`}>
                      {out && numeric ? <Cell value={v} /> : (v === null || v === undefined ? '' : String(v))}
                    </td>
                  )
                })}
              </tr>
            ))}
            {below > 0 && <tr className="pad" aria-hidden="true" style={{ height: below }}><td colSpan={columns.length + 1} /></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
