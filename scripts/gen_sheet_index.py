"""Generate web/src/core/sheet_index.json - where each map sheet is.

Run deliberately, review the diff by eye, then commit:

    python scripts/gen_sheet_index.py

Every sheet of the Carta Militar 1:25 000 (IGeoE, series M888) and of the Carta
Geológica de Portugal 1:50 000 is a rectangle in the Hayford-Gauss Militar grid
(EPSG:20790): 16 x 10 km and 32 x 20 km, with corners on round kilometres, and
four 1:25 000 sheets make one 1:50 000. So the file holds a grid and a rule,
not shapes, and a point is placed by arithmetic.

- 1:50 000: code, south-west corner and name of each sheet, from LNEG's
  'Carta Geológica de Portugal à escala 1:50 000' service, published under
  CC-BY 4.0.
- 1:25 000: only the numbering. Along each 10 km row the sheets are numbered
  west to east, one per column, without gaps - so a row is its first column and
  its first number, and the 28 sheets outside that pattern (162A, 248B,
  325B/C...) are listed by cell. Read from the sheet numbers and positions in
  LNEG's 'Cartogramas' service; no names are kept.

The script refuses to write if a sheet is not such a rectangle, or if the rule
does not reproduce every sheet it was read from. 494 of the 1:25 000 sheets
were also located independently, from the geoportal's water points and the
sheet each is filed under; all 494 agree.
"""
import json
import pathlib
import re
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from geocoord import crs  # noqa: E402

OUT = ROOT / "web" / "src" / "core" / "sheet_index.json"
SHEETS_25 = "https://sig.lneg.pt/server/rest/services/geoPortal/Cartogramas/MapServer/0"
SHEETS_50 = "https://sig.lneg.pt/server/rest/services/CGP50k/MapServer/5"
# The same sheets as the Cartogramas service draws them, read only for the
# sheets printed joined: 44-C there is 44-CD, with its Spanish half.
JOINED_50 = "https://sig.lneg.pt/server/rest/services/geoPortal/Cartogramas/MapServer/1"
QUERY = "/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson"
MILITAR = crs.REGISTRY["20790"]["proj4"]

ORIGIN = (8, 0)        # km: sheet corners sit on M = 8 + 16i, P = 10j
SIZE_25 = (16, 10)
SIZE_50 = (32, 20)


def fetch(url):
    with urllib.request.urlopen(url + QUERY, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))["features"]


def corner(feature, size):
    """South-west corner in km, after checking the sheet is a grid rectangle."""
    g = feature["geometry"]
    ring = g["coordinates"][0] if g["type"] == "Polygon" else g["coordinates"][0][0]
    pts = [crs.from_wgs84(lon, lat, MILITAR) for lon, lat in ring]
    ms = [x / 1000 for x, _ in pts]
    ps = [y / 1000 for _, y in pts]
    m0, p0 = round(min(ms)), round(min(ps))
    w, h = max(ms) - min(ms), max(ps) - min(ps)
    if (abs(w - size[0]) > 0.01 or abs(h - size[1]) > 0.01
            or abs(min(ms) - m0) > 0.01 or abs(min(ps) - p0) > 0.01
            or (m0 - ORIGIN[0]) % size[0] or (p0 - ORIGIN[1]) % size[1]):
        raise SystemExit(f"not a {size} grid rectangle: {feature['properties']} "
                         f"({min(ms):.3f}, {min(ps):.3f}, {w:.3f} x {h:.3f})")
    return m0, p0


def sheets_25():
    """(key, column, row) for every 1:25 000 sheet, an inset counted once per place."""
    out = set()
    for f in fetch(SHEETS_25):
        nome = f["properties"]["Nome"].strip()
        m = re.fullmatch(r"(\d+)([A-Z](?:/[A-Z])?)?\s+-\s+.+", nome)
        if not m:
            raise SystemExit(f"unexpected 1:25 000 name: {nome!r}")
        m0, p0 = corner(f, SIZE_25)
        out.add((m.group(1) + (m.group(2) or ""), (m0 - ORIGIN[0]) // SIZE_25[0], p0 // SIZE_25[1]))
    return sorted(out)


def rule_25(sheets):
    """Runs of consecutive numbers along a row, and the sheets outside them."""
    plain = sorted(((j, i, int(k)) for k, i, j in sheets if k.isdigit()), key=lambda t: (-t[0], t[1]))
    runs = []
    for j, i, n in plain:
        last = runs[-1] if runs else None
        if last and last[0] == j and i == last[1] + last[3] and n == last[2] + last[3]:
            last[3] += 1
        else:
            runs.append([j, i, n, 1])
    special = sorted(([k, i, j] for k, i, j in sheets if not k.isdigit()),
                     key=lambda s: (int(re.match(r"\d+", s[0]).group()), s[0], s[1], s[2]))
    return runs, special


def expand(runs, special):
    cells = {(str(n + k), i + k, j) for j, i, n, count in runs for k in range(count)}
    return cells | {(k, i, j) for k, i, j in special}


def sheets_50():
    out = []
    for f in fetch(SHEETS_50):
        code = f["properties"]["Numero"].strip()
        m = re.fullmatch(r"0*(\d+)-([A-D]{1,2})", code)
        if not m:
            raise SystemExit(f"unexpected 1:50 000 code: {code!r}")
        m0, p0 = corner(f, SIZE_50)
        name = (f["properties"].get("Regiao") or "").strip()
        out.append([f"{m.group(1)}-{m.group(2)}", m0, p0, name])
    return sorted(out, key=lambda s: (int(s[0].split("-")[0]), s[0]))


def aliases_50(s50):
    """Other ways a table may write a sheet printed with its other half."""
    by_corner = {(m0, p0): key for key, m0, p0, _ in s50}
    out = {}
    for f in fetch(JOINED_50):
        m = re.fullmatch(r"0*(\d+)-([A-D]{2})", f["properties"]["Carta"].strip())
        if not m:
            continue
        key = by_corner[corner(f, SIZE_50)]
        for alias in [f"{m.group(1)}-{m.group(2)}"] + [f"{m.group(1)}-{c}" for c in m.group(2)]:
            if alias != key:
                out[alias] = key
    return dict(sorted(out.items()))


def main():
    s25 = sheets_25()
    runs, special = rule_25(s25)
    if expand(runs, special) != set(s25):
        raise SystemExit("the numbering rule does not reproduce the sheets it was read from")
    cells = [(i, j) for _, i, j in expand(runs, special)]
    if len(cells) != len(set(cells)):
        raise SystemExit("two 1:25 000 sheets share a cell")

    data = {
        "source": "Carta Geológica de Portugal 1:50 000 (seccionamento), LNEG, CC-BY 4.0; "
                  "numeração da Carta Militar de Portugal 1:25 000 (IGeoE, série M888)",
        "crs": "EPSG:20790",
        "units": "km",
        "origin": list(ORIGIN),
        "size25": list(SIZE_25),
        "size50": list(SIZE_50),
        "runs25": runs,
        "special25": special,
        "s50": sheets_50(),
    }
    data["aliases50"] = aliases_50(data["s50"])
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n",
                   encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(s25)} sheets at 1:25 000 "
          f"({len(runs)} runs, {len(special)} outside them), {len(data['s50'])} at 1:50 000")


if __name__ == "__main__":
    main()
