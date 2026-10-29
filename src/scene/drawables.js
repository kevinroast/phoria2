import * as mat4 from '../math/mat4.js'
import { Color } from '../value/Color.js'
import { Euler } from '../value/Euler.js'
import { Quat } from '../value/Quat.js'
import { Vec3 } from '../value/Vec3.js'
import { checkNumber, checkOneOf, describe, fail } from '../validate.js'
import { resolveGeometry, resolveMaterial } from '../resolve.js'
import { NODE_OPTIONS, Node } from './Node.js'

/** @import { Box3 } from '../value/Box3.js' */
/** @import { Geometry } from '../geometry/Geometry.js' */
/** @import { Material, MaterialOptions } from '../material/Material.js' */
/** @import { GeometryOptions } from '../geometry/Geometry.js' */
/** @import { NodeOptions } from './Node.js' */
/** @import { ColorInput, Vec3Input } from '../types.js' */

/**
 * @typedef {NodeOptions & {
 *   geometry: Geometry | GeometryOptions,
 *   material?: Material | MaterialOptions,
 *   castShadow?: boolean,
 *   receiveShadow?: boolean,
 *   renderOrder?: number,
 *   frustumCulled?: boolean,
 *   data?: unknown,
 * }} DrawableOptions
 * data: what this node shows - picking hands it back as hit.datum. An array is one row per instance
 * (InstancedMesh), point (Points) or segment (Lines); on a Mesh, an array as long as its vertices is
 * a row per vertex, and a hit gives the nearest vertex's row (a surface).
 */

/**
 * Where a label sits and how it competes for space.
 * @typedef {object} LabelPlacement
 * @property {LabelPlace} [place] where the label goes relative to its point (default 'center')
 * @property {[number, number]} [offset] extra shift in CSS pixels, +y down (default [0, 0])
 * @property {string} [className] CSS class(es) for the label element
 * @property {number} [priority] when labels overlap, the higher priority stays (default 0)
 * @property {'hide' | 'dim' | 'show'} [overlap] when the label is covered - by a higher-priority label, or by
 *   geometry with occlude - 'hide' drops it, 'dim' draws it faint and behind; 'show' always shows it (default 'hide')
 * @property {boolean} [occlude] the label counts as covered when geometry is in front of its point (default false)
 * @property {boolean} [leader] a line from the label's point to the label, with a dot on the point - for
 *   callouts set off to the side with offset, as on a diagram (default false). It takes the label's text
 *   colour; style it with CSS on .phoria-leader
 * @property {'left' | 'right' | null} [edge] set the label at the view's left or right edge, level with its
 *   point - callouts in a column down the side of a diagram, with leader: true. offset then moves it in from
 *   the edge and up or down (default null: by its point)
 */
/** @typedef {'center' | 'above' | 'below' | 'left' | 'right'} LabelPlace */

/**
 * One label per instance or point, from its row of data.
 * @typedef {Omit<LabelPlacement, 'priority'> & {
 *   text: (datum: any, index: number) => string | number | null | undefined,
 *   priority?: number | ((datum: any, index: number) => number),
 *   at?: 'top' | 'center',
 * }} InstanceLabels
 * text: the label for a row - return null for none. priority: a number, or one per row (say, by
 * status, so problems win the space). at: the instance's top (default) or centre; points always
 * label the point itself.
 */

export const LABEL_PLACES = /** @type {LabelPlace[]} */ (['center', 'above', 'below', 'left', 'right'])
const PLACEMENT_OPTIONS = ['place', 'offset', 'className', 'priority', 'overlap', 'occlude', 'leader', 'edge']
const LABEL_HINTS = {
  line: 'use leader: true - a line from the point to the label',
  callout: "use leader: true, with edge: 'left' | 'right' to line the labels up down the side",
  column: "use edge: 'left' | 'right' - the label sits at that edge of the view, level with its point",
  align: "use edge: 'left' | 'right' - the label sits at that edge of the view, level with its point",
  pointer: 'use leader: true - a line from the point to the label',
  anchor: "use place: 'center' | 'above' | 'below' | 'left' | 'right' (where the label goes)",
  zIndex: "use 'priority': higher stays when labels overlap",
  collision: "use overlap: 'hide' | 'dim' | 'show'",
}
// labels per instance or point take one more: they can't be moved anywhere but by offset
const INSTANCE_LABEL_HINTS = { ...LABEL_HINTS, position: 'labels per instance sit on their instance - offset moves them in pixels' }

/**
 * Validated placement options, with defaults filled in.
 * @param {string} owner @param {Record<string, any>} o
 * @returns {Required<LabelPlacement>}
 */
function placement(owner, o) {
  const offset = o.offset ?? [0, 0]
  if (!Array.isArray(offset) || offset.length !== 2 || !offset.every(Number.isFinite)) {
    fail(owner, `'offset' must be [x, y] in pixels, got ${describe(offset)}`)
  }
  return {
    place: o.place === undefined ? 'center' : checkOneOf(owner, 'place', o.place, LABEL_PLACES),
    offset: /** @type {[number, number]} */ ([offset[0], offset[1]]),
    className: o.className ? String(o.className) : '',
    priority: o.priority === undefined ? 0 : checkNumber(owner, 'priority', o.priority),
    overlap: o.overlap === undefined ? 'hide' : checkOneOf(owner, 'overlap', o.overlap, ['hide', 'dim', 'show']),
    occlude: !!o.occlude,
    leader: !!o.leader,
    edge: o.edge == null ? null : /** @type {'left' | 'right'} */ (checkOneOf(owner, 'edge', o.edge, ['left', 'right'])),
  }
}

/** @param {string} owner @param {unknown} v @returns {(InstanceLabels & Required<Omit<LabelPlacement, 'priority'>> & { priority: number | ((datum: any, index: number) => number) }) | null} */
function instanceLabels(owner, v) {
  if (v == null) return null
  if (typeof v !== 'object' || typeof (/** @type {any} */ (v)).text !== 'function') {
    fail(owner, `'labels' must be { text: (datum, index) => string, ... }, got ${describe(v)}`)
  }
  const o = /** @type {Record<string, any>} */ (v)
  for (const key of Object.keys(o)) {
    if (key !== 'text' && key !== 'at' && !PLACEMENT_OPTIONS.includes(key)) {
      fail(owner, `unknown labels option '${key}'${INSTANCE_LABEL_HINTS[key] ? ` - ${INSTANCE_LABEL_HINTS[key]}` : ` - expected text, at, ${PLACEMENT_OPTIONS.join(', ')}`}`)
    }
  }
  const at = o.at === undefined ? 'top' : checkOneOf(owner, 'labels.at', o.at, ['top', 'center'])
  const byRow = typeof o.priority === 'function'
  const style = placement(owner, byRow ? { ...o, priority: 0 } : o)
  return { text: o.text, at, ...style, priority: byRow ? o.priority : style.priority }
}

const DRAWABLE_OPTIONS = [...NODE_OPTIONS, 'geometry', 'material', 'castShadow', 'receiveShadow', 'renderOrder', 'frustumCulled', 'data']

const DRAWABLE_HINTS = {
  mesh: "pass 'geometry' and 'material' directly",
  materials: "one 'material' per node - use a Group of meshes for several",
  rows: "use 'data' - one row per instance or point",
}

/** Base for nodes with geometry and a material: Mesh, InstancedMesh, Points and Lines. */
export class Drawable extends Node {
  static OPTIONS = DRAWABLE_OPTIONS
  static HINTS = DRAWABLE_HINTS

  /** @type {Geometry} */ #geometry
  /** @type {Material} */ #material
  castShadow = false
  receiveShadow = false
  /** Draw order override within its pass; lower first. */
  renderOrder = 0
  /** Skip drawing when outside the camera's view. */
  frustumCulled = true
  /** What this node shows: one row per instance or point for InstancedMesh and Points. Picking returns it as hit.datum. */
  data = /** @type {any} */ (null)

  /** @param {DrawableOptions} options */
  constructor(options) {
    super(options)
    const owner = this.constructor.name
    if (!options || options.geometry === undefined) {
      fail(owner, `'geometry' is required, e.g. new ${owner}({ geometry: box(1), material: { color: 'orange' } })`)
    }
    this.#geometry = resolveGeometry(options.geometry, owner)
    this.#material = resolveMaterial(options.material)
    if (options.castShadow !== undefined) this.castShadow = !!options.castShadow
    if (options.receiveShadow !== undefined) this.receiveShadow = !!options.receiveShadow
    if (options.renderOrder !== undefined) this.renderOrder = checkNumber(owner, 'renderOrder', options.renderOrder)
    if (options.frustumCulled !== undefined) this.frustumCulled = !!options.frustumCulled
    if (options.data !== undefined) this.data = options.data
    this.checkGeometry()
  }

  /** What it draws. Assign a Geometry, or a description of one; it is checked as the constructor checks it. @returns {Geometry} */
  get geometry() { return this.#geometry }
  /** @param {Geometry | import('../geometry/Geometry.js').GeometryOptions} v */
  set geometry(v) {
    this.#geometry = resolveGeometry(v, this.constructor.name)
    this.checkGeometry()
  }

  /** How it looks. Assign a Material, or its options - mesh.material = { color: 'red' } makes one. @returns {Material} */
  get material() { return this.#material }
  /** @param {Material | import('../material/Material.js').MaterialOptions} v */
  set material(v) { this.#material = resolveMaterial(v) }

  /**
   * The data for a hit: this node's row at `index` when data is an array and the node draws many
   * things (instances, points, line segments), otherwise the data itself.
   * @param {number | null} index
   * @returns {any}
   */
  datumAt(index) {
    const many = 'instanceMatrices' in this || this.drawMode !== 'triangles'
    if (many && Array.isArray(this.data)) return index === null ? null : this.data[index] ?? null
    return this.data ?? null
  }

  /** True for anything with geometry and a material - lets renderers test without importing this class. */
  get isDrawable() {
    return true
  }

  /** How the geometry is drawn: 'triangles', 'points' or 'lines'. @returns {'triangles' | 'points' | 'lines'} */
  get drawMode() {
    return 'triangles'
  }

  /** @internal Subclasses check the geometry suits them. */
  checkGeometry() {}

  /** @param {Box3} box */
  expandBounds(box) {
    if (this.geometry.vertexCount) box.union(this.geometry.bounds.clone().applyMatrix4(this.worldMatrix))
    return box
  }

  /** @returns {Record<string, unknown>} */
  cloneOptions() {
    return {
      ...super.cloneOptions(),
      geometry: this.geometry,
      material: this.material,
      castShadow: this.castShadow,
      receiveShadow: this.receiveShadow,
      renderOrder: this.renderOrder,
      frustumCulled: this.frustumCulled,
      data: this.data,
    }
  }

  /** @returns {Record<string, unknown>} */
  jsonOptions() {
    /** @type {Record<string, unknown>} */
    const json = { geometry: this.geometry.toJSON(), material: this.material.toJSON() }
    if (this.castShadow) json.castShadow = true
    if (this.receiveShadow) json.receiveShadow = true
    if (this.renderOrder) json.renderOrder = this.renderOrder
    if (!this.frustumCulled) json.frustumCulled = false
    if (this.data != null) json.data = this.data
    return json
  }

  /** Release this node's geometry, material and textures from the GPU (and its children's). */
  dispose() {
    this.geometry.dispose()
    this.material.dispose()
    for (const [, t] of this.material.textures) t.dispose()
    super.dispose()
  }
}

/** Triangles: the usual solid object. */
export class Mesh extends Drawable {
  static type = 'mesh'

  checkGeometry() {
    const n = this.geometry.elementCount
    if (n % 3 !== 0) {
      fail('Mesh', `geometry has ${n} ${this.geometry.indices ? 'indices' : 'vertices'}, not a multiple of 3 - ` +
        'triangles need three each (use Lines for pairs, Points for single vertices)')
    }
  }
}

/**
 * @typedef {object} InstanceOptions
 * @property {Vec3Input} [position]
 * @property {Vec3Input | Euler} [rotation] Euler angles in radians, XYZ order
 * @property {ArrayLike<number>} [quaternion]
 * @property {Vec3Input | number} [scale]
 * @property {ColorInput} [color] multiplies the material colour
 */

const INSTANCE_OPTIONS = new Set(['position', 'rotation', 'quaternion', 'scale', 'color'])
// reused by setInstance, so updating every instance of a large mesh each frame allocates nothing
const scratch = { position: new Vec3(), scale: new Vec3(), quaternion: new Quat(), rotation: new Euler() }
const scratchMatrix = new Float32Array(16)

/**
 * Many copies of one geometry and material, drawn together. Set each copy with setInstance().
 * Picking reports which instance was hit.
 */
export class InstancedMesh extends Mesh {
  static type = 'instanced-mesh'
  static get OPTIONS() { return [...DRAWABLE_OPTIONS, 'count', 'instances', 'instanceMatrices', 'instanceColors', 'labels'] }

  /** How many instances are drawn (at most the count it was created with). */
  count = 0
  /** A 4x4 matrix per instance. @type {Float32Array} */
  instanceMatrices
  /** Linear rgb per instance, or null until a colour is set. @type {Float32Array | null} */
  instanceColors = null
  /** Bumped when instance data changes, so renderers re-upload. */
  version = 0
  /** A label per instance, from its row of data. @type {ReturnType<typeof instanceLabels>} */
  labels = null

  /**
   * @param {DrawableOptions & { count?: number, instances?: InstanceOptions[], instanceMatrices?: ArrayLike<number>,
   *   instanceColors?: ArrayLike<number>, labels?: InstanceLabels | null }} options count defaults to the number
   *   of instances or rows of data; instanceMatrices/instanceColors are raw data, as toJSON() writes
   */
  constructor(options) {
    super(options)
    this.labels = instanceLabels('InstancedMesh', options.labels)
    const count = options.count ?? options.instances?.length ?? (Array.isArray(options.data) ? options.data.length : undefined)
    if (!Number.isInteger(count) || count < 0) fail('InstancedMesh', `'count' must be a whole number, got ${describe(count)}`)
    this.count = count
    this.instanceMatrices = new Float32Array(count * 16)
    // identity matrices: just the diagonal, written straight in
    const m = this.instanceMatrices
    for (let o = 0; o < m.length; o += 16) m[o] = m[o + 5] = m[o + 10] = m[o + 15] = 1
    options.instances?.forEach((inst, i) => this.setInstance(i, inst))
    if (options.instanceMatrices) {
      if (options.instanceMatrices.length !== count * 16) fail('InstancedMesh', `'instanceMatrices' needs ${count * 16} numbers (16 per instance)`)
      this.instanceMatrices.set(options.instanceMatrices)
    }
    if (options.instanceColors) {
      if (options.instanceColors.length !== count * 3) fail('InstancedMesh', `'instanceColors' needs ${count * 3} numbers (linear rgb per instance)`)
      this.instanceColors = Float32Array.from(options.instanceColors)
    }
  }

  /**
   * Set an instance's transform and optional colour. Unset transform parts default to identity.
   * @param {number} i
   * @param {InstanceOptions} options
   * @returns {this}
   */
  setInstance(i, options) {
    this.#checkIndex(i)
    for (const key in options) {
      if (!INSTANCE_OPTIONS.has(key)) fail('InstancedMesh', `unknown instance option '${key}' - expected position, rotation, quaternion, scale or color`)
    }
    const { position, scale, quaternion: q } = scratch
    if (options.position !== undefined) position.copy(options.position, 'InstancedMesh')
    else position.set(0, 0, 0)
    if (options.scale !== undefined) {
      if (typeof options.scale === 'number') scale.set(options.scale, options.scale, options.scale)
      else scale.copy(options.scale, 'InstancedMesh')
    } else scale.set(1, 1, 1)
    q.set(0, 0, 0, 1)
    if (options.quaternion) q.copy(options.quaternion, 'InstancedMesh').normalize()
    else if (options.rotation) {
      const r = options.rotation instanceof Euler ? options.rotation : scratch.rotation.copy(/** @type {any} */ (options.rotation), 'InstancedMesh')
      q.setFromEuler(r.x, r.y, r.z)
    }
    mat4.fromRotationTranslationScale(this.instanceMatrices.subarray(i * 16, i * 16 + 16), q, position, scale)
    if (options.color !== undefined) this.#setColor(i, options.color)
    this.version++
    return this
  }

  /**
   * Say instanceMatrices or instanceColors were written directly - the fast path for large data:
   * write the arrays (16 numbers a matrix, column-major; linear rgb), then call this once.
   *
   *     const m = bars.instanceMatrices
   *     for (let i = 0; i < n; i++) m[i * 16 + 5] = heights[i]   // y scale
   *     bars.needsUpdate()
   * @returns {this}
   */
  needsUpdate() {
    this.version++
    return this
  }

  /**
   * Set just an instance's colour, leaving its transform alone - for highlighting a picked instance.
   * @param {number} i
   * @param {ColorInput} color multiplies the material colour
   * @returns {this}
   */
  setColor(i, color) {
    this.#checkIndex(i)
    this.#setColor(i, color)
    this.version++
    return this
  }

  /** @param {number} i */
  #checkIndex(i) {
    if (!Number.isInteger(i) || i < 0 || i >= this.instanceMatrices.length / 16) {
      fail('InstancedMesh', `instance ${describe(i)} is out of range 0-${this.instanceMatrices.length / 16 - 1}`)
    }
  }

  /** @param {number} i @param {ColorInput} color */
  #setColor(i, color) {
    if (!this.instanceColors) this.instanceColors = new Float32Array(this.instanceMatrices.length / 16 * 3).fill(1)
    this.instanceColors.set(Color.fromInput(color, 'InstancedMesh'), i * 3)
  }

  /** @param {Box3} box */
  expandBounds(box) {
    this.eachInstanceBox((x0, y0, z0, x1, y1, z1) => {
      box.expandByXYZ(x0, y0, z0)
      box.expandByXYZ(x1, y1, z1)
    })
    return box
  }

  /**
   * @internal Each instance's world box, as its low and high corners - for fitting a view round the
   * instances themselves rather than the box round them all.
   * @param {(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => void} fn
   */
  eachInstanceBox(fn) {
    if (!this.count || !this.geometry.vertexCount) return
    const local = this.geometry.bounds
    // each instance's box from the geometry's centre and half size: the centre moves with the
    // matrix, and the half size grows by the matrix's absolute values - no allocation per instance
    const cx = (local.min[0] + local.max[0]) / 2, cy = (local.min[1] + local.max[1]) / 2, cz = (local.min[2] + local.max[2]) / 2
    const ex = (local.max[0] - local.min[0]) / 2, ey = (local.max[1] - local.min[1]) / 2, ez = (local.max[2] - local.min[2]) / 2
    const w = this.worldMatrix, im = this.instanceMatrices, m = scratchMatrix
    for (let i = 0; i < this.count; i++) {
      mat4.multiply(m, w, im.subarray(i * 16, i * 16 + 16))
      const x = m[0] * cx + m[4] * cy + m[8] * cz + m[12]
      const y = m[1] * cx + m[5] * cy + m[9] * cz + m[13]
      const z = m[2] * cx + m[6] * cy + m[10] * cz + m[14]
      const hx = Math.abs(m[0]) * ex + Math.abs(m[4]) * ey + Math.abs(m[8]) * ez
      const hy = Math.abs(m[1]) * ex + Math.abs(m[5]) * ey + Math.abs(m[9]) * ez
      const hz = Math.abs(m[2]) * ex + Math.abs(m[6]) * ey + Math.abs(m[10]) * ez
      fn(x - hx, y - hy, z - hz, x + hx, y + hy, z + hz)
    }
  }

  /** @returns {Record<string, unknown>} */
  cloneOptions() {
    return { ...super.cloneOptions(), count: this.count, labels: this.labels }
  }

  clone(options) {
    const copy = super.clone(options)
    copy.instanceMatrices.set(this.instanceMatrices)
    if (this.instanceColors) copy.instanceColors = this.instanceColors.slice()
    return copy
  }

  /** @returns {Record<string, unknown>} */
  jsonOptions() {
    return { ...super.jsonOptions(), count: this.count, instanceMatrices: Array.from(this.instanceMatrices),
      ...(this.instanceColors ? { instanceColors: Array.from(this.instanceColors) } : {}) }
  }
}

/** Each vertex drawn as a square point sprite: star fields, particles, scatter plots. */
export class Points extends Drawable {
  static type = 'points'
  static get OPTIONS() { return [...DRAWABLE_OPTIONS, 'labels'] }

  /** A label per point, from its row of data. @type {ReturnType<typeof instanceLabels>} */
  labels = null

  /** @param {DrawableOptions & { labels?: InstanceLabels | null }} options */
  constructor(options) {
    super(options)
    this.labels = instanceLabels(this.constructor.name, options?.labels)
  }

  /** @returns {Record<string, unknown>} */
  cloneOptions() {
    return { ...super.cloneOptions(), labels: this.labels }
  }

  /** @returns {'points'} */
  get drawMode() {
    return 'points'
  }
}

/**
 * Line segments: indices (or consecutive vertices) in pairs. Width is in pixels and works on
 * every platform. edges(geometry) makes a wireframe of any geometry.
 */
export class Lines extends Drawable {
  static type = 'lines'

  /** @returns {'lines'} */
  get drawMode() {
    return 'lines'
  }

  checkGeometry() {
    const n = this.geometry.elementCount
    if (n % 2 !== 0) fail('Lines', `geometry has ${n} ${this.geometry.indices ? 'indices' : 'vertices'} - segments need them in pairs`)
  }
}

/**
 * @typedef {NodeOptions & LabelPlacement & { text: string | number }} LabelOptions
 */

/**
 * HTML text pinned to a 3D position: crisp at any pixel ratio and styleable with CSS. Hidden when
 * behind the camera or invisible.
 */
export class Label extends Node {
  static type = 'label'
  static get OPTIONS() { return [...NODE_OPTIONS, 'text', ...PLACEMENT_OPTIONS] }
  static get HINTS() { return LABEL_HINTS }

  text = ''
  /** CSS class(es) for the label element. */
  className = ''
  /** Where the label goes relative to its point. @type {LabelPlace} */
  place = 'center'
  /** Extra shift in CSS pixels, +y down. @type {[number, number]} */
  offset = [0, 0]
  /** When labels overlap, the higher priority stays. */
  priority = 0
  /** When covered by a higher-priority label (or geometry, with occlude): 'hide' drops it, 'dim' fades it, 'show' always shows it. @type {'hide' | 'dim' | 'show'} */
  overlap = 'hide'
  /** The label counts as covered when geometry is in front of its point. */
  occlude = false
  /** A line from the label's point to the label, for callouts. */
  leader = false
  /** Set at the view's left or right edge, level with its point, or null for by its point. @type {'left' | 'right' | null} */
  edge = null

  /** @param {LabelOptions} options */
  constructor(options) {
    super(options)
    if (typeof options?.text !== 'string' && typeof options?.text !== 'number') {
      fail('Label', `'text' is required, got ${describe(options?.text)}`)
    }
    this.text = String(options.text)
    Object.assign(this, placement('Label', options))
  }

  /** Lets renderers spot labels without importing this class. */
  get isLabel() {
    return true
  }

  /** @internal A label counts as the point it is pinned to, so framing leaves room for axis ticks and titles. @param {Box3} box */
  expandBounds(box) {
    return box.expandByPoint(this.worldPosition)
  }

  /** @returns {Record<string, unknown>} */
  cloneOptions() {
    return { ...super.cloneOptions(), text: this.text, className: this.className, place: this.place,
      offset: [...this.offset], priority: this.priority, overlap: this.overlap, occlude: this.occlude, leader: this.leader, edge: this.edge }
  }

  /** @returns {Record<string, unknown>} */
  jsonOptions() {
    /** @type {Record<string, unknown>} */
    const json = { text: this.text }
    if (this.className) json.className = this.className
    if (this.place !== 'center') json.place = this.place
    if (this.offset[0] || this.offset[1]) json.offset = [...this.offset]
    if (this.priority) json.priority = this.priority
    if (this.overlap !== 'hide') json.overlap = this.overlap
    if (this.occlude) json.occlude = true
    if (this.leader) json.leader = true
    if (this.edge) json.edge = this.edge
    return json
  }
}
