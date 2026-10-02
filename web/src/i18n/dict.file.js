/**
 * Dictionary for the file conversion flow: reading, column choice, the
 * results table and the downloads.
 */
export default {
  'file.title': {
    pt: 'Converter um ficheiro',
    en: 'Convert a file',
  },

  'file.step1': { pt: 'Ficheiro', en: 'File' },
  'file.step2': { pt: 'Colunas e região', en: 'Columns and region' },
  'file.step3': { pt: 'Resultado', en: 'Result' },
  'file.stepMap': { pt: 'Mapa', en: 'Map' },
  'file.step4': { pt: 'Descarregar', en: 'Download' },

  'map.nothingToShow': {
    pt: 'Nenhum ponto para mostrar',
    en: 'No points to show',
  },
  'map.emptyHint': {
    pt: 'Os pontos aparecem aqui assim que houver coordenadas convertidas.',
    en: 'Points appear here as soon as there are converted coordinates.',
  },
  'map.loading': { pt: 'A carregar o mapa…', en: 'Loading the map…' },
  'map.failed': {
    pt: 'Não foi possível carregar o mapa. A conversão e as descargas não dependem dele.',
    en: 'The map could not be loaded. Conversion and downloads do not depend on it.',
  },
  'map.label': { pt: 'Mapa dos pontos convertidos', en: 'Map of the converted points' },
  'map.legendOk': { pt: 'Convertido', en: 'Converted' },
  'map.legendFixed': { pt: 'Posição corrigida', en: 'Corrected position' },
  'map.hint': {
    pt: 'Passa o rato num ponto para ver o nome; clica para o ver na tabela.',
    en: 'Hover over a point for its name; click it to see it in the table.',
  },
  'map.legendSuspect': { pt: 'A rever', en: 'Needs review' },
  'map.baseDark': { pt: 'Escuro', en: 'Dark' },
  'map.baseLight': { pt: 'Claro', en: 'Light' },
  'map.baseSat': { pt: 'Satélite', en: 'Satellite' },
  'map.baseHybrid': { pt: 'Híbrido', en: 'Hybrid' },
  'map.baseOsm': { pt: 'OpenStreetMap', en: 'OpenStreetMap' },
  'map.baseTopo': { pt: 'Topográfico', en: 'Topographic' },
  'map.baseNone': { pt: 'Sem fundo', en: 'No background' },

  'file.dropHere': {
    pt: 'Arraste o ficheiro para aqui',
    en: 'Drag the file here',
  },
  'file.formats': {
    pt: 'CSV, TXT, XLSX, XLS, ODS, KML, KMZ, GeoJSON, GPX',
    en: 'CSV, TXT, XLSX, XLS, ODS, KML, KMZ, GeoJSON, GPX',
  },
  'file.noticeSkipped': {
    pt: '{count} elementos do ficheiro não são pontos (linhas, polígonos) e não '
      + 'foram lidos.',
    ptOne: 'Um elemento do ficheiro não é um ponto e não foi lido.',
    en: '{count} elements in the file are not points (lines, polygons) and were '
      + 'not read.',
    enOne: 'One element in the file is not a point and was not read.',
  },
  'file.noticeGpxTrack': {
    pt: 'O ficheiro não tem pontos marcados, por isso foram lidos os {count} '
      + 'pontos do percurso.',
    ptOne: 'O ficheiro não tem pontos marcados, por isso foi lido o único ponto do percurso.',
    en: 'The file has no marked waypoints, so its {count} track points were read.',
    enOne: 'The file has no marked waypoints, so its one track point was read.',
  },
  'file.noticeGpxRoute': {
    pt: 'O ficheiro não tem pontos marcados, por isso foram lidos os {count} '
      + 'pontos da rota.',
    ptOne: 'O ficheiro não tem pontos marcados, por isso foi lido o único ponto da rota.',
    en: 'The file has no marked waypoints, so its {count} route points were read.',
    enOne: 'The file has no marked waypoints, so its one route point was read.',
  },
  'file.noticeGpxIgnored': {
    pt: 'Foram lidos os pontos marcados. O ficheiro tem também {count} pontos de '
      + 'percurso ou rota, que não foram lidos.',
    ptOne: 'Foram lidos os pontos marcados. O ficheiro tem também um ponto de '
      + 'percurso ou rota, que não foi lido.',
    en: 'The marked waypoints were read. The file also holds {count} track or '
      + 'route points, which were not.',
    enOne: 'The marked waypoints were read. The file also holds one track or '
      + 'route point, which was not.',
  },
  'file.noticeGeoCrs': {
    pt: 'O ficheiro declara o sistema {crs}, por isso as suas coordenadas são '
      + 'metros e não graus.',
    en: 'The file declares the {crs} system, so its coordinates are metres '
      + 'rather than degrees.',
  },
  'file.choose': { pt: 'Escolher ficheiro', en: 'Choose file' },
  'file.paste': { pt: 'Colar do Excel', en: 'Paste from Excel' },
  'file.pasteLabel': {
    pt: 'Cole aqui as células copiadas, com a linha de cabeçalho',
    en: 'Paste the copied cells here, including the header row',
  },
  'file.pasteRead': { pt: 'Ler o que está colado', en: 'Read what is pasted' },

  'file.sidebarLabel': { pt: 'Ficheiro e opções', en: 'File and options' },
  'file.rowsCols': {
    pt: '{n} linhas, {cols} colunas',
    ptOne: '{n} linha, {cols} colunas',
    en: '{n} rows, {cols} columns',
    enOne: '{n} row, {cols} columns',
  },
  'file.loaded': {
    pt: '{name} — {n} linhas, {cols} colunas',
    ptOne: '{name} — {n} linha, {cols} colunas',
    en: '{name} — {n} rows, {cols} columns',
    enOne: '{name} — {n} row, {cols} columns',
  },
  'file.sheet': { pt: 'Folha', en: 'Sheet' },
  'file.separator': { pt: 'Separador', en: 'Separator' },
  'file.sepAuto': { pt: 'Detectar', en: 'Detect' },
  'file.sepComma': { pt: 'Vírgula  ,', en: 'Comma  ,' },
  'file.sepSemicolon': { pt: 'Ponto e vírgula  ;', en: 'Semicolon  ;' },
  'file.sepTab': { pt: 'Tabulação', en: 'Tab' },
  'file.sepPipe': { pt: 'Barra vertical  |', en: 'Pipe  |' },

  'file.errEmpty': {
    pt: 'O ficheiro não tem colunas legíveis. Confirme o separador ou a folha escolhida.',
    en: 'The file has no readable columns. Check the separator or the chosen sheet.',
  },
  'file.errTooLarge': {
    pt: 'O ficheiro é grande demais para abrir no navegador: {actual} {kind}, '
      + 'contra um limite de {limit}. Divida-o e converta por partes.',
    en: 'The file is too large to open in the browser: {actual} {kind}, against '
      + 'a limit of {limit}. Split it and convert it in parts.',
  },
  'file.unitCells': { pt: 'células', en: 'cells' },
  'file.unitBytes': { pt: 'depois de descomprimido', en: 'once decompressed' },
  'file.noticeEmptySheet': {
    pt: 'Esta folha não tem dados. Escolha outra folha acima.',
    en: 'This sheet has no data. Choose another sheet above.',
  },
  'file.noticeLarge': {
    pt: '{n} linhas — a conversão pode demorar alguns segundos e usar bastante memória.',
    en: '{n} rows — converting may take a few seconds and a good deal of memory.',
  },
  'file.errRead': {
    pt: 'Não foi possível ler o ficheiro: {message}',
    en: 'The file could not be read: {message}',
  },

  'file.latColumn': { pt: 'Coluna da latitude', en: 'Latitude column' },
  'file.lonColumn': { pt: 'Coluna da longitude', en: 'Longitude column' },
  'file.region': { pt: 'Região esperada', en: 'Expected region' },

  // The regions are keys of REGION_MASKS, and those keys are data: they are in
  // the parity contract, in app.py and in both test suites, so they stay as
  // they are. What was wrong is that they were also the text on screen, in
  // whatever language each happened to have been written in - so Portuguese
  // showed "Azores" and "Portugal mainland" while English showed "Moçambique"
  // and "Guiné-Bissau". Half of them were wrong in each language. The key is
  // the identifier; this is the name.
  'region.Portugal mainland': { pt: 'Portugal Continental', en: 'Mainland Portugal' },
  'region.Azores': { pt: 'Açores', en: 'Azores' },
  'region.Madeira': { pt: 'Madeira', en: 'Madeira' },
  'region.Angola': { pt: 'Angola', en: 'Angola' },
  'region.Cabo Verde': { pt: 'Cabo Verde', en: 'Cape Verde' },
  'region.Guiné-Bissau': { pt: 'Guiné-Bissau', en: 'Guinea-Bissau' },
  'region.Moçambique': { pt: 'Moçambique', en: 'Mozambique' },
  'region.São Tomé e Príncipe': {
    pt: 'São Tomé e Príncipe',
    en: 'São Tomé and Príncipe',
  },
  'file.regionAuto': {
    pt: 'Automático (maior agrupamento)',
    en: 'Automatic (largest cluster)',
  },
  'file.decimals': { pt: 'Casas decimais', en: 'Decimal places' },
  'file.addDms': {
    pt: 'Acrescentar colunas em graus, minutos e segundos',
    en: 'Add degrees-minutes-seconds columns',
  },

  'file.applyRegionSign': {
    pt: 'Dar o sinal de {region} a {n} valores sem hemisfério',
    ptOne: 'Dar o sinal de {region} a um valor sem hemisfério',
    en: 'Take the sign of {region} for {n} values with no hemisphere',
    enOne: 'Take the sign of {region} for one value with no hemisphere',
  },

  'file.status.ok': { pt: 'convertidas', en: 'converted' },
  'file.status.swap_axis': {
    pt: 'troca certa (a letra do hemisfério contradiz a coluna)',
    en: 'certain swap (the hemisphere letter contradicts the column)',
  },
  'file.status.swap_range': {
    pt: 'possível troca (fora do intervalo)',
    en: 'possible swap (out of range)',
  },
  'file.status.swap_cluster': {
    pt: 'possível troca (fora do sítio)',
    en: 'possible swap (out of place)',
  },
  // The closed result card counts the rows still waiting for an answer.
  'file.toReview': { pt: 'a rever', en: 'to review' },
  'file.status.out_of_range': { pt: 'fora do intervalo válido', en: 'out of valid range' },
  'file.status.missing': { pt: 'ilegíveis', en: 'unreadable' },

  // The chosen region is named rather than referred to. "Outside the chosen
  // region" is true of a file in Angola and of a file in the sea, and the
  // reader cannot tell which without knowing what was chosen - which, until
  // they touch the picker, is whatever the application chose for them.
  'file.outsideNamed': {
    pt: '{n} coordenadas válidas caem em {region}, não em {chosen}.',
    ptOne: 'Uma coordenada válida cai em {region}, não em {chosen}.',
    en: '{n} valid coordinates fall in {region}, not in {chosen}.',
    enOne: 'One valid coordinate falls in {region}, not in {chosen}.',
  },
  'file.outsideUnknown': {
    pt: '{n} coordenadas válidas caem fora de {chosen} e de todas as regiões conhecidas.',
    ptOne: 'Uma coordenada válida cai fora de {chosen} e de todas as regiões conhecidas.',
    en: '{n} valid coordinates fall outside {chosen} and every known region.',
    enOne: 'One valid coordinate falls outside {chosen} and every known region.',
  },
  // The question, put rather than answered: the problem, then what one sign
  // would do about it, then the button. It replaces the plain outside-region
  // notice rather than following it - they were saying the same thing in two
  // stacked boxes.
  //
  // No disclaimer about who really knows where the data was collected. The
  // button says that already: it is an offer, not a correction, and nothing
  // moves until it is pressed. Spelling it out was preaching.
  //
  // The sign stays in the sentence. These values are not in Moçambique as
  // written - they are in Sudan - and it is the flip that puts them there. A
  // reader who is not told that cannot judge the offer.
  'file.suggestRegion': {
    pt: 'Estes valores caem fora de {chosen}.',
    en: 'These values fall outside {chosen}.',
  },
  // "e de todas as regiões conhecidas" was in this sentence and was false on
  // its face: the region offered on the next line is a known region. It was
  // only true of the values *as written*, and saying so made the sentence
  // heavier than the fact was worth.
  //
  // "Se forem" carries the uncertainty that the application actually has, which
  // is why no disclaimer is needed after it. And "dentro da região" rather than
  // "dentro do país": the Azores and Madeira can both be suggested - an Azores
  // file written without the W on its longitudes is exactly this case - and
  // neither is a country.
  'file.suggestRegionFit': {
    pt: 'Se forem coordenadas de {region}, os {readable} registos ficam dentro da região.',
    en: 'If these are {region} coordinates, all {readable} records fall inside the region.',
  },
  'file.suggestRegionFitSome': {
    pt: 'Se forem coordenadas de {region}, {inside} dos {readable} registos ficam '
      + 'dentro da região.',
    en: 'If these are {region} coordinates, {inside} of the {readable} records fall '
      + 'inside the region.',
  },
  'file.suggestRegionUse': { pt: 'Usar {region}', en: 'Use {region}' },

  // The kilometre offer. The first line is file.suggestRegion above - the fact
  // is the same one, the file is not where it says it is - and only the second
  // differs, because here the application is not guessing at a place. It has a
  // system, a region, and one factor that would reconcile them.
  //
  // "Se estiverem" and not "Se forem": what is in question is the unit the
  // values were written in, not what they are.
  'file.suggestScaleFit': {
    pt: 'Se estiverem em quilómetros e não em metros, os {readable} registos '
      + 'ficam dentro da região.',
    en: 'If they are in kilometres rather than metres, all {readable} records '
      + 'fall inside the region.',
  },
  'file.suggestScaleFitSome': {
    pt: 'Se estiverem em quilómetros e não em metros, {inside} dos {readable} '
      + 'registos ficam dentro da região.',
    en: 'If they are in kilometres rather than metres, {inside} of the {readable} '
      + 'records fall inside the region.',
  },
  'file.suggestScaleUse': { pt: 'Ler como quilómetros', en: 'Read as kilometres' },
  // Once taken, the offer has to stay visible and stay reversible: multiplying
  // a column by a thousand is not something to leave a reader to infer from
  // the numbers.
  'file.scaleOn': {
    pt: 'A ler os valores como quilómetros: multiplicados por 1000 antes de converter.',
    en: 'Reading the values as kilometres: multiplied by 1000 before converting.',
  },
  'file.scaleOff': { pt: 'Ler como metros', en: 'Read as metres' },

  'file.swapsFound': {
    pt: '{n} linhas parecem ter a latitude e a longitude trocadas.',
    ptOne: 'Uma linha parece ter a latitude e a longitude trocadas.',
    en: '{n} rows look like their latitude and longitude are swapped.',
    enOne: 'One row looks like its latitude and longitude are swapped.',
  },
  'file.swapsHint': {
    pt: 'Nada é alterado sem a sua confirmação. Escolha as linhas a inverter.',
    en: 'Nothing is changed without your confirmation. Pick the rows to invert.',
  },
  'file.swapAll': { pt: 'Inverter todas', en: 'Invert all' },
  'file.swapNone': { pt: 'Não inverter nenhuma', en: 'Invert none' },
  'file.swapChosen': { pt: '{n} escolhidas', en: '{n} chosen' },
  'file.rowN': { pt: 'linha {n}', en: 'row {n}' },

  'file.valid': { pt: 'Pontos válidos', en: 'Valid points' },
  'file.latRange': { pt: 'Latitude', en: 'Latitude' },
  'file.lonRange': { pt: 'Longitude', en: 'Longitude' },
  'file.centroid': { pt: 'Centróide', en: 'Centroid' },
  'file.stepLabel': { pt: 'Passo {n}: {title}', en: 'Step {n}: {title}' },

  // Read out after a row number, so these are singular and adjectival where
  // file.status.* are the plural nouns the counts line needs.
  'file.rowStatus.ok': { pt: 'convertida', en: 'converted' },
  'file.rowStatus.swap_axis': {
    pt: 'troca certa, a letra do hemisfério contradiz a coluna',
    en: 'certain swap, the hemisphere letter contradicts the column',
  },
  'file.rowStatus.swap_range': {
    pt: 'possível troca, fora do intervalo como está',
    en: 'possible swap, out of range as written',
  },
  'file.rowStatus.swap_cluster': {
    pt: 'possível troca, fora do sítio',
    en: 'possible swap, out of place',
  },
  'file.rowStatus.out_of_range': {
    pt: 'fora do intervalo válido',
    en: 'out of the valid range',
  },
  'file.rowStatus.missing': { pt: 'ilegível', en: 'unreadable' },

  'file.rowHeader': { pt: 'Linha', en: 'Row' },
  'file.tableRegion': {
    pt: 'Tabela de resultados, deslocável na horizontal',
    en: 'Results table, scrolls horizontally',
  },
  'file.tableCaption': {
    pt: 'Resultados da conversão: a mostrar {shown} de {total} linhas. '
      + 'A primeira coluna de cada linha diz o estado da conversão.',
    en: 'Conversion results: showing {shown} of {total} rows. The first column '
      + 'of each row gives the conversion status.',
  },
  'file.tableHeading': { pt: 'Tabela', en: 'Table' },
  // The table holds every row now - only the rows in view are drawn.
  'file.tableAll': {
    pt: 'Todas as linhas. Clicar numa linha mostra-a no mapa.',
    en: 'Every row. Click a row to see it on the map.',
  },
  'file.searchPlaceholder': { pt: 'Procurar (nome, folha, nº da linha…)', en: 'Search (name, sheet, row number…)' },
  'file.searchLabel': { pt: 'Procurar na tabela', en: 'Search the table' },
  'file.filterLabel': { pt: 'Que linhas mostrar', en: 'Which rows to show' },
  'file.filterAll': { pt: 'Todas', en: 'All' },
  'file.filterReview': { pt: 'A rever ({n})', en: 'To review ({n})' },
  'file.filterSheetLabel': { pt: 'Só uma folha 1:25 000', en: 'Only one 1:25 000 sheet' },
  'file.filterSheetAll': { pt: 'Folha 1:25 000: todas', en: '1:25 000 sheet: all' },
  'file.filterSheetOne': { pt: 'Folha {sheet}', en: 'Sheet {sheet}' },
  'file.rowsOf': { pt: '{n} de {total} linhas', en: '{n} of {total} rows' },

  'file.xlsxHint': { pt: 'todas as linhas', en: 'every row' },
  'file.csvHint': { pt: 'todas as linhas', en: 'every row' },
  'file.gisHint': { pt: 'só as válidas', en: 'valid rows only' },
  'file.kmlHint': { pt: 'Google Earth', en: 'Google Earth' },
  'file.shpHint': { pt: 'zip para SIG', en: 'zip for GIS' },
  'file.gpxHint': { pt: 'GPS de mão', en: 'handheld GPS' },
  'file.exportNote': {
    pt: 'WGS84 / EPSG:4326. O CSV leva todas as linhas, incluindo as que falharam; '
      + 'os formatos SIG levam apenas os pontos com coordenadas válidas.',
    en: 'WGS84 / EPSG:4326. The CSV carries every row, failures included; the GIS '
      + 'formats carry only the points with valid coordinates.',
  },

  'crs.input': { pt: 'Sistema do ficheiro', en: 'System the file is in' },
  'crs.output': { pt: 'Sistema adicional na saída', en: 'Extra system in the output' },
  'crs.none': { pt: 'Nenhum — só WGS84', en: 'None — WGS84 only' },
  'crs.geographic': { pt: 'Geográficos (graus)', en: 'Geographic (degrees)' },
  'crs.projected': { pt: 'Projetados (metros)', en: 'Projected (metres)' },
  'crs.generic': { pt: 'Genéricos', en: 'Generic' },
  'crs.utm': { pt: 'UTM por zona…', en: 'UTM by zone…' },
  'crs.custom': { pt: 'Definição proj4 colada…', en: 'Pasted proj4 definition…' },
  'crs.deprecated': { pt: 'depreciado', en: 'deprecated' },
  'crs.utmZone': { pt: 'Zona UTM', en: 'UTM zone' },
  'crs.utmSouth': { pt: 'Hemisfério sul', en: 'Southern hemisphere' },
  'crs.customLabel': {
    pt: 'Definição proj4 (funciona sem ligação; cobre qualquer sistema não listado)',
    en: 'proj4 definition (works offline; covers any system not listed)',
  },
  'crs.xColumn': { pt: 'Coluna X (Este, metros)', en: 'X column (Easting, metres)' },
  'crs.yColumn': { pt: 'Coluna Y (Norte, metros)', en: 'Y column (Northing, metres)' },
  'crs.errTransform': {
    pt: 'Não foi possível transformar as coordenadas: {message}',
    en: 'The coordinates could not be transformed: {message}',
  },
  'crs.converting': { pt: 'A converter…', en: 'Converting…' },
  'file.doneCounts': {
    pt: 'Conversão terminada: {n} linhas, {ok} convertidas, '
      + '{swap} a rever, {bad} sem coordenada válida.',
    en: 'Conversion finished: {n} rows, {ok} converted, '
      + '{swap} to review, {bad} with no valid coordinate.',
  },

  'file.tabFile': { pt: 'Ficheiro', en: 'File' },
  'file.tabQuick': { pt: 'Uma coordenada', en: 'Single coordinate' },

  // ------------------------------------------------------------ map sheets
  // The registry's notes are written in English; the page says them in the
  // reader's language.
  'crs.note.20790': {
    pt: 'Conhecido em Portugal como Hayford-Gauss Militar; a EPSG chama-lhe "Lisbon (Lisbon) / Portuguese National Grid". Passa a ETRS89 pela grelha NTv2 da DGT, a cerca de 0,1 m; fora da grelha, pelos sete parâmetros da DGT.',
    en: 'Known in Portugal as Hayford-Gauss Militar; EPSG names it "Lisbon (Lisbon) / Portuguese National Grid". Moved onto ETRS89 by DGT\'s NTv2 grid, to about 0.1 m; outside the grid, by DGT\'s seven parameters.',
  },
  'crs.note.27493': {
    pt: 'Conhecido em Portugal como Hayford-Gauss IPCC ou Datum 73. Passa a ETRS89 pela grelha NTv2 da DGT, a cerca de 0,1 m; fora da grelha, pelos sete parâmetros da DGT.',
    en: 'Known in Portugal as Hayford-Gauss IPCC or Datum 73. Moved onto ETRS89 by DGT\'s NTv2 grid, to about 0.1 m; outside the grid, by DGT\'s seven parameters.',
  },
  'crs.note.2191': {
    pt: 'A EPSG retirou este código por duplicar Porto Santo 1936 (2942): é o mesmo datum Base SE, com os mesmos parâmetros da DGT. Prefira 2942 ou, melhor, PTRA08 (5016).',
    en: 'EPSG retired this code as a duplicate of Porto Santo 1936 (2942): the same Base SE datum, and the same DGT parameters. Prefer 2942 or, better, PTRA08 (5016).',
  },

  // How each Portuguese datum is moved onto ETRS89. The registry says it in
  // English; the page says it in the reader's language.
  'crs.transformation.20790': {
    pt: "grelha NTv2 da DGT DLx_ETRS89_geo: resíduo médio 0,09 m, máximo 0,30 m; fora da grelha, sete parâmetros da DGT (1,4 m)",
    en: "DGT's NTv2 grid DLx_ETRS89_geo: mean residual 0.09 m, max 0.30 m; outside the grid, DGT's seven parameters (1.4 m)",
  },
  'crs.transformation.27493': {
    pt: "grelha NTv2 da DGT D73_ETRS89_geo: resíduo médio 0,06 m, máximo 0,16 m; fora da grelha, sete parâmetros da DGT (0,4 m)",
    en: "DGT's NTv2 grid D73_ETRS89_geo: mean residual 0.06 m, max 0.16 m; outside the grid, DGT's seven parameters (0.4 m)",
  },
  'crs.transformation.2188': {
    pt: "sete parâmetros da DGT, grupo ocidental: 0,03 m",
    en: "DGT's seven parameters, western group: 0.03 m",
  },
  'crs.transformation.2189': {
    pt: "sete parâmetros da DGT, grupo central: 0,18 m",
    en: "DGT's seven parameters, central group: 0.18 m",
  },
  'crs.transformation.2190': {
    pt: "sete parâmetros da DGT, grupo oriental: 0,02 m",
    en: "DGT's seven parameters, eastern group: 0.02 m",
  },
  'crs.transformation.2191': {
    pt: "sete parâmetros da DGT, Base SE: 0,05 m",
    en: "DGT's seven parameters, Base SE: 0.05 m",
  },
  'crs.transformation.2942': {
    pt: "sete parâmetros da DGT, Base SE: 0,05 m",
    en: "DGT's seven parameters, Base SE: 0.05 m",
  },
  'crs.transformation.3061': {
    pt: "sete parâmetros da DGT, Base SE: 0,05 m",
    en: "DGT's seven parameters, Base SE: 0.05 m",
  },

  // ------------------------------------------------- what a download records
  // Written into the files themselves (core/provenance.js), not shown on the page.
  'meta.app': { pt: 'Convertido com', en: 'Converted with' },
  'meta.date': { pt: 'Data da conversão', en: 'Converted on' },
  'meta.file': { pt: 'Ficheiro de origem', en: 'Source file' },
  'meta.fileSheet': { pt: '{name}, folha {sheet}', en: '{name}, sheet {sheet}' },
  'meta.input': { pt: 'Sistema de origem', en: 'Source system' },
  'meta.transformation': { pt: 'Transformação para WGS 84', en: 'Transformation to WGS 84' },
  'meta.source': { pt: 'Fonte da transformação', en: 'Source of the transformation' },
  'meta.proj4': { pt: 'Definição proj4', en: 'proj4 definition' },
  'meta.noShift': { pt: 'nenhuma: já em WGS 84', en: 'none: already WGS 84' },
  'meta.asWgs84': {
    pt: 'ETRS89 / PTRA08 tomado como WGS 84 (diferença inferior a 1 m)',
    en: 'ETRS89 / PTRA08 taken as WGS 84 (under 1 m apart)',
  },
  'meta.ownShift': { pt: 'a da própria definição', en: "the definition's own" },
  'meta.km': { pt: 'Unidade lida', en: 'Unit read' },
  'meta.kmValue': { pt: 'quilómetros (valores multiplicados por 1000)', en: 'kilometres (values multiplied by 1000)' },
  'meta.azores': { pt: 'Linhas noutro sistema', en: 'Rows in another system' },
  'meta.azoresValue': {
    pt: '{n} linhas lidas em {system}', ptOne: '{n} linha lida em {system}',
    en: '{n} rows read in {system}', enOne: '{n} row read in {system}',
  },
  'meta.fixes': { pt: 'Correções aceites', en: 'Corrections accepted' },
  'meta.swaps': {
    pt: '{n} linhas com latitude e longitude trocadas', ptOne: '{n} linha com latitude e longitude trocadas',
    en: '{n} rows with latitude and longitude swapped', enOne: '{n} row with latitude and longitude swapped',
  },
  'meta.sheetFixes': {
    pt: '{n} linhas corrigidas pela folha', ptOne: '{n} linha corrigida pela folha',
    en: '{n} rows corrected by their sheet', enOne: '{n} row corrected by its sheet',
  },
  'meta.degrees': { pt: 'Graus e geometria', en: 'Degrees and geometry' },
  'meta.degreesValue': {
    pt: 'Latitude_DD, Longitude_DD e a geometria em WGS 84 (EPSG:4326)',
    en: 'Latitude_DD, Longitude_DD and the geometry in WGS 84 (EPSG:4326)',
  },
  'meta.output': { pt: 'Sistema adicional', en: 'Extra system' },
  'meta.outputValue': {
    pt: '{system}, nas colunas {x} e {y}; a partir de WGS 84: {how}',
    en: '{system}, in columns {x} and {y}; from WGS 84: {how}',
  },

  'sheet.col25': { pt: 'Folha 1:25 000 (carta militar)', en: '1:25 000 sheet (military map)' },
  'sheet.col50': { pt: 'Folha 1:50 000 (carta geológica)', en: '1:50 000 sheet (geological map)' },
  'sheet.colNone': { pt: '— nenhuma —', en: '— none —' },
  'sheet.labelCols': { pt: 'Identificar cada ponto por', en: 'Name each point by' },
  'sheet.labelSecond': { pt: 'Segunda coluna do nome', en: 'Second name column' },
  'sheet.labelNone': { pt: '— nada —', en: '— nothing —' },
  'sheet.source': { pt: 'Posição das folhas: {source}.', en: 'Sheet positions: {source}.' },
  'sheet.summary': { pt: 'folhas: {cols}', en: 'sheets: {cols}' },

  'sheet.statOk': { pt: 'na sua folha', en: 'in their sheet' },
  'sheet.statFix': { pt: 'a corrigir', en: 'to correct' },
  'sheet.statFixed': { pt: 'corrigidas', en: 'corrected' },
  'sheet.statCheck': { pt: 'a confirmar', en: 'to confirm' },

  'sheet.fixesFound': {
    pt: '{n} linhas estão fora da sua folha, com uma correção segura',
    ptOne: 'Uma linha está fora da sua folha, com uma correção segura',
    en: '{n} rows are outside their sheet, with a safe correction',
    enOne: 'One row is outside its sheet, with a safe correction',
  },
  'sheet.fixesChosen': { pt: '{n} corrigidas', ptOne: '1 corrigida', en: '{n} corrected', enOne: '1 corrected' },
  'sheet.fixesHint': {
    pt: 'Nada muda sem confirmação. Clicar numa linha mostra-a no mapa, com a posição corrigida.',
    en: 'Nothing changes without your confirmation. Click a row to see it on the map, with the corrected position.',
  },
  'sheet.fixAll': { pt: 'Corrigir todas', en: 'Correct all' },
  'sheet.gateHint': {
    pt: 'Responda primeiro às correções das folhas: corrigir, ou não corrigir.',
    en: 'Answer the sheet corrections first: correct them, or do not.',
  },
  'sheet.fixNone': { pt: 'Não corrigir', en: 'Do not correct' },
  'sheet.checksFound': {
    pt: '{n} linhas para confirmar no relatório',
    ptOne: 'Uma linha para confirmar no relatório',
    en: '{n} rows to confirm against the report',
    enOne: 'One row to confirm against the report',
  },
  'sheet.checksNote': { pt: 'não bloqueiam as descargas', en: 'these do not hold the downloads' },
  'sheet.declared25': { pt: 'folha {sheet}', en: 'sheet {sheet}' },
  'sheet.declared50': { pt: 'folha 1:50 000 {sheet}', en: '1:50 000 sheet {sheet}' },

  'sheet.fix.swap': { pt: '{x} e {y} trocados', en: '{x} and {y} swapped' },
  'sheet.fix.origin-p': {
    pt: '{y} sem os 300 km da origem falsa', en: '{y} without the 300 km of false northing',
  },
  'sheet.fix.origin-m': {
    pt: '{x} sem os 200 km da origem falsa', en: '{x} without the 200 km of false easting',
  },
  'sheet.fix.origin-both': {
    pt: '{x} e {y} sem a origem falsa', en: '{x} and {y} without the false origin',
  },
  'sheet.digit': {
    pt: '{axis} com um algarismo errado? Assim o ponto cai na folha {sheet}',
    en: '{axis} with one wrong digit? That puts the point in sheet {sheet}',
  },
  'sheet.number': {
    pt: 'nº da folha errado? As coordenadas caem na folha {sheet}, na 1:50 000 {s50} ({name}), que é o nome escrito na linha',
    en: 'wrong sheet number? The coordinates fall in sheet {sheet}, in 1:50 000 sheet {s50} ({name}), the name the row gives',
  },
  'sheet.off': {
    pt: 'a {km} km da folha {sheet}; {where}. Sem explicação simples',
    en: '{km} km from sheet {sheet}; {where}. No simple explanation',
  },
  'sheet.at': {
    pt: 'as coordenadas caem na folha {sheet} (1:50 000 {s50}, {name})',
    en: 'the coordinates fall in sheet {sheet} (1:50 000 {s50}, {name})',
  },
  'sheet.atNone': { pt: 'as coordenadas não caem em nenhuma folha', en: 'the coordinates fall in no sheet' },
  'sheet.tag.fix': { pt: 'corrigir', en: 'correct' },
  'sheet.tag.digit': { pt: 'algarismo', en: 'digit' },
  'sheet.tag.number': { pt: 'nº da folha', en: 'sheet no.' },
  'sheet.tag.check': { pt: 'verificar', en: 'check' },

  'sheet.rowStatus.fix': { pt: 'fora da folha, correção por responder', en: 'outside its sheet, correction unanswered' },
  'sheet.rowStatus.fixed': { pt: 'corrigida', en: 'corrected' },
  'sheet.rowStatus.check': { pt: 'fora da folha, a confirmar', en: 'outside its sheet, to confirm' },
  'sheet.rowStatus.azores': { pt: 'Açores, por converter', en: 'Azores, not yet converted' },

  'sheet.verdictOk': { pt: 'ok', en: 'ok' },
  'sheet.verdictFixed': { pt: 'corrigido: {what}', en: 'corrected: {what}' },
  'sheet.verdictNotFixed': { pt: 'não corrigido: {what}', en: 'not corrected: {what}' },
  'sheet.verdictCheck': { pt: 'a confirmar: {what}', en: 'to confirm: {what}' },
  'sheet.verdictAzores': { pt: 'Açores, convertido como EPSG:{system}', en: 'Azores, converted as EPSG:{system}' },
  'sheet.verdictAzoresPending': { pt: 'Açores, por converter', en: 'Azores, not converted' },

  'sheet.pp25': { pt: 'Folha', en: 'Sheet' },
  'sheet.pp50': { pt: '1:50 000', en: '1:50 000' },
  'sheet.ppFile': { pt: 'No ficheiro', en: 'In the file' },
  'sheet.ppFixed': { pt: 'Corrigido', en: 'Corrected' },
  'sheet.ppConverted': { pt: 'Convertido', en: 'Converted' },
  'sheet.ppOk': { pt: '✓ Na folha {sheet}', en: '✓ In sheet {sheet}' },
  'sheet.ppFixedNow': { pt: '✓ Corrigido ({what}): agora na folha {sheet}', en: '✓ Corrected ({what}): now in sheet {sheet}' },
  'sheet.ppAzores': { pt: 'Açores, em UTM 26 — por converter', en: 'Azores, in UTM 26 — not converted' },

  // Rows in the Azores' UTM grid inside a file in the mainland's grid.
  'sheet.azoresFound': {
    pt: '{n} linhas ({rows}) não são da quadrícula do ficheiro: os valores são UTM das ilhas dos Açores. Ficaram por converter.',
    ptOne: 'A linha {rows} não é da quadrícula do ficheiro: os valores são UTM das ilhas dos Açores. Ficou por converter.',
    en: "{n} rows ({rows}) are not in the file's grid: the values are the Azores' UTM. They were left unconverted.",
    enOne: "Row {rows} is not in the file's grid: the values are the Azores' UTM. It was left unconverted.",
  },
  'sheet.azoresDone': {
    pt: '{n} linhas convertidas como Açores: {system}.',
    ptOne: 'Uma linha convertida como Açores: {system}.',
    en: '{n} rows converted as the Azores: {system}.',
    enOne: 'One row converted as the Azores: {system}.',
  },
  'sheet.azoresUse': {
    pt: 'Converter estas {n} como Açores', ptOne: 'Converter esta como Açores',
    en: 'Convert these {n} as the Azores', enOne: 'Convert it as the Azores',
  },
  'sheet.azoresUndo': { pt: 'Desfazer', en: 'Undo' },
  'sheet.azoresSystem': { pt: 'Sistema dos Açores', en: 'Azores system' },
}
