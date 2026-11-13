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
    expect(() => normalise({ mark: 'point', fn: wave, x: [0, 1] })).toThrow("'fn' is plotted as mark: 'surface', 'curve', 'vector', 'line', 'area' or 'bar'")
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

describe('curved coordinates', () => {
  /** A row's distance from the origin. */
  const reach = (row) => Math.hypot(row.x, row.y, row.z)
  /** The guides in a chart's frame, if any. */
  const guides = (c) => c.children.find((n) => n.name === 'axes')?.children.find((n) => n.name === 'guides')

  it('spherical: r = fn(theta, phi), all the way round by default, on axes through the origin with rings', () => {
    const c = chart({ mark: 'surface', coords: 'spherical', fn: () => 2, samples: 9 })
    const rows = c.marks[0].data
    expect(rows).toHaveLength(81)
    for (const row of rows) expect(reach(row)).toBeCloseTo(2, 6)
    // theta from +x towards +z, phi down from +y
    expect(rows[0]).toMatchObject({ theta: 0, phi: 0, r: 2 })
    expect(rows.at(-1).theta).toBeCloseTo(2 * Math.PI)
    expect(rows.at(-1).phi).toBeCloseTo(Math.PI)
    const quarter = rows.find((r) => Math.abs(r.theta - Math.PI / 2) < 1e-9 && Math.abs(r.phi - Math.PI / 2) < 1e-9)
    expect(quarter.z).toBeCloseTo(2)
    expect(c.spec.options.equal).toBe(true)
    expect(c.spec.options.frame).toBe('origin')
    expect(guides(c)).toBeDefined()
    expect(c.summary()).toBe('surface chart of r = fn(theta, phi), in spherical coordinates, 9 × 9 samples')
    // coloured by the radius
    expect(c.spec.channels.color.field).toBe('r')
    // walls when asked for, with no rings; none at all with frame: false
    expect(guides(chart({ mark: 'surface', coords: 'spherical', fn: () => 1, samples: 5, frame: true }))).toBeUndefined()
    expect(chart({ mark: 'surface', coords: 'spherical', fn: () => 1, samples: 5, frame: false }).children.some((n) => n.name === 'axes')).toBe(false)
  })

  it('shades a sphere smoothly to its poles: normals along the radius everywhere, the same way, none lost', () => {
    const c = chart({ mark: 'surface', coords: 'spherical', fn: () => 1, samples: 12 })
    const n = /** @type {Float32Array} */ (c.marks[0].geometry.normals), p = c.marks[0].geometry.positions
    const centre = [c.scales.x(0), c.scales.y(0), c.scales.z(0)]
    let sign = 0
    for (let i = 0; i < n.length; i += 3) {
      expect(Math.hypot(n[i], n[i + 1], n[i + 2])).toBeCloseTo(1, 5)
      const d = [p[i] - centre[0], p[i + 1] - centre[1], p[i + 2] - centre[2]], l = Math.hypot(d[0], d[1], d[2])
      const along = (n[i] * d[0] + n[i + 1] * d[1] + n[i + 2] * d[2]) / l
      expect(Math.abs(along)).toBeCloseTo(1, 3)
      sign ||= Math.sign(along)
      expect(Math.sign(along)).toBe(sign)
    }
    // a parametric sphere gets its normals from fn too, poles and all
    const u = chart({ mark: 'surface', fn: sphere, u: [0, 2 * Math.PI], v: [0, Math.PI], samples: 12 }).marks[0].geometry.normals
    for (let i = 0; i < u.length; i++) expect(Number.isFinite(u[i])).toBe(true)
    expect(Math.abs(u[1])).toBeCloseTo(1, 3)
  })

  it('draws a negative radius through the origin, and keeps the fields fn gives beside it, to colour by', () => {
    const c = chart({ mark: 'surface', coords: 'spherical', fn: (theta, phi) => ({ r: Math.cos(phi), sign: Math.cos(phi) < 0 ? 'minus' : 'plus' }), samples: 9, color: 'sign' })
    const below = c.marks[0].data.find((r) => r.phi > Math.PI * 0.7)
    // phi past the equator and r below zero: the point is above, through the origin
    expect(below.r).toBeLessThan(0)
    expect(below.y).toBeGreaterThan(0)
    expect(below.sign).toBe('minus')
    expect(c.spec.channels.color.field).toBe('sign')
  })

  it('cylindrical: r = fn(theta, y) over the range of y; polar: y = fn(r, theta) over the range of r', () => {
    const cyl = chart({ mark: 'surface', coords: 'cylindrical', fn: (theta, y) => 1 + y, y: [0, 1], samples: 5 })
    for (const row of cyl.marks[0].data) expect(Math.hypot(row.x, row.z)).toBeCloseTo(1 + row.y, 6)
    expect(cyl.scales.y?.domain).toEqual([0, 1])
    const disk = chart({ mark: 'surface', coords: 'polar', fn: (r) => r * r, r: [0, 2], samples: 5 })
    for (const row of disk.marks[0].data) {
      expect(Math.hypot(row.x, row.z)).toBeCloseTo(row.r, 6)
      expect(row.y).toBeCloseTo(row.r * row.r, 6)
    }
    // a height over the floor, coloured by it as any surface
    expect(disk.spec.channels.color).toBeUndefined()
  })

  it('polar curves: r = fn(theta), upright in the x-y plane, with no z axis', () => {
    const c = chart({ mark: 'curve', coords: 'polar', fn: (theta) => Math.cos(3 * theta), samples: 100 })
    const rows = c.marks[0].data
    expect(rows.at(-1).theta).toBeCloseTo(2 * Math.PI)
    for (const row of rows) {
      expect(row.z).toBe(0)
      expect(row.x).toBeCloseTo(row.r * Math.cos(row.theta), 9)
      expect(row.y).toBeCloseTo(row.r * Math.sin(row.theta), 9)
    }
    expect(c.spec.channels.z.axis).toBe(false)
    expect(c.spec.options.frame).toBe('origin')
    expect(guides(c)).toBeDefined()
  })

  it('tweens to new params, and moves with time', () => {
    const scene = new Scene()
    const c = scene.add(chart({ mark: 'surface', coords: 'spherical', fn: (theta, phi, { a }) => a, params: { a: 1 }, samples: 7, x: [-2, 2], y: [-2, 2], z: [-2, 2], transition: { duration: 0.2 } }))
    run(scene, 0.3)
    const before = span(c.marks[0], 1)
    c.update({ params: { a: 2 } })
    run(scene, 0.4)
    expect(span(c.marks[0], 1)).toBeCloseTo(before * 2, 3)
    const timed = scene.add(chart({ mark: 'curve', coords: 'polar', fn: (theta, { t }) => 1 + t, time: true, samples: 8, x: [-5, 5], y: [-5, 5] }))
    const first = span(timed.marks[0], 0)
    run(scene, 1)
    expect(span(timed.marks[0], 0)).toBeGreaterThan(first)
  })

  it('says what is wrong with a spec', () => {
    const fn = () => 1
    expect(() => normalise({ mark: 'surface', coords: 'round', fn })).toThrow("'coords' is 'cartesian' (the default), 'polar', 'cylindrical' or 'spherical'")
    expect(() => normalise({ mark: 'surface', fn, x: [0, 1], z: [0, 1], theta: [0, 1] })).toThrow("'theta' is for curved coordinates - add coords")
    expect(() => normalise({ mark: 'curve', coords: 'spherical', fn })).toThrow("a curve takes coords: 'polar'")
    expect(() => normalise({ mark: 'surface', coords: 'spherical', fn, u: [0, 1] })).toThrow("in coords: 'spherical' fn is sampled over theta and phi, not u")
    expect(() => normalise({ mark: 'surface', coords: 'cylindrical', fn, phi: [0, 1], y: [0, 1] })).toThrow('sampled over theta and y - leave out phi')
    expect(() => normalise({ mark: 'surface', coords: 'cylindrical', fn })).toThrow('needs the range of y to sample')
    expect(() => normalise({ mark: 'surface', coords: 'polar', fn })).toThrow("coords: 'polar' needs the range of r to sample")
    expect(() => normalise({ mark: 'vector', coords: 'polar', fn, x: [0, 1], z: [0, 1] })).toThrow("'coords' is for a surface or a curve")
    expect(() => normalise({ mark: 'surface', coords: 'spherical', fn: () => NaN })).toThrow("fn gave NaN at theta 0, phi 0 - in coords: 'spherical' it returns r")
    expect(() => normalise({ mark: 'surface', coords: 'spherical', fn: () => ({ r: 1, x: 2 }) })).toThrow("fn's x is the row's own")
    expect(() => normalise({ mark: 'curve', coords: 'polar', fn: () => [1, 2] })).toThrow("a polar curve's fn returns its radius")
    expect(() => normalise({ mark: 'surface', coords: 'spherical', fn, x: 'width' })).toThrow('comes from its function, not a field')
  })
})

describe('data by angle', () => {
  /** A pattern measured every 30° round and down: gain in dB, highest straight ahead (+x). */
  const pattern = () => {
    const rows = []
    for (let azimuth = 0; azimuth < 360; azimuth += 30) {
      for (let polar = 0; polar <= 180; polar += 30) {
        const ahead = Math.sin(polar * Math.PI / 180) * Math.cos(azimuth * Math.PI / 180)
        rows.push({ azimuth, polar, gain: -20 + 25 * (1 + ahead) / 2 })
      }
    }
    return rows
  }
  const guides = (c) => c.children.find((n) => n.name === 'axes')?.children.find((n) => n.name === 'guides')

  it('places rows measured in degrees on a sphere, from a dB floor, and closes the turn', () => {
    const data = pattern()
    const c = chart({ mark: 'surface', coords: 'spherical', angles: 'degrees', data, theta: 'azimuth', phi: 'polar', r: { field: 'gain', scale: { domain: [-20, 10] } } })
    const rows = c.marks[0].data
    // 12 azimuths - 0 to 330 - and the first again, to close it; 7 polar angles
    expect(rows).toHaveLength(13 * 7)
    expect(rows[12].azimuth).toBe(0)
    // a row keeps its own fields, and gains where it's drawn: straight ahead, 5 dB is 25 out from -20
    const ahead = rows.find((r) => r.azimuth === 0 && r.polar === 90)
    expect(ahead.gain).toBe(5)
    expect(ahead.x).toBeCloseTo(25, 6)
    expect(ahead.y).toBeCloseTo(0, 6)
    // theta towards +z
    const quarter = rows.find((r) => r.azimuth === 90 && r.polar === 90)
    expect(quarter.z).toBeGreaterThan(0)
    // coloured by r's field, read off labelled rings with no axes in the way; the tooltip says the fields
    expect(c.spec.channels.color.field).toBe('gain')
    expect(['x', 'y', 'z'].map((n) => c.spec.channels[n].axis)).toEqual([false, false, false])
    const texts = guides(c).children.filter((n) => n.text !== undefined).map((n) => n.text)
    expect(texts).toContain('0')
    expect(texts).toContain('10')
    expect(texts).toContain('90°')
    expect(c.spec.options.frame).toBe('origin')
    expect(c.summary()).toBe('surface chart of gain by azimuth and polar, in spherical coordinates, 13 × 7 rows')
    // the data as given
    expect(c.data).toBe(data)
  })

  it('clamps values beyond r\'s domain to its ends, and tweens to new data on the same grid', () => {
    const scene = new Scene()
    const spec = { mark: 'surface', coords: 'spherical', angles: 'degrees', theta: 'azimuth', phi: 'polar', r: { field: 'gain', scale: { domain: [-10, 0] } }, transition: { duration: 0.2 } }
    const c = scene.add(chart({ ...spec, data: pattern() }))
    for (const row of c.marks[0].data) expect(Math.hypot(row.x, row.y, row.z)).toBeLessThanOrEqual(10 + 1e-9)
    // nothing below the floor: those rows sit at the centre
    expect(c.marks[0].data.filter((r) => r.gain <= -10).every((r) => Math.hypot(r.x, r.y, r.z) < 1e-9)).toBe(true)
    run(scene, 0.3)
    const mesh = c.marks[0]
    c.update({ data: pattern().map((r) => ({ ...r, gain: r.gain + 5 })) })
    run(scene, 0.3)
    expect(c.marks[0]).toBe(mesh)
  })

  it('draws polar data as a path per series, in order of theta and closed, on labelled rings', () => {
    const rows = ['front', 'back'].flatMap((side, s) => Array.from({ length: 12 }, (_, i) => ({ side, angle: (11 - i) * 30, level: -s * 10 })))
    const spec = { mark: 'curve', coords: 'polar', angles: 'degrees', data: rows, theta: 'angle', r: { field: 'level', scale: { domain: [-30, 0] } }, color: 'side' }
    const c = chart(spec), drawn = normalise(spec).rows
    // 12 a series and the first again
    expect(drawn).toHaveLength(26)
    expect(drawn.slice(0, 13).map((r) => r.angle)).toEqual([0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 0])
    expect(drawn[0]).toMatchObject({ side: 'front', x: 30, y: 0, z: 0 })
    expect(drawn[13].x).toBeCloseTo(20, 6)
    expect(c.spec.channels.detail.field).toBe('side')
    expect(['x', 'y'].map((n) => c.spec.channels[n].axis)).toEqual([false, false])
    expect(guides(c).children.some((n) => n.text === '-10')).toBe(true)
  })

  it('places a cylinder of data over a height field, and a polar surface over r', () => {
    const rows = []
    for (let theta = 0; theta < 360; theta += 90) for (const height of [0, 1, 2]) rows.push({ theta, height, r: 1 + height })
    const cyl = chart({ mark: 'surface', coords: 'cylindrical', angles: 'degrees', data: rows, theta: 'theta', y: 'height', r: 'r' })
    for (const row of cyl.marks[0].data) {
      expect(Math.hypot(row.x, row.z)).toBeCloseTo(1 + row.height, 6)
      expect(row.y).toBe(row.height)
    }
    expect(cyl.spec.channels.y.title).toBe('height')
    // its height axis stays; the rings say the rest
    expect(cyl.spec.channels.y.axis).not.toBe(false)
    expect(cyl.spec.channels.x.axis).toBe(false)
    const disc = []
    for (const radius of [0, 1, 2]) for (let angle = 0; angle < 360; angle += 120) disc.push({ radius, angle, depth: -radius })
    const polar = chart({ mark: 'surface', coords: 'polar', angles: 'degrees', data: disc, r: 'radius', theta: 'angle', y: 'depth' })
    expect(polar.marks[0].data).toHaveLength(3 * 4)
    for (const row of polar.marks[0].data) expect(Math.hypot(row.x, row.z)).toBeCloseTo(row.radius, 6)
  })

  it('takes degrees for fn too: its ranges, what it is handed, and its rows', () => {
    const seen = []
    const c = chart({ mark: 'curve', coords: 'polar', angles: 'degrees', fn: (theta) => { seen.push(theta); return 1 }, samples: 5 })
    expect(seen.at(-1)).toBe(360)
    const quarter = c.marks[0].data.find((r) => r.theta === 90)
    expect(quarter.y).toBeCloseTo(1, 9)
    expect(chart({ mark: 'surface', coords: 'spherical', angles: 'degrees', fn: () => 1, samples: 5 }).marks[0].data.at(-1).phi).toBe(180)
  })

  it('says what is wrong with a spec', () => {
    const data = pattern(), base = { mark: 'surface', coords: 'spherical', angles: 'degrees', data, theta: 'azimuth', phi: 'polar' }
    expect(() => normalise({ ...base })).toThrow("with data, r names a field of the rows - e.g. r: 'gain'")
    expect(() => normalise({ ...base, r: [0, 1] })).toThrow("r names a field of the rows, such as r: 'gain' - ranges are for fn")
    expect(() => normalise({ ...base, r: 'loss' })).toThrow('the row at azimuth 0, polar 0 has loss undefined - a number in every row')
    expect(() => normalise({ ...base, data: data.slice(1), r: 'gain' })).toThrow('a surface needs a row for every azimuth and polar pair - 1 of 84 are missing (first: azimuth 0, polar 0)')
    expect(() => normalise({ ...base, r: 'gain', samples: 9 })).toThrow("'samples' is for charts of a function - with data")
    expect(() => normalise({ ...base, r: 'gain', angles: 'turns' })).toThrow("'angles' is 'radians' (the default) or 'degrees'")
    expect(() => normalise({ ...base, r: 'gain', data: data.map((r) => ({ ...r, x: 1 })) })).toThrow('row 0 has its own x, y or z')
    expect(() => normalise({ mark: 'curve', coords: 'polar', data, theta: 'azimuth', r: 'gain', phi: 'polar' })).toThrow('a polar curve reads theta, r - leave out phi')
    expect(() => normalise({ mark: 'bar', data, x: 'azimuth', y: 'gain', theta: 'azimuth' })).toThrow("'theta' is for curved coordinates - add coords")
  })
})

describe('graphs, bands and Riemann sums', () => {
  it('samples y = fn(x) into a line or an area over the x range, the axis spanning exactly it', () => {
    const c = chart({ mark: 'area', fn: (x) => Math.sin(x), x: [0, Math.PI], samples: 21 })
    const rows = normalise({ mark: 'area', fn: (x) => Math.sin(x), x: [0, Math.PI], samples: 21 }).rows
    expect(rows).toHaveLength(21)
    expect(rows[10].y).toBeCloseTo(1, 9)
    expect(c.scales.x?.domain).toEqual([0, Math.PI])
    expect(c.summary()).toBe('area chart of y = fn(x), 21 samples')
    expect(normalise({ mark: 'line', fn: (x) => x, x: [0, 1] }).rows).toHaveLength(200)
  })

  it('fills between two curves when fn gives [y, y2] - the band\'s lower edge, not zero', () => {
    const c = chart({ mark: 'area', fn: (x) => [x + 2, x + 1], x: [0, 1], samples: 3 })
    expect(normalise({ mark: 'area', fn: (x) => [x + 2, x + 1], x: [0, 1], samples: 3 }).rows[0]).toEqual({ x: 0, y: 2, y2: 1 })
    // the y axis reaches the lower edge without being pulled to zero
    expect(c.scales.y?.domain[0]).toBeGreaterThan(0)
    // two triangles a step, from y down to y2
    const p = c.marks[0].geometry.positions, y = /** @type {any} */ (c.scales.y)
    expect(p[1]).toBeCloseTo(y(2), 5)
    expect(p[4]).toBeCloseTo(y(1), 5)
  })

  it('cuts the range into rectangles as high as fn at their middles - or left or right ends', () => {
    const sq = (x) => x * x
    const mid = chart({ mark: 'bar', fn: sq, x: [0, 2], samples: 4, transition: false })
    expect(mid.marks[0].data.map((r) => [r.x, r.x2, r.at])).toEqual([[0, 0.5, 0.25], [0.5, 1, 0.75], [1, 1.5, 1.25], [1.5, 2, 1.75]])
    expect(mid.marks[0].data[0].y).toBeCloseTo(0.0625, 9)
    expect(mid.scales.x?.kind).toBe('linear')
    expect(mid.summary()).toBe('bar chart of a Riemann sum of fn, 4 rectangles, each at its middle')
    // side by side, each as wide as its span
    const bars = mid.marks[0], m = bars.instanceMatrices, x = /** @type {any} */ (mid.scales.x)
    expect(m[0]).toBeCloseTo(x(0.5) - x(0), 5)
    expect(m[12]).toBeCloseTo((x(0) + x(0.5)) / 2, 5)
    expect(chart({ mark: 'bar', fn: sq, x: [0, 2], samples: 4, rule: 'right' }).marks[0].data.map((r) => r.at)).toEqual([0.5, 1, 1.5, 2])
    expect(chart({ mark: 'bar', fn: sq, x: [0, 2], samples: 1 }).marks[0].data).toHaveLength(1)
  })

  it('spans data bars from x to x2 on a number axis - a histogram - and floats them from y2', () => {
    const bins = [{ from: 0, to: 10, n: 4 }, { from: 10, to: 30, n: 7 }]
    const c = chart({ mark: 'bar', data: bins, x: 'from', x2: 'to', y: 'n', transition: false })
    expect(c.scales.x?.kind).toBe('linear')
    expect(c.scales.x?.domain).toEqual([0, 30])
    const m = c.marks[0].instanceMatrices, x = /** @type {any} */ (c.scales.x)
    // the second bin twice as wide as the first
    expect(m[16] / m[0]).toBeCloseTo(2, 5)
    expect(m[16]).toBeCloseTo(x(30) - x(10), 5)
    const floating = chart({ mark: 'bar', data: [{ k: 'a', lo: 2, hi: 5 }], x: 'k', y: 'hi', y2: 'lo', transition: false })
    const y = /** @type {any} */ (floating.scales.y), f = floating.marks[0].instanceMatrices
    expect(f[5]).toBeCloseTo(y(5) - y(2), 5)
  })

  it('says what is wrong with a spec', () => {
    const rows = [{ a: 1, b: 2, c: 'x' }]
    expect(() => normalise({ mark: 'line', data: rows, x: 'a', y: 'b', x2: 'b' })).toThrow("x2 is where a bar ends along x, with x where it starts - for mark: 'bar', not 'line'")
    expect(() => normalise({ mark: 'bar', data: rows, x: 'c', x2: 'b', y: 'a' })).toThrow('x2 spans a bar along a number axis')
    expect(() => normalise({ mark: 'line', data: rows, x: 'a', y: 'b', y2: 'a' })).toThrow("y2 is the other edge of an area, or the other end of a bar - for mark: 'area' or 'bar', not 'line'")
    expect(() => normalise({ mark: 'area', data: rows, x: 'a', y: 'b', y2: 'a', stack: true })).toThrow('stack or y2, not both')
    expect(() => normalise({ mark: 'line', fn: (x) => [x, x], x: [0, 1] })).toThrow("a line has one value; [y, y2] fills between them with mark: 'area'")
    expect(() => normalise({ mark: 'area', fn: (x) => (x > 0.5 ? [x, 0] : x), x: [0, 1] })).toThrow('but a single y before')
    expect(() => normalise({ mark: 'area', fn: (x) => x, x: [0, 1], y2: 'low' })).toThrow('return [y, y2] from fn')
    expect(() => normalise({ mark: 'bar', fn: (x) => x, x: [0, 1], rule: 'trapezoid' })).toThrow("'rule' is 'left', 'mid' (the default) or 'right'")
    expect(() => normalise({ mark: 'area', fn: (x) => x, x: [0, 1], rule: 'left' })).toThrow("'rule' is where a bar from fn takes its height - for mark: 'bar'")
    expect(() => normalise({ mark: 'line', fn: (x) => x })).toThrow('needs the range of x to sample')
    expect(() => normalise({ mark: 'area', fn: (x) => x, x: [0, 1], t: [0, 1] })).toThrow("a 'area' from fn is over x")
  })
})

describe('angles: where zero points, and which way they turn', () => {
  const guides = (c) => c.children.find((n) => n.name === 'axes')?.children.find((n) => n.name === 'guides')
  const labelAt = (c, text) => guides(c).children.find((n) => n.text === text).position

  it('puts 0° at the top, turning clockwise, as a datasheet draws it - the angle labels with it', () => {
    const rows = [0, 90, 180, 270].map((angle) => ({ angle, level: 1 }))
    const spec = { mark: 'curve', coords: 'polar', data: rows, theta: 'angle', r: 'level', angles: { units: 'degrees', zero: 'top', clockwise: true } }
    const drawn = normalise(spec).rows
    // 0° up, 90° to the right
    expect(drawn[0].x).toBeCloseTo(0, 9)
    expect(drawn[0].y).toBeCloseTo(1, 9)
    expect(drawn[1].x).toBeCloseTo(1, 9)
    expect(drawn[1].y).toBeCloseTo(0, 9)
    const c = chart(spec)
    const x = /** @type {any} */ (c.scales.x), y = /** @type {any} */ (c.scales.y)
    const top = labelAt(c, '0°'), right = labelAt(c, '90°')
    expect(top[0]).toBeCloseTo(x(0), 5)
    expect(top[1]).toBeGreaterThan(y(0))
    expect(right[0]).toBeGreaterThan(x(0))
    expect(right[1]).toBeCloseTo(y(0), 5)
  })

  it('turns surfaces and functions too - on the floor, top is away from the front', () => {
    const quarter = normalise({ mark: 'surface', coords: 'spherical', fn: () => 1, samples: 5, angles: { zero: 'top', clockwise: true } })
      .rows.find((r) => Math.abs(r.theta - Math.PI / 2) < 1e-9 && Math.abs(r.phi - Math.PI / 2) < 1e-9)
    // a quarter turn clockwise from +z (away) is +x
    expect(quarter.x).toBeCloseTo(1, 9)
    expect(quarter.z).toBeCloseTo(0, 9)
    const left = normalise({ mark: 'curve', coords: 'polar', fn: () => 2, samples: 3, angles: { zero: 'left' } }).rows[0]
    expect([left.x, left.y]).toEqual([-2, expect.closeTo(0, 9)])
    // the shorthand still works, and the defaults are as before
    expect(normalise({ mark: 'curve', coords: 'polar', fn: () => 1, samples: 3, angles: { units: 'degrees' } }).rows.at(-1).theta).toBe(360)
  })

  it('says what is wrong with angles', () => {
    const base = { mark: 'curve', coords: 'polar', fn: () => 1 }
    expect(() => normalise({ ...base, angles: { zero: 'north' } })).toThrow("angles' zero is where theta 0 points: 'right' (the default), 'top', 'left' or 'bottom'")
    expect(() => normalise({ ...base, angles: { clockwise: 'yes' } })).toThrow("angles' clockwise is true or false")
    expect(() => normalise({ ...base, angles: { units: 'turns' } })).toThrow("angles' units are 'radians' (the default) or 'degrees'")
    expect(() => normalise({ ...base, angles: { direction: 'cw' } })).toThrow("angles has no 'direction'")
    expect(() => normalise({ ...base, angles: 3 })).toThrow("'angles' is 'radians' (the default) or 'degrees', or { units, zero, clockwise }")
  })
})

describe('colour by a second value: a complex function\'s phase on the hue wheel', () => {
  it('keeps the fields a height fn gives beside y, to colour by', () => {
    const rows = normalise({ mark: 'surface', fn: (x, z) => ({ y: Math.hypot(x, z), phase: Math.atan2(z, x) }), x: [-1, 1], z: [-1, 1], samples: 3 }).rows
    expect(rows[0]).toEqual({ x: -1, z: -1, y: Math.SQRT2, phase: Math.atan2(-1, -1) })
    const c = chart({ mark: 'surface', fn: (x, z) => ({ y: x * z, phase: x }), x: [-1, 1], z: [-1, 1], samples: 5, color: { field: 'phase', scale: { scheme: 'hue', domain: [-1, 1] } } })
    expect(c.spec.channels.color.field).toBe('phase')
    // shaded by the height alone: a level y gives level normals, whatever the other field does
    const flat = chart({ mark: 'surface', fn: (x) => ({ y: 0, phase: x * 9 }), x: [-1, 1], z: [-1, 1], y: [-1, 1], samples: 5 }).marks[0].geometry.normals
    for (let i = 1; i < flat.length; i += 3) expect(Math.abs(flat[i])).toBeCloseTo(1, 6)
    expect(() => normalise({ mark: 'surface', fn: () => ({ y: 1, x: 2 }), x: [0, 1], z: [0, 1] })).toThrow("fn's x is the row's own")
    expect(() => normalise({ mark: 'surface', fn: () => ({ phase: 1 }), x: [0, 1], z: [0, 1] })).toThrow('or { y, ...fields to colour by }')
  })

  it('has a hue wheel that comes back round: the same colour at both ends of its domain', () => {
    const wheel = chart({ mark: 'surface', fn: (x) => ({ y: 0, a: x }), x: [-Math.PI, Math.PI], z: [0, 1], samples: 9, color: { field: 'a', scale: { scheme: 'hue', domain: [-Math.PI, Math.PI] } } })
    const color = /** @type {any} */ (wheel.scales.color)
    expect(color(-Math.PI).getHex()).toBe(color(Math.PI).getHex())
    // and goes all the way round between
    expect(color(0).getHex()).not.toBe(color(Math.PI).getHex())
  })
})
