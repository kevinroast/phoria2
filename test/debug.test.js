// Debug drawing: helpers for a person checking a scene - lights, shadow cameras, bounds, normals, axes,
// the orbit target and a stats readout - drawn after the scene but never part of it: not picked,
// explained, framed or kept in the last frame.
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { DirectionalLight, Mesh, PerspectiveCamera, PointLight, Scene, SpotLight, View, box, plane } from '../src/index.js'
import { collect } from '../src/frame.js'
import { DebugDraw } from '../src/debug.js'
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
})
const viewOf = (options = {}) => {
  const view = new View({ canvas: page.canvas(), camera: { position: [0, 3, 10], target: [0, 0, 0] }, ...options })
  made.push(view)
  return view
}
// the debug code loads on first use
const loaded = async () => {
  await import('../src/debug.js')
  await new Promise((r) => setTimeout(r, 0))
}

describe('view.debug', () => {
  it('takes true for everything but normals, options for some, and false for none', () => {
    const view = viewOf()
    expect(view.debug).toBe(false)
    view.debug = true
    expect(view.debug).toEqual({ lights: true, shadows: true, bounds: true, normals: false, axes: true, camera: true, stats: 'top-left' })
    view.debug = { bounds: 'hovered', stats: true }
    expect(view.debug).toEqual({ lights: false, shadows: false, bounds: 'hovered', normals: false, axes: false, camera: false, stats: 'top-left' })
    view.debug = false
    expect(view.debug).toBe(false)
    expect(viewOf({ debug: { axes: true } }).debug).toMatchObject({ axes: true, lights: false })
  })

  it('says what it takes when given something else', () => {
    const view = viewOf()
    expect(() => { view.debug = /** @type {any} */ ('on') }).toThrow("'debug' is true, false or {")
    expect(() => { view.debug = /** @type {any} */ ({ normals: 'all' }) }).toThrow("debug.normals is true, false or 'hovered'")
    expect(() => { view.debug = /** @type {any} */ ({ stats: 'middle' }) }).toThrow('debug.stats')
    expect(() => { view.debug = /** @type {any} */ ({ fps: true }) }).toThrow("use 'stats: true'")
  })

  it('draws its helpers after the scene but leaves them out of the frame kept, so they are never picked or counted', async () => {
    const view = viewOf()
    view.scene.add(new DirectionalLight({ direction: [0, -1, 0], castShadow: true }))
    view.scene.add(new Mesh({ geometry: box(1), castShadow: true }))
    view.scene.add(new Mesh({ geometry: plane(6), receiveShadow: true }))
    view.render()
    const plain = view.renderer.info.drawCalls
    view.debug = true
    await loaded()
    view.render()
    expect(view.renderer.info.drawCalls).toBeGreaterThan(plain)
    // the frame kept for picking and explain has the scene's two meshes, not the helpers
    expect([...view.lastFrame.opaque, ...view.lastFrame.transparent].map((i) => i.node.constructor.name)).toEqual(['Mesh', 'Mesh'])
    expect(view.scene.children).toHaveLength(3)
    expect(await view.explain()).toContain('Debug drawing: lights, shadows, bounds, axes, camera, stats (top-left)')
  })
})

describe('the helpers', () => {
  /** The line segments debug adds for a scene, with these options. @param {Scene} scene @param {any} o @param {any} [hovered] */
  function segments(scene, o, hovered = null) {
    const camera = new PerspectiveCamera({ position: [0, 3, 10], target: [0, 0, 0], aspect: 1 })
    scene.updateWorldTree()
    const frame = collect(scene, camera)
    const before = frame.opaque.length
    const draw = new DebugDraw(null)
    const added = draw.add(frame, o, { camera, hovered, bounds: scene.boundsFrom(camera) })
    if (!added.opaque) return 0
    return frame.opaque[before].geometry.positions.length / 6
  }
  const two = () => {
    const scene = new Scene()
    scene.add(new Mesh({ geometry: box(1), position: [-2, 0, 0] }))
    scene.add(new Mesh({ geometry: box(1), position: [2, 0, 0] }))
    return scene
  }

  it('boxes each drawable, or only the hovered one', () => {
    const scene = two()
    expect(segments(scene, { bounds: true })).toBe(24)
    expect(segments(scene, { bounds: 'hovered' })).toBe(0)
    expect(segments(scene, { bounds: 'hovered' }, { node: scene.children[0], instance: null })).toBe(12)
  })

  it('draws the axes, the orbit target and a normal a vertex', () => {
    const scene = two()
    expect(segments(scene, { axes: true })).toBe(3)
    expect(segments(scene, { camera: true })).toBe(3)
    // a box's 24 vertices, twice
    expect(segments(scene, { normals: true })).toBe(48)
  })

  it('draws each light: a sphere and its range for a point light, a cone for a spot, an arrow for the sun', () => {
    const point = new Scene()
    point.add(new Mesh({ geometry: box(1) }))
    point.add(new PointLight({ position: [0, 2, 0], range: 5 }))
    // three small circles of 16, and the range's ring of 48
    expect(segments(point, { lights: true })).toBe(96)
    const spot = new Scene()
    spot.add(new Mesh({ geometry: box(1) }))
    spot.add(new SpotLight({ position: [0, 3, 0], direction: [0, -1, 0] }))
    // the ring of 32, four edges and the axis
    expect(segments(spot, { lights: true })).toBe(37)
    const sun = new Scene()
    sun.add(new Mesh({ geometry: box(1) }))
    sun.add(new DirectionalLight({ direction: [0, -1, 0] }))
    // the shaft and four barbs
    expect(segments(sun, { lights: true })).toBe(5)
  })

  it("draws the shadow's box: twelve edges", () => {
    const scene = two()
    scene.add(new DirectionalLight({ direction: [0, -1, 0], castShadow: true }))
    for (const m of scene.children) m.castShadow = true
    expect(segments(scene, { shadows: true })).toBe(12)
  })

  it('adds nothing when nothing is asked for', () => {
    expect(segments(two(), {})).toBe(0)
  })
})

