// Charts of functions: fn and the ranges to sample it over in place of data - function surfaces,
// parametric surfaces and curves, vector fields - with equal units for shapes, params that tween,
// and what is said when a spec is wrong.
import { describe, expect, it } from 'vitest'
import { InstancedMesh, Lines, Mesh, Scene } from '../src/index.js'
import { chart } from '../src/charts/index.js'
import { normalise } from '../src/charts/spec.js'

const wave = (x, z) => Math.sin(x) * Math.cos(z)
const sphere = (u, v) => [Math.cos(u) * Math.sin(v), Math.cos(v), Math.sin(u) * Math.sin(v)]
const helix = (t) => [Math.cos(t), t / 4, Math.sin(t)]
/** Advance a scene's clock, as a View does each frame. */
const run = (scene, seconds) => {
  for (let t = 0; t < seconds; t += 1 / 30) scene.update(1 / 30, t)
  scene.updateWorldTree()
}
/** The extent of a mesh's or lines' positions along one axis. @param {any} node @param {number} k */
const span = (node, k) => {
  const p = node.geometry.positions
  let lo = Infinity, hi = -Infinity
  for (let i = k; i < p.length; i += 3) { lo = Math.min(lo, p[i]); hi = Math.max(hi, p[i]) }
  return hi - lo
}

describe('function surfaces', () => {
  it('samples y = fn(x, z) over the ranges into a grid of rows, the axes spanning exactly them', () => {
    const s = normalise({ mark: 'surface', fn: wave, x: [-3, 3], z: { domain: [-2, 2], title: 'depth' }, samples: [7, 5] })
    expect(s.rows).toHaveLength(35)
    expect(s.rows[0]).toEqual({ x: -3, z: -2, y: wave(-3, -2) })
    expect(s.rows[6].x).toBe(3)
    expect(s.channels.z.title).toBe('depth')
    const c = chart({ mark: 'surface', fn: wave, x: [-3, 3], z: [-2, 2] })
    expect(c.scales.x?.domain).toEqual([-3, 3])
    expect(c.scales.z?.domain).toEqual([-2, 2])
    expect(c.marks[0]).toBeInstanceOf(Mesh)
    expect(c.summary()).toBe('surface chart of a function of x and z, 48 × 48 samples')
    // a function surface's box is fitted per axis, as charts are
    expect(c.spec.options.equal).toBe(false)
    // tinted whole on hover, so gently - a bar keeps the View's usual tint
    expect(c.highlightAmount).toBe(0.15)
    expect(chart({ mark: 'bar', data: [{ a: 'x', b: 1 }], x: 'a', y: 'b' }).highlightAmount).toBeUndefined()
  })

  it('splits each cell along its shorter diagonal, so ridges across the grid stay smooth', () => {
    // one cell, corners a (-1, -1), b (1, -1), c (-1, 1), d (1, 1): x - z is level from a to d, x + z from b to c
    const along = (fn) => [...chart({ mark: 'surface', fn, x: [-1, 1], z: [-1, 1], samples: 2 }).marks[0].geometry.indices]
    expect(along((x, z) => x - z)).toEqual([0, 2, 3, 0, 3, 1])
    expect(along((x, z) => x + z)).toEqual([0, 2, 1, 1, 2, 3])
  })

  it('shades by the function: normals from its slopes, not from the triangles between samples', () => {
    const normalsOf = (fn) => /** @type {Float32Array} */ (chart({ mark: 'surface', fn, x: [-1, 1], z: [-1, 1], y: [-1, 1], samples: 5 }).marks[0].geometry.normals)
    // a level plane: every normal straight up or down (the way the triangles wind)
    const flat = normalsOf(() => 0)
    for (let i = 0; i < flat.length; i += 3) expect(Math.abs(flat[i + 1])).toBeCloseTo(1, 6)
    // a slope along x: every normal leans the same way, by the slope in world units
    const leaning = normalsOf((x) => x)
    const c = chart({ mark: 'surface', fn: (x) => x, x: [-1, 1], z: [-1, 1], y: [-1, 1], samples: 5 })
    const k = (c.scales.y(1) - c.scales.y(0)) / (c.scales.x(1) - c.scales.x(0))
    expect(Math.abs(leaning[0] / leaning[1])).toBeCloseTo(k, 4)
    expect(leaning[2]).toBeCloseTo(0, 6)
    // rows from data have no slopes: their normals come from the triangles, as before
    const data = chart({ mark: 'surface', data: [{ x: 0, z: 0, y: 0 }, { x: 1, z: 0, y: 1 }, { x: 0, z: 1, y: 0 }, { x: 1, z: 1, y: 1 }], x: 'x', z: 'z', y: 'y' })
    expect(data.marks[0].geometry.vertexCount).toBe(4)
  })

  it('hands params to fn, and tweens to new ones', () => {
    const scene = new Scene()
    // y pinned, so the surface falls as a halves - not the axis refitting to it
    const c = scene.add(chart({ mark: 'surface', fn: (x, z, { a }) => a * Math.sin(x), x: [-3, 3], z: [-1, 1], y: [-1, 1], samples: 9, params: { a: 1 }, transition: { duration: 0.4 } }))
    expect(c.scales.y?.domain).toEqual([-1, 1])
    run(scene, 0.5)
    const mesh = c.marks[0], before = span(mesh, 1)
    c.update({ params: { a: 0.5 } })
    run(scene, 0.15)
    expect(c.marks[0]).toBe(mesh)
    const between = span(mesh, 1)
    run(scene, 0.5)
    const after = span(mesh, 1)
    expect(between).toBeLessThan(before)
    expect(between).toBeGreaterThan(after)
    expect(after).toBeCloseTo(before / 2, 4)
  })

  it('says what is wrong with a spec', () => {
    expect(() => normalise({ mark: 'surface', fn: wave, x: [-3, 3] })).toThrow('needs the range of z to sample - e.g. z: [-3, 3]')
    expect(() => normalise({ mark: 'surface', fn: wave, x: [3, 3], z: [0, 1] })).toThrow("x's range is two different numbers")
    expect(() => normalise({ mark: 'surface', fn: () => NaN, x: [0, 1], z: [0, 1] })).toThrow('fn gave NaN at x 0, z 0')
    expect(() => normalise({ mark: 'surface', fn: wave, x: [0, 1], z: [0, 1], samples: 1 })).toThrow("'samples' is how many points to sample")
    expect(() => normalise({ mark: 'surface', fn: wave, x: [0, 1], z: [0, 1], samples: 1000 })).toThrow('more than 250,000 points')
    expect(() => normalise({ mark: 'surface', fn: wave, x: [0, 1], z: [0, 1], data: [] })).toThrow("has no 'data'")
    expect(() => normalise({ mark: 'surface', fn: wave, x: [0, 1], z: [0, 1], params: 2 })).toThrow("'params' is an object")
    expect(() => normalise({ mark: 'surface', fn: wave, x: [0, 1], z: [0, 1], y: 'height' })).toThrow('y on a chart of a function is its value')
    expect(() => normalise({ mark: 'bar', fn: wave, x: [0, 1] })).toThrow("'fn' is plotted as mark: 'surface', 'curve' or 'vector'")
    expect(() => normalise({ mark: 'surface', fn: 'sin(x)', x: [0, 1], z: [0, 1] })).toThrow("'fn' is a function to plot")
    expect(() => normalise({ mark: 'bar', data: [{ a: 1 }], x: 'a', y: 'a', samples: 9 })).toThrow("'samples' is for charts of a function")
  })
})

describe('parametric surfaces', () => {
  it('samples [x, y, z] = fn(u, v) in grid order, with equal units - a sphere stays round', () => {
    const c = chart({ mark: 'surface', fn: sphere, u: [0, 2 * Math.PI], v: [0, Math.PI], samples: 24 })
    expect(c.spec.options.equal).toBe(true)
    const mesh = c.marks[0]
    expect(mesh.geometry.vertexCount).toBe(24 * 24)
    // the u samples miss the extremes by a little, so within 2%
    expect(span(mesh, 0) / span(mesh, 1)).toBeCloseTo(1, 1)
    expect(span(mesh, 2) / span(mesh, 1)).toBeCloseTo(1, 1)
    expect(c.summary()).toBe('surface chart of a parametric surface, 24 × 24 samples')
    // equal: false fits it to the box, as any chart
    const fitted = chart({ mark: 'surface', fn: sphere, u: [0, 2 * Math.PI], v: [0, Math.PI], samples: 24, equal: false })
    expect(span(fitted.marks[0], 0) / span(fitted.marks[0], 1)).toBeCloseTo(10 / 4, 1)
  })

  it('tweens from one shape to another of the same grid', () => {
    const scene = new Scene()
    const torus = (u, v) => [(1 + 0.4 * Math.cos(v)) * Math.cos(u), 0.4 * Math.sin(v), (1 + 0.4 * Math.cos(v)) * Math.sin(u)]
    const c = scene.add(chart({ mark: 'surface', fn: sphere, u: [0, 2 * Math.PI], v: [0, Math.PI], samples: 16, frame: false }))
    run(scene, 0.6)
    const mesh = c.marks[0]
    c.update({ fn: torus, v: [0, 2 * Math.PI] })
    run(scene, 0.1)
    expect(c.marks[0]).toBe(mesh)
    expect(c.children.some((n) => n.name === 'axes')).toBe(false)
  })

  it('wants its x, y and z from the function - ranges, given, pin the axes', () => {
    expect(() => normalise({ mark: 'surface', fn: sphere, u: [0, 1], v: [0, 1], x: 'width' })).toThrow("a parametric surface's x comes from its function, not a field")
    // pinned to one cube, a flat shape sits in its middle as a tall one does - not on the floor
    const flat = chart({ mark: 'surface', fn: (u, v) => [Math.cos(u), 0.2 * Math.sin(v), Math.sin(u)], u: [0, 6.28], v: [0, 6.28], x: [-2, 2], y: [-2, 2], z: [-2, 2], samples: 12 })
    expect(flat.scales.y?.domain).toEqual([-2, 2])
    expect(flat.scales.y?.(0)).toBeCloseTo(5)
    expect(() => normalise({ mark: 'surface', fn: () => [1, 2], u: [0, 1], v: [0, 1] })).toThrow('it returns a point, [x, y, z] of finite numbers')
  })
})

describe('curves', () => {
  it('draws [x, y, z] = fn(t) in order of t, one segment a row, coloured from end to end', () => {
    const c = chart({ mark: 'curve', fn: helix, t: [0, 4 * Math.PI], samples: 100, size: 4 })
    const lines = c.marks[0]
    expect(lines).toBeInstanceOf(Lines)
    expect(lines.geometry.vertexCount).toBe(99 * 2)
    expect(lines.material.width).toBe(4)
    expect(lines.data).toHaveLength(99)
    expect(lines.data[0].t).toBeCloseTo(4 * Math.PI / 99)
    const colors = /** @type {Float32Array} */ (lines.geometry.colors)
    expect([...colors.slice(0, 3)]).not.toEqual([...colors.slice(-3)])
    expect(c.spec.options.equal).toBe(true)
  })

  it('draws rows in the order given, a path per detail value', () => {
    const rows = [{ x: 0, y: 0, z: 0, id: 'a' }, { x: 2, y: 1, z: 0, id: 'a' }, { x: 1, y: 2, z: 1, id: 'a' }, { x: 0, y: 0, z: 2, id: 'b' }, { x: 1, y: 0, z: 2, id: 'b' }]
    const c = chart({ mark: 'curve', data: rows, x: 'x', y: 'y', z: 'z', detail: 'id' })
    // 2 segments for a, 1 for b
    expect(c.marks[0].geometry.vertexCount).toBe(6)
  })
})

describe('vector fields', () => {
  it('puts an arrow at each sample, coloured by magnitude, the longest nearly a gap long', () => {
    const c = chart({ mark: 'vector', fn: (x, y, z) => [-z, 0, x], x: [-2, 2], z: [-2, 2], samples: 5 })
    const arrows = /** @type {InstancedMesh} */ (c.marks[0])
    expect(arrows).toBeInstanceOf(InstancedMesh)
    expect(arrows.count).toBe(25)
    expect(c.spec.channels.color.field).toBe('magnitude')
    expect(arrows.data[0]).toMatchObject({ x: -2, y: 0, z: -2, vx: 2, vy: 0, vz: -2 })
    expect(arrows.data[12].magnitude).toBe(0)
    expect(c.summary()).toBe('vector chart of a vector field, 5 × 1 × 5 arrows')
    // a field in a plane has no y axis to mark (axis: false on a number axis used to throw)
    expect(c.spec.channels.y.axis).toBe(false)
  })

  it('fills a volume when y has a range, and says when there are too many arrows', () => {
    const c = chart({ mark: 'vector', fn: (x, y, z) => [x, y, z], x: [-1, 1], y: [-1, 1], z: [-1, 1], samples: [3, 4, 5] })
    expect(c.marks[0].count).toBe(60)
    // one sample in y: a layer at the start of its range - the floor under a surface over the same range
    const floor = chart({ mark: 'vector', fn: () => [1, 0, 0], x: [-1, 1], y: [-1, 1], z: [-1, 1], samples: [3, 1, 3], equal: false })
    expect(floor.marks[0].data.every((r) => r.y === -1)).toBe(true)
    expect(floor.scales.y?.domain).toEqual([-1, 1])
    expect(() => normalise({ mark: 'vector', fn: () => [0, 1, 0], x: [0, 1], y: [0, 1], z: [0, 1], samples: 40 })).toThrow('too many to read')
    expect(() => normalise({ mark: 'vector', data: [{ x: 0, y: 0, z: 0 }], x: 'x', y: 'y', z: 'z' })).toThrow('a vector field is drawn from a function')
    expect(() => normalise({ mark: 'vector', fn: () => 1, x: [0, 1], z: [0, 1] })).toThrow('it returns a direction')
  })
})

describe('time', () => {
  it('hands fn the time as t, and redraws only the mark each frame', () => {
    const scene = new Scene()
    const c = scene.add(chart({ mark: 'surface', fn: (x, z, { t }) => Math.sin(x - t), x: [-3, 3], z: [-1, 1], y: [-1, 1], samples: 9, time: true }))
    const mesh = c.marks[0], axes = c.children.find((n) => n.name === 'axes')
    const before = [...mesh.geometry.positions]
    run(scene, 0.5)
    expect(c.marks[0]).toBe(mesh)
    expect(c.children.find((n) => n.name === 'axes')).toBe(axes)
    expect([...mesh.geometry.positions]).not.toEqual(before)
    // its own params still reach fn beside t
    const k = scene.add(chart({ mark: 'curve', fn: (t, { a, t: time }) => [Math.cos(t + time), a, Math.sin(t)], t: [0, 1], samples: 4, params: { a: 2 }, time: true }))
    run(scene, 0.2)
    expect(k.marks[0].data.every((r) => r.y === 2)).toBe(true)
  })

  it('is for charts of a function', () => {
    expect(() => normalise({ mark: 'bar', data: [{ a: 1 }], x: 'a', y: 'a', time: true })).toThrow("'time' animates a chart of a function")
  })
})

describe('contours', () => {
  const bowl = (x, z) => x * x + z * z
  it('draws lines of equal height across a surface, or under it, or both', () => {
    const on = chart({ mark: 'surface', fn: bowl, x: [-1, 1], z: [-1, 1], samples: 21, contours: { values: [0.5] } })
    const lines = on.marks[1]
    expect(lines).toBeInstanceOf(Lines)
    // a ring at height 0.5: every point on it at that height, about 0.71 out from the middle
    const p = lines.geometry.positions, y = on.scales.y, x = on.scales.x, z = on.scales.z
    for (let i = 0; i < p.length; i += 3) {
      expect(p[i + 1]).toBeCloseTo(y(0.5), 4)
      expect(Math.hypot(x.invert(p[i]), z.invert(p[i + 2]))).toBeCloseTo(Math.SQRT1_2, 1)
    }
    const both = chart({ mark: 'surface', fn: bowl, x: [-1, 1], z: [-1, 1], samples: 21, contours: { values: [0.5], place: 'both' } })
    expect(both.marks[1].geometry.vertexCount).toBe(lines.geometry.vertexCount * 2)
    const floor = chart({ mark: 'surface', fn: bowl, x: [-1, 1], z: [-1, 1], samples: 21, contours: { values: [0.5], place: 'floor' } })
    const fp = floor.marks[1].geometry.positions
    for (let i = 1; i < fp.length; i += 3) expect(fp[i]).toBe(0)
  })

  it('takes a count of the y axis ticks, and says what is wrong', () => {
    const c = chart({ mark: 'surface', fn: bowl, x: [-1, 1], z: [-1, 1], samples: 11, contours: true })
    expect(c.spec.options.contours).toMatchObject({ count: 10, place: 'surface' })
    expect(c.marks[1].geometry.vertexCount).toBeGreaterThan(0)
    expect(() => normalise({ mark: 'curve', fn: (t) => [t, t, t], t: [0, 1], contours: true })).toThrow("'contours' are lines of equal height on a surface")
    expect(() => normalise({ mark: 'surface', fn: bowl, x: [0, 1], z: [0, 1], contours: { at: 2 } })).toThrow("contours has no 'at'")
    expect(() => normalise({ mark: 'surface', fn: bowl, x: [0, 1], z: [0, 1], contours: { place: 'under' } })).toThrow("contours' place is 'surface', 'floor' or 'both'")
  })
})

describe("frame: 'origin'", () => {
  it('draws axes through zero with arrowheads and their names, ticks unlabelled where they meet', () => {
    const c = chart({ mark: 'surface', fn: (x, z) => x * z, x: [-2, 2], z: [-2, 2], y: [-4, 4], samples: 5, frame: 'origin' })
    const frame = c.children.find((n) => n.name === 'axes')
    const arrows = frame.children.filter((n) => n instanceof Lines && n.arrows === 'end')
    expect(arrows).toHaveLength(3)
    const texts = frame.children.filter((n) => n.text !== undefined).map((n) => n.text)
    expect(texts).toEqual(expect.arrayContaining(['x', 'y', 'z', '2', '-2']))
    expect(texts).not.toContain('0')
    // the x axis runs through y = 0 and z = 0
    const xAxis = arrows[0].geometry.positions
    expect(xAxis[1]).toBeCloseTo(c.scales.y(0))
    expect(xAxis[2]).toBeCloseTo(c.scales.z(0))
  })

  it('crosses at the start of an axis that does not reach zero, and leaves out a hidden one', () => {
    const c = chart({ mark: 'surface', fn: (x, z) => x + z, x: [1, 3], z: [-1, 1], y: { domain: [0, 4], axis: false }, samples: 5, frame: 'origin' })
    const arrows = c.children.find((n) => n.name === 'axes').children.filter((n) => n instanceof Lines && n.arrows === 'end')
    expect(arrows).toHaveLength(2)
    // the z axis sits at x = 1, the start of x's range
    expect(arrows[1].geometry.positions[0]).toBeCloseTo(c.scales.x(1))
  })
})
