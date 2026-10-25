import * as mat4 from '../math/mat4.js'
import { Color } from '../value/Color.js'
import { Euler } from '../value/Euler.js'
import { Quat } from '../value/Quat.js'
import { Vec3 } from '../value/Vec3.js'
import { checkNumber, describe, fail } from '../validate.js'
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
 * }} DrawableOptions
 */

const DRAWABLE_OPTIONS = [...NODE_OPTIONS, 'geometry', 'material', 'castShadow', 'receiveShadow', 'renderOrder', 'frustumCulled']

const DRAWABLE_HINTS = {
  mesh: "pass 'geometry' and 'material' directly",
  materials: "one 'material' per node - use a Group of meshes for several",
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
    this.checkGeometry()
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
  static get OPTIONS() { return [...DRAWABLE_OPTIONS, 'count', 'instances', 'instanceMatrices', 'instanceColors'] }

  /** How many instances are drawn (at most the count it was created with). */
  count = 0
  /** A 4x4 matrix per instance. @type {Float32Array} */
  instanceMatrices
  /** Linear rgb per instance, or null until a colour is set. @type {Float32Array | null} */
  instanceColors = null
  /** Bumped when instance data changes, so renderers re-upload. */
  version = 0

  /**
   * @param {DrawableOptions & { count: number, instances?: InstanceOptions[], instanceMatrices?: ArrayLike<number>,
   *   instanceColors?: ArrayLike<number> }} options instanceMatrices/instanceColors are raw data, as toJSON() writes
   */
  constructor(options) {
    super(options)
    const count = options.count ?? options.instances?.length
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
    return { ...super.cloneOptions(), count: this.count }
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
 * @typedef {NodeOptions & { text: string, className?: string }} LabelOptions
 */

/**
 * HTML text pinned to a 3D position: crisp at any pixel ratio and styleable with CSS. Hidden when
 * behind the camera or invisible.
 */
export class Label extends Node {
  static type = 'label'
  static get OPTIONS() { return [...NODE_OPTIONS, 'text', 'className'] }

  text = ''
  /** CSS class(es) for the label element. */
  className = ''

  /** @param {LabelOptions} options */
  constructor(options) {
    super(options)
    if (typeof options?.text !== 'string' && typeof options?.text !== 'number') {
      fail('Label', `'text' is required, got ${describe(options?.text)}`)
    }
    this.text = String(options.text)
    if (options.className) this.className = String(options.className)
  }

  /** Lets renderers spot labels without importing this class. */
  get isLabel() {
    return true
  }

  /** @returns {Record<string, unknown>} */
  cloneOptions() {
    return { ...super.cloneOptions(), text: this.text, className: this.className }
  }

  /** @returns {Record<string, unknown>} */
  jsonOptions() {
    return { text: this.text, ...(this.className ? { className: this.className } : {}) }
  }
}
