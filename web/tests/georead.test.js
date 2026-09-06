// @vitest-environment jsdom
//
// Reading KML, KMZ, GeoJSON and GPX in the browser.
//
// jsdom is declared here rather than for the whole suite: this is the only
// module that needs a DOM, and it needs it for one reason - DOMParser. Node has
// none, and the alternative was shipping a hand-rolled XML parser to users when
// every browser already carries a tested one. The arrangement matches the CSV
// reader's, where Python's stdlib csv and PapaParse are also two different
// parsers and what the contract pins is the resulting table.
//
// The Python half is tests/test_georead.py. What both pin is what real files
// do, not what the specifications say: each format has two or three dialects in
// circulation, and a reader that handles only the author's own returns empty
// columns for the rest.
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import {
  isGeospatial,
  readGeoJsonBytes,
  readGeospatialBytes,
  readGpxBytes,
  readKmlBytes,
} from '../src/core/georead.js'
import { FileTooLarge, MAX_XLSX_BYTES } from '../src/core/reader.js'
import fixtures from '../../tests/fixtures/parity.json' with { type: 'json' }

const KML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>'
  + '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'
const KML_TAIL = '</Document></kml>'

const bytes = (s) => new TextEncoder().encode(s)
const kml = (body) => bytes(KML_HEAD + body + KML_TAIL)
const gpx = (body, version = '1.1') => bytes(
  '<?xml version="1.0" encoding="UTF-8"?>'
  + `<gpx version="${version}" creator="test" `
  + `xmlns="http://www.topografix.com/GPX/${version.replace('.', '/')}">`
  + `${body}</gpx>`,
)

describe('readKmlBytes', () => {
  it('declares the columns the guess looks for', async () => {
    // Latitude and Longitude are exact entries in LAT_CANDIDATES and
    // LON_CANDIDATES, so guessCoordinateColumns finds them by name and never
    // has to inspect a value. No separate mechanism was needed.
    const r = await readKmlBytes(kml(
      '<Placemark><name>P1</name>'
      + '<Point><coordinates>33.5921,-16.1564</coordinates></Point></Placemark>'))
    expect(r.table.columns).toEqual(['Nome', 'Latitude', 'Longitude'])
    expect(r.table.rows).toEqual([['P1', '-16.1564', '33.5921']])
  })

  it('keeps the coordinate text the file wrote', async () => {
    // Parsing to a number and printing it again would renormalise somebody's
    // values in a column they are going to read.
    const r = await readKmlBytes(kml(
      '<Placemark><Point><coordinates>-8.61040,41.14960</coordinates></Point>'
      + '</Placemark>'))
    expect(r.table.rows).toEqual([['41.14960', '-8.61040']])
  })

  it('reads the SimpleData dialect QGIS and ogr2ogr write', async () => {
    const r = await readKmlBytes(kml(
      '<Placemark><ExtendedData><SchemaData schemaUrl="#minas">'
      + '<SimpleData name="Nr_int">1</SimpleData>'
      + '<SimpleData name="Designacao">Panasqueira</SimpleData>'
      + '</SchemaData></ExtendedData>'
      + '<Point><coordinates>-7.756,40.1717</coordinates></Point></Placemark>'))
    expect(r.table.columns).toEqual(['Latitude', 'Longitude', 'Nr_int', 'Designacao'])
    expect(r.table.rows).toEqual([['40.1717', '-7.756', '1', 'Panasqueira']])
  })

  it('reads a Data element that carries a display name', async () => {
    const r = await readKmlBytes(kml(
      '<Placemark><ExtendedData>'
      + '<Data name="prof"><displayName>Profundidade</displayName>'
      + '<value>124.5</value></Data></ExtendedData>'
      + '<Point><coordinates>-8.6104,41.1496</coordinates></Point></Placemark>'))
    expect(r.table.columns).toEqual(['Latitude', 'Longitude', 'prof'])
    expect(r.table.rows[0][2]).toBe('124.5')
  })

  it('reads a point wrapped in a MultiGeometry', async () => {
    const r = await readKmlBytes(kml(
      '<Placemark><MultiGeometry>'
      + '<Point><coordinates>-8.6104,41.1496</coordinates></Point>'
      + '</MultiGeometry></Placemark>'))
    expect(r.table.rows).toHaveLength(1)
    expect(r.notes).toEqual([])
  })

  it('unions the property keys across every placemark', async () => {
    // GeoCoord's own writer omits a <Data> element where the value is blank, so
    // the first Placemark does not describe the file.
    const r = await readKmlBytes(kml(
      '<Placemark><ExtendedData><Data name="a"><value>1</value></Data>'
      + '</ExtendedData><Point><coordinates>1,1</coordinates></Point></Placemark>'
      + '<Placemark><ExtendedData><Data name="b"><value>2</value></Data>'
      + '</ExtendedData><Point><coordinates>2,2</coordinates></Point></Placemark>'))
    expect(r.table.columns).toEqual(['Latitude', 'Longitude', 'a', 'b'])
    expect(r.table.rows).toEqual([['1', '1', '1', ''], ['2', '2', '', '2']])
  })

  it('renames the file property, not its own, when both are called Latitude', async () => {
    // buildResult resolves a column by name, so a duplicate is a column that
    // can never be selected - and it must not be ours.
    const r = await readKmlBytes(kml(
      '<Placemark><ExtendedData><Data name="Latitude"><value>x</value></Data>'
      + '</ExtendedData>'
      + '<Point><coordinates>-8.6104,41.1496</coordinates></Point></Placemark>'))
    expect(r.table.columns).toEqual(['Latitude', 'Longitude', 'Latitude.1'])
    expect(r.table.rows[0][0]).toBe('41.1496')
  })

  it('counts a line rather than reducing it to a vertex', async () => {
    const r = await readKmlBytes(kml(
      '<Placemark><LineString><coordinates>0,0 1,1</coordinates></LineString>'
      + '</Placemark>'
      + '<Placemark><Point><coordinates>2,2</coordinates></Point></Placemark>'))
    expect(r.table.rows).toHaveLength(1)
    expect(r.notes).toEqual([{ code: 'geo_skipped_non_points', count: 1 }])
  })

  it('drops the altitude when it is the zero this repo writes', async () => {
    const r = await readKmlBytes(kml(
      '<Placemark><Point><coordinates>1,1,0</coordinates></Point></Placemark>'))
    expect(r.table.columns).not.toContain('Altitude')
  })

  it('keeps the altitude when the file actually has one', async () => {
    const r = await readKmlBytes(kml(
      '<Placemark><Point><coordinates>1,1,0</coordinates></Point></Placemark>'
      + '<Placemark><Point><coordinates>2,2,214</coordinates></Point></Placemark>'))
    expect(r.table.columns).toContain('Altitude')
    expect(r.table.rows.map((row) => row[2])).toEqual(['0', '214'])
  })

  it.each([
    ['google 2.0', '<kml xmlns="http://earth.google.com/kml/2.0">'],
    ['ogc 2.1', '<kml xmlns="http://www.opengis.net/kml/2.1">'],
    ['none at all', '<kml>'],
  ])('ignores the namespace: %s', async (_name, opening) => {
    const r = await readKmlBytes(bytes(
      `<?xml version="1.0"?>${opening}<Document><Placemark>`
      + '<Point><coordinates>1,2</coordinates></Point>'
      + '</Placemark></Document></kml>'))
    expect(r.table.rows).toHaveLength(1)
  })

  it('keeps a description holding an HTML table whole', async () => {
    const r = await readKmlBytes(kml(
      '<Placemark><description><![CDATA[<b>Granito</b> alterado]]></description>'
      + '<Point><coordinates>1,2</coordinates></Point></Placemark>'))
    expect(r.table.rows[0][2]).toBe('<b>Granito</b> alterado')
  })

  it('reads coordinates that are wrapped and indented', async () => {
    const r = await readKmlBytes(kml(
      '<Placemark><Point><coordinates>\n      '
      + '-8.6104,41.1496,0\n    </coordinates></Point></Placemark>'))
    expect(r.table.rows).toEqual([['41.1496', '-8.6104']])
  })

  it('refuses a file that is not XML', async () => {
    await expect(readKmlBytes(bytes('<kml><Document><Placemark></Document>')))
      .rejects.toThrow(/not valid XML/)
  })
})

describe('readKmlBytes with a KMZ', () => {
  const archive = async (entries) => {
    const zip = new JSZip()
    for (const [path, content] of Object.entries(entries)) zip.file(path, content)
    return zip.generateAsync({ type: 'uint8array' })
  }
  const placemark = (name) => `<Placemark><name>${name}</name>`
    + '<Point><coordinates>1,2</coordinates></Point></Placemark>'

  it('recognises a zip by its bytes, not by its name', async () => {
    const data = await archive({ 'doc.kml': KML_HEAD + placemark('Dentro') + KML_TAIL })
    const r = await readKmlBytes(data, 'renamed.kml')
    expect(r.table.rows[0][0]).toBe('Dentro')
  })

  it('prefers doc.kml but takes any kml', async () => {
    const both = await archive({
      'outro.kml': KML_HEAD + placemark('outro') + KML_TAIL,
      'doc.kml': KML_HEAD + placemark('doc') + KML_TAIL,
    })
    expect((await readKmlBytes(both, 'a.kmz')).table.rows[0][0]).toBe('doc')

    const only = await archive({
      'pasta/qualquer.kml': KML_HEAD + placemark('so este') + KML_TAIL,
    })
    expect((await readKmlBytes(only, 'a.kmz')).table.rows[0][0]).toBe('so este')
  })

  it('says so when the archive holds no document', async () => {
    const data = await archive({ 'leiame.txt': 'nada aqui' })
    await expect(readKmlBytes(data, 'a.kmz')).rejects.toThrow(/no \.kml/)
  })
})

describe('readGpxBytes', () => {
  it('reads waypoints with their fields', () => {
    const r = readGpxBytes(gpx(
      '<wpt lat="41.1496" lon="-8.6104"><ele>104</ele>'
      + '<name>001</name><cmt>afloramento</cmt><sym>Flag, Blue</sym></wpt>'))
    expect(r.table.columns).toEqual(
      ['Nome', 'Latitude', 'Longitude', 'Altitude', 'cmt', 'sym'])
    expect(r.table.rows).toEqual(
      [['001', '41.1496', '-8.6104', '104', 'afloramento', 'Flag, Blue']])
  })

  it('falls back to the track when there are no waypoints', () => {
    // A day's walk off a receiver is a track and nothing else, so a reader that
    // only understood <wpt> would return an empty table from it.
    const r = readGpxBytes(gpx(
      '<trk><trkseg><trkpt lat="40.1717" lon="-7.756"><ele>612</ele></trkpt>'
      + '<trkpt lat="40.1722" lon="-7.7551"><ele>615</ele></trkpt>'
      + '</trkseg></trk>'))
    expect(r.table.rows).toHaveLength(2)
    expect(r.notes).toEqual([{ code: 'gpx_from_track', count: 2 }])
  })

  it('falls back to the route before the track', () => {
    const r = readGpxBytes(gpx(
      '<rte><rtept lat="41.1" lon="-8.6"><name>R1</name></rtept></rte>'
      + '<trk><trkseg><trkpt lat="1" lon="1"/></trkseg></trk>'))
    expect(r.table.rows[0][0]).toBe('R1')
    expect(r.notes).toEqual([{ code: 'gpx_from_route', count: 1 }])
  })

  it('lets the waypoints win and reports the track', () => {
    const r = readGpxBytes(gpx(
      '<wpt lat="41.1496" lon="-8.6104"><name>001</name></wpt>'
      + '<trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="2" lon="2"/>'
      + '</trkseg></trk>'))
    expect(r.table.rows).toHaveLength(1)
    expect(r.notes).toEqual([{ code: 'gpx_ignored_tracks', count: 2 }])
  })

  it('recovers the fields ogr2ogr hides in extensions', () => {
    // Where a GPX exported from a GIS keeps everything that made it worth
    // exporting. Without this the file arrives as bare coordinates.
    const r = readGpxBytes(bytes(
      '<?xml version="1.0" encoding="UTF-8"?>'
      + '<gpx version="1.0" creator="GDAL" '
      + 'xmlns="http://www.topografix.com/GPX/1/0" '
      + 'xmlns:ogr="http://osgeo.org/gdal">'
      + '<wpt lat="37.8781" lon="-8.1653"><name>Aljustrel</name><extensions>'
      + '<ogr:Nr_int>2</ogr:Nr_int><ogr:Situacao>Abandonada</ogr:Situacao>'
      + '</extensions></wpt></gpx>'))
    expect(r.table.columns).toEqual(
      ['Nome', 'Latitude', 'Longitude', 'Nr_int', 'Situacao'])
    expect(r.table.rows[0][4]).toBe('Abandonada')
  })

  it('reads GPX 1.0 the same way', () => {
    const r = readGpxBytes(gpx(
      '<wpt lat="41.1496" lon="-8.6104"><name>001</name></wpt>', '1.0'))
    expect(r.table.rows[0][0]).toBe('001')
  })

  it('gives an empty table when there are no points at all', () => {
    const r = readGpxBytes(gpx('<metadata><name>vazio</name></metadata>'))
    expect(r.table).toEqual({ columns: [], rows: [] })
  })
})

describe('readGeoJsonBytes', () => {
  it('reads a feature collection', () => {
    const r = readGeoJsonBytes(bytes(
      '{"type":"FeatureCollection","features":[{"type":"Feature",'
      + '"properties":{"nome":"Katsabola"},'
      + '"geometry":{"type":"Point","coordinates":[33.5921,-16.1564]}}]}'))
    expect(r.table.columns).toEqual(['Latitude', 'Longitude', 'nome'])
    expect(r.table.rows).toEqual([['-16.1564', '33.5921', 'Katsabola']])
  })

  it('reads a bare feature and a bare geometry', () => {
    const feature = readGeoJsonBytes(bytes(
      '{"type":"Feature","properties":{"a":"1"},'
      + '"geometry":{"type":"Point","coordinates":[-8.1653,37.8781]}}'))
    expect(feature.table.rows).toEqual([['37.8781', '-8.1653', '1']])

    const geometry = readGeoJsonBytes(bytes(
      '{"type":"Point","coordinates":[-8.1653,37.8781]}'))
    expect(geometry.table.rows).toEqual([['37.8781', '-8.1653']])
  })

  it('prints a whole number whole', () => {
    // An identifier column of 1, 2, 3 must not come out as 1.0, 2.0, 3.0 - the
    // corruption readCsvText was written to prevent. It is also the only rule
    // both ports can follow: nothing downstream of a parse tells 7 from 7.0.
    const r = readGeoJsonBytes(bytes(
      '{"type":"Feature","properties":{"a":7,"b":7.0,"c":0.5,"d":true,"e":null},'
      + '"geometry":{"type":"Point","coordinates":[1,2]}}'))
    expect(r.table.rows[0].slice(2)).toEqual(['7', '7', '0.5', 'true', ''])
  })

  it('detects a projected system and names the columns X and Y', () => {
    // A file in PT-TM06 read as degrees is rejected row by row with nothing to
    // explain why. Calling a northing of 68811.71 a latitude causes that.
    const r = readGeoJsonBytes(bytes(
      '{"type":"FeatureCollection",'
      + '"crs":{"type":"name","properties":{"name":"urn:ogc:def:crs:EPSG::3763"}},'
      + '"features":[{"type":"Feature","properties":{},'
      + '"geometry":{"type":"Point","coordinates":[19167.28,68811.71]}}]}'))
    expect(r.crs).toBe('EPSG:3763')
    expect(r.table.columns).toEqual(['Y', 'X'])
    expect(r.notes).toEqual([{ code: 'geojson_crs', crs: 'EPSG:3763' }])
  })

  it.each([
    ['crs84', 'urn:ogc:def:crs:OGC:1.3:CRS84'],
    ['epsg urn', 'urn:ogc:def:crs:EPSG::4326'],
    ['plain epsg', 'EPSG:4326'],
  ])('does not report WGS84 written as %s', (_name, urn) => {
    const r = readGeoJsonBytes(bytes(
      '{"type":"FeatureCollection","crs":{"type":"name",'
      + `"properties":{"name":"${urn}"}},"features":[]}`))
    expect(r.crs).toBeNull()
  })

  it('carries an id from outside properties as its own column', () => {
    const r = readGeoJsonBytes(bytes(
      '{"type":"Feature","id":"A1","properties":{"nome":"x"},'
      + '"geometry":{"type":"Point","coordinates":[1,2]}}'))
    expect(r.table.columns).toEqual(['Latitude', 'Longitude', 'id', 'nome'])
  })

  it('writes a nested value back rather than dropping it', () => {
    const r = readGeoJsonBytes(bytes(
      '{"type":"Feature","properties":{"extra":{"a":1,"b":[2,3]}},'
      + '"geometry":{"type":"Point","coordinates":[1,2]}}'))
    expect(r.table.rows[0][2]).toBe('{"a":1,"b":[2,3]}')
  })

  it('skips what has no position and counts it', () => {
    const r = readGeoJsonBytes(bytes(
      '{"type":"FeatureCollection","features":['
      + '{"type":"Feature","properties":{},"geometry":'
      + '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}},'
      + '{"type":"Feature","properties":{},"geometry":null},'
      + '{"type":"Feature","properties":{},"geometry":'
      + '{"type":"Point","coordinates":[1,2]}}]}'))
    expect(r.table.rows).toHaveLength(1)
    expect(r.notes).toEqual([{ code: 'geo_skipped_non_points', count: 2 }])
  })

  it('reads a MultiPoint as its first point', () => {
    const r = readGeoJsonBytes(bytes(
      '{"type":"Feature","properties":{},"geometry":'
      + '{"type":"MultiPoint","coordinates":[[31.3067,-15.4254],[31.4,-15.5]]}}'))
    expect(r.table.rows).toEqual([['-15.4254', '31.3067']])
  })

  it('does not take a byte-order mark for part of the JSON', () => {
    const r = readGeoJsonBytes(bytes('﻿{"type":"Point","coordinates":[1,2]}'))
    expect(r.table.rows).toHaveLength(1)
  })

  it('refuses a file that is not JSON', () => {
    expect(() => readGeoJsonBytes(bytes('{"type":"FeatureCollection",')))
      .toThrow(/not valid JSON/)
  })
})

describe('the geospatial dispatch', () => {
  it.each([
    ['a.kml', true], ['A.KMZ', true], ['b.geojson', true],
    ['c.json', true], ['d.gpx', true], ['e.KML', true],
    ['a.csv', false], ['b.xlsx', false], ['kml', false], ['a.kml.xlsx', false],
  ])('isGeospatial(%s) is %s', (name, expected) => {
    expect(isGeospatial(name)).toBe(expected)
  })

  it('dispatches by extension', async () => {
    const point = bytes('{"type":"Point","coordinates":[1,2]}')
    expect((await readGeospatialBytes(point, 'a.geojson')).table.rows).toHaveLength(1)
    expect((await readGeospatialBytes(point, 'a.json')).table.rows).toHaveLength(1)

    const document = kml('<Placemark><Point><coordinates>1,2</coordinates>'
      + '</Point></Placemark>')
    expect((await readGeospatialBytes(document, 'a.kml')).table.rows).toHaveLength(1)

    const track = gpx('<wpt lat="1" lon="2"/>')
    expect((await readGeospatialBytes(track, 'a.gpx')).table.rows).toHaveLength(1)
  })

  it('refuses anything else', async () => {
    await expect(readGeospatialBytes(bytes('a,b\n1,2\n'), 'a.csv'))
      .rejects.toThrow(/not a geospatial file/)
  })
})

describe('size limits', () => {
  it('refuses a file past the byte limit before parsing it', () => {
    // The cell limit bounds the table, which is no help: the document is parsed
    // whole into a tree before there is a row to count.
    const oversized = new Uint8Array(MAX_XLSX_BYTES + 1)
    try {
      readGeoJsonBytes(oversized)
    } catch (e) {
      expect(e).toBeInstanceOf(FileTooLarge)
      expect(e.kind).toBe('bytes')
      expect(e.limit).toBe(MAX_XLSX_BYTES)
      return
    }
    throw new Error('an oversized file was parsed')
  })
})

describe('the shared contract', () => {
  // KML, GeoJSON and GPX are plain text, so unlike Excel they can be pinned
  // across the two ports directly. What is compared is the raw reader output
  // rather than the tidied table: the point of these readers is the columns
  // they declare and the notes they return, and tidying drops an all-empty
  // column before either can be seen.
  //
  // KMZ is absent because the contract carries only JSON-representable inputs
  // and an archive is bytes; each side builds one in its own tests above, and
  // what is pinned here is the KML text that would go inside it.
  it.each(fixtures.read_geospatial.map((c) => [c.id, c]))('%s', async (_id, c) => {
    const read = await readGeospatialBytes(new TextEncoder().encode(c.text), c.name)
    expect(read.table.columns).toEqual(c.expected.columns)
    expect(read.table.rows).toEqual(c.expected.rows)
    expect(read.notes).toEqual(c.expected.notes)
    expect(read.crs ?? null).toEqual(c.expected.crs)
  })
})
