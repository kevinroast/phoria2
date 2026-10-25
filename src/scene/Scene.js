import { Color } from '../value/Color.js'
import { Texture } from '../material/Texture.js'
import { checkNumber, describe, fail } from '../validate.js'
import { NODE_OPTIONS, Node, beginWalk, endWalk } from './Node.js'

/** @import { NodeOptions } from './Node.js' */
/** @import { ColorInput } from '../types.js' */
/** @import { TextureOptions } from '../material/Texture.js' */

/** @typedef {'studio' | 'none'} EnvironmentPreset */

/**
 * @typedef {NodeOptions & {
 *   background?: ColorInput | Texture | TextureOptions | null,
 *   environment?: EnvironmentPreset | string | Texture | TextureOptions,
 *   environmentIntensity?: number,
 *   backgroundBlur?: number,
 * }} SceneOptions
 */

/**
 * The root of everything drawn. Each frame the View (or your own loop) calls update() and the
 * renderer draws what it holds.
 */
export class Scene extends Node {
  static type = 'scene'
  static get OPTIONS() { return [...NODE_OPTIONS, 'background', 'environment', 'environmentIntensity', 'backgroundBlur'] }
  static HINTS = {
    fog: "fog isn't supported - see API-DESIGN.md's non-goals",
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

  /** @param {SceneOptions} [options] */
  constructor(options = {}) {
    super(options)
    if (options.background !== undefined) this.#setBackground(options.background)
    if (options.environment !== undefined) this.#setEnvironment(options.environment)
    if (options.environmentIntensity !== undefined) this.environmentIntensity = /** @type {number} */ (checkNumber('Scene', 'environmentIntensity', options.environmentIntensity))
    if (options.backgroundBlur !== undefined) this.backgroundBlur = /** @type {number} */ (checkNumber('Scene', 'backgroundBlur', options.backgroundBlur))
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
    beginWalk()
    try {
      runHandlers(this, dt, t)
    } finally {
      endWalk()
    }
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
      environmentIntensity: this.environmentIntensity, backgroundBlur: this.backgroundBlur }
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
    return json
  }
}

// Handlers run for invisible nodes too - behaviour may be what makes them visible again. Children
// are read by index with the length taken up front, so handlers can add nodes (seen next frame);
// removals are deferred until the walk ends.
/** @param {Node} node @param {number} dt @param {number} t */
function runHandlers(node, dt, t) {
  if (node.hasHandlers) node.runHandlers(dt, t)
  const children = node.children
  for (let i = 0, n = children.length; i < n; i++) runHandlers(children[i], dt, t)
}
