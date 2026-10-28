// Rays - what picking is built on: hitting spheres and triangles, and how near they pass to points and
// line segments.
import { describe, expect, it } from 'vitest'
import { Ray } from '../src/value/Ray.js'
import { Mat4 } from '../src/value/Mat4.js'

const round = (v) => Math.round(v * 1e4) / 1e4
// from the origin, looking down -z
const ahead = () => new Ray([0, 0, 0], [0, 0, -1])

describe('Ray', () => {
  it('normalises its direction, and finds points along itself', () => {
    const ray = new Ray([1, 0, 0], [0, 0, -5])
    expect(ray.direction.toArray()).toEqual([0, 0, -1])
    expect(ray.at(3).toArray()).toEqual([1, 0, -3])
  })

  it('moves with a matrix, keeping a unit direction', () => {
    const ray = ahead().applyMatrix4(new Mat4().compose([2, 0, 0], [0, 0, 0, 1], [3, 3, 3]))
    expect(ray.origin.toArray()).toEqual([2, 0, 0])
    expect(ray.direction.toArray()).toEqual([0, 0, -1])
  })

  it('hits a sphere at its near side, from inside at its far side, and misses one beside or behind it', () => {
    expect(ahead().intersectSphere([0, 0, -5], 1)).toBe(4)
    // from inside, the way out
    expect(ahead().intersectSphere([0, 0, 0], 2)).toBe(2)
    // grazing its edge
    expect(round(/** @type {number} */ (ahead().intersectSphere([1, 0, -5], 1)))).toBe(5)
    expect(ahead().intersectSphere([3, 0, -5], 1)).toBeNull()
    expect(ahead().intersectSphere([0, 0, 5], 1)).toBeNull()
  })

  it('hits a triangle with where on it, from either side unless backs are culled', () => {
    // a triangle facing +z (counter-clockwise from the front), 5 ahead
    const a = [-1, -1, -5], b = [1, -1, -5], c = [0, 1, -5]
    const hit = ahead().intersectTriangle(a, b, c, false)
    expect(hit && round(hit.t)).toBe(5)
    expect(hit && [round(hit.u), round(hit.v)]).toEqual([0.25, 0.5])
    // seen from the front, so culling backs changes nothing
    expect(ahead().intersectTriangle(a, b, c, true)?.t).toBeCloseTo(5)
    // the same triangle wound the other way faces away: hit, unless backs are culled
    expect(ahead().intersectTriangle(a, c, b, false)?.t).toBeCloseTo(5)
    expect(ahead().intersectTriangle(a, c, b, true)).toBeNull()
  })

  it('misses a triangle it passes beside, runs parallel to, or has behind it', () => {
    expect(ahead().intersectTriangle([2, -1, -5], [4, -1, -5], [3, 1, -5], false)).toBeNull()
    expect(ahead().intersectTriangle([-1, 0, -1], [1, 0, -1], [0, 0, -9], false)).toBeNull()
    expect(ahead().intersectTriangle([-1, -1, 5], [1, -1, 5], [0, 1, 5], false)).toBeNull()
  })

  it('measures how near it passes a point, from its start when the point is behind it', () => {
    expect(ahead().distanceSqToPoint([3, 0, -5])).toEqual({ distanceSq: 9, t: 5 })
    expect(ahead().distanceSqToPoint([0, 4, 3])).toEqual({ distanceSq: 25, t: 0 })
  })

  it('measures how near it passes a line segment, and where along each', () => {
    // a segment across its path, 1 to the side and 5 ahead
    const across = ahead().distanceSqToSegment([-2, 1, -5], [2, 1, -5])
    expect([round(across.distanceSq), round(across.t), round(across.s)]).toEqual([1, 5, 0.5])
    // a segment that stops short of its path: nearest at the segment's end
    const short = ahead().distanceSqToSegment([2, 0, -5], [4, 0, -5])
    expect([round(short.distanceSq), round(short.s)]).toEqual([4, 0])
    // a segment running alongside it
    expect(round(ahead().distanceSqToSegment([0, 3, -1], [0, 3, -9]).distanceSq)).toBe(9)
  })

  it('measures from its start to a segment whose nearest point is behind it', () => {
    // from the origin looking down +z, the segment (1, 0, -3)-(3, 0, 1) is nearest at its middle, (2, 0, -1): 5 squared
    const ray = new Ray([0, 0, 0], [0, 0, 1])
    const behind = ray.distanceSqToSegment([1, 0, -3], [3, 0, 1])
    expect([round(behind.distanceSq), behind.t, round(behind.s)]).toEqual([5, 0, 0.5])
    // and a segment wholly behind, nearest at its end
    expect(round(ray.distanceSqToSegment([0, 2, -1], [0, 2, -5]).distanceSq)).toBe(5)
  })

  it('agrees with a brute-force search over many segments', () => {
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 8 - 4
    for (let i = 0; i < 200; i++) {
      const ray = new Ray([rand(), rand(), rand()], [rand(), rand(), rand()])
      const v0 = [rand(), rand(), rand()], v1 = [rand(), rand(), rand()]
      // the nearest of many points along the segment, each measured to the ray
      let best = Infinity
      for (let k = 0; k <= 2000; k++) {
        const p = v0.map((x, j) => x + (v1[j] - x) * k / 2000)
        best = Math.min(best, ray.distanceSqToPoint(p).distanceSq)
      }
      expect(ray.distanceSqToSegment(v0, v1).distanceSq).toBeCloseTo(best, 3)
    }
  })
})
