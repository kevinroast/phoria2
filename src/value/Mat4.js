import * as mat4 from '../math/mat4.js'
import { Vec3 } from './Vec3.js'

/** A 4x4 matrix: a column-major Float32Array(16), identity by default, with a few chainable methods. */
export class Mat4 extends Float32Array {
  static get [Symbol.species]() { return Float32Array }

  constructor() {
    super(16)
    this[0] = this[5] = this[10] = this[15] = 1
  }

  /** @returns {this} */
  identity() {
    return mat4.identity(this)
  }

  /** @param {ArrayLike<number>} m @returns {this} */
  copy(m) {
    for (let i = 0; i < 16; i++) this[i] = m[i]
    return this
  }

  /** @returns {Mat4} */
  clone() {
    return new Mat4().copy(this)
  }

  /** this = this * m @param {ArrayLike<number>} m @returns {this} */
  multiply(m) {
    return mat4.multiply(this, this, /** @type {number[]} */ (m))
  }

  /** this = a * b @param {ArrayLike<number>} a @param {ArrayLike<number>} b @returns {this} */
  multiplyMatrices(a, b) {
    return mat4.multiply(this, /** @type {number[]} */ (a), /** @type {number[]} */ (b))
  }

  /** Invert in place; becomes all zeros if the matrix is singular. @returns {this} */
  invert() {
    if (!mat4.invert(this, this)) this.fill(0)
    return this
  }

  /** Compose from a translation, rotation and scale. @param {ArrayLike<number>} position @param {ArrayLike<number>} quaternion @param {ArrayLike<number>} scale @returns {this} */
  compose(position, quaternion, scale) {
    return mat4.fromRotationTranslationScale(this, /** @type {number[]} */ (quaternion), /** @type {number[]} */ (position), /** @type {number[]} */ (scale))
  }

  /** The translation part. @param {Vec3} [out] @returns {Vec3} */
  getPosition(out = new Vec3()) {
    return out.set(this[12], this[13], this[14])
  }

  /** The length of each basis vector. @param {Vec3} [out] @returns {Vec3} */
  getScale(out = new Vec3()) {
    return out.set(
      Math.hypot(this[0], this[1], this[2]),
      Math.hypot(this[4], this[5], this[6]),
      Math.hypot(this[8], this[9], this[10]))
  }

  /** @returns {number[]} */
  toArray() {
    return Array.from(this)
  }
}
