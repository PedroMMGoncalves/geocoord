import { beforeAll, describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { identifyRegion, pointInMask } from '../src/core/converter.js'
import {
  LAT_CANDIDATES,
  LON_CANDIDATES,
  REGION_MASKS,
  applySwaps,
  buildResult,
  buildResult as build,
  featuresInRange,
  guessColumn,
  pointsSummary,
  toCsv,
  toGpx,
} from '../src/core/pipeline.js'
import { get as crsGet } from '../src/core/crs.js'
import { readWorkbook } from '../src/core/reader.js'

const TABLE = {
  columns: ['amostra', 'lat', 'lon'],
  rows: [
    ['0071', '38° 42\' 30" N', '9° 8\' 12" W'],
    ['0072', '41,162222', '-8,610833'],
    ['0073', 'não é uma coordenada', '-8.6'],
  ],
}

describe('guessColumn', () => {
  it('finds the coordinate columns by name, whatever the case', () => {
    const cols = ['Amostra', 'LATITUDE', 'Longitude']
    expect(guessColumn(cols, LAT_CANDIDATES, 0)).toBe(1)
    expect(guessColumn(cols, LON_CANDIDATES, 1)).toBe(2)
  })

  it('prefers the earlier candidate when a file offers both', () => {
    // "latitude" comes before "y" in the candidate list, so a file carrying
    // both is read the way its author most likely meant.
    expect(guessColumn(['y', 'latitude'], LAT_CANDIDATES, 0)).toBe(1)
  })

  it('falls back to a position, never past the last column', () => {
    expect(guessColumn(['a', 'b'], LAT_CANDIDATES, 0)).toBe(0)
    expect(guessColumn(['only'], LON_CANDIDATES, 1)).toBe(0)
  })
})

describe('buildResult', () => {
  // Building is asynchronous now that a coordinate system can be chosen: proj4
  // is fetched on demand. Built once here rather than in every case.
  let result
  beforeAll(async () => { result = await build(TABLE, 'lat', 'lon') })

  it('keeps the original columns and appends the derived ones', () => {
    expect(result.columns).toEqual([
      'amostra', 'lat', 'lon',
      'Latitude_DD', 'Longitude_DD', 'X_DD', 'Y_DD', 'WKT',
      'Latitude_GMS', 'Longitude_GMS',
    ])
  })

  it('converts DMS and decimal commas alike', () => {
    expect(result.lats[0]).toBe(38.708333)
    expect(result.lons[0]).toBe(-9.136667)
    expect(result.lats[1]).toBe(41.162222)
    expect(result.lons[1]).toBe(-8.610833)
  })

  it('leaves an unreadable coordinate null rather than guessing', () => {
    expect(result.lats[2]).toBeNull()
    expect(result.rows[2][result.columns.indexOf('WKT')]).toBeNull()
  })

  it('writes WKT as POINT(lon lat), which is the order GIS expects', () => {
    expect(result.rows[0][result.columns.indexOf('WKT')]).toBe('POINT (-9.136667 38.708333)')
  })

  it('carries the identifier through as text, leading zero intact', () => {
    expect(result.rows[0][0]).toBe('0071')
  })

  it('does not duplicate the derived columns when run again on its own output', async () => {
    const twice = await build(result, 'lat', 'lon')
    expect(twice.columns).toEqual(result.columns)
  })

  it('rounds half to even, as Python does, not half up', async () => {
    // 0.5 at the rounding position: half-up would give 38.71, half-even 38.70.
    const table = { columns: ['lat', 'lon'], rows: [['38.705', '-9.0']] }
    expect((await build(table, 'lat', 'lon', { decimals: 2 })).lats[0]).toBe(38.7)
  })

  it('never emits a negative zero', async () => {
    const table = { columns: ['lat', 'lon'], rows: [['-0.0000001', '0']] }
    expect(Object.is((await build(table, 'lat', 'lon', { decimals: 2 })).lats[0], -0)).toBe(false)
  })
})

describe('applySwaps', () => {
  it('inverts only the chosen rows and rebuilds everything derived from them', async () => {
    const result = await build(TABLE, 'lat', 'lon')
    const swapped = await applySwaps(result, [0])

    expect(swapped.lats[0]).toBe(-9.136667)
    expect(swapped.lons[0]).toBe(38.708333)
    expect(swapped.rows[0][swapped.columns.indexOf('WKT')]).toBe('POINT (38.708333 -9.136667)')
    expect(swapped.rows[0][swapped.columns.indexOf('Latitude_GMS')]).toBe('9° 8\' 12.001" S')

    // Row 1 is untouched.
    expect(swapped.lats[1]).toBe(result.lats[1])
  })

  it('is reversible: swapping the same row twice returns the original', async () => {
    const result = await build(TABLE, 'lat', 'lon')
    const back = await applySwaps(await applySwaps(result, [0]), [0])
    expect(back.lats).toEqual(result.lats)
    expect(back.columns).toEqual(result.columns)
  })
})

describe('featuresInRange', () => {
  it('drops the rows that could not be converted', async () => {
    const { features } = featuresInRange(await build(TABLE, 'lat', 'lon'))
    expect(features).toHaveLength(2)
    expect(features[0][0]).toBe(-9.136667) // lon first, as the exporters want
    expect(features[0][1]).toBe(38.708333)
  })

  it('carries the attributes in a Map, so column order survives numeric names', async () => {
    // A plain object would hoist "1" and "2" ahead of "amostra", silently
    // reordering the attributes of every exported feature.
    const table = { columns: ['2', 'amostra', '1', 'lat', 'lon'], rows: [['b', 'A', 'a', '38.5', '-9.0']] }
    const { features, fieldNames } = featuresInRange(await build(table, 'lat', 'lon'))
    expect(fieldNames.slice(0, 3)).toEqual(['2', 'amostra', '1'])
    expect([...features[0][2].keys()].slice(0, 3)).toEqual(['2', 'amostra', '1'])
  })

  it('leaves the geometry columns out of the attributes', async () => {
    const { fieldNames } = featuresInRange(await build(TABLE, 'lat', 'lon'))
    expect(fieldNames).not.toContain('X_DD')
    expect(fieldNames).not.toContain('Y_DD')
    expect(fieldNames).not.toContain('WKT')
  })
})

describe('toCsv', () => {
  it('quotes only what needs quoting, and doubles an embedded quote', () => {
    const table = {
      columns: ['a', 'b'],
      rows: [['plain', 'has,comma'], ['has"quote', 'has\nnewline'], [null, '']],
    }
    expect(toCsv(table)).toBe(
      'a,b\r\nplain,"has,comma"\r\n"has""quote","has\nnewline"\r\n,\r\n',
    )
  })

  it('does not quote a semicolon when the comma is the delimiter', () => {
    expect(toCsv({ columns: ['a'], rows: [['x;y']] })).toBe('a\r\nx;y\r\n')
  })
})

describe('toGpx', () => {
  it('writes one waypoint per feature, named from the chosen column', async () => {
    const { features } = featuresInRange(await build(TABLE, 'lat', 'lon'))
    const gpx = toGpx(features, 'amostra')
    expect(gpx).toContain('<wpt lat="38.708333" lon="-9.136667"><name>0071</name></wpt>')
    expect(gpx.match(/<wpt /g)).toHaveLength(2)
  })

  it('escapes the characters XML cannot carry raw', async () => {
    const table = { columns: ['nome', 'lat', 'lon'], rows: [['a & <b>', '38.5', '-9.0']] }
    const { features } = featuresInRange(await build(table, 'lat', 'lon'))
    expect(toGpx(features, 'nome')).toContain('<name>a &amp; &lt;b&gt;</name>')
  })
})

describe('pointsSummary', () => {
  it('measures only the valid points', async () => {
    const s = pointsSummary(await build(TABLE, 'lat', 'lon'))
    expect(s.count).toBe(2)
    expect(s.latMin).toBe(38.708333)
    expect(s.latMax).toBe(41.162222)
  })

  it('is null when nothing converted', async () => {
    const table = { columns: ['lat', 'lon'], rows: [['x', 'y']] }
    expect(pointsSummary(await build(table, 'lat', 'lon'))).toBeNull()
  })
})

describe('REGION_MASKS', () => {
  it('places the capitals of every offered region inside their own mask', () => {
    const capitals = {
      'Portugal mainland': [38.7223, -9.1393],
      Azores: [37.7412, -25.6756],
      Madeira: [32.6669, -16.9241],
      Angola: [-8.8390, 13.2894],
      'Cabo Verde': [14.9330, -23.5133],
      'Guiné-Bissau': [11.8636, -15.5977],
      Moçambique: [-25.9692, 32.5732],
      'São Tomé e Príncipe': [0.3365, 6.7273],
    }
    for (const [name, [lat, lon]] of Object.entries(capitals)) {
      expect(pointInMask(lat, lon, REGION_MASKS[name]), name).toBe(true)
    }
  })

  it('covers the Selvagens, the southernmost Portuguese territory', () => {
    // Selvagem Grande, 30.14 N 15.87 W. It belongs to the Autonomous Region of
    // Madeira but sits far south of the Madeira/Porto Santo/Desertas box.
    expect(identifyRegion(30.1394, -15.8686, REGION_MASKS)).toBe('Madeira')
  })

  it('covers the far corners of mainland Portugal', () => {
    const corners = [
      [37.0233, -8.9976], // Cabo de São Vicente, the south-west
      [41.9600, -8.8800], // the Minho river mouth, the north-west
      [41.8072, -6.7594], // Bragança, the north-east
      [37.1667, -7.4000], // Vila Real de Santo António, the south-east
    ]
    for (const [lat, lon] of corners) {
      expect(pointInMask(lat, lon, REGION_MASKS['Portugal mainland']), `${lat},${lon}`).toBe(true)
    }
  })

  it('does not put one region inside another', () => {
    // identifyRegion returns the FIRST match, so an overlap would silently
    // misname points in whichever region comes later.
    const names = Object.keys(REGION_MASKS)
    for (const name of names) {
      for (const [la0, la1, lo0, lo1] of REGION_MASKS[name]) {
        for (const corner of [[la0, lo0], [la0, lo1], [la1, lo0], [la1, lo1]]) {
          const found = identifyRegion(corner[0], corner[1], REGION_MASKS)
          expect(found, `${name} corner ${corner} claimed by ${found}`).toBe(name)
        }
      }
    }
  })
})

describe('readWorkbook', () => {
  /** A one-sheet workbook built cell by cell, so the cell types are exact. */
  function workbook(cells) {
    const sheet = {}
    let maxC = 0
    cells.forEach((row, r) => {
      row.forEach((cell, c) => {
        sheet[XLSX.utils.encode_cell({ r, c })] = cell
        maxC = Math.max(maxC, c)
      })
    })
    sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: cells.length - 1, c: maxC } })
    return new Uint8Array(XLSX.write(
      { SheetNames: ['Folha1'], Sheets: { Folha1: sheet } },
      { type: 'array', bookType: 'xlsx' },
    ))
  }

  const s = (v) => ({ t: 's', v })
  const n = (v, z) => (z ? { t: 'n', v, z } : { t: 'n', v })

  it('keeps a long numeric identifier exact instead of rendering it as science', async () => {
    // Excel's General format paints 12 digits or more in scientific notation.
    // Reading the painted text would turn a lab number into "1.23457E+15".
    const bytes = workbook([
      [s('id'), s('lat'), s('lon')],
      [n(1234567890123456), n(38.5), n(-9.0)],
    ])
    expect((await readWorkbook(bytes)).rows[0][0]).toBe('1234567890123456')
  })

  it('keeps a coordinate at full precision even when the cell is formatted short', async () => {
    // The cell displays "38.71"; the file holds 38.7083335. Reading what is
    // displayed moves the point two and a half kilometres.
    const bytes = workbook([
      [s('lat'), s('lon')],
      [n(38.7083335, '0.00'), n(-9.1396, '0.00')],
    ])
    expect((await readWorkbook(bytes)).rows[0][0]).toBe('38.7083335')
  })

  it('still reads a date as a date, not as a day count', async () => {
    const bytes = workbook([
      [s('data'), s('lat')],
      [n(45358, 'yyyy\\-mm\\-dd'), n(38.5)],
    ])
    expect((await readWorkbook(bytes)).rows[0][0]).toBe('2024-03-07')
  })

  it('keeps a text identifier with its leading zeros', async () => {
    const bytes = workbook([[s('id')], [s('0071')]])
    expect((await readWorkbook(bytes)).rows[0][0]).toBe('0071')
  })

  it('reads a named sheet, and the first one by default', async () => {
    const sheetA = { A1: s('a'), A2: s('1'), '!ref': 'A1:A2' }
    const sheetB = { A1: s('b'), A2: s('2'), '!ref': 'A1:A2' }
    const bytes = new Uint8Array(XLSX.write(
      { SheetNames: ['Um', 'Dois'], Sheets: { Um: sheetA, Dois: sheetB } },
      { type: 'array', bookType: 'xlsx' },
    ))
    expect((await readWorkbook(bytes)).columns).toEqual(['a'])
    expect((await readWorkbook(bytes, 'Dois')).columns).toEqual(['b'])
  })

  it('returns an empty table for an empty sheet rather than raising', async () => {
    const bytes = new Uint8Array(XLSX.write(
      { SheetNames: ['Vazia'], Sheets: { Vazia: {} } },
      { type: 'array', bookType: 'xlsx' },
    ))
    expect(await readWorkbook(bytes)).toEqual({ columns: [], rows: [] })
  })
})

describe('the file flow end to end', () => {
  it('reads a workbook, converts it, and exports what a GIS can open', async () => {
    const sheet = {
      A1: { t: 's', v: 'amostra' }, B1: { t: 's', v: 'lat' }, C1: { t: 's', v: 'lon' },
      A2: { t: 's', v: '0071' }, B2: { t: 's', v: '38° 42\' 30" N' }, C2: { t: 's', v: '9° 8\' 12" W' },
      A3: { t: 's', v: '0072' }, B3: { t: 'n', v: 41.162222 }, C3: { t: 'n', v: -8.610833 },
      '!ref': 'A1:C3',
    }
    const bytes = new Uint8Array(XLSX.write(
      { SheetNames: ['dados'], Sheets: { dados: sheet } },
      { type: 'array', bookType: 'xlsx' },
    ))

    const table = await readWorkbook(bytes)
    const cols = table.columns
    const result = await buildResult(
      table,
      cols[guessColumn(cols, LAT_CANDIDATES, 0)],
      cols[guessColumn(cols, LON_CANDIDATES, 1)],
    )

    expect(result.lats).toEqual([38.708333, 41.162222])
    expect(result.rows[0][0]).toBe('0071')

    const { features } = featuresInRange(result)
    expect(features).toHaveLength(2)
    expect(toCsv(result)).toContain('0071')
  })
})

describe('coordinate systems in the pipeline', () => {
  const TM06 = crsGet(3763)

  it('reads a projected file and gives back the place it came from', async () => {
    // Lisboa as a TM06 easting and northing, with the decimal commas a
    // Portuguese spreadsheet writes.
    const table = { columns: ['id', 'X', 'Y'], rows: [['A', '-87503,439', '-104538,892']] }
    const r = await buildResult(table, 'X', 'Y', {
      input: { proj4: TM06.proj4, kind: 'projected' },
    })
    expect(r.lats[0]).toBe(38.7223)
    expect(r.lons[0]).toBe(-9.1393)
  })

  it('adds the output system as extra columns, removing nothing', async () => {
    const table = { columns: ['lat', 'lon'], rows: [['38.7223', '-9.1393']] }
    const r = await buildResult(table, 'lat', 'lon', {
      output: { proj4: TM06.proj4, suffix: '3763' },
    })
    // Everything that was there before is still there, in the same order.
    expect(r.columns.slice(0, 8)).toEqual([
      'lat', 'lon', 'Latitude_DD', 'Longitude_DD', 'X_DD', 'Y_DD', 'WKT', 'Latitude_GMS',
    ])
    expect(r.columns.slice(-3)).toEqual(['X_3763', 'Y_3763', 'WKT_3763'])
    const x = r.rows[0][r.columns.indexOf('X_3763')]
    const y = r.rows[0][r.columns.indexOf('Y_3763')]
    expect(Math.abs(x - -87503.439)).toBeLessThan(0.01)
    expect(Math.abs(y - -104538.892)).toBeLessThan(0.01)
  })

  it('rounds the output system to the millimetre', async () => {
    const table = { columns: ['lat', 'lon'], rows: [['38.7223', '-9.1393']] }
    const r = await buildResult(table, 'lat', 'lon', {
      output: { proj4: TM06.proj4, suffix: '3763' },
    })
    // Metres carry their precision in the integer part; sixteen digits of float
    // leave far more decimals than any survey means.
    const x = String(r.rows[0][r.columns.indexOf('X_3763')])
    expect((x.split('.')[1] ?? '').length).toBeLessThanOrEqual(3)
  })

  it('does not duplicate the output columns when rebuilt on its own result', async () => {
    const table = { columns: ['lat', 'lon'], rows: [['38.7223', '-9.1393']] }
    const output = { proj4: TM06.proj4, suffix: '3763' }
    const once = await buildResult(table, 'lat', 'lon', { output })
    const twice = await buildResult(once, 'lat', 'lon', { output })
    expect(twice.columns).toEqual(once.columns)
  })

  it('keeps the output system consistent after an inversion', async () => {
    const table = { columns: ['lat', 'lon'], rows: [['-9.1393', '38.7223']] }
    const r = await buildResult(table, 'lat', 'lon', {
      output: { proj4: TM06.proj4, suffix: '3763' },
    })
    const swapped = await applySwaps(r, [0])
    const x = swapped.rows[0][swapped.columns.indexOf('X_3763')]
    expect(Math.abs(x - -87503.439)).toBeLessThan(0.01)
  })

  it('carries a row that could not be read through as empty, not as zero', async () => {
    const table = { columns: ['X', 'Y'], rows: [['texto', 'texto'], ['-87503.439', '-104538.892']] }
    const r = await buildResult(table, 'X', 'Y', {
      input: { proj4: TM06.proj4, kind: 'projected' },
      output: { proj4: TM06.proj4, suffix: '3763' },
    })
    expect(r.lats[0]).toBeNull()
    expect(r.rows[0][r.columns.indexOf('X_3763')]).toBeNull()
    expect(r.rows[0][r.columns.indexOf('WKT_3763')]).toBeNull()
    expect(r.lats[1]).toBe(38.7223)
  })

  it('leaves the second system out of the exported attributes', async () => {
    const table = { columns: ['amostra', 'lat', 'lon'], rows: [['A', '38.7223', '-9.1393']] }
    const r = await buildResult(table, 'lat', 'lon', {
      output: { proj4: TM06.proj4, suffix: '3763' },
    })
    const { fieldNames } = featuresInRange(r)
    expect(fieldNames).not.toContain('X_3763')
    expect(fieldNames).not.toContain('WKT_3763')
    expect(fieldNames).toContain('amostra')
  })

  it('does not look for a hemisphere letter in a projected file', async () => {
    // "532725 W" is not a thing, but "W" as a sample name in an adjacent
    // column should never make a projected row look reversed either.
    const table = { columns: ['X', 'Y'], rows: [['-87503.439', '-104538.892']] }
    const r = await buildResult(table, 'X', 'Y', {
      input: { proj4: TM06.proj4, kind: 'projected' },
    })
    expect(r.axisMismatch).toEqual([false])
  })
})
