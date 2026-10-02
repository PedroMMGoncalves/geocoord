"""What a download records about where it came from (geocoord/provenance.py).

The page builds the same list in the reader's language; its tests are in
web/tests/provenance.test.js. The writers that place it are pinned in the
shared contract.
"""
import geocoord
from geocoord import crs
from geocoord.provenance import provenance, transformation_of


def system(code):
    e = crs.get(code)
    return {"proj4": e["proj4"], "kind": e["kind"], "label": e["pt"], "epsg": e["epsg"],
            "suffix": str(e["epsg"])}


def test_a_military_grid_file_says_how_it_was_moved_and_what_was_done_to_it():
    got = dict(provenance(date="2026-10-03", file_name="obras.xls", sheet="lista",
                          source=system(20790), target=system(3763), scale=1000.0, swaps=1))
    assert got["Converted with"] == (f"GeoCoord {geocoord.__version__} "
                                     "(https://pedrommgoncalves.github.io/geocoord/)")
    assert got["Converted on"] == "2026-10-03"
    assert got["Source file"] == "obras.xls, sheet lista"
    assert got["Source system"] == "Lisboa / Hayford-Gauss Militar (EPSG:20790)"
    assert got["Transformation to WGS 84"].startswith("DGT's NTv2 grid DLx_ETRS89_geo")
    assert got["Source of the transformation"].startswith("DGT, Parâmetros de Transformação")
    assert "+nadgrids=DLX_ETRS89_geo.gsb" in got["proj4 definition"]
    assert got["Unit read"] == "kilometres (values multiplied by 1000)"
    assert got["Corrections accepted"] == "1 row with latitude and longitude swapped"
    assert got["Extra system"] == (
        "ETRS89 / Portugal TM06 (EPSG:3763), in columns X_3763 and Y_3763; "
        "from WGS 84: ETRS89 / PTRA08 taken as WGS 84 (under 1 m apart)")


def test_a_plain_file_in_degrees_says_only_what_applies():
    got = provenance(date="2026-10-03", file_name="a.csv")
    assert [k for k, _ in got] == ["Converted with", "Converted on", "Source file",
                                   "Source system", "Transformation to WGS 84",
                                   "Degrees and geometry"]
    assert dict(got)["Transformation to WGS 84"] == "none: already WGS 84"


def test_each_kind_of_system_is_named():
    assert transformation_of(system(32629)) == "none: already WGS 84"
    assert "taken as WGS 84" in transformation_of(system(5016))
    assert transformation_of(system(2190)) == "DGT's seven parameters, eastern group: 0.02 m"
    pasted = {"proj4": "+proj=utm +zone=33 +south +ellps=clrk80 +towgs84=-50,-7,-170 +units=m",
              "label": "pasted definition", "epsg": None}
    assert transformation_of(pasted) == "the definition's own"
