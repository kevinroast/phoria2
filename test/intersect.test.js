import { describe, expect, it } from 'vitest'
import { vec3, vec4 } from '../src/math.js'
import {
  calculatePlanarFromPolar, calculatePolarFromPlanar, intersectionInsidePolygon, planeLineIntersection,
} from '../src/intersect.js'

describe('planeLineIntersection', () => {
  it('finds where a line meets a plane', () => {
    const p = planeLineIntersection(vec3.fromValues(0, 0, 1), vec3.fromValues(0, 0, 5),
      vec3.fromValues(0, 0, 1), vec3.fromValues(1, 2, 0))
    expect([...p]).toEqual([1, 2, 5])
  })

  it('returns null when parallel', () => {
    expect(planeLineIntersection(vec3.fromValues(0, 0, 1), vec3.fromValues(0, 0, 5),
      vec3.fromValues(1, 0, 0), vec3.fromValues(0, 0, 0))).toBeNull()
  })
})

describe('intersectionInsidePolygon', () => {
  // unit square in each axis aligned plane exercises all three 2D projections
  const cases = {
    xy: { normal: [0, 0, 1], pts: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], inside: [0.3, 0.6, 0], outside: [1.5, 0.5, 0] },
    zx: { normal: [0, 1, 0], pts: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], inside: [0.6, 0, 0.3], outside: [0.5, 0, 1.5] },
    yz: { normal: [1, 0, 0], pts: [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]], inside: [0, 0.3, 0.6], outside: [0, -0.5, 0.5] },
  }
  for (const [plane, { normal, pts, inside, outside }] of Object.entries(cases)) {
    it(`tests points against a polygon in the ${plane} plane`, () => {
      const points = pts.map(([x, y, z]) => vec4.fromValues(x, y, z, 1))
      const polygon = { vertices: [0, 1, 2, 3], _worldnormal: vec4.fromValues(...normal, 0) }
      expect(intersectionInsidePolygon(polygon, points, inside)).toBe(true)
      expect(intersectionInsidePolygon(polygon, points, outside)).toBe(false)
    })
  }
})

describe('polar conversion', () => {
  it('round trips', () => {
    const planar = vec3.fromValues(1, 2, 3)
    expect([...calculatePlanarFromPolar(calculatePolarFromPlanar(planar))]).toEqual([1, 2, 3])
    const negative = vec3.fromValues(-2, 1, -1)
    expect([...calculatePlanarFromPolar(calculatePolarFromPlanar(negative))]).toEqual([-2, 1, -1])
  })
})
