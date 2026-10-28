import { Color } from '../value/Color.js'
import { Vec3 } from '../value/Vec3.js'
import { checkNumber, fail } from '../validate.js'
import { NODE_OPTIONS, Node } from './Node.js'

/** @import { NodeOptions } from './Node.js' */
/** @import { ColorInput, Vec3Input } from '../types.js' */

/** @typedef {NodeOptions & { color?: ColorInput, intensity?: number }} LightOptions */
/** @typedef {'ambient' | 'hemisphere' | 'directional' | 'point' | 'spot'} LightKind */

const LIGHT_OPTIONS = [...NODE_OPTIONS, 'color', 'intensity']
const LIGHT_HINTS = {
  distance: "use 'range' (0 = infinite)",
  decay: 'falloff is physical (inverse square), as in glTF - limit it with range',
  attenuation: "use 'range' - falloff is physical (inverse square)",
  shadow: "use 'castShadow: true' (directional and spot lights)",
}

/**
 * Base for lights. Colour and intensity follow glTF's KHR_lights_punctual, so loaded scenes light
 * the same; colours are ordinary colour inputs, the same as materials.
 */
export class Light extends Node {
  static OPTIONS = LIGHT_OPTIONS
  static HINTS = LIGHT_HINTS
  /** What kind of light, for renderers - read without importing every light class. @type {LightKind} */
  static kind = 'ambient'

  /** @returns {LightKind} */
  get lightKind() {
    return /** @type {typeof Light} */ (this.constructor).kind
  }

  #color = new Color(0xffffff)
  intensity = 1

  /** @param {LightOptions} [options] */
  constructor(options = {}) {
    super(options)
    const owner = this.constructor.name
    if (options.color !== undefined) this.#color.set(options.color, owner)
    if (options.intensity !== undefined) {
      this.intensity = checkNumber(owner, 'intensity', options.intensity)
      if (this.intensity < 0) fail(owner, `'intensity' can't be negative, got ${this.intensity}`)
    }
  }

  /** @returns {Color} */
  get color() { return this.#color }
  /** @param {ColorInput} v */
  set color(v) { this.#color.set(v, this.constructor.name) }

  /** @returns {Record<string, unknown>} */
  cloneOptions() {
    return { ...super.cloneOptions(), color: this.#color.clone(), intensity: this.intensity }
  }

  /** @returns {Record<string, unknown>} */
  jsonOptions() {
    /** @type {Record<string, unknown>} */
    const json = {}
    if (this.#color.getHex() !== 0xffffff) json.color = this.#color.getStyle()
    if (this.intensity !== 1) json.intensity = this.intensity
    return json
  }
}

/** Light from everywhere equally: lifts the shadows. */
export class AmbientLight extends Light {
  static type = 'ambient-light'
  /** @type {LightKind} */
  static kind = 'ambient'
}

/** Cheap outdoor fill: sky colour from above blending to ground colour from below. */
export class HemisphereLight extends Light {
  static type = 'hemisphere-light'
  /** @type {LightKind} */
  static kind = 'hemisphere'
  // 'color' is accepted too: the constructor passes 'sky' on as the base light colour
  static get OPTIONS() { return [...NODE_OPTIONS, 'sky', 'ground', 'intensity', 'color'] }

  #ground = new Color(0x444444)

  /** @param {NodeOptions & { sky?: ColorInput, ground?: ColorInput, intensity?: number }} [options] */
  constructor(options = {}) {
    const { sky, ground, ...rest } = options
    super(sky !== undefined ? { ...rest, color: sky } : rest)
    if (ground !== undefined) this.#ground.set(ground, 'HemisphereLight')
  }

  /** The colour from above (same as `color`). @returns {Color} */
  get sky() { return this.color }
  /** @param {ColorInput} v */
  set sky(v) { this.color.set(v, 'HemisphereLight') }
  /** The colour from below. @returns {Color} */
  get ground() { return this.#ground }
  /** @param {ColorInput} v */
  set ground(v) { this.#ground.set(v, 'HemisphereLight') }

  /** @returns {Record<string, unknown>} */
  cloneOptions() {
    const { color, ...rest } = super.cloneOptions()
    return { ...rest, sky: color, ground: this.#ground.clone() }
  }

  /** @returns {Record<string, unknown>} */
  jsonOptions() {
    const { color, ...rest } = super.jsonOptions()
    return { ...rest, ...(color ? { sky: color } : {}), ...(this.#ground.getHex() !== 0x444444 ? { ground: this.#ground.getStyle() } : {}) }
  }
}

/**
 * @typedef {LightOptions & { direction?: Vec3Input, target?: Vec3Input }} AimedLightOptions
 * direction: the way the light travels; target: a point it shines towards, in the same space as
 * position. Give one or the other.
 */

/** Shared by lights that point somewhere. */
class AimedLight extends Light {
  /** The way the light travels, in the parent's space; ignored when `target` is set. @type {Vec3} */
  direction = new Vec3(0, -1, 0)
  /** A point to shine towards, in the same space as position. @type {Vec3 | null} */
  target = null

  /** @param {AimedLightOptions} [options] */
  constructor(options = {}) {
    super(options)
    const owner = this.constructor.name
    if (options.direction !== undefined && options.target !== undefined) {
      fail(owner, "give 'direction' or 'target', not both")
    }
    if (options.direction !== undefined) {
      this.direction.copy(options.direction, owner)
      if (this.direction.len() === 0) fail(owner, "'direction' can't be [0, 0, 0]")
      this.direction.normalize()
    }
    if (options.target !== undefined) this.target = Vec3.fromInput(options.target, owner)
  }

  /** The light's direction in world space, as of the last update. @returns {Vec3} */
  get worldDirection() {
    const local = this.target ? this.target.clone().sub(this.position) : this.direction.clone()
    const m = this.parent ? this.parent.worldMatrix : null
    if (m) {
      // directions transform without translation
      const [x, y, z] = local
      local.set(m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z)
    }
    return local.normalize()
  }

  /** @returns {Record<string, unknown>} */
  cloneOptions() {
    return { ...super.cloneOptions(), ...(this.target ? { target: this.target.toArray() } : { direction: this.direction.toArray() }) }
  }

  /** @returns {Record<string, unknown>} */
  jsonOptions() {
    return { ...super.jsonOptions(), ...(this.target ? { target: this.target.toArray() } : { direction: this.direction.toArray() }) }
  }
}

/** Parallel light from far away, like the sun. Position only matters for its shadow. */
export class DirectionalLight extends AimedLight {
  static type = 'directional-light'
  /** @type {LightKind} */
  static kind = 'directional'
  static get OPTIONS() { return [...LIGHT_OPTIONS, 'direction', 'target', 'castShadow'] }

  castShadow = false

  /** @param {AimedLightOptions & { castShadow?: boolean }} [options] */
  constructor(options = {}) {
    super(options)
    if (options.castShadow !== undefined) this.castShadow = !!options.castShadow
  }

  /** @returns {Record<string, unknown>} */
  cloneOptions() {
    return { ...super.cloneOptions(), castShadow: this.castShadow }
  }

  /** @returns {Record<string, unknown>} */
  jsonOptions() {
    return { ...super.jsonOptions(), ...(this.castShadow ? { castShadow: true } : {}) }
  }
}

/** Light from a point in all directions, falling off with the square of the distance. */
export class PointLight extends Light {
  static type = 'point-light'
  /** @type {LightKind} */
  static kind = 'point'
  static get OPTIONS() { return [...LIGHT_OPTIONS, 'range'] }

  /** Distance where the light fades to nothing; 0 for unlimited. */
  range = 0

  /** @param {LightOptions & { range?: number }} [options] */
  constructor(options = {}) {
    super(options)
    if (options.range !== undefined) this.range = rangeOf(this.constructor.name, options.range)
  }

  /** @returns {Record<string, unknown>} */
  cloneOptions() {
    return { ...super.cloneOptions(), range: this.range }
  }

  /** @returns {Record<string, unknown>} */
  jsonOptions() {
    return { ...super.jsonOptions(), ...(this.range ? { range: this.range } : {}) }
  }
}

/** A cone of light from a point. */
export class SpotLight extends AimedLight {
  static type = 'spot-light'
  /** @type {LightKind} */
  static kind = 'spot'
  static get OPTIONS() { return [...LIGHT_OPTIONS, 'direction', 'target', 'range', 'angle', 'penumbra', 'castShadow'] }

  range = 0
  /** Cast shadows: up to four spot lights a scene can. Anything round the light itself - its own lamp - doesn't block it. */
  castShadow = false
  /** Half-angle of the cone in radians. */
  angle = Math.PI / 6
  /** Softness of the edge, 0 (hard) to 1. */
  penumbra = 0.1

  /** @param {AimedLightOptions & { range?: number, angle?: number, penumbra?: number, castShadow?: boolean }} [options] */
  constructor(options = {}) {
    super(options)
    if (options.castShadow !== undefined) this.castShadow = !!options.castShadow
    if (options.range !== undefined) this.range = rangeOf('SpotLight', options.range)
    if (options.angle !== undefined) {
      this.angle = checkNumber('SpotLight', 'angle', options.angle)
      if (this.angle <= 0 || this.angle > Math.PI / 2) fail('SpotLight', `'angle' is the cone's half-angle in radians, above 0 and up to PI/2, got ${this.angle}`)
    }
    if (options.penumbra !== undefined) {
      this.penumbra = checkNumber('SpotLight', 'penumbra', options.penumbra)
      if (this.penumbra < 0 || this.penumbra > 1) fail('SpotLight', `'penumbra' must be 0-1, got ${this.penumbra}`)
    }
  }

  /** @returns {Record<string, unknown>} */
  cloneOptions() {
    return { ...super.cloneOptions(), range: this.range, angle: this.angle, penumbra: this.penumbra, castShadow: this.castShadow }
  }

  /** @returns {Record<string, unknown>} */
  jsonOptions() {
    /** @type {Record<string, unknown>} */
    const json = super.jsonOptions()
    if (this.range) json.range = this.range
    if (this.angle !== Math.PI / 6) json.angle = this.angle
    if (this.penumbra !== 0.1) json.penumbra = this.penumbra
    if (this.castShadow) json.castShadow = true
    return json
  }
}

/** @param {string} owner @param {unknown} v */
function rangeOf(owner, v) {
  const r = checkNumber(owner, 'range', v)
  if (r < 0) fail(owner, `'range' can't be negative (0 means unlimited), got ${r}`)
  return r
}
