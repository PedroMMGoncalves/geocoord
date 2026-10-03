// @vitest-environment jsdom
//
// The invariants of the file tab that cost data if they break.
//
// Everything else in this suite tests a pure function. This file drives the
// component, because the things it pins are not in any function: they are in
// the wiring, and the wiring is what a refactor moves. Chief among them is the
// review gate - while a row is flagged as possibly swapped, the downloads wait -
// which is the one thing standing between a hurried user and a file with its
// latitude and longitude the wrong way round. Until now it was verified only by
// hand, in a browser, by a script that CI never runs.
//
// The map is mocked. It is the one part that fetches something (Leaflet, its
// stylesheet, then tiles), it has no bearing on any of these invariants, and
// leaving it in would make the suite slow and dependent on a network.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// The map is replaced by a list of its points, one button each, so a test can
// see what each point is called and click one the way a user clicks the map.
vi.mock('../src/components/PointsMap.jsx', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ points, selected, onSelect }) => createElement('div', { 'data-testid': 'map', 'data-selected': selected ?? '' },
      points.map((p) => createElement('button', {
        key: p.row, type: 'button', 'data-point': p.row, onClick: () => onSelect?.(p.row, 'map'),
      }, p.label || `#${p.row + 1}`))),
    COLOR_OK: '#0072B2',
    COLOR_SUSPECT: '#D55E00',
    COLOR_FIXED: '#34d399',
  }
})

const { default: FileConvert } = await import('../src/components/FileConvert.jsx')
const { LangContext } = await import('../src/i18n.jsx')
const { createElement } = await import('react')
const { sheet25Boxes } = await import('../src/core/sheets.js')

beforeAll(() => {
  // jsdom has no File.arrayBuffer, which is how the component reads a drop.
  if (!File.prototype.arrayBuffer) {
    File.prototype.arrayBuffer = function arrayBuffer() {
      return new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.readAsArrayBuffer(this)
      })
    }
  }
})

afterEach(cleanup)

const show = (lang = 'pt') => render(
  createElement(LangContext.Provider, { value: lang }, createElement(FileConvert)),
)

/** Hand the component a CSV the way the file picker does. */
async function load(text, name = 'amostras.csv') {
  const input = document.querySelector('input[type=file]')
  const file = new File([text], name, { type: 'text/csv' })
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  fireEvent.change(input)
  // Wait on the card's own id rather than its title: the title is rendered
  // twice, once for a screen reader with its ordinal and once for the eye, so
  // matching it by text finds several elements and throws.
  await waitFor(() => expect(document.getElementById('card-3-h')).toBeTruthy(),
    { timeout: 8000 })
}

/** The card with this numeral, and whether it is open. */
const card = (n) => document.getElementById(`card-${n}-h`)
const isOpen = (n) => card(n).getAttribute('aria-expanded') === 'true'
const downloads = () => [...document.querySelectorAll('.dl .btn')]

// Eight rows around Lisbon, one of them written the other way round. Enough
// for detectSwaps to have a cluster to work from, and the odd one out lands
// back in the middle when its pair is reversed.
const NEAR_LISBON = [
  'nome,lat,lon',
  'A,38.7,-9.1',
  'B,38.8,-9.2',
  'C,38.6,-9.0',
  'D,38.75,-9.15',
  'E,38.72,-9.05',
  'F,38.68,-9.12',
  'G,38.71,-9.18',
  'H,-9.14,38.73',
].join('\n')

const CLEAN = [
  'nome,lat,lon',
  'A,38.7,-9.1',
  'B,38.8,-9.2',
  'C,38.6,-9.0',
  'D,38.75,-9.15',
  'E,38.72,-9.05',
  'F,38.68,-9.12',
].join('\n')

describe('the review gate', () => {
  it('holds the downloads while a row is waiting to be judged', async () => {
    show()
    await load(NEAR_LISBON)

    // The question is on screen...
    await waitFor(() => expect(document.querySelector('.rv')).toBeTruthy())
    expect(document.querySelector('.rv-h').textContent)
      .toMatch(/latitude e a longitude trocadas/)

    // ...and nothing can be taken until it is answered.
    const buttons = downloads()
    expect(buttons.length).toBe(6)
    expect(buttons.every((b) => b.disabled)).toBe(true)
    expect(document.querySelector('.card.gated')).toBeTruthy()
  })

  it('opens them when the answer is "invert them"', async () => {
    show()
    await load(NEAR_LISBON)
    await waitFor(() => expect(document.querySelector('.rv')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /Inverter todas/ }))

    await waitFor(() => expect(downloads().every((b) => !b.disabled)).toBe(true))
    expect(document.querySelector('.card.gated')).toBeNull()
  })

  it('opens them when the answer is "invert none"', async () => {
    // Declining is an answer. A user who has looked and decided the data is
    // right must not be left holding a page that will not give them the file.
    show()
    await load(NEAR_LISBON)
    await waitFor(() => expect(document.querySelector('.rv')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: /Não inverter nenhuma/ }))

    await waitFor(() => expect(downloads().every((b) => !b.disabled)).toBe(true))
  })

  it('opens them when a single row is ticked', async () => {
    show()
    await load(NEAR_LISBON)
    await waitFor(() => expect(document.querySelector('.rv')).toBeTruthy())

    const box = document.querySelector('.rv-b input[type=checkbox]')
    fireEvent.click(box)

    await waitFor(() => expect(downloads().every((b) => !b.disabled)).toBe(true))
  })

  it('never gates a file with nothing to review', async () => {
    show()
    await load(CLEAN)
    await waitFor(() => expect(downloads().length).toBe(6))
    expect(downloads().every((b) => !b.disabled)).toBe(true)
    expect(document.querySelector('.rv')).toBeNull()
  })
})

describe('the cards', () => {
  it('folds the file card and leaves the settings open', async () => {
    // 01 completes - nobody picks the same file twice. 02 is not a step, it is
    // where the work is tuned, and it is the first thing anyone returns to
    // after reading the result.
    show()
    await load(CLEAN)
    await waitFor(() => expect(isOpen(1)).toBe(false))
    expect(isOpen(2)).toBe(true)
  })

  it('leaves the settings open even after the result has been built', async () => {
    show()
    await load(CLEAN)
    await waitFor(() => expect(downloads().length).toBe(6))
    expect(isOpen(2)).toBe(true)
  })

  it('keeps a card the way the user left it', async () => {
    show()
    await load(CLEAN)
    await waitFor(() => expect(isOpen(2)).toBe(true))

    fireEvent.click(card(2))
    expect(isOpen(2)).toBe(false)

    // A later result must not reopen it behind their back.
    fireEvent.change(document.querySelector('input[type=range]'), { target: { value: '4' } })
    await waitFor(() => expect(isOpen(2)).toBe(false))
  })

  it('says in its summary what the closed step is set to', async () => {
    show()
    await load(CLEAN)
    await waitFor(() => expect(isOpen(1)).toBe(false))
    const summary = card(1).querySelector('.sum')
    expect(summary.textContent).toMatch(/amostras\.csv/)
    expect(summary.textContent).toMatch(/6 linhas/)
  })
})

describe('region names', () => {
  it('shows them in the reader language, not as the key', async () => {
    show('pt')
    await load(CLEAN)
    const picker = document.getElementById('region')
    const names = [...picker.options].map((o) => o.textContent)
    expect(names).toContain('Portugal Continental')
    expect(names).toContain('Açores')
    expect(names).not.toContain('Portugal mainland')
    expect(names.some((n) => n.startsWith('region.'))).toBe(false)
  })

  it('shows the English names in English', async () => {
    show('en')
    await load(CLEAN)
    const names = [...document.getElementById('region').options].map((o) => o.textContent)
    expect(names).toContain('Mainland Portugal')
    expect(names).toContain('Cape Verde')
    expect(names).toContain('Mozambique')
  })
})

describe('the region suggestion', () => {
  // Unsigned magnitudes near 19 N and 34 E: Sudan as written, Moçambique with
  // the sign. The application offers the question and changes nothing itself.
  const UNSIGNED = [
    'nome,lat,lon',
    'A,18.92,33.88',
    'B,18.79,34.25',
    'C,18.82,34.01',
    'D,19.12,33.55',
    'E,19.17,33.40',
    'F,18.61,34.29',
  ].join('\n')

  it('offers the region whose sign would place the file, and changes nothing until asked', async () => {
    show()
    await load(UNSIGNED)

    const offer = await screen.findByRole('button', { name: /Usar Moçambique/ })
    expect(document.getElementById('region').value).toBe('Portugal mainland')

    fireEvent.click(offer)

    await waitFor(() => expect(document.getElementById('region').value).toBe('Moçambique'))
  })

  it('says nothing about a file that is where it says it is', async () => {
    show()
    await load(CLEAN)
    await waitFor(() => expect(downloads().length).toBe(6))
    expect(screen.queryByRole('button', { name: /^Usar / })).toBeNull()
  })
})

describe('a file that cannot be read', () => {
  it('says so and offers nothing to download', async () => {
    show()
    const input = document.querySelector('input[type=file]')
    const file = new File([''], 'vazio.csv', { type: 'text/csv' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    fireEvent.change(input)

    await waitFor(() => expect(document.querySelector('[role=alert]')).toBeTruthy())
    expect(downloads().length).toBe(0)
  })

  it('does not leave the previous file on screen', async () => {
    // The failure worth fearing is not a crash, it is a plausible wrong
    // answer: one survey's points under the next survey's name.
    show()
    await load(CLEAN)
    await waitFor(() => expect(downloads().length).toBe(6))

    const input = document.querySelector('input[type=file]')
    const empty = new File([''], 'vazio.csv', { type: 'text/csv' })
    Object.defineProperty(input, 'files', { value: [empty], configurable: true })
    fireEvent.change(input)

    await waitFor(() => expect(document.querySelector('[role=alert]')).toBeTruthy())
    expect(downloads().length).toBe(0)
    expect(screen.queryAllByText(/amostras\.csv/)).toHaveLength(0)
  })
})

describe('the table filter', () => {
  // The table holds every row and draws only those in view; the filter is
  // what finds the one that failed at line 180 without scrolling to it.
  const rows = () => [...document.querySelectorAll('.tbl tbody tr[data-row]')]
  const rowNumbers = () => rows().map((r) => r.querySelector('th').textContent.replace(/\D/g, ''))
  const reviewChip = () => screen.queryByRole('button', { name: /A rever/ })

  it('is not offered when every row converted', async () => {
    show()
    await load(CLEAN)
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    expect(reviewChip()).toBeNull()
  })

  it('keeps only the rows needing attention, with their own line numbers', async () => {
    show()
    await load(NEAR_LISBON)
    await waitFor(() => expect(document.querySelector('.rv')).toBeTruthy())
    const before = rows().length

    fireEvent.click(reviewChip())

    await waitFor(() => expect(rows().length).toBeLessThan(before))
    // The eighth row is the reversed one; the number has to keep meaning the
    // line in the file, not the position in the filtered view.
    expect(rowNumbers()).toEqual(['8'])
  })

  it('empties itself once the question is answered', async () => {
    // Accepting the inversion makes the row ordinary, so a filter for
    // problems should stop showing it rather than keep it on a stale label.
    show()
    await load(NEAR_LISBON)
    await waitFor(() => expect(document.querySelector('.rv')).toBeTruthy())
    fireEvent.click(reviewChip())
    await waitFor(() => expect(rows()).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: /Inverter todas/ }))

    await waitFor(() => expect(rows()).toHaveLength(0))
  })

  it('does not carry the filter over to the next file', async () => {
    show()
    await load(NEAR_LISBON)
    await waitFor(() => expect(document.querySelector('.rv')).toBeTruthy())
    fireEvent.click(reviewChip())
    await waitFor(() => expect(rows()).toHaveLength(1))

    await load(CLEAN, 'outro.csv')

    await waitFor(() => expect(rows().length).toBeGreaterThan(1))
    expect(reviewChip()).toBeNull()
  })
})

describe('reading a projected file as kilometres', () => {
  // Synthetic M and P around Castelo Branco, in the kilometres a 1:25000
  // military sheet's margin prints. Read as metres they sit a few hundred
  // metres from the grid's false origin, which is in the Atlantic west of Cabo
  // de São Vicente - a valid coordinate, successfully transformed, and hundreds
  // of kilometres from where the data was collected. Nothing fails, which is
  // why the application has to notice.
  const KM = [
    'nome,X,Y',
    'A,252.52,315.15',
    'B,252.76,314.16',
    'C,251.28,316.70',
    'D,257.86,320.21',
    'E,255.19,315.35',
    'F,260.78,314.71',
  ].join('\n')

  const METRES = KM.split('\n').map((line, i) => (
    i === 0 ? line : line.split(',').map((f, j) => (j === 0 ? f : String(Number(f) * 1000))).join(',')
  )).join('\n')

  /** Lisboa / Hayford-Gauss Militar - the Carta Militar grid. */
  const militar = () => fireEvent.change(
    document.getElementById('crs-in'), { target: { value: '20790' } },
  )
  const offered = () => screen.queryByRole('button', { name: /Ler como quilómetros/ })
  // The summary is drawn from the final result, a step after the offer itself:
  // read it inside waitFor, and as empty until it is there.
  const centroid = () => [...document.querySelectorAll('.readout dl.sum dd')].pop()?.textContent ?? ''

  it('offers the reading, and changes nothing until it is taken', async () => {
    show()
    await load(KM)
    militar()

    const offer = await screen.findByRole('button', { name: /Ler como quilómetros/ })
    // Still read as written while the offer stands: in the Atlantic, not inland.
    await waitFor(() => expect(centroid()).toMatch(/^36\./))

    fireEvent.click(offer)

    await waitFor(() => expect(centroid()).toMatch(/^39\./))
    expect(offered()).toBeNull()
  })

  it('says what it is doing and takes it back', async () => {
    // Multiplying a column by a thousand is not something to leave a reader to
    // infer from the numbers, and not something to leave them stuck with.
    show()
    await load(KM)
    militar()
    fireEvent.click(await screen.findByRole('button', { name: /Ler como quilómetros/ }))
    await waitFor(() => expect(centroid()).toMatch(/^39\./))
    expect(screen.getByText(/multiplicados por 1000/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Ler como metros/ }))

    await waitFor(() => expect(centroid()).toMatch(/^36\./))
    expect(offered()).toBeTruthy()
  })

  it('says nothing about a file already in metres', async () => {
    show()
    await load(METRES)
    militar()
    await waitFor(() => expect(centroid()).toMatch(/^39\./))
    expect(offered()).toBeNull()
  })

  it('says nothing about a file read as degrees', async () => {
    // Degrees have no unit to get wrong. The question only exists for a grid.
    show()
    await load(CLEAN)
    await waitFor(() => expect(downloads().length).toBe(6))
    expect(offered()).toBeNull()
  })

  it('takes M and P for the grid, not the sheet number', async () => {
    // The column names a military sheet uses. Before they were known, the
    // sheet number was taken for the northing and every row converted to
    // nonsense until someone changed the picker.
    const SHEET = [
      'Folha,M,P',
      '282,252.52,315.15',
      '282,252.76,314.16',
      '281,251.28,316.70',
      '292,257.86,320.21',
      '282,255.19,315.35',
      '292,260.78,314.71',
    ].join('\n')
    show()
    await load(SHEET)
    militar()
    await waitFor(() => expect(document.getElementById('lat-col').value).toBe('M'))
    expect(document.getElementById('lon-col').value).toBe('P')
  })

  it('drops the reading when another file is loaded', async () => {
    // The factor belongs to the file that needed it. Carried over, the next
    // file converts a thousandfold wrong and nothing on screen says why.
    show()
    await load(KM)
    militar()
    fireEvent.click(await screen.findByRole('button', { name: /Ler como quilómetros/ }))
    await waitFor(() => expect(centroid()).toMatch(/^39\./))

    await load(METRES, 'outro.csv')

    await waitFor(() => expect(centroid()).toMatch(/^39\./))
    expect(screen.queryByText(/multiplicados por 1000/)).toBeNull()
  })
})

describe('the map sheets', () => {
  // A works list in the military grid, in metres, every point in the middle of
  // the sheet its row names - built from the sheet index itself, so nothing
  // here is anybody's survey.
  const middle = (key) => {
    const [[m0, p0]] = sheet25Boxes(key)
    return [(m0 + 8) * 1000, (p0 + 5) * 1000]
  }
  const sheets = ['230', '231', '241', '242', '252', '230']
  const grid = (edit = () => {}) => {
    const rows = sheets.map((key, i) => {
      const [m, p] = middle(key)
      return [`Furo ${i + 1}`, key, m, p]
    })
    edit(rows)
    return ['Local,Folha,M,P', ...rows.map((r) => r.join(','))].join('\n')
  }
  const militar = () => fireEvent.change(document.getElementById('crs-in'), { target: { value: '20790' } })
  const rows = () => [...document.querySelectorAll('.tbl tbody tr[data-row]')]

  it('finds the sheet column, offers the safe correction, and holds the downloads until answered', async () => {
    show()
    await load(grid((r) => { [r[2][2], r[2][3]] = [r[2][3], r[2][2]] }))
    militar()

    await waitFor(() => expect(document.getElementById('col-25').value).toBe('Folha'))
    const panel = await screen.findByText(/Uma linha está fora da sua folha/)
    expect(panel.closest('.rv').textContent).toMatch(/M e P trocados/)
    await waitFor(() => expect(downloads().every((b) => b.disabled)).toBe(true))

    fireEvent.click(screen.getByRole('button', { name: /Corrigir todas/ }))

    await waitFor(() => expect(downloads().every((b) => !b.disabled)).toBe(true))
    // The verdict goes into the table, and into the file.
    await waitFor(() => expect(document.querySelector('.tbl').textContent).toMatch(/corrigido: M e P trocados/))
  })

  it('lists what only the source can settle, and does not hold the downloads for it', async () => {
    // One digit wrong in P: a hundred kilometres off, and only a guess.
    show()
    await load(grid((r) => { r[4][3] -= 100000 }))
    militar()

    const list = await screen.findByText(/Uma linha para confirmar no relatório/)
    expect(list.closest('.rv').textContent).toMatch(/P com um algarismo errado/)
    await waitFor(() => expect(downloads().length).toBe(6))
    expect(downloads().every((b) => !b.disabled)).toBe(true)
  })

  it('names each point on the map by its label column', async () => {
    show()
    await load(grid())
    militar()
    await waitFor(() => expect(document.querySelector('[data-point="0"]')?.textContent).toBe('Furo 1'))
  })

  it('shows a point clicked on the map as the selected row of the table', async () => {
    show()
    await load(grid())
    militar()
    const point = await waitFor(() => {
      const el = document.querySelector('[data-point="3"]')
      expect(el).toBeTruthy()
      return el
    })
    fireEvent.click(point)
    await waitFor(() => expect(document.querySelector('.tbl tr.is-sel th').textContent).toMatch(/4/))
  })

  it('shows a row clicked in the table on the map', async () => {
    show()
    await load(grid())
    militar()
    await waitFor(() => expect(rows().length).toBe(6))
    fireEvent.click(rows()[2])
    await waitFor(() => expect(screen.getByTestId('map').dataset.selected).toBe('2'))
  })

  it('finds rows by any text in them', async () => {
    show()
    await load(grid())
    await waitFor(() => expect(rows().length).toBe(6))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Furo 5' } })
    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(rows()[0].querySelector('th').textContent).toMatch(/5/)
  })

  it('reads rows in the Azores\' UTM grid in their own system when asked', async () => {
    // Graciosa in UTM 26, metres, in a list that is otherwise the mainland's grid.
    show()
    await load(grid((r) => { r.push(['Furo 7', '21 - Açores', 411200, 4323900]) }))
    militar()

    await screen.findByText(/não é da quadrícula do ficheiro/)
    fireEvent.click(screen.getByRole('button', { name: /Converter esta como Açores/ }))

    await screen.findByText(/Uma linha convertida como Açores/)
    await waitFor(() => expect(document.querySelector('.tbl').textContent).toMatch(/Açores, convertido como EPSG:2189/))
  })

  it('does not look for sheets in a file without a sheet column', async () => {
    show()
    await load(CLEAN)
    await waitFor(() => expect(downloads().length).toBe(6))
    expect(document.getElementById('col-25').value).toBe('')
    expect(screen.queryByText(/fora da sua folha/)).toBeNull()
  })
})

describe('what a download records', () => {
  it('writes where the file came from into the file', async () => {
    // jsdom has no object URLs; the blob handed to one is the file the user
    // would have saved.
    const saved = []
    URL.createObjectURL = vi.fn((blob) => { saved.push(blob); return 'blob:x' })
    URL.revokeObjectURL = vi.fn()
    show()
    await load(CLEAN)
    await waitFor(() => expect(downloads().length).toBe(6))
    fireEvent.click(downloads().find((b) => b.textContent.includes('GeoJSON')))
    await waitFor(() => expect(saved.length).toBe(1))
    const text = await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.readAsText(saved[0])
    })
    const doc = JSON.parse(text)
    expect(doc.metadata['Ficheiro de origem']).toBe('amostras.csv')
    expect(doc.metadata['Sistema de origem']).toBe('WGS 84 (EPSG:4326)')
    expect(doc.metadata['Data da conversão']).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(doc.features.length).toBe(6)
  })
})

describe('the sheet of each point', () => {
  it('is written for a file with no sheet column, and only for points in a sheet', async () => {
    const saved = []
    URL.createObjectURL = vi.fn((blob) => { saved.push(blob); return 'blob:x' })
    URL.revokeObjectURL = vi.fn()
    show()
    await load(`${CLEAN}\nZ,-25.97,32.58`)
    await waitFor(() => expect(downloads().length).toBe(6))
    // The columns arrive once the points are placed in the military grid.
    await waitFor(() => expect(screen.getAllByText('Folha_25k').length).toBeGreaterThan(0))
    fireEvent.click(downloads().find((b) => b.textContent.includes('GeoJSON')))
    await waitFor(() => expect(saved.length).toBe(1))
    const text = await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.readAsText(saved[0])
    })
    const props = JSON.parse(text).features.map((f) => f.properties)
    expect(props[0].Folha_25k).toMatch(/^\d+[A-Z]?$/)
    expect(props[0].Folha_50k).toMatch(/^\d+-[A-D]$/)
    expect(props[0].Nome_50k).toBeTruthy()
    // Maputo is in no sheet of this series.
    expect(props[6].Folha_25k).toBe('')
  })
})
