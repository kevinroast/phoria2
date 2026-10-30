import { Color } from '../value/Color.js'
import { checkNumber, checkOneOf, checkOptions, describe, fail, warnOnce } from '../validate.js'
import { Texture } from './Texture.js'

/** @import { ColorInput } from '../types.js' */
/** @import { TextureOptions } from './Texture.js' */

/** A map: a Texture, its options, or just a url. @typedef {Texture | TextureOptions | string} MapInput */

/**
 * @typedef {object} MaterialOptions
 * @property {string} [name]
 * @property {ColorInput} [color] base colour (default white)
 * @property {MapInput | null} [map] colour texture
 * @property {number} [opacity] 0-1; below 1 renders in the transparent pass (default 1)
 * @property {boolean} [transparent] blend at any opacity - for maps with soft alpha edges (default: opacity below 1)
 * @property {number} [alphaTest] 0-1: drop pixels whose alpha is below it - cut-outs such as leaves (default 0)
 * @property {number} [roughness] 0 = mirror, 1 = matte (default 0.5)
 * @property {number} [metalness] 0-1 (default 0)
 * @property {MapInput | null} [roughnessMap] multiplies roughness by its green channel (glTF)
 * @property {MapInput | null} [metalnessMap] multiplies metalness by its blue channel (glTF)
 * @property {MapInput | null} [normalMap] tangent-space normals, +Y up (glTF/OpenGL convention)
 * @property {number} [normalScale] strength of the normal map (default 1)
 * @property {MapInput | null} [bumpMap] heights in its red channel, shown as bumps - for height textures and ones
 *   drawn in code, with no need to make a normal map
 * @property {number} [bumpScale] how high a height of 1 stands, in the mesh's own units (default 1)
 * @property {number} [triplanar] project the maps onto the mesh from its three axes instead of using UVs -
 *   for scans and CAD models, which have none. The number is how many times a map repeats per unit of the
 *   mesh's own space; the maps stay on the mesh as it moves. 0 (the default) uses the UVs
 * @property {MapInput | null} [aoMap] ambient occlusion in its red channel; darkens environment and ambient light
 * @property {number} [aoMapIntensity] 0-1 (default 1)
 * @property {MapInput | null} [emissiveMap] multiplies the emissive colour
 * @property {ColorInput} [emissive] glow colour (default black)
 * @property {number} [emissiveIntensity] (default 1)
 * @property {number} [transmission] 0-1: how much light passes through, as through glass (default 0). Unlike
 *   opacity, which fades the whole surface, glass keeps its reflections, and shows less of what is behind it
 *   towards its edges. Its colour shows in proportion to 1 - transmission
 * @property {number} [clearcoat] 0-1: a clear glossy layer over the surface - car paint, lacquer, varnish (default 0)
 * @property {number} [clearcoatRoughness] 0-1: how glossy the coat is, 0 a mirror (default 0)
 * @property {boolean} [unlit] flat colour that ignores lights (default false)
 * @property {boolean} [flatShading] faceted look from face normals (default false)
 * @property {boolean} [doubleSided] draw back faces too (default false)
 * @property {boolean} [vertexColors] multiply by the geometry's colors (default false)
 * @property {boolean} [fog] fade into the scene's fog with distance (default true) - false for a sky or a far backdrop
 * @property {'normal' | 'additive' | 'multiply'} [blending] how it combines with what is behind it: 'additive' adds
 *   light (glows, sparks), 'multiply' darkens it as a filter does - cyan over magenta is blue (default 'normal')
 * @property {boolean} [depthWrite] (default true)
 * @property {boolean} [depthTest] (default true)
 * @property {number} [size] Points: diameter in world units, or pixels when sizeAttenuation is off (default 1)
 * @property {boolean} [sizeAttenuation] Points: sized in the world, so smaller with distance (default true)
 * @property {number} [width] Lines: width in pixels (default 1)
 */

const MAPS = ['map', 'roughnessMap', 'metalnessMap', 'normalMap', 'bumpMap', 'aoMap', 'emissiveMap']
// data maps hold numbers, not colours
const LINEAR_MAPS = new Set(['roughnessMap', 'metalnessMap', 'normalMap', 'bumpMap', 'aoMap'])
const FLAGS = ['unlit', 'flatShading', 'doubleSided', 'vertexColors', 'depthWrite', 'depthTest', 'sizeAttenuation', 'transparent', 'fog']
const NUMBERS = { opacity: [0, 1], roughness: [0, 1], metalness: [0, 1], emissiveIntensity: [0, Infinity], size: [0, Infinity], width: [0, Infinity],
  alphaTest: [0, 1], normalScale: [-Infinity, Infinity], aoMapIntensity: [0, 1], triplanar: [0, Infinity], bumpScale: [-Infinity, Infinity],
  transmission: [0, 1], clearcoat: [0, 1], clearcoatRoughness: [0, 1] }
const DEFAULTS = {
  name: '', opacity: 1, alphaTest: 0, roughness: 0.5, metalness: 0, normalScale: 1, bumpScale: 1, aoMapIntensity: 1, triplanar: 0, emissiveIntensity: 1,
  transmission: 0, clearcoat: 0, clearcoatRoughness: 0, unlit: false, flatShading: false,
  doubleSided: false, vertexColors: false, blending: 'normal', depthWrite: true, depthTest: true, fog: true,
  size: 1, sizeAttenuation: true, width: 1,
}
const OPTIONS = ['name', 'color', 'emissive', ...MAPS, ...FLAGS, ...Object.keys(NUMBERS), 'blending']

// what agents (and three.js habits) will reach for
const HINTS = {
  type: "phoria2 has one material - drop 'type' and set 'unlit: true' for a flat colour",
  side: "use 'doubleSided: true'",
  wireframe: 'use new Lines({ geometry: edges(geometry) }) for a wireframe',
  shininess: "use 'roughness' (0 = mirror, 1 = matte)",
  specular: "use 'roughness' and 'metalness'",
  colour: "use 'color'",
  emissiveColor: "use 'emissive'",
  alpha: "use 'opacity'",
}

/**
 * The one material: what a surface looks like. Plain objects passed as a `material` become
 * Materials; construct one to share it between nodes. The renderer compiles a shader variant
 * from what is actually used, so an unlit colour costs no lighting maths.
 */
export class Material {
  /** The options it takes, and hints for names people reach for instead. */
  static OPTIONS = OPTIONS
  static HINTS = HINTS
  // values from DEFAULTS, in the constructor - one list, which toJSON leaves out
  /** @type {string} */ name
  /** @type {number} */ opacity
  /** Drop pixels with less alpha than this - hard-edged cut-outs, drawn with the opaque pass. @type {number} */ alphaTest
  /** @type {number} */ normalScale
  /** How high a bump map's height of 1 stands, in the mesh's own units. @type {number} */ bumpScale
  /** @type {number} */ aoMapIntensity
  /** Maps projected from the mesh's three axes, this many repeats per unit; 0 uses the UVs. @type {number} */ triplanar
  /** @type {number} */ roughness
  /** @type {number} */ metalness
  /** @type {number} */ emissiveIntensity
  /** How much light passes through, as through glass: 0-1. @type {number} */ transmission
  /** A clear glossy layer over the surface: 0-1. @type {number} */ clearcoat
  /** How glossy the coat is, 0 a mirror. @type {number} */ clearcoatRoughness
  /** @type {boolean} */ unlit
  /** @type {boolean} */ flatShading
  /** @type {boolean} */ doubleSided
  /** @type {boolean} */ vertexColors
  /** Fades into the scene's fog with distance. @type {boolean} */ fog
  /** @type {'normal' | 'additive' | 'multiply'} */ blending
  /** @type {boolean} */ depthWrite
  /** @type {boolean} */ depthTest
  /** @type {number} */ size
  /** @type {boolean} */ sizeAttenuation
  /** @type {number} */ width

  #color = new Color(0xffffff)
  #emissive = new Color(0x000000)
  #transparent = false
  /** @type {Record<string, Texture | null>} */
  #maps = Object.fromEntries(MAPS.map((m) => [m, null]))
  /** @type {Set<() => void>} */
  #onDispose = new Set()

  /** @param {MaterialOptions} [options] */
  constructor(options = {}) {
    checkOptions('Material', options, OPTIONS, HINTS)
    Object.assign(this, DEFAULTS)
    for (const [key, value] of /** @type {[string, any][]} */ (Object.entries(options))) {
      if (value === undefined) continue
      if (key === 'color') this.color = value
      else if (key === 'emissive') this.emissive = value
      else if (MAPS.includes(key)) this.setMap(key, value)
      else if (FLAGS.includes(key)) this[key] = bool(key, value)
      else if (key in NUMBERS) this[key] = range(key, value, NUMBERS[key])
      else if (key === 'blending') this.blending = checkOneOf('Material', 'blending', value, ['normal', 'additive', 'multiply'])
      else if (key === 'name') this.name = String(value)
    }
  }

  /** @internal
   * A Material from a Material (returned as is) or options.
   * @param {Material | MaterialOptions} input
   * @returns {Material}
   */
  static fromInput(input) {
    if (input instanceof Material) return input
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      fail('Material', `expected material options such as { color: 'orange' }, got ${describe(input)}`)
    }
    return new Material(input)
  }

  /** Base colour; assign any colour input. @returns {Color} */
  get color() { return this.#color }
  /** @param {ColorInput} v */
  set color(v) { this.#color.set(v, 'Material') }

  /** Glow colour; assign any colour input. @returns {Color} */
  get emissive() { return this.#emissive }
  /** @param {ColorInput} v */
  set emissive(v) { this.#emissive.set(v, 'Material') }

  /** @returns {Texture | null} */
  get map() { return this.#maps.map }
  /** @param {MapInput | null} v */
  set map(v) { this.setMap('map', v) }
  /** @returns {Texture | null} */
  get roughnessMap() { return this.#maps.roughnessMap }
  /** @param {MapInput | null} v */
  set roughnessMap(v) { this.setMap('roughnessMap', v) }
  /** @returns {Texture | null} */
  get metalnessMap() { return this.#maps.metalnessMap }
  /** @param {MapInput | null} v */
  set metalnessMap(v) { this.setMap('metalnessMap', v) }
  /** @returns {Texture | null} */
  get normalMap() { return this.#maps.normalMap }
  /** @param {MapInput | null} v */
  set normalMap(v) { this.setMap('normalMap', v) }
  /** @returns {Texture | null} */
  get bumpMap() { return this.#maps.bumpMap }
  /** @param {MapInput | null} v */
  set bumpMap(v) { this.setMap('bumpMap', v) }
  /** @returns {Texture | null} */
  get aoMap() { return this.#maps.aoMap }
  /** @param {MapInput | null} v */
  set aoMap(v) { this.setMap('aoMap', v) }
  /** @returns {Texture | null} */
  get emissiveMap() { return this.#maps.emissiveMap }
  /** @param {MapInput | null} v */
  set emissiveMap(v) { this.setMap('emissiveMap', v) }

  /** @internal
   * @param {string} slot one of map, roughnessMap, metalnessMap, normalMap, aoMap, emissiveMap
   * @param {MapInput | null} value
   */
  setMap(slot, value) {
    if (value == null) {
      this.#maps[slot] = null
      return
    }
    if (value instanceof Texture) {
      // a data slot reads its texture as numbers, not colour: one left at the default colour space
      // (loadTexture('n.png'), say) is switched; one set to srgb on purpose is kept, with a word
      if (LINEAR_MAPS.has(slot) && value.colorSpace === 'srgb') {
        if (!value.colorSpaceSet) {
          value.colorSpace = 'linear'
          value.needsUpdate()
        } else warnOnce(value, `'${slot}' holds data, not colour, so its texture should be colorSpace: 'linear' - this one is 'srgb', and will be decoded as colour`)
      }
      this.#maps[slot] = value
      return
    }
    // descriptions and urls take the colour space the slot needs
    const options = typeof value === 'string' ? { url: value } : value
    if (typeof options !== 'object' || Array.isArray(options)) fail('Material', `'${slot}' must be a Texture, a url or texture options, got ${describe(value)}`)
    this.#maps[slot] = new Texture({ colorSpace: LINEAR_MAPS.has(slot) ? 'linear' : 'srgb', ...options })
  }

  /** The maps that are set, by slot. @returns {[string, Texture][]} */
  get textures() {
    return /** @type {[string, Texture][]} */ (Object.entries(this.#maps).filter(([, t]) => t))
  }

  /** Rendered in the transparent pass: an opacity below 1, additive or multiply blending, or set for maps with soft alpha. @returns {boolean} */
  get transparent() {
    return this.#transparent || this.opacity < 1 || this.transmission > 0 || this.blending !== 'normal'
  }
  /** @param {boolean} v */
  set transparent(v) { this.#transparent = !!v }

  /** @internal
   * Which shader features this material needs - renderers compile one program per distinct key.
   * @returns {string}
   */
  get variant() {
    const parts = [this.unlit ? 'unlit' : 'lit']
    for (const [slot] of this.textures) parts.push(slot)
    if (this.alphaTest > 0) parts.push('cutout')
    if (this.transmission > 0) parts.push('glass')
    if (this.clearcoat > 0) parts.push('clearcoat')
    if (this.flatShading) parts.push('flat')
    if (this.vertexColors) parts.push('vcolor')
    return parts.join('+')
  }

  /** Resolves when every texture has loaded. @returns {Promise<void>} */
  async ready() {
    await Promise.all(this.textures.map(([, t]) => t.ready))
  }

  /** @returns {Material} */
  clone() {
    const copy = new Material(this.toJSON(true))
    // the colours exactly: a description rounds them to 8-bit sRGB and can't hold values past 1
    copy.color.set(this.#color)
    copy.emissive.set(this.#emissive)
    return copy
  }

  /** Release GPU resources for this material (programs are shared and kept). */
  dispose() {
    for (const fn of this.#onDispose) fn()
  }

  /** @internal For renderers. Returns an unsubscribe function. @param {() => void} fn */
  onDispose(fn) {
    this.#onDispose.add(fn)
    return () => this.#onDispose.delete(fn)
  }

  /**
   * Options that differ from the defaults, ready for JSON.
   * @param {boolean} [keepTextures] keep Texture objects instead of their descriptions (for clone)
   * @returns {MaterialOptions}
   */
  toJSON(keepTextures = false) {
    /** @type {Record<string, unknown>} */
    const json = {}
    for (const [key, value] of Object.entries(DEFAULTS)) {
      if (this[key] !== value) json[key] = this[key]
    }
    if (this.#transparent) json.transparent = true
    if (this.#color.getHex() !== 0xffffff) json.color = this.#color.getStyle()
    if (this.#emissive.getHex() !== 0) json.emissive = this.#emissive.getStyle()
    for (const [slot, t] of this.textures) {
      const desc = keepTextures ? t : t.toJSON()
      if (desc) json[slot] = desc
    }
    return json
  }
}

/** @param {string} name @param {unknown} v */
function bool(name, v) {
  if (typeof v !== 'boolean') fail('Material', `'${name}' must be true or false, got ${describe(v)}`)
  return v
}

/** @param {string} name @param {unknown} v @param {number[]} limits */
function range(name, v, [min, max]) {
  checkNumber('Material', name, v)
  const n = /** @type {number} */ (v)
  if (n < min || n > max) fail('Material', `'${name}' must be ${max === Infinity ? `${min} or more` : `${min}-${max}`}, got ${n}`)
  return n
}
