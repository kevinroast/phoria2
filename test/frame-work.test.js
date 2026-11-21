// Work a View's frame skips when it can: the change check and the world matrices, each taken once a
// tick rather than again when drawing. What's drawn must still be where things are.
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { Mesh, View, box } from '../src/index.js'
import { fakePage } from './fakes.js'

const page = fakePage()
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 50))
  page.restore()
})
/** @type {View[]} */
const made = []
afterEach(() => {
  for (const v of made.splice(0)) v.dispose()
  page.frame(0)
})
const viewOf = (options = {}) => {
  const view = new View({ canvas: page.canvas(), camera: { position: [0, 0, 10], target: [0, 0, 0] }, ...options })
  made.push(view)
  return view
}
let clock = 0
const frame = () => page.frame((clock += 16))
/** Where a mesh was drawn in the last frame, as its world x. @param {View} view @param {Mesh} mesh */
const drawnX = (view, mesh) => view.lastFrame?.opaque.find((item) => item.node === mesh)?.worldMatrix[12]

describe("a View's frame", () => {
  it('draws what the frame callback moved where it moved to, every frame', () => {
    const view = viewOf()
    const mesh = view.scene.add(new Mesh({ geometry: box(1) }))
    view.start(() => { mesh.position.x += 0.5 })
    for (let i = 0; i < 4; i++) {
      frame()
      expect(drawnX(view, mesh)).toBeCloseTo(mesh.position.x)
    }
  })

  it('draws a child where its moved parent puts it', () => {
    const view = viewOf()
    const parent = view.scene.add(new Mesh({ geometry: box(1) }))
    const child = parent.add(new Mesh({ geometry: box(1), position: [1, 0, 0] }))
    view.start(() => { parent.position.x += 2 })
    frame()
    frame()
    expect(drawnX(view, child)).toBeCloseTo(parent.position.x + 1)
  })

  it('draws what a hover handler moved where it moved to, in the frame the handler ran in', async () => {
    const view = viewOf()
    const target = view.scene.add(new Mesh({ geometry: box(2) }))
    const other = view.scene.add(new Mesh({ geometry: box(1), position: [-3, 0, 0] }))
    // which tick the handler ran in - after that tick's frame callback, before its drawing
    let ticks = 0, ranIn = -1
    target.onHover = (hit) => {
      other.position.x = hit ? 3 : -3
      ranIn = ticks
    }
    view.start(() => { ticks++ })
    frame()
    ;/** @type {any} */ (view.canvas).dispatch('pointermove', { clientX: 150, clientY: 75 })
    let checked = false
    for (let i = 0; i < 6 && !checked; i++) {
      frame()
      if (ranIn === ticks) {
        expect(drawnX(view, other)).toBeCloseTo(3)
        checked = true
      }
      await new Promise((r) => setTimeout(r, 0))
    }
    expect(view.hovered?.node).toBe(target)
    // the handler ran inside a tick, between its scene update and its drawing - the case to check
    expect(checked).toBe(true)
  })

  it('goes idle once a change is drawn, without drawing it twice', () => {
    const view = viewOf()
    const mesh = view.scene.add(new Mesh({ geometry: box(1) }))
    frame()
    frame()
    let draws = 0
    const render = view.render.bind(view)
    view.render = () => { draws++; return render() }
    mesh.position.x = 2
    for (let i = 0; i < 4; i++) frame()
    expect(draws).toBe(1)
    expect(drawnX(view, mesh)).toBeCloseTo(2)
  })
})
