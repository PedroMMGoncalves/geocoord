import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The contract lives outside web/ on purpose: it is shared with pytest.
const path = fileURLToPath(new URL('../../tests/fixtures/parity.json', import.meta.url))

export const fixtures = JSON.parse(readFileSync(path, 'utf8'))

/** Build a vitest table from one fixture section, keeping the case id as label. */
export function cases(section) {
  return fixtures[section].map((c) => [c.id, c])
}
