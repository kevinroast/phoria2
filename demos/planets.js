import { Texture } from 'phoria2'
import { random } from './kit.js'

// Planet surfaces drawn into a 2D canvas, pixel by pixel, to wrap round a sphere: u runs round the
// equator and v from pole to pole. Each is sampled on the sphere itself (or with waves whose
// frequencies are whole turns), so there is no seam where the texture's edges meet.

/**
 * Bands of colour that wave as they go round, as on a gas giant. The palette runs from one band
 * colour to the next; storms are ovals of a colour, at [u, v, width, height].
 * @param {string[]} palette
 * @param {{ seed?: number, turbulence?: number, storms?: { at: number[], color: string }[], width?: number }} [options]
 */
export function banded(palette, { seed = 1, turbulence = 1, storms = [], width = 512 } = {}) {
  const rand = random(seed)
  const height = width / 2
  const stops = palette.map(rgb)
  const waves = Array.from({ length: 5 }, (_, i) => ({ a: 1 / (i + 1), f: (14 + rand() * 14) * (i + 1), p: rand() * 6.28 }))
  const sum = waves.reduce((s, w) => s + w.a, 0)
  const twist = [rand() * 6.28, rand() * 6.28]
  return paint(width, height, (u, v) => {
    // bands shift up and down a little as they go round, more near the equator
    const shift = turbulence * Math.sin(v * Math.PI) * (0.012 * Math.sin(u * 6.283 * 3 + v * 40 + twist[0]) + 0.006 * Math.sin(u * 6.283 * 7 + v * 90 + twist[1]))
    let t = 0
    for (const w of waves) t += w.a * Math.sin((v + shift) * w.f + w.p)
    t = 0.5 + 0.5 * t / sum
    for (const { at: [su, sv, sw, sh], color } of storms) {
      const du = Math.min(Math.abs(u - su), 1 - Math.abs(u - su)) / sw, dv = (v - sv) / sh
      const d = du * du + dv * dv
      if (d < 1) return mix(sample(stops, t), rgb(color), Math.min(1, (1 - d) * 2))
    }
    return sample(stops, t)
  })
}

/**
 * Land and sea from fractal noise on the sphere: the palette maps heights (0 deep, 1 high) to
 * colours, and ice covers the poles beyond the latitude given (0 - 1, pole to equator).
 * @param {[number, string][]} palette
 * @param {{ seed?: number, scale?: number, ice?: number, width?: number }} [options]
 */
export function terrain(palette, { seed = 1, scale = 2.5, ice = 0, width = 512 } = {}) {
  const noise = fractal(seed)
  const stops = palette.map(([at, c]) => ({ at, c: rgb(c) }))
  return paint(width, width / 2, (u, v, p) => {
    const h = noise(p[0] * scale, p[1] * scale, p[2] * scale)
    let c = stops[0].c
    for (let i = 1; i < stops.length; i++) {
      if (h <= stops[i].at) {
        const a = stops[i - 1], b = stops[i]
        c = mix(a.c, b.c, (h - a.at) / (b.at - a.at))
        break
      }
      c = stops[i].c
    }
    // ice: further from the pole where the ground is high
    const polar = Math.abs(p[1])
    if (ice && polar > 1 - ice + (0.5 - h) * 0.15) c = [236, 242, 248]
    return c
  })
}

/** Clouds: white, with the noise as alpha - a texture for a slightly larger, see-through sphere. */
export function clouds({ seed = 9, cover = 0.5, width = 512 } = {}) {
  const noise = fractal(seed)
  return paint(width, width / 2, (u, v, p) => {
    const n = noise(p[0] * 3, p[1] * 6, p[2] * 3)
    return [255, 255, 255, Math.max(0, Math.min(1, (n - (1 - cover)) * 4)) * 230]
  })
}

/** @param {number} width @param {number} height @param {(u: number, v: number, p: number[]) => number[]} color */
function paint(width, height, color) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'))
  const image = ctx.createImageData(width, height)
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height, lat = (0.5 - v) * Math.PI
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width, lon = u * Math.PI * 2
      const c = color(u, v, [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)])
      image.data.set([c[0], c[1], c[2], c[3] ?? 255], (y * width + x) * 4)
    }
  }
  ctx.putImageData(image, 0, 0)
  return new Texture({ image: canvas })
}

/** Value noise in 3D, five octaves, roughly 0 - 1. */
function fractal(seed) {
  const rand = random(seed)
  const table = Uint8Array.from({ length: 512 }, () => rand() * 256)
  const hash = (x, y, z) => table[(table[(table[x & 255] + y) & 255] + z) & 255] / 255
  const smooth = (t) => t * t * (3 - 2 * t)
  const lerp = (a, b, t) => a + (b - a) * t
  const value = (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
    const u = smooth(x - xi), v = smooth(y - yi), w = smooth(z - zi)
    const c = (dx, dy, dz) => hash(xi + dx, yi + dy, zi + dz)
    return lerp(
      lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
      lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v), w)
  }
  return (x, y, z) => {
    let total = 0, amplitude = 0.5, f = 1
    for (let i = 0; i < 5; i++) {
      total += amplitude * value(x * f + 17.3 * i, y * f, z * f)
      amplitude /= 2
      f *= 2
    }
    // stretch the middle-heavy sum back out towards 0 - 1
    return Math.max(0, Math.min(1, (total / 0.97 - 0.5) * 1.8 + 0.5))
  }
}

/** '#rrggbb' as [r, g, b], 0 - 255. */
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [n >> 16, (n >> 8) & 255, n & 255]
}

function mix(a, b, t) {
  return [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t)
}

function sample(stops, t) {
  const x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x))
  return mix(stops[i], stops[i + 1], x - i)
}
