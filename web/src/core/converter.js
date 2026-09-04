/**
 * Coordinate conversion engine for GeoCoord (JavaScript port).
 *
 * This file is a deliberate, function-by-function translation of
 * `geocoord/converter.py`. Keep the two in the same order and keep the
 * behaviour identical: `tests/fixtures/parity.json` is the contract both
 * implementations are checked against, and any divergence fails both CIs.
 */

// Hemispheres that make the value negative (South, West/Oeste).
// Portuguese: O = Oeste (West), L = Leste (East); English: W, E.
const NEGATIVE_DIRS = new Set(['S', 'W', 'O'])

// A hemisphere letter standing on its own. It may sit against digits or symbols
// ("38.5W", '30"O'), but not against another letter, so a word like "Oeste" or
// "Norte" in a name column is never read as a direction. \p{L} is Unicode-aware,
// so accented words are excluded too. A plain \b would not do: a digit and a
// letter are both word characters, so "38.5W" would have no boundary and would
// silently lose its hemisphere.
const DIRECTION_RE = /(?<!\p{L})([NSEWOL])(?!\p{L})/iu
// Numbers (integer or decimal, dot or comma), always unsigned.
const NUMBER_RE = /\d+(?:[.,]\d+)?/g
// An explicit minus sign before the first digit.
const LEADING_MINUS_RE = /^\s*-\s*\d/

// Valid geographic bounds.
export const LAT_RANGE = [-90.0, 90.0]
export const LON_RANGE = [-180.0, 180.0]

/**
 * Convert a value (DMS/DM/decimal) into decimal degrees.
 *
 * Returns null when the value is empty or cannot be interpreted. The sign comes
 * from the hemisphere (N/S/E/W/O/L) when present, otherwise from an explicit
 * leading minus sign.
 *
 * Mirrors parse_coordinate() in geocoord/converter.py. Numbers are stringified
 * rather than short-circuited, exactly as the Python does, so that both sides
 * agree even on odd inputs such as 1e-7.
 */
export function parseCoordinate(value) {
  if (value === null || value === undefined) return null

  const txt = String(value).trim()
  if (txt === '' || txt === '-' || txt === '—') return null

  // 1) Hemisphere (prefix or suffix), if any.
  const dirMatch = DIRECTION_RE.exec(txt)
  const direction = dirMatch ? dirMatch[1].toUpperCase() : null

  // 2) Explicit minus sign before the first digit.
  const hasMinus = LEADING_MINUS_RE.test(txt)

  // 3) Numeric components (magnitude, always positive).
  const nums = [...txt.matchAll(NUMBER_RE)].map((m) => parseFloat(m[0].replace(',', '.')))
  if (nums.length === 0) return null

  let magnitude
  if (nums.length === 1) {
    magnitude = nums[0]
  } else if (nums.length === 2) {
    magnitude = nums[0] + nums[1] / 60.0
  } else {
    // >= 3: degrees, minutes, seconds (extras ignored)
    magnitude = nums[0] + nums[1] / 60.0 + nums[2] / 3600.0
  }

  // 4) Sign: the hemisphere takes priority; otherwise the explicit minus.
  const negative = direction !== null ? NEGATIVE_DIRS.has(direction) : hasMinus

  return negative ? -magnitude : magnitude
}
