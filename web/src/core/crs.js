/**
 * Coordinate reference systems (JavaScript port).
 *
 * Mirrors `geocoord/crs.py`, and reads the *same file* it does: the registry is
 * imported from `geocoord/crs_registry.json`, not copied here. Two copies of
 * fourteen datum definitions would be two copies to keep in step, and the whole
 * reason the definitions are data rather than code is that neither side gets to
 * have its own.
 *
 * Both implementations run the same proj4 definition - proj4js here, pyproj
 * there. That is what keeps them in step, and it is not the obvious choice:
 * pyproj could look each system up by EPSG code instead. It must not. PROJ 9
 * keeps datum transformations in its own catalogue and picks among them *per
 * point*, falling back to a ballpark offset outside an operation's declared
 * area, while proj4js has no catalogue and applies whatever `+towgs84` its
 * definition carries, everywhere. Off Madeira that difference is hundreds of
 * metres, and nothing on either side would say so.
 *
 * proj4 is fetched on demand, like SheetJS and JSZip: a file already in WGS84
 * never needs it.
 */
import registry from '../../../geocoord/crs_registry.json' with { type: 'json' }

export const REGISTRY = registry

/** The system every internal coordinate is expressed in. */
export const WGS84 = '4326'

/** proj4 definition of WGS84, the pivot every transformation passes through. */
export const WGS84_PROJ4 = registry[WGS84].proj4

/**
 * The two mainland datums move onto ETRS89 through DGT's NTv2 grids, which
 * live beside the registry and are read by both implementations. They are
 * fetched the first time a definition names one - a file in WGS84 or PT-TM06
 * never pays for them.
 */
const GRID_URLS = {
  'DLX_ETRS89_geo.gsb': new URL('../../../geocoord/grids/DLX_ETRS89_geo.gsb', import.meta.url).href,
  'D73_ETRS89_geo.gsb': new URL('../../../geocoord/grids/D73_ETRS89_geo.gsb', import.meta.url).href,
}

/**
 * definition -> the definition to use where it gives nothing: a grid
 * definition's Bursa-Wolf parameters, for a point outside the grid. Outside
 * mainland Portugal the old datums mean little, but a coordinate written in
 * kilometres and read as metres lands in the sea, and it has to land somewhere
 * for the application to notice and say so.
 */
const FALLBACK = new Map(
  Object.values(registry).filter((e) => e.fallback).map((e) => [e.proj4, e.fallback]),
)
const fallbackOf = (def) => FALLBACK.get(def) ?? def

const loadedGrids = new Map()

async function gridBytes(name) {
  if (globalThis.process?.versions?.node) {
    // Under test, in Node: the file beside the registry, read from disk. The
    // URL is built by concatenation so the bundler leaves it alone - in the
    // browser it is GRID_URLS, which the bundler turns into hashed assets.
    const file = new URL('../../../geocoord/grids/' + name, import.meta.url)
    if (file.protocol === 'file:') {
      const { readFile } = await import(/* @vite-ignore */ 'node:fs/promises')
      const buf = await readFile(file)
      // Copied into this realm's ArrayBuffer: proj4 tells an NTv2 file from a
      // GeoTIFF with instanceof, and a Node Buffer's backing store is not one
      // under a test DOM.
      const bytes = new ArrayBuffer(buf.byteLength)
      new Uint8Array(bytes).set(buf)
      return bytes
    }
  }
  const response = await fetch(GRID_URLS[name])
  if (!response.ok) throw new Error(`could not fetch the transformation grid ${name}`)
  return response.arrayBuffer()
}

/** Load every grid the definitions name, once. */
async function ensureGrids(proj4, ...defs) {
  for (const def of defs) {
    const m = /\+nadgrids=(\S+)/.exec(def ?? '')
    if (!m) continue
    for (const raw of m[1].split(',')) {
      const name = raw.replace(/^@/, '')
      if (name === 'null' || loadedGrids.has(name)) continue
      if (!GRID_URLS[name]) throw new Error(`unknown transformation grid ${name}`)
      // A grid that fails to load must say so. proj4 would otherwise find no
      // grid for any point, every point would take the Bursa-Wolf fallback,
      // and the whole file would come out a metre worse with nothing to show.
      const pending = gridBytes(name).then((bytes) => {
        const grid = proj4.nadgrid(name, bytes)
        if (!grid?.subgrids?.length) throw new Error(`could not read the transformation grid ${name}`)
        return grid
      })
      loadedGrids.set(name, pending)
    }
  }
  await Promise.all(defs.flatMap((def) => {
    const m = /\+nadgrids=(\S+)/.exec(def ?? '')
    return m ? m[1].split(',').map((n) => loadedGrids.get(n.replace(/^@/, ''))).filter(Boolean) : []
  }))
}

let proj4Promise = null
function loadProj4() {
  if (proj4Promise === null) {
    proj4Promise = import('proj4').then((m) => m.default ?? m)
  }
  return proj4Promise
}

/**
 * The registry as an array, in registry order, optionally filtered by kind.
 * `kind` is 'geographic' or 'projected'; omit it for both.
 */
export function systems(kind = null) {
  return Object.values(registry).filter((v) => kind === null || v.kind === kind)
}

/** One system's entry. Accepts the code as a string or a number. */
export function get(code) {
  const entry = registry[String(code)]
  if (entry === undefined) throw new Error(`unknown coordinate system: ${code}`)
  return entry
}

/**
 * A proj4 definition for a UTM zone, on WGS84 or ETRS89.
 *
 * The generic escape hatch: zones 1 to 60, either hemisphere. It covers Angola
 * (32S, 33S), Moçambique (36S, 37S), Cabo Verde, Guiné-Bissau and São Tomé e
 * Príncipe the moment somebody needs them, without this application having to
 * guess at national datums it cannot verify. Mirrors utm_proj4() in crs.py.
 */
export function utmProj4(zone, south = false, datum = 'WGS84') {
  const z = Number(zone)
  if (!Number.isInteger(z) || z < 1 || z > 60) {
    throw new Error(`UTM zone must be between 1 and 60, got ${zone}`)
  }
  const ellipsoid = datum.toUpperCase() === 'WGS84' ? '+datum=WGS84' : '+ellps=GRS80'
  return `+proj=utm +zone=${z}${south ? ' +south' : ''} ${ellipsoid} +units=m +no_defs`
}

/** The suffix used for a generic UTM zone's output columns, e.g. "UTM33S". */
export function utmLabel(zone, south = false) {
  return `UTM${Number(zone)}${south ? 'S' : 'N'}`
}

/**
 * Transform one coordinate between two proj4 definitions.
 *
 * Always x/y order - longitude then latitude for a geographic system, easting
 * then northing for a projected one - whatever axis order the authority
 * declares. Returns `[null, null]` for a value that cannot be transformed,
 * which is what a point outside a projection's domain gives, rather than the
 * infinities proj4 returns for one. Mirrors transform() in crs.py.
 */
export async function transform(x, y, source, target) {
  const [out] = await transformAll([[x, y]], source, target)
  return out
}

/** Transform into WGS84 longitude/latitude. Returns `[lon, lat]`. */
export function toWgs84(x, y, source) {
  return transform(x, y, source, WGS84_PROJ4)
}

/** Transform out of WGS84 into `target`. Returns `[x, y]`. */
export function fromWgs84(lon, lat, target) {
  return transform(lon, lat, WGS84_PROJ4, target)
}

/**
 * Transform a whole column at once, loading proj4 only once.
 *
 * The per-value `transform` awaits the module every call, which is free after
 * the first but still a promise per row; a fifty-thousand-row file is worth
 * one await.
 */
export async function transformAll(pairs, source, target) {
  const forward = await projector(source, target)
  return pairs.map(([x, y]) => {
    if (x === null || y === null || x === undefined || y === undefined) return [null, null]
    return forward(x, y) ?? [null, null]
  })
}

/**
 * A synchronous transformation between two definitions, once proj4 is here.
 *
 * For code that tries many candidates for a handful of rows - the sheet check
 * testing which simple mistake would put a point back - and should not await
 * each one. Returns null for a point proj4 cannot place.
 */
export async function projector(source, target) {
  // Always through WGS84, as in crs.py: each leg then takes its own grid, or
  // its own fallback where the grid gives nothing.
  if (source !== WGS84_PROJ4 && target !== WGS84_PROJ4) {
    const there = await projector(source, WGS84_PROJ4)
    const back = await projector(WGS84_PROJ4, target)
    return (x, y) => {
      const mid = there(x, y)
      return mid ? back(mid[0], mid[1]) : null
    }
  }
  const proj4 = await loadProj4()
  await ensureGrids(proj4, source, target)
  // proj4js logs every point a grid does not cover. A file in kilometres read
  // as metres is a whole column of them, and each one is answered by the
  // fallback anyway.
  const gridded = /\+nadgrids=/.test(`${source} ${target}`)
  const run = (converter, x, y) => {
    let out
    const log = console.log
    if (gridded) console.log = () => {}
    try {
      out = converter.forward([Number(x), Number(y)])
    } catch {
      return null
    } finally {
      if (gridded) console.log = log
    }
    return out && Number.isFinite(out[0]) && Number.isFinite(out[1]) ? [out[0], out[1]] : null
  }
  const converter = proj4(source, target)
  const hasFallback = fallbackOf(source) !== source || fallbackOf(target) !== target
  const fallback = hasFallback ? proj4(fallbackOf(source), fallbackOf(target)) : null
  return (x, y) => run(converter, x, y) ?? (fallback ? run(fallback, x, y) : null)
}

/**
 * ESRI WKT for a shapefile's `.prj` sidecar.
 *
 * Registry systems carry theirs precomputed by pyproj, which is the only side
 * that can produce it. A generic UTM zone or a pasted definition has none, so
 * the WGS84 sidecar is written and the caller is told - a `.prj` that lies
 * about its system is worse than one that is merely less specific.
 */
export function esriWkt(code = null) {
  if (code !== null && registry[String(code)] !== undefined) {
    return { wkt: registry[String(code)].esri_wkt, exact: true }
  }
  return { wkt: registry[WGS84].esri_wkt, exact: false }
}
