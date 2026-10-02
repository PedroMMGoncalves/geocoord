"""Set the datum transformation of every Portuguese system to the best published.

Run deliberately, review the diff by eye, then regenerate the contract:

    python scripts/set_transformations.py
    python scripts/gen_parity_fixtures.py

The registry's definitions were EPSG's, and EPSG's transformations for these
datums are not the best that exist. The Direção-Geral do Território, which
maintains the national geodetic network, publishes better ones:

- Datum Lisboa and Datum 73, on the mainland: NTv2 grids, fitted to 1129
  stations and checked at 130 more - mean residual 0.09 m and 0.06 m. The
  seven-parameter transformations from EPSG that the registry used put the
  same points 1.6 m and 0.5 m away on average, and up to 3.7 m. Outside the
  grids (the sea, Spain), DGT's own Bursa-Wolf parameters.
- The Azores and Madeira: DGT's Bursa-Wolf parameters to PTRA08, island group
  by island group, with residuals of 2 to 18 cm. The registry had EPSG's
  three-parameter shifts, which put points up to 2.8 m away.
- Madeira 1936 (2191): EPSG retired the code as a duplicate of Porto Santo
  1936 (2942) - the same Base SE datum - and it had no transformation at all,
  only the ballpark. It takes Base SE's parameters too.

Every value below is DGT's, copied from the documents named beside it, in the
position vector convention its own formula sheet gives (ISO 19111) - which is
the convention of proj4's +towgs84, so nothing is negated. The script refuses
to write unless DGT's own worked examples are reproduced to the centimetre.

ETRS89 (mainland) and PTRA08 (islands) are taken as WGS84, as EPSG's null
transformations and DGT's own service do; the difference is under a metre and
grows with time, and no file here carries the epoch it would need.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import pyproj  # noqa: E402
from pyproj import Transformer  # noqa: E402

REGISTRY = ROOT / "geocoord" / "crs_registry.json"
GRIDS = ROOT / "geocoord" / "grids"
pyproj.datadir.append_data_dir(str(GRIDS))

CONTINENTE = ("DGT, Parâmetros de Transformação para Portugal Continental (Jul. 2009); "
              "grelhas NTv2 DLx_ETRS89_geo e D73_ETRS89_geo")
ACORES_MADEIRA = ("DGT, Parâmetros de Transformação para os Arquipélagos dos Açores "
                  "e da Madeira (Maio 2009)")

#: code -> (grid or None, Bursa-Wolf to ETRS89/PTRA08, source, accuracy note)
BEST = {
    "20790": ("DLX_ETRS89_geo.gsb",
              "-283.088,-70.693,117.445,-1.157,0.059,-0.652,-4.058",
              CONTINENTE,
              "grelha NTv2 da DGT: resíduo médio 0,09 m, máximo 0,30 m; fora da grelha, "
              "Bursa-Wolf da DGT (1,4 m)"),
    "27493": ("D73_ETRS89_geo.gsb",
              "-230.994,102.591,25.199,0.633,-0.239,0.900,1.950",
              CONTINENTE,
              "grelha NTv2 da DGT: resíduo médio 0,06 m, máximo 0,16 m; fora da grelha, "
              "Bursa-Wolf da DGT (0,4 m)"),
    # Observatório (Flores), the western group, onto PTRA08 / UTM 25N.
    "2188": (None, "-487.978,-226.275,102.787,-0.743,1.677,2.087,1.485",
             ACORES_MADEIRA, "Bursa-Wolf da DGT, grupo ocidental: 0,03 m"),
    # Base SW (Graciosa), the central group.
    "2189": (None, "-185.391,122.266,35.989,0.120,3.180,2.046,-1.053",
             ACORES_MADEIRA, "Bursa-Wolf da DGT, grupo central: 0,18 m"),
    # S. Brás (São Miguel), the eastern group.
    "2190": (None, "-269.089,186.247,155.667,2.005,3.606,-0.366,0.097",
             ACORES_MADEIRA, "Bursa-Wolf da DGT, grupo oriental: 0,02 m"),
    # Base SE (Porto Santo), Madeira and Porto Santo. DGT's own service
    # applies these to EPSG:2942; EPSG attaches DGT's numbers for the same
    # datum to Porto Santo 1995, and its transformations for that datum agree
    # with these to between 1 and 13 cm. The two realisations of the Base SE
    # datum are taken as one, as DGT takes them.
    "2942": (None, "-160.410,-21.066,-99.282,2.437,-17.250,-7.446,0.168",
             ACORES_MADEIRA, "Bursa-Wolf da DGT, Base SE: 0,05 m"),
    "3061": (None, "-160.410,-21.066,-99.282,2.437,-17.250,-7.446,0.168",
             ACORES_MADEIRA, "Bursa-Wolf da DGT, Base SE: 0,05 m"),
    # Retired by EPSG in favour of 2942 for Madeira and Porto Santo.
    "2191": (None, "-160.410,-21.066,-99.282,2.437,-17.250,-7.446,0.168",
             ACORES_MADEIRA, "Bursa-Wolf da DGT, Base SE: 0,05 m"),
}

#: The note each system's picker shows, where the transformation needs saying.
#: The page says these in Portuguese too (web/src/i18n/dict.file.js).
NOTES = {
    "20790": ('Known in Portugal as Hayford-Gauss Militar; EPSG names it "Lisbon (Lisbon) / '
              'Portuguese National Grid". Moved onto ETRS89 by DGT\'s NTv2 grid, to about '
              '0.1 m; outside the grid, by DGT\'s seven parameters.'),
    "27493": ("Known in Portugal as Hayford-Gauss IPCC or Datum 73. Moved onto ETRS89 by "
              "DGT's NTv2 grid, to about 0.1 m; outside the grid, by DGT's seven parameters."),
    "2191": ("EPSG retired this code as a duplicate of Porto Santo 1936 (2942): the same "
             "Base SE datum, and the same DGT parameters. Prefer 2942 or, better, PTRA08 (5016)."),
}

#: DGT's worked examples: (code, E, N) -> (target proj4, E, N), 2D (h = 0).
#: The mainland ones are DGT's own service's answers for a grid case and a
#: Bursa-Wolf case; the island ones are the examples printed beside the
#: parameters, which are 3D, read here at h = 0 from DGT's service.
PT_TM06 = "+proj=tmerc +lat_0=39.6682583333333 +lon_0=-8.13310833333333 +k=1 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs"
UTM = "+proj=utm +zone={} +ellps=GRS80 +units=m +no_defs"
EXAMPLES = [
    ("20790", 176000.0, 365000.0, PT_TM06, -23998.782, 64999.726),
    ("2188", 660000.0, 4370000.0, UTM.format(25), 659623.097, 4370066.439),
    ("2189", 400000.0, 4280000.0, UTM.format(26), 400100.917, 4279915.883),
    ("2190", 630000.0, 4180000.0, UTM.format(26), 630030.870, 4180036.830),
    ("2942", 315000.0, 3625000.0, UTM.format(28), 314632.232, 3625352.750),
]
WGS84 = "+proj=longlat +datum=WGS84 +no_defs"


def through_wgs84(x, y, source, target):
    lon, lat = Transformer.from_crs(pyproj.CRS.from_proj4(source), pyproj.CRS.from_proj4(WGS84),
                                    always_xy=True).transform(x, y)
    return Transformer.from_crs(pyproj.CRS.from_proj4(WGS84), pyproj.CRS.from_proj4(target),
                                always_xy=True).transform(lon, lat)


def main():
    registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
    for code, (grid, bw, source, accuracy) in BEST.items():
        entry = registry[code]
        base = entry["proj4"].split(" +towgs84=")[0].split(" +nadgrids=")[0]
        bursa = f"{base} +towgs84={bw}"
        if grid:
            if not (GRIDS / grid).exists():
                raise SystemExit(f"missing grid {grid}")
            entry["proj4"] = f"{base} +nadgrids={grid}"
            entry["fallback"] = bursa
        else:
            entry["proj4"] = bursa
            entry.pop("fallback", None)
        entry["transformation"] = {"source": source, "accuracy": accuracy}
        if code in NOTES:
            entry["note"] = NOTES[code]

    for code, x, y, target, e, n in EXAMPLES:
        got = through_wgs84(x, y, registry[code]["proj4"], target)
        if abs(got[0] - e) > 0.01 or abs(got[1] - n) > 0.01:
            raise SystemExit(f"EPSG:{code} does not reproduce DGT's example: {got} vs ({e}, {n})")
        print(f"EPSG:{code}: DGT example reproduced to "
              f"{max(abs(got[0] - e), abs(got[1] - n)) * 1000:.1f} mm")

    REGISTRY.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {REGISTRY.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
