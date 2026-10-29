import { Color } from '../value/Color.js'
import { Texture } from '../material/Texture.js'
import { checkNumber, describe, fail } from '../validate.js'
import { Fog } from '../fog.js'
import { NODE_OPTIONS, Node } from './Node.js'

/** @import { NodeOptions } from './Node.js' */
/** @import { ColorInput } from '../types.js' */
/** @import { TextureOptions } from '../material/Texture.js' */
/** @import { FogOptions } from '../fog.js' */

/** @typedef {'studio' | 'none'} EnvironmentPreset */

/**
 * @typedef {NodeOptions & {
 *   background?: ColorInput | Texture | TextureOptions | null,
 *   environment?: EnvironmentPreset | string | Texture | TextureOptions,
 *   environmentIntensity?: number,
 *   backgroundBlur?: number,
 *   fog?: FogOptions | Fog | null,
 * }} SceneOptions
 */

/**
 * The root of everything drawn. Each frame the View (or your own loop) calls update() and the
 * renderer draws what it holds.
 */
export class Scene extends Node {
  static type = 'scene'
  static get OPTIONS() { return [...NODE_OPTIONS, 'background', 'environment', 'environmentIntensity', 'backgroundBlur', 'fog'] }
  static HINTS = {
    fogColor: "use fog: { color, density }",
    lights: "add lights as children: scene.add(new DirectionalLight({ ... }))",
    envMap: "use 'environment': 'studio', or an .hdr url",
    environmentMap: "use 'environment': 'studio', or an .hdr url",
    backgroundBlurriness: "use 'backgroundBlur' (0-1)",
  }

  /** @type {Color | Texture | null} null = transparent */
  #background = null
  /** Image-based lighting for materials. @type {EnvironmentPreset | Texture} */
  #environment = 'none'
  /** Scales the environment's light. */
  environmentIntensity = 1
  /** 0-1: how blurred a panorama background is drawn - a soft backdrop that doesn't compete. */
  backgroundBlur = 0
  /** @type {Fog | null} */
  #fog = null

  /** @param {SceneOptions} [options] */
  constructor(options = {}) {
    super(options)
    if (options.background !== undefined) this.#setBackground(options.background)
    if (options.environment !== undefined) this.#setEnvironment(options.environment)
    if (options.environmentIntensity !== undefined) this.environmentIntensity = /** @type {number} */ (checkNumber('Scene', 'environmentIntensity', options.environmentIntensity))
    if (options.backgroundBlur !== undefined) this.backgroundBlur = /** @type {number} */ (checkNumber('Scene', 'backgroundBlur', options.backgroundBlur))
    if (options.fog != null) this.#fog = Fog.fromInput(options.fog, 'Scene')
  }

  /**
   * Distance fog, or null for none: set { color, density } (exponential, like mist) or
   * { color, near, far } (linear). Give the background the same colour, so distant things melt into
   * it; change its numbers in place to thicken or thin it. Materials with fog: false ignore it.
   * @returns {Fog | null}
   */
  get fog() { return this.#fog }
  /** @param {FogOptions | Fog | null} v */
  set fog(v) {
    this.#fog = v == null ? null : Fog.fromInput(v, 'Scene')
  }

  /**
   * A colour, a panorama (an equirectangular texture - often the environment itself), or null for
   * transparent. Assign any colour input. @returns {Color | Texture | null}
   */
  get background() { return this.#background }
  /** @param {ColorInput | Texture | TextureOptions | null} v */
  set background(v) {
    this.#setBackground(v)
  }

  /** @param {ColorInput | Texture | TextureOptions | null} v */
  #setBackground(v) {
    if (v == null) this.#background = null
    else if (v instanceof Texture) this.#background = v
    else if (typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v)) this.#background = new Texture(/** @type {TextureOptions} */ (v))
    else this.#background = Color.fromInput(/** @type {ColorInput} */ (v), 'Scene')
  }

  /**
   * Light from all around, reflected by every lit material: 'studio' (built in, no download),
   * 'none', or an equirectangular HDR image - a .hdr url or a Texture. @returns {EnvironmentPreset | Texture}
   */
  get environment() { return this.#environment }
  /** @param {EnvironmentPreset | string | Texture | TextureOptions} v */
  set environment(v) {
    this.#setEnvironment(v)
  }

  /** @param {EnvironmentPreset | string | Texture | TextureOptions} v */
  #setEnvironment(v) {
    if (v === 'studio' || v === 'none') this.#environment = v
    else if (typeof v === 'string' && /[./]/.test(v)) this.#environment = new Texture({ url: v, colorSpace: 'linear', mipmaps: false })
    else if (v instanceof Texture) this.#environment = v
    else if (v && typeof v === 'object') this.#environment = new Texture({ colorSpace: 'linear', mipmaps: false, .../** @type {TextureOptions} */ (v) })
    else fail('Scene', `'environment' must be 'studio', 'none', an .hdr url or a texture, got ${describe(v)}`)
  }

  /**
   * Advance one frame: run onUpdate handlers depth first, apply any removals they queued, then
   * bring every world matrix up to date.
   * @param {number} dt seconds since the last frame
   * @param {number} t seconds since the start
   * @returns {this}
   */
  update(dt, t) {
    runHandlers(this, dt, t, new Set())
    this.updateWorldTree()
    return this
  }

  /** Resolves when every texture in the scene has loaded. @returns {Promise<void>} */
  get ready() {
    /** @type {Promise<unknown>[]} */
    const waits = []
    if (this.#background instanceof Texture) waits.push(this.#background.ready)
    if (this.#environment instanceof Texture) waits.push(this.#environment.ready)
    this.traverse((n) => /** @type {any} */ (n).isDrawable && waits.push(/** @type {any} */ (n).material.ready()))
    return Promise.all(waits).then(() => {})
  }

  /** @returns {Record<string, unknown>} */
  cloneOptions() {
    return { ...super.cloneOptions(), background: this.#background, environment: this.#environment,
      environmentIntensity: this.environmentIntensity, backgroundBlur: this.backgroundBlur, fog: this.#fog ? this.#fog.toJSON() : null }
  }

  /** @returns {Record<string, unknown>} */
  jsonOptions() {
    /** @type {Record<string, unknown>} */
    const json = {}
    if (this.#background) {
      const bg = this.#background instanceof Texture ? this.#background.toJSON() : this.#background.toJSON()
      if (bg) json.background = bg
    }
    if (this.#environment !== 'none') {
      const env = typeof this.#environment === 'string' ? this.#environment : this.#environment.toJSON()
      if (env) json.environment = env
    }
    if (this.environmentIntensity !== 1) json.environmentIntensity = this.environmentIntensity
    if (this.backgroundBlur) json.backgroundBlur = this.backgroundBlur
    if (this.#fog) json.fog = this.#fog.toJSON()
    return json
  }
}

// Handlers run for invisible nodes too - behaviour may be what makes them visible again. Each
// node's children are copied before they are walked, so handlers can add, remove and move nodes -
// themselves included - without the walk skipping or losing one; a node that moves to a parent
// walked later still runs once a frame.
/** @param {Node} node @param {number} dt @param {number} t @param {Set<Node>} ran */
function runHandlers(node, dt, t, ran) {
  if (node.hasHandlers && !ran.has(node)) {
    ran.add(node)
    node.runHandlers(dt, t)
  }
  const children = node.children
  if (children.length) for (const child of [...children]) runHandlers(child, dt, t, ran)
}
