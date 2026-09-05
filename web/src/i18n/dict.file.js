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
  'file.step4': { pt: 'Descarregar', en: 'Download' },

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

  'file.status.ok': { pt: 'convertidas', en: 'converted' },
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
  'file.previewNote': {
    pt: 'A mostrar as primeiras {shown} de {total} linhas. O ficheiro descarregado leva todas.',
    en: 'Showing the first {shown} of {total} rows. The downloaded file carries all of them.',
  },

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

  'file.tabFile': { pt: 'Ficheiro', en: 'File' },
  'file.tabQuick': { pt: 'Uma coordenada', en: 'Single coordinate' },
}
