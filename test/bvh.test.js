// The raycaster walks a tree over big meshes' triangles: it must find exactly what testing every
// triangle finds, and notice when the geometry changes.
import { describe, expect, it } from 'vitest'
import { Mesh, Ray, Raycaster, Vec3, icosphere, torus } from '../src/index.js'
import { BVH_MIN_TRIANGLES, bvhOf } from '../src/geometry/bvh.js'

/** Every triangle, the slow way: the nearest hit's distance and face. @param {Mesh} mesh @param {Ray} ray */
function bruteForce(mesh, ray) {
  const g = mesh.geometry, p = g.positions, idx = g.indices
  let best = Infinity, face = -1
  const v = (i) => new Vec3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2])
  for (let f = 0; f < g.drawnCount / 3; f++) {
    const hit = ray.intersectTriangle(v(idx ? idx[f * 3] : f * 3), v(idx ? idx[f * 3 + 1] : f * 3 + 1), v(idx ? idx[f * 3 + 2] : f * 3 + 2), true)
    if (hit && hit.t < best) { best = hit.t; face = f }
  }
  return face < 0 ? null : { distance: best, face }
}

/** A seeded random number, so a failure can be reproduced. */
function random(seed) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
}

describe('BVH', () => {
  it('finds the same nearest triangle as testing them all, hit or miss', () => {
    const shapes = [new Mesh({ geometry: icosphere({ radius: 1, detail: 4 }) }), new Mesh({ geometry: torus({ radius: 1, tube: 0.3, segments: 96, tubeSegments: 32 }) })]
    const rand = random(7)
    for (const mesh of shapes) {
      expect(mesh.geometry.drawnCount / 3).toBeGreaterThan(BVH_MIN_TRIANGLES)
      mesh.updateWorld()
      let hits = 0
      for (let i = 0; i < 300; i++) {
        // from a point round the shape towards a point near its middle - some miss, a torus's hole especially
        const from = new Vec3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize().multiplyScalar(4)
        const to = new Vec3((rand() - 0.5) * 2.4, (rand() - 0.5) * 2.4, (rand() - 0.5) * 2.4)
        const ray = new Ray(from, to.clone().sub(from).normalize())
        const expected = bruteForce(mesh, ray)
        const raycaster = new Raycaster()
        raycaster.ray = ray
        const got = raycaster.intersect(mesh)[0] ?? null
        if (!expected) expect(got).toBeNull()
        else {
          hits++
          expect(got?.face).toBe(expected.face)
          expect(got?.distance).toBeCloseTo(expected.distance, 5)
        }
      }
      // a fair test: plenty of both
      expect(hits).toBeGreaterThan(60)
      expect(hits).toBeLessThan(290)
    }
  })

  it('is built once, and again after the geometry changes', () => {
    const geometry = icosphere({ radius: 1, detail: 3 })
    const count = geometry.drawnCount / 3
    const first = bvhOf(geometry, count)
    expect(bvhOf(geometry, count)).toBe(first)
    // moved: the old tree would miss it
    for (let i = 0; i < geometry.positions.length; i += 3) geometry.positions[i] += 10
    geometry.needsUpdate()
    expect(bvhOf(geometry, count)).not.toBe(first)
    const mesh = new Mesh({ geometry })
    mesh.updateWorld()
    const raycaster = new Raycaster()
    raycaster.ray = new Ray([10, 0, 5], [0, 0, -1])
    expect(raycaster.intersect(mesh)[0]?.point[0]).toBeCloseTo(10, 3)
  })

  it('still leaves out what a clip plane cuts away', () => {
    const mesh = new Mesh({ geometry: icosphere({ radius: 1, detail: 4 }), clip: { normal: [0, 0, 1], offset: 0 } })
    mesh.updateWorld()
    const raycaster = new Raycaster()
    // straight at the front, which is cut away: the ray carries on to the back half's inside, culled - nothing
    raycaster.ray = new Ray([0, 0, 5], [0, 0, -1])
    expect(raycaster.intersect(mesh)).toEqual([])
    // from behind, the back half is there
    raycaster.ray = new Ray([0, 0, -5], [0, 0, 1])
    expect(raycaster.intersect(mesh)[0]?.point[2]).toBeCloseTo(-1, 1)
  })
})
