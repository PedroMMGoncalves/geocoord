# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-06-08

### Added

- Conversion engine (`converter.py`) supporting decimal degrees, degrees with
  decimal minutes, and degrees-minutes-seconds, with hemisphere detection in
  Portuguese and English (N/S/E/W, plus O for Oeste and L for Leste) and
  explicit negative-sign handling.
- Range validation (latitude -90..90, longitude -180..180) and a per-row
  conversion status.
- Streamlit application: tabular conversion (CSV/XLSX/XLS), automatic column
  detection, live preview, persistent results, map preview, and a
  single-coordinate converter.
- GIS-ready output columns (X_DD, Y_DD, WKT) and exports to Excel, CSV, and
  GeoJSON (WGS84 / EPSG:4326).
- Standalone Windows desktop packaging via stlite and Electron.
- Test suite (`tests/`) and continuous integration across Python 3.11-3.13.

### Fixed

- The negative sign was discarded when parsing degrees-minutes-seconds values,
  producing coordinates with an inverted sign. This affected western
  longitudes in particular.
