import { describe, expect, it } from 'vitest'
import { Geometry } from '../src/geometry/Geometry.js'
import { axes, box, cylinder, edges, icosphere, plane, sphere, torus } from '../src/geometry/generators.js'
import { fromPolygons } from '../src/geometry/fromPolygons.js'

// --- helpers ---------------------------------------------------------------------------------

const vec = (arr, i, size = 3) => Array.from(arr.subarray(i * size, i * size + size))
const sub = (a, b) => a.map((x, k) => x - b[k])
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const len = (a) => Math.hypot(...a)

/** Triangles as vertex index triples. */
function triangles(g) {
  const out = []
  for (let t = 0; t + 2 < g.elementCount; t += 3) {
    out.push(g.indices ? [g.indices[t], g.indices[t + 1], g.indices[t + 2]] : [t, t + 1, t + 2])
  }
  return out
}

/** Unnormalised face normal (b - a) x (c - a), plus the centroid. */
function face(g, [a, b, c]) {
  const pa = vec(g.positions, a), pb = vec(g.positions, b), pc = vec(g.positions, c)
  return { normal: cross(sub(pb, pa), sub(pc, pa)), centroid: [0, 1, 2].map((k) => (pa[k] + pb[k] + pc[k]) / 3) }
}

function expectIndicesInRange(g) {
  for (const i of g.indices ?? []) expect(i).toBeLessThan(g.vertexCount)
}

function expectUnitNormals(g) {
  for (let i = 0; i < g.vertexCount; i++) expect(len(vec(g.normals, i))).toBeCloseTo(1, 5)
}

// every triangle has area, and winds counter-clockwise relative to its vertex normals
function expectWindingMatchesNormals(g) {
  for (const tri of triangles(g)) {
    const { normal } = face(g, tri)
    expect(len(normal)).toBeGreaterThan(0)
    const avg = tri.map((v) => vec(g.normals, v)).reduce((s, n) => s.map((x, k) => x + n[k]))
    expect(dot(normal, avg)).toBeGreaterThan(0)
  }
}

// every face points away from `centreOf(centroid)` - the shape's centre, or a torus's tube centre
function expectOutward(g, centreOf = () => [0, 0, 0]) {
  for (const tri of triangles(g)) {
    const { normal, centroid } = face(g, tri)
    expect(dot(normal, sub(centroid, centreOf(centroid)))).toBeGreaterThan(0)
  }
}

// glTF UVs (u right, v down) on a CCW face seen from the front: the triangle is clockwise in uv space
function expectUVsUpright(g) {
  for (const [a, b, c] of triangles(g)) {
    const ua = vec(g.uvs, a, 2), ub = vec(g.uvs, b, 2), uc = vec(g.uvs, c, 2)
    const e1 = sub(ub, ua), e2 = sub(uc, ua)
    expect(e1[0] * e2[1] - e1[1] * e2[0]).toBeLessThan(0)
  }
}

function expectBounds(g, min, max) {
  for (let k = 0; k < 3; k++) {
    expect(g.bounds.min[k]).toBeCloseTo(min[k], 5)
    expect(g.bounds.max[k]).toBeCloseTo(max[k], 5)
  }
}

/** Index of the first vertex at `pos` with normal `normal`. */
function find(g, pos, normal) {
  for (let i = 0; i < g.vertexCount; i++) {
    const p = vec(g.positions, i), n = vec(g.normals, i)
    if (len(sub(p, pos)) < 1e-6 && len(sub(n, normal)) < 1e-6) return i
  }
  return -1
}

function expectWellFormed(g) {
  expect(g).toBeInstanceOf(Geometry)
  expect(g.hasNormals).toBe(true) // supplied, not computed
  expectIndicesInRange(g)
  expectUnitNormals(g)
  expectWindingMatchesNormals(g)
}

// --- generators ------------------------------------------------------------------------------

describe('box', () => {
  it('has 4 vertices and 2 triangles per face by default, 1 unit across', () => {
    const g = box()
    expect(g.vertexCount).toBe(24)
    expect(g.indices).toHaveLength(36)
    expect(g.indices).toBeInstanceOf(Uint16Array)
    expectWellFormed(g)
    expectOutward(g)
    expectBounds(g, [-0.5, -0.5, -0.5], [0.5, 0.5, 0.5])
    expect(g.toJSON()).toEqual({ type: 'box', width: 1, height: 1, depth: 1, segments: 1 })
  })

  it('takes a number or sizes, and subdivides each face', () => {
    expectBounds(box(2), [-1, -1, -1], [1, 1, 1])
    const g = box({ width: 4, height: 2, depth: 1, segments: 3 })
    expect(g.vertexCount).toBe(6 * 16)
    expect(g.indices).toHaveLength(6 * 9 * 6)
    expectWellFormed(g)
    expectOutward(g)
    expectBounds(g, [-2, -1, -0.5], [2, 1, 0.5])
    expect(g.toJSON()).toEqual({ type: 'box', width: 4, height: 2, depth: 1, segments: 3 })
    expect(box(3).toJSON()).toEqual({ type: 'box', width: 3, height: 3, depth: 3, segments: 1 })
  })

  it('maps UVs glTF style: top left (0, 0), bottom right (1, 1), sides upright', () => {
    const g = box({ width: 2, height: 2, depth: 2 })
    expectUVsUpright(g)
    // front face (+Z) seen from +Z
    expect(vec(g.uvs, find(g, [-1, 1, 1], [0, 0, 1]), 2)).toEqual([0, 0])
    expect(vec(g.uvs, find(g, [1, -1, 1], [0, 0, 1]), 2)).toEqual([1, 1])
    // right face (+X) seen from +X: top left is towards +Z
    expect(vec(g.uvs, find(g, [1, 1, 1], [1, 0, 0]), 2)).toEqual([0, 0])
    expect(vec(g.uvs, find(g, [1, -1, -1], [1, 0, 0]), 2)).toEqual([1, 1])
    // back face (-Z) seen from -Z: top left is towards +X
    expect(vec(g.uvs, find(g, [1, 1, -1], [0, 0, -1]), 2)).toEqual([0, 0])
    // top face seen from above with -Z at the top of the image
    expect(vec(g.uvs, find(g, [-1, 1, -1], [0, 1, 0]), 2)).toEqual([0, 0])
    expect(vec(g.uvs, find(g, [1, 1, 1], [0, 1, 0]), 2)).toEqual([1, 1])
    // bottom face seen from below with +Z at the top
    expect(vec(g.uvs, find(g, [-1, -1, 1], [0, -1, 0]), 2)).toEqual([0, 0])
  })

  it('rejects bad options helpfully', () => {
    expect(() => box({ widt: 2 })).toThrow("box(): unknown option 'widt' - did you mean 'width'?")
    expect(() => box({ widthSegments: 2 })).toThrow("box() has one 'segments' option")
    expect(() => box({ segments: 0 })).toThrow("box(): 'segments' must be a whole number 1 or more, got 0")
    expect(() => box({ segments: 1.5 })).toThrow("'segments' must be a whole number")
    expect(() => box({ width: 'big' })).toThrow("box(): 'width' must be a number, got 'big'")
    expect(() => box(-1)).toThrow("box(): 'size' must be more than 0, got -1")
    expect(() => box('2')).toThrow('box(): expected an options object')
  })
})

describe('plane', () => {
  it('lies in x-z facing +Y, 1 x 1 by default', () => {
    const g = plane()
    expect(g.vertexCount).toBe(4)
    expect(g.indices).toHaveLength(6)
    expectWellFormed(g)
    for (const tri of triangles(g)) expect(face(g, tri).normal[1]).toBeGreaterThan(0)
    for (let i = 0; i < g.vertexCount; i++) expect(vec(g.normals, i)).toEqual([0, 1, 0])
    expectBounds(g, [-0.5, 0, -0.5], [0.5, 0, 0.5])
    expect(g.toJSON()).toEqual({ type: 'plane', width: 1, depth: 1, segments: 1 })
  })

  it('sizes and subdivides', () => {
    const g = plane({ width: 4, depth: 2, segments: 4 })
    expect(g.vertexCount).toBe(25)
    expect(g.indices).toHaveLength(4 * 4 * 6)
    expectWellFormed(g)
    expectBounds(g, [-2, 0, -1], [2, 0, 1])
    expectBounds(plane(6), [-3, 0, -3], [3, 0, 3])
  })

  it('maps UVs glTF style seen from above: -x -z corner (0, 0), +x +z corner (1, 1)', () => {
    const g = plane(2)
    expectUVsUpright(g)
    expect(vec(g.uvs, find(g, [-1, 0, -1], [0, 1, 0]), 2)).toEqual([0, 0])
    expect(vec(g.uvs, find(g, [1, 0, -1], [0, 1, 0]), 2)).toEqual([1, 0])
    expect(vec(g.uvs, find(g, [1, 0, 1], [0, 1, 0]), 2)).toEqual([1, 1])
  })

  it('rejects bad options helpfully', () => {
    expect(() => plane({ dept: 2 })).toThrow("plane(): unknown option 'dept' - did you mean 'depth'?")
    expect(() => plane({ height: 2 })).toThrow("plane() lies in the x-z plane - use 'depth'")
    expect(() => plane({ segments: -2 })).toThrow("plane(): 'segments' must be a whole number 1 or more, got -2")
  })
})

describe('sphere', () => {
  it('has a seam column and single-triangle pole caps by default', () => {
    const g = sphere()
    expect(g.vertexCount).toBe(33 * 17)
    expect(g.indices).toHaveLength(32 * 14 * 6 + 32 * 2 * 3)
    expectWellFormed(g)
    expectOutward(g)
    expectBounds(g, [-1, -1, -1], [1, 1, 1])
    expect(g.uvs).toHaveLength(g.vertexCount * 2)
    expect(g.toJSON()).toEqual({ type: 'sphere', radius: 1, segments: 32, rings: 16 })
  })

  it('puts every vertex on the surface, normals along the radius', () => {
    const g = sphere({ radius: 2, segments: 8, rings: 6 })
    for (let i = 0; i < g.vertexCount; i++) {
      const p = vec(g.positions, i)
      expect(len(p)).toBeCloseTo(2, 5)
      expect(dot(vec(g.normals, i), p) / 2).toBeCloseTo(1, 5)
    }
    expectWellFormed(g)
    expectOutward(g)
    expectBounds(sphere(3), [-3, -3, -3], [3, 3, 3])
  })

  it('maps v from the north pole (0) to the south pole (1), u to the right', () => {
    const g = sphere()
    expectUVsUpright(g)
    for (let i = 0; i < g.vertexCount; i++) {
      const y = g.positions[i * 3 + 1], v = g.uvs[i * 2 + 1]
      expect(v).toBeCloseTo(Math.acos(Math.min(1, Math.max(-1, y))) / Math.PI, 5)
    }
  })

  it('rejects bad options helpfully', () => {
    expect(() => sphere({ radus: 1 })).toThrow("sphere(): unknown option 'radus' - did you mean 'radius'?")
    expect(() => sphere({ heightSegments: 8 })).toThrow("use 'rings'")
    expect(() => sphere({ segments: 2 })).toThrow("sphere(): 'segments' must be a whole number 3 or more, got 2")
    expect(() => sphere({ rings: 1 })).toThrow("sphere(): 'rings' must be a whole number 2 or more, got 1")
    expect(() => sphere(0)).toThrow("sphere(): 'radius' must be more than 0, got 0")
  })
})

describe('cylinder', () => {
  it('has separate side and cap vertices by default', () => {
    const g = cylinder()
    expect(g.vertexCount).toBe(33 * 2 + 2 * 33)
    expect(g.indices).toHaveLength(32 * 6 + 2 * 32 * 3)
    expectWellFormed(g)
    expectOutward(g)
    expectUVsUpright(g)
    expectBounds(g, [-0.5, -0.5, -0.5], [0.5, 0.5, 0.5])
    expect(g.toJSON()).toEqual({ type: 'cylinder', radius: 0.5, radiusTop: 0.5, height: 1, segments: 32, caps: true })
  })

  it('makes a cone with radiusTop 0, with no top cap', () => {
    const g = cylinder({ radius: 1, radiusTop: 0, height: 2, segments: 16 })
    expect(g.vertexCount).toBe(17 * 2 + 17)
    expect(g.indices).toHaveLength(16 * 3 + 16 * 3)
    expectWellFormed(g)
    expectOutward(g)
    expectUVsUpright(g)
    expectBounds(g, [-1, -1, -1], [1, 1, 1])
    // side normals lean up towards the tip: slope 1 across 2 up
    expect(find(g, [0, -1, 1], [0, 1 / Math.sqrt(5), 2 / Math.sqrt(5)])).toBeGreaterThanOrEqual(0)
    expect(g.toJSON()).toMatchObject({ radiusTop: 0, caps: true })
  })

  it('can be open ended', () => {
    const g = cylinder({ caps: false, segments: 8 })
    expect(g.vertexCount).toBe(18)
    expect(g.indices).toHaveLength(48)
    expectWellFormed(g)
    expectOutward(g)
  })

  it('rejects bad options helpfully', () => {
    expect(() => cylinder({ radiusTp: 0 })).toThrow("cylinder(): unknown option 'radiusTp' - did you mean 'radiusTop'?")
    expect(() => cylinder({ openEnded: true })).toThrow("use 'caps: false'")
    expect(() => cylinder({ segments: 2 })).toThrow("cylinder(): 'segments' must be a whole number 3 or more, got 2")
    expect(() => cylinder({ caps: 'no' })).toThrow("cylinder(): 'caps' must be true or false, got 'no'")
    expect(() => cylinder({ radius: 0, radiusTop: 0 })).toThrow("can't both be 0")
    expect(() => cylinder(1)).toThrow('cylinder(): expected an options object, got 1')
  })
})

describe('torus', () => {
  it('lies in the x-z plane around Y', () => {
    const g = torus()
    expect(g.vertexCount).toBe(49 * 17)
    expect(g.indices).toHaveLength(48 * 16 * 6)
    expectWellFormed(g)
    expectUVsUpright(g)
    expectBounds(g, [-1.4, -0.4, -1.4], [1.4, 0.4, 1.4])
    expect(g.toJSON()).toEqual({ type: 'torus', radius: 1, tube: 0.4, segments: 48, tubeSegments: 16 })
  })

  it('faces point away from the middle of the tube', () => {
    const g = torus({ radius: 2, tube: 0.5, segments: 12, tubeSegments: 8 })
    const tubeCentre = ([x, , z]) => {
      const r = Math.hypot(x, z)
      return [(x / r) * 2, 0, (z / r) * 2]
    }
    expectWellFormed(g)
    expectOutward(g, tubeCentre)
  })

  it('rejects bad options helpfully', () => {
    expect(() => torus({ tubeSegment: 8 })).toThrow("torus(): unknown option 'tubeSegment' - did you mean 'tubeSegments'?")
    expect(() => torus({ tubularSegments: 8 })).toThrow("use 'segments'")
    expect(() => torus({ tubeSegments: 0 })).toThrow("torus(): 'tubeSegments' must be a whole number 3 or more, got 0")
  })
})

describe('icosphere', () => {
  it('shares vertices, with normals along the radius', () => {
    const g = icosphere()
    expect(g.vertexCount).toBe(162)
    expect(g.indices).toHaveLength(320 * 3)
    expect(g.uvs).toBeNull()
    expectWellFormed(g)
    expectOutward(g)
    for (let i = 0; i < g.vertexCount; i++) {
      const p = vec(g.positions, i)
      expect(len(p)).toBeCloseTo(1, 5)
      expect(dot(vec(g.normals, i), p)).toBeCloseTo(1, 5)
    }
    expect(g.toJSON()).toEqual({ type: 'icosphere', radius: 1, detail: 2 })
  })

  it('has 20 faces at detail 0 and 4x more per level', () => {
    const g0 = icosphere({ detail: 0 })
    expect(g0.vertexCount).toBe(12)
    expect(g0.indices).toHaveLength(60)
    expectWellFormed(g0)
    expectOutward(g0)
    const g6 = icosphere({ radius: 3, detail: 6 })
    expect(g6.vertexCount).toBe(10 * 4 ** 6 + 2)
    expect(g6.indices).toHaveLength(20 * 4 ** 6 * 3)
    expect(g6.bounds.max[0]).toBeLessThanOrEqual(3 + 1e-5)
    expect(g6.bounds.max[0]).toBeGreaterThan(2.99)
    expect(icosphere(2).toJSON()).toEqual({ type: 'icosphere', radius: 2, detail: 2 })
  })

  it('rejects bad options helpfully', () => {
    expect(() => icosphere({ detial: 1 })).toThrow("icosphere(): unknown option 'detial' - did you mean 'detail'?")
    expect(() => icosphere({ detail: 7 })).toThrow("icosphere(): 'detail' must be a whole number from 0 to 6, got 7")
    expect(() => icosphere({ detail: -1 })).toThrow('from 0 to 6')
  })
})

describe('edges', () => {
  const pairs = (g) => {
    const out = []
    for (let i = 0; i < g.indices.length; i += 2) out.push([vec(g.positions, g.indices[i]), vec(g.positions, g.indices[i + 1])])
    return out
  }

  it('gives a box its 12 outline edges, welding the per-face vertices', () => {
    const g = edges(box(2))
    expect(g.indices).toHaveLength(24)
    expect(g.vertexCount).toBe(8)
    expect(g.source).toBeNull()
    expect(g.toJSON()).toMatchObject({ positions: expect.any(Array), indices: expect.any(Array) })
    // every edge runs along one axis, the full 2 units
    for (const [a, b] of pairs(g)) {
      const d = sub(b, a).map(Math.abs)
      expect(d.filter((x) => x === 0)).toHaveLength(2)
      expect(Math.max(...d)).toBe(2)
    }
  })

  it('drops edges inside flat faces but keeps creases and open borders', () => {
    expect(edges(box({ segments: 3 })).indices).toHaveLength(12 * 3 * 2)
    expect(edges(plane({ segments: 4 })).indices).toHaveLength(16 * 2)
    expect(edges(icosphere({ detail: 0 })).indices).toHaveLength(30 * 2)
    // sphere quads are flat, so only the rings and meridians remain; the seam welds
    expect(edges(sphere()).indices).toHaveLength((32 * 16 + 32 * 15) * 2)
  })

  it('works on non-indexed geometry, and rejects anything else', () => {
    const g = new Geometry({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] })
    expect(edges(g).indices).toHaveLength(6)
    expect(() => edges({ positions: [] })).toThrow('edges(): expected a Geometry, got an object')
  })
})

describe('axes', () => {
  it('draws +X red, +Y green, +Z blue from the origin', () => {
    const g = axes(2)
    expect(g.vertexCount).toBe(6)
    expect(g.indices).toBeNull()
    expect(Array.from(g.positions)).toEqual([0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 2])
    expect(Array.from(g.colors)).toEqual([1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1])
    expect(g.toJSON()).toEqual({ type: 'axes', size: 2 })
    expect(axes().toJSON()).toEqual({ type: 'axes', size: 1 })
    expect(axes({ size: 3 }).bounds.max[2]).toBe(3)
  })

  it('rejects bad options helpfully', () => {
    expect(() => axes({ sise: 1 })).toThrow("axes(): unknown option 'sise' - did you mean 'size'?")
    expect(() => axes(-1)).toThrow("axes(): 'size' must be more than 0, got -1")
  })
})

// --- fromPolygons ----------------------------------------------------------------------------

// the v1 unit cube, as v1's generateUnitCube() made it
const V1_CUBE = {
  points: [
    { x: -1, y: 1, z: -1 }, { x: 1, y: 1, z: -1 }, { x: 1, y: -1, z: -1 }, { x: -1, y: -1, z: -1 },
    { x: -1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }, { x: 1, y: -1, z: 1 }, { x: -1, y: -1, z: 1 },
  ],
  polygons: [[0, 1, 2, 3], [1, 5, 6, 2], [5, 4, 7, 6], [4, 0, 3, 7], [4, 5, 1, 0], [3, 2, 6, 7]].map((vertices) => ({ vertices })),
}

describe('fromPolygons', () => {
  it('triangulates a v1 cube into 12 flat, outward triangles', () => {
    const g = fromPolygons(V1_CUBE)
    expect(triangles(g)).toHaveLength(12)
    expect(g.indices).toBeNull() // flat normals give each face its own vertices
    expect(g.source).toBeNull()
    expectIndicesInRange(g)
    expectUnitNormals(g)
    expectWindingMatchesNormals(g)
    expectOutward(g)
    expectBounds(g, [-1, -1, -1], [1, 1, 1])
    // flat: all three corners of a triangle share its face normal
    for (const tri of triangles(g)) {
      const n = face(g, tri).normal, unit = n.map((x) => x / len(n))
      for (const v of tri) expect(dot(vec(g.normals, v), unit)).toBeCloseTo(1, 5)
    }
  })

  it('shares normals across faces when smooth', () => {
    const g = fromPolygons({ ...V1_CUBE, smooth: true })
    expect(g.vertexCount).toBe(8)
    expect(triangles(g)).toHaveLength(12)
    expectOutward(g)
    // a corner's normal points outwards, between its three faces
    const n = vec(g.normals, 0)
    expect(len(n)).toBeCloseTo(1, 5)
    expect(n.map(Math.sign)).toEqual([-1, 1, -1])
  })

  it('accepts [x, y, z] points and a whole v1 model with edges', () => {
    const g = fromPolygons({ points: V1_CUBE.points.map(({ x, y, z }) => [x, y, z]), polygons: V1_CUBE.polygons, edges: [] })
    expect(triangles(g)).toHaveLength(12)
    expectOutward(g)
  })

  it('keeps per-polygon UVs per corner, in fan order', () => {
    const g = fromPolygons({
      points: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1]],
      polygons: [
        { vertices: [0, 1, 2, 3], uvs: [0, 1, 1, 1, 1, 0, 0, 0] },
        { vertices: [0, 4, 1] }, // no uvs - gets zeros
      ],
    })
    expect(g.vertexCount).toBe(9)
    expect(g.indices).toBeNull()
    expect(Array.from(g.uvs)).toEqual([0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expectWindingMatchesNormals(g)
    expect(vec(g.normals, 0)).toEqual([0, 0, 1])
  })

  it('rejects bad data with the polygon and index', () => {
    const points = [[0, 0, 0], [1, 0, 0], [0, 1, 0]]
    expect(() => fromPolygons({ points, polygons: [{ vertices: [0, 1, 2] }, { vertices: [0, 1, 9] }] }))
      .toThrow('fromPolygons(): polygon 1 refers to point 9 but there are only 3 points')
    expect(() => fromPolygons({ points, polygons: [{ vertices: [0, 1] }] })).toThrow('polygon 0 needs')
    expect(() => fromPolygons({ points, polygons: [{ vertices: [0, 1, 2], uvs: [0, 0] }] })).toThrow("polygon 0 'uvs' must be 6 numbers")
    expect(() => fromPolygons({ points: [{ x: 0, y: 0 }], polygons: [] })).toThrow('fromPolygons(): point 0 must be')
    expect(() => fromPolygons({ points, polygon: [] })).toThrow("unknown option 'polygon' - did you mean 'polygons'?")
  })
})
