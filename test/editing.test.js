// What editors build on: rays meeting planes, letting go of an orbit gesture, and outlines round
// what is selected.
import { describe, expect, it, vi } from 'vitest'
import { Group, Mesh, OrbitControl, PerspectiveCamera, Ray, Scene, WebGLRenderer, box } from '../src/index.js'
import { collect } from '../src/frame.js'
import { ChangeWatch } from '../src/watch.js'
import { fakeCanvas, fakeElement, fakeGL } from './fakes.js'

const camera = () => new PerspectiveCamera({ position: [0, 5, 5], target: [0, 0, 0], aspect: 1 })

describe('Ray.intersectPlane', () => {
  it('finds where a ray meets a plane, and nothing when it runs along it or away from it', () => {
    const down = new Ray([0, 5, 0], [0, -1, 0])
    expect(down.intersectPlane([0, 1, 0], [0, 2, 0])).toBeCloseTo(3)
    const slant = new Ray([0, 4, 0], [1, -1, 0])
    expect(slant.at(/** @type {number} */ (slant.intersectPlane([0, 1, 0], [0, 0, 0]))).toArray().map((v) => Math.round(v * 1e6) / 1e6)).toEqual([4, 0, 0])
    expect(new Ray([0, 1, 0], [1, 0, 0]).intersectPlane([0, 1, 0], [0, 0, 0])).toBeNull()
    expect(new Ray([0, 1, 0], [0, 1, 0]).intersectPlane([0, 1, 0], [0, 0, 0])).toBeNull()
  })
})

describe('OrbitControl.cancel', () => {
  it('lets go of the gesture under way, so the camera stops following the pointer', () => {
    const element = fakeElement('canvas')
    /** @type {Map<string, Function>} */
    const listeners = new Map()
    element.addEventListener = (type, fn) => listeners.set(type, fn)
    element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 })
    const cam = camera()
    const orbit = new OrbitControl(cam, element)
    const event = (type, x) => listeners.get(type)?.({ pointerId: 1, button: 0, pointerType: 'mouse', clientX: x, clientY: 0, preventDefault() {} })
    event('pointerdown', 0)
    event('pointermove', 20)
    const turned = cam.position.toArray()
    expect(turned).not.toEqual([0, 5, 5])
    orbit.cancel()
    event('pointermove', 60)
    expect(cam.position.toArray()).toEqual(turned)
  })
})

describe('outlines', () => {
  it('gather the meshes under each outlined node, to be drawn round together', () => {
    const scene = new Scene()
    const sofa = scene.add(new Group({ outline: { color: '#ffcc00', width: 3 } }))
    const seat = sofa.add(new Mesh({ geometry: box() })), back = sofa.add(new Mesh({ geometry: box(), position: [0, 1, 0] }))
    scene.add(new Mesh({ geometry: box(), position: [3, 0, 0] }))
    // an outlined group with nothing drawn in it outlines nothing
    scene.add(new Group({ outline: 'red' }))
    scene.updateWorldTree()
    const frame = collect(scene, camera())
    expect(frame.outlines).toHaveLength(1)
    expect(frame.outlines[0].items.map((i) => i.node)).toEqual([seat, back])
    expect(frame.outlines[0].width).toBe(3)
    expect(frame.outlines[0].color.getHex()).toBe(0xffcc00)
  })

  it('take a colour or { color, width }, and say why they refuse', () => {
    const mesh = new Mesh({ geometry: box(), outline: '#00ff00' })
    expect([mesh.outline?.color.getHex(), mesh.outline?.width]).toEqual([0x00ff00, 2])
    mesh.outline = null
    expect(mesh.outline).toBeNull()
    expect(() => { mesh.outline = { width: 0 } }).toThrow("'outline.width' is in pixels")
    expect(() => { mesh.outline = { colour: 'red' } }).toThrow("unknown option 'outline.colour'")
    expect(() => new Mesh({ geometry: box(), selected: true })).toThrow("node.outline = '#ffcc00'")
  })

  it('redraw an idle view when they come, change or go - as do new pointer handlers', () => {
    const scene = new Scene()
    const mesh = scene.add(new Mesh({ geometry: box() }))
    const cam = camera(), watch = new ChangeWatch()
    watch.changed(scene, cam)
    for (const change of [() => { mesh.outline = 'red' }, () => mesh.outline?.color.set('blue'), () => { mesh.outline = null }, () => { mesh.onDrag = () => {} }]) {
      change()
      expect(watch.changed(scene, cam), String(change)).toBe(true)
    }
  })

  /** Draw an outlined box twice (the passes load after the first), recording shaders and GL calls. @param {object} [options] */
  const drawOutlined = async (options = {}) => {
    const { gl, count } = fakeGL()
    const sources = [], calls = []
    const recording = new Proxy(gl, {
      get: (t, k) => (k === 'shaderSource' ? (_s, src) => sources.push(src)
        : k === 'blitFramebuffer' || k === 'renderbufferStorageMultisample' ? () => calls.push(k) : t[k]),
    })
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(recording), ...options })
    renderer.setSize(10, 10)
    let ready = 0
    renderer.onReady = () => ready++
    const scene = new Scene()
    scene.add(new Mesh({ geometry: box(), outline: 'red' }))
    renderer.render(scene, camera())
    await vi.waitFor(() => expect(ready).toBeGreaterThan(0))
    renderer.render(scene, camera())
    return { renderer, scene, sources, calls, count }
  }

  it('are drawn once the passes have loaded: a mask, widened, then drawn over the scene - smooth by default', async () => {
    const { sources, calls, count } = await drawOutlined()
    // the mask drawn multisampled with its coverage beside it, both resolved, then measured from its edge
    expect(sources.some((s) => s.includes('out vec4 fragCoverage'))).toBe(true)
    expect(sources.some((s) => s.includes('uniform sampler2D uNearest'))).toBe(true)
    expect(calls.filter((c) => c === 'renderbufferStorageMultisample')).toHaveLength(2)
    expect(calls.filter((c) => c === 'blitFramebuffer')).toHaveLength(2)
    expect(count('renderbuffer')).toBe(2)
  })

  it('outlineAntialias: false draws them in hard pixel steps, as before', async () => {
    const { sources, calls, count } = await drawOutlined({ outlineAntialias: false })
    expect(sources.some((s) => s.includes('fragColor = widened(vUv)'))).toBe(true)
    expect(sources.some((s) => s.includes('fragCoverage'))).toBe(false)
    expect([calls.length, count('renderbuffer')]).toEqual([0, 0])
  })

  it('outlineAntialias follows antialias unless given, and can change between frames', async () => {
    const make = (options) => new WebGLRenderer({ canvas: fakeCanvas(fakeGL().gl), ...options }).outlineAntialias
    expect([make({}), make({ antialias: false }), make({ antialias: false, outlineAntialias: true }), make({ outlineAntialias: false })])
      .toEqual([true, false, true, false])
    expect(() => make({ outlineAntiAlias: false })).toThrow("did you mean 'outlineAntialias'")
    // switching remakes the outline's buffers: the multisampled ones go, and come back
    const { renderer, scene, count } = await drawOutlined()
    renderer.outlineAntialias = false
    renderer.render(scene, camera())
    expect(count('renderbuffer')).toBe(0)
    renderer.outlineAntialias = true
    renderer.render(scene, camera())
    expect(count('renderbuffer')).toBe(2)
  })
})

describe('highlight set after construction', () => {
  it('is a colour however it is given, so it never reaches a shader as a string', () => {
    const chair = new Group()
    chair.highlight = '#dbe9ff'
    expect(chair.highlight?.getHex()).toBe(0xdbe9ff)
    chair.highlight = null
    expect(chair.highlight).toBe(null)
    expect(() => { chair.highlight = 'notacolour' }).toThrow('notacolour')
  })
})
