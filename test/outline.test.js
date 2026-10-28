// The flat outlines for extrude() and lathe(): lists of [x, y] points, anticlockwise, to spread
// together or cut as holes.
import { describe, expect, it } from 'vitest'
import { extrude, lathe, outline } from '../src/index.js'
import { area } from '../src/geometry/triangulate.js'

const r4 = (p) => p.map(([x, y]) => [Math.round(x * 1e4) / 1e4 || 0, Math.round(y * 1e4) / 1e4 || 0])
const radii = (p, [cx, cy] = [0, 0]) => p.map(([x, y]) => Math.round(Math.hypot(x - cx, y - cy) * 1e6) / 1e6)

describe('outline', () => {
  it('circle: points round it, anticlockwise, about its centre', () => {
    const c = outline.circle({ radius: 2, segments: 4, center: [1, 1] })
    expect(r4(c)).toEqual([[3, 1], [1, 3], [-1, 1], [1, -1]])
    expect(outline.circle(0.5)).toHaveLength(32)
    expect(new Set(radii(outline.circle(0.5)))).toEqual(new Set([0.5]))
    expect(area(c)).toBeGreaterThan(0)
  })

  it('rect: square corners, or rounded ones with points round each', () => {
    expect(r4(outline.rect({ width: 4, height: 2 }))).toEqual([[-2, -1], [2, -1], [2, 1], [-2, 1]])
    expect(r4(outline.rect(2))).toEqual([[-1, -1], [1, -1], [1, 1], [-1, 1]])
    const rounded = outline.rect({ width: 4, height: 2, radius: 0.5, segments: 4, center: [1, 0] })
    expect(rounded).toHaveLength(4 * 5)
    expect(area(rounded)).toBeGreaterThan(0)
    // its extent is still the rectangle's
    expect(Math.max(...rounded.map(([x]) => x))).toBeCloseTo(3)
    expect(Math.min(...rounded.map(([, y]) => y))).toBeCloseTo(-1)
  })

  it('polygon: a regular one, turned by angle', () => {
    const hex = outline.polygon({ radius: 1 })
    expect(hex).toHaveLength(6)
    expect(r4([hex[0]])).toEqual([[1, 0]])
    const square = outline.polygon({ radius: Math.SQRT2, sides: 4, angle: Math.PI / 4 })
    expect(r4(square)).toEqual([[1, 1], [-1, 1], [-1, -1], [1, -1]])
  })

  it('arc: both ends included, anticlockwise, or clockwise when to is below from', () => {
    const up = outline.arc({ radius: 1, from: 0, to: Math.PI, segments: 2 })
    expect(r4(up)).toEqual([[1, 0], [0, 1], [-1, 0]])
    const down = outline.arc({ radius: 1, from: Math.PI, to: 0, segments: 2 })
    expect(r4(down)).toEqual([[-1, 0], [0, 1], [1, 0]])
    // enough points for its sweep: a quarter turn of a 32-a-turn circle
    expect(outline.arc({ from: 0, to: Math.PI / 2 })).toHaveLength(9)
  })

  it('gear: teeth standing out from the root circle', () => {
    const g = outline.gear({ radius: 1, teeth: 10, depth: 0.1 })
    expect(g).toHaveLength(40)
    expect(new Set(radii(g))).toEqual(new Set([0.9, 1]))
    expect(area(g)).toBeGreaterThan(0)
  })

  it('makes shapes extrude() and lathe() take, spread together and as holes', () => {
    // a connecting rod: two eyes joined by their sides, each with its bore
    const rod = extrude({
      shape: [...outline.arc({ radius: 0.15, from: -0.4, to: Math.PI + 0.4, center: [0, 1.4] }), ...outline.arc({ radius: 0.3, from: Math.PI - 0.4, to: 2 * Math.PI + 0.4 })],
      holes: [outline.circle(0.2), outline.circle({ radius: 0.09, center: [0, 1.4] })],
      depth: 0.16,
    })
    expect(rod.vertexCount).toBeGreaterThan(0)
    // a washer: the plate less its hole
    const washer = extrude({ shape: outline.circle({ radius: 1, segments: 64 }), holes: [outline.circle({ radius: 0.5, segments: 64 })], depth: 1 })
    expect(washer.bounds.getSize().toArray()).toEqual([2, 2, 1])
    // a ball, from a half circle - its ends close on the axis
    const ball = lathe({ points: outline.arc({ from: -Math.PI / 2, to: Math.PI / 2, segments: 16 }), segments: 16 })
    expect(ball.indices.length / 3).toBe(16 * 16 * 2 - 2 * 16)
  })

  it('says what is wrong', () => {
    expect(() => outline.circle({ radius: 0 })).toThrow("outline.circle(): 'radius' must be more than 0, got 0")
    expect(() => outline.circle({ r: 1 })).toThrow("use 'radius'")
    expect(() => outline.circle({ center: 'middle' })).toThrow("'center' must be [x, y], got 'middle'")
    expect(() => outline.rect({ width: 2, height: 1, radius: 0.6 })).toThrow("'radius' must be from 0 to half the shorter side (0.5), got 0.6")
    expect(() => outline.polygon({ sides: 2 })).toThrow("'sides' must be a whole number 3 or more, got 2")
    expect(() => outline.arc({ from: 1, to: 1 })).toThrow("'from' and 'to' are the same angle")
    expect(() => outline.arc({ startAngle: 0 })).toThrow("use 'from' (radians)")
    expect(() => outline.gear({ radius: 1, depth: 1 })).toThrow("'depth' must be less than the radius (1), got 1")
  })
})
