import { describe, fail } from '../validate.js'

/**
 * Euler angles in radians, applied in XYZ order (three.js's default). A node's `rotation` is an
 * Euler kept in sync with its `quaternion`: `node.rotation.y += 0.01` works as expected.
 */
export class Euler {
  #x = 0
  #y = 0
  #z = 0

  /** Only XYZ is supported. */
  get order() { return 'XYZ' }

  /** @internal Called after any change. @type {(() => void) | null} */
  onChange = null

  /** @param {number} [x] @param {number} [y] @param {number} [z] */
  constructor(x = 0, y = 0, z = 0) {
    this.#x = x
    this.#y = y
    this.#z = z
  }

  get x() { return this.#x }
  set x(v) { this.#x = v; this.onChange?.() }
  get y() { return this.#y }
  set y(v) { this.#y = v; this.onChange?.() }
  get z() { return this.#z }
  set z(v) { this.#z = v; this.onChange?.() }

  /** @param {number} x @param {number} y @param {number} z @returns {this} */
  set(x, y, z) {
    this.#x = x
    this.#y = y
    this.#z = z
    this.onChange?.()
    return this
  }

  /** @param {Euler | ArrayLike<number>} e [x, y, z] @param {string} [owner] @returns {this} */
  copy(e, owner = 'Euler') {
    if (e instanceof Euler) return this.set(e.x, e.y, e.z)
    if (!e || typeof e !== 'object' || !(e.length >= 3)) fail(owner, `expected rotation angles [x, y, z] in radians, got ${describe(e)}`)
    return this.set(e[0], e[1], e[2])
  }

  /** @returns {Euler} */
  clone() {
    return new Euler(this.#x, this.#y, this.#z)
  }

  /**
   * The XYZ angles of a quaternion, without firing onChange (used to sync from a node's quaternion).
   * @param {ArrayLike<number>} q
   * @returns {this}
   */
  setFromQuat(q) {
    const x = q[0], y = q[1], z = q[2], w = q[3]
    // elements of the rotation matrix the angles are read from
    const m11 = 1 - 2 * (y * y + z * z), m12 = 2 * (x * y - z * w), m13 = 2 * (x * z + y * w)
    const m22 = 1 - 2 * (x * x + z * z), m23 = 2 * (y * z - x * w)
    const m32 = 2 * (y * z + x * w), m33 = 1 - 2 * (x * x + y * y)
    this.#y = Math.asin(Math.min(1, Math.max(-1, m13)))
    if (Math.abs(m13) < 0.9999999) {
      this.#x = Math.atan2(-m23, m33)
      this.#z = Math.atan2(-m12, m11)
    } else {
      // gimbal lock: x and z rotate about the same axis
      this.#x = Math.atan2(m32, m22)
      this.#z = 0
    }
    return this
  }

  /** @returns {[number, number, number]} */
  toArray() {
    return [this.#x, this.#y, this.#z]
  }

  toJSON() {
    return this.toArray()
  }

  *[Symbol.iterator]() {
    yield this.#x
    yield this.#y
    yield this.#z
  }
}
