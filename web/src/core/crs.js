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
  if (x === null || y === null || x === undefined || y === undefined) return [null, null]
  const proj4 = await loadProj4()
  let out
  try {
    out = proj4(source, target, [Number(x), Number(y)])
  } catch {
    return [null, null]
  }
  if (!Number.isFinite(out[0]) || !Number.isFinite(out[1])) return [null, null]
  return [out[0], out[1]]
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
  const proj4 = await loadProj4()
  const converter = proj4(source, target)
  return pairs.map(([x, y]) => {
    if (x === null || y === null || x === undefined || y === undefined) return [null, null]
    let out
    try {
      out = converter.forward([Number(x), Number(y)])
    } catch {
      return [null, null]
    }
    if (!Number.isFinite(out[0]) || !Number.isFinite(out[1])) return [null, null]
    return [out[0], out[1]]
  })
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
