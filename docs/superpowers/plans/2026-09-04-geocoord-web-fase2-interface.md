# GeoCoord Web — Fase 2: a interface

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** A aplicação web sobre o motor já traduzido, cobrindo todo o
inventário de paridade da §6 da spec.

**Architecture:** SPA em React sobre Vite, servida estaticamente. Todo o
processamento acontece no browser; nada é enviado para lado nenhum. O motor
(`web/src/core/`) já existe e está verificado — a interface não recalcula nada,
só o invoca.

**Tech Stack:** Vite, React 18, Tailwind 3, Leaflet, PapaParse, SheetJS, jszip.

**Depende de:** fases 1a e 1b, concluídas em `096b161`.

**Spec:**
[2026-09-04-geocoord-web-design.md](../specs/2026-09-04-geocoord-web-design.md)

---

## 1. Decisões apuradas antes de planear

### 1.1 O SheetJS vem do CDN do fornecedor, não do npm

O pacote `xlsx` no registo npm está parado na **0.18.5**, de 2022, com dois
avisos de gravidade alta e sem correção disponível:

```text
xlsx  *
Severity: high
Prototype Pollution in sheetJS
SheetJS Regular Expression Denial of Service (ReDoS)
No fix available
```

*Prototype pollution* a partir de um `.xlsx` manipulado é precisamente a
superfície de ataque de uma aplicação pública cujo trabalho é ler folhas de
cálculo de terceiros. Não entra assim.

O fornecedor deixou de publicar no npm e distribui do seu próprio CDN.
Verificado: instala, é a **0.20.3**, licença **Apache-2.0** — a mesma do
GeoCoord — e a auditoria dá zero. Lê BIFF2 a BIFF8, ou seja todos os `.xls`
antigos, que a aplicação Streamlit também lê e que aparecem nos dados reais.

```bash
npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
```

O `exceljs` foi considerado e descartado: é MIT e está no registo, mas a sua
própria descrição diz *"read and write xlsx and csv"* — não lê `.xls`, e isso
quebra a paridade.

Peso medido: 930 KB minificado no build completo, 273 KB no mínimo. Com
*tree-shaking* fica bem dentro dos 2 a 3 MB prometidos na spec.

### 1.2 O tema: escuro como o vizinho, verde como o GeoCoord

O `dji-mission-planner` usa fundo `slate-950` com acento `sky-400`. A spec
mandava copiar isso. Ao executar, desvio-me num ponto e digo porquê: o GeoCoord
tem identidade própria — o `.streamlit/config.toml` usa o verde `#1f7a4d` — e
duas ferramentas do mesmo autor devem parecer da mesma família sem se fazerem
passar uma pela outra.

Fica o mesmo sistema (fundo escuro de ardósia, um acento único) com o acento do
GeoCoord aclarado para funcionar sobre escuro: **emerald-400 `#34d399`**, que
dá cerca de 9:1 de contraste sobre `slate-950`. O verde original `#1f7a4d` é
escuro de mais para texto sobre fundo escuro. O `dji-mission-planner` já usa
`emerald-600` nos botões de exportação, portanto a cor não é estranha à
família.

### 1.3 Padrão de i18n copiado do vizinho

`src/i18n.jsx` com um `DICT` de chaves, cada uma com `pt` e `en`, e um
`useT()` que interpola `{var}`. Uma chave em falta cai para `pt` e, em último
caso, para a própria chave — visível, para ser corrigida. Os dicionários são
divididos por área em `src/i18n/dict.*.js`.

---

## 2. Faseamento

A fase 2 é grande de mais para um plano único. Sete unidades, cada uma a
terminar num estado verificável:

| Unidade | Entrega |
| --- | --- |
| **2a** | Andaime: Vite, React, Tailwind, tema, cabeçalho, i18n. `npm run build` produz um `dist`. |
| **2b** | Leitura: ficheiro, CSV com opções, Excel com folhas, `tidyTable`, pré-visualização |
| **2c** | Colunas e conversão: deteção automática, pré-visualização, casas decimais, tabela de resultado |
| **2d** | Trocas: regiões, métricas, aviso de região, revisão, inverter, aplicar |
| **2e** | Mapa e resumo: Leaflet, paleta Okabe-Ito, legenda, caixa envolvente, centroide |
| **2f** | Descargas: os cinco formatos, caixas de seleção, nome do ficheiro |
| **2g** | Conversão rápida |

**Este documento detalha a 2a.** As restantes estão especificadas ao nível do
que tem de existir; cada uma ganha o seu detalhe quando for a sua vez, com a
mesma investigação prévia que as fases 1a e 1b mostraram valer a pena.

---

## 3. Unidade 2a: andaime

### Task 1: dependências

**Files:** Modify `web/package.json`.

- [ ] **Step 1: acrescentar as dependências**

```bash
cd web
npm install react@^18.3.1 react-dom@^18.3.1
npm install --save-dev @vitejs/plugin-react vite tailwindcss@^3.4.17 postcss autoprefixer
```

Não correr `npm install` sem argumentos: sem lockfile rebenta num defeito do
Arborist do npm. Com o lockfile presente funciona, e instalar pacotes nomeados
também.

Expected: o `package.json` fica com `react` e `react-dom` em `dependencies`, e
o resto em `devDependencies`, ao lado do `vitest` e do `jszip` que já lá estão.

- [ ] **Step 2: acrescentar os scripts**

Em `web/package.json`, juntar aos scripts existentes:

```json
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
```

- [ ] **Step 3: confirmar que nada partiu**

Run: `npm test`
Expected: os 147 testes continuam a passar. O `vitest.config.js` é separado do
`vite.config.js` e não é afetado.

- [ ] **Step 4: commit**

### Task 2: configuração do Vite e do Tailwind

**Files:** Create `web/vite.config.js`, `web/tailwind.config.js`,
`web/postcss.config.js`, `web/index.html`, `web/src/index.css`.

- [ ] **Step 1: `web/vite.config.js`**

```js
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// A versão vem do package.json, para o cabeçalho poder dizer qual build está a
// correr sem que haja um segundo sítio onde a manter.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// base = o nome do repositório, porque o GitHub Pages serve em
// https://pedrommgoncalves.github.io/geocoord/ e não na raiz do domínio.
export default defineConfig({
  plugins: [react()],
  base: '/geocoord/',
  define: { 'import.meta.env.APP_VERSION': JSON.stringify(version) },
})
```

- [ ] **Step 2: `web/tailwind.config.js`**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Mesmo sistema do dji-mission-planner - fundo de ardósia, um acento -
        // com o verde do GeoCoord no lugar do azul, aclarado para funcionar
        // sobre escuro: o #1f7a4d do tema Streamlit não tem contraste
        // suficiente para texto aqui.
        panel: '#020617',
        surface: '#0f172a',
        edge: '#1e293b',
        accent: '#34d399',
      },
    },
  },
  plugins: [],
}
```

- [ ] **Step 3: `web/postcss.config.js`**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

- [ ] **Step 4: `web/index.html`**

Com `lang="pt"`, um `<meta name="description">` em português, e um favicon SVG
embebido como o do vizinho — nada de pedidos de rede extra.

- [ ] **Step 5: `web/src/index.css`**

As três diretivas do Tailwind, `html, body, #root { height: 100%; margin: 0 }`,
e o fundo do contentor do Leaflet a escuro para não piscar branco enquanto os
tiles carregam.

- [ ] **Step 6: commit**

### Task 3: i18n

**Files:** Create `web/src/i18n.jsx`, `web/src/i18n/dict.app.js`.

- [ ] **Step 1: o módulo**, no padrão do vizinho: `LANGS`, `LangContext`,
  `useLang()`, `useT()` com interpolação de `{var}`, e a queda para `pt` e
  depois para a própria chave.
- [ ] **Step 2: o dicionário** do cabeçalho e do invólucro.
- [ ] **Step 3: um teste** que verifique a queda de uma chave em falta e a
  interpolação — é lógica, e lógica leva teste.
- [ ] **Step 4: correr, ver passar, commit.**

### Task 4: o invólucro

**Files:** Create `web/src/main.jsx`, `web/src/App.jsx`.

- [ ] **Step 1: `main.jsx`** monta o React em `#root`.
- [ ] **Step 2: `App.jsx`** com o cabeçalho compacto — ícone, nome, versão de
  `import.meta.env.APP_VERSION`, subtítulo, e o seletor de língua à direita — e
  um corpo vazio com uma nota de que o conversor chega na unidade seguinte.
- [ ] **Step 3: build**

Run: `npm run build`
Expected: produz `web/dist/` sem avisos. Reportar o tamanho de
`dist/assets/*.js`, que é a primeira medição real contra a promessa de 2 a 3 MB.

- [ ] **Step 4: ver a página**

Run: `npm run preview` e abrir o endereço.
Expected: cabeçalho escuro com o acento verde, versão visível, e o seletor de
língua a trocar o subtítulo entre português e inglês.

- [ ] **Step 5: confirmar que a suite continua verde**, e commit.

### Task 5: o `dist` fora do git e o README

- [ ] **Step 1:** confirmar que `web/dist/` é ignorado — o `.gitignore` da raiz
  já tem `dist/` sem barra inicial, portanto apanha a qualquer profundidade.
  Verificar em vez de assumir, mas com cuidado: `git check-ignore -v web/dist`
  **dá falso negativo enquanto a pasta não existir**, porque o padrão `dist/`
  só casa com diretórios e o git não sabe que aquilo é um. Testar um ficheiro
  lá dentro depois do build:

```bash
git check-ignore -v web/dist/index.html
```

Expected: uma linha a apontar para `.gitignore:11:dist/`. E `git status
--short` não deve mostrar nada em `web/dist`.

- [ ] **Step 2:** acrescentar ao README, na secção da aplicação web, como correr
  em desenvolvimento (`npm run dev`) e como construir.
- [ ] **Step 3: commit.**

---

## 4. Unidades 2b a 2g: o que tem de existir

Especificado agora para o âmbito ficar fixo; o detalhe vem quando for a vez de
cada uma.

**2b — Leitura.** Entrada de ficheiro para `.xlsx`, `.xls` e `.csv`. CSV com
separador (`auto`, `,`, `;`, tabulação, `|`) e decimal (`.` ou `,`), com a
recuperação de codificação utf-8 para latin1 que o Python faz. Excel com
seletor de folha quando o livro tem mais do que uma. O `tidyTable` corre a
seguir à leitura. Pré-visualização das primeiras 20 linhas.

**2c — Colunas e conversão.** Deteção automática pelas mesmas listas de
candidatos do `app.py`, incluindo `X`/`Y`. Pré-visualização da conversão nas
primeiras 5 linhas. Casas decimais de 2 a 10. Colunas GMS opcionais. Tabela de
resultado com `Latitude_DD`, `Longitude_DD`, `X_DD`, `Y_DD`, `WKT` e `status`.

**2d — Trocas.** As oito regiões, o centro personalizado com raio, o modo
automático, a opção de inverter. Métricas de 4 ou 5 conforme haja região
declarada. Aviso que nomeia a região real com troca num clique. Painel de
revisão e aplicação a N linhas — **nunca automática**.

**2e — Mapa e resumo.** Leaflet com a paleta Okabe-Ito (azul `#0072B2` para OK,
vermelhão `#D55E00` para troca possível), legenda, tooltip com linha, estado e
coordenadas. Pontos desenhados mesmo sem rede. Caixa envolvente, centroide e
tabela das linhas inválidas.

**2f — Descargas.** CSV, Excel, GeoJSON, KML e Shapefile, com caixas de seleção
— os três primeiros ligados por omissão —, desativadas sem pontos válidos, e
nomes derivados do ficheiro de entrada.

**Atenção:** os exportadores recebem os atributos como `Map`, não como objeto.
Um objeto não consegue transportar a ordem das colunas — o JavaScript põe uma
chave que pareça inteiro à frente das outras, e uma coluna chamada `2024`
saltaria para o início do KML. A fase 1b apanhou isto e a interface tem de
respeitar.

**2g — Conversão rápida.** Par isolado, avisos de intervalo, WKT, GMS de volta
e mapa de um ponto.

---

## 5. Riscos

| Risco | Mitigação |
| --- | --- |
| O bundle passar dos 3 MB | medir na 2a e a cada unidade que acrescente dependência; o SheetJS tem builds `mini` e `core` mais leves se for preciso |
| Ficheiros grandes bloquearem o browser | virtualizar a tabela na 2c; medir com 50 mil linhas e, se preciso, mover a conversão para um Web Worker |
| A interface recalcular o que o motor já faz | a interface não contém lógica de conversão; qualquer cálculo novo é um sinal de que devia estar no `core/` e coberto pelo contrato |
| Perder a ordem das colunas nos exportadores | passar `Map`, como a §4 explica; a fase 1b já pagou este erro uma vez |
| O tema divergir do vizinho sem intenção | as cores vivem só no `tailwind.config.js`, num sítio |

## 6. Fora de âmbito

- Arrastar e largar, colar da folha, GPX, PWA — fase 5.
- Sistemas de coordenadas — fase 4.
- Publicação no GitHub Pages — fase 3.
