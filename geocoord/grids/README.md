# Transformation grids

The two NTv2 grids the Direção-Geral do Território (DGT) publishes for moving
the old mainland datums onto ETRS89. Both the browser and the desktop read these
same files: proj4js through `proj4.nadgrid`, pyproj through PROJ's own NTv2
reader.

| File | From | To | Residuals at 130 test points |
| --- | --- | --- | --- |
| `DLX_ETRS89_geo.gsb` | Datum Lisboa (Hayford-Gauss IGeoE, EPSG:20790) | ETRS89 | mean 0.09 m, max 0.30 m |
| `D73_ETRS89_geo.gsb` | Datum 73 (Hayford-Gauss IPCC, EPSG:27493) | ETRS89 | mean 0.06 m, max 0.16 m |

Both cover 36.76°–42.36° N, 5.75°–9.93° W at 72″ spacing. A point outside
falls back to DGT's Bursa-Wolf parameters for the same datum.

- Source: DGT, *Transformação de Coordenadas — Portugal Continental*,
  <https://www.dgterritorio.gov.pt/atividades/geodesia/transformacao-coordenadas/portugal-continental>
  (`DLx_ETRS89_geo.zip`, `D73_ETRS89_geo.zip`, unpacked unchanged).
- Licence: Creative Commons Attribution 4.0, © Direção-Geral do Território,
  as the grids are also distributed in PROJ-data (`pt_dgt`), whose GeoTIFF
  copies give identical results to these files at every one of 2000 points
  tested.
- SHA-256:
  - `DLX_ETRS89_geo.gsb` `55fcfa790fa76994d937a7d90806ddd4e8994ca86cfb98651d8868b603212dbc`
  - `D73_ETRS89_geo.gsb` `54256060b00910d614fcf7d73c1c2514c90e6b389c750b6bfde46f7220358708`
