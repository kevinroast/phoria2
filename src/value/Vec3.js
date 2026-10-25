import * as vec3 from '../math/vec3.js'
import { describe, fail } from '../validate.js'

/** @import { Vec3Input } from '../types.js' */

/**
 * A 3D vector: a Float32Array(3) with x/y/z accessors and chainable methods, so it works both with
 * the vec3/mat4 functions and three.js-style code (`position.set(1, 2, 3)`, `position.x += 1`).
 */
export class Vec3 extends Float32Array {
  // slice(), map() etc. return plain Float32Arrays rather than calling this constructor
  static get [Symbol.species]() { return Float32Array }

  /** @param {number} [x] @param {number} [y] @param {number} [z] */
  constructor(x = 0, y = 0, z = 0) {
    super(3)
    this[0] = x
    this[1] = y
    this[2] = z
  }

  /**
   * Convert input to a new Vec3: [x, y, z], { x, y, z }, a Vec3, or one number for all three.
   * @param {Vec3Input | number} v
   * @param {string} [owner] for error messages
   * @returns {Vec3}
   */
  static fromInput(v, owner = 'Vec3') {
    return new Vec3().copy(v, owner)
  }

  get x() { return this[0] }
  set x(v) { this[0] = v }
  get y() { return this[1] }
  set y(v) { this[1] = v }
  get z() { return this[2] }
  set z(v) { this[2] = v }

  /**
   * set(x, y, z) sets the components, three.js style. set(array, offset) keeps the typed array
   * behaviour.
   * @overload
   * @param {number} x @param {number} y @param {number} z
   * @returns {this}
   */
  /**
   * @overload
   * @param {ArrayLike<number>} array @param {number} [offset]
   * @returns {void}
   */
  /** @param {number | ArrayLike<number>} x @param {number} [y] @param {number} [z] */
  set(x, y, z) {
    if (typeof x !== 'number') {
      super.set(x, y ?? 0)
      return
    }
    this[0] = x
    this[1] = y ?? this[1]
    this[2] = z ?? this[2]
    return this
  }

  /** Copy from any Vec3Input, or one number for all three. @param {Vec3Input | number} v @param {string} [owner] @returns {this} */
  copy(v, owner = 'Vec3') {
    if (typeof v === 'number') {
      this[0] = this[1] = this[2] = v
    } else if (v && (Array.isArray(v) || ArrayBuffer.isView(v)) && v.length >= 3) {
      this[0] = v[0]
      this[1] = v[1]
      this[2] = v[2]
    } else if (v && typeof v === 'object' && 'x' in v && 'y' in v && 'z' in v) {
      this[0] = v.x
      this[1] = v.y
      this[2] = v.z
    } else {
      fail(owner, `expected [x, y, z] or { x, y, z }, got ${describe(v)}`)
    }
    if (Number.isNaN(this[0] + this[1] + this[2])) fail(owner, `vector components must be numbers, got ${describe(v)}`)
    return this
  }

  /** @returns {Vec3} */
  clone() {
    return new Vec3(this[0], this[1], this[2])
  }

  /** @param {Vec3Input} v @returns {this} */
  add(v) {
    const o = toArray(v)
    return vec3.add(this, this, o)
  }

  /** @param {Vec3Input} v @returns {this} */
  sub(v) {
    return vec3.subtract(this, this, toArray(v))
  }

  /** @param {number} s @returns {this} */
  multiplyScalar(s) {
    return vec3.scale(this, this, s)
  }

  /** @returns {this} */
  normalize() {
    return vec3.normalize(this, this)
  }

  /** @returns {this} */
  negate() {
    return vec3.negate(this, this)
  }

  /** @param {Vec3Input} v @param {number} t @returns {this} */
  lerp(v, t) {
    return vec3.lerp(this, this, toArray(v), t)
  }

  /** @param {Vec3Input} v @returns {this} */
  cross(v) {
    return vec3.cross(this, this, toArray(v))
  }

  /** @param {Vec3Input} v @returns {number} */
  dot(v) {
    return vec3.dot(this, toArray(v))
  }

  // len(), not length(): a typed array already has a length property (3)
  /** @returns {number} */
  len() {
    return vec3.length(this)
  }

  /** @param {Vec3Input} v @returns {number} */
  distanceTo(v) {
    return vec3.distance(this, toArray(v))
  }

  /** Transform as a point (w = 1). @param {Float32Array | number[]} m 4x4 @returns {this} */
  applyMatrix4(m) {
    return vec3.transformMat4(this, this, m)
  }

  /** @param {Float32Array | number[]} q @returns {this} */
  applyQuaternion(q) {
    return vec3.transformQuat(this, this, q)
  }

  /** @param {Vec3Input} v @param {number} [epsilon] @returns {boolean} */
  equals(v, epsilon = 0) {
    const o = toArray(v)
    return Math.abs(this[0] - o[0]) <= epsilon && Math.abs(this[1] - o[1]) <= epsilon && Math.abs(this[2] - o[2]) <= epsilon
  }

  /** @returns {[number, number, number]} */
  toArray() {
    return [this[0], this[1], this[2]]
  }

  toJSON() {
    return this.toArray()
  }
}

/** @param {Vec3Input} v @returns {Float32Array | number[]} */
function toArray(v) {
  return Array.isArray(v) || ArrayBuffer.isView(v) ? /** @type {Float32Array | number[]} */ (v) : Vec3.fromInput(v)
}
