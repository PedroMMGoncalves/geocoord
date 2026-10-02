/**
 * Where a converted file came from, written into the file itself.
 *
 * A converted table outlives the session that made it: it goes into a report,
 * to a colleague, into a GIS project a year later. What it cannot say on its
 * own is how its coordinates were obtained - from which system, by which
 * transformation, read in which unit, with which rows corrected - and that is
 * exactly what a reader checking it needs. So every download that has room
 * for it carries it (see metadataText in geoexport.js for where each format
 * puts it), in the reader's language.
 *
 * Pure: the date and the version are passed in, so a test can pin the output.
 * The desktop builds the same list in English (provenance() in app.py).
 */
import { REGISTRY, WGS84_PROJ4 } from './crs.js'

/** A system as the file's reader would name it. */
function systemName(system) {
  if (system === null) return 'WGS 84 (EPSG:4326)'
  return system.epsg ? `${system.label} (EPSG:${system.epsg})` : system.label
}

/**
 * How a system's coordinates were moved onto WGS 84, in a sentence.
 *
 * The Portuguese datums carry DGT's transformations and say which; a modern
 * system is either WGS 84 itself or ETRS89/PTRA08, which are taken as WGS 84;
 * a pasted definition is moved by whatever datum terms it carries.
 */
export function transformationOf(t, system) {
  if (system === null || system.proj4 === WGS84_PROJ4 || /\+datum=WGS84\b/.test(system.proj4)) {
    return t('meta.noShift')
  }
  const entry = system.epsg ? REGISTRY[String(system.epsg)] : null
  if (entry?.transformation) {
    const key = `crs.transformation.${system.epsg}`
    const said = t(key)
    return said === key ? entry.transformation.accuracy : said
  }
  if (/\+(towgs84|nadgrids)=/.test(system.proj4)) return t('meta.ownShift')
  return t('meta.asWgs84')
}

/**
 * The metadata for one download: an ordered array of [label, value] pairs.
 *
 *   version, date     the application's version, the day of the download
 *   fileName, sheet   what was read; sheet only for a workbook
 *   input, output     the resolved systems ({proj4, label, epsg, suffix}),
 *                     input null for WGS 84 degrees, output null for none
 *   scale             1, or 1000 for a grid read as kilometres
 *   swaps, sheetFixes how many rows were corrected, by each review
 *   azores            {count, system} for rows read in an island system
 */
export function provenance(t, {
  version, date, fileName, sheet = null, input = null, output = null,
  scale = 1, swaps = 0, sheetFixes = 0, azores = null,
}) {
  const pairs = [
    [t('meta.app'), `GeoCoord ${version} (https://pedrommgoncalves.github.io/geocoord/)`],
    [t('meta.date'), date],
    [t('meta.file'), sheet ? t('meta.fileSheet', { name: fileName, sheet }) : fileName],
    [t('meta.input'), systemName(input)],
    [t('meta.transformation'), transformationOf(t, input)],
  ]
  const entry = input?.epsg ? REGISTRY[String(input.epsg)] : null
  if (entry?.transformation) pairs.push([t('meta.source'), entry.transformation.source])
  if (input !== null && input.proj4 !== WGS84_PROJ4) pairs.push([t('meta.proj4'), input.proj4])
  if (scale !== 1) pairs.push([t('meta.km'), t('meta.kmValue')])
  if (azores && azores.count > 0) {
    pairs.push([t('meta.azores'), t('meta.azoresValue', { n: azores.count, system: systemName(azores.system) })])
  }
  const fixes = []
  if (swaps > 0) fixes.push(t('meta.swaps', { n: swaps }))
  if (sheetFixes > 0) fixes.push(t('meta.sheetFixes', { n: sheetFixes }))
  if (fixes.length > 0) pairs.push([t('meta.fixes'), fixes.join('; ')])
  pairs.push([t('meta.degrees'), t('meta.degreesValue')])
  if (output !== null && output.proj4 !== WGS84_PROJ4) {
    pairs.push([t('meta.output'), t('meta.outputValue', {
      system: systemName(output),
      x: `X_${output.suffix}`,
      y: `Y_${output.suffix}`,
      how: transformationOf(t, output),
    })])
  }
  return pairs
}

/** Today, as the metadata writes it: YYYY-MM-DD, in the reader's own time zone. */
export function today(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
