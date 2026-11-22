/**
 * Seeded random numbers (mulberry32): the same seed gives the same numbers in the same order, every
 * time - for layouts and particles that come out the same on every load.
 * @param {number} seed
 * @returns {() => number} each call the next number in [0, 1)
 */
export function seeded(seed) {
  let s = seed
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
