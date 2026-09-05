# GeoCoord Web — Fase 2b: a leitura de ficheiros

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ler CSV e Excel no browser com o mesmo resultado que a aplicação
Streamlit, e fechar a lacuna que deixa esse passo sem contrato.

**Depende de:** fase 2a, concluída em `0a04796`. As dependências já estão
instaladas e provadas a instalar no runner do CI.

**Spec:**
[2026-09-04-geocoord-web-design.md](../specs/2026-09-04-geocoord-web-design.md)

---

## 1. A lacuna que esta fase existe para fechar

O contrato de paridade começa no `tidy_table`, que recebe uma tabela **já
lida**. O passo anterior — bytes de um ficheiro para tabela — não está coberto
por nada. É precisamente onde o pandas e o PapaParse mais facilmente
discordariam, e onde as fases 1a e 1b mostraram que discordâncias silenciosas
vivem.

Esta fase estende o contrato a esse passo, na parte em que é possível: **texto
CSV mais opções, para a tabela neutra depois do `tidyTable`**. O Excel fica de
fora, e a §4 explica porquê.

## 2. O que a investigação apurou

Medido, não suposto.

### 2.1 O PapaParse concorda com o pandas em quase tudo

Deteção de separador, com `sep=None` do lado do Python:

| entrada | pandas | PapaParse |
| --- | --- | --- |
| `a,b` | vírgula | vírgula |
| `a;b` | ponto e vírgula | ponto e vírgula |
| `a\tb` | tabulação | tabulação |
| `a\|b` | pipe | pipe |
| `a,b;c` (ambíguo) | vírgula, dando `['a', 'b;c']` | igual |
| `"Silva, Joao",39.0` | separador dentro de aspas respeitado | igual |
| o CSV sujo do README | 4 linhas, a primeira toda vazia | igual |

### 2.2 A exceção, e nela o Python está errado

Um CSV de uma só coluna:

```text
lat
39.0
38.9
```

O `csv.Sniffer` falha — *"Could not determine delimiter"* — e o pandas então
**adivinha o `t` de "lat" como separador**, devolvendo colunas `['la',
'Unnamed: 1']`. É corrupção silenciosa do cabeçalho. O PapaParse cai para
vírgula e devolve uma coluna chamada `lat`, que é a resposta certa.

O GeoCoord precisa de pelo menos duas colunas para fazer alguma coisa, portanto
um ficheiro assim é erro do utilizador — mas a aplicação mostra-lhe `la` e
`Unnamed: 1` em vez de dizer o que se passa. **Corrige-se o Python**, para os
dois lados concordarem na resposta correta, em vez de se congelar o defeito.

### 2.3 A opção `decimal` é inerte no caminho que interessa

O `read_csv` passa `decimal` ao pandas, e no caso real do README — o CSV com
uma linha em branco por cima e vírgulas decimais entre aspas — **não faz
diferença nenhuma**: com `decimal='.'` ou `decimal=','`, `Y[0]` sai como a
string `'33,6603'` em ambos. A razão é que a primeira linha de dados contém o
cabeçalho verdadeiro, o que torna a coluna de tipo objeto e impede o pandas de
a interpretar como número. Quem faz o trabalho é o `parse_coordinate`.

A opção só tem efeito em ficheiros limpos, onde a coluna é genuinamente
numérica. Isso tem de ficar escrito, porque um port que a implemente ao
contrário passaria despercebido no caso que toda a gente testa.

## 3. Tarefas

### Task 1: corrigir a deteção de separador e extrair um leitor puro

**Files:** Create `geocoord/reader.py`; modify `app.py`, `tests/test_reader.py`.

Hoje o `read_csv` vive dentro do `app.py` e recebe um objeto de ficheiro. Para
ser testável e espelhável tem de ser uma função pura sobre texto.

- [ ] **Step 1: teste que falha** para o caso de uma coluna, afirmando que
  `read_csv_text("lat\n39.0\n38.9\n", sep=None, decimal=".")` devolve uma
  coluna chamada `lat`, e não `['la', 'Unnamed: 1']`.
- [ ] **Step 2: correr e ver falhar**, reportando o que sai hoje.
- [ ] **Step 3: escrever o `geocoord/reader.py`** com o separador detetado
  explicitamente:

```python
def _sniff_separator(sample: str) -> str:
    """The delimiter, or a comma when there is nothing to detect.

    pandas' own sniffing, on failure, guesses a character out of the header -
    "lat\\n39.0\\n" comes back as columns ['la', 'Unnamed: 1'], the header cut
    in half. A file with a single column is useless to GeoCoord either way, but
    it should not be silently mangled on the way to being useless.
    """
    try:
        return csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
    except csv.Error:
        return ","
```

- [ ] **Step 4: correr, ver passar**, e confirmar que os testes existentes do
  `tidy_table` continuam verdes.
- [ ] **Step 5: apontar o `app.py` ao módulo novo**, sem mudar comportamento.
- [ ] **Step 6: commit.**

### Task 2: estender o contrato à leitura de CSV

**Files:** Modify `scripts/gen_parity_fixtures.py`, `tests/test_parity.py`.

Uma secção `read_csv` cujas entradas são texto CSV e opções, e cujo esperado é
a tabela neutra **depois do `tidyTable`** — o observável que interessa a jusante
e que as duas linguagens conseguem exprimir.

- [ ] **Step 1:** casos cobrindo o CSV sujo do README, cada separador, o
  separador dentro de aspas, o caso ambíguo, uma só coluna, linhas irregulares,
  um ficheiro vazio, e um com BOM.
- [ ] **Step 2: gerar e rever à vista.**
- [ ] **Step 3: a metade pytest.**
- [ ] **Step 4: correr, e confirmar que o `--check` passa.**
- [ ] **Step 5: commit.**

### Task 3: o leitor de CSV em JavaScript

**Files:** Create `web/src/core/reader.js`, `web/tests/reader.test.js`.

- [ ] Testes primeiro, contra a secção `read_csv` do contrato.
- [ ] Implementar sobre o PapaParse, respeitando a deteção automática e as
  opções explícitas de separador e decimal.
- [ ] A recuperação de codificação: tentar utf-8 e cair para latin1, como o
  Python faz. Do lado do browser isso é `TextDecoder('utf-8', {fatal: true})`
  com `TextDecoder('windows-1252')` como alternativa.
- [ ] Correr, ver passar, commit.

### Task 4: o leitor de Excel, testado de cada lado

**Files:** Modify `geocoord/reader.py`, `web/src/core/reader.js`; testes de
cada lado.

- [ ] Do lado do Python, `openpyxl` para `.xlsx` e `xlrd` para `.xls`, como
  hoje, mais o seletor de folha.
- [ ] Do lado do JavaScript, SheetJS para os dois, com `sheet_to_json`
  configurado para devolver células cruas e não formatadas.
- [ ] **Um ficheiro `.xlsx` de teste gerado pelos dois lados e lido pelos
  dois**, comparando a tabela neutra resultante. Não entra no contrato
  partilhado (ver §4), mas prova a equivalência onde ela importa.
- [ ] Correr, commit.

### Task 5: a interface da leitura

**Files:** `web/src/components/FileInput.jsx`, `CsvOptions.jsx`,
`SheetPicker.jsx`, `TablePreview.jsx`; modify `App.jsx`, os dicionários i18n.

- [ ] Entrada de ficheiro aceitando `.xlsx`, `.xls` e `.csv`.
- [ ] Opções de CSV num painel recolhido: separador e decimal.
- [ ] Seletor de folha, visível só quando o livro tem mais do que uma.
- [ ] Pré-visualização das primeiras 20 linhas.
- [ ] Erros legíveis quando o ficheiro não abre, em PT e EN.
- [ ] Correr a app, tirar uma captura, confirmar à vista.
- [ ] Commit.

## 4. Porque é que o Excel não entra no contrato partilhado

O contrato compara valores que as duas linguagens conseguem produzir a partir da
mesma entrada. Para o CSV isso é natural: a entrada é texto.

Para o Excel não é. O `openpyxl` e o SheetJS leem o mesmo ficheiro mas
constroem representações intermédias diferentes — tipos de célula, datas,
fórmulas, formatação — e forçar igualdade byte a byte entre elas seria pinar
detalhes de implementação de duas bibliotecas terceiras, não o comportamento do
GeoCoord.

O observável que interessa é a **tabela neutra depois do `tidyTable`**, e essa
verifica-se com um ficheiro de teste lido pelos dois lados, na Task 4. É uma
garantia mais fraca do que o contrato e fica registada como tal, tal como a
camada de projeção ficou na spec.

## 5. Riscos

| Risco | Mitigação |
| --- | --- |
| Datas do Excel virem como números de série | testar com uma coluna de datas; o GeoCoord só lê coordenadas, mas uma coluna de nomes ao lado pode conter datas |
| O SheetJS formatar células em vez de dar o valor cru | `raw: true` no `sheet_to_json`, verificado contra o openpyxl |
| Ficheiros grandes bloquearem o interface | medir com 50 mil linhas; se preciso, ler num Web Worker |
| A recuperação de codificação divergir | latin1 do Python e windows-1252 do browser não são idênticos nos bytes 0x80 a 0x9F; pinar um caso com esses bytes |

## 6. Fora de âmbito

- A conversão e a tabela de resultado — unidade 2c.
- Arrastar e largar e colar da folha — fase 5.
