import { vec2, vec3 } from './math.js'

/** @import { Polygon, Vec2Like, Vec3Like } from './types.js' */

// Intersection and coordinate conversion helpers, contributed to phoria by Ruan Moolman.

/**
 * Planar (x, y, z) to polar [radius, theta (from the z axis), phi (from the x axis)].
 * @param {Vec3Like} planar
 * @returns {Float32Array}
 */
export function calculatePolarFromPlanar(planar) {
  const r = vec3.length(planar)
  let phi
  if (planar[0] !== 0) {
    phi = Math.atan(planar[1] / planar[0]) + (planar[0] > 0 ? 0 : Math.PI)
  } else {
    phi = planar[1] > 0 ? Math.PI / 2 : Math.PI * 3 / 2
  }
  return vec3.fromValues(r, Math.acos(planar[2] / r), phi)
}

/** Polar to planar, rounded to 2 decimal places. @param {Vec3Like} polar @returns {Float32Array} */
export function calculatePlanarFromPolar([r, theta, phi]) {
  const round = (n) => Math.round(n * 100) / 100
  return vec3.fromValues(
    round(r * Math.sin(theta) * Math.cos(phi)),
    round(r * Math.sin(theta) * Math.sin(phi)),
    round(r * Math.cos(theta)))
}

/**
 * Where a line meets a plane, or null if they are parallel.
 *   plane: normal . (p - planePoint) = 0,  line: linePoint + s * lineVector
 *   =>  s = normal . (planePoint - linePoint) / normal . lineVector
 * @param {Vec3Like} planeNormal
 * @param {Vec3Like} planePoint
 * @param {Vec3Like} lineVector
 * @param {Vec3Like} linePoint
 * @returns {Float32Array | null}
 */
export function planeLineIntersection(planeNormal, planePoint, lineVector, linePoint) {
  const dot = vec3.dot(lineVector, planeNormal)
  if (dot === 0) return null
  const toPlane = vec3.subtract(vec3.create(), planePoint, linePoint)
  const s = vec3.dot(planeNormal, toPlane) / dot
  return vec3.scaleAndAdd(vec3.create(), linePoint, lineVector, s)
}

/**
 * Is a point on a polygon's plane inside the polygon? Projects onto the axis-aligned plane that
 * best preserves the shape (dropping the dominant normal component) then counts crossings of a
 * test ray: odd = inside.
 * @param {Polygon} polygon with its _worldnormal set
 * @param {Float32Array[]} points world coordinates
 * @param {Vec3Like} intersection
 * @returns {boolean}
 */
export function intersectionInsidePolygon(polygon, points, intersection) {
  const n = polygon._worldnormal
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2])
  // indices of the two components kept in 2D
  const [i, j] = az >= ax && az >= ay ? [0, 1] : ay > ax ? [2, 0] : [1, 2]
  const project = (p) => vec2.fromValues(p[i], p[j])
  const testVector = vec2.fromValues(1, 1)
  const point = project(intersection)
  const { vertices } = polygon
  let crossings = 0
  for (let l = 0; l < vertices.length; l++) {
    const p1 = project(points[vertices[l]])
    const p2 = project(points[vertices[(l + 1) % vertices.length]])
    if (sectionLineIntersect2D(p1, p2, point, testVector)) crossings++
  }
  return crossings % 2 === 1
}

/**
 * Does the ray p + u*v (u >= 0) cross the line section p1-p2?
 * @param {Vec2Like} p1 @param {Vec2Like} p2 @param {Vec2Like} p @param {Vec2Like} v
 * @returns {boolean}
 */
export function sectionLineIntersect2D(p1, p2, p, v) {
  const s = vec2.subtract(vec2.create(), p2, p1)
  const cross = s[0] * v[1] - s[1] * v[0]
  // parallel lines never intersect
  if (cross === 0) return false

  // l1 = p1 + t*s, l2 = p + u*v; where they meet t = (p x v - p1 x v) / (s x v)
  const t = (p[0] * v[1] - p[1] * v[0] - p1[0] * v[1] + p1[1] * v[0]) / cross
  const u = v[0] !== 0
    ? (p1[0] + t * s[0] - p[0]) / v[0]
    : (p1[1] + t * s[1] - p[1]) / v[1]
  if (u < 0) return false

  const ip = vec2.scaleAndAdd(vec2.create(), p1, s, t)
  const within = (k) => ip[k] >= Math.min(p1[k], p2[k]) && ip[k] <= Math.max(p1[k], p2[k])
  return within(0) && within(1)
}
