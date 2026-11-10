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
