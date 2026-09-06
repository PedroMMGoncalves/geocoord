/**
 * Dictionary for the file conversion flow: reading, column choice, the
 * results table and the downloads.
 */
export default {
  'file.title': {
    pt: 'Converter um ficheiro',
    en: 'Convert a file',
  },
  'file.intro': {
    pt: 'Arraste uma folha de cálculo ou um CSV. O ficheiro é lido e convertido no seu '
      + 'navegador — nada é enviado para nenhum servidor.',
    en: 'Drop a spreadsheet or a CSV. The file is read and converted in your browser — '
      + 'nothing is sent to any server.',
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
    pt: 'CSV, TXT, XLSX, XLS, ODS',
    en: 'CSV, TXT, XLSX, XLS, ODS',
  },
  'file.choose': { pt: 'Escolher ficheiro', en: 'Choose file' },
  'file.paste': { pt: 'Colar do Excel', en: 'Paste from Excel' },
  'file.pasteLabel': {
    pt: 'Cole aqui as células copiadas, com a linha de cabeçalho',
    en: 'Paste the copied cells here, including the header row',
  },
  'file.pasteRead': { pt: 'Ler o que está colado', en: 'Read what is pasted' },

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
  'file.status.out_of_range': { pt: 'fora do intervalo válido', en: 'out of valid range' },
  'file.status.missing': { pt: 'ilegíveis', en: 'unreadable' },

  'file.outsideNamed': {
    pt: '{n} coordenadas válidas caem em {region}, não na região escolhida.',
    ptOne: 'Uma coordenada válida cai em {region}, não na região escolhida.',
    en: '{n} valid coordinates fall in {region}, not in the chosen region.',
    enOne: 'One valid coordinate falls in {region}, not in the chosen region.',
  },
  'file.outsideUnknown': {
    pt: '{n} coordenadas válidas caem fora da região escolhida e de todas as regiões conhecidas.',
    ptOne: 'Uma coordenada válida cai fora da região escolhida e de todas as regiões conhecidas.',
    en: '{n} valid coordinates fall outside the chosen region and every known region.',
    enOne: 'One valid coordinate falls outside the chosen region and every known region.',
  },

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
  'file.previewAll': {
    pt: 'A mostrar as {n} linhas. O ficheiro descarregado leva as mesmas.',
    ptOne: 'Uma linha.',
    en: 'Showing all {n} rows. The downloaded file carries the same.',
    enOne: 'One row.',
  },
  'file.previewNote': {
    pt: 'A mostrar as primeiras {shown} de {total} linhas. O ficheiro descarregado leva todas.',
    en: 'Showing the first {shown} of {total} rows. The downloaded file carries all of them.',
  },

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
}
