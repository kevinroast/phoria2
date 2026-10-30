// A particle system as one Points node: particles are born at the emitter's origin, move under
// velocity, gravity and drag, fade through a list of colours and die. The simulation runs in the
// emitter's own update handler, so it follows the scene clock (frame-rate independent) and its
// arrays go to the GPU as one buffer refill per frame.
import * as mat4 from '../math/mat4.js'
import { Geometry } from '../geometry/Geometry.js'
import { Material } from '../material/Material.js'
import { Points } from '../scene/drawables.js'
import { Node } from '../scene/Node.js'
import { Color } from '../value/Color.js'
import { Vec3 } from '../value/Vec3.js'
import { checkNumber, describe, fail } from '../validate.js'

/** @import { MaterialOptions } from '../material/Material.js' */
/** @import { NodeOptions } from '../scene/Node.js' */
/** @import { ColorInput, Vec3Input } from '../types.js' */

/**
 * A live particle, as passed to `onParticle`. Change `position` or `velocity` and the changes stick.
 * @typedef {object} Particle
 * @property {Vec3} position in the emitter's space
 * @property {Vec3} velocity units per second
 * @property {number} age seconds since birth
 * @property {number} lifetime seconds it lives for
 */

/**
 * How particles are born. Each can also be passed to burst() for that burst alone.
 * @typedef {object} SpawnOptions
 * @property {Vec3Input} [origin] where particles start, in the emitter's space (default [0, 0, 0])
 * @property {number} [originSpread] start anywhere within this radius of the origin (default 0)
 * @property {Vec3Input} [velocity] starting velocity, units per second (default [0, 1, 0])
 * @property {number | Vec3Input} [velocitySpread] random extra velocity: a number spreads evenly in every
 *   direction (a sphere - explosions), [x, y, z] spreads up to ± that much per axis (default 0)
 * @property {number | [number, number]} [lifetime] seconds, or a [min, max] range (default 1)
 * @property {ColorInput | ColorInput[]} [color] a colour, or colours each particle fades through over its
 *   life - end on black to fade out with additive blending (default white)
 */

/**
 * @typedef {NodeOptions & SpawnOptions & {
 *   max?: number,
 *   rate?: number,
 *   gravity?: Vec3Input,
 *   drag?: number,
 *   follow?: Node | null,
 *   material?: Material | MaterialOptions,
 *   frustumCulled?: boolean,
 *   renderOrder?: number,
 *   onParticle?: ((p: Particle) => boolean | void) | null,
 * }} EmitterOptions
 * max: most live particles at once (default 1000). rate: particles born per second (default 100).
 * gravity: acceleration, e.g. [0, -9.8, 0] (default none). drag: share of velocity lost per second
 * (default 0). follow: a node whose position becomes the origin each frame - a trail that stays
 * behind it. onParticle: called for every live particle each frame after it moves; return false to
 * remove it (a particle hitting something).
 */

const SPAWN_OPTIONS = ['origin', 'originSpread', 'velocity', 'velocitySpread', 'lifetime', 'color']
const OPTIONS = [...Points.OPTIONS, ...SPAWN_OPTIONS,
  'max', 'rate', 'gravity', 'drag', 'follow', 'onParticle']
const HINTS = {
  count: "use 'max' for the most particles alive at once, 'rate' for how many are born per second",
  lifetimeRnd: "give 'lifetime' a [min, max] range",
  velocityRnd: "use 'velocitySpread'",
  positionRnd: "use 'originSpread'",
}
// the look most particle effects want: glowing dots that don't hide each other
/** @type {MaterialOptions} */
const DEFAULT_MATERIAL = { size: 0.1, vertexColors: true, blending: 'additive', depthWrite: false }

const tmpMat = new Float32Array(16)

/**
 * Particles drawn as points. Add it to a scene and it runs itself.
 *
 *     const sparks = scene.add(new Emitter({ rate: 200, velocitySpread: 2, gravity: [0, -9.8, 0], color: ['#ffd27f', '#000'] }))
 *     sparks.burst(500, { velocitySpread: 8 })
 */
export class Emitter extends Points {
  static type = 'emitter'
  static get OPTIONS() { return OPTIONS }
  static get HINTS() { return { ...Points.HINTS, ...HINTS } }

  /** Particles born per second; 0 stops new ones (existing particles live out their lives). */
  rate = 100
  /** Acceleration on every particle, units per second². */
  gravity = new Vec3()
  /** Share of velocity lost per second. */
  drag = 0
  /** Where particles start, in the emitter's space. */
  origin = new Vec3()
  originSpread = 0
  velocity = new Vec3(0, 1, 0)
  /** @type {number | Vec3} */ velocitySpread = 0
  /** @type {[number, number]} */ lifetime = [1, 1]
  /** A node whose position becomes the origin each frame. @type {Node | null} */
  follow = null
  /** @type {((p: Particle) => boolean | void) | null} */
  onParticle = null

  #max
  #alive = 0
  #due = 0
  /** @type {Float32Array} */ #velocities
  /** @type {Float32Array} */ #ages
  /** @type {Float32Array} */ #lifetimes
  // Colour stop lists, sRGB like geometry colours. Palette 0 is the emitter's own colour; bursts with
  // their own colours add more, and each particle remembers which one it fades through.
  /** @type {number[][][]} */ #palettes = [[[1, 1, 1]]]
  /** @type {Map<string, number>} */ #paletteIds = new Map()
  /** @type {Uint8Array} */ #palette
  #spawnPalette = 0
  /** Last frame's origin, so a moving source leaves an even trail rather than clumps. */
  #lastOrigin = /** @type {Vec3 | null} */ (null)
  #particle = /** @type {Particle} */ ({ position: new Vec3(), velocity: new Vec3(), age: 0, lifetime: 0 })

  /** @param {EmitterOptions} [options] */
  constructor(options = {}) {
    if (/** @type {any} */ (options)?.geometry !== undefined) fail('Emitter', "an Emitter makes its own geometry - size it with 'max'")
    const max = options?.max ?? 1000
    if (!Number.isInteger(max) || max < 1) fail('Emitter', `'max' must be a whole number of 1 or more, got ${describe(max)}`)
    const given = options?.material
    if (given !== undefined && !(given instanceof Material) && (!given || typeof given !== 'object' || Array.isArray(given))) {
      fail('Emitter', `'material' is a Material or material options such as { size: 0.2 }, got ${describe(given)}`)
    }
    const material = given instanceof Material ? given : { ...DEFAULT_MATERIAL, ...given }
    const geometry = new Geometry({ positions: new Float32Array(max * 3), colors: new Float32Array(max * 3) })
    geometry.drawCount = 0
    super({ ...options, geometry, material })
    this.#max = max
    this.#velocities = new Float32Array(max * 3)
    this.#ages = new Float32Array(max)
    this.#lifetimes = new Float32Array(max)
    this.#palette = new Uint8Array(max)
    // particles spread anywhere, and stale slots would make bounds meaningless
    if (options.frustumCulled === undefined) this.frustumCulled = false

    this.#setBehaviour(options)
    this.#setSpawn(options)
    this.onUpdate((_, dt) => this.step(dt))
  }

  /**
   * Change several settings at once - a preset, say. Vectors are copied into the emitter's own,
   * so anything bound to `emitter.gravity` and friends stays bound. Live particles carry on.
   * @param {SpawnOptions & { rate?: number, gravity?: Vec3Input, drag?: number, follow?: Node | null,
   *   onParticle?: ((p: Particle) => boolean | void) | null }} options
   * @returns {this}
   */
  set(options) {
    const known = [...SPAWN_OPTIONS, 'rate', 'gravity', 'drag', 'follow', 'onParticle']
    for (const key of Object.keys(options ?? {})) {
      if (!known.includes(key)) fail('Emitter', `set() doesn't take '${key}' - it takes ${known.join(', ')}`)
    }
    this.#setBehaviour(options)
    this.#setSpawn(options)
    return this
  }

  /** Most live particles at once. */
  get max() { return this.#max }

  /** Particles alive now. */
  get count() { return this.#alive }

  /** The colours particles fade through - one or several. @param {ColorInput | ColorInput[]} v */
  set color(v) { this.#palettes[0] = colorStops(v) }
  /** @returns {[number, number, number][]} */
  get color() { return /** @type {[number, number, number][]} */ (this.#palettes[0].map((s) => [...s])) }

  /**
   * Birth `count` particles at once - explosions, splashes. Options override the emitter's own
   * spawn settings for this burst only.
   * @param {number} count
   * @param {SpawnOptions} [options]
   * @returns {this}
   */
  burst(count, options = {}) {
    for (const key of Object.keys(options)) {
      if (!SPAWN_OPTIONS.includes(key)) fail('Emitter', `burst() doesn't take '${key}' - it takes ${SPAWN_OPTIONS.join(', ')}`)
    }
    const { color, ...spawn } = options
    const saved = this.#saveSpawn()
    this.#setSpawn(spawn)
    if (color !== undefined) this.#spawnPalette = this.#paletteFor(colorStops(color))
    const origin = this.origin.clone()
    for (let i = 0; i < count; i++) this.#spawn(origin, origin, 0)
    this.#setSpawn(saved)
    this.#spawnPalette = 0
    this.#upload()
    return this
  }

  /** Remove every particle. @returns {this} */
  clear() {
    this.#alive = 0
    this.#due = 0
    this.#upload()
    return this
  }

  /**
   * Advance the simulation by dt seconds. The emitter's update handler calls this each frame; call
   * it yourself only for an emitter outside a running scene.
   * @param {number} dt
   */
  step(dt) {
    if (dt <= 0) return
    const p = this.geometry.positions
    const v = this.#velocities, ages = this.#ages, lives = this.#lifetimes
    const g = this.gravity, keep = Math.exp(-this.drag * dt)
    const hook = this.onParticle, particle = this.#particle

    for (let i = 0; i < this.#alive;) {
      const age = ages[i] += dt
      if (age >= lives[i]) {
        this.#remove(i)
        continue
      }
      const i3 = i * 3
      for (let k = 0; k < 3; k++) {
        v[i3 + k] = (v[i3 + k] + g[k] * dt) * keep
        p[i3 + k] += v[i3 + k] * dt
      }
      this.#paint(i, age / lives[i])
      if (hook) {
        particle.position.set(p[i3], p[i3 + 1], p[i3 + 2])
        particle.velocity.set(v[i3], v[i3 + 1], v[i3 + 2])
        particle.age = age
        particle.lifetime = lives[i]
        if (hook(particle) === false) {
          this.#remove(i)
          continue
        }
        p.set(particle.position, i3)
        v.set(particle.velocity, i3)
      }
      i++
    }

    // new particles, spread along the path the origin took this frame
    const origin = this.#followedOrigin()
    const from = this.#lastOrigin ?? origin
    this.#due += this.rate * dt
    const born = Math.floor(this.#due)
    this.#due -= born
    for (let n = 0; n < born; n++) this.#spawn(from, origin, (n + Math.random()) / born * dt)
    this.#lastOrigin = origin.clone()
    this.#upload()
  }

  /** @internal @returns {Record<string, unknown>} */
  cloneOptions() {
    // an emitter makes its own geometry, so neither form carries it
    const rest = super.cloneOptions()
    delete rest.geometry
    return { ...rest, ...this.#saveSpawn(), max: this.#max, rate: this.rate, gravity: this.gravity.clone(),
      drag: this.drag, follow: this.follow, onParticle: this.onParticle, color: this.color }
  }

  /** @internal @returns {Record<string, unknown>} */
  jsonOptions() {
    const rest = super.jsonOptions()
    delete rest.geometry
    return { ...rest, max: this.#max, rate: this.rate, gravity: this.gravity.toArray(), drag: this.drag,
      origin: this.origin.toArray(), originSpread: this.originSpread, velocity: this.velocity.toArray(),
      velocitySpread: typeof this.velocitySpread === 'number' ? this.velocitySpread : this.velocitySpread.toArray(),
      lifetime: [...this.lifetime], color: this.#palettes[0].map((s) => new Color().setSRGB(s[0], s[1], s[2]).toJSON()) }
  }

  // birth one particle somewhere between a and b, already `head` seconds into its life
  /** @param {Vec3} a @param {Vec3} b @param {number} head */
  #spawn(a, b, head) {
    if (this.#alive >= this.#max) return
    const i = this.#alive++, i3 = i * 3
    const p = this.geometry.positions, v = this.#velocities
    const t = Math.random()
    const o = randomInBall(this.originSpread)
    const s = this.velocitySpread
    const dv = typeof s === 'number' ? randomInBall(s) : [(Math.random() * 2 - 1) * s[0], (Math.random() * 2 - 1) * s[1], (Math.random() * 2 - 1) * s[2]]
    for (let k = 0; k < 3; k++) {
      v[i3 + k] = this.velocity[k] + dv[k]
      p[i3 + k] = a[k] + (b[k] - a[k]) * t + o[k] + v[i3 + k] * head
    }
    const [min, max] = this.lifetime
    this.#lifetimes[i] = min + Math.random() * (max - min)
    this.#ages[i] = head
    this.#palette[i] = this.#spawnPalette
    this.#paint(i, head / this.#lifetimes[i])
  }

  // move the last particle into slot i
  /** @param {number} i */
  #remove(i) {
    const last = --this.#alive
    if (i === last) return
    const p = this.geometry.positions, c = /** @type {Float32Array} */ (this.geometry.colors), v = this.#velocities
    p.copyWithin(i * 3, last * 3, last * 3 + 3)
    c.copyWithin(i * 3, last * 3, last * 3 + 3)
    v.copyWithin(i * 3, last * 3, last * 3 + 3)
    this.#ages[i] = this.#ages[last]
    this.#lifetimes[i] = this.#lifetimes[last]
    this.#palette[i] = this.#palette[last]
  }

  /** @param {number} i @param {number} t 0-1 through its life */
  #paint(i, t) {
    const c = /** @type {Float32Array} */ (this.geometry.colors), stops = this.#palettes[this.#palette[i]]
    if (stops.length === 1) {
      c.set(stops[0], i * 3)
      return
    }
    const x = Math.min(Math.max(t, 0), 1) * (stops.length - 1)
    const s = Math.min(Math.floor(x), stops.length - 2), f = x - s
    const a = stops[s], b = stops[s + 1]
    c[i * 3] = a[0] + (b[0] - a[0]) * f
    c[i * 3 + 1] = a[1] + (b[1] - a[1]) * f
    c[i * 3 + 2] = a[2] + (b[2] - a[2]) * f
  }

  #upload() {
    this.geometry.drawCount = this.#alive
    this.geometry.needsUpdate()
  }

  /** The followed node's position in the emitter's space, or the origin. @returns {Vec3} */
  #followedOrigin() {
    if (!this.follow) return this.origin
    const world = this.follow.worldPosition
    if (!mat4.invert(tmpMat, this.worldMatrix)) return this.origin
    return this.origin.copy(world).applyMatrix4(tmpMat)
  }

  /** @param {SpawnOptions} o */
  #setSpawn(o) {
    const owner = 'Emitter'
    // vectors are copied in place, so references to them stay live
    if (o.origin !== undefined) this.origin.copy(o.origin, owner)
    if (o.originSpread !== undefined) this.originSpread = Math.max(0, checkNumber(owner, 'originSpread', o.originSpread))
    if (o.velocity !== undefined) this.velocity.copy(o.velocity, owner)
    if (o.velocitySpread !== undefined) {
      const s = o.velocitySpread
      if (typeof s === 'number') this.velocitySpread = checkNumber(owner, 'velocitySpread', s)
      else if (this.velocitySpread instanceof Vec3) this.velocitySpread.copy(s, owner)
      else this.velocitySpread = Vec3.fromInput(s, owner)
    }
    if (o.lifetime !== undefined) this.lifetime = lifetimeRange(o.lifetime)
    if (o.color !== undefined) this.#palettes[0] = colorStops(o.color)
  }

  /** @param {{ rate?: number, gravity?: Vec3Input, drag?: number, follow?: Node | null, onParticle?: ((p: Particle) => boolean | void) | null }} o */
  #setBehaviour(o) {
    const owner = 'Emitter'
    if (o.rate !== undefined) this.rate = Math.max(0, checkNumber(owner, 'rate', o.rate))
    if (o.gravity !== undefined) this.gravity.copy(o.gravity, owner)
    if (o.drag !== undefined) this.drag = Math.max(0, checkNumber(owner, 'drag', o.drag))
    if (o.follow !== undefined) this.follow = checkFollow(o.follow)
    if (o.onParticle !== undefined) this.onParticle = o.onParticle
  }

  /** The spawn settings other than colour, as options. @returns {SpawnOptions} */
  #saveSpawn() {
    return { origin: this.origin.clone(), originSpread: this.originSpread, velocity: this.velocity.clone(),
      velocitySpread: typeof this.velocitySpread === 'number' ? this.velocitySpread : this.velocitySpread.clone(),
      lifetime: /** @type {[number, number]} */ ([...this.lifetime]) }
  }

  // The palette id for a burst's colours, reused when the same colours come again. Ids are a byte
  // per particle, so past 255 distinct burst palettes the oldest is overwritten.
  /** @param {number[][]} stops @returns {number} */
  #paletteFor(stops) {
    const key = stops.flat().join()
    let id = this.#paletteIds.get(key)
    if (id === undefined) {
      id = this.#palettes.length < 256 ? this.#palettes.length : 1 + (this.#paletteIds.size % 255)
      for (const [k, v] of this.#paletteIds) if (v === id) this.#paletteIds.delete(k)
      this.#paletteIds.set(key, id)
    }
    this.#palettes[id] = stops
    return id
  }
}

/** @param {unknown} v @returns {Node | null} */
function checkFollow(v) {
  if (v === null || v instanceof Node) return /** @type {Node | null} */ (v)
  return fail('Emitter', `'follow' must be a node, got ${describe(v)}`)
}

/** @param {number | [number, number]} v @returns {[number, number]} */
function lifetimeRange(v) {
  const range = typeof v === 'number' ? [v, v] : v
  if (!Array.isArray(range) || range.length !== 2 || !range.every((n) => typeof n === 'number' && n > 0)) {
    fail('Emitter', `'lifetime' must be seconds above 0, or a [min, max] range, got ${describe(v)}`)
  }
  return [Math.min(range[0], range[1]), Math.max(range[0], range[1])]
}

/** @param {ColorInput | ColorInput[]} v @returns {number[][]} */
function colorStops(v) {
  // a single [r, g, b] array is one colour, not three
  const list = Array.isArray(v) && !(v.length === 3 && v.every((n) => typeof n === 'number')) ? v : [v]
  if (!list.length) fail('Emitter', "'color' needs at least one colour")
  return list.map((c) => Color.fromInput(/** @type {ColorInput} */ (c), 'Emitter').toSRGB())
}

/** A random point within a ball of radius r, evenly spread. @param {number} r @returns {number[]} */
function randomInBall(r) {
  if (!r) return [0, 0, 0]
  let x, y, z
  do {
    x = Math.random() * 2 - 1
    y = Math.random() * 2 - 1
    z = Math.random() * 2 - 1
  } while (x * x + y * y + z * z > 1)
  return [x * r, y * r, z * r]
}
