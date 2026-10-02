/**
 * Map sheets: which 1:25 000 and 1:50 000 sheet a point falls in, and whether
 * that is the sheet its row says.
 *
 * A table typed from paper carries the sheet it was read off, and that column
 * is the one piece of evidence about position that does not come from the
 * coordinates themselves. A row whose coordinates convert perfectly and land a
 * hundred kilometres from its own sheet has a mistake in it, and the shape of
 * the mistake - the two columns swapped, the false origin left off, one digit
 * - can usually be read from where the sheet is.
 *
 * Every sheet of both series is a rectangle in the Hayford-Gauss Militar grid
 * (EPSG:20790): 16 x 10 km at 1:25 000, 32 x 20 km at 1:50 000, corners on
 * round kilometres, four of the first in one of the second. So a point is
 * placed by arithmetic, and the index is a grid and a rule - the 1:50 000
 * sheets by corner and name, the 1:25 000 numbers as runs along each row. See
 * scripts/gen_sheet_index.py. The 1:25 000 sheets have no names here; where a
 * name helps, it is the 1:50 000 sheet's.
 *
 * Only the browser has this, for now.
 */
import index from './sheet_index.json' with { type: 'json' }
import { REGISTRY, WGS84_PROJ4, projector, transformAll } from './crs.js'

export const SHEET_SOURCE = index.source
export const MILITAR_PROJ4 = REGISTRY['20790'].proj4

const [W25, H25] = index.size25
const [W50, H50] = index.size50
// Sheet corners sit on M = 8 + 16i (and 8 + 32i): the grid is offset by the
// 200 km false easting, not aligned to it.
const [M0, P0] = index.origin

const cellKey = (m0, p0) => `${m0},${p0}`

/** key -> list of {m0, p0}; one sheet can cover two places (325B/C). */
const BY_KEY_25 = new Map()
const BY_CELL_25 = new Map()
function place25(key, i, j) {
  const m0 = M0 + W25 * i
  const p0 = P0 + H25 * j
  if (!BY_KEY_25.has(key)) BY_KEY_25.set(key, [])
  BY_KEY_25.get(key).push({ m0, p0 })
  BY_CELL_25.set(cellKey(m0, p0), { key })
}
// Along a row the numbers run west to east, one per column, without gaps.
for (const [j, i, n, count] of index.runs25) {
  for (let k = 0; k < count; k += 1) place25(String(n + k), i + k, j)
}
for (const [key, i, j] of index.special25) place25(key, i, j)
const BY_KEY_50 = new Map()
const BY_CELL_50 = new Map()
for (const [key, m0, p0, name] of index.s50) {
  BY_KEY_50.set(key, [{ m0, p0, name }])
  BY_CELL_50.set(cellKey(m0, p0), { key, name })
}

/**
 * A 1:25 000 sheet as the index writes it: "349", "162A", "325B/C".
 *
 * Accepts what tables hold: a number Excel stored as 349.0, "162 A", "162-A",
 * "Folha 349". Returns null for anything else, including an island sheet such
 * as "21 - Açores", which is not in this series.
 */
export function sheet25Key(value) {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  const m = /^(?:folha\s*)?(\d{1,3})(?:[.,]0+)?\s*-?\s*([a-c](?:\s*\/\s*[a-c])?)?$/i.exec(text)
  if (!m) return null
  return `${Number(m[1])}${m[2] ? m[2].replace(/\s+/g, '').toUpperCase() : ''}`
}

/** A 1:50 000 sheet as "43-A". Accepts "43-A", "43A", "43 a", "043-A". */
export function sheet50Key(value) {
  if (value === null || value === undefined) return null
  const m = /^0*(\d{1,2})\s*[-\s]?\s*([a-d]{1,2})$/i.exec(String(value).trim())
  return m ? `${Number(m[1])}-${m[2].toUpperCase()}` : null
}

/** The rectangles of a declared sheet, in km, or null if it is not in the index. */
export function sheet25Boxes(key) {
  const cells = key ? BY_KEY_25.get(key) : null
  return cells ? cells.map(({ m0, p0 }) => [m0, p0, m0 + W25, p0 + H25]) : null
}

/**
 * Sheet 44-C is printed as one with its eastern half, which is Spain, and
 * tables write it 44-C, 44-CD or 44-D: the index lists the other spellings.
 */
function resolve50(key) {
  if (!key) return null
  if (BY_KEY_50.has(key)) return key
  return index.aliases50[key] ?? null
}

export function sheet50Boxes(key) {
  const cells = BY_KEY_50.get(resolve50(key))
  return cells ? cells.map(({ m0, p0 }) => [m0, p0, m0 + W50, p0 + H50]) : null
}

export function sheetName50(key) {
  return BY_KEY_50.get(resolve50(key))?.[0]?.name ?? null
}

/** The 1:50 000 sheet a 1:25 000 sheet is part of. */
export function sheet50Of25(key) {
  const cell = BY_KEY_25.get(key)?.[0]
  if (!cell) return null
  return sheetsAt(cell.m0 + W25 / 2, cell.p0 + H25 / 2).s50
}

/** The sheets a point in the military grid (km) falls in. */
export function sheetsAt(m, p) {
  if (!Number.isFinite(m) || !Number.isFinite(p)) return { s25: null, s50: null }
  const m25 = M0 + W25 * Math.floor((m - M0) / W25)
  const p25 = P0 + H25 * Math.floor((p - P0) / H25)
  const m50 = M0 + W50 * Math.floor((m - M0) / W50)
  const p50 = P0 + H50 * Math.floor((p - P0) / H50)
  return {
    s25: BY_CELL_25.get(cellKey(m25, p25)) ?? null,
    s50: BY_CELL_50.get(cellKey(m50, p50)) ?? null,
  }
}

/** Distance in km from a point to the nearest of a sheet's rectangles; 0 inside. */
export function distanceToBoxes(m, p, boxes) {
  let best = Infinity
  for (const [m0, p0, m1, p1] of boxes) {
    const dm = Math.max(m0 - m, 0, m - m1)
    const dp = Math.max(p0 - p, 0, p - p1)
    best = Math.min(best, Math.hypot(dm, dp))
  }
  return best
}

/** WGS84 degrees to the military grid, in km. */
export async function militaryKm(lats, lons) {
  const pairs = await transformAll(
    lats.map((lat, i) => [lons[i], lat]), WGS84_PROJ4, MILITAR_PROJ4)
  return pairs.map(([x, y]) => (x === null ? null : [x / 1000, y / 1000]))
}

/**
 * How close to a sheet's edge counts as on it, in km. A coordinate read off a
 * map to the nearest 10 m, a point drawn on the border line, a datum shift of
 * a hundred metres: none of them is a mistake.
 */
export const EDGE_KM = 0.5

/**
 * The simple mistakes that would put a point back in its sheet.
 *
 * `x`, `y` are the values as the file holds them, in metres, in the input
 * system; `toKm(x, y)` projects a candidate to the military grid in km.
 * Tried in order of how often each happens, and the first kind with exactly
 * one answer wins; two answers of the same kind are no answer. `military` says
 * the file is in the military grid, where a missing false origin is its own
 * mistake: 300 km of northing, or 200 km of easting.
 *
 * Returns { kind, label, x, y } or null. Kinds: 'swap' and 'origin' are
 * certain enough to offer as a correction; 'digit' is a guess to confirm
 * against the source.
 */
export function proposeFix(x, y, boxes, toKm, military = false) {
  const inside = ([cx, cy]) => {
    const km = toKm(cx, cy)
    return km !== null && distanceToBoxes(km[0], km[1], boxes) <= EDGE_KM
  }
  const groups = [
    ['swap', [['swap', y, x]]],
    ['origin', military
      ? [['origin-p', x, y + 300000], ['origin-m', x + 200000, y], ['origin-both', x + 200000, y + 300000]]
      : []],
    ['digit', [100000, 200000, 300000, 400000, 500000]
      .flatMap((d) => [['p', x, y + d, d], ['p', x, y - d, -d], ['m', x + d, y, d], ['m', x - d, y, -d]])],
    ['digit', [10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000]
      .flatMap((d) => [['p', x, y + d, d], ['p', x, y - d, -d], ['m', x + d, y, d], ['m', x - d, y, -d]])],
  ]
  for (const [kind, tests] of groups) {
    const hits = tests.filter(([, cx, cy]) => inside([cx, cy]))
    if (hits.length === 1) {
      const [label, cx, cy, delta] = hits[0]
      return { kind, label, x: cx, y: cy, delta: delta ?? null }
    }
    if (hits.length > 1) return null
  }
  return null
}

/**
 * The sheet check for one row. `km` is the converted point in the military
 * grid; `declared25` and `declared50` are the row's cells as written.
 *
 * status: 'ok' (in its sheet, or within EDGE_KM of it), 'off' (outside),
 * 'unknown' (no sheet given, or one the index does not have), 'none' (no
 * position). The 1:25 000 sheet decides when both are given: it is the finer
 * of the two and the one a coordinate is read off.
 */
export function checkRow(km, declared25, declared50) {
  const key25 = sheet25Key(declared25)
  const key50 = sheet50Key(declared50)
  const at = km ? sheetsAt(km[0], km[1]) : { s25: null, s50: null }
  const out = {
    declared25: key25, declared50: key50,
    at25: at.s25?.key ?? null,
    at50: at.s50?.key ?? null, at50name: at.s50?.name ?? null,
    status: 'unknown', against: null, distanceKm: null,
  }
  if (!km) {
    out.status = 'none'
    return out
  }
  const boxes25 = sheet25Boxes(key25)
  const boxes50 = sheet50Boxes(key50)
  const boxes = boxes25 ?? boxes50
  if (!boxes) return out
  out.against = boxes25 ? '25' : '50'
  out.distanceKm = distanceToBoxes(km[0], km[1], boxes)
  out.status = out.distanceKm <= EDGE_KM ? 'ok' : 'off'
  return out
}

const plain = (s) => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Whether a row writes a sheet's name anywhere in it. The head of the name is
 * enough - "Coimbra" for "Coimbra-Sul", "Marinha das Ondas" without the
 * municipality - and six letters of it, so a typo at the end still counts.
 */
function rowNames(cells, name) {
  if (!name) return false
  const head = plain(name.split('(')[0].replace(/-(norte|sul|leste|oeste)$/i, ''))
  if (head.length < 4) return false
  const probe = head.slice(0, 6)
  return cells.some((c) => {
    const v = plain(c)
    return v.length >= 4 && !/^\d+$/.test(v) && (v.includes(probe) || head.includes(v.slice(0, 6)))
  })
}

/**
 * The sheet check for a whole table, with what each mistake would be.
 *
 * `km`: each row's converted point in the military grid (militaryKm), or null.
 * `declared25`, `declared50`: the sheet cells as written, or null for no column.
 * `xy`: the values as read, in metres in the input system - only for a
 * projected input; a correction is a change to those values.
 * `inputProj4`, `military`: the input system, and whether it is EPSG:20790.
 * `cells`: each row's cells, to see whether the row names the sheet its
 * coordinates fall in - the sign that the number, not the position, is wrong.
 *
 * Adds to each checkRow result:
 *   fix         { kind, label, x, y, delta } or null
 *   confidence  'alta' (swap, missing false origin), 'media' (one digit, more
 *               than 5 km out - nearer than that a neighbouring sheet is as
 *               likely as a typo), 'verificar' (off, no simple explanation)
 *   numberSuspect  the row names the 1:50 000 sheet the point is in, not the
 *               one its sheet number belongs to
 */
export async function checkSheets({
  km, declared25 = null, declared50 = null, xy = null, inputProj4 = null,
  military = false, cells = null,
}) {
  let toKm = null
  if (xy && inputProj4) {
    if (military) {
      toKm = (x, y) => [x / 1000, y / 1000]
    } else {
      const forward = await projector(inputProj4, MILITAR_PROJ4)
      toKm = (x, y) => {
        const out = forward(x, y)
        return out ? [out[0] / 1000, out[1] / 1000] : null
      }
    }
  }
  return km.map((point, i) => {
    const r = checkRow(point, declared25?.[i] ?? null, declared50?.[i] ?? null)
    r.fix = null
    r.confidence = null
    r.numberSuspect = false
    if (r.status !== 'off') return r
    r.confidence = 'verificar'
    // The names are the 1:50 000 sheets': a row naming the one its point is
    // in, and not the one its own number belongs to, has the number wrong. It
    // cannot tell two numbers inside the same 1:50 000 sheet apart.
    const own50 = r.against === '25' ? sheet50Of25(r.declared25)?.key : resolve50(r.declared50)
    if (cells && r.at50 && own50 && r.at50 !== own50
        && rowNames(cells[i], r.at50name) && !rowNames(cells[i], sheetName50(own50))) {
      r.numberSuspect = true
      return r
    }
    if (toKm && xy?.[i] && xy[i][0] !== null && xy[i][1] !== null) {
      const boxes = r.against === '25' ? sheet25Boxes(r.declared25) : sheet50Boxes(r.declared50)
      const fix = proposeFix(xy[i][0], xy[i][1], boxes, toKm, military)
      if (fix && (fix.kind !== 'digit' || r.distanceKm > 5)) {
        r.fix = fix
        r.confidence = fix.kind === 'digit' ? 'media' : 'alta'
      }
    }
    return r
  })
}

// A sheet column's name, when it has one worth reading: "Folha", "Carta
// 1:25000", "Nº folha", "CM 25k". A hint only - the values decide.
const SHEET_NAME = /folha|carta|sheet|25\s*k|25\.?000|50\s*k|50\.?000|\bcm\b/i

/**
 * Which columns hold the 1:25 000 and the 1:50 000 sheet.
 *
 * By agreement with the coordinates: the column whose values most often name
 * the sheet the row's point is actually in. A column of works numbers - 299,
 * 304, 1434 - reads as sheet numbers just as well, and the names say nothing
 * on a file whose header is "Nº"; but its numbers fall in the right sheet only
 * by accident. Half the rows agreeing is enough, which leaves room for the
 * mistakes the check is there to find. `km` is militaryKm of the rows.
 */
export function guessSheetColumns(columns, rows, km, exclude = []) {
  const pick = (keyOf, atOf) => {
    let best = null
    columns.forEach((name, c) => {
      if (exclude.includes(name)) return
      let given = 0
      let agree = 0
      rows.forEach((row, r) => {
        const key = keyOf(row[c])
        if (!key) return
        given += 1
        if (km[r] && atOf(km[r]) === key) agree += 1
      })
      if (given < 3 || agree < 3) return
      const score = agree / given
      const named = SHEET_NAME.test(String(name))
      if (score >= 0.5 && (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) < 1e-9 && named))) {
        best = { name, score }
      }
    })
    return best?.name ?? null
  }
  const s25 = pick(sheet25Key, ([m, p]) => sheetsAt(m, p).s25?.key ?? null)
  const s50 = pick((v) => resolve50(sheet50Key(v)), ([m, p]) => sheetsAt(m, p).s50?.key ?? null)
  return { s25, s50: s50 === s25 ? null : s50 }
}

// A column that names a place or a sample, by its header.
const LABEL_NAME = /local|nome|name|s[íi]tio|ponto|amostra|designa|refer|furo|capta|\bid\b|c[óo]digo/i
const DATE_LIKE = /^\d{4}-\d{2}-\d{2}|^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/

/**
 * The column that says which point a row is: the first one named like a place
 * or a sample, else the first one holding mostly text that is not a date.
 */
export function guessLabelColumn(columns, rows, exclude = []) {
  const texty = (c) => {
    const vals = rows.map((r) => r[c]).filter((v) => v !== null && v !== undefined && String(v).trim() !== '')
    if (vals.length === 0) return false
    const words = vals.filter((v) => Number.isNaN(Number(String(v).replace(',', '.')))
      && !DATE_LIKE.test(String(v).trim()))
    return words.length / vals.length >= 0.7 && new Set(vals.map(String)).size > 1
  }
  const free = columns.map((name, c) => ({ name, c })).filter(({ name }) => !exclude.includes(name))
  const named = free.find(({ name, c }) => LABEL_NAME.test(String(name)) && texty(c))
  if (named) return named.name
  return free.find(({ c }) => texty(c))?.name ?? null
}
