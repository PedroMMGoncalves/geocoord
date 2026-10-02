"""The Windows installer carries what the desktop application imports.

The installer runs ``app.py`` in the browser engine stlite bundles, which sees
only the files ``package.json`` lists and installs only the packages it names.
The list was written when the application used three modules of the engine;
it went on to import three more, and the registry of coordinate systems, and
the installer stopped starting - for three weeks, with nothing to say so,
because nothing that runs on every change ever builds it. Building it takes
minutes and a Windows machine. Checking the list against the imports takes
none, so that is what this does.
"""
import ast
import fnmatch
import json
import re
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
STLITE = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["stlite"]["desktop"]

#: Import names whose distribution is called something else.
DISTRIBUTION = {"shapefile": "pyshp"}

#: Imports the installer need not carry. Streamlit is stlite itself; pydeck is
#: imported inside a try whose fallback is st.map, and the browser engine does
#: not ship it.
PROVIDED_OR_OPTIONAL = {"streamlit", "pydeck"}


def packaged(path):
    return any(fnmatch.fnmatch(path, pattern) for pattern in STLITE["files"])


def imports(path):
    """Top-level names imported anywhere in a file, nested imports included."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            names.add(node.module.split(".")[0])
    return names


SOURCES = [ROOT / "app.py", *sorted((ROOT / "geocoord").glob("*.py"))]


def test_the_entrypoint_is_packaged():
    assert STLITE["entrypoint"] == "app.py"
    assert packaged("app.py")


def test_every_module_and_data_file_of_the_engine_is_packaged():
    engine = sorted((ROOT / "geocoord").glob("*.py")) + sorted((ROOT / "geocoord").glob("*.json"))
    missing = [p.relative_to(ROOT).as_posix() for p in engine
               if not packaged(p.relative_to(ROOT).as_posix())]
    assert not missing, f"not in package.json stlite.desktop.files: {missing}"


def test_the_transformation_grids_are_packaged():
    # crs.py refuses to import without them, so an installer that forgot them
    # would not start - which is better than converting a metre worse, and
    # still not something to find out from a colleague.
    grids = sorted((ROOT / "geocoord" / "grids").glob("*.gsb"))
    assert grids
    missing = [p.relative_to(ROOT).as_posix() for p in grids
               if not packaged(p.relative_to(ROOT).as_posix())]
    assert not missing, f"not in package.json stlite.desktop.files: {missing}"


def test_every_package_the_application_imports_is_installed():
    wanted = set()
    for source in SOURCES:
        wanted |= imports(source)
    third_party = {name for name in wanted
                   if name not in sys.stdlib_module_names
                   and name != "geocoord"
                   and name not in PROVIDED_OR_OPTIONAL}
    declared = {d.split(">")[0].split("=")[0].split("<")[0].strip().lower()
                for d in STLITE["dependencies"]}
    missing = sorted(DISTRIBUTION.get(n, n) for n in third_party
                     if DISTRIBUTION.get(n, n).lower() not in declared)
    assert not missing, f"not in package.json stlite.desktop.dependencies: {missing}"


def test_every_place_that_states_the_version_states_the_same_one():
    # The downloads record the version, from geocoord.__version__; the page
    # takes it from web/package.json, the installer from package.json.
    import geocoord
    stated = {
        "geocoord/__init__.py": geocoord.__version__,
        "package.json": json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"],
        "web/package.json": json.loads((ROOT / "web" / "package.json").read_text(encoding="utf-8"))["version"],
        "CITATION.cff": re.search(r'^version: "([^"]+)"', (ROOT / "CITATION.cff").read_text(encoding="utf-8"),
                                  re.M).group(1),
    }
    assert len(set(stated.values())) == 1, stated


def test_the_installer_asks_for_the_pyshp_the_contract_was_written_against():
    # Pyodide ships pyshp 2.3; the engine's shapefiles are pinned against 3.1.6,
    # which is what requirements.txt asks for.
    assert "pyshp>=3.1.6" in STLITE["dependencies"]
