"""The desktop application, driven the way a person drives it.

Everything else in this suite tests a function. This file runs ``app.py`` whole
through Streamlit's own simulator - no browser, no server - uploading a file,
choosing from the pickers, pressing the buttons and reading what the page then
says. What it pins is not in any function: it is in the order the steps run
and in what each rerun keeps, which is where the desktop's faults have been.
Two of them were found only by driving the application by hand: a projected
file whose pickers kept the pair guessed while it was read as degrees, so the
one labelled Easting pointed at the northings; and a region suggestion that
moved the picker but could not supply the sign, leaving every point in Sudan.

Every file here is synthetic.

The main CI job does not install Streamlit, so there this module skips itself.
The desktop job sets ``GEOCOORD_DESKTOP_TESTS`` so that a missing Streamlit
fails instead of skipping - a suite that quietly runs nothing is worse than one
that fails.
"""
import json
import os
import pathlib
import re

import pytest

if os.environ.get("GEOCOORD_DESKTOP_TESTS"):
    import streamlit  # noqa: F401
else:
    pytest.importorskip("streamlit")

from streamlit.testing.v1 import AppTest  # noqa: E402

APP = str(pathlib.Path(__file__).resolve().parents[1] / "app.py")


# --------------------------------------------------------------------------
# Synthetic files
# --------------------------------------------------------------------------

def csv(*lines):
    return ("\n".join(lines) + "\n").encode("utf-8")


# Six points around Lisbon, in degrees.
CLEAN = csv("nome,lat,lon", "A,38.7,-9.1", "B,38.8,-9.2", "C,38.6,-9.0",
            "D,38.75,-9.15", "E,38.72,-9.05", "F,38.68,-9.12")

# The same, and a seventh written the other way round.
ONE_REVERSED = csv("nome,lat,lon", "A,38.7,-9.1", "B,38.8,-9.2", "C,38.6,-9.0",
                   "D,38.75,-9.15", "E,38.72,-9.05", "F,38.68,-9.12",
                   "G,-9.14,38.73")

# Around Castelo Branco in the military grid (EPSG:20790), as a 1:25000 sheet's
# margin prints it: in kilometres, beside the sheet number.
SHEET_KM = csv("Folha,M,P", "282,252.52,315.15", "282,252.76,314.16",
               "281,251.28,316.70", "292,257.86,320.21", "282,255.19,315.35",
               "292,260.78,314.71")

# The same points in metres.
SHEET_M = csv("Folha,M,P", "282,252520,315150", "282,252760,314160",
              "281,251280,316700", "292,257860,320210", "282,255190,315350",
              "292,260780,314710")

# The same points in metres, under the plain names.
GRID_XY = csv("nome,X,Y", "A,252520,315150", "B,252760,314160",
              "C,251280,316700", "D,257860,320210", "E,255190,315350",
              "F,260780,314710")

# Central Moçambique written without hemispheres, as a field notebook from the
# southern hemisphere routinely is. Read literally, it is Sudan.
UNSIGNED_SOUTH = csv("nome,lat,lon",
                     "A,18 55 18,33 51 41", "B,19 07 52,34 14 48",
                     "C,18 49 29,34 00 20", "D,19 07 04,33 33 00",
                     "E,19 10 10,33 24 01", "F,18 36 36,34 17 16")

# Points DGT's own transformation service moved from the military grid to
# PT-TM06, written to the millimetre as the grid's originals are.
_DGT = [c for c in json.loads(
    (pathlib.Path(__file__).parent / "fixtures" / "dgt_reference.json").read_text(encoding="utf-8")
)["cases"] if (c["source"], c["target"], c["method"]) == ("20790", "3763", "grelhas")][:6]
MILLIMETRES = csv("nome,M,P", *(f"{c['id']},{c['x']},{c['y']}" for c in _DGT))

# One column: what a wrongly guessed separator produces.
ONE_COLUMN = csv("coordenadas", "38.7 -9.1", "38.8 -9.2", "38.6 -9.0")


def geojson(features, crs=None):
    doc = {"type": "FeatureCollection", "features": features}
    if crs is not None:
        doc["crs"] = {"type": "name", "properties": {"name": crs}}
    return json.dumps(doc).encode("utf-8")


def point(x, y, **props):
    return {"type": "Feature", "properties": props,
            "geometry": {"type": "Point", "coordinates": [x, y]}}


# --------------------------------------------------------------------------
# Driving it
# --------------------------------------------------------------------------

def start():
    at = AppTest.from_file(APP, default_timeout=60)
    at.run()
    assert not at.exception
    return at


def load(at, name, content, mime="text/csv"):
    at.get("file_uploader")[0].upload(name, content, mime).run()
    assert not at.exception, [e.value for e in at.exception]
    return at


def picker(at, label_start):
    return next(s for s in at.selectbox if s.label.startswith(label_start))


def choose(at, label_start, contains):
    box = picker(at, label_start)
    box.select(next(o for o in box.options if contains in o)).run()
    assert not at.exception, [e.value for e in at.exception]


def button(at, label):
    return next((b for b in at.button if b.label == label), None)


def press(at, label):
    found = button(at, label)
    assert found is not None, f"no button {label!r}: {[b.label for b in at.button]}"
    found.click().run()
    assert not at.exception, [e.value for e in at.exception]


def convert(at):
    press(at, "Convert coordinates")


def metrics(at):
    return {m.label: m.value for m in at.metric}


def said(at, kind, pattern):
    """Whether an info, warning or error on the page matches."""
    return any(re.search(pattern, e.value) for e in getattr(at, kind))


def result(at):
    """The converted table, from the Table tab."""
    return next(d.value for d in reversed(at.dataframe) if "Latitude_DD" in d.value.columns)


# --------------------------------------------------------------------------
# The scenarios
# --------------------------------------------------------------------------

def test_a_clean_file_converts_and_every_format_downloads():
    at = load(start(), "amostras.csv", CLEAN)
    convert(at)
    m = metrics(at)
    assert (m["Total rows"], m["In region"], m["Possible swaps"]) == ("6", "6", "0")

    # All six writers run on every rerun once ticked, so a writer that raises
    # shows up here as an exception rather than as a button that does nothing.
    for box in at.checkbox:
        if box.label in ("KML", "Shapefile", "GPX"):
            box.check()
    at.run()
    assert not at.exception
    downloads = [(d.proto.label, d.proto.disabled) for d in at.get("download_button")]
    assert len(downloads) == 6
    assert not any(disabled for _, disabled in downloads)


def test_a_grid_file_keeps_its_axes_when_the_system_is_chosen_after_loading():
    # The order the steps ask for: the file first, then the system. The pickers
    # were guessed for degrees - Y as the latitude, X as the longitude - and
    # used to keep that pair, so the one labelled Easting pointed at Y.
    at = load(start(), "grelha.csv", GRID_XY)
    choose(at, "System the file is in", "EPSG:20790")
    assert picker(at, "X column").value == "X"
    assert picker(at, "Y column").value == "Y"
    convert(at)
    assert metrics(at)["In region"] == "6"


def test_a_military_sheet_is_read_by_its_own_names():
    # M and P, beside the sheet number - which used to be taken for the
    # northing.
    at = load(start(), "folhas.csv", SHEET_M)
    choose(at, "System the file is in", "EPSG:20790")
    assert picker(at, "X column").value == "M"
    assert picker(at, "Y column").value == "P"
    convert(at)
    assert metrics(at)["In region"] == "6"
    # Already in metres: nothing to offer.
    assert button(at, "Read as kilometres") is None


def test_kilometres_are_offered_taken_and_taken_back():
    at = load(start(), "folhas_km.csv", SHEET_KM)
    choose(at, "System the file is in", "EPSG:20790")
    convert(at)
    # As written, a few hundred metres from the false origin: in the Atlantic.
    assert metrics(at)["In region"] == "0"
    assert said(at, "warning", r"in kilometres rather than metres, all 6 records")

    press(at, "Read as kilometres")
    assert metrics(at)["In region"] == "6"
    assert said(at, "info", r"Reading the values as kilometres")

    press(at, "Read as metres")
    assert metrics(at)["In region"] == "0"
    assert button(at, "Read as kilometres") is not None


def test_the_kilometre_reading_does_not_carry_over_to_the_next_file():
    # Carried over, the next file converts a thousandfold wrong and nothing on
    # screen says why.
    at = load(start(), "folhas_km.csv", SHEET_KM)
    choose(at, "System the file is in", "EPSG:20790")
    convert(at)
    press(at, "Read as kilometres")

    load(at, "folhas_m.csv", SHEET_M)
    convert(at)
    assert not said(at, "info", r"Reading the values as kilometres")
    assert metrics(at)["In region"] == "6"


def test_a_southern_file_written_unsigned_can_be_placed_by_its_region():
    # The suggestion used to move the picker and stop there, leaving every
    # point in Sudan: the rebuild had no way to supply the sign.
    at = load(start(), "notas.csv", UNSIGNED_SOUTH)
    convert(at)
    assert metrics(at)["In region"] == "0"

    press(at, "Use Moçambique")
    assert picker(at, "Expected data region").value == "Moçambique"
    press(at, "Give them the sign of Moçambique")

    assert metrics(at)["In region"] == "6"
    lats = result(at)["Latitude_DD"].astype(float)
    assert (lats < 0).all()


def downloads(at):
    return [(d.proto.label, d.proto.disabled) for d in at.get("download_button")]


def test_the_downloads_wait_while_a_row_is_in_doubt():
    # The same gate as the page: nothing can be taken while a row may have its
    # latitude and longitude the other way round.
    at = load(start(), "amostras.csv", ONE_REVERSED)
    convert(at)
    assert metrics(at)["Possible swaps"] == "1"
    assert said(at, "warning", r"Answer the swap review first")
    assert downloads(at) and all(disabled for _, disabled in downloads(at))


def test_a_reversed_row_is_offered_for_review_and_fixed():
    at = load(start(), "amostras.csv", ONE_REVERSED)
    convert(at)
    assert metrics(at)["Possible swaps"] == "1"

    press(at, "Apply swap to 1 row(s)")
    assert not any(disabled for _, disabled in downloads(at))

    m = metrics(at)
    assert (m["Possible swaps"], m["In region"]) == ("0", "7")
    fixed = result(at).iloc[6]
    assert float(fixed["Latitude_DD"]) == pytest.approx(38.73)


def test_the_second_system_is_computed_before_the_degrees_are_rounded():
    # Six decimals of a degree are 11 cm of latitude. Projected from the
    # rounded degrees, a millimetre survey came out of the second system 5 cm
    # from where DGT puts it - half of what the grid itself is good for.
    at = load(start(), "milimetros.csv", MILLIMETRES)
    choose(at, "System the file is in", "EPSG:20790")
    choose(at, "Extra system in the output", "EPSG:3763")
    convert(at)
    table = result(at)
    for case, (_, row) in zip(_DGT, table.iterrows()):
        assert abs(float(row["X_3763"]) - case["x_dgt"]) < 0.0015
        assert abs(float(row["Y_3763"]) - case["y_dgt"]) < 0.0015


def test_the_second_system_survives_a_swap():
    at = load(start(), "amostras.csv", ONE_REVERSED)
    choose(at, "Extra system in the output", "EPSG:3763")
    convert(at)
    press(at, "Apply swap to 1 row(s)")
    table = result(at)
    assert table["X_3763"].notna().all()
    assert table["WKT_3763"].notna().all()


def test_keeping_a_row_as_written_is_an_answer_too():
    # A user who has looked and decided the data is right must not be left
    # holding a page that will not give them the file.
    at = load(start(), "amostras.csv", ONE_REVERSED)
    convert(at)
    press(at, "Keep them as written")

    assert not any(disabled for _, disabled in downloads(at))
    assert said(at, "info", r"kept as written")
    assert float(result(at).iloc[6]["Latitude_DD"]) == pytest.approx(-9.14)

    # And it can be taken back.
    press(at, "Review them again")
    assert all(disabled for _, disabled in downloads(at))


def test_an_answer_does_not_carry_over_to_the_next_file():
    at = load(start(), "amostras.csv", ONE_REVERSED)
    convert(at)
    press(at, "Keep them as written")

    load(at, "outras.csv", ONE_REVERSED)
    convert(at)
    assert all(disabled for _, disabled in downloads(at))


def test_a_second_system_adds_its_own_columns():
    at = load(start(), "amostras.csv", CLEAN)
    choose(at, "Extra system in the output", "EPSG:3763")
    convert(at)
    columns = list(result(at).columns)
    assert any(re.fullmatch(r"X_\w+", c) and c != "X_DD" for c in columns), columns
    # Nothing is removed: WGS84 is always there.
    assert {"Latitude_DD", "Longitude_DD", "WKT"} <= set(columns)


def test_a_geojson_is_read_and_its_lines_are_counted_not_converted():
    features = [point(-9.1, 38.7, nome="A"), point(-9.2, 38.8, nome="B"),
                point(-9.0, 38.6, nome="C"),
                {"type": "Feature", "properties": {"nome": "percurso"},
                 "geometry": {"type": "LineString",
                              "coordinates": [[-9.1, 38.7], [-9.2, 38.8]]}}]
    at = load(start(), "pontos.geojson", geojson(features), "application/geo+json")
    assert said(at, "info", r"1 element\(s\) in the file are not points")
    assert picker(at, "Latitude column").value == "Latitude"
    convert(at)
    assert metrics(at)["In region"] == "3"


def test_a_geojson_that_declares_its_system_has_it_chosen():
    # What QGIS still writes: the 2008 crs member, and metres. The desktop used
    # to say it read WGS84 only - a message from before it had a system picker.
    features = [point(-86000.0, -104000.0, nome="A"),
                point(-85500.0, -103200.0, nome="B"),
                point(-86400.0, -104900.0, nome="C")]
    content = geojson(features, crs="urn:ogc:def:crs:EPSG::3763")
    at = load(start(), "tm06.geojson", content, "application/geo+json")
    assert "3763" in picker(at, "System the file is in").value
    assert said(at, "info", r"declares the EPSG:3763 system, and it has been chosen")
    assert picker(at, "X column").value == "X"
    assert picker(at, "Y column").value == "Y"
    convert(at)
    assert metrics(at)["In region"] == "3"


def test_the_declared_system_is_taken_once_and_can_be_changed():
    features = [point(-86000.0, -104000.0), point(-85500.0, -103200.0),
                point(-86400.0, -104900.0)]
    at = load(start(), "tm06.geojson", geojson(features, crs="EPSG:3763"),
              "application/geo+json")
    choose(at, "System the file is in", "EPSG:20790")
    at.run()
    assert "20790" in picker(at, "System the file is in").value


def test_a_system_this_build_does_not_know_is_named_and_left_to_the_user():
    features = [point(400000.0, 4500000.0), point(400100.0, 4500100.0),
                point(400200.0, 4500200.0)]
    at = load(start(), "grego.geojson", geojson(features, crs="EPSG:2100"),
              "application/geo+json")
    assert said(at, "warning", r"declares the EPSG:2100 system, which this build does not know")
    assert "4326" in picker(at, "System the file is in").value


def test_one_column_asks_for_two_instead_of_failing():
    # A file with a single column - which is what a wrongly guessed separator
    # produces - used to end in a traceback.
    at = load(start(), "colado.csv", ONE_COLUMN)
    assert said(at, "warning", r"Choose two different columns")
    assert button(at, "Convert coordinates") is None


def test_an_empty_file_says_so():
    at = load(start(), "vazio.csv", b"")
    assert said(at, "error", r"Could not read the file") or said(at, "warning", r"no rows")
    assert button(at, "Convert coordinates") is None


def test_a_single_coordinate_converts_without_a_file():
    at = start()
    at.text_input[0].input("38° 42' 30\" N")
    at.text_input[1].input("9° 8' 12\" W")
    press(at, "Convert")
    m = metrics(at)
    assert float(m["Latitude (DD) = Y_DD"]) == pytest.approx(38.708333, abs=1e-6)
    assert float(m["Longitude (DD) = X_DD"]) == pytest.approx(-9.136667, abs=1e-6)
