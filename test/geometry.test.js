import { describe, expect, it } from 'vitest'
import {
  generateCuboid, generateCylinder, generateIcosahedron, generatePyramid, generateSphere,
  generateTesselatedPlane, generateUnitCube, subdivide,
} from '../src/geometry.js'

// every edge and polygon index must reference an existing point
function expectValid({ points, edges = [], polygons }) {
  for (const { a, b } of edges) {
    expect(points[a]).toBeDefined()
    expect(points[b]).toBeDefined()
  }
  for (const { vertices, uvs } of polygons) {
    expect(vertices.length).toBeGreaterThanOrEqual(3)
    for (const v of vertices) expect(points[v]).toBeDefined()
    if (uvs) expect(uvs.length).toBe(vertices.length * 2)
  }
}

describe('geometry generators', () => {
  it('unit cube', () => {
    const g = generateUnitCube(2)
    expect(g.points).toHaveLength(8)
    expect(g.edges).toHaveLength(12)
    expect(g.polygons).toHaveLength(6)
    expect(Math.max(...g.points.map((p) => p.x))).toBe(2)
    expectValid(g)
  })

  it('cube calls return independent geometry', () => {
    const a = generateUnitCube(), b = generateUnitCube()
    a.edges[0].a = 99
    expect(b.edges[0].a).toBe(0)
  })

  it('tesselated plane with UVs', () => {
    const g = generateTesselatedPlane(4, 8, 0, 10, true)
    expect(g.points).toHaveLength(5 * 9)
    expect(g.polygons).toHaveLength(4 * 8)
    expect(g.points[0]).toEqual({ x: -5, y: 0, z: 5 })
    for (const { uvs } of g.polygons) for (const t of uvs) expect(t).toBeGreaterThanOrEqual(0)
    expectValid(g)
  })

  it('sphere with UVs', () => {
    const g = generateSphere(3, 8, 12, true)
    expect(g.points).toHaveLength(9 * 13)
    expect(g.polygons).toHaveLength(8 * 12)
    for (const p of g.points) expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(3)
    expectValid(g)
  })

  it('pyramid, icosahedron, cuboid, cylinder', () => {
    expectValid(generatePyramid())
    const ico = generateIcosahedron()
    expect(ico.polygons).toHaveLength(20)
    expectValid(ico)
    expectValid(generateCuboid({ scalex: 2 }))
    const cyl = generateCylinder(1, 2, 8)
    expect(cyl.polygons).toHaveLength(8 + 2)
    expectValid(cyl)
  })

  it('subdivide splits each triangle into 4 on the unit sphere', () => {
    const ico = generateIcosahedron()
    const g = subdivide(ico.points, ico.polygons)
    expect(g.polygons).toHaveLength(80)
    for (const p of g.points) expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(1)
    expectValid(g)
  })
})
