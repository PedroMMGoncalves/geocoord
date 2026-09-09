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

vi.mock('../src/components/PointsMap.jsx', () => ({
  default: () => null,
  COLOR_OK: '#0072B2',
  COLOR_SUSPECT: '#D55E00',
}))

const { default: FileConvert } = await import('../src/components/FileConvert.jsx')
const { LangContext } = await import('../src/i18n.jsx')
const { createElement } = await import('react')

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
  // Unsigned magnitudes near 15 N and 33 E: Sudan as written, Moçambique with
  // the sign. The application offers the question and changes nothing itself.
  const TETE = [
    'nome,lat,lon',
    'A,15.37,33.88',
    'B,15.38,33.81',
    'C,15.26,33.09',
    'D,15.27,33.04',
    'E,15.43,31.31',
    'F,15.06,30.44',
  ].join('\n')

  it('offers the region whose sign would place the file, and changes nothing until asked', async () => {
    show()
    await load(TETE)

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
  // Raising the fifty-row cap is the wrong fix - fifty thousand rows of DOM is
  // what takes a tab down. The fault is that the fifty are the *first* fifty,
  // so a row that failed at 180 is never seen.
  const rows = () => [...document.querySelectorAll('.tbl tbody tr')]
  const rowNumbers = () => rows().map((r) => r.querySelector('th').textContent.replace(/\D/g, ''))

  it('is not offered when every row converted', async () => {
    show()
    await load(CLEAN)
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    expect(screen.queryByText(/Só as linhas a rever/)).toBeNull()
  })

  it('keeps only the rows needing attention, with their own line numbers', async () => {
    show()
    await load(NEAR_LISBON)
    await waitFor(() => expect(document.querySelector('.rv')).toBeTruthy())
    const before = rows().length

    fireEvent.click(screen.getByText(/Só as linhas a rever/))

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
    fireEvent.click(screen.getByText(/Só as linhas a rever/))
    await waitFor(() => expect(rows()).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: /Inverter todas/ }))

    await waitFor(() => expect(rows()).toHaveLength(0))
  })

  it('does not carry the filter over to the next file', async () => {
    show()
    await load(NEAR_LISBON)
    await waitFor(() => expect(document.querySelector('.rv')).toBeTruthy())
    fireEvent.click(screen.getByText(/Só as linhas a rever/))
    await waitFor(() => expect(rows()).toHaveLength(1))

    await load(CLEAN, 'outro.csv')

    await waitFor(() => expect(rows().length).toBeGreaterThan(1))
    expect(screen.queryByText(/Só as linhas a rever/)).toBeNull()
  })
})
