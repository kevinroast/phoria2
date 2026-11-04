// Two pieces for diagrams and data in 1.3: dashed lines with arrowheads (flow and direction in
// network maps), and picking an area of the canvas - a box or a lasso - to select many things at once.
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { Geometry, InstancedMesh, Lines, Material, Mesh, PerspectiveCamera, Points, Scene, View, WebGLRenderer, box } from '../src/index.js'
import { fakeCanvas, fakeGL, fakePage } from './fakes.js'

const page = fakePage()
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 50))
  page.restore()
})
/** @type {View[]} */
const made = []
afterEach(() => {
  for (const v of made.splice(0)) v.dispose()
})

/** A renderer drawing the lines, keeping its line draws and the per-segment chain data sent. @param {Lines} lines */
function recording(lines) {
  const { gl } = fakeGL()
  /** @type {{ call: string, args: any[] }[]} */
  const calls = []
  const proxy = new Proxy(gl, {
    get(target, key) {
      if (key === 'drawArraysInstanced' || key === 'bufferData') {
        return (...args) => {
          calls.push({ call: key, args: key === 'bufferData' && ArrayBuffer.isView(args[1]) ? [Array.from(args[1])] : args })
          return target[key](...args)
        }
      }
      return target[key]
    },
  })
  const renderer = new WebGLRenderer({ canvas: fakeCanvas(proxy) })
  renderer.setSize(10, 10)
  const scene = new Scene()
  scene.add(lines)
  renderer.render(scene, new PerspectiveCamera({ position: [0, 0, 5], target: [0, 0, 0], aspect: 1 }))
  return calls
}

describe('dashed lines and arrowheads', () => {
  // a polyline of two segments, then a separate one
  const positions = [0, 0, 0, 3, 0, 0, 3, 0, 0, 3, 4, 0, 5, 5, 5, 6, 5, 5]

  it('knows each segment\'s place along its chain: where it starts, and whether it starts or ends one', () => {
    const calls = recording(new Lines({ geometry: new Geometry({ positions }) }))
    // the third buffer of the lines: distance at the start, starts a chain, ends one
    const info = calls.filter((c) => c.call === 'bufferData')[2].args[0]
    expect(info).toEqual([0, 1, 0, 3, 0, 1, 0, 1, 1])
  })

  it('draws two triangles a segment, and six more vertices for arrowheads only when asked', () => {
    const draws = (lines) => recording(lines).filter((c) => c.call === 'drawArraysInstanced').map((c) => c.args.slice(2))
    expect(draws(new Lines({ geometry: new Geometry({ positions }) }))).toEqual([[6, 3]])
    expect(draws(new Lines({ geometry: new Geometry({ positions }), arrows: 'end' }))).toEqual([[12, 3]])
  })

  it('takes dashes on the material and arrows on the node, and keeps them through clone and JSON', () => {
    const lines = new Lines({ geometry: new Geometry({ positions }), material: { dash: 0.5, gap: 0.2, dashOffset: 1 }, arrows: 'both', arrowSize: 12 })
    expect(lines.arrowBits).toBe(3)
    expect(lines.arrowPixels(2)).toBe(12)
    expect(new Lines({ geometry: new Geometry({ positions }), material: { width: 2 } }).arrowPixels(2)).toBe(12)
    const { type, ...json } = /** @type {any} */ (lines.toJSON())
    expect(type).toBe('lines')
    for (const copy of [lines.clone(), new Lines(json)]) {
      expect([copy.arrows, copy.arrowSize]).toEqual(['both', 12])
      expect([copy.material.dash, copy.material.gap, copy.material.dashOffset]).toEqual([0.5, 0.2, 1])
    }
    expect(new Material().dash).toBe(0)
    expect(() => new Lines({ geometry: new Geometry({ positions }), arrows: 'pointy' })).toThrow('arrows')
  })
})

describe('view.pickArea()', () => {
  // the canvas is 300 x 150, looking down -z at the origin from 10 away: x and y of 0 are its middle
  const viewOf = () => {
    const view = new View({ canvas: page.canvas(), camera: { position: [0, 0, 10], target: [0, 0, 0] } })
    made.push(view)
    return view
  }
  // the right half of the canvas
  const right = { x: 150, y: 0, width: 150, height: 150 }

  it('finds each point, instance, segment and mesh whose place is inside a box', () => {
    const view = viewOf()
    const points = view.scene.add(new Points({ geometry: new Geometry({ positions: [-1, 0, 0, 1, 0, 0, 2, 1, 0] }), data: ['a', 'b', 'c'] }))
    const bars = view.scene.add(new InstancedMesh({ geometry: box(0.2), count: 2, data: [{ id: 1 }, { id: 2 }] }))
    bars.setInstance(0, { position: [-1, -1, 0] })
    bars.setInstance(1, { position: [1, -1, 0] })
    const lines = view.scene.add(new Lines({ geometry: new Geometry({ positions: [-2, 2, 0, -1, 2, 0, 1, 2, 0, 2, 2, 0] }) }))
    const mesh = view.scene.add(new Mesh({ geometry: box(0.5), position: [1.5, -2, 0] }))
    const hits = view.pickArea(right)
    expect(hits.filter((h) => h.node === points).map((h) => h.datum).sort()).toEqual(['b', 'c'])
    expect(hits.filter((h) => h.node === bars).map((h) => h.instance)).toEqual([1])
    expect(hits.filter((h) => h.node === bars)[0].datum).toEqual({ id: 2 })
    expect(hits.filter((h) => h.node === lines).map((h) => h.face)).toEqual([1])
    expect(hits.filter((h) => h.node === mesh)).toHaveLength(1)
  })

  it('takes a box dragged either way, and a lasso', () => {
    const view = viewOf()
    view.scene.add(new Points({ geometry: new Geometry({ positions: [-1, 0, 0, 1, 0, 0, 1, 1, 0] }) }))
    // dragged up and to the left, from the bottom right corner
    expect(view.pickArea({ x: 300, y: 150, width: -150, height: -150 })).toHaveLength(2)
    // a triangle round the middle right point only: its lower half
    const at = (x, y) => { const s = view.project([x, y, 0]); return /** @type {[number, number]} */ ([s.x, s.y]) }
    const lasso = [at(0.5, -0.5), at(1.5, -0.5), at(1, 0.5)]
    expect(view.pickArea(lasso).map((h) => h.face)).toEqual([1])
  })

  it('finds what is hidden behind other things too, nearest first', () => {
    const view = viewOf()
    view.scene.add(new Mesh({ geometry: box(4), position: [1, 0, 2] }))
    const far = view.scene.add(new Points({ geometry: new Geometry({ positions: [1, 0, -3] }) }))
    const hits = view.pickArea(right)
    expect(hits).toHaveLength(2)
    expect(hits[1].node).toBe(far)
  })

  it('leaves out what is hidden, unpickable or behind the camera, and hidden instances', () => {
    const view = viewOf()
    view.scene.add(new Points({ geometry: new Geometry({ positions: [1, 0, 0] }), visible: false }))
    view.scene.add(new Points({ geometry: new Geometry({ positions: [1, 0, 0] }), pickable: false }))
    view.scene.add(new Points({ geometry: new Geometry({ positions: [1, 0, 20] }) }))
    const bars = view.scene.add(new InstancedMesh({ geometry: box(0.2), count: 1 }))
    bars.setInstance(0, { position: [1, 0, 0], scale: 0 })
    expect(view.pickArea(right)).toEqual([])
  })

  it('says what it takes when given something else', () => {
    const view = viewOf()
    expect(() => view.pickArea(/** @type {any} */ ({ x: 1, y: 2 }))).toThrow('a box { x, y, width, height } or a lasso')
    expect(() => view.pickArea(/** @type {any} */ ([[0, 0], [1, 1]]))).toThrow('three or more')
  })
})
