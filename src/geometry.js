// Geometry generators. Each returns { points, edges, polygons } ready to hand to Entity.create().

/** @import { Geometry, Polygon, XYZ } from './types.js' */

const CUBE_EDGES = [
  { a: 0, b: 1 }, { a: 1, b: 2 }, { a: 2, b: 3 }, { a: 3, b: 0 },
  { a: 4, b: 5 }, { a: 5, b: 6 }, { a: 6, b: 7 }, { a: 7, b: 4 },
  { a: 0, b: 4 }, { a: 1, b: 5 }, { a: 2, b: 6 }, { a: 3, b: 7 },
]

const boxPoints = (sx, sy, sz) => [
  { x: -sx, y: sy, z: -sz }, { x: sx, y: sy, z: -sz }, { x: sx, y: -sy, z: -sz }, { x: -sx, y: -sy, z: -sz },
  { x: -sx, y: sy, z: sz }, { x: sx, y: sy, z: sz }, { x: sx, y: -sy, z: sz }, { x: -sx, y: -sy, z: sz },
]

const copyEdges = (edges) => edges.map(({ a, b }) => ({ a, b }))
const polys = (...lists) => lists.map((vertices) => ({ vertices }))

/**
 * Subdivided plane in the x-z plane, centred on the origin, `scale` units across.
 * @param {number} vsegs segments along z
 * @param {number} hsegs segments along x
 * @param {number} level reserved for future triangle subdivision, currently ignored
 * @param {number} scale
 * @param {boolean} [generateUVs]
 * @returns {Geometry}
 */
export function generateTesselatedPlane(vsegs, hsegs, level, scale, generateUVs) {
  const points = [], edges = [], polygons = []
  const hinc = scale / hsegs, vinc = scale / vsegs
  let c = 0
  for (let i = 0, z = scale / 2; i <= vsegs; i++, z -= vinc) {
    for (let j = 0, x = -scale / 2; j <= hsegs; j++, x += hinc, c++) {
      points.push({ x, y: 0, z })
      if (j !== 0) edges.push({ a: c, b: c - 1 })
      if (i !== 0) edges.push({ a: c, b: c - hsegs - 1 })
      if (i !== 0 && j !== 0) {
        const p = { vertices: [c - hsegs - 1, c, c - 1, c - hsegs - 2] }
        if (generateUVs) {
          const u0 = (j - 1) / hsegs, u1 = j / hsegs
          const v0 = (i - 1) / vsegs, v1 = i / vsegs
          p.uvs = [u1, v0, u1, v1, u0, v1, u0, v0]
        }
        polygons.push(p)
      }
    }
  }
  return { points, edges, polygons }
}

/**
 * Cube centred on the origin, 2 units across (the "unit" is the half-extent).
 * @param {number} [scale] half-extent, default 1
 * @returns {Geometry}
 */
export function generateUnitCube(scale = 1) {
  return {
    points: boxPoints(scale, scale, scale),
    edges: copyEdges(CUBE_EDGES),
    polygons: polys([0, 1, 2, 3], [1, 5, 6, 2], [5, 4, 7, 6], [4, 0, 3, 7], [4, 5, 1, 0], [3, 2, 6, 7]),
  }
}

/**
 * Square based pyramid 2 units wide and 1.5 units high, base on the x-z plane.
 * @param {number} [scale]
 * @returns {Geometry}
 */
export function generatePyramid(scale = 1) {
  const s = scale
  return {
    points: [{ x: -s, y: 0, z: -s }, { x: -s, y: 0, z: s }, { x: s, y: 0, z: s }, { x: s, y: 0, z: -s }, { x: 0, y: 1.5 * s, z: 0 }],
    edges: [{ a: 0, b: 1 }, { a: 1, b: 2 }, { a: 2, b: 3 }, { a: 3, b: 0 }, { a: 0, b: 4 }, { a: 1, b: 4 }, { a: 2, b: 4 }, { a: 3, b: 4 }],
    polygons: polys([0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4], [3, 2, 1, 0]),
  }
}

/**
 * Unit icosahedron - generator from "Tessellation of sphere" by C. Laugerotte.
 * @param {number} [scale]
 * @returns {Geometry}
 */
export function generateIcosahedron(scale = 1) {
  const t = (1 + Math.sqrt(5)) / 2
  const tau = (t / Math.sqrt(1 + t * t)) * scale
  const one = (1 / Math.sqrt(1 + t * t)) * scale
  return {
    points: [
      { x: tau, y: one, z: 0 }, { x: -tau, y: one, z: 0 }, { x: -tau, y: -one, z: 0 }, { x: tau, y: -one, z: 0 },
      { x: one, y: 0, z: tau }, { x: one, y: 0, z: -tau }, { x: -one, y: 0, z: -tau }, { x: -one, y: 0, z: tau },
      { x: 0, y: tau, z: one }, { x: 0, y: -tau, z: one }, { x: 0, y: -tau, z: -one }, { x: 0, y: tau, z: -one },
    ],
    edges: [
      [4, 8], [8, 7], [7, 4], [7, 9], [9, 4], [5, 6], [6, 11], [11, 5], [5, 10], [10, 6],
      [0, 4], [4, 3], [3, 0], [3, 5], [5, 0], [2, 7], [7, 1], [1, 2], [1, 6], [6, 2],
      [8, 0], [0, 11], [11, 8], [11, 1], [1, 8], [9, 10], [10, 3], [3, 9], [9, 2], [2, 10],
    ].map(([a, b]) => ({ a, b })),
    polygons: polys(
      [4, 8, 7], [4, 7, 9], [5, 6, 11], [5, 10, 6], [0, 4, 3], [0, 3, 5], [2, 7, 1], [2, 1, 6],
      [8, 0, 11], [8, 11, 1], [9, 10, 3], [9, 2, 10], [8, 4, 0], [11, 0, 5], [4, 9, 3], [5, 3, 10],
      [7, 8, 1], [6, 1, 11], [7, 2, 9], [6, 10, 2]),
  }
}

/**
 * One level of normalised triangle subdivision (from the OpenGL guide's "Subdividing to Improve a
 * Polygonal Approximation to a Surface"). Works on triangles and quads; shared vertices are not
 * reused, so the result is larger than it strictly needs to be.
 * @param {XYZ[]} points
 * @param {Polygon[]} polygons
 * @returns {Geometry}
 */
export function subdivide(points, polygons) {
  const vertices = [], out = []
  const normalize = (v) => {
    const len = 1 / Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
    v.x *= len
    v.y *= len
    v.z *= len
    return v
  }
  const mid = (a, b) => normalize({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
  const split = (v1, v2, v3) => {
    const n = vertices.length
    vertices.push(v1, v2, v3, mid(v1, v2), mid(v2, v3), mid(v3, v1))
    out.push(
      { vertices: [n, n + 3, n + 5] },
      { vertices: [n + 1, n + 4, n + 3] },
      { vertices: [n + 2, n + 5, n + 4] },
      { vertices: [n + 3, n + 4, n + 5] })
  }
  for (const { vertices: vs } of polygons) {
    if (vs.length === 3) {
      split(points[vs[0]], points[vs[1]], points[vs[2]])
    } else if (vs.length === 4) {
      split(points[vs[0]], points[vs[1]], points[vs[2]])
      split(points[vs[2]], points[vs[3]], points[vs[0]])
    }
  }
  return { points: vertices, polygons: out }
}

/**
 * Cylinder along the y axis with `strips` quads around it and n-gon end caps.
 * @param {number} radius
 * @param {number} length
 * @param {number} strips
 * @returns {Geometry}
 */
export function generateCylinder(radius, length, strips) {
  const points = [], polygons = [], edges = []
  const inc = 2 * Math.PI / strips
  for (let s = 0, offset = 0; s <= strips; s++, offset += inc) {
    const x = Math.cos(offset) * radius, z = Math.sin(offset) * radius
    points.push({ x, y: length / 2, z }, { x, y: -length / 2, z })
    if (s !== 0) {
      polygons.push({ vertices: [s * 2 - 2, s * 2, s * 2 + 1, s * 2 - 1] })
      edges.push({ a: s * 2, b: s * 2 - 2 }, { a: s * 2 - 2, b: s * 2 - 1 }, { a: s * 2 + 1, b: s * 2 - 1 })
      if (s === strips - 1) {
        const top = [], bottom = []
        for (let i = strips; i >= 0; i--) top.push(i * 2)
        for (let i = 0; i < strips; i++) bottom.push(i * 2 + 1)
        polygons.push({ vertices: top }, { vertices: bottom })
      }
    }
  }
  return { points, edges, polygons }
}

/**
 * Box with independent half-extents along each axis.
 * @param {{ scalex?: number, scaley?: number, scalez?: number }} [extents]
 * @returns {Geometry}
 */
export function generateCuboid({ scalex = 1, scaley = 1, scalez = 1 } = {}) {
  return {
    points: boxPoints(scalex, scaley, scalez),
    edges: copyEdges(CUBE_EDGES),
    polygons: polys([0, 1, 2, 3], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [4, 0, 3, 7], [5, 4, 7, 6]),
  }
}

/**
 * UV sphere - triangles for the top and bottom rings, quads for the strips between.
 * @param {number} scale radius
 * @param {number} lats rings from pole to pole
 * @param {number} longs segments around
 * @param {boolean} [generateUVs]
 * @returns {Geometry}
 */
export function generateSphere(scale, lats, longs, generateUVs) {
  const points = [], edges = [], polygons = [], uvs = []

  for (let lat = 0; lat <= lats; lat++) {
    const theta = lat * Math.PI / lats
    const sinTheta = Math.sin(theta), cosTheta = Math.cos(theta)
    for (let long = 0; long <= longs; long++) {
      const phi = long * 2 * Math.PI / longs
      points.push({
        x: scale * Math.cos(phi) * sinTheta,
        y: scale * cosTheta,
        z: scale * Math.sin(phi) * sinTheta,
      })
      if (generateUVs) uvs.push(long / longs, lat / lats)
    }
  }

  const uvsFor = (vertices) => vertices.flatMap((v) => [uvs[v * 2], uvs[v * 2 + 1]])
  for (let lat = 0; lat < lats; lat++) {
    for (let long = 0; long < longs; long++) {
      const first = lat * (longs + 1) + long
      const second = first + longs + 1
      let vertices
      if (lat === 0) {
        vertices = [first + 1, second + 1, second]
      } else if (lat === lats - 1) {
        vertices = [first + 1, second, first]
      } else {
        vertices = [first + 1, second + 1, second, first]
      }
      edges.push({ a: first, b: second })
      if (vertices.length === 4) edges.push({ a: second, b: second + 1 })
      const p = { vertices }
      if (generateUVs) p.uvs = uvsFor(vertices)
      polygons.push(p)
    }
  }
  return { points, edges, polygons }
}
