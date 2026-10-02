"""Fetch DGT's own answers for a set of synthetic points: tests/fixtures/dgt_reference.json.

Run deliberately - it calls DGT's public transformation service, once per point:

    python scripts/fetch_dgt_reference.py

The Direção-Geral do Território maintains the national geodetic network and
publishes the grids and parameters this application uses; its Web TransCoord
service applies them. Its answers are the reference both implementations are
tested against: not another library's reading of the same parameters, but the
authority's own result. The points are synthetic - generated here from a
fixed seed - so nothing about anybody's data leaves the machine.

The answers are frozen in the fixture. Regenerating changes it only if DGT's
service does.
"""
import json
import pathlib
import random
import sys
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from geocoord import crs  # noqa: E402

OUT = ROOT / "tests" / "fixtures" / "dgt_reference.json"
API = "https://www3.dgterritorio.gov.pt/pt/transform/transform"

# Land boxes to draw points from, in WGS84 - the mainland, and each island the
# old island datums were used on.
MAINLAND = [(37.0, 42.1, -9.4, -6.3)]
ISLANDS = {
    "2188": ("Açores", [(39.37, 39.52, -31.27, -31.13), (39.67, 39.72, -31.12, -31.09)]),  # Flores, Corvo
    "2189": ("Açores", [(38.52, 38.62, -28.78, -28.62), (38.40, 38.55, -28.50, -28.05),        # Faial, Pico
                        (38.55, 38.72, -28.25, -27.80), (39.01, 39.09, -28.05, -27.95),        # S. Jorge, Graciosa
                        (38.65, 38.79, -27.35, -27.05)]),                                       # Terceira
    "2190": ("Açores", [(37.73, 37.86, -25.85, -25.20), (36.93, 37.00, -25.17, -25.02)]),  # S. Miguel, Sta Maria
    "2942": ("Madeira", [(32.65, 32.85, -17.20, -16.75), (33.03, 33.09, -16.38, -16.30)]),  # Madeira, Porto Santo
}
TARGET = {"2188": "5014", "2189": "5015", "2190": "5015", "2942": "5016"}


def ask(x, y, area, crsin, crsout, metodo):
    q = urllib.parse.urlencode({"x": f"{x:.3f}", "y": f"{y:.3f}", "area": area,
                                "crsin": crsin, "crsout": crsout, "metodo": metodo})
    with urllib.request.urlopen(f"{API}?{q}", timeout=60) as r:
        data = json.loads(r.read().decode("utf-8"))
    time.sleep(0.25)  # be a polite client of a public service
    if "xout" not in data:
        return None
    return data["xout"], data["yout"]


def draw(boxes, n, rng):
    out = []
    for _ in range(n):
        s, nn, w, e = rng.choice(boxes)
        out.append((rng.uniform(w, e), rng.uniform(s, nn)))
    return out


def main():
    rng = random.Random(20261003)
    cases = []

    def add(kind, source, target, metodo, area, pts_wgs84):
        for lon, lat in pts_wgs84:
            # The input is written in the source system: a point of the
            # mainland, read as that system, as a survey there would have it.
            x, y = crs.from_wgs84(lon, lat, crs.get(source)["proj4"])
            x, y = round(x, 3), round(y, 3)
            got = ask(x, y, area, source, target, metodo)
            if got is None:
                continue
            cases.append({"id": f"{kind}_{len(cases)}", "source": source, "target": target,
                          "method": metodo, "x": x, "y": y, "x_dgt": got[0], "y_dgt": got[1]})
            print(cases[-1]["id"], source, "->", target, metodo, (x, y), "->", got)

    # The mainland: the grids, both ways, and the Bursa-Wolf parameters the
    # registry falls back on outside them.
    add("lisboa_grid", "20790", "3763", "grelhas", "Portugal continental", draw(MAINLAND, 30, rng))
    add("datum73_grid", "27493", "3763", "grelhas", "Portugal continental", draw(MAINLAND, 30, rng))
    add("lisboa_grid_inverse", "3763", "20790", "grelhas", "Portugal continental", draw(MAINLAND, 12, rng))
    add("datum73_grid_inverse", "3763", "27493", "grelhas", "Portugal continental", draw(MAINLAND, 12, rng))
    add("lisboa_bursa_wolf", "20790", "3763", "bursaWolf", "Portugal continental", draw(MAINLAND, 8, rng))
    add("datum73_bursa_wolf", "27493", "3763", "bursaWolf", "Portugal continental", draw(MAINLAND, 8, rng))
    # The islands: DGT's Bursa-Wolf parameters, both ways.
    for code, (area, boxes) in ISLANDS.items():
        add(f"islands_{code}", code, TARGET[code], "bursaWolf", area, draw(boxes, 10, rng))
        add(f"islands_{code}_inverse", TARGET[code], code, "bursaWolf", area, draw(boxes, 4, rng))

    OUT.write_text(json.dumps({
        "source": "DGT Web TransCoord (https://www3.dgterritorio.gov.pt/pt/transform/), "
                  "answers to synthetic points; 2D, output rounded by DGT to the millimetre",
        "tolerance_m": 0.0015,
        "cases": cases,
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(cases)} cases")


if __name__ == "__main__":
    main()
