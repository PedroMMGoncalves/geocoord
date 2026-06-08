"""Tests for the geospatial exporters."""
import io
import json
import zipfile

import shapefile

from geoexport import to_geojson, to_kml, to_shapefile_zip

FEATURES = [
    (-8.0, 39.0, {"name": "Lisboa", "value": 1}),
    (-8.61, 41.16, {"name": "Porto", "value": 2}),
]
FIELDS = ["name", "value"]


def test_geojson_structure():
    fc = json.loads(to_geojson(FEATURES).decode("utf-8"))
    assert fc["type"] == "FeatureCollection"
    assert len(fc["features"]) == 2
    f0 = fc["features"][0]
    assert f0["geometry"]["coordinates"] == [-8.0, 39.0]
    assert f0["properties"]["name"] == "Lisboa"


def test_kml_content():
    kml = to_kml(FEATURES, name_key="name").decode("utf-8")
    assert "<kml" in kml
    assert "-8.0,39.0,0" in kml
    assert "<name>Lisboa</name>" in kml


def test_shapefile_zip_roundtrip():
    data = to_shapefile_zip(FEATURES, FIELDS)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        names = set(z.namelist())
        assert {"coordinates.shp", "coordinates.shx", "coordinates.dbf",
                "coordinates.prj"} <= names
        shp = io.BytesIO(z.read("coordinates.shp"))
        shx = io.BytesIO(z.read("coordinates.shx"))
        dbf = io.BytesIO(z.read("coordinates.dbf"))
        prj = z.read("coordinates.prj").decode("utf-8")

    assert "WGS_1984" in prj
    reader = shapefile.Reader(shp=shp, shx=shx, dbf=dbf)
    assert reader.numRecords == 2
    pts = [s.points[0] for s in reader.shapes()]
    assert pts[0][0] == -8.0 and pts[0][1] == 39.0
    recs = reader.records()
    assert recs[0]["name"] == "Lisboa"


def test_shapefile_long_field_names_are_truncated():
    feats = [(-8.0, 39.0, {"a_very_long_attribute_name": "x"})]
    data = to_shapefile_zip(feats, ["a_very_long_attribute_name"])
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        dbf = io.BytesIO(z.read("coordinates.dbf"))
        shp = io.BytesIO(z.read("coordinates.shp"))
        shx = io.BytesIO(z.read("coordinates.shx"))
    reader = shapefile.Reader(shp=shp, shx=shx, dbf=dbf)
    field_names = [f[0] for f in reader.fields if f[0] != "DeletionFlag"]
    assert all(len(name) <= 10 for name in field_names)
