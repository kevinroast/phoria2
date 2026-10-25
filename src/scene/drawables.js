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
 * data: what this node shows - picking hands it back as hit.datum. For InstancedMesh and Points an
 * array is one row per instance or point, and hit.datum is the row that was hit.
 */

/**
 * Where a label sits and how it competes for space.
 * @typedef {object} LabelPlacement
 * @property {LabelPlace} [place] where the label goes relative to its point (default 'center')
 * @property {[number, number]} [offset] extra shift in CSS pixels, +y down (default [0, 0])
 * @property {string} [className] CSS class(es) for the label element
 * @property {number} [priority] when labels overlap, the higher priority stays (default 0)
 * @property {'hide' | 'show'} [overlap] 'hide' drops this label when a higher-priority one is in the way;
 *   'show' always shows it (default 'hide')
 * @property {boolean} [occlude] hide the label when geometry is in front of its point (default false)
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
const PLACEMENT_OPTIONS = ['place', 'offset', 'className', 'priority', 'overlap', 'occlude']
const LABEL_HINTS = {
  anchor: "use place: 'center' | 'above' | 'below' | 'left' | 'right' (where the label goes)",
  position: 'labels per instance sit on their instance - offset moves them in pixels',
  zIndex: "use 'priority': higher stays when labels overlap",
  collision: "use overlap: 'hide' | 'show'",
}

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
    overlap: o.overlap === undefined ? 'hide' : checkOneOf(owner, 'overlap', o.overlap, ['hide', 'show']),
    occlude: !!o.occlude,
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
      fail(owner, `unknown labels option '${key}'${LABEL_HINTS[key] ? ` - ${LABEL_HINTS[key]}` : ` - expected text, at, ${PLACEMENT_OPTIONS.join(', ')}`}`)
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
  userData: "use 'data' for what this node shows - picking returns it as hit.datum",
  rows: "use 'data' - one row per instance or point",
}

/** Base for nodes with geometry and a material: Mesh, InstancedMesh, Points and Lines. */
export class Drawable extends Node {
  static OPTIONS = DRAWABLE_OPTIONS
  static HINTS = DRAWABLE_HINTS

  /** @type {Geometry} */ geometry
  /** @type {Material} */ material
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
    this.geometry = resolveGeometry(options.geometry, owner)
    this.material = resolveMaterial(options.material)
    if (options.castShadow !== undefined) this.castShadow = !!options.castShadow
    if (options.receiveShadow !== undefined) this.receiveShadow = !!options.receiveShadow
    if (options.renderOrder !== undefined) this.renderOrder = checkNumber(owner, 'renderOrder', options.renderOrder)
    if (options.frustumCulled !== undefined) this.frustumCulled = !!options.frustumCulled
    if (options.data !== undefined) this.data = options.data
    this.checkGeometry()
  }

  /**
   * The data for a hit: this node's row at `index` when data is an array and the node draws many
   * things (instances, points), otherwise the data itself.
   * @param {number | null} index
   * @returns {any}
   */
  datumAt(index) {
    const many = 'instanceMatrices' in this || this.drawMode === 'points'
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
    for (let i = 0; i < count; i++) mat4.identity(this.instanceMatrices.subarray(i * 16, i * 16 + 16))
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
    for (const key of Object.keys(options)) {
      if (!INSTANCE_OPTIONS.has(key)) fail('InstancedMesh', `unknown instance option '${key}' - expected position, rotation, quaternion, scale or color`)
    }
    const position = options.position !== undefined ? Vec3.fromInput(options.position, 'InstancedMesh') : new Vec3()
    const scale = options.scale !== undefined ? Vec3.fromInput(options.scale, 'InstancedMesh') : new Vec3(1, 1, 1)
    const q = new Quat()
    if (options.quaternion) q.copy(options.quaternion, 'InstancedMesh').normalize()
    else if (options.rotation) {
      const r = options.rotation instanceof Euler ? options.rotation : new Euler().copy(/** @type {any} */ (options.rotation), 'InstancedMesh')
      q.setFromEuler(r.x, r.y, r.z)
    }
    mat4.fromRotationTranslationScale(this.instanceMatrices.subarray(i * 16, i * 16 + 16), q, position, scale)
    if (options.color !== undefined) this.#setColor(i, options.color)
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
    const local = this.geometry.bounds
    const m = new Float32Array(16)
    for (let i = 0; i < this.count; i++) {
      mat4.multiply(m, this.worldMatrix, this.instanceMatrices.subarray(i * 16, i * 16 + 16))
      box.union(local.clone().applyMatrix4(m))
    }
    return box
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
  /** 'hide' gives way to higher-priority labels; 'show' always shows. @type {'hide' | 'show'} */
  overlap = 'hide'
  /** Hide the label when geometry is in front of its point. */
  occlude = false

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

  /** @returns {Record<string, unknown>} */
  cloneOptions() {
    return { ...super.cloneOptions(), text: this.text, className: this.className, place: this.place,
      offset: [...this.offset], priority: this.priority, overlap: this.overlap, occlude: this.occlude }
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
    return json
  }
}
