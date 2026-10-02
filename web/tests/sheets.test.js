// Map sheets: the index, the arithmetic that places a point, and the check.
//
// Every point here is synthetic: placed at a known spot inside a sheet taken
// from the index itself, then moved by the mistake under test.
import { describe, expect, it } from 'vitest'

import index from '../src/core/sheet_index.json' with { type: 'json' }
import { REGISTRY, WGS84_PROJ4, transformAll } from '../src/core/crs.js'
import {
  EDGE_KM,
  checkRow,
  checkSheets,
  distanceToBoxes,
  guessLabelColumn,
  guessSheetColumns,
  militaryKm,
  proposeFix,
  sheet25Boxes,
  sheet25Key,
  sheet50Boxes,
  sheet50Key,
  sheet50Of25,
  sheetName50,
  sheetsAt,
} from '../src/core/sheets.js'

/** Every 1:25 000 sheet the rule makes, with its column and row. */
const ALL25 = [
  ...index.runs25.flatMap(([j, i, n, count]) => Array.from({ length: count }, (_, k) => [String(n + k), i + k, j])),
  ...index.special25,
]
const corner25 = (key) => {
  const [[m0, p0]] = sheet25Boxes(key)
  return [key, m0, p0]
}
const middle = (key) => {
  const [, m0, p0] = corner25(key)
  return [m0 + 8, p0 + 5]
}

describe('the index', () => {
  it('holds both series: a numbering rule at 1:25 000, corners at 1:50 000', () => {
    // 632 sheets in the series, and a few printed in two places or split.
    expect(ALL25.length).toBeGreaterThanOrEqual(632)
    expect(new Set(ALL25.map(([, i, j]) => `${i},${j}`)).size).toBe(ALL25.length)
    expect(index.s50).toHaveLength(175)
    for (const [, m0, p0] of index.s50) {
      expect((m0 - 8) % 32).toBe(0)
      expect(p0 % 20).toBe(0)
    }
  })

  it('numbers a row west to east', () => {
    // 34-D, Lisboa: two sheets of one row above two of the next.
    const [[m0, p0]] = sheet50Boxes('34-D')
    const four = [[m0 + 8, p0 + 15], [m0 + 24, p0 + 15], [m0 + 8, p0 + 5], [m0 + 24, p0 + 5]]
      .map(([m, p]) => sheetsAt(m, p).s25.key)
    expect(four).toEqual(['431', '432', '442', '443'])
  })

  it('places every 1:25 000 sheet back on itself, inside its 1:50 000 sheet', () => {
    for (const [key] of ALL25) {
      const [, m0, p0] = corner25(key)
      if (key === '325B/C') continue   // two places; checked below
      const at = sheetsAt(m0 + 8, p0 + 5)
      expect(at.s25.key).toBe(key)
      if (at.s50) {
        const [[a0, b0, a1, b1]] = sheet50Boxes(at.s50.key)
        expect(m0 >= a0 && m0 + 16 <= a1 && p0 >= b0 && p0 + 10 <= b1).toBe(true)
      }
    }
  })

  it('knows a sheet printed in two places', () => {
    expect(sheet25Boxes('325B/C')).toHaveLength(2)
  })
})

describe('reading a sheet as a table writes it', () => {
  it.each([
    [349, '349'], ['349', '349'], ['349.0', '349'], [' 349 ', '349'], ['Folha 349', '349'],
    ['162 A', '162A'], ['162-A', '162A'], ['162a', '162A'], ['325 B/C', '325B/C'],
  ])('%s is sheet %s', (value, key) => {
    expect(sheet25Key(value)).toBe(key)
  })

  it.each([['21 - Açores'], [''], ['abc'], [null], [undefined], ['3490']])('%s is not a sheet', (value) => {
    expect(sheet25Key(value)).toBeNull()
  })

  it.each([
    ['43-A', '43-A'], ['43a', '43-A'], ['043-A', '43-A'], ['43 A', '43-A'], ['44-CD', '44-CD'],
  ])('%s is 1:50 000 sheet %s', (value, key) => {
    expect(sheet50Key(value)).toBe(key)
  })

  it.each([['Arm.12'], ['43-E'], ['43'], ['']])('%s is not a 1:50 000 sheet', (value) => {
    expect(sheet50Key(value)).toBeNull()
  })

  it('finds a sheet printed with its other half under any of the letters', () => {
    expect(sheet50Boxes('44-CD')).toEqual(sheet50Boxes('44-C'))
    expect(sheet50Boxes('44-D')).toEqual(sheet50Boxes('44-C'))
  })

  it('names a sheet by its 1:50 000 sheet', () => {
    const s50 = sheet50Of25('230')
    expect(s50).toEqual(sheetsAt(...middle('230')).s50)
    expect(sheetName50(s50.key)).toBe(s50.name)
    expect(s50.name.length).toBeGreaterThan(2)
  })
})

describe('checking a row against its sheet', () => {
  it('is ok inside its sheet', () => {
    expect(checkRow(middle('230'), 230, null)).toMatchObject({ status: 'ok', at25: '230', against: '25' })
  })

  it('is ok just over the edge', () => {
    // A coordinate read to the nearest 10 m, a point drawn on the border.
    const [, m0, p0] = corner25('230')
    expect(checkRow([m0 - EDGE_KM / 2, p0 + 5], '230', null).status).toBe('ok')
  })

  it('is off when it is a sheet away, and says where it is', () => {
    const r = checkRow(middle('231'), '230', null)
    expect(r.status).toBe('off')
    expect(r.at25).toBe('231')
    expect(r.distanceKm).toBeGreaterThan(EDGE_KM)
  })

  it('uses the 1:50 000 sheet when there is no 1:25 000 one', () => {
    const at = sheetsAt(...middle('230'))
    expect(checkRow(middle('230'), null, at.s50.key)).toMatchObject({ status: 'ok', against: '50' })
  })

  it('lets the 1:25 000 sheet decide when both are given', () => {
    expect(checkRow(middle('230'), '230', '53-A')).toMatchObject({ status: 'ok', against: '25' })
  })

  it('cannot say anything without a sheet it knows', () => {
    expect(checkRow(middle('230'), '21 - Açores', null).status).toBe('unknown')
    expect(checkRow(middle('230'), null, null).status).toBe('unknown')
    expect(checkRow(null, '230', null).status).toBe('none')
  })
})

describe('the mistake that would put a point back', () => {
  // The file is in the military grid, in metres: km is metres / 1000.
  const toKm = (x, y) => [x / 1000, y / 1000]
  const [mk, pk] = middle('230')
  const x = mk * 1000
  const y = pk * 1000
  const boxes = sheet25Boxes('230')

  it('finds M and P written the other way round', () => {
    expect(proposeFix(y, x, boxes, toKm, true)).toMatchObject({ kind: 'swap', x, y })
  })

  it('finds the 300 km of false northing left off', () => {
    expect(proposeFix(x, y - 300000, boxes, toKm, true)).toMatchObject({ kind: 'origin', x, y })
  })

  it('does not offer a false origin outside the military grid', () => {
    const r = proposeFix(x, y - 300000, boxes, toKm, false)
    expect(r?.kind).not.toBe('origin')
  })

  it('finds one wrong digit, hundreds before tens', () => {
    expect(proposeFix(x, y - 200000, boxes, toKm, true)).toMatchObject({ kind: 'digit', delta: 200000, y })
    expect(proposeFix(x, y + 40000, boxes, toKm, true)).toMatchObject({ kind: 'digit', delta: -40000, y })
  })

  it('offers nothing for a point that no simple mistake explains', () => {
    expect(proposeFix(x + 123456, y + 7890, boxes, toKm, true)).toBeNull()
  })
})

describe('from degrees to the military grid', () => {
  it('lands a sheet\'s middle back in that sheet', async () => {
    const [mk, pk] = middle('230')
    const [[lon, lat]] = await transformAll([[mk * 1000, pk * 1000]], REGISTRY['20790'].proj4, WGS84_PROJ4)
    const [km] = await militaryKm([lat], [lon])
    expect(distanceToBoxes(km[0], km[1], sheet25Boxes('230'))).toBe(0)
    expect(km[0]).toBeCloseTo(mk, 3)
    expect(km[1]).toBeCloseTo(pk, 3)
  })

  it('passes an unreadable row through as null', async () => {
    expect(await militaryKm([null], [null])).toEqual([null])
  })
})

describe('checking a whole table', () => {
  // Synthetic rows in the military grid, in metres, each one a sheet's middle
  // and then one mistake.
  const at = (key) => middle(key).map((v) => v * 1000)
  const row = (key, [x, y]) => ({ key, xy: [x, y], km: [x / 1000, y / 1000] })
  const table = [
    row('230', at('230')),                                        // right
    row('230', [at('230')[1], at('230')[0]]),                     // swapped
    row('230', [at('230')[0], at('230')[1] - 300000]),            // no false northing
    row('230', [at('230')[0], at('230')[1] - 100000]),            // one digit, far
    row('230', at('231')),                                        // the next sheet: no simple cause
  ]
  const run = (extra = {}) => checkSheets({
    km: table.map((r) => r.km),
    declared25: table.map((r) => r.key),
    xy: table.map((r) => r.xy),
    inputProj4: REGISTRY['20790'].proj4,
    military: true,
    ...extra,
  })

  it('says what each row needs, and how sure it is', async () => {
    const out = await run()
    expect(out.map((r) => r.status)).toEqual(['ok', 'off', 'off', 'off', 'off'])
    expect(out.map((r) => r.fix?.kind ?? null)).toEqual([null, 'swap', 'origin', 'digit', null])
    expect(out.map((r) => r.confidence)).toEqual([null, 'alta', 'alta', 'media', 'verificar'])
  })

  it('does not guess a digit for a point a few kilometres out', async () => {
    // Nearer than 5 km, a neighbouring sheet is as likely as a typo.
    const [, m0, p0] = corner25('230')
    const out = await checkSheets({
      km: [[m0 + 8, p0 - 3]],
      declared25: ['230'],
      xy: [[(m0 + 8) * 1000, (p0 - 3) * 1000]],
      inputProj4: REGISTRY['20790'].proj4,
      military: true,
    })
    expect(out[0]).toMatchObject({ status: 'off', fix: null, confidence: 'verificar' })
  })

  it('suspects the number when the row names the 1:50 000 sheet the point is in', async () => {
    const elsewhere = sheet50Of25('509')
    const out = await checkSheets({
      km: [middle('509')],
      declared25: ['230'],
      cells: [['Furo 1', '230', elsewhere.name]],
    })
    expect(out[0]).toMatchObject({ status: 'off', numberSuspect: true, fix: null })
  })

  it('does not suspect the number when the row names its own sheet', async () => {
    const out = await checkSheets({
      km: [middle('509')],
      declared25: ['230'],
      cells: [['Furo 1', '230', sheet50Of25('230').name]],
    })
    expect(out[0].numberSuspect).toBe(false)
  })

  it('checks a file in another system through its own projection', async () => {
    // PT-TM06 values: the swap is found in the file's own coordinates.
    const tm06 = REGISTRY['3763'].proj4
    const [mk, pk] = middle('230')
    const [[x, y]] = await transformAll([[mk * 1000, pk * 1000]], REGISTRY['20790'].proj4, tm06)
    // Written the other way round, then converted as the file has it.
    const [[lon, lat]] = await transformAll([[y, x]], tm06, WGS84_PROJ4)
    const [km] = await militaryKm([lat], [lon])
    const out = await checkSheets({ km: [km], declared25: ['230'], xy: [[y, x]], inputProj4: tm06 })
    expect(out[0]).toMatchObject({ status: 'off', confidence: 'alta' })
    expect(out[0].fix.kind).toBe('swap')
  })
})

describe('finding the sheet columns', () => {
  // Rows in the middle of real sheets, with a works number that reads as a
  // sheet number too, and one row whose sheet is wrong.
  const keys = ['230', '231', '230', '509', '510', '241']
  const km = keys.map((k) => middle(k))
  const rows = keys.map((k, i) => [String(300 + i * 7), `Furo ${i}`, k, sheetsAt(...middle(k)).s50.key])
  rows[3][2] = '600'
  const columns = ['Obra', 'Local', 'Nº', 'Cota']

  it('takes the column that agrees with the coordinates, not the one that looks like it', () => {
    expect(guessSheetColumns(columns, rows, km)).toEqual({ s25: 'Nº', s50: 'Cota' })
  })

  it('finds nothing in a file without sheets', () => {
    const plain = rows.map(([o, l]) => [o, l])
    expect(guessSheetColumns(['Obra', 'Local'], plain, km)).toEqual({ s25: null, s50: null })
  })

  it('names a point by the column that names places', () => {
    expect(guessLabelColumn(columns, rows)).toBe('Local')
    expect(guessLabelColumn(['Data', 'Obra', 'Sítio'], [['1962-03-01 00:00:00', '299', 'Troia']] .concat([['1962-04-01', '300', 'Beja']])))
      .toBe('Sítio')
  })
})
