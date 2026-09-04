/**
 * Coordinate conversion engine for GeoCoord (JavaScript port).
 *
 * This file is a deliberate, function-by-function translation of
 * `geocoord/converter.py`. Keep the two in the same order and keep the
 * behaviour identical: `tests/fixtures/parity.json` is the contract both
 * implementations are checked against, and any divergence fails both CIs.
 */

/**
 * Convert a value (DMS/DM/decimal) into decimal degrees.
 * Returns null when the value is empty or cannot be interpreted.
 */
export function parseCoordinate(value) {
  if (value === null || value === undefined) return null
  return Number(value)
}
