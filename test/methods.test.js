// The smaller methods: colour spaces, boxes, rotations and matrices, moving nodes, normals, the
// resource lifecycle, chart value formats and dates, and pausing a timeline.
import { describe, expect, it, vi } from 'vitest'
import { Geometry, Group, InstancedMesh, Lines, Material, Mesh, Points, Scene, Texture, box } from '../src/index.js'
import { Color } from '../src/value/Color.js'
import { Box3 } from '../src/value/Box3.js'
import { Quat } from '../src/value/Quat.js'
import { Mat4 } from '../src/value/Mat4.js'
import { Vec3 } from '../src/value/Vec3.js'
import { Euler } from '../src/value/Euler.js'
import { ChangeWatch } from '../src/watch.js'
import { PerspectiveCamera } from '../src/scene/cameras.js'
import { formatValue } from '../src/charts/Chart.js'
import { toDate } from '../src/charts/scales.js'
import { Timeline } from '../src/motion/index.js'

const round = (v) => Array.from(v, (x) => Math.round(x * 1e4) / 1e4)
const pixels = () => ({ data: new Uint8Array([255, 0, 0, 255]), width: 1, height: 1 })

describe('Color spaces', () => {
  it('keeps colours linear inside, turning sRGB in and out', () => {
    // sRGB 0.5 is about 0.214 in linear light
    const c = new Color().setSRGB(0.5, 0.5, 0.5)
    expect(Math.round(c[0] * 1000) / 1000).toBe(0.214)
    expect(round(c.toSRGB())).toEqual([0.5, 0.5, 0.5])
    expect(Array.from(new Color().setLinear(0.25, 0.5, 1))).toEqual([0.25, 0.5, 1])
    // the ends stay put, and out-of-range light is clamped going out
    expect(round(new Color().setSRGB(0, 1, 0).toSRGB())).toEqual([0, 1, 0])
    expect(new Color().setLinear(4, -1, 0.5).toSRGB().slice(0, 2)).toEqual([1, 0])
  })

  it('round-trips every 8-bit sRGB value through linear and back', () => {
    for (let i = 0; i < 256; i++) {
      const c = new Color().setSRGB(i / 255, i / 255, i / 255)
      expect(Math.round(c.toSRGB()[0] * 255)).toBe(i)
    }
  })
})

describe('Box3', () => {
  it('starts empty, grows to hold points, and knows what it contains', () => {
    const b = new Box3()
    expect(b.isEmpty()).toBe(true)
    b.expandByXYZ(1, 2, 3).expandByPoint([-1, 0, 1])
    expect([b.min.toArray(), b.max.toArray()]).toEqual([[-1, 0, 1], [1, 2, 3]])
    expect(b.getSize().toArray()).toEqual([2, 2, 2])
    expect(b.containsPoint([0, 1, 2])).toBe(true)
    // the faces count as inside
    expect(b.containsPoint([1, 2, 3])).toBe(true)
    expect(b.containsPoint([0, 1, 4])).toBe(false)
    const copy = new Box3().copy(b)
    expect(copy.max.toArray()).toEqual([1, 2, 3])
    copy.makeEmpty()
    expect([copy.isEmpty(), b.isEmpty()]).toEqual([true, false])
  })
})

describe('rotations and matrices', () => {
  it('builds a rotation about an axis, and combines rotations in either order', () => {
    const quarter = new Quat().setFromAxisAngle([0, 1, 0], Math.PI / 2)
    expect(round(new Vec3(1, 0, 0).applyQuaternion(quarter))).toEqual([0, 0, -1])
    // turn about x, then about y: premultiply applies the second in the parent's frame
    const aboutX = new Quat().setFromAxisAngle([1, 0, 0], Math.PI / 2)
    const both = new Quat().copy(aboutX).premultiply(quarter)
    // (0, 1, 0) -> about x -> (0, 0, 1) -> about y -> (1, 0, 0)
    expect(round(new Vec3(0, 1, 0).applyQuaternion(both))).toEqual([1, 0, 0])
    const other = new Quat().copy(aboutX).multiply(quarter)
    expect(round(new Vec3(0, 1, 0).applyQuaternion(other))).not.toEqual([1, 0, 0])
  })

  it('multiplies matrices in the order given, and copies them', () => {
    const move = new Mat4().compose([5, 0, 0], [0, 0, 0, 1], [1, 1, 1])
    const grow = new Mat4().compose([0, 0, 0], [0, 0, 0, 1], [2, 2, 2])
    // grow first, then move: a point at 1 ends at 7
    const both = new Mat4().multiplyMatrices(move, grow)
    expect(round(new Vec3(1, 0, 0).applyMatrix4(both))).toEqual([7, 0, 0])
    expect(round(new Vec3(1, 0, 0).applyMatrix4(new Mat4().multiplyMatrices(grow, move)))).toEqual([12, 0, 0])
    expect(Array.from(new Mat4().copy(both))).toEqual(Array.from(both))
  })

  it('copies vectors and angles, and measures distance', () => {
    expect(new Vec3().copy({ x: 1, y: 2, z: 3 }).toArray()).toEqual([1, 2, 3])
    expect(new Vec3(1, 1, 1).distanceTo([4, 5, 1])).toBe(5)
    const e = new Euler().copy([0.1, 0.2, 0.3])
    expect(round([e.x, e.y, e.z])).toEqual([0.1, 0.2, 0.3])
  })
})

describe('moving nodes', () => {
  it('visits a node and everything under it, parents first', () => {
    const root = new Group({ name: 'root' })
    const a = root.add(new Group({ name: 'a' }))
    a.add(new Group({ name: 'a1' }))
    root.add(new Group({ name: 'b' }))
    const seen = []
    root.traverse((n) => seen.push(n.name))
    expect(seen).toEqual(['root', 'a', 'a1', 'b'])
  })

  it('moves along its own axes, so a turned node moves the way it faces', () => {
    const n = new Group({ rotation: [0, Math.PI / 2, 0] })
    n.translateZ(2)
    expect(round(n.position)).toEqual([2, 0, 0])
    n.translateY(1)
    expect(round(n.position)).toEqual([2, 1, 0])
  })

  it("keeps a hand-set matrix with matrixAutoUpdate: false, until updateMatrix() is asked for", () => {
    const n = new Group({ matrixAutoUpdate: false })
    n.matrix.compose([0, 9, 0], [0, 0, 0, 1], [1, 1, 1])
    n.position.set(5, 0, 0)
    n.updateWorld()
    expect(round(n.worldMatrix).slice(12, 15)).toEqual([0, 9, 0])
    n.updateMatrix().updateWorld()
    expect(round(n.worldMatrix).slice(12, 15)).toEqual([5, 0, 0])
  })

  it("gives the row of data for an instance, point or segment - and a node's own data otherwise", () => {
    const bars = new InstancedMesh({ geometry: box(1), data: [{ id: 'a' }, { id: 'b' }] })
    expect([bars.datumAt(1), bars.datumAt(null)]).toEqual([{ id: 'b' }, null])
    const dots = new Points({ geometry: new Geometry({ positions: [0, 0, 0, 1, 1, 1] }), data: ['first', 'second'] })
    expect(dots.datumAt(1)).toBe('second')
    const lines = new Lines({ geometry: new Geometry({ positions: [0, 0, 0, 1, 0, 0] }), data: ['only'] })
    expect([lines.datumAt(0), lines.datumAt(5)]).toEqual(['only', null])
    expect(new Mesh({ geometry: box(1), data: { id: 7 } }).datumAt(3)).toEqual({ id: 7 })
  })
})

describe('points of indexed geometry', () => {
  // a mesh's geometry shown as its vertices too, as the models demo does: 24 vertices, 36 indices,
  // all of them a long way from the origin
  const shown = () => {
    const geometry = box(1)
    const scene = new Scene()
    const points = scene.add(new Points({ geometry, position: [10, 0, 0], data: Array.from({ length: geometry.vertexCount }, (_, i) => i) }))
    scene.updateWorldTree()
    return { geometry, scene, points }
  }

  it('count their vertices, limited by drawCount, never the indices', () => {
    const { geometry } = shown()
    expect(geometry.drawnVertices).toBe(24)
    geometry.drawCount = 10
    expect(geometry.drawnVertices).toBe(10)
    geometry.drawCount = 100
    expect(geometry.drawnVertices).toBe(24)
  })

  it('pick only real vertices - nothing at the origin past the last one', async () => {
    const { Raycaster } = await import('../src/index.js')
    const { scene, points } = shown()
    const camera = new PerspectiveCamera({ position: [0, 0, 10], target: [0, 0, 0] })
    // straight at the origin, where a vertex read past the end would sit
    const rc = new Raycaster().setFromCamera([0, 0], camera)
    rc.threshold = 0.5
    expect(rc.intersect(scene)).toEqual([])
    // at one of its corners, the row for that vertex
    const aim = new Raycaster().setFromCamera([0, 0], new PerspectiveCamera({ position: [10.5, 0.5, 10], target: [10.5, 0.5, 0.5] }))
    aim.threshold = 0.1
    const hit = aim.intersect(scene)[0]
    expect(hit?.node).toBe(points)
    expect(hit?.face).toBeLessThan(24)
  })
})

describe('normals', () => {
  // two triangles folded along x at a right angle: one flat on the floor, one standing up
  const fold = () => new Geometry({ positions: [0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2, 3, 4, 5] })
  const welded = () => new Geometry({ positions: [0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 1, 0], indices: [0, 1, 2, 0, 1, 3] })

  it('point each face outward, counter-clockwise from the front', () => {
    const g = fold().computeNormals()
    expect(round(g.normals.slice(0, 3))).toEqual([0, 1, 0])
    expect(round(g.normals.slice(9, 12))).toEqual([0, 0, 1])
  })

  it('average across shared corners when smooth, and give every face its own when flat', () => {
    const smooth = welded().computeNormals()
    // the shared edge's corners lean between the floor and the wall
    const s = Math.SQRT1_2
    expect(round(smooth.normals.slice(0, 3))).toEqual(round([0, s, s]))
    const flat = welded().computeNormals({ flat: true })
    expect(flat.indices).toBeNull()
    expect(flat.vertexCount).toBe(6)
    expect(round(flat.normals.slice(0, 3))).toEqual([0, 1, 0])
    expect(round(flat.normals.slice(9, 12))).toEqual([0, 0, 1])
  })
})

describe('the resource lifecycle', () => {
  it("tells whoever is listening when geometry, materials and textures are disposed - until they stop listening", () => {
    for (const thing of [box(1), new Material(), new Texture({ image: pixels() })]) {
      const heard = vi.fn()
      const stop = thing.onDispose(heard)
      thing.dispose()
      stop()
      thing.dispose()
      expect(heard).toHaveBeenCalledTimes(1)
    }
  })

  it('sets a map from a texture, a url or options, in the colour space its slot needs - or clears it', () => {
    const m = new Material()
    const t = new Texture({ image: pixels() })
    m.setMap('map', t)
    expect(m.map).toBe(t)
    m.setMap('normalMap', { image: pixels() })
    expect(m.normalMap?.colorSpace).toBe('linear')
    m.setMap('emissiveMap', { image: pixels() })
    expect(m.emissiveMap?.colorSpace).toBe('srgb')
    m.setMap('map', null)
    expect(m.map).toBeNull()
    expect(() => m.setMap('map', /** @type {any} */ (42))).toThrow("'map' must be a Texture")
  })
})

describe('chart values', () => {
  const NUMBER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })
  const COMPACT = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
  it('formats numbers short and big numbers compact, dates as dates - or by the channel\'s format', () => {
    expect(formatValue(/** @type {any} */ ({}), 1.23456)).toBe(NUMBER.format(1.23456))
    expect(formatValue(/** @type {any} */ ({}), 123456)).toBe(COMPACT.format(123456))
    expect(formatValue(/** @type {any} */ ({ format: { style: 'percent' } }), 0.5)).toBe(new Intl.NumberFormat(undefined, { style: 'percent' }).format(0.5))
    expect(formatValue(/** @type {any} */ ({ format: (v) => `${v} units` }), 3)).toBe('3 units')
    const day = new Date(2026, 9, 25)
    expect(formatValue(/** @type {any} */ ({ format: { month: 'long' } }), day)).toBe(new Intl.DateTimeFormat(undefined, { month: 'long' }).format(day))
    expect([formatValue(/** @type {any} */ ({}), null), formatValue(/** @type {any} */ ({}), 'North')]).toEqual(['', 'North'])
  })

  it('reads dates from Date objects, timestamps and ISO strings, and says what to use otherwise', () => {
    const iso = toDate('2026-10-25')
    expect(iso.toISOString().slice(0, 10)).toBe('2026-10-25')
    expect(toDate(iso.getTime()).getTime()).toBe(iso.getTime())
    expect(toDate(iso)).toBe(iso)
    expect(() => toDate('next tuesday')).toThrow("isn't a date - use Date objects, timestamps or ISO strings")
  })
})

describe('change watching and timelines', () => {
  it('reports a change once, then nothing until something changes - and reset() makes the next check report one', () => {
    const scene = new Scene()
    const cube = scene.add(new Mesh({ geometry: box(1) }))
    const camera = new PerspectiveCamera({ position: [0, 0, 5] })
    const watch = new ChangeWatch()
    expect(watch.changed(scene, camera)).toBe(true)
    expect(watch.changed(scene, camera)).toBe(false)
    cube.position.x = 1
    expect(watch.changed(scene, camera)).toBe(true)
    watch.reset()
    expect(watch.changed(scene, camera)).toBe(true)
    expect(watch.changed(scene, camera)).toBe(false)
  })

  it('pauses where it is, and plays on from there', () => {
    const story = new Timeline().add(2, () => {})
    story.update(0.5)
    story.pause().update(1)
    expect([story.time, story.playing]).toEqual([0.5, false])
    story.play().update(0.5)
    expect(story.time).toBe(1)
  })
})
