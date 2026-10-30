import * as quat from '../math/quat.js'
import { describe, fail } from '../validate.js'

/**
 * A rotation quaternion [x, y, z, w]: a Float32Array(4) with accessors and chainable methods.
 * A node's quaternion and its Euler `rotation` keep each other in sync through these setters;
 * writing by index (e.g. passing it as `out` to a quat function) does not, so call `changed()`
 * afterwards when doing that.
 */
export class Quat extends Float32Array {
  static get [Symbol.species]() { return Float32Array }

  /** @internal Called after any change made through the methods below. @type {(() => void) | null} */
  onChange = null

  /** @param {number} [x] @param {number} [y] @param {number} [z] @param {number} [w] */
  constructor(x = 0, y = 0, z = 0, w = 1) {
    super(4)
    this[0] = x
    this[1] = y
    this[2] = z
    this[3] = w
  }

  get x() { return this[0] }
  set x(v) { this[0] = v; this.changed() }
  get y() { return this[1] }
  set y(v) { this[1] = v; this.changed() }
  get z() { return this[2] }
  set z(v) { this[2] = v; this.changed() }
  get w() { return this[3] }
  set w(v) { this[3] = v; this.changed() }

  /** @internal Notify the owner after editing by index. @returns {this} */
  changed() {
    this.onChange?.()
    return this
  }

  /**
   * @overload
   * @param {number} x @param {number} y @param {number} z @param {number} w
   * @returns {this}
   */
  /**
   * @overload
   * @param {ArrayLike<number>} array @param {number} [offset]
   * @returns {void}
   */
  /** @param {number | ArrayLike<number>} x @param {number} [y] @param {number} [z] @param {number} [w] */
  set(x, y, z, w) {
    if (typeof x !== 'number') {
      super.set(x, y ?? 0)
      this.changed()
      return
    }
    this[0] = x
    this[1] = y
    this[2] = z
    this[3] = w
    return this.changed()
  }

  /** @param {ArrayLike<number>} q [x, y, z, w] @param {string} [owner] @returns {this} */
  copy(q, owner = 'Quat') {
    if (!q || typeof q !== 'object' || !(q.length >= 4)) fail(owner, `expected a quaternion [x, y, z, w], got ${describe(q)}`)
    this[0] = q[0]
    this[1] = q[1]
    this[2] = q[2]
    this[3] = q[3]
    return this.changed()
  }

  /** @returns {Quat} */
  clone() {
    return new Quat(this[0], this[1], this[2], this[3])
  }

  /** @returns {this} */
  identity() {
    return this.set(0, 0, 0, 1)
  }

  /** Euler angles in radians, XYZ order. @param {number} x @param {number} y @param {number} z @returns {this} */
  setFromEuler(x, y, z) {
    quat.fromEulerXYZ(this, x, y, z)
    return this.changed()
  }

  /** @param {ArrayLike<number>} axis normalised @param {number} rad @returns {this} */
  setFromAxisAngle(axis, rad) {
    quat.setAxisAngle(this, /** @type {number[]} */ (axis), rad)
    return this.changed()
  }

  /** this = this * q (rotate by q in the local frame) @param {ArrayLike<number>} q @returns {this} */
  multiply(q) {
    quat.multiply(this, this, /** @type {number[]} */ (q))
    return this.changed()
  }

  /** this = q * this (rotate by q in the parent frame) @param {ArrayLike<number>} q @returns {this} */
  premultiply(q) {
    quat.multiply(this, /** @type {number[]} */ (q), this)
    return this.changed()
  }

  /** @returns {this} */
  normalize() {
    quat.normalize(this, this)
    return this.changed()
  }

  /** @returns {this} */
  invert() {
    quat.invert(this, this)
    return this.changed()
  }

  /** @param {ArrayLike<number>} q @param {number} t @returns {this} */
  slerp(q, t) {
    quat.slerp(this, this, /** @type {number[]} */ (q), t)
    return this.changed()
  }

  /** @returns {[number, number, number, number]} */
  toArray() {
    return [this[0], this[1], this[2], this[3]]
  }

  toJSON() {
    return this.toArray()
  }
}
