# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- KML, KMZ, GeoJSON and GPX are read, not only written. The exporters have
  always produced them; now a file that arrives in one opens. A colleague's
  Google Earth pins, a day of waypoints off a receiver, a layer somebody
  exported from QGIS: each becomes the same table a spreadsheet becomes, and
  goes through the same column guessing, swap detection, region check and
  exports. What is read is what real tools write, which is not the same as what
  the specifications say: attributes live in `<Data>` for ArcGIS, in
  `<SimpleData>` for QGIS, and nowhere at all for Google Earth, which puts them
  in an HTML table inside `<description>`; a GPX off a receiver holds a track
  and not one waypoint. A row is a point, so a polygon is counted and named in a
  notice rather than folded into a centroid. A GeoJSON that declares a projected
  system - which QGIS still does - has its columns called X and Y and that
  system chosen for it, instead of being a page of metres read as degrees.
- The page is redesigned around what it is for: getting from a file to the
  answer with as little in the way as possible. The file and its settings live
  in a sidebar; the answer takes the rest of the width. Each step is a card
  that **closes to a summary** once it is done - `01 Ficheiro` folds to
  `amostras.xlsx — 23 linhas, 4 colunas`, `02` to `Latitude / Longitude ·
  Moçambique · WGS 84 — EPSG:4326 · 6 casas decimais` - so a glance confirms
  every setting without opening anything and the page compresses as the work
  progresses. A card the user has opened stays as they left it.
- Downloads wait for the swap question. While any row is flagged as possibly
  swapped, step `04` is closed, marked, its summary line *is* the question, and
  its buttons are disabled; answering - either button, or a row's own box - is
  what opens it. The one promise this application makes about the data is that
  nothing is changed without confirmation, and a download button above an
  unanswered question was an invitation to take the file without deciding.
- Colour now means one thing each. Green is what you press, cyan is what you
  read (the coordinate readouts), amber is a question, red is a failure. A
  converted row is neutral - it used to be green too, along with the tabs, the
  badges and the focus ring, which left green meaning nothing. Every text pair
  meets WCAG AA; the tightest is 5.1:1.
- The answer is the biggest thing on the screen. `22 convertidas` was
  `text-sm`; it is thirty pixels now, with the rows to review and the failures
  beside it in their own colours and marks.
- The map draws itself with the result, at the full width of the pane, with a
  scale bar and the tile controls restyled to match the page. It still opens on
  nothing if the user picks "Sem fundo", the seventh basemap, which asks the
  network for not one thing.
- The download buttons name the file they will write, Excel first and filled:
  for the people this is for, Excel is the answer.
- Inter and JetBrains Mono, packaged with the page rather than fetched from a
  font service, so the page keeps talking to nobody. JetBrains Mono for every
  number: a slashed zero, and the same glyph widths on every operating system,
  where Consolas, Menlo and DejaVu are three different faces.
- The empty drop zone shows a worked example - `38° 42' 30" N  9° 8' 12" W →
  38.708333, -9.136667` - converted by the same code, so the first thing a
  visitor sees is what the tool does.
- The promise that nothing is sent anywhere is a badge in the header, once,
  visible on either tab as the page opens. It used to be a sentence at the top
  of each tab, in two different registers.
- An Excel (.xlsx) download on the web page, which the desktop application has
  had since the first release. It sits outside the parity contract for the same
  reason Excel reading does - openpyxl and SheetJS build different workbooks
  from the same data - but the behaviour that matters is tested on both sides,
  and the workbook the browser writes was checked by opening it in openpyxl:
  leading zeros intact, accents intact, a cell beginning with `=` written as
  text rather than as a formula, coordinates as real numbers.
- Size limits, so a file that would take the machine down is refused with a
  message rather than losing the browser tab: a warning above 50,000 rows, a
  refusal above 2 million cells, and for a workbook a refusal above 150 MB of
  decompressed content - read from the zip directory, so nothing is expanded to
  find out. The thresholds are measured, not chosen: a real 50k x 20 file with
  long notes expands to 129 MB while the shape that takes a tab down expands to
  299 MB. The numbers are pinned in the parity contract so the desktop and the
  browser refuse the same files.
- Accessibility work on the web page, measured before and after rather than
  guessed at: a skip link to the content, a `main` landmark, a caption and
  column and row scopes on the results table, a live region that says the
  conversion is running and how many rows it finished with, and each step
  announced as "Passo 1: Ficheiro" instead of "1Ficheiro". Every row carries
  its status as a shape and as text as well as a colour, so the table means
  something to a screen reader and to anyone who cannot separate amber from
  green.
- Coordinate systems, on the web page: a system for the file being read and an
  optional second system for the output. Seventeen named systems - WGS 84,
  ETRS89, PTRA08, Portugal TM06, UTM 29N, Datum 73, Lisboa/Hayford-Gauss
  Militar, the three PTRA08 island zones and the six historic island datums -
  plus two generic hatches that need no curation: a UTM zone by number and
  hemisphere, and a proj4 definition pasted whole. Between them they cover
  Angola, Cabo Verde, Guiné-Bissau, Moçambique and São Tomé e Príncipe without
  this application having to guess at national datums it cannot verify.
- A projected file is read as metres rather than as degrees
  (`converter.parse_projected`), tolerant of the decimal comma and the
  thousands separators a spreadsheet writes, and the column labels change to
  X (Easting) and Y (Northing) to match.
- When a second system is chosen, `X_<code>`, `Y_<code>` and `WKT_<code>`
  columns are added alongside the WGS84 ones. Nothing is removed or replaced,
  and the GIS formats stay WGS84, which is what GeoJSON, KML and GPX allow.
- `geoexport.to_shapefile_zip` takes the `.prj` contents as a parameter,
  defaulting to WGS84 so every existing caller is unchanged.
- A hemisphere letter that contradicts the column it sits in is now reported as
  a certain swap rather than ignored. N and S can only be a latitude and E, W, O
  and L only a longitude, so the letter is proof of a reversed pair of columns
  and not a guess about one; it outranks every heuristic and is offered for
  inversion first (`converter.hemisphere_axis`, `converter.axis_mismatch`, and
  the new `swap_axis` status).
- `geoexport.csv_safe`, applied to every CSV export: a cell beginning with `=`,
  `+`, `-` or `@` is a formula to Excel, LibreOffice and Google Sheets, and a
  converted file is usually somebody else's data being opened on your machine.
  Numbers are never touched, so `-8,61` stays a coordinate.
- A map of the converted points on the web page, on Leaflet, with five
  basemaps and the choice remembered: Esri imagery, Esri hybrid, Esri light and
  dark canvas, and OpenStreetMap. None needs an API key, which keeps the page a
  static file anybody can open. Points are coloured with the same colour-blind-safe pair the
  desktop map uses, a row suspected of being reversed is drawn where it would
  be if it were, and accepting the inversion recolours it and re-frames the map.
  It opens on request rather than on load: the basemap tiles come from third
  parties, and while the coordinates never leave the machine, the area on screen
  is implied by which tiles are asked for. That is said on the page.
- A web application at `web/`, running entirely in the browser and published to
  GitHub Pages, so a coordinate can be converted with no installation and no
  account. It converts a whole spreadsheet or CSV - dropped, chosen or pasted
  straight out of Excel - guessing the coordinate columns by name, listing
  suspected latitude/longitude reversals for the user to accept row by row, and
  exporting to CSV, GeoJSON, KML, zipped Shapefile and GPX. The file is read on
  the machine it came from and never leaves it. A single-coordinate converter
  sits beside it, and both work in Portuguese and English.
- `web/src/core/pipeline.js`, the part of `app.py` that is not Streamlit -
  region masks, column guessing, derived columns, swap application, the feature
  list the exporters take - as pure functions over the neutral table shape.
- GPX export, for the handheld GPS receivers these coordinates usually end up
  in. It has no counterpart in the Python package and is marked as outside the
  parity contract where it is defined.
- `reader.read_excel_bytes` and `reader.workbook_sheets`, so both halves of
  reading live in one module under one documented contract and `app.py` no
  longer holds pandas directly.
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
- Automatic tidying of messy spreadsheet exports via `converter.tidy_table`: a
  blank first line mistaken for the header is corrected, a leading empty index
  column and fully empty rows are dropped, and decimal commas inside quoted
  fields are parsed. Coordinate columns named `X`/`Y` are auto-detected.
- Output files (CSV/Excel/GeoJSON/KML/Shapefile, including the shapefile's
  internal layer) are named after the input file, sanitised for GIS: accents
  transliterated, spaces and special characters replaced
  (`geoexport.sanitize_filename`).
- A warning when valid coordinates fall outside the declared region, naming the
  region they actually fall in and offering a one-click switch, so a region
  mismatch is no longer silently reported as OK (`converter.region_check`).
- A JavaScript port of the export writers in `web/src/core/`, checked against
  the same contract: GeoJSON, KML and a Shapefile writer that reproduces
  pyshp's bytes, including its habit of cutting a field name mid-character at
  ten raw UTF-8 bytes.
- A parity contract in `tests/fixtures/parity.json`, generated by
  `scripts/gen_parity_fixtures.py` and then frozen, pinning the engine's
  behaviour case by case. It is the reference for the forthcoming JavaScript
  port of the engine: both implementations are asserted against the same file,
  so a divergence on any pinned case fails the test suites on both sides.
  `python scripts/gen_parity_fixtures.py --check`, which CI runs, fails if the
  committed contract and the generator disagree.

### Changed

- The browser fetches SheetJS and JSZip only when they are needed - the first
  spreadsheet, the first Shapefile download - rather than in the page itself.
  Between them they were 150 of the bundle's 216 kB gzipped, and a visitor
  converting a CSV needs neither. The page is now 67 kB.
- File reading moved out of `app.py` into `geocoord/reader.py` as pure
  functions over text and bytes, so the step before `tidy_table` can be tested
  on its own and mirrored in the JavaScript port. Behaviour is unchanged apart
  from the single-column fix below.
- Reorganised the repository into a `geocoord/` package (`converter`,
  `geoexport`) and a `scripts/` folder for the Windows helper batch files.
- Reworked the interface: a numbered step-by-step flow, results organised into
  Table / Map / Summary / Download tabs, a full sortable result table, a map
  legend with a colour-blind-safe palette, cached exports for responsiveness,
  and an optional sidebar logo (`assets/logo.png`).
- More visible, accessible buttons: solid accent primary actions, download
  buttons with an accent outline that fills on hover, and visible hover, active
  and focus states.

### Fixed

- The four Copy buttons on the single-coordinate tab were all called "Copiar",
  so a screen reader could not tell which copied the latitude and which the
  WKT - and pasting the wrong one into a GIS is a silent error. Each now says
  what it copies. The three worked examples, named only "1", "2" and "3", now
  say what they will fill in.
- At phone width the two coordinate-system selects shared a row and the value
  was cut off exactly where the EPSG code is, which is the part that tells one
  datum from the one beside it. They take a full row on a narrow screen.
- The decimal-places slider was a four-pixel-tall target.
- The CSV export was corrupting the coordinates it exists to produce. csv_safe
  prefixed an apostrophe to anything starting with a minus that was not a bare
  number, which includes every DMS coordinate written with a leading minus -
  how the southern hemisphere is normally written, and how most PALOP data
  arrives. Reading that file back, the apostrophe stopped the minus being
  leading and the point crossed the equator: 50 degrees of latitude, in silence,
  from a file the application had just written. A whitelist of the characters a
  coordinate can contain replaces the pattern for numbers.
- The browser wrote shapefile archives without compression while the desktop
  deflated them, so the same survey downloaded at 9 MB instead of 0.2 MB.
- Shapefile attribute columns no longer collide. Field names were truncated to
  ten characters and checked for uniqueness, then written truncated to ten
  *bytes* as the format requires — so `Descrição_Amostra` and `Descrição_Local`
  both became `Descriçã`, and two columns of a Portuguese dataset became
  unreachable in QGIS.
- A file that fails to open no longer leaves the previous one on screen. The
  table, the map and the downloads stayed live and belonged to the last job, so
  a geologist starting the next survey could download the previous one under
  the new name with nothing to say so.
- A workbook whose first sheet holds no data - a cover page, a README tab -
  offers the sheet picker instead of a dead end.
- A single-column table no longer dead-ends the desktop application with a
  traceback. Choosing the same column for both axes now says so.
- The live region announces the status counts rather than only the row count,
  so a screen reader hears the result change when the column mapping or the
  coordinate system does - the two settings most likely to be wrong.
- The page never set a text colour. `<body>` carried the background and
  nothing carried the ink, so every element without an explicit `text-*` class
  inherited the browser default - near-black on a near-black ground, measured
  at 1.18:1. The download buttons and the section tabs were exactly that.
  Contrast failures across the page went from twenty to none.
- The Excel export no longer writes live formulas. openpyxl writes a cell whose
  text begins with `=` as a formula rather than as text, so a converted file
  carrying `=HYPERLINK(...)` in a name column opened with it live and ran it.
  The CSV export had been guarded by `csv_safe` for a while; this was the same
  hole in the other one, and it is closed without altering the value: the cell
  keeps its exact text and is marked as a string.
- One control character no longer takes the whole Excel download with it.
  openpyxl refuses a workbook containing a C0 control, and a single stray byte
  in a notes column meant nothing could be exported at all.
- The web page says it is converting while it converts, and announces the row
  count when it finishes, instead of appearing to have frozen.
- A hemisphere in the wrong column was silently converted and then reinvented.
  `9° 8' 12" W` chosen as a latitude became -9.136667, passed the range check,
  and was written back out as `9° 8' 12" S`, so the exported file asserted a
  hemisphere that nobody had entered.
- Degrees-minutes-seconds with sixty or more minutes or seconds are rejected
  instead of carried. `41° 60' 00"` is not a coordinate, it is a typo for 42°00'
  or 41°06', and the arithmetic turned exactly the digit transpositions
  commonest in hand-copied field notebooks into a well-formed coordinate that
  was in range, inside the declared region, and up to 111 km out of place.
- `format_dms` refuses a value outside its axis rather than writing
  `123° 30' 0" N` into a Latitude_GMS column.
- The browser wrote GeoJSON properties in a different order from the desktop
  application whenever a column was named like an integer, because JavaScript
  hoists such keys to the front of an object. The parity contract could not see
  it: it compared the parsed objects, and parsing hoists them again on both
  sides. GeoJSON is now written by hand on the JavaScript side, Python emits
  compact separators, and the contract compares the text, as it already did for
  KML — which pins the ordering, the spacing and the number rendering at once.
- A column name containing a double quote produced `<Data name="a"b">` and a KML
  that is not well-formed XML at all, so no GIS would open the file and nothing
  said why. Attribute names are now escaped for an attribute, quotes included.
- A UTF-16 CSV — which is what Excel's "Unicode Text" export writes — was read
  as mojibake, column names included. The byte-order mark now settles the
  encoding before anything is guessed.
- The single-byte fallback is windows-1252 on both sides. It was latin1 in
  Python and windows-1252 in the browser, which differ over bytes 0x80-0x9F, so
  a curly apostrophe out of Excel read as an invisible control character on the
  desktop and correctly in the browser.
- A CSV cell longer than 128 KB no longer makes the whole file unreadable. The
  standard library's parser refuses one by default where `pd.read_csv` did not.
- `guess_column` no longer raises on a header cell that is not a string, such as
  a workbook whose first row is a row of years.
- Auto mode no longer reports reversed coordinates as fine. Its tolerance for
  "the swap brings this row back where the data is" was one and a half times
  the radius of the dense *core* of the data, and a country is far wider than
  its core: for a survey around Lisbon with points nationwide that came to 2.8
  degrees, while mainland Portugal is 5.4 degrees tall. A row reversed anywhere
  north of Coimbra or along the eastern border fell outside it and was passed as
  valid - a sweep of true positions over the mainland put it at 38% of genuinely
  reversed rows missed, with the whole of Trás-os-Montes a blind spot. The
  tolerance now reaches as far as the good data actually reaches, measured with
  the outliers left out so a reversed row cannot widen the tolerance meant to
  catch it, and a row whose swap brings it ten times closer is caught even in a
  survey too compact to have an extent. Both thresholds were chosen by measuring
  recall against false accusations across six survey shapes, and four cases are
  pinned in the parity contract, including the ambiguity that remains: a real
  point at the mirror of the data cannot be told from a reversed one, which is
  why the application asks before changing anything.
- A spreadsheet cell is read by the value it holds rather than by how it is
  displayed. Both halves of the application read Excel through the display
  format, and it cost data twice over. Leading zeros went the way they used to
  in CSV before that path was rewritten - `0071` became `71`, and one blank
  cell in an identifier column typed it as a float so `20240001` exported as
  `20240001.0`. Worse for a coordinate tool, a cell holding `38.7083335` but
  formatted to two decimals was read as `38.71` in the browser, which is a
  different place on the ground by two and a half kilometres, and a twelve-digit
  lab number was read as `1.23457E+15` and lost. Dates are still rendered, since
  a date is stored as a count of days and would otherwise arrive as `45358`.
- The Ilhas Selvagens are inside the Madeira region mask. They are the
  southernmost Portuguese territory and part of the Autonomous Region of
  Madeira, but sit two degrees south of the Madeira/Porto Santo/Desertas box,
  so every point on them was reported as falling outside the declared region.
- The hemisphere was dropped when its letter was written against the number,
  with no space: `38.5W` was read as +38.5 while `38.5 W` was read as -38.5.
  A letter is now treated as a hemisphere unless it sits against another
  letter, so a word such as `Oeste` or `Norte` in a name column is still
  ignored, accents included.
- Promoting a mistaken header row no longer produces columns literally named
  `nan` when a header cell is blank. Such columns could also collide into
  duplicate names, which silently breaks column selection. They now get
  distinct positional names (`Column 1`, `Column 3`) and keep their data;
  blank-headed columns carrying no data are dropped as before.
- `º` and `ª`, the degree signs a Portuguese keyboard actually reaches for, are
  now understood. Unicode classes them as letters, so `9ºO` was read as +9
  instead of -9: the hemisphere was shielded from the guard and the sign lost
  in silence, while `9°O` with the true degree sign worked. The two are nearly
  indistinguishable on screen.
- A coordinate that arrives already numeric is taken as it stands. Below 1e-4
  Python renders a float in exponential form, and the digits of the exponent
  were parsed as minutes, so a latitude of `1e-05` came back as `1.0833`.
- Columns that are not coordinates keep exactly what the file said. Every cell
  is now read as text, so a sample code of `007` stays `007` instead of being
  inferred as the integer 7 and exported that way, and an integer past 2**53
  keeps every digit. The coordinate columns are unaffected: `parse_coordinate`
  reads them from text as it always did, and the derived `Latitude_DD` and
  `Longitude_DD` columns are numbers as before. A numeric attribute column now
  exports as text rather than as a number, which is the cost of the trade.
- A CSV whose rows do not all have the same number of fields no longer raises.
  `pd.read_csv` reported `ParserError` on a row with more fields than its
  header; short rows are now padded and long ones truncated. A differential run
  over 2500 generated files found 284 inputs that crashed the reader.
- A header cell reading `Unnamed: 0` no longer collides with the name generated
  for an empty cell beside it. That is what a file exported by this application
  and opened again looks like, and the collision left two columns sharing a
  label, which raised further down.
- The separator is guessed by field-count consistency rather than by character
  frequency. `csv.Sniffer` reads a tab-separated file whose cells hold decimal
  commas as comma-separated, and every column is then wrong.
- A CSV with a single column no longer has its header cut in half. When
  `csv.Sniffer` finds no delimiter, pandas guesses one out of the data itself,
  so `lat` came back as the two columns `la` and `Unnamed: 1`. The separator is
  now sniffed explicitly and falls back to a comma, which yields the one column
  the file actually has.
- Seconds are rounded by an explicit half-to-even rule rather than the host
  language's own. Python's `round` and JavaScript's `Math.round` disagree at a
  tie, which made the same file export different DMS strings from the desktop
  application and from the browser one.

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
