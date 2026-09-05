# GeoCoord Web — página pública de conversão de coordenadas

**Data:** 2026-09-04

**Estado:** desenho aprovado, por rever antes do plano de implementação

> Documento escrito em português por ser um artefacto de trabalho e por o
> público alvo da ferramenta ser lusófono. O código e a documentação pública do
> repositório mantêm-se em inglês.

## 1. Objetivo

Acrescentar ao GeoCoord uma aplicação web pública, alojada em GitHub Pages, que
corra inteiramente no browser do utilizador e dote a comunidade de uma
ferramenta livre de conversão de coordenadas — sem instalação, sem conta, e sem
que os dados saiam do computador de quem a usa.

Endereço previsto: `https://pedrommgoncalves.github.io/geocoord/`

## 2. Princípios

1. **Acrescentar, nunca remover.** Tudo o que existe hoje no repositório
   continua a existir e a funcionar.
2. **Paridade funcional.** A aplicação web faz tudo o que a aplicação Streamlit
   faz hoje. Nenhuma funcionalidade fica pelo caminho.
3. **Genérica por omissão.** A ferramenta deve servir colegas dos PALOP tão bem
   como o trabalho em Portugal. Onde houver uma lista, há uma escotilha genérica
   ao lado.
4. **Funciona offline.** Depois da primeira visita, sem rede.
5. **Os dados não saem do dispositivo.** Todo o processamento é local ao
   browser.

## 3. O que fica intacto

Nada nesta lista é alterado, movido ou descontinuado:

- O pacote `geocoord/` (`converter.py`, `geoexport.py`) e a sua API pública.
- A aplicação Streamlit `app.py`.
- A suite `tests/` (70 testes recolhidos: 42 funções no conversor e 9 nos
  exportadores, expandidas pelas parametrizações) e o
  `.github/workflows/ci.yml` nas versões 3.11, 3.12 e 3.13 do Python.
- O `package.json` da raiz e o build desktop stlite/Electron.
- `scripts/run_app.bat`, `scripts/build_exe.bat`, `.streamlit/config.toml`.

A única alteração ao código Python existente está descrita em §8.3 (o `.prj` do
Shapefile deixa de ser fixo em WGS84) e é aditiva: o comportamento por omissão
mantém-se idêntico.

## 4. Arquitetura

### 4.1 Layout do repositório

```text
geocoord/                      pacote Python (inalterado)
app.py                         aplicação Streamlit (inalterada)
package.json                   build desktop stlite/Electron (inalterado)
tests/                         pytest (inalterado, mais as fixtures novas)
  fixtures/
    parity.json                NOVO — contrato partilhado pytest <-> vitest
    crs-control-points.json    NOVO — pontos de controlo das projeções
web/                           NOVO — a aplicação web
  package.json                 dependências e scripts da SPA
  vite.config.js               base: '/geocoord/'
  index.html
  src/
    core/                      motor traduzido, sem dependências de UI
      converter.js             espelho de geocoord/converter.py
      geoexport.js             espelho de geocoord/geoexport.py
      crs.js                   NOVO — registo e transformação de sistemas
    components/                interface React
    i18n/                      PT / EN
  tests/                       vitest, incluindo os testes de paridade
.github/workflows/
  ci.yml                       pytest (inalterado, mais um job para o vitest)
  deploy.yml                   NOVO — build e publicação em GitHub Pages
```

O `package.json` da raiz continua a ser o do build Electron. O da SPA vive em
`web/` e o workflow de publicação corre com `working-directory: web`. Não há
conflito entre os dois.

### 4.2 Stack

Espelha o repositório vizinho `dji-mission-planner`, para haver uma só família
de convenções entre os dois projetos:

| Papel | Escolha | Notas |
| --- | --- | --- |
| Build | Vite | `base: '/geocoord/'` |
| Interface | React | como no projeto vizinho |
| Estilo | Tailwind | tema escuro `slate-950`, acento `sky-400` |
| Projeções | proj4 | ~40 KB; já usado no projeto vizinho |
| Excel | SheetJS | lê e escreve `.xlsx`; lê `.xls` |
| CSV | PapaParse | deteção de separador, codificação |
| Mapa | Leaflet | como no projeto vizinho |
| Zip | jszip | empacotamento do Shapefile |
| Testes | vitest | mais os testes de paridade |

### 4.3 WGS84 como pivô interno

Decisão central da arquitetura.

```text
   entrada                      núcleo                        saída
   -------                      ------                        -----
 sistema de           parse ->  WGS84 lat/lon      -> projeta -> sistema de
 entrada                        (representação                   saída
 (geográfico ou                  única e canónica)
  projetado)                          |
                                      v
                        validação de intervalos
                        deteção de trocas X/Y
                        máscaras de região
                        mapa, resumo, métricas
```

Toda a lógica de validação existente opera exclusivamente em WGS84 e **nunca
toma conhecimento de que existem projeções**. Isto tem duas consequências
desejáveis:

1. O código traduzido de `converter.py` mantém-se fiel ao original, e as
   fixtures de paridade continuam a fazer sentido.
2. A deteção de X/Y trocado passa a funcionar em dados projetados sem uma linha
   nova. Um ponto PT-TM06 com as colunas trocadas, ao ser desprojetado, aterra
   fora de qualquer região conhecida; ao trocar, cai dentro de Portugal. A
   máscara de região apanha-o com a lógica que já existe.

## 5. Contrato de paridade

Existirem duas implementações do motor é o custo real deste desenho. O mecanismo
que o torna aceitável é este, e não deve ser diluído durante a implementação.

`tests/fixtures/parity.json` contém pares de entrada e resultado esperado,
extraídos dos casos que hoje vivem em `tests/test_converter.py` e
`tests/test_geoexport.py`. **O pytest e o vitest leem o mesmo ficheiro.** Se as
duas implementações divergirem num único valor, ambos os CIs falham.

Cobertura obrigatória das fixtures:

- `parse_coordinate`: decimal, graus com minutos decimais, GMS, hemisférios em
  prefixo e sufixo (`N`/`E`/`L` positivos, `S`/`W`/`O` negativos), sinal
  negativo explícito, vírgula decimal, entradas inválidas, valores vazios.
- `format_dms`: ida e volta DD -> GMS -> DD, casas decimais dos segundos.
- `in_range`: fronteiras de latitude e longitude.
- `tidy_table`: cabeçalho após linha em branco, coluna-índice vazia à esquerda,
  linhas totalmente vazias, vírgula decimal dentro de campos entre aspas.
- `detect_swaps`: por intervalo, por máscara de região, por aglomerado denso,
  incluindo o caso ambíguo de metade dos dados trocados.
- `region_check` e `identify_region`: ponto fora da região declarada com região
  real identificada, e sem região correspondente.
- `sanitize_filename`: acentos, espaços, caracteres proibidos, truncamento.
- `to_kml`: bytes produzidos, para entradas fixas. Atenção a duas armadilhas de
  tradução: um float inteiro imprime-se `-8.0` em Python e `-8` em JavaScript, e
  o `escape` do Python só escapa `&`, `<` e `>`. As fixtures de KML usam apenas
  valores de texto e inteiros nos atributos, porque o JavaScript não distingue
  `1` de `1.0` e essa ambiguidade não é resolúvel.
- `to_geojson`: comparação sobre o **objeto desserializado**, não sobre os
  bytes. O `json.dumps` do Python separa com `", "` e `": "`; o
  `JSON.stringify` não põe espaço nenhum. Comparar bytes falharia sempre.
- `to_shapefile_zip`: comparação dos quatro componentes depois de
  descomprimidos, com os **bytes 1 a 3 do cabeçalho DBF mascarados**. O pyshp
  grava aí a data de escrita (verificado: `[126, 9, 4]` para 2026-09-04) e o
  `zipfile.writestr` carimba cada entrada com a hora local, portanto nem o
  `.zip` nem o `.dbf` são deterministas. É o exportador mais delicado de
  traduzir e por isso o que mais precisa desta verificação.

### 5.1 Limitação assumida

A camada de projeção **não** está coberta por este contrato: do lado Python não
existe `pyproj`, logo não há com o que comparar. As projeções são validadas
contra pontos de controlo publicados, em
`tests/fixtures/crs-control-points.json`, com uma tolerância declarada por
sistema. É uma verificação mais fraca do que a paridade, e fica registada como
tal.

Nenhuma definição proj4 é escrita de memória. Cada uma é retirada de fonte
verificável (registo EPSG) e validada por pontos de controlo antes de entrar no
registo.

## 6. Inventário de paridade

A v1 só fecha quando tudo isto existir na aplicação web.

### 6.1 Leitura

- Formatos `.xlsx`, `.xls`, `.csv`.
- CSV: separador `auto`, `,`, `;`, tabulação, `|`; decimal `.` ou `,`;
  recuperação de codificação utf-8 com recurso a latin1.
- Excel: seletor de folha quando o livro tem mais do que uma.
- `tidy_table`: recuperação do cabeçalho real quando a primeira linha está
  vazia, remoção da coluna-índice vazia à esquerda, remoção de linhas vazias,
  interpretação de vírgulas decimais dentro de campos entre aspas.
- Pré-visualização das primeiras 20 linhas do ficheiro lido.

### 6.2 Escolha de colunas

- Deteção automática por nome, em português e inglês, e pela convenção GIS
  `X`/`Y` (`Y` = latitude, `X` = longitude). Listas de candidatos idênticas às
  de `app.py` (`LAT_CANDIDATES`, `LON_CANDIDATES`).
- Pré-visualização da conversão nas primeiras 5 linhas, antes de aplicar.

### 6.3 Conversão

- Formatos de entrada: decimal, graus com minutos decimais,
  graus-minutos-segundos.
- Hemisférios em prefixo ou sufixo, em português e inglês.
- Casas decimais configuráveis, de 2 a 10, com 6 por omissão.
- Colunas GMS opcionais (DD -> GMS).
- Colunas produzidas: `Latitude_DD`, `Longitude_DD`, `X_DD`, `Y_DD`, `WKT`,
  `status`, e opcionalmente `Latitude_GMS`, `Longitude_GMS`.

### 6.4 Deteção e correção de trocas

- Oito regiões nomeadas: Portugal continental (omissão), Açores, Madeira,
  Angola, Cabo Verde, Guiné-Bissau, Moçambique, São Tomé e Príncipe.
- Centro personalizado, com latitude e longitude de referência e raio de 1 a 45
  graus.
- Modo automático por aglomerado mais denso, com opção de inverter a sugestão
  para o caso em que cerca de metade dos dados está trocada.
- Aviso de pontos válidos fora da região declarada, nomeando a região onde caem
  de facto, com botão para trocar a região num clique.
- Métricas: cinco quando há região declarada (total, na região, fora da região,
  trocas possíveis, inválidos); quatro quando não há.
- Tabela das linhas suspeitas para revisão, e botão para aplicar a troca a N
  linhas. **A correção nunca é automática.**

### 6.5 Resultados

- **Tabela**: resultado completo, com virtualização para aguentar ficheiros
  grandes.
- **Mapa**: paleta Okabe-Ito segura para daltonismo (azul `#0072B2` para OK,
  vermelhão `#D55E00` para troca possível), legenda, e tooltip com número da
  linha, estado e coordenadas. Pontos desenhados mesmo sem rede; só o mapa de
  fundo precisa de ligação.
- **Resumo**: caixa envolvente, centroide, e tabela das linhas inválidas.
- **Descargas**: seleção por caixas — CSV, Excel e GeoJSON ativos por omissão,
  KML e Shapefile inativos —, botões desativados quando não há pontos válidos, e
  nomes de ficheiro derivados do ficheiro de entrada através de
  `sanitize_filename`.

### 6.6 Conversão rápida

Par isolado de coordenadas, sem ficheiro: valores em graus decimais, avisos de
intervalo, WKT, GMS de volta, e mapa de um ponto.

## 7. Funcionalidades novas na v1

### 7.1 Arrastar e largar

Zona de largada sobre a página inteira, aceitando `.xlsx`, `.xls` e `.csv`, com
realce visual durante o arrasto. O seletor de ficheiro clássico mantém-se como
alternativa acessível pelo teclado.

### 7.2 Colar da folha de cálculo

Caixa onde o utilizador cola diretamente o que copiou do Excel ou do
LibreOffice. O conteúdo colado é texto separado por tabulações, lido pelo
PapaParse e encaminhado para o mesmo pipeline de deteção de colunas. Evita o
passo de gravar como CSV no fluxo mais comum.

### 7.3 Exportação GPX

Sexto formato de saída, para carregar pontos num GPS de mão. GPX 1.1, um `<wpt>`
por ponto válido, com `<name>` retirado da mesma coluna que serve de nome no
KML. Sempre em WGS84, por imposição do formato.

### 7.4 PWA

Service worker que guarda a aplicação e os seus recursos, tornando-a instalável
e utilizável sem rede após a primeira visita. Com um bundle de 2 a 3 MB isto é
barato, e é o que permite usar a ferramenta em campo.

### 7.5 Português e inglês

Interface em PT e EN, com o mesmo padrão de i18n do `dji-mission-planner`.
Deteção pela língua do browser, com escolha manual persistida.

## 8. Sistemas de coordenadas

### 8.1 Registo

Dois seletores independentes: sistema de entrada e sistema de saída.

#### Geográficos

Os valores passam pelo `parse_coordinate` (GMS, graus com minutos decimais,
decimal, hemisférios). As colunas chamam-se Latitude e Longitude.

| EPSG | Nome |
| --- | --- |
| 4326 | WGS 84 |
| 4258 | ETRS89 |
| 5013 | PTRA08 |

#### Projetados, continente

Definições já validadas em uso no `dji-mission-planner`
(`src/utils/importArea.js`).

| EPSG | Nome |
| --- | --- |
| 3763 | ETRS89 / Portugal TM06 |
| 25829 | ETRS89 / UTM zone 29N |
| 32629 | WGS 84 / UTM zone 29N |
| 27493 | Datum 73 / Modified Portuguese Grid |
| 20790 | Lisboa / Hayford-Gauss Militar |

#### Projetados, ilhas — realização moderna (PTRA08)

| EPSG | Nome | Cobertura |
| --- | --- | --- |
| 5014 | PTRA08 / UTM zone 25N | Açores, Grupo Ocidental (Flores, Corvo) |
| 5015 | PTRA08 / UTM zone 26N | Açores, Grupo Central e Oriental |
| 5016 | PTRA08 / UTM zone 28N | Madeira, Porto Santo, Desertas, Selvagens |

#### Projetados, ilhas — datums históricos

| EPSG | Nome | Cobertura |
| --- | --- | --- |
| 2188 | Azores Occidental 1939 / UTM zone 25N | Flores, Corvo |
| 2189 | Azores Central 1948 / UTM zone 26N | Faial, Graciosa, Pico, São Jorge, Terceira |
| 2190 | Azores Oriental 1940 / UTM zone 26N | São Miguel, Santa Maria, Formigas |
| 2191 | Madeira 1936 / UTM zone 28N | Madeira |
| 2942 | Porto Santo / UTM zone 28N | Madeira, Porto Santo (datum de 1936) |
| 3061 | Porto Santo 1995 / UTM zone 28N | Madeira, Porto Santo, Desertas |

Os códigos das ilhas foram verificados no registo EPSG durante o desenho. O
estado de depreciação de 2942, 2191 e 3061 deve ser reconfirmado na
implementação, e os depreciados assinalados na interface.

#### Escotilhas genéricas

É o que cumpre o princípio 3 e serve os colegas dos PALOP sem depender de eu
adivinhar datums nacionais:

- **UTM genérico**: zona de 1 a 60, hemisfério norte ou sul, sobre WGS84 ou
  ETRS89. Cobre imediatamente Angola (32S, 33S), Moçambique (36S, 37S), Cabo
  Verde, Guiné-Bissau e São Tomé e Príncipe — os países que já constam das
  máscaras de região. Colunas nomeadas `X_UTM33S`, `Y_UTM33S` e afins.
- **Definição proj4 personalizada**: campo onde se cola uma definição proj4
  completa. Cobre qualquer sistema não listado e funciona offline, por não
  depender da consulta a nenhum registo remoto. Colunas nomeadas `X_custom` e
  `Y_custom`.

Sistemas nacionais nomeados dos PALOP ficam como acrescento curado a verificar
durante a implementação. As duas escotilhas acima garantem a cobertura
independentemente disso.

### 8.2 Leitura conforme o sistema de entrada

| Tipo de entrada | Interpretação dos valores | Rótulos das colunas | Validação |
| --- | --- | --- | --- |
| Geográfico | `parse_coordinate` (GMS, GM, decimal, hemisférios) | Latitude, Longitude | `in_range` (-90..90, -180..180) |
| Projetado | número em metros, tolerante a vírgula decimal | X (Este), Y (Norte) | desprojeta e verifica a região |

O `in_range` de graus não se aplica a coordenadas projetadas. A verificação de
sanidade nesse caso é a que já existe: desprojetar para WGS84 e confirmar que o
ponto cai num sítio plausível.

### 8.3 Saída e formatos

As colunas `Latitude_DD`, `Longitude_DD`, `X_DD`, `Y_DD`, `WKT` e `status`
existem **sempre**, em WGS84, tal como hoje. Quando o sistema de saída não é
WGS84, aparecem colunas **adicionais** nesse sistema, nomeadas pelo código EPSG
(por exemplo `X_3763`, `Y_3763`), mais um `WKT` correspondente. Nada é removido
nem substituído.

Regras por formato, impostas pelas especificações e não por escolha de desenho:

| Formato | Sistema | Razão |
| --- | --- | --- |
| CSV | todas as colunas | leva os dois sistemas |
| Excel | todas as colunas | leva os dois sistemas |
| GeoJSON | sempre WGS84 | RFC 7946 |
| KML | sempre WGS84 | o formato só admite isso |
| GPX | sempre WGS84 | o formato só admite isso |
| Shapefile | sistema de saída | o `.prj` acompanha |

Isto obriga à única alteração ao Python existente: em `geocoord/geoexport.py`, a
constante `WGS84_ESRI_WKT` (linha 21) deixa de ser escrita fixamente no `.prj` e
passa a ser um parâmetro de `to_shapefile_zip`, com WGS84 por omissão. O
comportamento atual mantém-se para quem chama a função sem o novo argumento, e
os 18 testes de exportação existentes continuam a passar sem alteração.

## 9. Testes

| Camada | Ferramenta | Âmbito |
| --- | --- | --- |
| Motor Python | pytest | os 70 testes atuais, mais a leitura de `parity.json` |
| Motor JS | vitest | espelho dos testes do motor, sobre `parity.json` |
| Projeções | vitest | `crs-control-points.json`, com tolerância por sistema |
| Interface | vitest | leitura de ficheiros, deteção de colunas, exportações |

O `ci.yml` existente ganha um job para o lado JavaScript. O job Python mantém-se
exatamente como está.

## 10. Publicação

`.github/workflows/deploy.yml`, nos moldes do `dji-mission-planner`: permissão
de leitura apenas no job de build, escrita em Pages isolada no job que publica,
concorrência com grupo `pages`, SHA das actions fixados, e a sequência lint,
testes, build, `upload-pages-artifact`, `deploy-pages`.

## 11. Faseamento sugerido

O âmbito é grande para um único plano. Sugere-se esta ordem, em que cada fase
termina num estado verificável:

1. **Motor e contrato.** Extrair `parity.json` dos testes existentes, traduzir
   `converter.js` e `geoexport.js`, e pôr pytest e vitest a ler as mesmas
   fixtures. No fim desta fase há duas implementações provadamente concordantes,
   sem interface nenhuma.
2. **Interface com paridade.** A SPA completa sobre o motor traduzido, cobrindo
   todo o inventário da §6. No fim, a aplicação web faz tudo o que a Streamlit
   faz.
3. **Publicação.** `deploy.yml`, `base` do Vite, primeira publicação em Pages.
   No fim, o endereço está no ar.
4. **Sistemas de coordenadas.** Registo, os dois seletores, pontos de controlo,
   colunas adicionais e o `.prj` variável. No fim, a §8 está cumprida.
5. **Acabamentos.** Arrastar e largar, colar da folha, GPX, PWA, PT/EN.

As fases 1 a 3 já entregam valor público. As 4 e 5 acrescentam por cima de algo
que já está no ar.

## 12. Riscos

| Risco | Mitigação |
| --- | --- |
| Divergência entre os dois motores | `parity.json` partilhado; ambos os CIs falham em caso de discordância |
| `tidy_table` é a tradução mais traiçoeira | é onde entra o maior número de fixtures, antes de escrever o código |
| Não há biblioteca JS decente para escrever Shapefile | tradução manual das 158 linhas de `geoexport.py`, incluindo o truncamento dos nomes de campo do DBF a 10 caracteres |
| Ficheiros grandes a bloquear o browser | virtualização da tabela; medir com 50 mil linhas e, se necessário, mover o processamento para um Web Worker |
| Parâmetros de datum errados passam despercebidos | nenhuma definição proj4 escrita de memória; pontos de controlo obrigatórios por sistema |
| Códigos EPSG depreciados nas ilhas | reconfirmar 2942, 2191 e 3061 na implementação e assinalar na interface |

## 13. Fora de âmbito

Ficam deliberadamente de fora desta versão, sem prejuízo de virem depois:

- Distrito e concelho por ponto a partir da CAOP.
- Ficheiro de exemplo carregado num clique.
- Sistemas nacionais nomeados dos PALOP (as escotilhas genéricas cobrem o caso).
- Qualquer alteração ao build desktop Electron, que se mantém.
