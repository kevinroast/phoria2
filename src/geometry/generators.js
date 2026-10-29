// Geometry generators: plain functions returning a Geometry. Every shape follows the same
// conventions - +Y up, counter-clockwise front faces, outward normals, glTF UVs (v down).

import { Geometry } from './Geometry.js'
import { area, triangulate } from './triangulate.js'
import { checkCount as count, checkLength as size, checkOneOf, describe, fail, resolveOptions as resolve } from '../validate.js'

const TAU = Math.PI * 2

/** What each generator takes (a number alone sets the first, where that makes sense). */
export const GENERATOR_OPTIONS = {
  box: ['size', 'width', 'height', 'depth', 'segments'],
  sphere: ['radius', 'segments', 'rings'],
  plane: ['size', 'width', 'depth', 'segments'],
  cylinder: ['radius', 'radiusTop', 'height', 'segments', 'caps', 'axis'],
  torus: ['radius', 'tube', 'segments', 'tubeSegments'],
  icosphere: ['radius', 'detail'],
  lathe: ['points', 'segments', 'axis'],
  extrude: ['shape', 'holes', 'depth', 'axis'],
  axes: ['size'],
  grid: ['size', 'divisions'],
}

/**
 * @typedef {object} BoxOptions
 * @property {number} [size] sets width, height and depth together, default 1
 * @property {number} [width] along x, default size
 * @property {number} [height] along y, default size
 * @property {number} [depth] along z, default size
 * @property {number} [segments] subdivisions across each face, default 1
 */

/**
 * @typedef {object} SphereOptions
 * @property {number} [radius] default 1
 * @property {number} [segments] around the Y axis, default 32
 * @property {number} [rings] from pole to pole, default 16
 */

/**
 * @typedef {object} PlaneOptions
 * @property {number} [size] sets width and depth together, default 1
 * @property {number} [width] along x, default size
 * @property {number} [depth] along z, default size
 * @property {number} [segments] subdivisions along each side, default 1
 */

/**
 * @typedef {object} CylinderOptions
 * @property {number} [radius] at the bottom, default 0.5
 * @property {number} [radiusTop] at the top, defaults to `radius`; 0 gives a cone
 * @property {number} [height] along y, default 1
 * @property {number} [segments] around the Y axis, default 32
 * @property {boolean} [caps] close the ends, default true
 * @property {Axis} [axis] the axis it runs along, default 'y'
 */

/**
 * @typedef {object} TorusOptions
 * @property {number} [radius] from the centre to the middle of the tube, default 1
 * @property {number} [tube] radius of the tube, default 0.4
 * @property {number} [segments] around the ring, default 48
 * @property {number} [tubeSegments] around the tube, default 16
 */

/**
 * @typedef {object} IcosphereOptions
 * @property {number} [radius] default 1
 * @property {number} [detail] subdivision level 0-6, default 2; 0 is an icosahedron (20 faces)
 */

/**
 * @typedef {object} LatheOptions
 * @property {ArrayLike<number>[]} points the profile, as [radius, y] pairs from the bottom up - the
 *   outside of the surface is on the right as you go up it
 * @property {number} [segments] around the axis, default 32
 * @property {Axis} [axis] the axis it is turned about, default 'y'
 */

/**
 * @typedef {object} ExtrudeOptions
 * @property {ArrayLike<number>[]} shape the outline, as [x, y] pairs, either way round
 * @property {ArrayLike<number>[][]} [holes] outlines cut out of it, each as [x, y] pairs
 * @property {number} [depth] along the axis, default 1
 * @property {Axis} [axis] the axis it is pushed along, default 'z'; the outline is drawn as seen
 *   looking back down the axis from its + end, with y up ('y': seen from above, y away from you)
 */

/** @typedef {'x' | 'y' | 'z'} Axis */

/**
 * @typedef {object} AxesOptions
 * @property {number} [size] length of each axis line, default 1
 */

// three.js names people will reach for, mapped to what to use here
const SEGMENT_HINT = "has one 'segments' option, used for every face"

/**
 * A box centred on the origin. Each face has its own 4+ vertices so normals and UVs are per face;
 * seen from outside, a face's top left has uv (0, 0). Side faces keep +Y up.
 * @example box(2) // 2 x 2 x 2
 * @example box({ width: 2, height: 1, depth: 0.5, segments: 4 })
 * @param {number | BoxOptions} [options] a number sets width, height and depth
 * @returns {Geometry}
 */
export function box(options) {
  const owner = 'box()'
  const o = resolve(owner, options, GENERATOR_OPTIONS.box, (n) => ({ size: n }), {
    widthSegments: `box() ${SEGMENT_HINT}`,
    heightSegments: `box() ${SEGMENT_HINT}`,
    depthSegments: `box() ${SEGMENT_HINT}`,
  })
  // size sets all three; width, height and depth override it per axis
  const all = size(owner, 'size', o.size, 1)
  const width = size(owner, 'width', o.width, all)
  const height = size(owner, 'height', o.height, all)
  const depth = size(owner, 'depth', o.depth, all)
  const segments = count(owner, 'segments', o.segments, 1)
  const scale = [width, height, depth]
  const m = new Builder()
  for (const [n, right, up] of BOX_FACES) {
    const start = m.count
    for (let j = 0; j <= segments; j++) {
      const v = j / segments
      for (let i = 0; i <= segments; i++) {
        const u = i / segments
        const p = [0, 1, 2].map((k) => (n[k] * 0.5 + right[k] * (u - 0.5) + up[k] * (0.5 - v)) * scale[k])
        m.vertex(p[0], p[1], p[2], n[0], n[1], n[2], u, v)
      }
    }
    m.grid(start, segments, segments)
  }
  return m.build({ type: 'box', width, height, depth, segments })
}

// [normal, right (u grows), up (v shrinks)] per face, with right x up = normal so faces wind CCW
const BOX_FACES = [
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
  [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
  [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
]

/**
 * A UV sphere centred on the origin. u runs once around (with a seam column of repeated vertices
 * so the texture can wrap), v from the north pole (0) to the south pole (1).
 * @example sphere(2)
 * @example sphere({ radius: 1, segments: 64, rings: 32 })
 * @param {number | SphereOptions} [options] a number sets the radius
 * @returns {Geometry}
 */
export function sphere(options) {
  const owner = 'sphere()'
  const o = resolve(owner, options, GENERATOR_OPTIONS.sphere, (n) => ({ radius: n }), {
    widthSegments: "sphere(): use 'segments' for the divisions around the sphere",
    heightSegments: "sphere(): use 'rings' for the divisions from pole to pole",
  })
  const radius = size(owner, 'radius', o.radius, 1)
  const segments = count(owner, 'segments', o.segments, 32, 3)
  const rings = count(owner, 'rings', o.rings, 16, 2)
  const m = new Builder()
  for (let j = 0; j <= rings; j++) {
    const v = j / rings
    const pole = j === 0 || j === rings
    // exact poles, so they sit on the axis and weld in edges()
    const sinT = pole ? 0 : Math.sin(v * Math.PI)
    const cosT = j === 0 ? 1 : j === rings ? -1 : Math.cos(v * Math.PI)
    for (let i = 0; i <= segments; i++) {
      // a pole vertex serves only the triangle to its right, so centre its u over that triangle
      const u = pole && i < segments ? (i + 0.5) / segments : i / segments
      const phi = ((i % segments) / segments) * TAU // the seam column repeats column 0 exactly
      const nx = -Math.cos(phi) * sinT, ny = cosT, nz = Math.sin(phi) * sinT
      m.vertex(nx * radius, ny * radius, nz * radius, nx, ny, nz, u, v)
    }
  }
  m.grid(0, segments, rings, { pinchTop: true, pinchBottom: true })
  return m.build({ type: 'sphere', radius, segments, rings })
}

/**
 * A flat rectangle in the x-z plane, centred on the origin and facing +Y. Seen from above, the
 * -x, -z corner has uv (0, 0) and the +x, +z corner (1, 1).
 * @example plane(10)
 * @example plane({ width: 4, depth: 2, segments: 8 })
 * @param {number | PlaneOptions} [options] a number sets width and depth
 * @returns {Geometry}
 */
export function plane(options) {
  const owner = 'plane()'
  const o = resolve(owner, options, GENERATOR_OPTIONS.plane, (n) => ({ size: n }), {
    height: "plane() lies in the x-z plane - use 'depth' rather than 'height'",
    widthSegments: `plane() ${SEGMENT_HINT}`,
    heightSegments: `plane() ${SEGMENT_HINT}`,
  })
  const all = size(owner, 'size', o.size, 1)
  const width = size(owner, 'width', o.width, all)
  const depth = size(owner, 'depth', o.depth, all)
  const segments = count(owner, 'segments', o.segments, 1)
  const m = new Builder()
  for (let j = 0; j <= segments; j++) {
    const v = j / segments
    for (let i = 0; i <= segments; i++) {
      const u = i / segments
      m.vertex((u - 0.5) * width, 0, (v - 0.5) * depth, 0, 1, 0, u, v)
    }
  }
  m.grid(0, segments, segments)
  return m.build({ type: 'plane', width, depth, segments })
}

/**
 * A cylinder along the Y axis (or `axis`), centred on the origin; `radiusTop: 0` makes a cone. The
 * side and the caps have separate vertices so both get the right normals. u runs around the side
 * from +Z.
 * @example cylinder({ radius: 0.5, height: 2 })
 * @example cylinder({ radius: 1, radiusTop: 0 }) // a cone
 * @example cylinder({ radius: 0.1, height: 3, axis: 'x' }) // an axle lying along x
 * @param {CylinderOptions} [options]
 * @returns {Geometry}
 */
export function cylinder(options) {
  const owner = 'cylinder()'
  const o = resolve(owner, options, GENERATOR_OPTIONS.cylinder, null, {
    radiusBottom: "cylinder(): use 'radius' for the bottom radius",
    radialSegments: "cylinder(): use 'segments' for the divisions around the cylinder",
    openEnded: "cylinder(): use 'caps: false' for an open tube",
  })
  const radius = size(owner, 'radius', o.radius, 0.5, true)
  const radiusTop = size(owner, 'radiusTop', o.radiusTop, radius, true)
  if (radius === 0 && radiusTop === 0) fail(owner, "'radius' and 'radiusTop' can't both be 0")
  const height = size(owner, 'height', o.height, 1)
  const segments = count(owner, 'segments', o.segments, 32, 3)
  const caps = o.caps ?? true
  if (typeof caps !== 'boolean') fail(owner, `'caps' must be true or false, got ${describe(caps)}`)
  const axis = axisOf(owner, o.axis, 'y')

  const m = new Builder()
  // side normals lean up as the side narrows towards the top
  const slope = radius - radiusTop, len = Math.hypot(height, slope)
  const out = height / len, ny = slope / len
  for (let j = 0; j <= 1; j++) {
    const r = j === 0 ? radiusTop : radius
    const y = j === 0 ? height / 2 : -height / 2
    for (let i = 0; i <= segments; i++) {
      // a cone's tip, like a sphere's pole, serves one triangle - centre its u and normal on it
      const u = r === 0 && i < segments ? (i + 0.5) / segments : i / segments
      const phi = r === 0 ? u * TAU : ((i % segments) / segments) * TAU
      const s = Math.sin(phi), c = Math.cos(phi)
      m.vertex(r * s, y, r * c, out * s, ny, out * c, u, j)
    }
  }
  m.grid(0, segments, 1, { pinchTop: radiusTop === 0, pinchBottom: radius === 0 })
  if (caps) {
    if (radiusTop > 0) cap(m, radiusTop, height / 2, 1, segments)
    if (radius > 0) cap(m, radius, -height / 2, -1, segments)
  }
  m.turn('y', axis)
  return m.build({ type: 'cylinder', radius, radiusTop, height, segments, caps, ...(axis !== 'y' && { axis }) })
}

/**
 * A disc closing one end of a cylinder: a centre vertex plus a ring. UVs map the disc into the
 * unit square the way a box's top and bottom faces are mapped.
 * @param {Builder} m @param {number} radius @param {number} y @param {1 | -1} side +1 top, -1 bottom
 * @param {number} segments
 */
function cap(m, radius, y, side, segments) {
  const centre = m.vertex(0, y, 0, 0, side, 0, 0.5, 0.5)
  for (let i = 0; i < segments; i++) {
    const phi = (i / segments) * TAU, s = Math.sin(phi), c = Math.cos(phi)
    // seen from outside the top cap has -z up and the bottom cap +z up
    m.vertex(radius * s, y, radius * c, 0, side, 0, 0.5 + s / 2, 0.5 + (side * c) / 2)
  }
  for (let i = 0; i < segments; i++) {
    const a = centre + 1 + i, b = centre + 1 + ((i + 1) % segments)
    // the ring turns counter-clockwise seen from +Y, so the bottom cap reverses it
    if (side > 0) m.indices.push(centre, a, b)
    else m.indices.push(centre, b, a)
  }
}

/**
 * A torus lying in the x-z plane (the ring goes around the Y axis), centred on the origin.
 * u runs around the ring from +Z, v around the tube starting at its outer edge and heading down.
 * @example torus({ radius: 1, tube: 0.25 })
 * @param {TorusOptions} [options]
 * @returns {Geometry}
 */
export function torus(options) {
  const owner = 'torus()'
  const o = resolve(owner, options, GENERATOR_OPTIONS.torus, null, {
    tubularSegments: "torus(): use 'segments' for the divisions around the ring",
    radialSegments: "torus(): use 'tubeSegments' for the divisions around the tube",
  })
  const radius = size(owner, 'radius', o.radius, 1)
  const tube = size(owner, 'tube', o.tube, 0.4)
  const segments = count(owner, 'segments', o.segments, 48, 3)
  const tubeSegments = count(owner, 'tubeSegments', o.tubeSegments, 16, 3)
  const m = new Builder()
  for (let j = 0; j <= tubeSegments; j++) {
    const v = j / tubeSegments
    // negative angle so v heads down the outside first, keeping the winding counter-clockwise
    const theta = -((j % tubeSegments) / tubeSegments) * TAU
    const ct = Math.cos(theta), st = Math.sin(theta)
    for (let i = 0; i <= segments; i++) {
      const u = i / segments
      const phi = ((i % segments) / segments) * TAU
      const dx = Math.sin(phi), dz = Math.cos(phi)
      const nx = ct * dx, ny = st, nz = ct * dz
      m.vertex(radius * dx + tube * nx, tube * ny, radius * dz + tube * nz, nx, ny, nz, u, v)
    }
  }
  m.grid(0, segments, tubeSegments)
  return m.build({ type: 'torus', radius, tube, segments, tubeSegments })
}

/**
 * A sphere made by subdividing an icosahedron - evenly spread triangles, no poles. Vertices are
 * shared, so it is smooth shaded; it has no UVs (use sphere() for texturing).
 * @example icosphere({ radius: 1, detail: 3 })
 * @param {number | IcosphereOptions} [options] a number sets the radius
 * @returns {Geometry}
 */
export function icosphere(options) {
  const owner = 'icosphere()'
  const o = resolve(owner, options, GENERATOR_OPTIONS.icosphere, (n) => ({ radius: n }), {
    subdivisions: "icosphere(): use 'detail' (0-6) for the subdivision level",
  })
  const radius = size(owner, 'radius', o.radius, 1)
  const detail = count(owner, 'detail', o.detail, 2, 0, 6)

  const t = (1 + Math.sqrt(5)) / 2
  /** @type {number[]} unit-length directions */
  const dirs = []
  const add = (x, y, z) => {
    const l = Math.hypot(x, y, z)
    dirs.push(x / l, y / l, z / l)
    return dirs.length / 3 - 1
  }
  for (const [x, y, z] of [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
    [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ]) add(x, y, z)
  let faces = [
    0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
    3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
  ]
  for (let level = 0; level < detail; level++) {
    // each edge's midpoint is made once and shared by the two triangles either side
    /** @type {Map<number, number>} */
    const midpoints = new Map()
    const mid = (a, b) => {
      const key = a < b ? a * 65536 + b : b * 65536 + a
      let m = midpoints.get(key)
      if (m === undefined) {
        m = add(dirs[a * 3] + dirs[b * 3], dirs[a * 3 + 1] + dirs[b * 3 + 1], dirs[a * 3 + 2] + dirs[b * 3 + 2])
        midpoints.set(key, m)
      }
      return m
    }
    const next = []
    for (let f = 0; f < faces.length; f += 3) {
      const a = faces[f], b = faces[f + 1], c = faces[f + 2]
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a)
      next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca)
    }
    faces = next
  }
  const g = new Geometry({ positions: dirs.map((d) => d * radius), normals: dirs, indices: faces })
  g.source = { type: 'icosphere', radius, detail }
  return g
}

/**
 * A profile turned about the Y axis (or `axis`, with y up the profile becoming that axis), as on a
 * lathe: pistons, bottles, bolts, vases, pulleys. Corners sharper
 * than about 30 degrees stay sharp; gentler ones are shaded smooth. A profile that starts or ends
 * on the axis (radius 0) closes over it. u runs around from +Z and v along the profile from its
 * last point to its first - top to bottom, as on cylinder().
 * @example lathe({ points: [[0, 0], [1, 0], [1, 2], [0.6, 2.4], [0, 2.4]] }) // a closed can with a shoulder
 * @example lathe({ points: outline.arc({ radius: 1, from: -Math.PI / 2, to: Math.PI / 2 }), axis: 'x' }) // a ball on an x axle
 * @param {LatheOptions} options
 * @returns {Geometry}
 */
export function lathe(options) {
  const owner = 'lathe()'
  const o = resolve(owner, options, GENERATOR_OPTIONS.lathe, null, {
    divisions: "lathe(): use 'segments' for the divisions around the axis",
    phiSegments: "lathe(): use 'segments' for the divisions around the axis",
    profile: "lathe(): use 'points' for the profile, as [radius, y] pairs",
  })
  // a radius a hair off the axis (an arc's end, from cos(pi / 2)) is on it, so the shape closes there
  const points = pairs(owner, 'points', o.points, 2).map(([r, y]) => /** @type {[number, number]} */ ([Math.abs(r) < 1e-9 ? 0 : r, y]))
  if (points.some(([r]) => r < 0)) fail(owner, "'points' are [radius, y] pairs - a radius can't be below 0")
  const segments = count(owner, 'segments', o.segments, 32, 3)
  const axis = axisOf(owner, o.axis, 'y')

  // each span of the profile, with its outward normal (to the right, going up)
  const spans = []
  for (let k = 0; k + 1 < points.length; k++) {
    const [r0, y0] = points[k], [r1, y1] = points[k + 1]
    const len = Math.hypot(r1 - r0, y1 - y0)
    if (len === 0) continue
    spans.push({ from: points[k], to: points[k + 1], len, normal: [(y1 - y0) / len, -(r1 - r0) / len] })
  }
  if (!spans.length) fail(owner, "'points' need at least two different points")
  const total = spans.reduce((t, s) => t + s.len, 0)
  const m = new Builder()
  let along = 0
  spans.forEach((s, k) => {
    const start = smoothed(spans[k - 1]?.normal, s.normal), end = smoothed(spans[k + 1]?.normal, s.normal)
    const first = m.count
    // the far end first, as cylinder() puts its top row first, so the winding faces out
    for (const [[r, y], [nr, ny], v] of [[s.to, end, 1 - (along + s.len) / total], [s.from, start, 1 - along / total]]) {
      for (let i = 0; i <= segments; i++) {
        const phi = ((i % segments) / segments) * TAU, sin = Math.sin(phi), cos = Math.cos(phi)
        m.vertex(r * sin, y, r * cos, nr * sin, ny, nr * cos, i / segments, v)
      }
    }
    m.grid(first, segments, 1, { pinchTop: s.to[0] === 0, pinchBottom: s.from[0] === 0 })
    along += s.len
  })
  m.turn('y', axis)
  return m.build({ type: 'lathe', points: points.map((p) => [...p]), segments, ...(axis !== 'y' && { axis }) })
}

/**
 * A flat outline pushed out along Z (or `axis`), centred on the origin: the front faces +Z, the
 * back -Z, and the sides follow the outline. With another axis the front faces that axis's + end,
 * the outline drawn as seen from there. Concave outlines and holes are fine. Corners sharper than about 30
 * degrees stay sharp; gentler ones are shaded smooth, so a many-sided circle looks round. On the
 * front and back u, v span the outline's bounds, upright as seen from that side; on the sides u
 * runs round each outline and v from front to back.
 * @example extrude({ shape: [[0, 0], [2, 0], [2, 1], [0, 1]], depth: 0.5 })
 * @example extrude({ shape: outline.rect(2), holes: [outline.circle(0.5)], depth: 0.2 }) // a plate with a hole
 * @example extrude({ shape: outline.gear({ radius: 1, teeth: 40 }), depth: 0.1, axis: 'x' }) // a gear on an x axle
 * @param {ExtrudeOptions} options
 * @returns {Geometry}
 */
export function extrude(options) {
  const owner = 'extrude()'
  const o = resolve(owner, options, GENERATOR_OPTIONS.extrude, null, {
    amount: "extrude(): use 'depth'",
    points: "extrude(): use 'shape' for the outline, as [x, y] pairs",
    outline: "extrude(): use 'shape' for the outline, as [x, y] pairs",
    bevelEnabled: "extrude() has no bevel - round the shape's corners instead",
  })
  const shape = withoutRepeats(pairs(owner, 'shape', o.shape, 3))
  if (o.holes !== undefined && !Array.isArray(o.holes)) fail(owner, `'holes' must be a list of outlines, got ${describe(o.holes)}`)
  if (typeof o.holes?.[0]?.[0] === 'number') fail(owner, "'holes' is a list of outlines - for one hole, holes: [outline]")
  const holes = /** @type {unknown[]} */ (o.holes ?? []).map((h, i) => withoutRepeats(pairs(owner, `holes[${i}]`, h, 3)))
  const depth = size(owner, 'depth', o.depth, 1)
  const axis = axisOf(owner, o.axis, 'z')
  const front = depth / 2

  // the outline counter-clockwise and the holes clockwise, so every side faces out of the solid
  const outline = area(shape) < 0 ? [...shape].reverse() : shape
  const cutouts = holes.map((h) => (area(h) > 0 ? [...h].reverse() : h))
  const all = [outline, ...cutouts].flat()
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const [x, y] of all) {
    x0 = Math.min(x0, x)
    x1 = Math.max(x1, x)
    y0 = Math.min(y0, y)
    y1 = Math.max(y1, y)
  }
  const w = x1 - x0 || 1, h = y1 - y0 || 1

  const m = new Builder()
  // front and back, from one triangulation
  const tris = triangulate(outline, cutouts)
  for (const [z, nz] of [[front, 1], [-front, -1]]) {
    const start = m.count
    // the back is mapped as seen from behind, as box() maps its back face
    for (const [x, y] of all) m.vertex(x, y, z, 0, 0, nz, nz > 0 ? (x - x0) / w : (x1 - x) / w, (y1 - y) / h)
    for (let t = 0; t < tris.length; t += 3) {
      if (nz > 0) m.indices.push(start + tris[t], start + tris[t + 1], start + tris[t + 2])
      else m.indices.push(start + tris[t], start + tris[t + 2], start + tris[t + 1])
    }
  }
  // the sides: a quad per edge, sharing normals with the next edge across a gentle corner
  for (const ring of [outline, ...cutouts]) {
    const n = ring.length
    const lengths = ring.map(([ax, ay], i) => Math.hypot(ring[(i + 1) % n][0] - ax, ring[(i + 1) % n][1] - ay))
    const normals = ring.map(([ax, ay], i) => {
      const [bx, by] = ring[(i + 1) % n], l = lengths[i] || 1
      return /** @type {[number, number]} */ ([(by - ay) / l, -(bx - ax) / l])
    })
    const perimeter = lengths.reduce((t, l) => t + l, 0) || 1
    let along = 0
    for (let i = 0; i < n; i++) {
      const own = normals[i]
      const [na, nb] = [smoothed(normals[(i + n - 1) % n], own), smoothed(normals[(i + 1) % n], own)]
      const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % n]
      const u0 = along / perimeter, u1 = (along + lengths[i]) / perimeter
      const a = m.vertex(ax, ay, front, na[0], na[1], 0, u0, 0)
      const b = m.vertex(ax, ay, -front, na[0], na[1], 0, u0, 1)
      const c = m.vertex(bx, by, -front, nb[0], nb[1], 0, u1, 1)
      const d = m.vertex(bx, by, front, nb[0], nb[1], 0, u1, 0)
      m.indices.push(a, b, c, a, c, d)
      along += lengths[i]
    }
  }
  m.turn('z', axis)
  return m.build({ type: 'extrude', shape: shape.map((p) => [...p]), holes: holes.map((hole) => hole.map((p) => [...p])), depth, ...(axis !== 'z' && { axis }) })
}

// corners turning less than this (about 30 degrees) are shaded smooth
const CREASE = Math.cos(Math.PI / 6)

/**
 * A 2D normal where a span meets its neighbour: the two averaged across a gentle corner, its own at
 * a sharp one (or at an end, with no neighbour).
 * @param {number[] | undefined} other @param {number[]} own
 * @returns {number[]}
 */
function smoothed(other, own) {
  if (!other || other[0] * own[0] + other[1] * own[1] < CREASE) return own
  const x = other[0] + own[0], y = other[1] + own[1], l = Math.hypot(x, y) || 1
  return [x / l, y / l]
}

/**
 * A list of [a, b] number pairs, at least `min` long.
 * @param {string} owner @param {string} name @param {unknown} value @param {number} min
 * @returns {[number, number][]}
 */
function pairs(owner, name, value, min) {
  if (!Array.isArray(value)) fail(owner, `'${name}' must be a list of [x, y] pairs, got ${describe(value)}`)
  const list = /** @type {any[]} */ (value)
  if (list.length < min) fail(owner, `'${name}' needs at least ${min} points, got ${list.length}`)
  return list.map((p, i) => {
    if (!p || typeof p !== 'object' || typeof p.length !== 'number' || p.length < 2) {
      fail(owner, `'${name}' must be a list of [x, y] pairs - point ${i} is ${describe(p)}`)
    }
    const a = p[0], b = p[1]
    if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) {
      fail(owner, `'${name}' point ${i} must be two finite numbers, got ${describe(p)}`)
    }
    return /** @type {[number, number]} */ ([a, b])
  })
}

/**
 * Line geometry outlining a mesh: one vertex pair per edge, for drawing as Lines. Edges shared by
 * two faces that are flat to each other (within about 1 degree) are left out, so a box gives its
 * 12 outline edges rather than its triangle diagonals. Vertices at exactly the same position are
 * merged first, so meshes with separate vertices per face (box()) still share their edges.
 * @example new Lines({ geometry: edges(box()) })
 * @param {Geometry} geometry triangles, indexed or not
 * @returns {Geometry}
 */
export function edges(geometry) {
  if (!(geometry instanceof Geometry)) fail('edges()', `expected a Geometry, got ${describe(geometry)}`)
  const p = geometry.positions, index = geometry.indices, n = geometry.vertexCount
  // weld: map each vertex to the first vertex at the same position
  /** @type {Map<string, number>} */
  const seen = new Map()
  const weld = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    const key = `${p[i * 3]},${p[i * 3 + 1]},${p[i * 3 + 2]}`
    let w = seen.get(key)
    if (w === undefined) seen.set(key, w = i)
    weld[i] = w
  }

  /** @type {Map<number, { a: number, b: number, nx: number, ny: number, nz: number, faces: number, crease: boolean }>} */
  const found = new Map()
  const corners = index ? index.length : n
  for (let t = 0; t + 2 < corners; t += 3) {
    const a = weld[index ? index[t] : t], b = weld[index ? index[t + 1] : t + 1], c = weld[index ? index[t + 2] : t + 2]
    const abx = p[b * 3] - p[a * 3], aby = p[b * 3 + 1] - p[a * 3 + 1], abz = p[b * 3 + 2] - p[a * 3 + 2]
    const acx = p[c * 3] - p[a * 3], acy = p[c * 3 + 1] - p[a * 3 + 1], acz = p[c * 3 + 2] - p[a * 3 + 2]
    let nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx
    const len = Math.hypot(nx, ny, nz)
    if (len === 0) continue // degenerate: no faces to compare, nothing to outline
    nx /= len
    ny /= len
    nz /= len
    for (const [v0, v1] of [[a, b], [b, c], [c, a]]) {
      const lo = Math.min(v0, v1), hi = Math.max(v0, v1)
      const key = lo * n + hi
      const e = found.get(key)
      if (!e) found.set(key, { a: lo, b: hi, nx, ny, nz, faces: 1, crease: false })
      else {
        e.faces++
        if (e.nx * nx + e.ny * ny + e.nz * nz < COPLANAR) e.crease = true
      }
    }
  }

  // keep open edges and creases; compact to just the vertices they use
  /** @type {Map<number, number>} */
  const remap = new Map()
  /** @type {number[]} */
  const positions = []
  /** @type {number[]} */
  const indices = []
  const use = (v) => {
    let i = remap.get(v)
    if (i === undefined) {
      remap.set(v, i = positions.length / 3)
      positions.push(p[v * 3], p[v * 3 + 1], p[v * 3 + 2])
    }
    return i
  }
  for (const e of found.values()) {
    if (e.faces === 1 || e.crease) indices.push(use(e.a), use(e.b))
  }
  return new Geometry({ positions, indices })
}

const COPLANAR = Math.cos(Math.PI / 180)

/**
 * Line geometry for the three axes: from the origin along +X (red), +Y (green) and +Z (blue).
 * Draw with Lines and `vertexColors: true`.
 * @example new Lines({ geometry: axes(2), material: new LineMaterial({ vertexColors: true }) })
 * @param {number | AxesOptions} [options] a number sets the size
 * @returns {Geometry}
 */
export function axes(options) {
  const owner = 'axes()'
  const o = resolve(owner, options, GENERATOR_OPTIONS.axes, (n) => ({ size: n }))
  const s = size(owner, 'size', o.size, 1)
  const g = new Geometry({
    positions: [0, 0, 0, s, 0, 0, 0, 0, 0, 0, s, 0, 0, 0, 0, 0, 0, s],
    colors: [1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1],
  })
  g.source = { type: 'axes', size: s }
  return g
}

/**
 * A square grid of lines in the x-z plane, centred on the origin - draw it with Lines. (A plane's
 * edges() would only give its outline, since edges() drops lines between flat faces.)
 * @example new Lines({ geometry: grid({ size: 10, divisions: 10 }), material: { color: '#999' } })
 * @param {number | { size?: number, divisions?: number }} [options] a number sets the size
 * @returns {Geometry}
 */
export function grid(options) {
  const owner = 'grid()'
  const o = resolve(owner, options, GENERATOR_OPTIONS.grid, (n) => ({ size: n }), {
    segments: "grid() uses 'divisions' for the number of squares along each side",
  })
  const s = size(owner, 'size', o.size, 10)
  const divisions = count(owner, 'divisions', o.divisions, 10)
  const half = s / 2
  /** @type {number[]} */
  const positions = []
  for (let i = 0; i <= divisions; i++) {
    const p = -half + (s * i) / divisions
    positions.push(p, 0, -half, p, 0, half, -half, 0, p, half, 0, p)
  }
  const g = new Geometry({ positions })
  g.source = { type: 'grid', size: s, divisions }
  return g
}

// Collects vertex data for the analytic shapes, which supply their own normals and UVs.
class Builder {
  /** @type {number[]} */ positions = []
  /** @type {number[]} */ normals = []
  /** @type {number[]} */ uvs = []
  /** @type {number[]} */ indices = []

  get count() {
    return this.positions.length / 3
  }

  /**
   * @param {number} x @param {number} y @param {number} z
   * @param {number} nx @param {number} ny @param {number} nz
   * @param {number} u @param {number} v
   * @returns {number} the new vertex's index
   */
  vertex(x, y, z, nx, ny, nz, u, v) {
    this.positions.push(x, y, z)
    this.normals.push(nx, ny, nz)
    this.uvs.push(u, v)
    return this.count - 1
  }

  /**
   * Triangulate a grid of (cols + 1) x (rows + 1) vertices added row by row from `start`: top row
   * first, u growing along each row, as seen from the front. Each cell becomes two triangles
   * wound counter-clockwise from the front. A pinched row is a single point (a pole or a cone's
   * tip), where one triangle per cell is enough and the other would have no area.
   * @param {number} start @param {number} cols @param {number} rows
   * @param {{ pinchTop?: boolean, pinchBottom?: boolean }} [pinch]
   */
  grid(start, cols, rows, { pinchTop = false, pinchBottom = false } = {}) {
    const stride = cols + 1
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = start + j * stride + i // top left
        const b = a + stride // bottom left
        const c = b + 1 // bottom right
        const d = a + 1 // top right
        if (!(pinchBottom && j === rows - 1)) this.indices.push(a, b, c)
        if (!(pinchTop && j === 0)) this.indices.push(a, c, d)
      }
    }
  }

  /**
   * Lay what has been built along another axis: a quarter turn - never a mirror, so faces still
   * face out. From y (turned shapes): x is reached by turning about z, z by turning about x. From z
   * (pushed outlines): x by turning about y, so the outline is seen from +x, and y by turning about
   * x, so it is seen from above.
   * @param {'y' | 'z'} from @param {Axis} to
   */
  turn(from, to) {
    if (from === to) return
    const map = TURNS[from][to]
    for (const list of [this.positions, this.normals]) {
      for (let i = 0; i < list.length; i += 3) {
        const [x, y, z] = map(list[i], list[i + 1], list[i + 2])
        list[i] = x
        list[i + 1] = y
        list[i + 2] = z
      }
    }
  }

  /** @param {{ type: string } & Record<string, unknown>} source @returns {Geometry} */
  build(source) {
    const { positions, normals, uvs, indices } = this
    const g = new Geometry({ positions, normals, uvs, indices })
    g.source = source
    return g
  }
}

/** @type {Record<string, Record<string, (x: number, y: number, z: number) => number[]>>} */
const TURNS = {
  y: { x: (x, y, z) => [y, -x, z], z: (x, y, z) => [x, -z, y] },
  z: { x: (x, y, z) => [z, y, -x], y: (x, y, z) => [x, z, -y] },
}

/**
 * The axis option, or the shape's own when it's missing.
 * @param {string} owner @param {unknown} value @param {Axis} fallback
 * @returns {Axis}
 */
function axisOf(owner, value, fallback) {
  return value === undefined ? fallback : checkOneOf(owner, 'axis', /** @type {Axis} */ (value), ['x', 'y', 'z'])
}

/**
 * An outline without repeated points. Two in a row - or a last point back at the first, as joined arcs
 * and a rounded rect's straight-less ends give - make a side of no length, which has no direction to
 * face and would crease the smooth sides either side of it (lathe() skips them the same way).
 * @template {ArrayLike<number>} P
 * @param {P[]} points
 * @returns {P[]}
 */
function withoutRepeats(points) {
  const kept = points.filter((p, i) => {
    const q = points[(i + points.length - 1) % points.length]
    return p[0] !== q[0] || p[1] !== q[1]
  })
  return kept.length >= 3 ? kept : points
}
