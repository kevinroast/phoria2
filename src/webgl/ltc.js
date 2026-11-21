// The lookup tables rect-area lights are shaded with, as two small textures - loaded the first time a
// scene has one (see ltc-data.js for where the tables come from).
import { LTC_AMPLITUDE, LTC_MATRIX } from './ltc-data.js'
import { RECT_PARTS } from './parts-rect.js'
import { addParts } from './parts.js'

/** @param {string} base64 @returns {Uint16Array} half floats */
function halves(base64) {
  const text = atob(base64)
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
  return new Uint16Array(bytes.buffer)
}

/** Rect-area lights' tables, made on the GPU when first wanted and again after a lost context. */
export class Ltc {
  /** @type {WebGLTexture | null} */ #matrix = null
  /** @type {WebGLTexture | null} */ #amplitude = null

  /** @param {WebGL2RenderingContext} gl */
  constructor(gl) {
    this.gl = gl
    // and the GLSL that shades with them, for every lit shader from now on
    addParts('rect', RECT_PARTS)
  }

  /** The inverse transform for each roughness and view angle: four channels. @returns {WebGLTexture} */
  get matrix() {
    return (this.#matrix ??= this.#texture(halves(LTC_MATRIX), 4))
  }

  /** The specular's magnitude and Fresnel part: two channels. @returns {WebGLTexture} */
  get amplitude() {
    return (this.#amplitude ??= this.#texture(halves(LTC_AMPLITUDE), 2))
  }

  /** @param {Uint16Array} data @param {number} channels @returns {WebGLTexture} */
  #texture(data, channels) {
    const gl = this.gl
    const texture = /** @type {WebGLTexture} */ (gl.createTexture())
    // unit 15 is kept for uploads (resources.js)
    gl.activeTexture(gl.TEXTURE15)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    const [internal, format] = channels === 4 ? [gl.RGBA16F, gl.RGBA] : [gl.RG16F, gl.RG]
    // rows of 64 half floats a channel: always 4-byte aligned
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, 64, 64, 0, format, gl.HALF_FLOAT, data)
    // half floats filter in WebGL 2 without an extension
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindTexture(gl.TEXTURE_2D, null)
    return texture
  }

  /** After a lost context, or when the context is let go: made again when next wanted. */
  reset() {
    if (this.#matrix) this.gl.deleteTexture(this.#matrix)
    if (this.#amplitude) this.gl.deleteTexture(this.#amplitude)
    this.#matrix = this.#amplitude = null
  }
}
