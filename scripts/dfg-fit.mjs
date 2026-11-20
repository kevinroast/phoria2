// Makes src/webgl/dfg.js: the environment BRDF's split-sum terms - how much of the light a GGX
// surface reflects from all round, as a scale on its f0 and a bias on its f90 (Karis, "Real Shading
// in Unreal Engine 4") - as a fitted function, in place of the lookup table three.js and Filament
// sample (one more texture on every lit program, which can't spare units).
// The terms are worked out here for phoria2's own GGX and height-correlated Smith visibility
// (shaders.js D_GGX, V_SmithGGXCorrelated; a = roughness squared), importance sampled, on a grid of
// roughness 0.04 - 1 (the shader's clamp) by NoV 0.02 - 1, and fitted by least squares: each term
// is five shapes in NoV - 1, NoV, NoV^2, Schlick's (1 - NoV)^5 and that times NoV, which carry the
// Fresnel edge polynomials can't - each times a quartic in roughness. Below NoV 0.02 (a sliver at a
// silhouette) it is clamped to the range. Run once; the output is checked in.
//   node scripts/dfg-fit.mjs
import { writeFileSync } from 'node:fs'

const SAMPLES = 4096
const ROUGH = 48, VIEW = 48, MIN_ROUGHNESS = 0.04, MIN_NOV = 0.02

/** Van der Corput's radical inverse, for Hammersley points. @param {number} i */
function radical(i) {
  let b = i
  b = ((b << 16) | (b >>> 16)) >>> 0
  b = (((b & 0x55555555) << 1) | ((b & 0xaaaaaaaa) >>> 1)) >>> 0
  b = (((b & 0x33333333) << 2) | ((b & 0xcccccccc) >>> 2)) >>> 0
  b = (((b & 0x0f0f0f0f) << 4) | ((b & 0xf0f0f0f0) >>> 4)) >>> 0
  b = (((b & 0x00ff00ff) << 8) | ((b & 0xff00ff00) >>> 8)) >>> 0
  return b * 2.3283064365386963e-10
}

/**
 * The split sum's two terms for a roughness and view angle: what is reflected, f0's share and
 * f90's (Schlick's Fresnel split), over GGX importance samples. @param {number} roughness @param {number} nv
 * @returns {[number, number]}
 */
export function dfg(roughness, nv) {
  const a = roughness * roughness, a2 = a * a
  const vx = Math.sqrt(1 - nv * nv), vz = nv
  let scale = 0, bias = 0
  for (let i = 0; i < SAMPLES; i++) {
    const phi = (2 * Math.PI * i) / SAMPLES, u = radical(i)
    const ct = Math.sqrt((1 - u) / (1 + (a2 - 1) * u)), st = Math.sqrt(1 - ct * ct)
    const hx = st * Math.cos(phi), hz = ct
    const voh = vx * hx + vz * hz
    const nl = 2 * voh * hz - vz
    if (nl <= 0) continue
    const vis = 0.5 / (nl * Math.sqrt(nv * nv * (1 - a2) + a2) + nv * Math.sqrt(nl * nl * (1 - a2) + a2))
    // the BRDF times NoL over the sample's pdf (D NoH / 4 VoH): D cancels
    const g = (vis * 4 * voh * nl) / hz, fc = (1 - voh) ** 5
    scale += g * (1 - fc)
    bias += g * fc
  }
  return [scale / SAMPLES, bias / SAMPLES]
}

const SHAPES = /** @type {((nv: number) => number)[]} */ ([() => 1, (nv) => nv, (nv) => nv * nv, (nv) => (1 - nv) ** 5, (nv) => (1 - nv) ** 5 * nv])
const POWERS = 5
/** @param {number} r @param {number} nv */
const basis = (r, nv) => SHAPES.flatMap((s) => Array.from({ length: POWERS }, (_, i) => r ** i * s(nv)))

/** Least squares by the normal equations. @param {number[][]} rows @param {number[]} y */
function solve(rows, y) {
  const n = rows[0].length, m = Array.from({ length: n }, () => new Float64Array(n + 1))
  rows.forEach((row, k) => {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) m[i][j] += row[i] * row[j]
      m[i][n] += row[i] * y[k]
    }
  })
  for (let i = 0; i < n; i++) {
    let p = i
    for (let r = i + 1; r < n; r++) if (Math.abs(m[r][i]) > Math.abs(m[p][i])) p = r
    ;[m[i], m[p]] = [m[p], m[i]]
    for (let r = 0; r < n; r++) {
      if (r === i) continue
      const f = m[r][i] / m[i][i]
      for (let c = i; c <= n; c++) m[r][c] -= f * m[i][c]
    }
  }
  return m.map((row, i) => row[n] / row[i])
}

const grid = []
for (let i = 0; i < ROUGH; i++) {
  for (let j = 0; j < VIEW; j++) {
    const r = MIN_ROUGHNESS + ((1 - MIN_ROUGHNESS) * i) / (ROUGH - 1), nv = MIN_NOV + ((1 - MIN_NOV) * j) / (VIEW - 1)
    grid.push({ r, nv, terms: dfg(r, nv) })
  }
}
const rows = grid.map(({ r, nv }) => basis(r, nv))
const fits = [0, 1].map((k) => solve(rows, grid.map((g) => g.terms[k])))

// how close: over the grid, and off it - halfway between its points
const report = [0, 1].map(() => ({ worst: 0, sum: 0, n: 0 }))
for (let i = 0; i < ROUGH - 1; i++) {
  for (let j = 0; j < VIEW - 1; j++) {
    const r = MIN_ROUGHNESS + ((1 - MIN_ROUGHNESS) * (i + 0.5)) / (ROUGH - 1), nv = MIN_NOV + ((1 - MIN_NOV) * (j + 0.5)) / (VIEW - 1)
    const exact = dfg(r, nv), b = basis(r, nv)
    for (const k of [0, 1]) {
      const e = Math.abs(b.reduce((s, v, n) => s + v * fits[k][n], 0) - exact[k])
      report[k].worst = Math.max(report[k].worst, e)
      report[k].sum += e
      report[k].n++
    }
  }
}

const num = (/** @type {number} */ v) => {
  const s = v.toPrecision(7)
  return s.includes('.') || s.includes('e') ? s : `${s}.0`
}
// each shape's quartic in roughness, as a vec4 of its r^1..r^4 coefficients plus its constant
const glsl = (/** @type {number[]} */ c, /** @type {string} */ name) => SHAPES.map((_, s) => {
  const k = c.slice(s * POWERS, s * POWERS + POWERS)
  return `  float ${name}${s} = ${num(k[0])} + dot(rs, vec4(${k.slice(1).map(num).join(', ')}));`
}).join('\n')

const out = `// Made by scripts/dfg-fit.mjs - don't edit by hand. The environment BRDF's split-sum terms for
// phoria2's GGX and height-correlated Smith, fitted: within ${report[0].worst.toFixed(3)} (scale) and
// ${report[1].worst.toFixed(3)} (bias) of the integral for roughness ${MIN_ROUGHNESS} - 1 and NoV ${MIN_NOV} - 1, ${(report[0].sum / report[0].n).toFixed(4)} and
// ${(report[1].sum / report[1].n).toFixed(4)} on average.

/** GLSL: vec2 envDFG(float roughness, float NoV) - the scale on f0 and the bias on f90. */
export const ENV_DFG = /* glsl */ \`
vec2 envDFG(float roughness, float NoV) {
  float nv = max(NoV, ${num(MIN_NOV)});
  vec4 rs = vec4(roughness, roughness * roughness, roughness * roughness * roughness, roughness * roughness * roughness * roughness);
  float s5 = pow(1.0 - nv, 5.0);
${glsl(fits[0], 'a')}
${glsl(fits[1], 'b')}
  vec2 dfg = vec2(a0 + a1 * nv + a2 * nv * nv + a3 * s5 + a4 * s5 * nv, b0 + b1 * nv + b2 * nv * nv + b3 * s5 + b4 * s5 * nv);
  return clamp(dfg, 0.0, 1.0);
}
\`
`
writeFileSync(new URL('../src/webgl/dfg.js', import.meta.url), out)
console.log(`scale: worst ${report[0].worst.toFixed(4)}, mean ${(report[0].sum / report[0].n).toFixed(4)}`)
console.log(`bias:  worst ${report[1].worst.toFixed(4)}, mean ${(report[1].sum / report[1].n).toFixed(4)}`)
