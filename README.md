# GeoCoord - DMS to Decimal Degrees Coordinate Converter

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Python](https://img.shields.io/badge/Python-3.9%2B-blue.svg)](https://www.python.org)
[![Streamlit](https://img.shields.io/badge/Streamlit-app-FF4B4B.svg)](https://streamlit.io)
[![CI](https://github.com/PedroMMGoncalves/geocoord/actions/workflows/ci.yml/badge.svg)](https://github.com/PedroMMGoncalves/geocoord/actions/workflows/ci.yml)

*Convert field coordinates from degrees-minutes-seconds to decimal degrees,
ready for QGIS and ArcGIS.*

GeoCoord converts geographic coordinates from degrees-minutes-seconds (DMS) to
decimal degrees (DD). It reads tabular data (CSV/Excel), validates and converts
latitude/longitude columns, and produces GIS-ready outputs for QGIS and ArcGIS
in the WGS84 / EPSG:4326 reference system.

The tool runs as a [Streamlit](https://streamlit.io/) web application and can be
packaged as a standalone Windows desktop application, with no Python
installation required on the target machine, through
[stlite](https://github.com/whitphx/stlite).

## Workflow

```mermaid
flowchart LR
    A[CSV / XLSX / XLS] --> B[Column detection]
    B --> C[Parse DMS / DM / decimal]
    C --> D[Range validation]
    D --> E[GIS columns: X_DD, Y_DD, WKT]
    E --> F[Export: CSV / Excel / GeoJSON]
```

## Features

- Reads CSV, XLSX, and XLS, with automatic detection of the latitude and
  longitude columns.
- Live preview of the conversion before it is applied to the whole table.
- Conversion of multiple input formats (see below).
- Hemisphere detection in Portuguese and English, as prefix or suffix, and
  explicit negative-sign handling.
- Range validation (latitude -90..90, longitude -180..180) with a per-row
  status and a report of problematic rows.
- GIS-ready output columns: `X_DD` (longitude), `Y_DD` (latitude), and `WKT`.
- Export to Excel, CSV, and GeoJSON (EPSG:4326).
- Map preview and a single-coordinate converter.

## Input formats

| Format | Example | Result |
| --- | --- | --- |
| Decimal degrees | `38.7`, `-9,5` | `38.700000`, `-9.500000` |
| Degrees + decimal minutes | `38° 42.5'` | `38.708333` |
| Degrees-minutes-seconds | `38° 42' 30" N` | `38.708333` |

Hemispheres: `N`/`E`/`L` are positive; `S`/`W`/`O` are negative (`O` = Oeste,
`L` = Leste). A leading `-` is honoured when no hemisphere letter is present.

## Example

Input file (`sites.csv`):

| name | lat | lon |
| --- | --- | --- |
| Lisboa | 38° 42' 30" N | 9° 8' 12" W |
| Porto | 41° 9' 44" N | 8° 36' 39" W |

After conversion, GeoCoord appends:

| name | Latitude_DD | Longitude_DD | X_DD | Y_DD | WKT | status |
| --- | --- | --- | --- | --- | --- | --- |
| Lisboa | 38.708333 | -9.136667 | -9.136667 | 38.708333 | POINT (-9.136667 38.708333) | OK |
| Porto | 41.162222 | -8.610833 | -8.610833 | 41.162222 | POINT (-8.610833 41.162222) | OK |

Note the negative longitudes: western (`W`/`O`) coordinates are converted with
the correct sign.

## Requirements

- Python 3.9+
- Dependencies listed in [`requirements.txt`](requirements.txt): `streamlit`,
  `pandas`, `openpyxl`, `xlrd`.

## Installation

```bash
python -m pip install -r requirements.txt
```

## Usage

### Web application

```bash
python -m streamlit run app.py
```

On Windows, `run_app.bat` installs the dependencies and starts the application.
The interface opens at `http://localhost:8501`. The application can also be
deployed for free on
[Streamlit Community Cloud](https://streamlit.io/cloud) directly from this
repository.

### Single coordinate

The "Quick conversion" tab converts a single latitude/longitude pair without
loading a file.

## Output convention

For geographic coordinates in WGS84 / EPSG:4326:

| GIS axis | Generated column | Meaning |
| --- | --- | --- |
| X | `X_DD` | Longitude |
| Y | `Y_DD` | Latitude |

A `WKT` column (`POINT (longitude latitude)`) and a per-row `status` column are
also produced. For continental Portugal, latitude is roughly 37-42
and longitude roughly -9 to -6 (West). Western longitudes must carry `O`/`W` or
a negative sign in the source data, otherwise their sign cannot be inferred.

## Desktop application (stlite + Electron)

Builds a Windows installer that runs without a Python installation (Python runs
in WebAssembly via Pyodide, bundled inside Electron).

Requirements: [Node.js](https://nodejs.org/) 18+.

```bash
npm install        # @stlite/desktop, electron, electron-builder
npm run dump       # download Pyodide + wheels and generate artifacts
npm run serve      # optional: preview in an Electron window
npm run app:dist   # build the installer into dist/
```

On Windows, `build_exe.bat` runs these steps. Place `assets/icon.ico` for a
custom icon. Only pure-Python packages are supported in this mode; `.xls`
support is best-effort. The map basemap requires internet access; points are
plotted even offline.

## Tests

```bash
python -m pytest
```

The conversion engine is isolated in [`converter.py`](converter.py) and covered
by the suite in [`tests/`](tests/). Continuous integration runs the suite across
Python 3.11, 3.12, and 3.13.

## Project structure

```text
app.py                 Streamlit interface
converter.py           Conversion engine (pure logic, testable)
tests/                 Test suite (pytest)
requirements.txt       Python dependencies
.streamlit/            Application theme
run_app.bat            Run the web application (Windows)
build_exe.bat          Build the desktop installer (Windows)
package.json           stlite/Electron configuration
assets/                Installer resources (icon)
.github/workflows/     Continuous integration
```

## Troubleshooting

- **Western longitudes have the wrong sign.** The source values must include a
  hemisphere letter (`W`/`O`) or a leading `-`. Without it, the sign cannot be
  inferred and the value is treated as positive (East).
- **Some rows are not converted.** Open the "rows with issues" panel; the
  `status` column reports whether a value could not be parsed or fell outside
  the valid range.
- **The map is blank.** The basemap tiles need an internet connection; the
  points themselves are still plotted offline.
- **`.xls` files fail in the desktop build.** The stlite/Pyodide runtime only
  bundles pure-Python wheels; convert legacy `.xls` to `.xlsx` or CSV, or use
  the web application for `.xls`.

## Citation

If you use this software, please cite it using the metadata in
[`CITATION.cff`](CITATION.cff):

> Gonçalves, P. (2026). *GeoCoord - DMS to Decimal Degrees Coordinate
> Converter* (Version 0.1.0) [Computer software]. LNEG - Laboratório Nacional
> de Energia e Geologia.

## License

Licensed under the Apache License, Version 2.0. You may use, modify, and
redistribute this work, commercially or otherwise, provided attribution is
preserved; an explicit patent grant and patent-retaliation clauses apply per
the Apache 2.0 terms. See [LICENSE](LICENSE).

## Acknowledgements

Developed by Pedro Gonçalves at LNEG - Laboratório Nacional de Energia e
Geologia.

## References

- World Geodetic System 1984 (WGS84), EPSG:4326.
- H. Butler, M. Daly, A. Doyle, S. Gillies, S. Hagen, T. Schaub (2016).
  *The GeoJSON Format* (RFC 7946). IETF.
- OGC Simple Feature Access - Well-Known Text (WKT) geometry representation.
