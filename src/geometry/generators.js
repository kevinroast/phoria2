// Geometry generators: plain functions returning a Geometry. Every shape follows the same
// conventions - +Y up, counter-clockwise front faces, outward normals, glTF UVs (v down).

import { Geometry } from './Geometry.js'
import { checkNumber, checkOptions, describe, fail } from '../validate.js'

const TAU = Math.PI * 2

/** What each generator takes (a number alone sets the first, where that makes sense). */
export const GENERATOR_OPTIONS = {
  box: ['size', 'width', 'height', 'depth', 'segments'],
  sphere: ['radius', 'segments', 'rings'],
  plane: ['size', 'width', 'depth', 'segments'],
  cylinder: ['radius', 'radiusTop', 'height', 'segments', 'caps'],
  torus: ['radius', 'tube', 'segments', 'tubeSegments'],
  icosphere: ['radius', 'detail'],
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
 * A cylinder along the Y axis, centred on the origin; `radiusTop: 0` makes a cone. The side and the
 * caps have separate vertices so both get the right normals. u runs around the side from +Z.
 * @example cylinder({ radius: 0.5, height: 2 })
 * @example cylinder({ radius: 1, radiusTop: 0 }) // a cone
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
  return m.build({ type: 'cylinder', radius, radiusTop, height, segments, caps })
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

  /** @param {{ type: string } & Record<string, unknown>} source @returns {Geometry} */
  build(source) {
    const { positions, normals, uvs, indices } = this
    const g = new Geometry({ positions, normals, uvs, indices })
    g.source = source
    return g
  }
}

/**
 * Check an options object, turning a plain number into options first where the shape allows it.
 * @param {string} owner @param {unknown} options @param {string[]} keys
 * @param {((n: number) => object) | null} fromNumber @param {Record<string, string>} [hints]
 * @returns {Record<string, any>}
 */
function resolve(owner, options, keys, fromNumber, hints) {
  const o = /** @type {object} */ (typeof options === 'number' && fromNumber ? fromNumber(options) : options)
  checkOptions(owner, o, keys, hints)
  return o ?? {}
}

/**
 * A length: a finite number above 0 (or 0 itself when `zero`), or the default when missing.
 * @param {string} owner @param {string} name @param {unknown} value @param {number} fallback
 * @param {boolean} [zero]
 * @returns {number}
 */
function size(owner, name, value, fallback, zero = false) {
  if (value === undefined) return fallback
  const v = checkNumber(owner, name, value)
  if (!Number.isFinite(v) || v < 0 || (v === 0 && !zero)) {
    fail(owner, `'${name}' must be ${zero ? '0 or more' : 'more than 0'}, got ${v}`)
  }
  return v
}

/**
 * A whole number of segments in [min, max], or the default when missing.
 * @param {string} owner @param {string} name @param {unknown} value @param {number} fallback
 * @param {number} [min] @param {number} [max]
 * @returns {number}
 */
function count(owner, name, value, fallback, min = 1, max = Infinity) {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || /** @type {number} */ (value) < min || /** @type {number} */ (value) > max) {
    const range = max === Infinity ? `${min} or more` : `from ${min} to ${max}`
    fail(owner, `'${name}' must be a whole number ${range}, got ${describe(value)}`)
  }
  return /** @type {number} */ (value)
}
