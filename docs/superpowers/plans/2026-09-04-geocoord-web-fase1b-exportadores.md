# GeoCoord Web — Fase 1b: exportadores e o escritor de Shapefile

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar `web/src/core/geoexport.js` — a tradução JavaScript de
`geocoord/geoexport.py` — incluindo um escritor de Shapefile que produza os
mesmos bytes que o pyshp, e alargar o contrato de paridade para o cobrir.

**Architecture:** A mesma da fase 1a. As fixtures em
`tests/fixtures/parity.json` são o contrato; o pytest verifica o lado Python e
o vitest o lado JavaScript.
Cada exportador é comparado pela via que faz sentido para o seu formato, e a
§2 explica porquê em cada caso.

**Tech Stack:** JavaScript ES modules, vitest, jszip. Python 3.11+ com pytest e
pyshp, já instalados.

**Âmbito:** apenas a fase 1b. Sem interface, sem Vite, sem GPX, sem projeções.
No fim existe o motor de exportação traduzido e verificado. A fase 2 é a
interface.

**Spec:**
[2026-09-04-geocoord-web-design.md](../specs/2026-09-04-geocoord-web-design.md)

**Depende de:** fase 1a, concluída em `9e14455`.

---

## 1. O que a investigação apurou

Tudo o que segue foi medido contra a implementação real antes de escrever este
plano. Nada aqui é suposição, e nada deve ser redescoberto durante a execução.

### 1.1 O `.shp` e o `.shx` são o padrão, sem surpresas

Cabeçalho de 100 bytes, idêntico nos dois ficheiros exceto no comprimento:

| offset | tamanho | ordem | conteúdo |
| --- | --- | --- | --- |
| 0 | 4 | big-endian | código de ficheiro, `9994` |
| 4 | 20 | — | zeros |
| 24 | 4 | big-endian | comprimento do ficheiro, em palavras de 16 bits |
| 28 | 4 | little-endian | versão, `1000` |
| 32 | 4 | little-endian | tipo de geometria, `1` = ponto |
| 36 | 64 | little-endian | oito doubles: xmin, ymin, xmax, ymax, e quatro zeros |

Registo do `.shp`, 28 bytes por ponto: número do registo (big-endian, começa em
1), comprimento do conteúdo em palavras (big-endian, `10`), tipo (little-endian,
`1`), x e y (dois doubles little-endian).

Índice do `.shx`, 8 bytes por registo: deslocamento em palavras (big-endian) e
comprimento do conteúdo em palavras (big-endian). O primeiro registo começa em
50 palavras, ou seja 100 bytes, e cada seguinte avança 14 palavras.

Verificado com dois pontos: `.shp` 156 bytes, `.shx` 116 bytes.

### 1.2 O `.dbf` do pyshp, byte a byte

Cabeçalho de 32 bytes:

| offset | tamanho | conteúdo |
| --- | --- | --- |
| 0 | 1 | versão, `0x03` |
| 1 | 3 | **data de escrita**: ano menos 1900, mês, dia |
| 4 | 4 | número de registos, little-endian |
| 8 | 2 | comprimento do cabeçalho, little-endian: `32 + 32 × campos + 1` |
| 10 | 2 | comprimento do registo, little-endian: `1 + soma dos tamanhos` |
| 12 | 20 | zeros |

Descritor de campo, 32 bytes cada: nome nos bytes 0 a 10 preenchido com zeros à
direita, tipo `C` no byte 11, zeros nos bytes 12 a 15, tamanho `254` no byte 16,
zero decimais no byte 17, zeros nos bytes 18 a 31.

Depois dos descritores, um terminador `0x0D`.

Registos: marca de eliminação `0x20`, depois cada campo alinhado à esquerda e
preenchido com espaços até ao seu tamanho. **Não há byte de fim de ficheiro**
(`0x1A` ausente).

Os valores são codificados em UTF-8 e truncados a **254 bytes**, não a 254
caracteres — `"São Tomé e Príncipe"` ocupa 22 bytes, não 19.

**Os bytes 1 a 3 tornam o ficheiro não determinista** e têm de ser mascarados em
qualquer comparação. O `zipfile.writestr` carimba ainda cada entrada do zip com
a hora local, por isso comparam-se os quatro componentes, nunca o `.zip`.

### 1.3 Os floats imprimem-se de forma diferente nas duas linguagens

Medido:

| valor | Python | JavaScript |
| --- | --- | --- |
| `-8.0` | `-8.0` | `-8` |
| `-8.5` | `-8.5` | `-8.5` |
| `1e-7` | `1e-07` | `1e-7` |

O KML escreve `<coordinates>-8.0,39.0,0</coordinates>` e o GeoJSON
`"coordinates": [-8.0, 39.0]`. Para o KML bater byte a byte, o JavaScript
precisa de um formatador ao estilo do Python: acrescentar `.0` a um valor
inteiro e preencher o expoente a dois dígitos.

Fora do domínio das coordenadas as duas linguagens divergem noutro ponto — o
Python passa a notação exponencial a partir de 1e16 e o JavaScript só a partir
de 1e21 — mas uma latitude ou longitude nunca lá chega. O formatador declara
esse limite no comentário.

### 1.4 O `escape` do KML só escapa três caracteres

`xml.sax.saxutils.escape` trata `&`, `<` e `>`. As aspas simples e duplas passam
tal e qual, verificado: `a&b <c> "d" 'e'` sai como
`a&amp;b &lt;c&gt; "d" 'e'`. Uma tradução que use um escape de XML mais zeloso
produz bytes diferentes.

### 1.5 `sanitize_filename` e a normalização NFKD

O Python normaliza em NFKD e descarta tudo o que não seja ASCII. Comportamento
medido, que o JavaScript tem de reproduzir com
`normalize('NFKD')` seguido da remoção dos caracteres não ASCII:

| entrada | saída |
| --- | --- |
| `São Tomé` | `Sao_Tome` |
| `Ångström` | `Angstrom` |
| `Straße` | `Strae` |
| `œuvre` | `uvre` |
| `Đà Nẵng` | `a_Nang` |
| `ﬁcheiro` | `ficheiro` |
| `½ ponto` | `12_ponto` |
| `Ⅻ` | `XII` |
| `北京` | `converted` |

As três últimas são as interessantes: a decomposição de compatibilidade
transforma a ligadura `ﬁ` em `fi`, a fração `½` em `12` — a barra de fração é
descartada — e o numeral romano `Ⅻ` em `XII`. Já `ß` e `œ` não decompõem e
desaparecem por inteiro.

### 1.6 `_safe_field_names` desambigua sem distinguir maiúsculas

Trunca a 10 caracteres, substitui tudo o que não seja alfanumérico ou `_` por
`_`, e usa `field` quando não sobra nada. A unicidade é verificada em
maiúsculas, e o sufixo numérico substitui o fim do nome em vez de o alongar:

| entrada | saída |
| --- | --- |
| `["a_very_long_attribute_name"]` | `["a_very_lon"]` |
| `["Latitude_DD", "Latitude_DD2", "Latitude_DD"]` | `["Latitude_D", "Latitude_1", "Latitude_2"]` |
| `["campo com espaços", "campo-com-traços", ""]` | `["campo_com_", "campo_com1", "field"]` |
| `["Latitude_DD", "latitude_dd"]` | `["Latitude_D", "latitude_1"]` |

---

## 2. Como cada exportador é comparado, e porquê

Nem todos podem ser comparados da mesma maneira, e escolher mal produz testes
que falham por motivos cosméticos ou que não falham nunca.

| Exportador | Comparação | Porquê |
| --- | --- | --- |
| `sanitize_filename` | igualdade de strings | é uma função de texto |
| `to_geojson` | **objeto desserializado** | o `json.dumps` do Python separa com `", "` e `": "` e o `JSON.stringify` não põe espaço nenhum; comparar bytes falharia sempre, e o conteúdo é o que importa |
| `to_kml` | **bytes** | é construído por concatenação de strings, portanto é reprodutível — desde que o JavaScript imprima os floats como o Python (§1.3) |
| `to_shapefile_zip` | **bytes dos quatro componentes, com os bytes 1 a 3 do DBF a zero** | é binário e não há analisador à mão; o zip e a data do DBF não são deterministas (§1.2) |

Nos atributos do KML há uma ambiguidade que não se resolve: o Python distingue o
inteiro `1` do float `1.0` e o JavaScript não. **As fixtures de KML usam apenas
texto e inteiros nos atributos**, e o gerador diz porquê.

---

## 3. Estrutura de ficheiros

| Ficheiro | Responsabilidade |
| --- | --- |
| `web/src/core/geoexport.js` | a tradução; espelha `geocoord/geoexport.py` na mesma ordem |
| `web/tests/geoexport.test.js` | verifica o lado JavaScript contra o contrato |
| `web/src/core/shapefile.js` | escritor binário `.shp`/`.shx`/`.dbf` |
| `scripts/gen_parity_fixtures.py` | ganha as secções dos exportadores |
| `tests/test_parity.py` | ganha os testes correspondentes |
| `web/package.json` | ganha o `jszip` |

O escritor binário vive num ficheiro próprio porque não tem par no Python — do
lado de lá é o pyshp — e porque juntar cem linhas de manipulação de bytes ao
`geoexport.js` estragaria a leitura lado a lado que justifica o resto.

---

## 4. Tarefas

### Task 1: fixtures dos exportadores

**Files:**

- Modify: `scripts/gen_parity_fixtures.py`
- Modify: `tests/test_parity.py`
- Regenerate: `tests/fixtures/parity.json`

- [ ] **Step 1: acrescentar as entradas ao gerador**

Importar de `geocoord.geoexport` e acrescentar quatro secções. Os casos de
`sanitize_filename` são os da tabela da §1.5 mais os que já existem no
`tests/test_geoexport.py`; os de `_safe_field_names` são os da §1.6.

Para o Shapefile, mascarar a data antes de gravar:

```python
def _shapefile_components(features, field_names, base_name):
    """The four shapefile parts, hex-encoded, with the DBF write date zeroed.

    pyshp stamps bytes 1..3 of the DBF header with today's date and
    zipfile.writestr stamps every entry with the local time, so neither the
    .zip nor the raw .dbf is reproducible. The parts are compared instead, with
    the date masked.
    """
    data = to_shapefile_zip(features, field_names, base_name=base_name)
    out = {}
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for name in z.namelist():
            ext = name.rsplit(".", 1)[-1]
            raw = bytearray(z.read(name))
            if ext == "dbf":
                raw[1:4] = b"\x00\x00\x00"
            out[ext] = bytes(raw).hex()
    return out
```

Manter os casos pequenos: um com dois pontos e dois campos de texto, um com um
ponto e um nome de campo longo que obrigue a truncar, e um com um nome de
ficheiro acentuado para exercer o `base_name`.

- [ ] **Step 2: gerar e rever à vista**

Run: `python scripts/gen_parity_fixtures.py`

Confirmar que a secção `to_shapefile_zip` traz quatro chaves por caso (`shp`,
`shx`, `dbf`, `prj`) e que o `prj` é sempre o mesmo — é uma constante.

Confirmar também que os bytes 1 a 3 do `dbf` estão a zero: no hex, os
caracteres nas posições 2 a 7 devem ser `000000`.

- [ ] **Step 3: escrever a metade pytest**

Acrescentar a `tests/test_parity.py` os testes das quatro secções novas. O de
GeoJSON compara objetos desserializados, o de KML compara bytes, o do Shapefile
compara os componentes com a mesma máscara.

- [ ] **Step 4: correr**

Run: `python -m pytest tests/test_parity.py -q`
Expected: passa, com a contagem aumentada pelas secções novas. Reportar o número
real.

- [ ] **Step 5: confirmar a guarda**

Run: `python scripts/gen_parity_fixtures.py --check`
Expected: `is up to date`, saída 0.

- [ ] **Step 6: commit**

### Task 2: `sanitizeFilename`

**Files:**

- Create: `web/src/core/geoexport.js`
- Create: `web/tests/geoexport.test.js`

- [ ] **Step 1: teste que falha**, sobre a secção `sanitize_filename` do
  contrato.
- [ ] **Step 2: correr e ver falhar** — `sanitizeFilename is not a function`.
- [ ] **Step 3: implementar.**

```js
/**
 * Turn an arbitrary name into a safe base name for output files and GIS layers.
 *
 * Mirrors sanitize_filename() in geocoord/geoexport.py. The NFKD normalisation
 * followed by dropping every non-ASCII character is what transliterates the
 * accents: "á" decomposes to "a" plus a combining mark and the mark is dropped.
 * It also folds compatibility forms, so "ﬁ" becomes "fi", "½" becomes "12" and
 * "Ⅻ" becomes "XII", while "ß" and "œ" do not decompose and disappear entirely.
 */
export function sanitizeFilename(name, defaultName = 'converted', maxLength = 60) {
  let stem = String(name).replace(/\\/g, '/').split('/').pop()
  stem = stem.replace(/\.[^.]+$/, '')
  stem = stem.normalize('NFKD').replace(/[^\x00-\x7F]/g, '')
  stem = stem.replace(/[^A-Za-z0-9_-]+/g, '_')
  stem = stem.replace(/_+/g, '_').replace(/^[_-]+|[_-]+$/g, '')
  stem = stem.slice(0, maxLength).replace(/^[_-]+|[_-]+$/g, '')
  return stem || defaultName
}
```

- [ ] **Step 4: correr e ver passar.** Se algum caso da tabela da §1.5 falhar,
  reportar qual e o que saiu, sem tocar no contrato.
- [ ] **Step 5: commit.**

### Task 3: `jsonSafe`, `pyFloat` e `toGeoJSON`

- [ ] **Step 1: teste que falha**, comparando `JSON.parse(toGeoJSON(f))` com o
  objeto esperado.
- [ ] **Step 2: correr e ver falhar.**
- [ ] **Step 3: implementar.**

```js
/**
 * Format a number the way Python's repr does, for the values a coordinate can
 * take. An integral float keeps its ".0" and an exponent is padded to two
 * digits, both of which JavaScript omits.
 *
 * Bounded to the coordinate domain on purpose: outside it the two languages
 * also disagree about when to switch to exponential form at all — Python from
 * 1e16, JavaScript from 1e21 — and no latitude or longitude reaches that.
 */
export function pyFloat(value) {
  const s = String(value)
  if (s.includes('e')) return s.replace(/e([+-])(\d)$/, 'e$10$2')
  return s.includes('.') || s.includes('N') || s.includes('I') ? s : `${s}.0`
}
```

O `jsonSafe` devolve `null` para valores não finitos e passa o resto adiante,
tal como o `_json_safe`.

- [ ] **Step 4: correr e ver passar.**
- [ ] **Step 5: commit.**

### Task 4: `toKML`

Atenção ao escape: só `&`, `<` e `>` (§1.4). E às coordenadas, que usam o
`pyFloat` com a terceira componente escrita como `0` literal, não `0.0` —
confirmar contra o contrato.

- [ ] **Step 1: teste que falha**, comparando bytes.
- [ ] **Step 2: correr e ver falhar.**
- [ ] **Step 3: implementar.**
- [ ] **Step 4: correr e ver passar.**
- [ ] **Step 5: commit.**

### Task 5: `safeFieldNames`, `dbfValue` e o escritor de DBF

**Files:** Create `web/src/core/shapefile.js`.

A desambiguação da §1.6 é a parte que se traduz mal: a comparação é em
maiúsculas e o sufixo **substitui** o fim do nome.

O truncamento dos valores é a 254 **bytes** em UTF-8, não a 254 caracteres. Usar
`TextEncoder` e cortar o array de bytes, não a string.

- [ ] **Step 1: testes que falham** para `safeFieldNames` (contrato) e para o
  cabeçalho do DBF (contrato, via a secção do Shapefile).
- [ ] **Step 2: correr e ver falhar.**
- [ ] **Step 3: implementar** o layout da §1.2.
- [ ] **Step 4: correr e ver passar.**
- [ ] **Step 5: commit.**

### Task 6: o escritor de `.shp` e `.shx`

Layout da §1.1. Atenção à mistura de ordens: o código de ficheiro e os
comprimentos são big-endian, tudo o resto é little-endian.

- [ ] **Step 1: teste que falha.**
- [ ] **Step 2: correr e ver falhar.**
- [ ] **Step 3: implementar.**
- [ ] **Step 4: correr e ver passar.**
- [ ] **Step 5: commit.**

### Task 7: `toShapefileZip`

**Files:** Modify `web/package.json` para acrescentar o `jszip`.

Lembrar que `npm install` de raiz rebenta neste ambiente; usar `npm install
jszip` com o lockfile já presente, ou `npm ci` depois de editar o
`package.json` à mão.

O zip não é comparado, só os componentes — mas tem de ser um zip válido.

- [ ] **Step 1: teste que falha.**
- [ ] **Step 2: correr e ver falhar.**
- [ ] **Step 3: implementar.**
- [ ] **Step 4: correr e ver passar.**
- [ ] **Step 5: commit.**

### Task 8: teste diferencial e fecho

Na fase 1a, um teste diferencial encontrou em vinte minutos seis divergências
que duas revisões de código não viram. Repetir aqui, antes de dar a fase por
fechada.

- [ ] **Step 1:** gerar alguns milhares de conjuntos de features aleatórios —
  coordenadas em toda a gama, atributos com acentos, aspas, `&`, `<`, valores
  nulos e não finitos, nomes de campo longos e colidentes, nomes de ficheiro
  acentuados — e correr os quatro exportadores dos dois lados.
- [ ] **Step 2:** reportar as divergências com a menor entrada que as reproduza.
  Zero é o resultado esperado; se não for, corrigir e pinar cada uma com um caso
  novo antes de fechar.
- [ ] **Step 3:** atualizar o README e o CHANGELOG.
- [ ] **Step 4:** commit.

---

## 5. Riscos

| Risco | Mitigação |
| --- | --- |
| O DBF não bater byte a byte | o layout está medido na §1.2; comparar componente a componente dá o offset exato onde diverge |
| O truncamento UTF-8 partir um carácter a meio | acontece já no Python; reproduzir o comportamento, não o corrigir, e pinar um caso |
| O `pyFloat` divergir fora do domínio das coordenadas | limite declarado no comentário e no plano; não é alcançável por uma latitude ou longitude |
| A ordem dos bytes trocada no `.shp` | o cabeçalho mistura big e little endian de propósito; a §1.1 diz qual é qual campo a campo |
| O `jszip` inflar o bundle | é pequeno e só entra no caminho do Shapefile; medir na fase 2, quando houver bundle |

## 6. Fora de âmbito

- A exportação GPX, que é da fase 5.
- Qualquer alteração ao `geoexport.py` além do `.prj` variável, que pertence à
  fase 4 com os sistemas de coordenadas.
- Ler Shapefiles. Só se escreve.
