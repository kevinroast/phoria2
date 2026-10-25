import { describe, didYouMean, fail } from '../validate.js'
import { CSS_COLORS } from './cssColors.js'

/** @import { ColorInput } from '../types.js' */

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toSRGB = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)
const clamp01 = (c) => Math.min(1, Math.max(0, c))

const NUMBER = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?`
const FUNC = new RegExp(String.raw`^(rgba?|hsla?)\(\s*(${NUMBER})(%|deg)?[\s,]+(${NUMBER})(%)?[\s,]+(${NUMBER})(%)?(?:\s*[,/]\s*(${NUMBER})%?)?\s*\)$`, 'i')

const HELP = "use '#rrggbb', a CSS name, 'rgb(...)', 'hsl(...)', 0xrrggbb or [r, g, b] with components 0-1"

/**
 * An RGB colour. Input is sRGB, as everywhere in phoria2; the components are stored **linear**,
 * ready for lighting maths. `toJSON()` gives sRGB '#rrggbb' back.
 */
export class Color extends Float32Array {
  static get [Symbol.species]() { return Float32Array }

  /** @param {ColorInput} [input] defaults to white */
  constructor(input = 0xffffff) {
    super(3)
    this.set(input)
  }

  /** @param {ColorInput} input @param {string} [owner] for error messages @returns {Color} */
  static fromInput(input, owner = 'Color') {
    return new Color().set(input, owner)
  }

  /** Linear red. */
  get r() { return this[0] }
  set r(v) { this[0] = v }
  get g() { return this[1] }
  set g(v) { this[1] = v }
  get b() { return this[2] }
  set b(v) { this[2] = v }

  /**
   * Set from any colour input (sRGB).
   * @overload
   * @param {ColorInput} input @param {string} [owner]
   * @returns {this}
   */
  /**
   * @overload
   * @param {ArrayLike<number>} array @param {number} [offset]
   * @returns {void}
   */
  /** @param {any} input @param {any} [owner] */
  set(input, owner = 'Color') {
    if (typeof owner === 'number') {
      // typed array set(array, offset)
      super.set(input, owner)
      return
    }
    if (input instanceof Color) {
      this[0] = input[0]
      this[1] = input[1]
      this[2] = input[2]
    } else if (typeof input === 'number') {
      this.#setHex(input, owner)
    } else if (typeof input === 'string') {
      this.#setString(input.trim(), owner)
    } else if (Array.isArray(input) || ArrayBuffer.isView(input)) {
      const arr = /** @type {ArrayLike<number>} */ (input)
      if (arr.length < 3) fail(owner, `color ${describe(input)} needs 3 components [r, g, b]`)
      const r = arr[0], g = arr[1], b = arr[2]
      if ([r, g, b].some((c) => typeof c !== 'number' || Number.isNaN(c))) fail(owner, `color components must be numbers - ${HELP}`)
      if (r > 1 || g > 1 || b > 1) {
        fail(owner, `color [${r}, ${g}, ${b}] has components above 1 - components are 0-1, ` +
          `e.g. [${+(r / 255).toFixed(3)}, ${+(g / 255).toFixed(3)}, ${+(b / 255).toFixed(3)}]`)
      }
      this.setSRGB(r, g, b)
    } else {
      fail(owner, `${describe(input)} is not a colour - ${HELP}`)
    }
    return this
  }

  /** Set from sRGB components 0-1. @param {number} r @param {number} g @param {number} b @returns {this} */
  setSRGB(r, g, b) {
    this[0] = toLinear(r)
    this[1] = toLinear(g)
    this[2] = toLinear(b)
    return this
  }

  /** Set linear components directly. @param {number} r @param {number} g @param {number} b @returns {this} */
  setLinear(r, g, b) {
    this[0] = r
    this[1] = g
    this[2] = b
    return this
  }

  /** @returns {Color} */
  clone() {
    return new Color(this)
  }

  /** @param {number} s @returns {this} */
  multiplyScalar(s) {
    this[0] *= s
    this[1] *= s
    this[2] *= s
    return this
  }

  /**
   * Move towards another colour by t (0-1), mixing the linear components - as light mixes.
   * @param {ColorInput} c @param {number} t @returns {this}
   */
  lerp(c, t) {
    const o = c instanceof Color ? c : Color.fromInput(c)
    this[0] += (o[0] - this[0]) * t
    this[1] += (o[1] - this[1]) * t
    this[2] += (o[2] - this[2]) * t
    return this
  }

  /** sRGB components 0-1. @returns {[number, number, number]} */
  toSRGB() {
    return [clamp01(toSRGB(this[0])), clamp01(toSRGB(this[1])), clamp01(toSRGB(this[2]))]
  }

  /** sRGB as 0xrrggbb. @returns {number} */
  getHex() {
    const [r, g, b] = this.toSRGB()
    return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255)
  }

  /** sRGB as '#rrggbb'. @returns {string} */
  getStyle() {
    return '#' + this.getHex().toString(16).padStart(6, '0')
  }

  /** @param {Color} c @param {number} [epsilon] @returns {boolean} */
  equals(c, epsilon = 1e-6) {
    return Math.abs(this[0] - c[0]) <= epsilon && Math.abs(this[1] - c[1]) <= epsilon && Math.abs(this[2] - c[2]) <= epsilon
  }

  toJSON() {
    return this.getStyle()
  }

  /** @param {number} hex @param {string} owner */
  #setHex(hex, owner) {
    if (!Number.isInteger(hex) || hex < 0 || hex > 0xffffff) fail(owner, `color ${hex} is not 0x000000-0xffffff - ${HELP}`)
    this.setSRGB(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255)
  }

  /** @param {string} s @param {string} owner */
  #setString(s, owner) {
    const lower = s.toLowerCase()
    if (lower.startsWith('#')) {
      let hex = lower.slice(1)
      if (/^[0-9a-f]{3,4}$/.test(hex)) hex = [...hex.slice(0, 3)].map((c) => c + c).join('')
      else if (/^[0-9a-f]{8}$/.test(hex)) hex = hex.slice(0, 6)
      if (!/^[0-9a-f]{6}$/.test(hex)) fail(owner, `color '${s}' is not a valid hex colour - ${HELP}`)
      this.#setHex(parseInt(hex, 16), owner)
      return
    }
    const named = CSS_COLORS.get(lower)
    if (named !== undefined) {
      this.#setHex(named, owner)
      return
    }
    const m = FUNC.exec(s)
    if (!m) fail(owner, `'${s}' is not a colour${didYouMean(lower, CSS_COLORS.keys())} - ${HELP}`)
    const [, fn, a, aUnit, b, bUnit, c, cUnit] = m
    if (fn.toLowerCase().startsWith('rgb')) {
      const channel = (v, unit) => clamp01(unit === '%' ? +v / 100 : +v / 255)
      this.setSRGB(channel(a, aUnit), channel(b, bUnit), channel(c, cUnit))
    } else {
      // hsl: hue in degrees, saturation and lightness in percent
      const h = (((+a % 360) + 360) % 360) / 360
      const sat = clamp01(+b / 100), light = clamp01(+c / 100)
      const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat
      const p = 2 * light - q
      const hue = (t) => {
        t = (t + 1) % 1
        if (t < 1 / 6) return p + (q - p) * 6 * t
        if (t < 1 / 2) return q
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
        return p
      }
      this.setSRGB(hue(h + 1 / 3), hue(h), hue(h - 1 / 3))
    }
  }
}
