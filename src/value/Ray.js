import { Vec3 } from './Vec3.js'

const edge1 = new Vec3(), edge2 = new Vec3(), pvec = new Vec3(), tvec = new Vec3(), qvec = new Vec3()

/** A ray: an origin and a (normalised) direction. */
export class Ray {
  origin = new Vec3()
  direction = new Vec3(0, 0, -1)

  /** @param {ArrayLike<number>} [origin] @param {ArrayLike<number>} [direction] */
  constructor(origin, direction) {
    if (origin) this.origin.set(origin[0], origin[1], origin[2])
    if (direction) this.direction.set(direction[0], direction[1], direction[2]).normalize()
  }

  /** The point at distance t along the ray. @param {number} t @param {Vec3} [out] @returns {Vec3} */
  at(t, out = new Vec3()) {
    return out.copy(this.direction).multiplyScalar(t).add(this.origin)
  }

  /** @returns {Ray} */
  clone() {
    return new Ray(this.origin, this.direction)
  }

  /** Transform by a 4x4 (direction ignores translation, and is re-normalised). @param {ArrayLike<number>} m @returns {this} */
  applyMatrix4(m) {
    const end = this.at(1)
    this.origin.applyMatrix4(/** @type {Float32Array} */ (m))
    end.applyMatrix4(/** @type {Float32Array} */ (m))
    this.direction.copy(end).sub(this.origin).normalize()
    return this
  }

  /** Distance to where the ray enters a sphere, or null if it misses (or the sphere is behind). @param {ArrayLike<number>} center @param {number} radius @returns {number | null} */
  intersectSphere(center, radius) {
    tvec.set(center[0], center[1], center[2]).sub(this.origin)
    const along = tvec.dot(this.direction)
    const d2 = tvec.dot(tvec) - along * along
    const r2 = radius * radius
    if (d2 > r2) return null
    const half = Math.sqrt(r2 - d2)
    const t0 = along - half, t1 = along + half
    if (t1 < 0) return null
    return t0 < 0 ? t1 : t0
  }

  /**
   * Möller-Trumbore ray/triangle test: the distance along the ray and barycentric (u, v), or null.
   * Triangles facing away (clockwise from the ray's side) are skipped when cullBack is set.
   * @param {ArrayLike<number>} a @param {ArrayLike<number>} b @param {ArrayLike<number>} c
   * @param {boolean} cullBack
   * @returns {{ t: number, u: number, v: number } | null}
   */
  intersectTriangle(a, b, c, cullBack) {
    edge1.set(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    edge2.set(c[0] - a[0], c[1] - a[1], c[2] - a[2])
    pvec.copy(this.direction).cross(edge2)
    const det = edge1.dot(pvec)
    if (cullBack ? det < 1e-10 : Math.abs(det) < 1e-10) return null
    const inv = 1 / det
    tvec.set(this.origin[0] - a[0], this.origin[1] - a[1], this.origin[2] - a[2])
    const u = tvec.dot(pvec) * inv
    if (u < 0 || u > 1) return null
    qvec.copy(tvec).cross(edge1)
    const v = this.direction.dot(qvec) * inv
    if (v < 0 || u + v > 1) return null
    const t = edge2.dot(qvec) * inv
    return t >= 0 ? { t, u, v } : null
  }

  /** Squared distance from the ray to a point, and how far along the ray the closest approach is. @param {ArrayLike<number>} p @returns {{ distanceSq: number, t: number }} */
  distanceSqToPoint(p) {
    tvec.set(p[0] - this.origin[0], p[1] - this.origin[1], p[2] - this.origin[2])
    const t = Math.max(0, tvec.dot(this.direction))
    const closest = this.at(t, qvec)
    return { distanceSq: (p[0] - closest[0]) ** 2 + (p[1] - closest[1]) ** 2 + (p[2] - closest[2]) ** 2, t }
  }

  /**
   * Squared distance between the ray and a line segment, with the closest points' parameters.
   * @param {ArrayLike<number>} v0 @param {ArrayLike<number>} v1
   * @returns {{ distanceSq: number, t: number, s: number }} t along the ray, s 0-1 along the segment
   */
  distanceSqToSegment(v0, v1) {
    // closest points between two lines, then clamped to the ray (t >= 0) and segment (0 <= s <= 1)
    const d = this.direction
    const ex = v1[0] - v0[0], ey = v1[1] - v0[1], ez = v1[2] - v0[2]
    const wx = this.origin[0] - v0[0], wy = this.origin[1] - v0[1], wz = this.origin[2] - v0[2]
    const a = 1, b = d[0] * ex + d[1] * ey + d[2] * ez, c = ex * ex + ey * ey + ez * ez
    const dd = d[0] * wx + d[1] * wy + d[2] * wz, e = ex * wx + ey * wy + ez * wz
    const denom = a * c - b * b
    let s = denom > 1e-12 ? (a * e - b * dd) / denom : 0
    s = Math.min(1, Math.max(0, s))
    let t = b * s - dd
    // nearest behind the ray's start: from the start, the nearest point of the segment is another one
    if (t < 0) {
      t = 0
      s = c > 1e-12 ? Math.min(1, Math.max(0, e / c)) : 0
    }
    const px = this.origin[0] + d[0] * t - (v0[0] + ex * s)
    const py = this.origin[1] + d[1] * t - (v0[1] + ey * s)
    const pz = this.origin[2] + d[2] * t - (v0[2] + ez * s)
    return { distanceSq: px * px + py * py + pz * pz, t, s }
  }
}
