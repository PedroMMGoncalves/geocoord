"""Synthetic test data for the README screenshots.

Run from the repository root:

    python scripts/make_synthetic_samples.py

Nothing here comes from a real survey. The point of the images is to show what
the application does with the shapes real files have - a missing hemisphere, a
reversed column pair - and those shapes are reproducible without publishing
anybody's sampling sites.

Two files:

  amostras_sinteticas.xlsx  unsigned magnitudes in the Tete shape, so the
                            application reads them as Sudan and offers the
                            region whose sign would place them
  ensaios_sinteticos.xlsx   points around Portugal with a third of the rows
                            written the other way round, so the review gate has
                            something to hold
"""
import pathlib
import random

from openpyxl import Workbook

OUT = pathlib.Path(__file__).resolve().parents[1] / "docs" / "screenshots" / "samples"
OUT.mkdir(parents=True, exist_ok=True)
random.seed(20260909)


def dms(value):
    """A magnitude as unsigned degrees-minutes-seconds, the way a field sheet
    is written when everyone on the survey knew which hemisphere they were in."""
    d = int(value)
    rest = (value - d) * 60
    m = int(rest)
    s = int(round((rest - m) * 60))
    if s == 60:
        s, m = 0, m + 1
    if m == 60:
        m, d = 0, d + 1
    return f"{d:02d} {m:02d} {s:02d}"


# --------------------------------------------------------------------------
# 1. unsigned southern-hemisphere magnitudes
# --------------------------------------------------------------------------
LOCALS = ["Namtala", "Chirodzi", "Mualadzi", "Benga", "Kambulatsitsi",
          "Nhamayabue", "Cassoca", "Muturara", "Chindiro", "Zangue",
          "Marara", "Doeze", "Nhacuecha", "Tsandzu", "Mecumbura",
          "Bandanga", "Chiuta", "Luia", "Capirizange", "Chioco"]
ROCK = ["Granito", "Xisto", "Gnaisse", "Quartzito", "Arenito", "Basalto"]

wb = Workbook()
ws = wb.active
ws.title = "Amostras"
ws.append(["Local", "Latitude", "Longitude", "Litologia"])
for name in LOCALS:
    lat = random.uniform(14.9, 16.6)      # written unsigned; really south
    lon = random.uniform(30.4, 34.6)
    ws.append([name, dms(lat), dms(lon), random.choice(ROCK)])
wb.save(OUT / "amostras_sinteticas.xlsx")

# --------------------------------------------------------------------------
# 2. a Portuguese set with a third of the rows reversed
# --------------------------------------------------------------------------
SITES = ["Ponto A", "Ponto B", "Ponto C", "Ponto D", "Ponto E", "Ponto F",
         "Ponto G", "Ponto H", "Ponto J", "Ponto K", "Ponto L", "Ponto M",
         "Ponto N", "Ponto P", "Ponto Q", "Ponto R", "Ponto S", "Ponto T",
         "Ponto U", "Ponto V", "Ponto X", "Ponto Z", "Ponto AA", "Ponto AB"]
KIND = ["Sondagem", "Afloramento", "Trincheira", "Escombreira"]

wb = Workbook()
ws = wb.active
ws.title = "Ensaios"
ws.append(["Referência", "Latitude", "Longitude", "Tipo", "Profundidade (m)"])
for i, name in enumerate(SITES):
    lat = round(random.uniform(37.2, 41.7), 6)
    lon = round(random.uniform(-8.9, -7.1), 6)
    depth = round(random.uniform(1.5, 120.0), 1)
    if i % 3 == 2:                       # every third row written backwards
        ws.append([name, lon, lat, random.choice(KIND), depth])
    else:
        ws.append([name, lat, lon, random.choice(KIND), depth])
wb.save(OUT / "ensaios_sinteticos.xlsx")

print("written:")
for f in sorted(OUT.iterdir()):
    print("  ", f.name, f.stat().st_size, "bytes")
