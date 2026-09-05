import { describe, expect, it } from 'vitest'
import fixtures from '../../tests/fixtures/parity.json' with { type: 'json' }
import {
  REGISTRY,
  WGS84,
  esriWkt,
  fromWgs84,
  get,
  systems,
  toWgs84,
  transformAll,
  utmLabel,
  utmProj4,
} from '../src/core/crs.js'

const { tolerance_m: TOLERANCE, cases } = fixtures.crs_transform

describe('the contract for coordinate transformations', () => {
  // The one section that does not demand exact equality. Everywhere else the
  // two implementations run the same arithmetic in two languages; here they run
  // two different libraries - pyproj there, proj4js here - over the same proj4
  // definition, and the floating-point path through a projection differs in the
  // last places. Measured across every control point the disagreement is under
  // ten nanometres, so a tenth of a millimetre is four orders of magnitude
  // looser than the noise and four orders tighter than the best of these
  // transformations is published to.
  it.each(cases.map((c) => [c.id, c]))('%s', async (_id, c) => {
    const [x, y] = await fromWgs84(c.lon, c.lat, c.proj4)
    expect(Math.hypot(x - c.x, y - c.y)).toBeLessThan(TOLERANCE)
  })
})

describe('the registry', () => {
  it('is the same file the Python side reads, with every field filled in', () => {
    expect(Object.keys(REGISTRY).length).toBeGreaterThanOrEqual(17)
    for (const entry of systems()) {
      expect(entry.kind === 'geographic' || entry.kind === 'projected').toBe(true)
      expect(entry.proj4.startsWith('+proj=')).toBe(true)
      expect(entry.esri_wkt).toMatch(/^(PROJCS|GEOGCS)\[/)
      expect(entry.pt).toBeTruthy()
      expect(entry.control.length).toBeGreaterThan(0)
    }
  })

  it('separates the geographic systems from the projected ones', () => {
    expect(systems('geographic').length).toBe(3)
    expect(systems('projected').length).toBeGreaterThanOrEqual(14)
    expect(systems('geographic').map((s) => s.epsg)).toContain(4326)
  })

  it('flags Madeira 1936, which EPSG deprecated and gives no transformation for', () => {
    const entry = get(2191)
    expect(entry.deprecated).toBe(true)
    expect(entry.proj4).not.toContain('+towgs84')
    expect(entry.note).toContain('ballpark')
  })

  it('does not flag the two island systems that are still current', () => {
    expect(get(2942).deprecated).toBe(false)
    expect(get(3061).deprecated).toBe(false)
  })

  it('refuses an unknown code rather than defaulting to something', () => {
    expect(() => get(9999)).toThrow(/unknown coordinate system/)
  })
})

describe('round trips', () => {
  // Out and back within a centimetre, not zero: a seven-parameter Helmert is
  // applied in its linearised form and inverted by flipping the signs rather
  // than by the true matrix inverse, so it is not exact. The worst here is
  // under a centimetre, against transformations published to one metre.
  it.each(systems().map((s) => [`${s.epsg} ${s.pt}`, s]))('%s', async (_label, entry) => {
    for (const [lon, lat] of entry.control) {
      const [x, y] = await fromWgs84(lon, lat, entry.proj4)
      const [backLon, backLat] = await toWgs84(x, y, entry.proj4)
      const east = Math.abs(backLon - lon) * 111320 * Math.cos((lat * Math.PI) / 180)
      const north = Math.abs(backLat - lat) * 111320
      expect(Math.hypot(east, north)).toBeLessThan(0.01)
    }
  })
})

describe('the generic UTM hatch', () => {
  it('builds a definition for either hemisphere', () => {
    expect(utmProj4(33, true)).toContain('+south')
    expect(utmProj4(29)).not.toContain('+south')
    expect(utmProj4(29, false, 'ETRS89')).toContain('+ellps=GRS80')
  })

  it('refuses a zone that does not exist', () => {
    for (const zone of [0, 61, -1, 1.5]) {
      expect(() => utmProj4(zone)).toThrow(/between 1 and 60/)
    }
  })

  it('labels a zone the way the output columns are named', () => {
    expect(utmLabel(33, true)).toBe('UTM33S')
    expect(utmLabel(29)).toBe('UTM29N')
  })
})

describe('transformAll', () => {
  it('gives the same answers as the one-at-a-time path', async () => {
    const entry = get(3763)
    const pairs = entry.control
    const bulk = await transformAll(pairs, REGISTRY[WGS84].proj4, entry.proj4)
    for (let i = 0; i < pairs.length; i += 1) {
      const [x, y] = await fromWgs84(pairs[i][0], pairs[i][1], entry.proj4)
      expect(Math.hypot(bulk[i][0] - x, bulk[i][1] - y)).toBeLessThan(1e-9)
    }
  })

  it('carries a missing value through as missing rather than as a number', async () => {
    const out = await transformAll([[null, 38.5], [undefined, undefined], [-9.14, 38.72]],
      REGISTRY[WGS84].proj4, get(3763).proj4)
    expect(out[0]).toEqual([null, null])
    expect(out[1]).toEqual([null, null])
    expect(out[2][0]).toBeTypeOf('number')
  })
})

describe('esriWkt', () => {
  it('returns the registry sidecar for a known system, marked exact', () => {
    const { wkt, exact } = esriWkt(3763)
    expect(exact).toBe(true)
    expect(wkt).toBe(get(3763).esri_wkt)
  })

  it('falls back to WGS84 for anything not in the registry, and says so', () => {
    // A .prj that lies about its system is worse than one that is merely less
    // specific, so the caller is told rather than left to assume.
    const { wkt, exact } = esriWkt(null)
    expect(exact).toBe(false)
    expect(wkt).toBe(get(4326).esri_wkt)
  })
})
