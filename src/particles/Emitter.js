// A particle system as one Points node: particles are born at the emitter's origin, move under
// velocity, gravity and drag, fade through a list of colours and die. The simulation runs in the
// emitter's own update handler, so it follows the scene clock (frame-rate independent) and its
// arrays go to the GPU as one buffer refill per frame. Particles that grow, fade or turn give the
// geometry per-point sizes, opacities or angles, and are drawn as squares.
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
 *   sort?: boolean,
 * } & LookOptions} EmitterOptions
 * max: most live particles at once (default 1000). rate: particles born per second (default 100).
 * gravity: acceleration, e.g. [0, -9.8, 0] (default none). drag: share of velocity lost per second
 * (default 0). follow: a node whose position becomes the origin each frame - a trail that stays
 * behind it. onParticle: called for every live particle each frame after it moves; return false to
 * remove it (a particle hitting something). sort: draw furthest first, for soft particles with
 * blending 'normal' (smoke) that would otherwise layer wrongly.
 */

/**
 * How particles look over their lives, beyond colour.
 * @typedef {object} LookOptions
 * @property {number | number[]} [size] a multiple of the material's size, or several each particle goes
 *   through over its life - [0.5, 3] for smoke that billows out (default 1)
 * @property {number} [sizeSpread] each particle's size varies by up to this share either way, 0-1 (default 0)
 * @property {number | number[]} [opacity] 0-1, or several each particle goes through - [0, 1, 0] fades in
 *   and out (default 1)
 * @property {number | [number, number]} [spin] radians per second: a number turns each particle up to that
 *   fast either way, [min, max] a range. Spinning particles start at a random angle (default 0)
 */

const SPAWN_OPTIONS = ['origin', 'originSpread', 'velocity', 'velocitySpread', 'lifetime', 'color']
const LOOK_OPTIONS = ['size', 'sizeSpread', 'opacity', 'spin']
const BEHAVIOUR_OPTIONS = ['rate', 'gravity', 'drag', 'follow', 'onParticle', ...LOOK_OPTIONS]
const OPTIONS = [...Points.OPTIONS, ...SPAWN_OPTIONS, 'max', ...BEHAVIOUR_OPTIONS]
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
// a spawn's random offsets, reused rather than made for each particle
const OFFSET = new Float64Array(3), SPREAD = new Float64Array(3)
// whether each palette id fades through colours, worked out once a step
const FADES = new Uint8Array(256)
// what a step changes when no colour did (Geometry.changedOnly)
const MOVED = Object.freeze(['positions', 'sizes', 'opacities', 'angles'])

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
  // the looks: stops over each particle's life, and each one's own size factor and turn rate
  /** @type {number[]} */ #size = [1]
  #sizeSpread = 0
  /** @type {number[]} */ #opacity = [1]
  /** @type {[number, number]} */ #spin = [0, 0]
  /** @type {Float32Array | null} */ #sizeFactors = null
  /** @type {Float32Array | null} */ #spins = null
  /** Last frame's origin, so a moving source leaves an even trail rather than clumps. */
  #lastOrigin = /** @type {Vec3 | null} */ (null)
  #particle = /** @type {Particle} */ ({ position: new Vec3(), velocity: new Vec3(), age: 0, lifetime: 0 })
  // A particle's colour, size and opacity are set when it is born, and painted again as it ages only
  // where they change over its life. When the colours or looks change, every live particle is
  // painted again on the next step.
  #repaint = false
  // Whether any colour changed since the last upload: with one colour, a particle born or moved
  // into a slot is painted as the one before it, so a step sends its positions alone.
  #colorsChanged = true

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
   * @param {SpawnOptions & LookOptions & { rate?: number, gravity?: Vec3Input, drag?: number, follow?: Node | null,
   *   onParticle?: ((p: Particle) => boolean | void) | null }} options
   * @returns {this}
   */
  set(options) {
    const known = [...SPAWN_OPTIONS, ...BEHAVIOUR_OPTIONS]
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
  set color(v) {
    this.#palettes[0] = colorStops(v)
    this.#repaint = true
  }
  /** @returns {[number, number, number][]} */
  get color() { return /** @type {[number, number, number][]} */ (this.#palettes[0].map((s) => [...s])) }

  /** Each particle's size over its life, as multiples of the material's. @param {number | number[]} v */
  set size(v) { this.#setLooks({ size: v }) }
  /** @returns {number[]} */
  get size() { return [...this.#size] }
  /** How much each particle's size varies, 0-1 either way. @param {number} v */
  set sizeSpread(v) { this.#setLooks({ sizeSpread: v }) }
  get sizeSpread() { return this.#sizeSpread }
  /** Each particle's opacity over its life. @param {number | number[]} v */
  set opacity(v) { this.#setLooks({ opacity: v }) }
  /** @returns {number[]} */
  get opacity() { return [...this.#opacity] }
  /** How fast particles turn, radians per second, as a [min, max] range. @param {number | [number, number]} v */
  set spin(v) { this.#setLooks({ spin: v }) }
  /** @returns {[number, number]} */
  get spin() { return [...this.#spin] }

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
    const g = this.geometry
    // In passes, each one loop doing one thing: a loop that also removes, paints and calls hooks is
    // compiled unevenly - the same step took 0.7 ms or 10 ms at 50,000 particles depending on which
    // of its branches the engine saw first. Every particle is still handled once a step.
    let alive = moveAll(this.#alive, g.positions, this.#velocities, this.#ages, this.gravity, Math.exp(-this.drag * dt), dt)
    const angles = g.angles, spins = this.#spins
    if (angles && spins) for (let i = 0; i < alive; i++) angles[i] += spins[i] * dt
    // the dead out: the last live particle into each one's place, then looked at in turn
    const ages = this.#ages, lives = this.#lifetimes
    for (let i = nextDead(ages, lives, 0, alive); i < alive; i = nextDead(ages, lives, i, alive)) {
      this.#remove(i)
      alive--
    }

    // painted as it ages: every particle when the looks change over a life (or just changed), else
    // only those fading through colours - none, usually, and then nothing is painted
    const looks = this.#repaint || (!!g.sizes && this.#size.length > 1) || (!!g.opacities && this.#opacity.length > 1)
    this.#repaint = false
    const fades = FADES.fill(0), palettes = this.#palettes
    let anyFade = false
    for (let id = 0; id < palettes.length; id++) if (palettes[id].length > 1) anyFade = !!(fades[id] = 1)
    if (looks || anyFade) {
      const ids = this.#palette
      for (let i = 0; i < alive; i++) if (looks || fades[ids[i]]) this.#paint(i, ages[i] / lives[i])
    }

    const hook = this.onParticle
    if (hook) {
      const p = g.positions, v = this.#velocities, particle = this.#particle
      for (let i = 0; i < alive;) {
        const i3 = i * 3
        particle.position.set(p[i3], p[i3 + 1], p[i3 + 2])
        particle.velocity.set(v[i3], v[i3 + 1], v[i3 + 2])
        particle.age = ages[i]
        particle.lifetime = lives[i]
        if (hook(particle) === false) {
          this.#remove(i)
          alive--
          continue
        }
        p.set(particle.position, i3)
        v.set(particle.velocity, i3)
        i++
      }
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
      drag: this.drag, follow: this.follow, onParticle: this.onParticle, color: this.color, ...this.#looks() }
  }

  /** @internal @returns {Record<string, unknown>} */
  jsonOptions() {
    const rest = super.jsonOptions()
    delete rest.geometry
    return { ...rest, max: this.#max, rate: this.rate, gravity: this.gravity.toArray(), drag: this.drag,
      origin: this.origin.toArray(), originSpread: this.originSpread, velocity: this.velocity.toArray(),
      velocitySpread: typeof this.velocitySpread === 'number' ? this.velocitySpread : this.velocitySpread.toArray(),
      lifetime: [...this.lifetime], color: this.#palettes[0].map((s) => new Color().setSRGB(s[0], s[1], s[2]).toJSON()),
      ...this.#looks() }
  }

  // birth one particle somewhere between a and b, already `head` seconds into its life
  /** @param {Vec3} a @param {Vec3} b @param {number} head */
  #spawn(a, b, head) {
    if (this.#alive >= this.#max) return
    const i = this.#alive++, i3 = i * 3
    const p = this.geometry.positions, v = this.#velocities
    const t = Math.random()
    const o = randomInBall(this.originSpread, OFFSET)
    const s = this.velocitySpread, dv = SPREAD
    if (typeof s === 'number') randomInBall(s, dv)
    else for (let k = 0; k < 3; k++) dv[k] = (Math.random() * 2 - 1) * s[k]
    for (let k = 0; k < 3; k++) {
      v[i3 + k] = this.velocity[k] + dv[k]
      p[i3 + k] = a[k] + (b[k] - a[k]) * t + o[k] + v[i3 + k] * head
    }
    const [min, max] = this.lifetime
    this.#lifetimes[i] = min + Math.random() * (max - min)
    this.#ages[i] = head
    this.#palette[i] = this.#spawnPalette
    if (this.#sizeFactors) this.#sizeFactors[i] = 1 + (Math.random() * 2 - 1) * this.#sizeSpread
    const angles = this.geometry.angles, spins = this.#spins
    if (angles && spins) {
      spins[i] = this.#spin[0] + Math.random() * (this.#spin[1] - this.#spin[0])
      angles[i] = Math.random() * Math.PI * 2 + spins[i] * head
    }
    this.#paint(i, head / this.#lifetimes[i])
  }

  // move the last particle into slot i
  /** @param {number} i */
  #remove(i) {
    const last = --this.#alive
    if (i === last) return
    const p = this.geometry.positions, c = /** @type {Float32Array} */ (this.geometry.colors), v = this.#velocities
    p.copyWithin(i * 3, last * 3, last * 3 + 3)
    const i3 = i * 3, l3 = last * 3
    if (c[i3] !== c[l3] || c[i3 + 1] !== c[l3 + 1] || c[i3 + 2] !== c[l3 + 2]) {
      c.copyWithin(i3, l3, l3 + 3)
      this.#colorsChanged = true
    }
    v.copyWithin(i * 3, last * 3, last * 3 + 3)
    this.#ages[i] = this.#ages[last]
    this.#lifetimes[i] = this.#lifetimes[last]
    this.#palette[i] = this.#palette[last]
    const { sizes, opacities, angles } = this.geometry, factors = this.#sizeFactors, spins = this.#spins
    if (sizes) sizes[i] = sizes[last]
    if (opacities) opacities[i] = opacities[last]
    if (angles) angles[i] = angles[last]
    if (factors) factors[i] = factors[last]
    if (spins) spins[i] = spins[last]
  }

  /** @param {number} i @param {number} t 0-1 through its life */
  #paint(i, t) {
    const { sizes, opacities } = this.geometry
    if (sizes) sizes[i] = along(this.#size, t) * (this.#sizeFactors ? this.#sizeFactors[i] : 1)
    if (opacities) opacities[i] = along(this.#opacity, t)
    const c = /** @type {Float32Array} */ (this.geometry.colors), stops = this.#palettes[this.#palette[i]], i3 = i * 3
    if (stops.length === 1) {
      const [r, g, b] = stops[0]
      // (compared as the array keeps it)
      if (c[i3] !== Math.fround(r) || c[i3 + 1] !== Math.fround(g) || c[i3 + 2] !== Math.fround(b)) {
        c[i3] = r
        c[i3 + 1] = g
        c[i3 + 2] = b
        this.#colorsChanged = true
      }
      return
    }
    this.#colorsChanged = true
    const x = Math.min(Math.max(t, 0), 1) * (stops.length - 1)
    const s = Math.min(Math.floor(x), stops.length - 2), f = x - s
    const a = stops[s], b = stops[s + 1]
    c[i * 3] = a[0] + (b[0] - a[0]) * f
    c[i * 3 + 1] = a[1] + (b[1] - a[1]) * f
    c[i * 3 + 2] = a[2] + (b[2] - a[2]) * f
  }

  #upload() {
    const g = this.geometry
    g.drawCount = this.#alive
    g.needsUpdate()
    // the colours, only when one changed - see #colorsChanged
    if (!this.#colorsChanged) g.changedOnly = MOVED
    this.#colorsChanged = false
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
    if (o.color !== undefined) {
      this.#palettes[0] = colorStops(o.color)
      this.#repaint = true
    }
  }

  /** @param {LookOptions & { rate?: number, gravity?: Vec3Input, drag?: number, follow?: Node | null, onParticle?: ((p: Particle) => boolean | void) | null }} o */
  #setBehaviour(o) {
    this.#setLooks(o)
    const owner = 'Emitter'
    if (o.rate !== undefined) this.rate = Math.max(0, checkNumber(owner, 'rate', o.rate))
    if (o.gravity !== undefined) this.gravity.copy(o.gravity, owner)
    if (o.drag !== undefined) this.drag = Math.max(0, checkNumber(owner, 'drag', o.drag))
    if (o.follow !== undefined) this.follow = checkFollow(o.follow)
    if (o.onParticle !== undefined) this.onParticle = o.onParticle
  }

  // Sizes, opacities and angles go on the geometry when first wanted (the points are then drawn as
  // squares) and stay; live particles get the plain values until they are next painted.
  /** @param {LookOptions} o */
  #setLooks(o) {
    const owner = 'Emitter', g = this.geometry, max = this.#max
    if (o.size !== undefined) this.#size = lookStops('size', o.size, Infinity)
    if (o.sizeSpread !== undefined) this.#sizeSpread = Math.min(Math.max(checkNumber(owner, 'sizeSpread', o.sizeSpread), 0), 1)
    if (o.opacity !== undefined) this.#opacity = lookStops('opacity', o.opacity, 1)
    if (o.spin !== undefined) this.#spin = spinRange(o.spin)
    const plain = (/** @type {number[]} */ stops) => stops.length === 1 && stops[0] === 1
    if (!g.sizes && (!plain(this.#size) || this.#sizeSpread)) g.sizes = new Float32Array(max).fill(1)
    if (!this.#sizeFactors && this.#sizeSpread) this.#sizeFactors = new Float32Array(max).fill(1)
    if (!g.opacities && !plain(this.#opacity)) g.opacities = new Float32Array(max).fill(1)
    if (o.size !== undefined || o.sizeSpread !== undefined || o.opacity !== undefined) this.#repaint = true
    if (!g.angles && (this.#spin[0] || this.#spin[1])) {
      g.angles = new Float32Array(max)
      this.#spins = new Float32Array(max)
    }
  }

  /** The looks, as options. @returns {LookOptions} */
  #looks() {
    return { size: unstop(this.#size), sizeSpread: this.#sizeSpread, opacity: unstop(this.#opacity),
      spin: /** @type {[number, number]} */ ([...this.#spin]) }
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
      // an old burst's colours given over to new ones: particles still fading through them repaint
      if (this.#palettes[id]) this.#repaint = true
      for (const [k, v] of this.#paletteIds) if (v === id) this.#paletteIds.delete(k)
      this.#paletteIds.set(key, id)
    }
    this.#palettes[id] = stops
    return id
  }
}

/**
 * Every live particle a step on: older, its velocity pulled by gravity and slowed by drag, moved by
 * it. One plain loop over typed arrays, and nothing else.
 * @param {number} alive @param {Float32Array} p positions @param {Float32Array} v velocities
 * @param {Float32Array} ages @param {ArrayLike<number>} gravity @param {number} keep what drag leaves
 * @param {number} dt @returns {number} alive, as given
 */
function moveAll(alive, p, v, ages, gravity, keep, dt) {
  const gx = gravity[0] * dt, gy = gravity[1] * dt, gz = gravity[2] * dt
  for (let i = 0, i3 = 0; i < alive; i++, i3 += 3) {
    ages[i] += dt
    const vx = (v[i3] + gx) * keep, vy = (v[i3 + 1] + gy) * keep, vz = (v[i3 + 2] + gz) * keep
    v[i3] = vx
    v[i3 + 1] = vy
    v[i3 + 2] = vz
    p[i3] += vx * dt
    p[i3 + 1] += vy * dt
    p[i3 + 2] += vz * dt
  }
  return alive
}

/**
 * The first particle from `from` on that has lived its life, or `alive` when none has.
 * @param {Float32Array} ages @param {Float32Array} lives @param {number} from @param {number} alive
 */
function nextDead(ages, lives, from, alive) {
  let i = from
  while (i < alive && ages[i] < lives[i]) i++
  return i
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

/** @param {string} name @param {number | number[]} v @param {number} most @returns {number[]} */
function lookStops(name, v, most) {
  const list = Array.isArray(v) ? v : [v]
  if (!list.length || !list.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) {
    fail('Emitter', `'${name}' must be a number of 0 or more, or a list of them a particle goes through, got ${describe(v)}`)
  }
  return list.map((n) => Math.min(n, most))
}

/** One stop as a number, several as a list. @param {number[]} stops @returns {number | number[]} */
function unstop(stops) {
  return stops.length === 1 ? stops[0] : [...stops]
}

/** The value t (0-1) of the way through evenly spaced stops. @param {number[]} stops @param {number} t */
function along(stops, t) {
  if (stops.length === 1) return stops[0]
  const x = Math.min(Math.max(t, 0), 1) * (stops.length - 1)
  const s = Math.min(Math.floor(x), stops.length - 2)
  return stops[s] + (stops[s + 1] - stops[s]) * (x - s)
}

/** @param {number | [number, number]} v @returns {[number, number]} */
function spinRange(v) {
  const range = typeof v === 'number' ? [-Math.abs(v), Math.abs(v)] : v
  if (!Array.isArray(range) || range.length !== 2 || !range.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    fail('Emitter', `'spin' must be radians per second, or a [min, max] range, got ${describe(v)}`)
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

/**
 * A random point within a ball of radius r, evenly spread, into `out`.
 * @param {number} r @param {Float64Array} out @returns {Float64Array}
 */
function randomInBall(r, out) {
  if (!r) return out.fill(0)
  let x, y, z
  do {
    x = Math.random() * 2 - 1
    y = Math.random() * 2 - 1
    z = Math.random() * 2 - 1
  } while (x * x + y * y + z * z > 1)
  out[0] = x * r
  out[1] = y * r
  out[2] = z * r
  return out
}
