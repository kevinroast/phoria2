// Makes src/webgl/ltc-data.js: the two lookup tables rect-area lights are shaded with - linearly
// transformed cosines (LTC), from "Real-Time Polygonal-Light Shading with Linearly Transformed
// Cosines" by Eric Heitz, Jonathan Dupuy, Stephen Hill and David Neubelt
// (https://github.com/selfshadow/ltc_code/). The fitted values are taken from three.js's copy
// (examples/jsm/lights/RectAreaLightTexturesLib.js, MIT) - a devDependency - and stored as half
// floats: the matrix table's four channels, and the first two of the other (the specular's
// magnitude and its Fresnel part), as base64. Run once; the output is checked in.
//   node scripts/ltc-tables.mjs
import { readFileSync, writeFileSync } from 'node:fs'

const source = readFileSync(new URL('../node_modules/three/examples/jsm/lights/RectAreaLightTexturesLib.js', import.meta.url), 'utf8')

/** @param {string} name */
function table(name) {
  const m = source.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`))
  if (!m) throw new Error(`${name} not found`)
  const values = m[1].split(',').map((s) => Number(s.replace(/\s/g, '')))
  if (values.length !== 64 * 64 * 4 || values.some((v) => !Number.isFinite(v))) throw new Error(`${name}: ${values.length} values`)
  return values
}

// a float as a half float's bits, rounded to nearest
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer)
/** @param {number} v */
function half(v) {
  f32[0] = v
  const x = u32[0]
  const sign = (x >>> 16) & 0x8000
  let exp = ((x >>> 23) & 0xff) - 127 + 15
  let mant = x & 0x7fffff
  if (exp >= 31) return sign | 0x7c00
  if (exp <= 0) {
    if (exp < -10) return sign
    mant = (mant | 0x800000) >>> (1 - exp)
    return sign | ((mant + 0x1000) >>> 13)
  }
  return sign | ((exp << 10) + ((mant + 0x1000) >>> 13))
}

/** @param {number[]} values @param {number} channels of each four kept */
function encode(values, channels) {
  const out = new Uint16Array(64 * 64 * channels)
  for (let i = 0; i < 64 * 64; i++) for (let c = 0; c < channels; c++) out[i * channels + c] = half(values[i * 4 + c])
  return Buffer.from(out.buffer).toString('base64')
}

const matrix = encode(table('LTC_MAT_1'), 4)
const amplitude = encode(table('LTC_MAT_2'), 2)
writeFileSync(new URL('../src/webgl/ltc-data.js', import.meta.url), `// Made by scripts/ltc-tables.mjs - don't edit. The lookup tables for rect-area lights, 64 x 64 half
// floats as base64: the inverse matrix of each linearly transformed cosine (four channels), and the
// specular's magnitude and Fresnel part (two). Fitted by Heitz, Dupuy, Hill and Neubelt
// (https://github.com/selfshadow/ltc_code/), via three.js (MIT).
export const LTC_MATRIX = '${matrix}'
export const LTC_AMPLITUDE = '${amplitude}'
`)
console.log(`ltc-data.js: ${matrix.length + amplitude.length} characters of tables`)
