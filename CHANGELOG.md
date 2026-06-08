# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Detection of likely swapped latitude/longitude (range-based and cluster-based)
  with a review-and-confirm step and an invert option for ambiguous cases.
- Region mask for swap detection (Portugal mainland by default, plus Azores,
  Madeira, Angola, Cabo Verde, Guiné-Bissau, Moçambique, São Tomé e Príncipe,
  or a custom centre), which disambiguates the swapped side regardless of how
  the data clusters.
- DD -> DMS formatting, available as optional output columns and exposed via
  `converter.format_dms`.
- KML and Shapefile (zipped, pure-Python via pyshp) exports, plus checkboxes to
  choose which formats to download.
- Colour-coded map (valid vs suspect points) and a points summary (bounding box
  and centroid).
- Excel sheet selection and configurable CSV separator/decimal on read.
- `geoexport.py` module with GeoJSON/KML/Shapefile writers and its test suite.

### Changed

- Reworked the interface: a numbered step-by-step flow, results organised into
  Table / Map / Summary / Download tabs, a full sortable result table, a map
  legend with a colour-blind-safe palette, cached exports for responsiveness,
  and an optional sidebar logo (`assets/logo.png`).

## [0.1.0] - 2026-06-08

Archived on Zenodo: [10.5281/zenodo.20596871](https://doi.org/10.5281/zenodo.20596871)

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
