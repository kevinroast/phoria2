// The tone maps - how light becomes a colour on the screen - in one place: their constants, the
// curves forwards (here, and as GLSL in shaders.js's TONE_MAP, built from the same constants) and
// backwards (lightBehind here; bloom's untone in GLSL). Each curve's shape is written once a language,
// and its numbers once in all.

/** The tone maps by name, as the shaders number them. */
export const TONE_MAPPING = { none: 0, aces: 1, neutral: 2 }

// ACES filmic, Narkowicz's fit: x (A x + B) / (x (C x + D) + E). It runs on past 1, to A / C, rather
// than being clamped, so bloom can tell its highlights from white (sRGB clamps what shows)
const ACES = { A: 2.51, B: 0.03, C: 2.43, D: 0.59, E: 0.14 }
/** Where ACES levels off: what it never maps past. */
export const ACES_TOP = ACES.A / ACES.C

// Khronos PBR Neutral: a toe that lifts the darkest channel by up to TOE, and above START the
// highlights compressed towards white, desaturating by DESATURATION
const NEUTRAL = { START: 0.8, TOE: 0.04, DESATURATION: 0.15 }

/**
 * How far back the tone maps are run: what maps nearer white than this much light counts as this -
 * the tone maps only reach white at infinity, and half floats can't tell what is nearer apart.
 */
export const TONE_PEAK = 16

/** A number as a GLSL float literal. @param {number} n */
const glsl = (n) => (Number.isInteger(n) ? n.toFixed(1) : String(n))

/** The constants as GLSL, for the curves in shaders.js and bloom.js. */
export const TONE_CONSTANTS = /* glsl */ `
const float ACES_A = ${glsl(ACES.A)}, ACES_B = ${glsl(ACES.B)}, ACES_C = ${glsl(ACES.C)}, ACES_D = ${glsl(ACES.D)}, ACES_E = ${glsl(ACES.E)};
const float ACES_TOP = ACES_A / ACES_C;
const float NEUTRAL_START = ${glsl(NEUTRAL.START)}, NEUTRAL_TOE = ${glsl(NEUTRAL.TOE)}, NEUTRAL_DESATURATION = ${glsl(NEUTRAL.DESATURATION)};
const float TONE_PEAK = ${glsl(TONE_PEAK)};
`

/**
 * ACES backwards: the light it maps to `o`, one channel - its rational curve solved for x.
 * @param {number} o
 */
function acesBehind(o) {
  const { A, B, C, D, E } = ACES
  o = Math.min(o, ACES_TOP)
  const a = Math.min(C * o - A, -1e-4), b = D * o - B, k = E * o
  return Math.min((-b - Math.sqrt(Math.max(b * b - 4 * a * k, 0))) / (2 * a), TONE_PEAK)
}

/**
 * Neutral's highlight compression backwards: the peak that compresses to `top` (above START).
 * @param {number} top
 */
function neutralPeakBehind(top) {
  const d = 1 - NEUTRAL.START
  return top < 1 ? Math.min(NEUTRAL.START - d + (d * d) / (1 - top), TONE_PEAK) : TONE_PEAK
}

/**
 * A tone map forwards, as the shaders' toneCurve: light already scaled by the exposure, to the colour
 * shown (linear, before sRGB).
 * @param {ArrayLike<number>} c @param {number} toneMapping as TONE_MAPPING
 * @returns {number[]}
 */
export function toneCurve(c, toneMapping) {
  let out = Array.from(c)
  if (toneMapping === TONE_MAPPING.aces) {
    const { A, B, C, D, E } = ACES
    return out.map((x) => Math.max((x * (A * x + B)) / (x * (C * x + D) + E), 0))
  }
  if (toneMapping === TONE_MAPPING.neutral) {
    const { START, TOE, DESATURATION } = NEUTRAL
    const x = Math.min(...out), offset = x < 2 * TOE ? x - x * x / (4 * TOE) : TOE
    out = out.map((v) => v - offset)
    const peak = Math.max(...out)
    if (peak <= START) return out
    const d = 1 - START, newPeak = 1 - (d * d) / (peak + d - START)
    const g = 1 - 1 / (DESATURATION * (peak - newPeak) + 1)
    return out.map((v) => v * newPeak / peak).map((v) => v + (newPeak - v) * g)
  }
  return out
}

/**
 * The light, before the exposure, that a tone map turns into this colour - toneCurve run backwards,
 * as bloom's untone runs it. A channel at white, which the curves never quite reach, counts as
 * TONE_PEAK.
 * @param {ArrayLike<number>} c linear colour @param {number} toneMapping as TONE_MAPPING @param {number} exposure
 * @returns {number[]}
 */
export function lightBehind(c, toneMapping, exposure) {
  let out = [Math.max(0, c[0]), Math.max(0, c[1]), Math.max(0, c[2])]
  if (toneMapping === TONE_MAPPING.aces) {
    // a channel at a time
    out = out.map(acesBehind)
  } else if (toneMapping === TONE_MAPPING.neutral) {
    // its highlight compression, then its toe
    const top = Math.max(...out)
    if (top > NEUTRAL.START) {
      const peak = neutralPeakBehind(top), d = 1 - NEUTRAL.START
      const newPeak = 1 - (d * d) / (peak + d - NEUTRAL.START)
      const g = 1 - 1 / (NEUTRAL.DESATURATION * (peak - newPeak) + 1)
      out = out.map((v) => Math.max((Math.min(v, newPeak) - g * newPeak) / (1 - g), 0) * (peak / newPeak))
    }
    const y = Math.min(...out), toe = NEUTRAL.TOE
    const offset = y < toe ? 2 * Math.sqrt(toe * y) - y : toe
    out = out.map((v) => v + offset)
  }
  const e = Math.max(exposure, 1e-6)
  return out.map((v) => v / e)
}
