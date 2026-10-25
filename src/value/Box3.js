import { Vec3 } from './Vec3.js'

/** An axis aligned bounding box. Empty (min > max) until a point is added. */
export class Box3 {
  min = new Vec3(Infinity, Infinity, Infinity)
  max = new Vec3(-Infinity, -Infinity, -Infinity)

  /** @param {ArrayLike<number>} [min] @param {ArrayLike<number>} [max] */
  constructor(min, max) {
    if (min) this.min.set(min[0], min[1], min[2])
    if (max) this.max.set(max[0], max[1], max[2])
  }

  /** @returns {this} */
  makeEmpty() {
    this.min.set(Infinity, Infinity, Infinity)
    this.max.set(-Infinity, -Infinity, -Infinity)
    return this
  }

  /** @returns {boolean} */
  isEmpty() {
    return this.max[0] < this.min[0] || this.max[1] < this.min[1] || this.max[2] < this.min[2]
  }

  /** @param {number} x @param {number} y @param {number} z @returns {this} */
  expandByXYZ(x, y, z) {
    const { min, max } = this
    if (x < min[0]) min[0] = x
    if (y < min[1]) min[1] = y
    if (z < min[2]) min[2] = z
    if (x > max[0]) max[0] = x
    if (y > max[1]) max[1] = y
    if (z > max[2]) max[2] = z
    return this
  }

  /** @param {ArrayLike<number>} p @returns {this} */
  expandByPoint(p) {
    return this.expandByXYZ(p[0], p[1], p[2])
  }

  /** Grow to contain flat xyz positions. @param {ArrayLike<number>} positions @returns {this} */
  expandByPositions(positions) {
    for (let i = 0; i < positions.length; i += 3) this.expandByXYZ(positions[i], positions[i + 1], positions[i + 2])
    return this
  }

  /** @param {Box3} box @returns {this} */
  union(box) {
    if (box.isEmpty()) return this
    this.expandByPoint(box.min)
    return this.expandByPoint(box.max)
  }

  /** Transform by a 4x4, keeping it axis aligned (bounds of the 8 transformed corners). @param {ArrayLike<number>} m @returns {this} */
  applyMatrix4(m) {
    if (this.isEmpty()) return this
    const [x0, y0, z0] = this.min, [x1, y1, z1] = this.max
    this.makeEmpty()
    for (const x of [x0, x1]) {
      for (const y of [y0, y1]) {
        for (const z of [z0, z1]) {
          this.expandByXYZ(
            m[0] * x + m[4] * y + m[8] * z + m[12],
            m[1] * x + m[5] * y + m[9] * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14])
        }
      }
    }
    return this
  }

  /** @param {Vec3} [out] @returns {Vec3} */
  getCenter(out = new Vec3()) {
    if (this.isEmpty()) return out.set(0, 0, 0)
    return out.set((this.min[0] + this.max[0]) / 2, (this.min[1] + this.max[1]) / 2, (this.min[2] + this.max[2]) / 2)
  }

  /** @param {Vec3} [out] @returns {Vec3} */
  getSize(out = new Vec3()) {
    if (this.isEmpty()) return out.set(0, 0, 0)
    return out.set(this.max[0] - this.min[0], this.max[1] - this.min[1], this.max[2] - this.min[2])
  }

  /** Radius of the sphere around getCenter() that contains the box. @returns {number} */
  getRadius() {
    return this.isEmpty() ? 0 : this.getSize().len() / 2
  }

  /** @param {ArrayLike<number>} p @returns {boolean} */
  containsPoint(p) {
    return p[0] >= this.min[0] && p[0] <= this.max[0] &&
      p[1] >= this.min[1] && p[1] <= this.max[1] &&
      p[2] >= this.min[2] && p[2] <= this.max[2]
  }

  /** @returns {Box3} */
  clone() {
    return new Box3(this.min, this.max)
  }

  /** @param {Box3} box @returns {this} */
  copy(box) {
    this.min.set(box.min[0], box.min[1], box.min[2])
    this.max.set(box.max[0], box.max[1], box.max[2])
    return this
  }
}
