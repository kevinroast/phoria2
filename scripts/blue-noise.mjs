// Makes src/webgl/blue-noise-data.js: a 64 x 64 tile of blue noise - every value 0-255 once per 16
// texels, spread so that no value sits near another like it, and with no axis or lattice to see -
// by void-and-cluster (Ulichney, 1993). Soft shadows read it, tiled across the screen, for the angle
// each pixel turns its sample discs by: the samples' error shows as fine, even grain, with neither
// white noise's clumps nor the streaks or weave of a formula (interleaved gradient noise, R2).
// Run once; the output is checked in.
//   node scripts/blue-noise.mjs
import { writeFileSync } from 'node:fs'

const N = 64, SIZE = N * N, SIGMA = 1.9

// a fixed seed, so the tile is the same each run (mulberry32)
let seed = 0x9e3779b9
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

// the Gaussian each set texel adds to the energy round it, wrapping at the edges (the tile repeats)
const kernel = new Float64Array(SIZE)
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const dx = Math.min(x, N - x), dy = Math.min(y, N - y)
    kernel[y * N + x] = Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA * SIGMA))
  }
}

/** Energy of a pattern's set texels at every texel. @param {Uint8Array} on */
function energyOf(on) {
  const e = new Float64Array(SIZE)
  for (let i = 0; i < SIZE; i++) if (on[i]) splat(e, i, 1)
  return e
}
/** @param {Float64Array} e @param {number} i @param {number} sign */
function splat(e, i, sign) {
  const ix = i % N, iy = (i / N) | 0
  for (let y = 0; y < N; y++) {
    const row = ((y - iy + N) % N) * N
    for (let x = 0; x < N; x++) e[y * N + x] += sign * kernel[row + ((x - ix + N) % N)]
  }
}
/** The set (or unset) texel with the most (or least) energy round it. */
function pick(/** @type {Uint8Array} */ on, /** @type {Float64Array} */ e, /** @type {0 | 1} */ state, /** @type {boolean} */ most) {
  let best = -1, bestE = most ? -Infinity : Infinity
  for (let i = 0; i < SIZE; i++) {
    if (on[i] !== state) continue
    if (most ? e[i] > bestE : e[i] < bestE) { bestE = e[i]; best = i }
  }
  return best
}

// 1. a random start, a tenth set, relaxed until the tightest cluster is the largest void
const on = new Uint8Array(SIZE)
const ones = Math.round(SIZE * 0.1)
for (let n = 0; n < ones;) {
  const i = (random() * SIZE) | 0
  if (!on[i]) { on[i] = 1; n++ }
}
let e = energyOf(on)
for (let guard = 0; guard < SIZE * 4; guard++) {
  const cluster = pick(on, e, 1, true)
  on[cluster] = 0
  splat(e, cluster, -1)
  const voidAt = pick(on, e, 0, false)
  if (voidAt === cluster) {
    on[cluster] = 1
    splat(e, cluster, 1)
    break
  }
  on[voidAt] = 1
  splat(e, voidAt, 1)
}

const rank = new Int32Array(SIZE).fill(-1)
// 2. ranks below the start: take away the tightest cluster each time
{
  const work = on.slice(), we = Float64Array.from(e)
  for (let r = ones - 1; r >= 0; r--) {
    const i = pick(work, we, 1, true)
    work[i] = 0
    splat(we, i, -1)
    rank[i] = r
  }
}
// 3. ranks above it: fill the largest void each time, to half full
for (let r = ones; r < SIZE / 2; r++) {
  const i = pick(on, e, 0, false)
  on[i] = 1
  splat(e, i, 1)
  rank[i] = r
}
// 4. the rest: now the unset texels are the minority - fill the tightest cluster of them, their
// energy worked out afresh from the unset ones
{
  const off = new Uint8Array(SIZE)
  for (let i = 0; i < SIZE; i++) off[i] = on[i] ? 0 : 1
  const oe = energyOf(off)
  for (let r = SIZE / 2; r < SIZE; r++) {
    const i = pick(off, oe, 1, true)
    off[i] = 0
    splat(oe, i, -1)
    rank[i] = r
  }
}

const bytes = new Uint8Array(SIZE)
for (let i = 0; i < SIZE; i++) {
  if (rank[i] < 0) throw new Error(`texel ${i} unranked`)
  bytes[i] = Math.floor((rank[i] * 256) / SIZE)
}
const base64 = Buffer.from(bytes).toString('base64')
writeFileSync(new URL('../src/webgl/blue-noise-data.js', import.meta.url), `// Made by scripts/blue-noise.mjs - don't edit. A 64 x 64 tile of blue noise (void-and-cluster), one
// byte a texel, as base64: soft shadows' per-pixel angle.
export const BLUE_NOISE = '${base64}'
`)
console.log(`blue-noise-data.js: ${base64.length} characters`)
