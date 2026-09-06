"""Reading KML, KMZ, GeoJSON and GPX.

What is pinned here is what real files do, not what the specifications say. Each
of these formats has two or three dialects in circulation, and a reader that
handles the one its author happened to test against returns empty columns for
the other two: a KML out of QGIS carries its attributes in SimpleData and one
out of Google Earth carries them nowhere at all, and a GPX off a receiver has no
waypoints in it whatsoever.

The cross-language half is in tests/fixtures/parity.json, sections "read_kml",
"read_geojson" and "read_gpx". These formats are text, so unlike Excel they can
be pinned byte for byte; only KMZ cannot, being a zip, so the archive is built
in memory here and its KML text goes in the contract instead.
"""
import io
import zipfile

from geocoord.georead import (
    is_geospatial,
    read_geojson_bytes,
    read_geospatial_bytes,
    read_gpx_bytes,
    read_kml_bytes,
)

KML_HEAD = ('<?xml version="1.0" encoding="UTF-8"?>'
            '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>')
KML_TAIL = "</Document></kml>"


def kml(body: str) -> bytes:
    return (KML_HEAD + body + KML_TAIL).encode("utf-8")


def gpx(body: str, version: str = "1.1") -> bytes:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<gpx version="{version}" creator="test" '
        f'xmlns="http://www.topografix.com/GPX/{version.replace(".", "/")}">'
        f"{body}</gpx>"
    ).encode("utf-8")


def columns_and_rows(result):
    return list(result.table.columns), result.table.values.tolist()


# ---------------------------------------------------------------------------
# KML
# ---------------------------------------------------------------------------

def test_kml_declares_the_columns_the_guess_looks_for():
    """The point of naming them Latitude and Longitude.

    Both are exact entries in LAT_CANDIDATES and LON_CANDIDATES, so
    guess_coordinate_columns finds them by name and never has to inspect a
    value. No separate mechanism was needed to declare them.
    """
    result = read_kml_bytes(kml(
        "<Placemark><name>P1</name>"
        "<Point><coordinates>33.5921,-16.1564</coordinates></Point></Placemark>"))
    columns, rows = columns_and_rows(result)
    assert columns == ["Nome", "Latitude", "Longitude"]
    assert rows == [["P1", "-16.1564", "33.5921"]]


def test_kml_coordinates_keep_the_text_the_file_wrote():
    """Parsing to a float and printing it again would move the value.

    The trailing zeros are not decoration: a column read by a person is not the
    place to silently renormalise their numbers.
    """
    result = read_kml_bytes(kml(
        "<Placemark><Point><coordinates>-8.61040,41.14960</coordinates></Point>"
        "</Placemark>"))
    assert result.table.values.tolist() == [["41.14960", "-8.61040"]]


def test_kml_reads_the_qgis_dialect():
    """SimpleData inside SchemaData, which is what QGIS and ogr2ogr write.

    A reader that only knew <Data> would return two empty columns from every
    file a GIS produced.
    """
    result = read_kml_bytes(kml(
        '<Placemark><ExtendedData><SchemaData schemaUrl="#minas">'
        '<SimpleData name="Nr_int">1</SimpleData>'
        '<SimpleData name="Designacao">Panasqueira</SimpleData>'
        "</SchemaData></ExtendedData>"
        "<Point><coordinates>-7.756,40.1717</coordinates></Point></Placemark>"))
    columns, rows = columns_and_rows(result)
    assert columns == ["Latitude", "Longitude", "Nr_int", "Designacao"]
    assert rows == [["40.1717", "-7.756", "1", "Panasqueira"]]


def test_kml_reads_a_data_element_that_carries_a_display_name():
    """ArcGIS writes <displayName> before <value>; the value is still the value."""
    result = read_kml_bytes(kml(
        '<Placemark><ExtendedData>'
        '<Data name="prof"><displayName>Profundidade</displayName>'
        "<value>124.5</value></Data></ExtendedData>"
        "<Point><coordinates>-8.6104,41.1496</coordinates></Point></Placemark>"))
    assert list(result.table.columns) == ["Latitude", "Longitude", "prof"]
    assert result.table["prof"].tolist() == ["124.5"]


def test_kml_reads_a_point_wrapped_in_a_multigeometry():
    """A MultiGeometry holding one Point is a wrapper, not a different shape."""
    result = read_kml_bytes(kml(
        "<Placemark><MultiGeometry>"
        "<Point><coordinates>-8.6104,41.1496</coordinates></Point>"
        "</MultiGeometry></Placemark>"))
    assert len(result.table) == 1
    assert result.notes == []


def test_kml_property_keys_are_unioned_across_every_placemark():
    """The first Placemark does not describe the file.

    GeoCoord's own writer omits a <Data> element entirely where the value is
    blank, so a reader that took its columns from the first point would drop
    every column that happened to be empty there.
    """
    result = read_kml_bytes(kml(
        '<Placemark><ExtendedData><Data name="a"><value>1</value></Data>'
        "</ExtendedData>"
        "<Point><coordinates>1,1</coordinates></Point></Placemark>"
        '<Placemark><ExtendedData><Data name="b"><value>2</value></Data>'
        "</ExtendedData>"
        "<Point><coordinates>2,2</coordinates></Point></Placemark>"))
    columns, rows = columns_and_rows(result)
    assert columns == ["Latitude", "Longitude", "a", "b"]
    assert rows == [["1", "1", "1", ""], ["2", "2", "", "2"]]


def test_kml_a_property_called_latitude_is_the_one_that_gets_renamed():
    """Our declared name wins the collision, not the file's.

    buildResult resolves a column by name, so two columns called Latitude would
    leave one of them permanently unselectable - and it must not be ours.
    """
    result = read_kml_bytes(kml(
        '<Placemark><ExtendedData><Data name="Latitude"><value>x</value></Data>'
        "</ExtendedData>"
        "<Point><coordinates>-8.6104,41.1496</coordinates></Point></Placemark>"))
    assert list(result.table.columns) == ["Latitude", "Longitude", "Latitude.1"]
    assert result.table["Latitude"].tolist() == ["41.1496"]


def test_kml_a_line_is_counted_rather_than_reduced_to_a_vertex():
    """A row is a point. A LineString has no row, and saying so beats guessing."""
    result = read_kml_bytes(kml(
        "<Placemark><LineString><coordinates>0,0 1,1</coordinates></LineString>"
        "</Placemark>"
        "<Placemark><Point><coordinates>2,2</coordinates></Point></Placemark>"))
    assert len(result.table) == 1
    assert result.notes == [{"code": "geo_skipped_non_points", "count": 1}]


def test_kml_altitude_is_dropped_when_it_is_the_zero_this_repo_writes():
    """to_kml always writes lon,lat,0, so reading one back must not add a column
    of zeros to the table and then to every export, for ever."""
    result = read_kml_bytes(kml(
        "<Placemark><Point><coordinates>1,1,0</coordinates></Point></Placemark>"))
    assert "Altitude" not in result.table.columns


def test_kml_altitude_is_kept_when_the_file_actually_has_one():
    result = read_kml_bytes(kml(
        "<Placemark><Point><coordinates>1,1,0</coordinates></Point></Placemark>"
        "<Placemark><Point><coordinates>2,2,214</coordinates></Point></Placemark>"))
    assert result.table["Altitude"].tolist() == ["0", "214"]


def test_kml_namespace_is_ignored():
    """Google's 2.0 and 2.1 namespaces, and files with none, are all real.

    Matching the namespace URI would reject most files in circulation for no
    benefit, the element names being unambiguous.
    """
    for opening in ('<kml xmlns="http://earth.google.com/kml/2.0">',
                    '<kml xmlns="http://www.opengis.net/kml/2.1">',
                    "<kml>"):
        source = (f'<?xml version="1.0"?>{opening}<Document><Placemark>'
                  "<Point><coordinates>1,2</coordinates></Point>"
                  "</Placemark></Document></kml>").encode("utf-8")
        assert len(read_kml_bytes(source).table) == 1, opening


def test_kml_a_description_holding_an_html_table_is_kept_whole():
    """Google Earth puts everything it knows in there and nothing structured is
    recoverable, so it is carried rather than guessed at or dropped."""
    result = read_kml_bytes(kml(
        "<Placemark><description><![CDATA[<b>Granito</b> alterado]]></description>"
        "<Point><coordinates>1,2</coordinates></Point></Placemark>"))
    assert result.table["description"].tolist() == ["<b>Granito</b> alterado"]


def test_kml_indented_coordinates_are_read():
    """Real files wrap and indent the element; only the first tuple is a point."""
    result = read_kml_bytes(kml(
        "<Placemark><Point><coordinates>\n      "
        "-8.6104,41.1496,0\n    </coordinates></Point></Placemark>"))
    assert result.table.values.tolist() == [["41.1496", "-8.6104"]]


def test_kml_refuses_a_file_that_is_not_xml():
    try:
        read_kml_bytes(b"<kml><Document><Placemark></Document>")
    except ValueError as e:
        assert "not valid XML" in str(e)
    else:
        raise AssertionError("a malformed document was accepted")


# ---------------------------------------------------------------------------
# KMZ
# ---------------------------------------------------------------------------

def kmz(entries: dict) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for path, content in entries.items():
            archive.writestr(path, content)
    return buffer.getvalue()


def test_kmz_is_recognised_by_its_bytes_not_its_name():
    """A zip starts with PK. A file saved as .kml that is really a KMZ - which
    is what happens when somebody renames one - still opens."""
    data = kmz({"doc.kml": (KML_HEAD + "<Placemark><name>Dentro</name>"
                            "<Point><coordinates>1,2</coordinates></Point>"
                            "</Placemark>" + KML_TAIL)})
    result = read_kml_bytes(data, "renamed.kml")
    assert result.table["Nome"].tolist() == ["Dentro"]


def test_kmz_prefers_doc_kml_but_takes_any_kml():
    body = ("<Placemark><name>{}</name>"
            "<Point><coordinates>1,2</coordinates></Point></Placemark>")
    both = kmz({"outro.kml": KML_HEAD + body.format("outro") + KML_TAIL,
                "doc.kml": KML_HEAD + body.format("doc") + KML_TAIL})
    assert read_kml_bytes(both, "a.kmz").table["Nome"].tolist() == ["doc"]

    only = kmz({"pasta/qualquer.kml": KML_HEAD + body.format("so este") + KML_TAIL})
    assert read_kml_bytes(only, "a.kmz").table["Nome"].tolist() == ["so este"]


def test_kmz_without_a_kml_says_so():
    try:
        read_kml_bytes(kmz({"leiame.txt": "nada aqui"}), "a.kmz")
    except ValueError as e:
        assert "no .kml" in str(e)
    else:
        raise AssertionError("an archive with no document was accepted")


# ---------------------------------------------------------------------------
# GPX
# ---------------------------------------------------------------------------

def test_gpx_reads_waypoints_with_their_fields():
    result = read_gpx_bytes(gpx(
        '<wpt lat="41.1496" lon="-8.6104"><ele>104</ele>'
        "<name>001</name><cmt>afloramento</cmt><sym>Flag, Blue</sym></wpt>"))
    columns, rows = columns_and_rows(result)
    assert columns == ["Nome", "Latitude", "Longitude", "Altitude", "cmt", "sym"]
    assert rows == [["001", "41.1496", "-8.6104", "104", "afloramento", "Flag, Blue"]]


def test_gpx_falls_back_to_the_track_when_there_are_no_waypoints():
    """The most ordinary file a receiver produces.

    A day's walk is exported as a track and nothing else, so a reader that only
    understood <wpt> would hand back an empty table from it.
    """
    result = read_gpx_bytes(gpx(
        '<trk><trkseg><trkpt lat="40.1717" lon="-7.756"><ele>612</ele></trkpt>'
        '<trkpt lat="40.1722" lon="-7.7551"><ele>615</ele></trkpt>'
        "</trkseg></trk>"))
    assert len(result.table) == 2
    assert result.notes == [{"code": "gpx_from_track", "count": 2}]


def test_gpx_falls_back_to_the_route_before_the_track():
    result = read_gpx_bytes(gpx(
        '<rte><rtept lat="41.1" lon="-8.6"><name>R1</name></rtept></rte>'
        '<trk><trkseg><trkpt lat="1" lon="1"/></trkseg></trk>'))
    assert result.table["Nome"].tolist() == ["R1"]
    assert result.notes == [{"code": "gpx_from_route", "count": 1}]


def test_gpx_waypoints_win_over_a_track_and_the_track_is_reported():
    """A track is thousands of rows a second apart, which is not what somebody
    converting a list of sample sites is asking for - but they should be told."""
    result = read_gpx_bytes(gpx(
        '<wpt lat="41.1496" lon="-8.6104"><name>001</name></wpt>'
        '<trk><trkseg><trkpt lat="1" lon="1"/><trkpt lat="2" lon="2"/>'
        "</trkseg></trk>"))
    assert len(result.table) == 1
    assert result.notes == [{"code": "gpx_ignored_tracks", "count": 2}]


def test_gpx_recovers_the_fields_ogr2ogr_hides_in_extensions():
    """Where a GPX exported from a GIS keeps everything that made it worth
    exporting. Without this the file arrives as bare coordinates."""
    result = read_gpx_bytes(gpx(
        '<wpt lat="37.8781" lon="-8.1653"><name>Aljustrel</name><extensions>'
        "<ogr:Nr_int>2</ogr:Nr_int><ogr:Situacao>Abandonada</ogr:Situacao>"
        "</extensions></wpt>").replace(
            b"<gpx ", b'<gpx xmlns:ogr="http://osgeo.org/gdal" '))
    assert list(result.table.columns) == [
        "Nome", "Latitude", "Longitude", "Nr_int", "Situacao"]
    assert result.table["Situacao"].tolist() == ["Abandonada"]


def test_gpx_1_0_is_read_the_same_way():
    result = read_gpx_bytes(gpx(
        '<wpt lat="41.1496" lon="-8.6104"><name>001</name></wpt>', version="1.0"))
    assert result.table["Nome"].tolist() == ["001"]


def test_gpx_with_no_points_at_all_gives_an_empty_table():
    result = read_gpx_bytes(gpx("<metadata><name>vazio</name></metadata>"))
    assert result.table.empty
    assert list(result.table.columns) == []


# ---------------------------------------------------------------------------
# GeoJSON
# ---------------------------------------------------------------------------

def test_geojson_reads_a_feature_collection():
    result = read_geojson_bytes(
        b'{"type":"FeatureCollection","features":[{"type":"Feature",'
        b'"properties":{"nome":"Katsabola"},'
        b'"geometry":{"type":"Point","coordinates":[33.5921,-16.1564]}}]}')
    columns, rows = columns_and_rows(result)
    assert columns == ["Latitude", "Longitude", "nome"]
    assert rows == [["-16.1564", "33.5921", "Katsabola"]]


def test_geojson_reads_a_bare_feature_and_a_bare_geometry():
    """Both are valid GeoJSON and both are exported by real tools."""
    feature = read_geojson_bytes(
        b'{"type":"Feature","properties":{"a":"1"},'
        b'"geometry":{"type":"Point","coordinates":[-8.1653,37.8781]}}')
    assert feature.table.values.tolist() == [["37.8781", "-8.1653", "1"]]

    geometry = read_geojson_bytes(b'{"type":"Point","coordinates":[-8.1653,37.8781]}')
    assert geometry.table.values.tolist() == [["37.8781", "-8.1653"]]


def test_geojson_a_whole_number_prints_whole():
    """An identifier column of 1, 2, 3 must not come out as 1.0, 2.0, 3.0.

    That is the same corruption read_csv_text was written to prevent, and it is
    also the only rule the JavaScript port can follow: JSON has one numeric type
    and nothing downstream of a parse can tell 7 from 7.0.
    """
    result = read_geojson_bytes(
        b'{"type":"Feature","properties":{"a":7,"b":7.0,"c":0.5,"d":true,"e":null},'
        b'"geometry":{"type":"Point","coordinates":[1,2]}}')
    assert result.table.values.tolist()[0][2:] == ["7", "7", "0.5", "true", ""]


def test_geojson_a_projected_system_is_detected_and_the_columns_say_metres():
    """A file in PT-TM06 read as degrees is rejected row by row with nothing to
    explain why. Calling a northing of 68811.71 a latitude is the lie that would
    make it happen."""
    result = read_geojson_bytes(
        b'{"type":"FeatureCollection",'
        b'"crs":{"type":"name","properties":{"name":"urn:ogc:def:crs:EPSG::3763"}},'
        b'"features":[{"type":"Feature","properties":{},'
        b'"geometry":{"type":"Point","coordinates":[19167.28,68811.71]}}]}')
    assert result.crs == "EPSG:3763"
    assert list(result.table.columns) == ["Y", "X"]
    assert result.notes == [{"code": "geojson_crs", "crs": "EPSG:3763"}]


def test_geojson_wgs84_by_any_of_its_names_is_not_reported():
    """QGIS writes the CRS84 urn on files that are plainly WGS84; warning about
    those would train the user to ignore the warning that matters."""
    for urn in ("urn:ogc:def:crs:OGC:1.3:CRS84", "urn:ogc:def:crs:EPSG::4326",
                "EPSG:4326"):
        source = ('{"type":"FeatureCollection","crs":{"type":"name",'
                  f'"properties":{{"name":"{urn}"}}}},"features":[]}}')
        assert read_geojson_bytes(source.encode("utf-8")).crs is None, urn


def test_geojson_an_id_outside_properties_becomes_a_column():
    """It is usually the only stable identifier the file has."""
    result = read_geojson_bytes(
        b'{"type":"Feature","id":"A1","properties":{"nome":"x"},'
        b'"geometry":{"type":"Point","coordinates":[1,2]}}')
    assert list(result.table.columns) == ["Latitude", "Longitude", "id", "nome"]


def test_geojson_a_nested_value_is_written_back_rather_than_dropped():
    result = read_geojson_bytes(
        b'{"type":"Feature","properties":{"extra":{"a":1,"b":[2,3]}},'
        b'"geometry":{"type":"Point","coordinates":[1,2]}}')
    assert result.table["extra"].tolist() == ['{"a":1,"b":[2,3]}']


def test_geojson_skips_what_has_no_position_and_counts_it():
    result = read_geojson_bytes(
        b'{"type":"FeatureCollection","features":['
        b'{"type":"Feature","properties":{},"geometry":'
        b'{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]}},'
        b'{"type":"Feature","properties":{},"geometry":null},'
        b'{"type":"Feature","properties":{},"geometry":'
        b'{"type":"Point","coordinates":[1,2]}}]}')
    assert len(result.table) == 1
    assert result.notes == [{"code": "geo_skipped_non_points", "count": 2}]


def test_geojson_a_multipoint_is_read_as_its_first_point():
    result = read_geojson_bytes(
        b'{"type":"Feature","properties":{},"geometry":'
        b'{"type":"MultiPoint","coordinates":[[31.3067,-15.4254],[31.4,-15.5]]}}')
    assert result.table.values.tolist() == [["-15.4254", "31.3067"]]


def test_geojson_a_byte_order_mark_is_not_part_of_the_json():
    result = read_geojson_bytes(
        "﻿".encode("utf-8")
        + b'{"type":"Point","coordinates":[1,2]}')
    assert len(result.table) == 1


def test_geojson_refuses_a_file_that_is_not_json():
    try:
        read_geojson_bytes(b'{"type":"FeatureCollection",')
    except ValueError as e:
        assert "not valid JSON" in str(e)
    else:
        raise AssertionError("a malformed document was accepted")


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

def test_is_geospatial_covers_every_extension_the_reader_handles():
    for name in ("a.kml", "A.KMZ", "b.geojson", "c.json", "d.gpx", "e.KML"):
        assert is_geospatial(name), name
    for name in ("a.csv", "b.xlsx", "c.txt", "kml", "a.kml.xlsx"):
        assert not is_geospatial(name), name


def test_read_geospatial_bytes_dispatches_by_extension():
    point = b'{"type":"Point","coordinates":[1,2]}'
    assert len(read_geospatial_bytes(point, "a.geojson").table) == 1
    assert len(read_geospatial_bytes(point, "a.json").table) == 1

    document = kml("<Placemark><Point><coordinates>1,2</coordinates></Point>"
                   "</Placemark>")
    assert len(read_geospatial_bytes(document, "a.kml").table) == 1

    track = gpx('<wpt lat="1" lon="2"/>')
    assert len(read_geospatial_bytes(track, "a.gpx").table) == 1


def test_read_geospatial_bytes_refuses_anything_else():
    try:
        read_geospatial_bytes(b"a,b\n1,2\n", "a.csv")
    except ValueError as e:
        assert "not a geospatial file" in str(e)
    else:
        raise AssertionError("a CSV was accepted by the geospatial reader")


# ---------------------------------------------------------------------------
# Size
# ---------------------------------------------------------------------------

def test_a_file_past_the_byte_limit_is_refused_before_it_is_parsed():
    """The cell limit bounds the table, which is no help: the document is parsed
    whole into a tree before there is a row to count."""
    from geocoord.reader import FileTooLarge, MAX_XLSX_BYTES

    oversized = b'{"type":"FeatureCollection","features":[]}' \
        + b" " * (MAX_XLSX_BYTES + 1)
    try:
        read_geojson_bytes(oversized)
    except FileTooLarge as e:
        assert e.kind == "bytes"
        assert e.limit == MAX_XLSX_BYTES
    else:
        raise AssertionError("an oversized file was parsed")
