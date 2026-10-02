import { describe, expect, it } from 'vitest'
import { translate } from '../src/i18n.jsx'
import FILE from '../src/i18n/dict.file.js'
import { get } from '../src/core/crs.js'
import { provenance, today, transformationOf } from '../src/core/provenance.js'

const tIn = (lang) => (key, vars) => translate(FILE, lang, key, vars)
const system = (code) => {
  const e = get(code)
  return { proj4: e.proj4, label: e.pt, epsg: e.epsg, suffix: String(e.epsg) }
}
const asObject = (pairs) => Object.fromEntries(pairs)

describe('provenance', () => {
  it('says where a military-grid file came from, and what was done to it', () => {
    const got = asObject(provenance(tIn('pt'), {
      version: '1.2.0',
      date: '2026-10-03',
      fileName: 'obras.xls',
      sheet: 'lista',
      input: system(20790),
      output: system(3763),
      scale: 1000,
      swaps: 2,
      sheetFixes: 1,
      azores: { count: 3, system: { label: get(2189).pt, epsg: 2189 } },
    }))
    expect(got['Convertido com']).toBe('GeoCoord 1.2.0 (https://pedrommgoncalves.github.io/geocoord/)')
    expect(got['Data da conversão']).toBe('2026-10-03')
    expect(got['Ficheiro de origem']).toBe('obras.xls, folha lista')
    expect(got['Sistema de origem']).toBe('Lisboa / Hayford-Gauss Militar (EPSG:20790)')
    expect(got['Transformação para WGS 84']).toMatch(/^grelha NTv2 da DGT DLx_ETRS89_geo: resíduo médio 0,09 m/)
    expect(got['Fonte da transformação']).toMatch(/^DGT, Parâmetros de Transformação/)
    expect(got['Definição proj4']).toContain('+nadgrids=DLX_ETRS89_geo.gsb')
    expect(got['Unidade lida']).toMatch(/quilómetros/)
    expect(got['Linhas noutro sistema']).toBe('3 linhas lidas em Açores Central 1948 / UTM 26N (EPSG:2189)')
    expect(got['Correções aceites']).toBe('2 linhas com latitude e longitude trocadas; 1 linha corrigida pela folha')
    expect(got['Sistema adicional']).toBe(
      'ETRS89 / Portugal TM06 (EPSG:3763), nas colunas X_3763 e Y_3763; a partir de WGS 84: '
      + 'ETRS89 / PTRA08 tomado como WGS 84 (diferença inferior a 1 m)')
  })

  it('says only what applies to a plain file in degrees', () => {
    const got = provenance(tIn('pt'), { version: '1.2.0', date: '2026-10-03', fileName: 'a.csv' })
    expect(got.map(([k]) => k)).toEqual([
      'Convertido com', 'Data da conversão', 'Ficheiro de origem', 'Sistema de origem',
      'Transformação para WGS 84', 'Graus e geometria',
    ])
    expect(asObject(got)['Sistema de origem']).toBe('WGS 84 (EPSG:4326)')
    expect(asObject(got)['Transformação para WGS 84']).toBe('nenhuma: já em WGS 84')
  })

  it('is written in the reader\'s language', () => {
    const got = asObject(provenance(tIn('en'), {
      version: '1.2.0', date: '2026-10-03', fileName: 'a.csv', input: system(27493),
    }))
    expect(got['Transformation to WGS 84']).toMatch(/^DGT's NTv2 grid D73_ETRS89_geo: mean residual 0.06 m/)
  })
})

describe('transformationOf', () => {
  const t = tIn('en')
  it('names each kind of system', () => {
    expect(transformationOf(t, system(4326))).toBe('none: already WGS 84')
    expect(transformationOf(t, system(32629))).toBe('none: already WGS 84')
    expect(transformationOf(t, system(5016))).toMatch(/taken as WGS 84/)
    expect(transformationOf(t, system(2190))).toMatch(/eastern group: 0.02 m/)
    expect(transformationOf(t, { proj4: '+proj=utm +zone=33 +south +ellps=clrk80 +towgs84=-50,-7,-170 +units=m', label: 'x', epsg: null }))
      .toBe("the definition's own")
  })
})

describe('today', () => {
  it('writes the local date as YYYY-MM-DD', () => {
    expect(today(new Date(2026, 9, 3, 23, 59))).toBe('2026-10-03')
    expect(today(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})
