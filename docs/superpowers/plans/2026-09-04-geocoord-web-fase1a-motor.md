# GeoCoord Web — Fase 1a: contrato de paridade e motor de conversão

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar `web/src/core/converter.js` — a tradução JavaScript de
`geocoord/converter.py` — e o ficheiro de fixtures que o pytest e o vitest leem
em comum, de modo a que qualquer divergência entre as duas implementações faça
falhar os dois CIs.

**Architecture:** As fixtures em `tests/fixtures/parity.json` são o contrato.
São geradas uma única vez por um script que corre a implementação Python sobre
entradas escolhidas à mão, revistas, e depois congeladas em git. A partir daí
`tests/test_parity.py` verifica o lado Python contra o ficheiro e
`web/tests/converter.test.js` verifica o lado JavaScript contra o mesmo
ficheiro. Nenhum dos lados é a referência: o ficheiro é.

**Tech Stack:** JavaScript ES modules (sem framework nesta fase), vitest para
testes, Node 22. Python 3.11+ com pytest, já instalado no repositório.

**Âmbito:** Este plano cobre apenas a **fase 1a** do faseamento da §11 da spec.
Não há interface, não há Vite, não há React, não há projeções. Ao terminar
existe uma biblioteca JavaScript testada e provadamente concordante com o
Python. A fase 1b (`geoexport.js` e o escritor de Shapefile) tem plano próprio.

**Spec:**
[2026-09-04-geocoord-web-design.md](../specs/2026-09-04-geocoord-web-design.md)

---

## Correções à spec apuradas antes de escrever este plano

Duas afirmações da spec não sobreviveram à verificação. Estão corrigidas aqui e
devem ser corrigidas na spec:

1. **§5 diz que o Shapefile é determinista e comparável byte a byte. É falso.**
   O cabeçalho DBF escrito pelo pyshp guarda a data de escrita nos bytes 1 a 3
   (verificado: `[126, 9, 4]` = 2026-09-04), e o `zipfile.writestr` carimba cada
   entrada com a hora local. Comparar o `.zip` ou o `.dbf` byte a byte falha ao
   virar do dia, e ao virar do segundo. Isto afeta a fase 1b, não esta, mas fica
   registado.

2. **§5 fala em comparar os bytes do GeoJSON.** O `json.dumps` do Python usa
   `", "` e `": "` como separadores; o `JSON.stringify` não põe espaço nenhum. A
   paridade do GeoJSON tem de ser feita sobre o objeto desserializado, não sobre
   os bytes. Também isto pertence à fase 1b.

Um terceiro ponto, que afeta esta fase: **um float inteiro imprime-se de forma
diferente nas duas linguagens.** Python escreve `-8.0`, JavaScript escreve `-8`.
Onde houver comparação de texto, a formatação tem de ser explícita. Nesta fase
só toca no `formatDms`, que já usa `%g` e portanto não sofre; fica o aviso para
a fase 1b, onde o KML imprime coordenadas.

---

## Estrutura de ficheiros

| Ficheiro | Responsabilidade |
| --- | --- |
| `scripts/gen_parity_fixtures.py` | Gera `parity.json` a partir de entradas escolhidas à mão. Corre-se raramente e de propósito. |
| `tests/fixtures/parity.json` | O contrato. Congelado em git, revisto por humano. |
| `tests/test_parity.py` | Verifica o lado Python contra o contrato. |
| `web/package.json` | Dependências e scripts da SPA (só vitest nesta fase). |
| `web/vitest.config.js` | Configuração dos testes. |
| `web/tests/fixtures.js` | Carrega `parity.json` a partir do JavaScript. |
| `web/src/core/converter.js` | A tradução. Sem dependências de UI, sem imports de terceiros. |
| `web/tests/converter.test.js` | Verifica o lado JavaScript contra o contrato. |
| `.github/workflows/ci.yml` | Ganha um job `web` a correr o vitest. |

`converter.js` é um único ficheiro porque `converter.py` também é um só, e a
paridade fica mais fácil de auditar quando as duas implementações se leem lado a
lado com a mesma ordem de funções.

---

## Task 1: Andaime do `web/` e vitest a correr

**Files:**

- Create: `web/package.json`
- Create: `web/vitest.config.js`
- Create: `web/src/core/converter.js`
- Create: `web/tests/converter.test.js`

- [ ] **Step 1: Criar o `web/package.json`**

```json
{
  "name": "geocoord-web",
  "private": true,
  "version": "0.1.0",
  "description": "GeoCoord web application (browser-side coordinate converter)",
  "license": "Apache-2.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vitest": "^4.1.11"
  }
}
```

- [ ] **Step 2: Criar o `web/vitest.config.js`**

```js
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
  },
})
```

- [ ] **Step 3: Instalar as dependências**

Run: `cd web && npm install`
Expected: cria `web/node_modules/` e `web/package-lock.json`. O
`.gitignore` da raiz já ignora `node_modules/` a qualquer profundidade, logo não
é preciso alterá-lo.

**Se falhar com `Cannot read properties of null (reading 'edgesOut')`**, é um
defeito do Arborist do npm ao resolver o grafo de dependências de pares do
vitest, sem lockfile. Reproduzido com npm 10.9.8 e Node 22.23.2. Correr uma vez:

```bash
npm install --legacy-peer-deps
```

Isto muda apenas a estratégia de resolução de pares, não as dependências
declaradas. Depois de o lockfile existir, tanto `npm install` como `npm ci`
funcionam normalmente — verificado — e o CI, que usa `npm ci`, nunca chega a
tocar neste caminho.

- [ ] **Step 4: Escrever o teste que falha**

Criar `web/tests/converter.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { parseCoordinate } from '../src/core/converter.js'

describe('parseCoordinate', () => {
  it('reads a plain decimal string', () => {
    expect(parseCoordinate('38.708333')).toBeCloseTo(38.708333, 12)
  })
})
```

- [ ] **Step 5: Correr o teste para confirmar que falha**

Run: `cd web && npm test`
Expected: FAIL — `Failed to resolve import "../src/core/converter.js"`.

- [ ] **Step 6: Criar o módulo mínimo**

Criar `web/src/core/converter.js`:

```js
/**
 * Coordinate conversion engine for GeoCoord (JavaScript port).
 *
 * This file is a deliberate, function-by-function translation of
 * `geocoord/converter.py`. Keep the two in the same order and keep the
 * behaviour identical: `tests/fixtures/parity.json` is the contract both
 * implementations are checked against, and any divergence fails both CIs.
 */

/**
 * Convert a value (DMS/DM/decimal) into decimal degrees.
 * Returns null when the value is empty or cannot be interpreted.
 */
export function parseCoordinate(value) {
  if (value === null || value === undefined) return null
  return Number(value)
}
```

- [ ] **Step 7: Correr o teste para confirmar que passa**

Run: `cd web && npm test`
Expected: PASS — 1 teste.

- [ ] **Step 8: Commit**

```bash
git add web/package.json web/package-lock.json web/vitest.config.js \
        web/src/core/converter.js web/tests/converter.test.js
git commit -m "chore(web): scaffold the web package with vitest"
```

---

## Task 2: Gerador de fixtures e o contrato de paridade

> **CONCLUÍDA** em 2026-09-04, commits `6a32234` e `9cd80ac`. Três desvios ao
> que está escrito abaixo, todos deliberados:
>
> 1. O gerador precisou de um bootstrap `sys.path`. O repositório não tem
>    `setup.py` nem `pyproject.toml`, e ao correr um script dentro de `scripts/`
>    o Python põe essa pasta no `sys.path`, não a raiz — o pytest só escapa
>    porque o `pytest.ini` tem `pythonpath = .`.
> 2. As comparações do centro em `test_detect_swaps` levaram `rel_tol=0`. Sem
>    ele o `math.isclose` aplica o seu `rel_tol` por omissão de `1e-09`, que à
>    latitude 39 admite 3,9e-08 — o `abs_tol=1e-12` estava morto, e logo no
>    valor mais difícil de traduzir.
> 3. O caso `word_with_direction_letter` (`"Norte"`) não testava o que o nome
>    dizia: devolve `None` no `if not nums` e nunca chega à lógica dos
>    hemisférios. Foi renomeado para `word_only_no_digits` e acrescentaram-se
>    três casos que pinam mesmo a guarda `\b`: `"38 Oeste"` → `38.0`,
>    `"38.5W"` → `38.5` e `"38.5 W"` → `-38.5`. Somou-se também
>    `all_empty_returns_empty_shape` ao `tidy_table`.
>
>
> 4. Depois da revisão de qualidade acrescentou-se ainda
>    `no_spaces_negative_hemisphere` (`38°30'0"O` → `-38.5`), porque o caso
>    `no_spaces` existente usa `N`, positivo em qualquer leitura: um port que
>    delimite o hemisfério por espaços em vez de fronteira de palavra passava
>    os 29 casos e continuava a ler oeste como positivo.
>
> Daí as contagens abaixo serem 79 e 153, e não 72 e 142.
> Commits: `6a32234`, `9cd80ac`, `1e99c65`.
>
> O commit `390f032`, posterior e fora desta tarefa, corrigiu dois bugs do
> motor que o contrato tinha apanhado — o hemisfério colado ao número e as
> colunas chamadas `nan` — e regenerou o contrato em conformidade. Foi o
> `test_parity.py` a assinalar a alteração de comportamento, que é
> exatamente para o que ele existe.

O gerador corre a implementação Python sobre entradas escolhidas à mão e escreve
os resultados. Corre-se **uma vez**, revê-se o ficheiro à vista, e faz-se
commit. A partir daí o ficheiro está congelado: se o comportamento do Python
mudar, o `test_parity.py` falha, que é exatamente o que se quer.

As entradas partilhadas são apenas as representáveis em JSON. Valores vazios
específicos de cada linguagem (`float('nan')` do lado Python, `NaN` e
`undefined` do lado JavaScript) ficam nos testes próprios de cada lado, porque
não atravessam o JSON. Isto está escrito dentro do próprio ficheiro.

**Files:**

- Create: `scripts/gen_parity_fixtures.py`
- Create: `tests/fixtures/parity.json` (gerado)
- Create: `tests/test_parity.py`

- [ ] **Step 1: Escrever o gerador**

Criar `scripts/gen_parity_fixtures.py`:

```python
"""Generate tests/fixtures/parity.json — the pytest <-> vitest contract.

Run deliberately, review the diff by eye, then commit:

    python scripts/gen_parity_fixtures.py

The inputs below are chosen by hand; the expected values are computed with the
Python implementation. Once committed the file is frozen: if Python's behaviour
changes, tests/test_parity.py fails, which is the point.

Only JSON-representable inputs go in here. Language-specific empty values
(float('nan') on the Python side, NaN/undefined on the JavaScript side) stay in
each side's own tests.
"""
import json
import pathlib

from geocoord.converter import (
    detect_swaps,
    format_dms,
    identify_region,
    in_range,
    parse_coordinate,
    point_in_mask,
    region_check,
    tidy_table,
)

OUT = pathlib.Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "parity.json"

PARSE_INPUTS = [
    ("decimal_positive", "38.708333"),
    ("decimal_negative", "-9.5"),
    ("decimal_comma", "38,5"),
    ("native_float", -9.139),
    ("native_int", 38),
    ("dms_north", '38° 42\' 30" N'),
    ("dms_west_english", '9° 30\' 0" W'),
    ("dms_west_portuguese", '9° 30\' 0" O'),
    ("dms_east_portuguese", '7° 30\' 0" L'),
    ("dms_east_english", '7° 30\' 0" E'),
    ("dms_south", '15° 30\' 0" S'),
    ("direction_prefix", "W 9° 30'"),
    ("minus_without_direction", '-9° 30\' 0"'),
    ("dm_decimal_minutes", "38° 42.5'"),
    ("dm_negative", "-9° 8.34'"),
    ("no_spaces", '38°42\'30"N'),
    ("space_separated", "38 42 30 N"),
    ("degrees_only", "38°"),
    ("four_numbers_extra_ignored", '38° 42\' 30" 5 N'),
    ("word_with_direction_letter", "Norte"),
    ("empty", ""),
    ("whitespace", "   "),
    ("lone_minus", "-"),
    ("em_dash", "—"),
    ("text", "texto"),
    ("null", None),
]

IN_RANGE_INPUTS = [
    ("lat_valid", 38.7, "lat"),
    ("lat_high", 95.0, "lat"),
    ("lat_boundary_low", -90.0, "lat"),
    ("lat_boundary_high", 90.0, "lat"),
    ("lat_null", None, "lat"),
    ("lon_valid", -9.1, "lon"),
    ("lon_high", 200.0, "lon"),
    ("lon_boundary_low", -180.0, "lon"),
    ("lon_boundary_high", 180.0, "lon"),
]

FORMAT_DMS_INPUTS = [
    ("lat_positive", 38.708333, "lat"),
    ("lon_negative", -9.136667, "lon"),
    ("zero_lat", 0.0, "lat"),
    ("half_degree_west", -0.5, "lon"),
    ("near_pole", 89.999, "lat"),
    ("one_north", 1.0, "lat"),
    ("one_south", -1.0, "lat"),
    ("one_east", 1.0, "lon"),
    ("one_west", -1.0, "lon"),
    ("rounding_rollover", 38.99999999, "lat"),
    ("null", None, "lat"),
]

PT = [36.8, 42.2, -9.6, -6.1]
MZ = [-27.0, -10.4, 30.1, 41.0]
REGIONS = {"Portugal mainland": [PT], "Moçambique": [MZ]}

DETECT_INPUTS = [
    {
        "id": "single_cluster_all_ok",
        "lats": [39.0, 39.1, 38.9, 39.2, 38.8, 39.05],
        "lons": [-8.0, -8.1, -7.9, -8.2, -7.8, -8.05],
        "kwargs": {},
    },
    {
        "id": "range_swap",
        "lats": [150.0],
        "lons": [20.0],
        "kwargs": {},
    },
    {
        "id": "out_of_range_and_missing",
        "lats": [200.0, None],
        "lons": [400.0, 1.0],
        "kwargs": {},
    },
    {
        "id": "below_min_cluster_no_cluster_step",
        "lats": [39.0, 39.1],
        "lons": [-8.0, -8.1],
        "kwargs": {},
    },
    {
        "id": "cluster_majority",
        "lats": [39.0, 39.1, 38.9, 39.2, 38.8, 39.05, 39.15, -8.0],
        "lons": [-8.0, -8.1, -7.9, -8.2, -7.8, -8.05, -8.15, 39.0],
        "kwargs": {},
    },
    {
        "id": "two_legit_clusters_no_false_positive",
        "lats": [39.0, 39.1, 38.9, 39.2, 38.8, 39.05, -25.0, -25.1, -24.9],
        "lons": [-8.0, -8.1, -7.9, -8.2, -7.8, -8.05, 32.0, 32.1, 31.9],
        "kwargs": {},
    },
    {
        "id": "reference_fixes_denser_wrong_cluster",
        "lats": [39.0, 39.1, 38.9, -7.5, -7.6, -7.4, -7.55, -7.45],
        "lons": [-8.0, -8.1, -7.9, 40.0, 40.1, 39.9, 40.05, 39.95],
        "kwargs": {"reference": [39.5, -8.0], "region_radius": 10.0},
    },
    {
        "id": "mask_flags_outside_but_swappable",
        "lats": [39.0, 39.1, -7.485822],
        "lons": [-8.0, -8.1, 40.692444],
        "kwargs": {"mask": [PT]},
    },
    {
        "id": "mask_multi_region_no_false_positive",
        "lats": [39.0, 38.9, -18.0],
        "lons": [-8.0, -7.9, 35.0],
        "kwargs": {"mask": [PT, MZ]},
    },
]

REGION_CHECK_INPUTS = [
    {
        "id": "flags_outside_and_names_actual_region",
        "lats": [-15.94, 39.0],
        "lons": [33.66, -8.0],
        "labels": ["ok", "ok"],
        "kwargs": {"mask": [PT]},
    },
    {
        "id": "outside_with_no_known_region",
        "lats": [33.66],
        "lons": [-15.94],
        "labels": ["ok"],
        "kwargs": {"mask": [PT]},
    },
    {
        "id": "inside_region_not_flagged",
        "lats": [39.0],
        "lons": [-8.0],
        "labels": ["ok"],
        "kwargs": {"mask": [PT]},
    },
    {
        "id": "auto_mode_flags_nothing",
        "lats": [-15.94],
        "lons": [33.66],
        "labels": ["ok"],
        "kwargs": {},
    },
    {
        "id": "ignores_non_ok_rows",
        "lats": [-15.94, 200.0],
        "lons": [33.66, 0.0],
        "labels": ["swap_cluster", "out_of_range"],
        "kwargs": {"mask": [PT]},
    },
    {
        "id": "reference_mode",
        "lats": [-15.94, 39.5],
        "lons": [33.66, -8.0],
        "labels": ["ok", "ok"],
        "kwargs": {"reference": [39.5, -8.0], "region_radius": 5.0},
    },
]

IDENTIFY_INPUTS = [
    ("portugal", 39.0, -8.0),
    ("mozambique", -15.94, 33.66),
    ("atlantic_no_region", 33.66, -15.94),
]

POINT_IN_MASK_INPUTS = [
    ("inside_portugal", 39.0, -8.0, [PT]),
    ("outside_portugal", -15.94, 33.66, [PT]),
    ("on_boundary", 36.8, -9.6, [PT]),
]

# tidy_table works on a neutral table shape so the fixture is language-agnostic:
# {"columns": [...], "rows": [[...], ...]}. The Python side converts to and from
# a DataFrame; the JavaScript side consumes the shape directly.
TIDY_INPUTS = [
    {
        "id": "messy_export_recovers_header",
        "table": {
            "columns": ["Unnamed: 0", "Unnamed: 1", "Unnamed: 2", "Unnamed: 3"],
            "rows": [
                [None, "Amostras", "Y", "X"],
                [None, "1", "33,6603", "-15,9469"],
                [None, "2", "33,6664", "-15,9364"],
            ],
        },
    },
    {
        "id": "drops_empty_column_and_rows",
        "table": {
            "columns": ["idx", "lat", "lon"],
            "rows": [
                [None, "39.0", "-8.0"],
                [None, None, None],
                [None, "38.9", "-7.9"],
            ],
        },
    },
    {
        "id": "leaves_clean_table_unchanged",
        "table": {
            "columns": ["lat", "lon"],
            "rows": [["39.0", "-8.0"], ["38.9", "-7.9"]],
        },
    },
    {
        "id": "promotes_header_only_when_all_placeholder",
        "table": {
            "columns": ["lat", "Unnamed: 1", "lon"],
            "rows": [["39.0", "x", "-8.0"]],
        },
    },
    {
        "id": "blank_strings_count_as_empty",
        "table": {
            "columns": ["lat", "blank", "lon"],
            "rows": [["39.0", "   ", "-8.0"], ["38.9", "", "-7.9"]],
        },
    },
]


def table_to_df(table):
    import pandas as pd

    return pd.DataFrame(table["rows"], columns=table["columns"])


def df_to_table(df):
    return {
        "columns": [str(c) for c in df.columns],
        "rows": [
            [None if v is None or (isinstance(v, float) and v != v) else v for v in row]
            for row in df.astype(object).where(df.notna(), None).values.tolist()
        ],
    }


def build():
    data = {
        "_readme": (
            "Shared contract between pytest (tests/test_parity.py) and vitest "
            "(web/tests/converter.test.js). Generated by "
            "scripts/gen_parity_fixtures.py, then frozen. Do not hand-edit: "
            "change the inputs in the generator and regenerate. Only "
            "JSON-representable inputs live here; NaN and undefined are covered "
            "by each side's own tests."
        ),
        "parse_coordinate": [
            {"id": i, "input": v, "expected": parse_coordinate(v)}
            for i, v in PARSE_INPUTS
        ],
        "in_range": [
            {"id": i, "value": v, "axis": a, "expected": in_range(v, a)}
            for i, v, a in IN_RANGE_INPUTS
        ],
        "format_dms": [
            {"id": i, "value": v, "axis": a, "expected": format_dms(v, a)}
            for i, v, a in FORMAT_DMS_INPUTS
        ],
        "point_in_mask": [
            {"id": i, "lat": la, "lon": lo, "mask": m,
             "expected": point_in_mask(la, lo, m)}
            for i, la, lo, m in POINT_IN_MASK_INPUTS
        ],
        "identify_region": [
            {"id": i, "lat": la, "lon": lo, "regions": REGIONS,
             "expected": identify_region(la, lo, REGIONS)}
            for i, la, lo in IDENTIFY_INPUTS
        ],
        "detect_swaps": [],
        "region_check": [],
        "tidy_table": [],
    }

    for case in DETECT_INPUTS:
        labels, center = detect_swaps(case["lats"], case["lons"], **case["kwargs"])
        data["detect_swaps"].append({
            "id": case["id"],
            "lats": case["lats"],
            "lons": case["lons"],
            "kwargs": case["kwargs"],
            "expected": {
                "labels": labels,
                "center": None if center is None else [center[0], center[1]],
            },
        })

    for case in REGION_CHECK_INPUTS:
        out_idx, detected = region_check(
            case["lats"], case["lons"], case["labels"], REGIONS, **case["kwargs"]
        )
        data["region_check"].append({
            "id": case["id"],
            "lats": case["lats"],
            "lons": case["lons"],
            "labels": case["labels"],
            "regions": REGIONS,
            "kwargs": case["kwargs"],
            # detected is a dict keyed by region name or None; JSON cannot hold a
            # null key, so it travels as an ordered list of pairs.
            "expected": {
                "out_idx": out_idx,
                "detected": [[k, v] for k, v in detected.items()],
            },
        })

    for case in TIDY_INPUTS:
        tidy = tidy_table(table_to_df(case["table"]))
        data["tidy_table"].append({
            "id": case["id"],
            "table": case["table"],
            "expected": df_to_table(tidy),
        })

    return data


if __name__ == "__main__":
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(build(), ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {OUT}")
```

- [ ] **Step 2: Gerar o ficheiro**

Run: `python scripts/gen_parity_fixtures.py`
Expected: `wrote .../tests/fixtures/parity.json`

- [ ] **Step 3: Rever o ficheiro à vista**

Run:

```bash
python -c "import json; d = json.load(open('tests/fixtures/parity.json', encoding='utf-8')); [print(k, len(v) if isinstance(v, list) else '') for k, v in d.items()]"
```

Expected: `parse_coordinate 31`, `in_range 9`, `format_dms 11`,
`point_in_mask 3`, `identify_region 3`, `detect_swaps 9`, `region_check 6`,
`tidy_table 7`.

Abrir o ficheiro e confirmar à vista, no mínimo, estes valores — foram
verificados contra a implementação durante o desenho do plano:

| Caso | Valor esperado |
| --- | --- |
| `parse_coordinate` / `dms_north` | `38.708333333333336` |
| `parse_coordinate` / `dms_west_portuguese` | `-9.5` |
| `parse_coordinate` / `minus_without_direction` | `-9.5` |
| `parse_coordinate` / `word_with_direction_letter` | `null` |
| `format_dms` / `lat_positive` | `"38° 42' 29.999\" N"` |
| `format_dms` / `lon_negative` | `"9° 8' 12.001\" W"` |
| `format_dms` / `zero_lat` | `"0° 0' 0\" N"` |
| `format_dms` / `rounding_rollover` | `"39° 0' 0\" N"` |
| `detect_swaps` / `cluster_majority` centro | `[39.05, -8.05]` |
| `detect_swaps` / `single_cluster_all_ok` centro | `[39.025, -8.025]` |
| `detect_swaps` / `two_legit_clusters...` labels | nove `"ok"` |
| `region_check` / `outside_with_no_known_region` | `detected: [[null, 1]]` |

Se algum destes valores vier diferente, **parar**: ou o gerador está errado, ou
o comportamento do Python mudou. Investigar antes de continuar.

- [ ] **Step 4: Escrever o teste que falha do lado Python**

Criar `tests/test_parity.py`:

```python
"""The pytest half of the parity contract.

Reads tests/fixtures/parity.json and checks the Python implementation against
it. The vitest half (web/tests/converter.test.js) reads the same file. If the
two implementations ever disagree, both suites fail.
"""
import json
import math
import pathlib

import pandas as pd
import pytest

from geocoord.converter import (
    detect_swaps,
    format_dms,
    identify_region,
    in_range,
    parse_coordinate,
    point_in_mask,
    region_check,
    tidy_table,
)

FIXTURES = json.loads(
    (pathlib.Path(__file__).parent / "fixtures" / "parity.json").read_text(
        encoding="utf-8"
    )
)


def ids(cases):
    return [c["id"] for c in cases]


@pytest.mark.parametrize(
    "case", FIXTURES["parse_coordinate"], ids=ids(FIXTURES["parse_coordinate"])
)
def test_parse_coordinate(case):
    got = parse_coordinate(case["input"])
    if case["expected"] is None:
        assert got is None
    else:
        assert got is not None
        assert math.isclose(got, case["expected"], rel_tol=0, abs_tol=1e-12)


@pytest.mark.parametrize("case", FIXTURES["in_range"], ids=ids(FIXTURES["in_range"]))
def test_in_range(case):
    assert in_range(case["value"], case["axis"]) is case["expected"]


@pytest.mark.parametrize(
    "case", FIXTURES["format_dms"], ids=ids(FIXTURES["format_dms"])
)
def test_format_dms(case):
    assert format_dms(case["value"], case["axis"]) == case["expected"]


@pytest.mark.parametrize(
    "case", FIXTURES["point_in_mask"], ids=ids(FIXTURES["point_in_mask"])
)
def test_point_in_mask(case):
    mask = [tuple(b) for b in case["mask"]]
    assert point_in_mask(case["lat"], case["lon"], mask) is case["expected"]


@pytest.mark.parametrize(
    "case", FIXTURES["identify_region"], ids=ids(FIXTURES["identify_region"])
)
def test_identify_region(case):
    regions = {k: [tuple(b) for b in v] for k, v in case["regions"].items()}
    assert identify_region(case["lat"], case["lon"], regions) == case["expected"]


@pytest.mark.parametrize(
    "case", FIXTURES["detect_swaps"], ids=ids(FIXTURES["detect_swaps"])
)
def test_detect_swaps(case):
    kwargs = dict(case["kwargs"])
    if "mask" in kwargs:
        kwargs["mask"] = [tuple(b) for b in kwargs["mask"]]
    if "reference" in kwargs:
        kwargs["reference"] = tuple(kwargs["reference"])
    labels, center = detect_swaps(case["lats"], case["lons"], **kwargs)
    assert labels == case["expected"]["labels"]
    if case["expected"]["center"] is None:
        assert center is None
    else:
        assert center is not None
        assert math.isclose(center[0], case["expected"]["center"][0], abs_tol=1e-12)
        assert math.isclose(center[1], case["expected"]["center"][1], abs_tol=1e-12)


@pytest.mark.parametrize(
    "case", FIXTURES["region_check"], ids=ids(FIXTURES["region_check"])
)
def test_region_check(case):
    kwargs = dict(case["kwargs"])
    if "mask" in kwargs:
        kwargs["mask"] = [tuple(b) for b in kwargs["mask"]]
    if "reference" in kwargs:
        kwargs["reference"] = tuple(kwargs["reference"])
    regions = {k: [tuple(b) for b in v] for k, v in case["regions"].items()}
    out_idx, detected = region_check(
        case["lats"], case["lons"], case["labels"], regions, **kwargs
    )
    assert out_idx == case["expected"]["out_idx"]
    assert [[k, v] for k, v in detected.items()] == case["expected"]["detected"]


@pytest.mark.parametrize(
    "case", FIXTURES["tidy_table"], ids=ids(FIXTURES["tidy_table"])
)
def test_tidy_table(case):
    df = pd.DataFrame(case["table"]["rows"], columns=case["table"]["columns"])
    tidy = tidy_table(df)
    assert [str(c) for c in tidy.columns] == case["expected"]["columns"]
    rows = [
        [None if v is None or (isinstance(v, float) and v != v) else v for v in row]
        for row in tidy.astype(object).where(tidy.notna(), None).values.tolist()
    ]
    assert rows == case["expected"]["rows"]
```

- [ ] **Step 5: Correr os testes Python**

Run: `python -m pytest tests/test_parity.py -q`
Expected: PASS — 79 testes (31 + 9 + 11 + 3 + 3 + 9 + 6 + 7).

Se algum falhar, o gerador e o verificador discordam sobre a forma dos dados
(por exemplo listas onde a implementação espera tuplos). Corrigir o verificador,
nunca o `parity.json` à mão.

- [ ] **Step 6: Confirmar que a suite completa continua verde**

Run: `python -m pytest -q`
Expected: PASS — 153 testes (74 recolhidos antes desta tarefa, mais 79 de
paridade). Nota: 70 é a contagem recolhida pelo pytest, não o número de
funções de teste (42 + 9), porque as parametrizações contam uma vez cada.

- [ ] **Step 7: Commit**

```bash
git add scripts/gen_parity_fixtures.py tests/fixtures/parity.json tests/test_parity.py
git commit -m "test: add the shared parity contract and its pytest half"
```

---

## Task 3: Carregador de fixtures do lado JavaScript

**Files:**

- Create: `web/tests/fixtures.js`

- [ ] **Step 1: Escrever o carregador**

Criar `web/tests/fixtures.js`:

```js
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The contract lives outside web/ on purpose: it is shared with pytest.
const path = fileURLToPath(new URL('../../tests/fixtures/parity.json', import.meta.url))

export const fixtures = JSON.parse(readFileSync(path, 'utf8'))

/** Build a vitest table from one fixture section, keeping the case id as label. */
export function cases(section) {
  return fixtures[section].map((c) => [c.id, c])
}
```

- [ ] **Step 2: Escrever o teste que falha**

Substituir o conteúdo de `web/tests/converter.test.js` por:

```js
import { describe, it, expect } from 'vitest'
import { fixtures, cases } from './fixtures.js'

describe('parity fixtures', () => {
  it('loads the shared contract', () => {
    expect(fixtures.parse_coordinate.length).toBe(31)
    expect(cases('parse_coordinate')[0][0]).toBe('decimal_positive')
  })
})
```

- [ ] **Step 3: Correr para confirmar que passa**

Run: `cd web && npm test`
Expected: PASS — 1 teste. (Este passa à primeira: o ficheiro de fixtures já
existe da tarefa anterior. O que se está a verificar é que o caminho relativo
para fora de `web/` resolve.)

- [ ] **Step 4: Commit**

```bash
git add web/tests/fixtures.js web/tests/converter.test.js
git commit -m "test(web): load the shared parity contract from vitest"
```

---

## Task 4: `parseCoordinate`

A tradução é deliberadamente fiel, incluindo um detalhe que parece um descuido e
não é: o Python **não** trata números à parte, converte tudo a texto com `str()`
e volta a extrair os números. O JavaScript faz o mesmo com `String()`, porque as
duas linguagens produzem a mesma representação curta que faz *round-trip*. Uma
otimização que devolvesse o número diretamente divergiria em casos como
`1e-7`, que o Python lê como `1 + 7/60`.

**Files:**

- Modify: `web/src/core/converter.js`
- Modify: `web/tests/converter.test.js`

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `web/tests/converter.test.js`:

```js
import { parseCoordinate } from '../src/core/converter.js'

describe('parseCoordinate', () => {
  it.each(cases('parse_coordinate'))('%s', (_id, c) => {
    const got = parseCoordinate(c.input)
    if (c.expected === null) {
      expect(got).toBeNull()
    } else {
      expect(got).not.toBeNull()
      expect(Math.abs(got - c.expected)).toBeLessThan(1e-12)
    }
  })

  // Not in the shared contract: these values cannot travel through JSON.
  it('treats NaN and undefined as empty', () => {
    expect(parseCoordinate(NaN)).toBeNull()
    expect(parseCoordinate(undefined)).toBeNull()
  })
})
```

- [ ] **Step 2: Correr para confirmar que falha**

Run: `cd web && npm test`
Expected: FAIL — vários casos, entre eles `dms_north` (recebe `NaN`, esperava
`38.708333333333336`) e `text` (recebe `NaN`, esperava `null`).

- [ ] **Step 3: Escrever a implementação**

Substituir a função `parseCoordinate` em `web/src/core/converter.js` e
acrescentar as constantes acima dela:

```js
// Hemispheres that make the value negative (South, West/Oeste).
// Portuguese: O = Oeste (West), L = Leste (East); English: W, E.
const NEGATIVE_DIRS = new Set(['S', 'W', 'O'])

// A single, isolated hemisphere letter (avoids matching letters in larger words).
const DIRECTION_RE = /\b([NSEWOL])\b/i
// Numbers (integer or decimal, dot or comma), always unsigned.
const NUMBER_RE = /\d+(?:[.,]\d+)?/g
// An explicit minus sign before the first digit.
const LEADING_MINUS_RE = /^\s*-\s*\d/

// Valid geographic bounds.
export const LAT_RANGE = [-90.0, 90.0]
export const LON_RANGE = [-180.0, 180.0]

/**
 * Convert a value (DMS/DM/decimal) into decimal degrees.
 *
 * Returns null when the value is empty or cannot be interpreted. The sign comes
 * from the hemisphere (N/S/E/W/O/L) when present, otherwise from an explicit
 * leading minus sign.
 *
 * Mirrors parse_coordinate() in geocoord/converter.py. Numbers are stringified
 * rather than short-circuited, exactly as the Python does, so that both sides
 * agree even on odd inputs such as 1e-7.
 */
export function parseCoordinate(value) {
  if (value === null || value === undefined) return null

  const txt = String(value).trim()
  if (txt === '' || txt === '-' || txt === '—') return null

  // 1) Hemisphere (prefix or suffix), if any.
  const dirMatch = DIRECTION_RE.exec(txt)
  const direction = dirMatch ? dirMatch[1].toUpperCase() : null

  // 2) Explicit minus sign before the first digit.
  const hasMinus = LEADING_MINUS_RE.test(txt)

  // 3) Numeric components (magnitude, always positive).
  const nums = [...txt.matchAll(NUMBER_RE)].map((m) => parseFloat(m[0].replace(',', '.')))
  if (nums.length === 0) return null

  let magnitude
  if (nums.length === 1) {
    magnitude = nums[0]
  } else if (nums.length === 2) {
    magnitude = nums[0] + nums[1] / 60.0
  } else {
    // >= 3: degrees, minutes, seconds (extras ignored)
    magnitude = nums[0] + nums[1] / 60.0 + nums[2] / 3600.0
  }

  // 4) Sign: the hemisphere takes priority; otherwise the explicit minus.
  const negative = direction !== null ? NEGATIVE_DIRS.has(direction) : hasMinus

  return negative ? -magnitude : magnitude
}
```

- [ ] **Step 4: Correr para confirmar que passa**

Run: `cd web && npm test`
Expected: PASS — 33 testes (1 do carregador + 31 do contrato + 1 de NaN).

- [ ] **Step 5: Commit**

```bash
git add web/src/core/converter.js web/tests/converter.test.js
git commit -m "feat(web): port parseCoordinate from the Python engine"
```

---

## Task 5: `inRange` e `formatDms`

O `formatDms` do Python termina com `f"{seconds:g}"`, que corta zeros à direita
e nunca escreve `.0`. O equivalente exato em JavaScript é `String(Number(x))`
para os valores em causa, porque ambos usam a representação curta que faz
*round-trip*. O `%g` do Python muda para notação exponencial abaixo de `1e-4`,
mas os segundos são arredondados a 3 casas antes de serem impressos, portanto
ou são zero ou são maiores que `1e-3`, e o caso não se levanta.

**Files:**

- Modify: `web/src/core/converter.js`
- Modify: `web/tests/converter.test.js`

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar a `web/tests/converter.test.js`:

```js
import { inRange, formatDms } from '../src/core/converter.js'

describe('inRange', () => {
  it.each(cases('in_range'))('%s', (_id, c) => {
    expect(inRange(c.value, c.axis)).toBe(c.expected)
  })
})

describe('formatDms', () => {
  it.each(cases('format_dms'))('%s', (_id, c) => {
    expect(formatDms(c.value, c.axis)).toBe(c.expected)
  })

  it('round-trips through parseCoordinate', () => {
    const text = formatDms(-9.136667, 'lon')
    expect(Math.abs(parseCoordinate(text) - -9.136667)).toBeLessThan(1e-4)
  })
})
```

- [ ] **Step 2: Correr para confirmar que falha**

Run: `cd web && npm test`
Expected: FAIL — `inRange is not a function`.

- [ ] **Step 3: Escrever a implementação**

Acrescentar a `web/src/core/converter.js`, a seguir a `parseCoordinate`:

```js
/**
 * Whether the value falls within the valid bounds of the axis ('lat' or 'lon').
 * Mirrors in_range() in geocoord/converter.py.
 */
export function inRange(value, axis) {
  if (value === null || value === undefined) return false
  const v = Number(value)
  if (!Number.isFinite(v)) return false
  const [low, high] = axis === 'lat' ? LAT_RANGE : LON_RANGE
  return low <= v && v <= high
}

/**
 * Format seconds the way Python's "%g" does: shortest round-tripping form, no
 * trailing ".0". Seconds are rounded to at most `seconds_decimals` first, so the
 * exponential threshold of %g is never reached.
 */
function formatG(value) {
  return String(Number(value))
}

/**
 * Format a decimal-degrees value back into a DMS string.
 * Example: formatDms(-9.136667, 'lon') -> "9° 8' 12.001\" W".
 * Mirrors format_dms() in geocoord/converter.py.
 */
export function formatDms(value, axis, secondsDecimals = 3) {
  if (value === null || value === undefined) return null
  const num = Number(value)
  if (!Number.isFinite(num)) return null

  const [positive, negative] = axis === 'lat' ? ['N', 'S'] : ['E', 'W']
  const hemisphere = num >= 0 ? positive : negative

  const v = Math.abs(num)
  let degrees = Math.trunc(v)
  const remMinutes = (v - degrees) * 60.0
  let minutes = Math.trunc(remMinutes)
  const factor = 10 ** secondsDecimals
  let seconds = Math.round((remMinutes - minutes) * 60.0 * factor) / factor

  // Handle rounding roll-over (e.g. 59.9996 -> 60).
  if (seconds >= 60.0) {
    seconds -= 60.0
    minutes += 1
  }
  if (minutes >= 60) {
    minutes -= 60
    degrees += 1
  }

  return `${degrees}° ${minutes}' ${formatG(seconds)}" ${hemisphere}`
}
```

- [ ] **Step 4: Correr para confirmar que passa**

Run: `cd web && npm test`
Expected: PASS — 54 testes.

Se `format_dms` falhar num caso por uma unidade na última casa, a causa é a
diferença entre o `round()` do Python (arredonda o par para o mais próximo) e o
`Math.round` do JavaScript (arredonda `.5` sempre para cima). Nesse caso
substituir o cálculo dos segundos por arredondamento bancário:

```js
function roundHalfEven(x, decimals) {
  const factor = 10 ** decimals
  const scaled = x * factor
  const floor = Math.floor(scaled)
  const diff = scaled - floor
  let rounded
  if (diff > 0.5) rounded = floor + 1
  else if (diff < 0.5) rounded = floor
  else rounded = floor % 2 === 0 ? floor : floor + 1
  return rounded / factor
}
```

- [ ] **Step 5: Commit**

```bash
git add web/src/core/converter.js web/tests/converter.test.js
git commit -m "feat(web): port inRange and formatDms from the Python engine"
```

---

## Task 6: Auxiliares numéricos e de máscara

**Files:**

- Modify: `web/src/core/converter.js`
- Modify: `web/tests/converter.test.js`

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar a `web/tests/converter.test.js`:

```js
import { pointInMask, identifyRegion } from '../src/core/converter.js'

describe('pointInMask', () => {
  it.each(cases('point_in_mask'))('%s', (_id, c) => {
    expect(pointInMask(c.lat, c.lon, c.mask)).toBe(c.expected)
  })
})

describe('identifyRegion', () => {
  it.each(cases('identify_region'))('%s', (_id, c) => {
    expect(identifyRegion(c.lat, c.lon, c.regions)).toBe(c.expected)
  })
})
```

- [ ] **Step 2: Correr para confirmar que falha**

Run: `cd web && npm test`
Expected: FAIL — `pointInMask is not a function`.

- [ ] **Step 3: Escrever a implementação**

Acrescentar a `web/src/core/converter.js`:

```js
/**
 * Coerce a value to a finite-or-infinite number, or null when it is not a
 * number at all. Mirrors _is_number() in geocoord/converter.py, including its
 * quirk of accepting infinities (which _valid_pair then rejects). Empty strings
 * are rejected here because Number('') is 0 in JavaScript but float('') raises
 * in Python.
 */
function toNumber(x) {
  if (x === null || x === undefined) return null
  let v
  if (typeof x === 'number') {
    v = x
  } else if (typeof x === 'boolean') {
    v = Number(x)
  } else {
    const s = String(x).trim()
    if (s === '') return null
    v = Number(s)
  }
  return Number.isNaN(v) ? null : v
}

function validPair(lat, lon) {
  return (
    LAT_RANGE[0] <= lat && lat <= LAT_RANGE[1]
    && LON_RANGE[0] <= lon && lon <= LON_RANGE[1]
  )
}

/** True if (lat, lon) falls inside any bbox [latMin, latMax, lonMin, lonMax]. */
function inMask(lat, lon, mask) {
  for (const [la0, la1, lo0, lo1] of mask) {
    if (la0 <= lat && lat <= la1 && lo0 <= lon && lon <= lo1) return true
  }
  return false
}

/** True if (lat, lon) falls inside any bbox of `mask`. */
export function pointInMask(lat, lon, mask) {
  return inMask(Number(lat), Number(lon), mask)
}

/**
 * Name of the first region containing (lat, lon), or null.
 * `regions` is a plain object mapping name -> mask; JavaScript preserves the
 * insertion order of string keys, matching Python's dict order.
 */
export function identifyRegion(lat, lon, regions) {
  for (const [name, mask] of Object.entries(regions)) {
    if (inMask(Number(lat), Number(lon), mask)) return name
  }
  return null
}
```

- [ ] **Step 4: Correr para confirmar que passa**

Run: `cd web && npm test`
Expected: PASS — 60 testes.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/converter.js web/tests/converter.test.js
git commit -m "feat(web): port the numeric and mask helpers"
```

---

## Task 7: `detectSwaps` — camadas de intervalo, máscara e referência

Três das quatro camadas. A quarta, o aglomerado automático, precisa dos
equivalentes exatos da mediana e do percentil do numpy e fica para a tarefa
seguinte. Nesta tarefa, quando não há máscara nem referência, a função devolve
já os rótulos de intervalo e `null` como centro — o que também é o comportamento
certo quando há menos pontos válidos do que `minCluster`.

**Files:**

- Modify: `web/src/core/converter.js`
- Modify: `web/tests/converter.test.js`

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `web/tests/converter.test.js`:

```js
import { detectSwaps } from '../src/core/converter.js'

// These need denseCenter, which arrives in the next task. Note that
// single_cluster_all_ok belongs here too: it has exactly six valid points, and
// the Python guard is `len(inrange_idx) < min_cluster`, so six does NOT skip
// the cluster step. Its expected centre is [39.025, -8.025], not null.
const CLUSTER_CASES = new Set([
  'single_cluster_all_ok',
  'cluster_majority',
  'two_legit_clusters_no_false_positive',
])

describe('detectSwaps (range, mask and reference layers)', () => {
  it.each(cases('detect_swaps').filter(([id]) => !CLUSTER_CASES.has(id)))(
    '%s',
    (_id, c) => {
      const { labels, center } = detectSwaps(c.lats, c.lons, c.kwargs)
      expect(labels).toEqual(c.expected.labels)
      if (c.expected.center === null) {
        expect(center).toBeNull()
      } else {
        expect(center[0]).toBeCloseTo(c.expected.center[0], 12)
        expect(center[1]).toBeCloseTo(c.expected.center[1], 12)
      }
    },
  )
})
```

Nota sobre a assinatura: o Python recebe `mask`, `reference`, `region_radius` e
`min_cluster` como argumentos nomeados. Em JavaScript entram num objeto de
opções, e as chaves do `parity.json` vêm em `snake_case` porque foram escritas
pelo gerador Python. A implementação aceita as duas grafias para que o objeto
`c.kwargs` do contrato possa ser passado diretamente.

- [ ] **Step 2: Correr para confirmar que falha**

Run: `cd web && npm test`
Expected: FAIL — `detectSwaps is not a function`.

- [ ] **Step 3: Escrever a implementação**

Acrescentar a `web/src/core/converter.js`:

```js
/**
 * Classify each row as ok / missing / out_of_range / swap_range / swap_cluster.
 *
 * Mirrors detect_swaps() in geocoord/converter.py. Options accept both the
 * snake_case names used by the Python signature (and therefore by
 * tests/fixtures/parity.json) and their camelCase equivalents.
 *
 * Returns { labels, center }, where center is the (lat, lon) used as the
 * expected location, or null for mask mode and when no cluster step ran.
 */
export function detectSwaps(lats, lons, options = {}) {
  const minCluster = options.min_cluster ?? options.minCluster ?? 6
  const reference = options.reference ?? null
  const regionRadius = options.region_radius ?? options.regionRadius ?? 10.0
  const mask = options.mask ?? null

  const n = lats.length
  const labels = new Array(n).fill('missing')
  const inrangeIdx = []

  for (let i = 0; i < n; i += 1) {
    const la = toNumber(lats[i])
    const lo = toNumber(lons[i])
    if (la === null || lo === null) {
      labels[i] = 'missing'
    } else if (validPair(la, lo)) {
      labels[i] = 'ok'
      inrangeIdx.push(i)
    } else if (validPair(lo, la)) {
      labels[i] = 'swap_range'
    } else {
      labels[i] = 'out_of_range'
    }
  }

  if (mask && mask.length) {
    for (const i of inrangeIdx) {
      const la = Number(lats[i])
      const lo = Number(lons[i])
      if (!inMask(la, lo, mask) && inMask(lo, la, mask)) {
        labels[i] = 'swap_cluster'
      }
    }
    return { labels, center: null }
  }

  if (reference !== null) {
    const center = [Number(reference[0]), Number(reference[1])]
    const tol = Number(regionRadius)
    for (const i of inrangeIdx) {
      const la = Number(lats[i])
      const lo = Number(lons[i])
      const dAs = Math.hypot(la - center[0], lo - center[1])
      const dSw = Math.hypot(lo - center[0], la - center[1])
      if (dAs > tol && dSw <= tol) labels[i] = 'swap_cluster'
    }
    return { labels, center }
  }

  if (inrangeIdx.length < minCluster) return { labels, center: null }

  // The auto-cluster layer lands in the next task.
  return { labels, center: null }
}
```

- [ ] **Step 4: Correr para confirmar que passa**

Run: `cd web && npm test`
Expected: PASS — 66 testes (os 6 casos de `detect_swaps` que não dependem do
aglomerado).

- [ ] **Step 5: Commit**

```bash
git add web/src/core/converter.js web/tests/converter.test.js
git commit -m "feat(web): port detectSwaps range, mask and reference layers"
```

---

## Task 8: `denseCenter` e a camada de aglomerado automático

Esta é a tradução mais delicada do plano. O Python usa `np.median` e
`np.percentile`, e o `Counter.most_common`. Os três têm comportamentos
específicos que é preciso replicar:

- `np.percentile` com o método por omissão interpola linearmente. Verificado:
  `np.percentile([1,2,3,4], 90)` dá `3.7`, não `4`.
- `np.median` é o percentil 50 com a mesma interpolação, logo para um número par
  de elementos é a média dos dois centrais. Verificado:
  `np.median([[1,2],[3,4]], axis=0)` dá `[2, 3]`.
- `Counter.most_common(1)` desempata pela ordem de inserção: em caso de empate
  ganha a chave vista primeiro. Um ciclo com comparação estritamente maior
  reproduz isso.

**Files:**

- Modify: `web/src/core/converter.js`
- Modify: `web/tests/converter.test.js`

- [ ] **Step 1: Escrever o teste que falha**

Em `web/tests/converter.test.js`, substituir o bloco `describe('detectSwaps
(range, mask and reference layers)')` por:

```js
describe('detectSwaps', () => {
  it.each(cases('detect_swaps'))('%s', (_id, c) => {
    const { labels, center } = detectSwaps(c.lats, c.lons, c.kwargs)
    expect(labels).toEqual(c.expected.labels)
    if (c.expected.center === null) {
      expect(center).toBeNull()
    } else {
      expect(center[0]).toBeCloseTo(c.expected.center[0], 12)
      expect(center[1]).toBeCloseTo(c.expected.center[1], 12)
    }
  })
})
```

E acrescentar os testes das primitivas numéricas, que existem para apanhar o
erro no sítio certo quando um caso de aglomerado falhar:

```js
import { percentileLinear, median } from '../src/core/converter.js'

describe('numpy-compatible statistics', () => {
  it('interpolates percentiles the way numpy does', () => {
    expect(percentileLinear([1, 2, 3, 4], 90)).toBeCloseTo(3.7, 12)
    expect(percentileLinear([5], 90)).toBe(5)
  })

  it('averages the two middle values for an even count', () => {
    expect(median([1, 3])).toBeCloseTo(2, 12)
    expect(median([2, 4])).toBeCloseTo(3, 12)
    expect(median([1, 2, 3])).toBe(2)
  })
})
```

Remover também a constante `CLUSTER_CASES`, que deixa de ser usada.

- [ ] **Step 2: Correr para confirmar que falha**

Run: `cd web && npm test`
Expected: FAIL — `percentileLinear is not a function`, e os três casos de
aglomerado com `center` a `null` quando se esperava `[39.025, -8.025]`,
`[39.05, -8.05]` e `[39.025, -8.025]`.

- [ ] **Step 3: Escrever as primitivas e o `denseCenter`**

Acrescentar a `web/src/core/converter.js`, antes de `detectSwaps`:

```js
/**
 * numpy.percentile with the default linear interpolation.
 * `sorted` must already be sorted ascending.
 */
export function percentileLinear(values, q) {
  const s = [...values].sort((a, b) => a - b)
  const n = s.length
  if (n === 1) return s[0]
  const idx = ((n - 1) * q) / 100
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return s[lo]
  return s[lo] + (s[hi] - s[lo]) * (idx - lo)
}

/** numpy.median: the 50th percentile with linear interpolation. */
export function median(values) {
  return percentileLinear(values, 50)
}

/** numpy.ptp: peak to peak, max minus min. */
function ptp(values) {
  let min = Infinity
  let max = -Infinity
  for (const v of values) {
    if (v < min) min = v
    if (v > max) max = v
  }
  return max - min
}

/**
 * Find the centre and radius of the densest cluster of [lat, lon] points.
 * Mirrors _dense_center() in geocoord/converter.py.
 */
function denseCenter(points) {
  const span = Math.max(ptp(points.map((p) => p[0])), ptp(points.map((p) => p[1])))
  const cell = Math.max(0.5, span / 20.0)

  const keys = points.map((p) => [Math.floor(p[0] / cell), Math.floor(p[1] / cell)])

  // Counter.most_common(1): on a tie the first-seen key wins, which a strict
  // greater-than comparison over an insertion-ordered Map reproduces.
  const counts = new Map()
  for (const [kx, ky] of keys) {
    const key = `${kx},${ky}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let bestKey = null
  let bestCount = -1
  for (const [key, count] of counts) {
    if (count > bestCount) {
      bestCount = count
      bestKey = key
    }
  }
  const [bx, by] = bestKey.split(',').map(Number)

  const members = points.filter(
    (_, i) => Math.abs(keys[i][0] - bx) <= 1 && Math.abs(keys[i][1] - by) <= 1,
  )

  const center = [
    median(members.map((m) => m[0])),
    median(members.map((m) => m[1])),
  ]
  const dist = members.map((m) => Math.hypot(m[0] - center[0], m[1] - center[1]))
  const radius = Math.max(1.0, percentileLinear(dist, 90))

  return { center, radius }
}
```

- [ ] **Step 4: Ligar a camada de aglomerado ao `detectSwaps`**

Em `web/src/core/converter.js`, substituir o final da função `detectSwaps`:

```js
  if (inrangeIdx.length < minCluster) return { labels, center: null }

  // The auto-cluster layer lands in the next task.
  return { labels, center: null }
}
```

por:

```js
  if (inrangeIdx.length < minCluster) return { labels, center: null }

  const asIs = inrangeIdx.map((i) => [Number(lats[i]), Number(lons[i])])
  const { center, radius } = denseCenter(asIs)
  const outlierFactor = 3.0
  const returnFactor = 1.5
  for (const i of inrangeIdx) {
    const la = Number(lats[i])
    const lo = Number(lons[i])
    const dAs = Math.hypot(la - center[0], lo - center[1])
    const dSw = Math.hypot(lo - center[0], la - center[1])
    if (dAs > outlierFactor * radius && dSw <= returnFactor * radius) {
      labels[i] = 'swap_cluster'
    }
  }

  return { labels, center: [center[0], center[1]] }
}
```

- [ ] **Step 5: Correr para confirmar que passa**

Run: `cd web && npm test`
Expected: PASS — 71 testes. Os nove casos de `detect_swaps` passam, incluindo
`cluster_majority` com centro `[39.05, -8.05]`, `single_cluster_all_ok` com
centro `[39.025, -8.025]`, e `two_legit_clusters_no_false_positive` sem nenhum
`swap_cluster`.

- [ ] **Step 6: Commit**

```bash
git add web/src/core/converter.js web/tests/converter.test.js
git commit -m "feat(web): port denseCenter and the auto-cluster swap layer"
```

---

## Task 9: `regionCheck`

O `detected` do Python é um dicionário que pode ter `None` como chave, e o JSON
não admite chaves nulas. No contrato viaja como lista ordenada de pares. Do lado
JavaScript a função devolve um `Map`, que aceita `null` como chave e preserva a
ordem de inserção, e o teste converte-o para a mesma lista de pares.

**Files:**

- Modify: `web/src/core/converter.js`
- Modify: `web/tests/converter.test.js`

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `web/tests/converter.test.js`:

```js
import { regionCheck } from '../src/core/converter.js'

describe('regionCheck', () => {
  it.each(cases('region_check'))('%s', (_id, c) => {
    const { outIdx, detected } = regionCheck(
      c.lats, c.lons, c.labels, c.regions, c.kwargs,
    )
    expect(outIdx).toEqual(c.expected.out_idx)
    expect([...detected.entries()]).toEqual(c.expected.detected)
  })
})
```

- [ ] **Step 2: Correr para confirmar que falha**

Run: `cd web && npm test`
Expected: FAIL — `regionCheck is not a function`.

- [ ] **Step 3: Escrever a implementação**

Acrescentar a `web/src/core/converter.js`:

```js
/**
 * Find valid ('ok') points that fall outside the region the user declared.
 *
 * Mirrors region_check() in geocoord/converter.py. Returns { outIdx, detected },
 * where detected is a Map from the actual region name (or null when the point
 * matches no known region) to a count. A Map is used rather than a plain object
 * because null is a legitimate key here.
 */
export function regionCheck(lats, lons, labels, regions, options = {}) {
  const mask = options.mask ?? null
  const reference = options.reference ?? null
  const regionRadius = options.region_radius ?? options.regionRadius ?? 10.0

  const outIdx = []
  const detected = new Map()
  if (mask === null && reference === null) return { outIdx, detected }

  for (let i = 0; i < labels.length; i += 1) {
    if (labels[i] !== 'ok') continue
    const la = Number(lats[i])
    const lo = Number(lons[i])
    const inside = mask !== null
      ? inMask(la, lo, mask)
      : Math.hypot(la - reference[0], lo - reference[1]) <= regionRadius
    if (!inside) {
      outIdx.push(i)
      const name = regions ? identifyRegion(la, lo, regions) : null
      detected.set(name, (detected.get(name) ?? 0) + 1)
    }
  }
  return { outIdx, detected }
}
```

- [ ] **Step 4: Correr para confirmar que passa**

Run: `cd web && npm test`
Expected: PASS — 77 testes.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/converter.js web/tests/converter.test.js
git commit -m "feat(web): port regionCheck from the Python engine"
```

---

## Task 10: `tidyTable`

O `tidy_table` do Python opera sobre um `DataFrame`. Do lado JavaScript não há
`DataFrame`, e inventar um seria o pior dos dois mundos. A função opera sobre a
forma neutra que o contrato já usa: `{ columns: string[], rows: unknown[][] }`.

A ordem das operações é a mesma do original e importa: primeiro as células de
texto em branco passam a nulas, depois caem as colunas totalmente vazias, depois
as linhas totalmente vazias, e só então se decide se o cabeçalho tem de ser
promovido.

**Files:**

- Modify: `web/src/core/converter.js`
- Modify: `web/tests/converter.test.js`

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `web/tests/converter.test.js`:

```js
import { tidyTable } from '../src/core/converter.js'

describe('tidyTable', () => {
  it.each(cases('tidy_table'))('%s', (_id, c) => {
    expect(tidyTable(c.table)).toEqual(c.expected)
  })

  it('does not mutate its input', () => {
    const table = { columns: ['lat', 'lon'], rows: [['39.0', '-8.0']] }
    const before = JSON.stringify(table)
    tidyTable(table)
    expect(JSON.stringify(table)).toBe(before)
  })
})
```

- [ ] **Step 2: Correr para confirmar que falha**

Run: `cd web && npm test`
Expected: FAIL — `tidyTable is not a function`.

- [ ] **Step 3: Escrever a implementação**

Acrescentar a `web/src/core/converter.js`:

```js
// Auto-generated column name pandas assigns to a header cell it found empty.
const PLACEHOLDER_COL_RE = /^Unnamed: \d+$/

/** True for an empty or pandas auto-generated ('Unnamed: N') column name. */
function isPlaceholderName(name) {
  const s = String(name ?? '').trim()
  return s === '' || s.toLowerCase() === 'nan' || PLACEHOLDER_COL_RE.test(s)
}

/** Blank / whitespace-only cells count as missing, as they do in tidy_table(). */
function isBlank(value) {
  if (value === null || value === undefined) return true
  if (typeof value === 'number') return Number.isNaN(value)
  const s = String(value).trim()
  return s === '' || s === 'nan' || s === 'None'
}

/**
 * Clean a freshly-read table so messy spreadsheet exports load correctly.
 *
 * Mirrors tidy_table() in geocoord/converter.py, operating on the neutral shape
 * { columns, rows } instead of a pandas DataFrame. Returns a new table; the
 * input is left untouched.
 *
 * Decimal commas inside the data ("33,6603") are left as-is; parseCoordinate
 * already understands them.
 */
export function tidyTable(table) {
  let columns = [...table.columns]
  let rows = table.rows.map((row) => row.map((v) => (isBlank(v) ? null : v)))

  // Drop columns that are entirely empty.
  const keep = columns.map((_, c) => rows.some((row) => row[c] !== null))
  columns = columns.filter((_, c) => keep[c])
  rows = rows.map((row) => row.filter((_, c) => keep[c]))

  // Drop rows that are entirely empty.
  rows = rows.filter((row) => row.some((v) => v !== null))

  if (rows.length === 0) return { columns, rows }

  // If no column carries a real name, the header is the first row of data.
  if (columns.every((c) => isPlaceholderName(c))) {
    const header = rows[0]
    rows = rows.slice(1)
    columns = header.map((h) => String(h ?? '').trim())

    // A header cell may itself be blank: drop those columns too.
    const keep2 = columns.map((c, i) => c !== '' && rows.some((row) => row[i] !== null))
    columns = columns.filter((_, i) => keep2[i])
    rows = rows.map((row) => row.filter((_, i) => keep2[i]))
  }

  return { columns, rows }
}
```

- [ ] **Step 4: Correr para confirmar que passa**

Run: `cd web && npm test`
Expected: PASS — 85 testes.

Se `messy_export_recovers_header` falhar por a coluna vazia da esquerda ainda lá
estar, a causa é a ordem: a queda das colunas vazias tem de acontecer **antes**
da promoção do cabeçalho, tal como no Python.

- [ ] **Step 5: Commit**

```bash
git add web/src/core/converter.js web/tests/converter.test.js
git commit -m "feat(web): port tidyTable onto a neutral table shape"
```

---

## Task 11: Job de CI para o lado JavaScript

O job Python fica exatamente como está. O novo job corre o vitest, que lê o
`parity.json` do repositório — é isto que faz com que uma divergência entre as
duas implementações rebente nos dois lados.

**Files:**

- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Acrescentar o job**

Acrescentar ao fim de `.github/workflows/ci.yml`, ao mesmo nível de indentação
do job `test` existente:

```yaml
  web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: web/package-lock.json
      - name: Install dependencies
        run: npm ci
        working-directory: web
      - name: Run tests
        run: npm test
        working-directory: web
```

- [ ] **Step 2: Verificar a sintaxe do ficheiro**

Run:

```bash
python -c "import yaml; print(sorted(yaml.safe_load(open('.github/workflows/ci.yml'))['jobs']))"
```

Expected: `['test', 'web']`

Se o `yaml` não estiver instalado: `python -m pip install pyyaml`.

- [ ] **Step 3: Dar ao gerador um modo `--check` e pô-lo no CI**

O congelamento do `parity.json` está garantido só por prosa. Um modo que
regenera em memória e compara permite ao CI apanhar um ficheiro editado à mão ou
um gerador cujas entradas divergiram do que está commitado. Não colide com o
desenho "corre-se de propósito, não a cada teste": verifica, não escreve.

Em `scripts/gen_parity_fixtures.py`, substituir o bloco `__main__` por:

```python
if __name__ == "__main__":
    payload = json.dumps(build(), ensure_ascii=False, indent=2, allow_nan=False) + "\n"

    if "--check" in sys.argv:
        current = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if current != payload:
            print(
                f"{OUT} is out of date with the generator. Either it was edited "
                "by hand, or the inputs changed without regenerating. Run "
                "`python scripts/gen_parity_fixtures.py` and review the diff.",
                file=sys.stderr,
            )
            raise SystemExit(1)
        print(f"{OUT} is up to date")
        raise SystemExit(0)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(payload, encoding="utf-8")
    print(f"wrote {OUT}")
```

Depois acrescentar um passo ao job `test` do `.github/workflows/ci.yml`, antes
de correr os testes:

```yaml
      - name: Check the parity contract is in sync with its generator
        run: python scripts/gen_parity_fixtures.py --check
```

Verificar localmente que passa e que deteta uma alteração:

```bash
python scripts/gen_parity_fixtures.py --check
printf '\n' >> tests/fixtures/parity.json
python scripts/gen_parity_fixtures.py --check ; echo "saida: $?"
git checkout tests/fixtures/parity.json
```

Expected: a primeira invocação diz `is up to date` e sai com 0; a segunda
imprime a mensagem de erro e sai com 1; o `git checkout` repõe o ficheiro.

Nota para Windows: o `read_text` devolve `\n` porque o Python traduz na
leitura, e o `write_text` grava `\r\n`. A comparação é feita sobre o texto
traduzido dos dois lados, logo é consistente em ambos os sistemas.

- [ ] **Step 4: Correr as duas suites localmente uma última vez**

Run: `python -m pytest -q`
Expected: PASS — 153 testes (74 antigos + 79 de paridade).

Run: `cd web && npm test`
Expected: PASS — 85 testes.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml scripts/gen_parity_fixtures.py
git commit -m "ci: run the JavaScript engine tests and guard the parity contract"
```

---

## Task 12: Documentar as duas metades no README

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Acrescentar a secção**

Inserir em `README.md`, imediatamente antes da secção `## Project structure`:

````markdown
## Web application (browser)

A JavaScript port of the conversion engine lives in `web/`, for the browser
application published on GitHub Pages. It is a deliberate translation of
`geocoord/converter.py`, not a rewrite: both implementations are checked against
the same contract in `tests/fixtures/parity.json`, so a divergence fails both
test suites.

```bash
cd web
npm install
npm test
```

Regenerate the contract only when the shared behaviour is meant to change:

```bash
python scripts/gen_parity_fixtures.py
```

Review the diff by eye before committing it — the file is the reference both
sides are held to.
````

- [ ] **Step 2: Verificar o comprimento das linhas**

Run:

```bash
python -c "print([n for n, l in enumerate(open('README.md', encoding='utf-8').read().split(chr(10)), 1) if len(l) > 80])"
```

Expected: `[]` fora de tabelas e blocos de código. O repositório impõe MD013 a
80 colunas com tabelas e blocos de código excluídos (`.markdownlint.json`).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: describe the web engine and the parity contract"
```

---

## Estado final desta fase

Ao fim das doze tarefas existe:

- `web/src/core/converter.js` com `parseCoordinate`, `inRange`, `formatDms`,
  `pointInMask`, `identifyRegion`, `detectSwaps`, `regionCheck` e `tidyTable`.
- `tests/fixtures/parity.json` com 79 casos, verificado pelos dois lados.
- Dois jobs de CI, um por linguagem, ambos a ler o mesmo contrato.
- Nada removido: `geocoord/`, `app.py`, os 70 testes originais e o build
  Electron continuam como estavam.

O que **não** existe ainda, e é deliberado: interface, Vite, React, Tailwind,
projeções, exportadores. A fase 1b traduz o `geoexport.js`, incluindo o escritor
de Shapefile e as duas correções à spec apuradas no topo deste plano.
