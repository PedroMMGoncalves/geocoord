import { useT } from '../i18n.jsx'

/**
 * What the sheet check found, in two lists.
 *
 * The first holds the corrections it is sure of - the two coordinates written
 * the other way round, the false origin left off - and it is a question: the
 * downloads wait for an answer, as they do for a swap, because a file with a
 * point a hundred kilometres from its sheet is not one to hand over unnoticed.
 * Nothing is changed until the user says so.
 *
 * The second holds what only the source can settle - one digit that would put
 * the point back, a sheet number the row's own name contradicts, a point just
 * outside its sheet - and it does not hold anything up. Clicking a row in
 * either list shows it on the map.
 */

/** A value as the file wrote it: back from metres to the file's own unit. */
function written(v, scale) {
  if (v === null || v === undefined) return ''
  return String(Number((v / scale).toFixed(3)))
}

/**
 * The sentence for one row. `cols` names the two coordinate columns, so the
 * message says "M e P trocados" for a file whose columns are M and P.
 */
export function describeSheetRow(t, c, { cols, scale, xy }) {
  const [x, y] = xy ?? [null, null]
  const pair = (a, b) => `(${written(a, scale)}, ${written(b, scale)})`
  const where = c.at25
    ? t('sheet.at', { sheet: c.at25, s50: c.at50 ?? '—', name: c.at50name ?? '' })
    : t('sheet.atNone')
  if (c.fix && (c.fix.kind === 'swap' || c.fix.kind === 'origin')) {
    const what = t(`sheet.fix.${c.fix.label}`, { x: cols[0], y: cols[1] })
    return { what, from: pair(x, y), to: pair(c.fix.x, c.fix.y) }
  }
  if (c.fix && c.fix.kind === 'digit') {
    const axis = c.fix.label === 'm' ? cols[0] : cols[1]
    const before = c.fix.label === 'm' ? x : y
    const after = c.fix.label === 'm' ? c.fix.x : c.fix.y
    return {
      what: t('sheet.digit', { axis, sheet: c.declared25 ?? c.declared50 }),
      from: written(before, scale),
      to: written(after, scale),
    }
  }
  if (c.numberSuspect) {
    return { what: t('sheet.number', { sheet: c.at25 ?? '—', s50: c.at50, name: c.at50name }) }
  }
  return { what: t('sheet.off', { km: (c.distanceKm ?? 0).toFixed(1), sheet: c.declared25 ?? c.declared50, where }) }
}

export function sheetTag(c) {
  if (c.fix && c.fix.kind !== 'digit') return 'fix'
  if (c.fix) return 'digit'
  if (c.numberSuspect) return 'number'
  return 'check'
}

export default function SheetReview({
  fixes, checks, accepted, reviewed, onAnswer, onPick, selected, labelOf, describe,
}) {
  const t = useT()
  const row = (c, withBox) => {
    const d = describe(c)
    return (
      <li key={c.i} className={c.i === selected ? 'is-sel' : ''}>
        {withBox && (
          <input
            type="checkbox"
            id={`fix-${c.i}`}
            className="cb"
            checked={accepted.has(c.i)}
            onChange={(e) => {
              const next = new Set(accepted)
              if (e.target.checked) next.add(c.i)
              else next.delete(c.i)
              onAnswer(next)
            }}
          />
        )}
        {!withBox && <span className={`tag ${sheetTag(c)}`}>{t(`sheet.tag.${sheetTag(c)}`)}</span>}
        <button type="button" className="pick" onClick={() => onPick(c.i)}>
          <b className="who">{t('file.rowN', { n: c.i + 1 })}</b>
          {labelOf(c.i) && <span className="who"> · {labelOf(c.i)}</span>}
          <span className="sheet"> · {c.against === '50'
            ? t('sheet.declared50', { sheet: c.declared50 })
            : t('sheet.declared25', { sheet: c.declared25 })}</span>
          <span className="what"> — {d.what}</span>
          {d.from !== undefined && (
            <span className="vals">{' '}{d.from} → <b>{d.to}</b></span>
          )}
        </button>
      </li>
    )
  }

  return (
    <>
      {fixes.length > 0 && (
        <div className={`rv sheets ${reviewed ? 'resolved' : ''}`}>
          <h3 className="rv-h">
            <span className="rv-t">
              <span aria-hidden="true">{reviewed ? '✓' : '▲'}</span>
              <span>{t('sheet.fixesFound', { n: fixes.length })}</span>
              <span className="chosen">{t('sheet.fixesChosen', { n: accepted.size })}</span>
            </span>
          </h3>
          <div className="rv-b">
            <p className="s">{t('sheet.fixesHint')}</p>
            <div className="b">
              <button type="button" className="btn sm accent-line"
                      onClick={() => onAnswer(new Set(fixes.map((c) => c.i)))}>
                {t('sheet.fixAll')}
              </button>
              <button type="button" className="btn sm" onClick={() => onAnswer(new Set())}>
                {t('sheet.fixNone')}
              </button>
            </div>
            <ul>{fixes.map((c) => row(c, true))}</ul>
          </div>
        </div>
      )}

      {checks.length > 0 && (
        <div className="rv sheets soft">
          <h3 className="rv-h">
            <span className="rv-t">
              <span aria-hidden="true">?</span>
              <span>{t('sheet.checksFound', { n: checks.length })}</span>
              <span className="chosen">{t('sheet.checksNote')}</span>
            </span>
          </h3>
          <div className="rv-b">
            <ul>{checks.map((c) => row(c, false))}</ul>
          </div>
        </div>
      )}
    </>
  )
}
