// Curves: a smooth path through points, or an ellipse - to draw as a line, a dashed line or a
// tube, and to move things along (phoria2/motion). Positions along a curve go by distance, so
// t = 0.5 is half way along it, however unevenly its points are spaced.

import { Geometry } from './Geometry.js'
import { Vec3 } from '../value/Vec3.js'
import { setAxisAngle } from '../math/quat.js'
import { checkNumber, checkOneOf, checkOptions, describe, fail } from '../validate.js'

/** @import { Vec3Input } from '../types.js' */

/**
 * @typedef {object} CurveOptions
 * @property {boolean} [closed] join the last point back to the first, default false
 * @property {number} [tension] how tightly the curve hugs its points, 0 (round) to 1 (straight lines), default 0
 */

/**
 * @typedef {object} EllipseOptions
 * @property {'xz' | 'xy' | 'yz'} [plane] the plane it lies in, default 'xz' (flat, like an orbit seen from above)
 * @property {number} [radius] sets both radii, default 1
 * @property {number} [radiusX] across x, default radius (planes 'xz' and 'xy')
 * @property {number} [radiusY] across y, default radius (planes 'xy' and 'yz')
 * @property {number} [radiusZ] across z, default radius (planes 'xz' and 'yz')
 * @property {Vec3Input} [center] default [0, 0, 0]
 * @property {number} [tilt] radians about the plane's first axis (x, or y for 'yz'), default 0
 */

/**
 * @typedef {object} LineOptions
 * @property {number} [segments] straight pieces along the whole curve, default by length (about 20 a unit, 400 at most)
 * @property {[number, number]} [dash] [on, off] lengths in the curve's units, for a dashed line
 */

/**
 * @typedef {object} TubeOptions
 * @property {number} [radius] default 0.1
 * @property {number} [segments] rings along the curve, default by length (about 20 a unit, 400 at most)
 * @property {number} [sides] around the tube, default 8
 */

const SAMPLES = 48 // per span between control points, for measuring length

/** A smooth curve. Make one with curve(points) or ellipse(options). */
export class Curve {
  /** @type {Vec3[]} */ #points
  #closed
  #tension
  /** cumulative lengths at even steps of the raw parameter, for going by distance */
  /** @type {Float64Array} */ #lengths

  /**
   * @param {Vec3Input[]} points two or more
   * @param {CurveOptions} [options]
   */
  constructor(points, options = {}) {
    if (!Array.isArray(points) || points.length < 2) fail('curve()', `needs an array of two or more points, got ${describe(points)}`)
    checkOptions('curve()', options, ['closed', 'tension'], { loop: "use 'closed: true'", smooth: "the curve is always smooth - 'tension' (0-1) sets how tight" })
    this.#points = points.map((p) => Vec3.fromInput(p, 'curve()'))
    this.#closed = !!options.closed
    this.#tension = options.tension === undefined ? 0 : checkNumber('curve()', 'tension', options.tension)
    const n = this.#spans() * SAMPLES
    this.#lengths = new Float64Array(n + 1)
    let prev = this.#raw(0)
    for (let i = 1; i <= n; i++) {
      const p = this.#raw(i / n)
      this.#lengths[i] = this.#lengths[i - 1] + p.distanceTo(prev)
      prev = p
    }
  }

  /** Its length, in the units of its points. */
  get length() {
    return this.#lengths[this.#lengths.length - 1]
  }

  get closed() {
    return this.#closed
  }

  /**
   * The point t of the way along it by distance: 0 is the start, 1 the end.
   * @param {number} t @param {Vec3} [out]
   * @returns {Vec3}
   */
  at(t, out = new Vec3()) {
    return this.#raw(this.#toRaw(t), out)
  }

  /**
   * The direction it runs in at t, as a unit vector.
   * @param {number} t @param {Vec3} [out]
   * @returns {Vec3}
   */
  tangentAt(t, out = new Vec3()) {
    const u = this.#toRaw(t), e = 1e-4
    const a = this.#raw(Math.max(0, u - e)), b = this.#raw(Math.min(1, u + e))
    return out.copy(b.sub(a)).normalize()
  }

  /**
   * Evenly spaced points along it, for your own geometry.
   * @param {number} count @returns {Vec3[]}
   */
  points(count) {
    const n = Math.max(2, Math.round(checkNumber('curve.points()', 'count', count)))
    // a closed curve's last point would repeat its first
    const last = this.#closed ? n : n - 1
    return Array.from({ length: n }, (_, i) => this.at(i / last))
  }

  /**
   * Line geometry along it, for a Lines node - solid, or dashed with dash: [on, off].
   * Its pieces run in order from the start, so geometry.drawCount can draw just the first part.
   *
   *     scene.add(new Lines({ geometry: path.line({ dash: [0.3, 0.15] }), material: { color: 'orange', width: 2 } }))
   * @param {LineOptions} [options]
   * @returns {Geometry}
   */
  line(options = {}) {
    checkOptions('curve.line()', options, ['segments', 'dash'], { dashed: "use 'dash: [on, off]' - lengths in the curve's units" })
    const segments = this.#segments('curve.line()', options.segments)
    const step = this.length / segments
    /** @type {number[]} */
    const positions = []
    const piece = (from, to) => {
      // a run along the curve, cut into pieces about a step long
      const n = Math.max(1, Math.ceil((to - from) / step - 1e-9))
      let prev = this.at(from / this.length)
      for (let i = 1; i <= n; i++) {
        const p = this.at((from + (to - from) * i / n) / this.length)
        positions.push(prev[0], prev[1], prev[2], p[0], p[1], p[2])
        prev = p
      }
    }
    if (options.dash === undefined) piece(0, this.length)
    else {
      const dash = options.dash
      if (!Array.isArray(dash) || dash.length !== 2 || !dash.every((d) => d > 0)) fail('curve.line()', `'dash' is [on, off], two lengths above 0, got ${describe(dash)}`)
      for (let d = 0; d < this.length; d += dash[0] + dash[1]) piece(d, Math.min(this.length, d + dash[0]))
    }
    return new Geometry({ positions })
  }

  /**
   * Tube geometry along it, for a Mesh - a pipe of the curve's shape.
   * @param {TubeOptions} [options]
   * @returns {Geometry}
   */
  tube(options = {}) {
    checkOptions('curve.tube()', options, ['radius', 'segments', 'sides'], { tubularSegments: "use 'segments'", radialSegments: "use 'sides'" })
    const radius = options.radius === undefined ? 0.1 : checkNumber('curve.tube()', 'radius', options.radius)
    const sides = options.sides === undefined ? 8 : Math.max(3, Math.round(checkNumber('curve.tube()', 'sides', options.sides)))
    const segments = this.#segments('curve.tube()', options.segments)
    const rings = this.#closed ? segments : segments + 1
    /** @type {number[]} */
    const positions = []
    /** @type {number[]} */
    const indices = []
    // each ring's frame is carried along from the last one, so the tube doesn't twist
    let tangent = this.tangentAt(0)
    let normal = new Vec3(...(Math.abs(tangent[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])).cross(tangent).normalize()
    for (let i = 0; i < rings; i++) {
      const t = i / segments
      const next = this.tangentAt(t)
      // turn the normal by however the tangent turned
      normal = next.clone().cross(normal.clone().cross(next)).normalize()
      tangent = next
      const binormal = tangent.clone().cross(normal)
      const c = this.at(t)
      for (let s = 0; s < sides; s++) {
        const a = s / sides * Math.PI * 2, x = Math.cos(a) * radius, y = Math.sin(a) * radius
        positions.push(c[0] + normal[0] * x + binormal[0] * y, c[1] + normal[1] * x + binormal[1] * y, c[2] + normal[2] * x + binormal[2] * y)
      }
    }
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % rings
      for (let s = 0; s < sides; s++) {
        const a = i * sides + s, b = j * sides + s, c = j * sides + (s + 1) % sides, d = i * sides + (s + 1) % sides
        indices.push(a, d, c, a, c, b)
      }
    }
    return new Geometry({ positions, indices })
  }

  #spans() {
    return this.#closed ? this.#points.length : this.#points.length - 1
  }

  /** @param {string} owner @param {number | undefined} segments */
  #segments(owner, segments) {
    if (segments !== undefined) return Math.max(1, Math.round(checkNumber(owner, 'segments', segments)))
    return Math.min(400, Math.max(8, Math.round(this.length * 20)))
  }

  /** The raw curve parameter (even per span) for a distance fraction t. @param {number} t */
  #toRaw(t) {
    const total = this.length, target = Math.min(1, Math.max(0, t)) * total
    const lengths = this.#lengths
    let lo = 0, hi = lengths.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (lengths[mid] < target) lo = mid
      else hi = mid
    }
    const span = lengths[hi] - lengths[lo]
    return (lo + (span > 0 ? (target - lengths[lo]) / span : 0)) / (lengths.length - 1)
  }

  /** A point at raw parameter u (0-1), on a cardinal spline through the points. @param {number} u @param {Vec3} [out] */
  #raw(u, out = new Vec3()) {
    const pts = this.#points, n = pts.length, spans = this.#spans()
    const x = Math.min(1, Math.max(0, u)) * spans
    const i = Math.min(spans - 1, Math.floor(x)), f = x - i
    const get = (k) => (this.#closed ? pts[((k % n) + n) % n] : pts[Math.min(n - 1, Math.max(0, k))])
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2)
    // centripetal: the tangents weigh each neighbour by the square root of its distance, so
    // unevenly spaced points don't make the curve overshoot into loops or cusps. Evenly spaced,
    // it's the plain Catmull-Rom curve
    const d0 = Math.sqrt(p1.distanceTo(p0)), d1 = Math.sqrt(p2.distanceTo(p1)) || 1e-9, d2 = Math.sqrt(p3.distanceTo(p2))
    const s = 1 - this.#tension
    const f2 = f * f, f3 = f2 * f
    const h1 = 2 * f3 - 3 * f2 + 1, h2 = -2 * f3 + 3 * f2, h3 = f3 - 2 * f2 + f, h4 = f3 - f2
    for (let k = 0; k < 3; k++) {
      const chord = (p2[k] - p1[k]) / d1
      // at an end, where the neighbour is the point itself, the tangent runs along the chord (at half
      // strength, as the plain curve has it)
      const t1 = d0 > 1e-9 ? (p1[k] - p0[k]) / d0 - (p2[k] - p0[k]) / (d0 + d1) + chord : chord / 2
      const t2 = d2 > 1e-9 ? chord - (p3[k] - p1[k]) / (d1 + d2) + (p3[k] - p2[k]) / d2 : chord / 2
      const m1 = s * t1 * d1, m2 = s * t2 * d1
      out[k] = h1 * p1[k] + h2 * p2[k] + h3 * m1 + h4 * m2
    }
    return out
  }
}

/**
 * A smooth curve through points - for paths, routes and trajectories.
 *
 *     const route = curve([[0, 0, 0], [2, 3, 0], [6, 2, 1]])
 *     route.at(0.5)                       // half way along, by distance
 * @param {Vec3Input[]} points
 * @param {CurveOptions} [options]
 * @returns {Curve}
 */
export function curve(points, options) {
  return new Curve(points, options)
}

/**
 * A closed ellipse - for orbits. It lies flat in x-z unless plane says otherwise, and starts on its
 * first axis, running toward its second: from +x toward +z in 'xz'.
 *
 *     const orbit = ellipse({ radiusX: 4, radiusZ: 3, center: [8, 0, 0] })
 *     const face = ellipse({ plane: 'xy', radiusX: 3, radiusY: 2 })   // facing the camera
 * @param {EllipseOptions} [options]
 * @returns {Curve}
 */
export function ellipse(options = {}) {
  const plane = options.plane === undefined ? 'xz' : checkOneOf('ellipse()', 'plane', options.plane, ['xz', 'xy', 'yz'])
  const [u, v] = [...plane].map((a) => 'xyz'.indexOf(a))
  const name = (a) => `radius${'XYZ'[a]}`
  const off = name(3 - u - v)
  checkOptions('ellipse()', options, ['plane', 'radius', name(u), name(v), 'center', 'tilt'], {
    [off]: `an ellipse in '${plane}' has '${name(u)}' and '${name(v)}' - set plane for another`,
  })
  const r = options.radius === undefined ? 1 : checkNumber('ellipse()', 'radius', options.radius)
  const radius = (a) => (options[name(a)] === undefined ? r : checkNumber('ellipse()', name(a), options[name(a)]))
  const ru = radius(u), rv = radius(v)
  const c = Vec3.fromInput(options.center ?? [0, 0, 0], 'ellipse()')
  const tilt = options.tilt === undefined ? 0 : checkNumber('ellipse()', 'tilt', options.tilt)
  const axis = [0, 0, 0]
  axis[u] = 1
  const turn = setAxisAngle(new Float32Array(4), axis, tilt)
  // enough points that the spline through them is a true ellipse to well under a pixel
  const n = 64
  const points = Array.from({ length: n }, (_, i) => {
    const a = i / n * Math.PI * 2, p = new Vec3()
    p[u] = Math.cos(a) * ru
    p[v] = Math.sin(a) * rv
    return p.applyQuaternion(turn).add(c)
  })
  return new Curve(points, { closed: true })
}
