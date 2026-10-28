import { afterEach, describe, expect, it, vi } from 'vitest'
import { Material, Mesh, PerspectiveCamera, Points, Scene, Texture, box, sphere } from '../src/index.js'
import { WebGLRenderer, bloomSettings } from '../src/webgl/WebGLRenderer.js'
import { fakeCanvas, fakeGL } from './fakes.js'

const camera = () => new PerspectiveCamera({ position: [0, 0, 10], target: [0, 0, 0], aspect: 1 })
const pixels = () => new Texture({ image: { data: new Uint8Array([255, 0, 0, 255]), width: 1, height: 1 } })

describe('drawing points', () => {
  it("draws each vertex once - not one per index - when the geometry is a mesh's, indexed", () => {
    const { gl, draws } = fakeGL()
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl) })
    renderer.setSize(10, 10)
    const scene = new Scene()
    const geometry = box(1)
    scene.add(new Points({ geometry, material: { size: 4, sizeAttenuation: false } }))
    renderer.render(scene, camera())
    // 24 vertices, 36 indices: anything past the 24th would be read as the origin
    expect(draws.sizes).toEqual([geometry.vertexCount])
    expect(geometry.indices?.length).toBeGreaterThan(geometry.vertexCount)
  })
})

describe('GPU resources', () => {
  afterEach(() => {
    delete globalThis.document
    vi.useRealTimers()
  })

  it('a renderer with its own context frees everything on dispose', () => {
    vi.useFakeTimers()
    const { gl, live, lost, count } = fakeGL()
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl) })
    renderer.setSize(10, 10)
    const scene = new Scene()
    scene.add(new Mesh({ geometry: box(1), material: new Material({ map: pixels() }) }))
    renderer.render(scene, camera())
    expect(live.size).toBeGreaterThan(0)
    renderer.dispose(scene)
    // the scene's copies and the programs go at once; the context itself a moment later
    expect([count('vertex array'), count('program'), lost.count]).toEqual([0, 0, 0])
    vi.runAllTimers()
    expect([lost.count, live.size]).toEqual([1, 0])
  })

  it('bloom draws into buffers of its own once its code has loaded, remade at a new size and freed on dispose', async () => {
    const { gl, count } = fakeGL()
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl), bloom: true })
    renderer.setSize(64, 64)
    let ready = 0
    renderer.onReady = () => ready++
    const scene = new Scene()
    scene.add(new Mesh({ geometry: box(1) }))
    renderer.render(scene, camera())
    // drawn plainly while its code loads
    expect(count('framebuffer')).toBe(0)
    await vi.waitFor(() => expect(ready).toBe(1))
    renderer.render(scene, camera())
    // the multisampled buffer (colour and depth), the resolved picture, and levels of 32, 16 and 8
    expect([count('framebuffer'), count('renderbuffer')]).toEqual([5, 2])
    renderer.setSize(128, 128)
    renderer.render(scene, camera())
    // the old ones go; a level more at this size
    expect([count('framebuffer'), count('renderbuffer')]).toEqual([6, 2])
    renderer.bloom = false
    renderer.render(scene, camera())
    renderer.dispose(scene)
    expect([count('framebuffer'), count('renderbuffer')]).toEqual([0, 0])
  })

  it('a new renderer on the canvas straight after a dispose keeps its context (React StrictMode)', () => {
    vi.useFakeTimers()
    const { gl, lost, draws } = fakeGL()
    const canvas = fakeCanvas(gl)
    const first = new WebGLRenderer({ canvas })
    first.setSize(10, 10)
    const a = new Scene()
    a.add(new Mesh({ geometry: box(1) }))
    first.render(a, camera())
    first.dispose(a)
    const second = new WebGLRenderer({ canvas })
    second.setSize(10, 10)
    const b = new Scene()
    b.add(new Mesh({ geometry: sphere(1) }))
    vi.runAllTimers()
    const before = draws.count
    second.render(b, camera())
    expect([lost.count, draws.count > before]).toEqual([0, true])
  })

  it('a new renderer on a canvas whose context was let go of and lost asks for it back', () => {
    vi.useFakeTimers()
    const { gl, lost } = fakeGL()
    const canvas = fakeCanvas(gl)
    const first = new WebGLRenderer({ canvas })
    first.dispose(new Scene())
    vi.runAllTimers()
    expect(lost.count).toBe(1)
    new WebGLRenderer({ canvas })
    expect([lost.restores, gl.isContextLost()]).toEqual([1, false])
  })

  it('views sharing a context free only what no other view draws, and the last one frees the rest', () => {
    const { gl, lost, count } = fakeGL()
    // the shared context makes its own canvas
    globalThis.document = { createElement: () => fakeCanvas(gl) }
    const a = new WebGLRenderer({ canvas: fakeCanvas(null), shared: true })
    const b = new WebGLRenderer({ canvas: fakeCanvas(null), shared: true })
    expect(a.gl).toBe(b.gl)
    for (const r of [a, b]) r.setSize(10, 10)

    const common = sphere(), texture = pixels()
    const sceneA = new Scene(), sceneB = new Scene()
    sceneA.add(new Mesh({ geometry: box(1), material: new Material({ map: texture }) }), new Mesh({ geometry: common }))
    sceneB.add(new Mesh({ geometry: box(2), material: new Material({ map: texture }) }), new Mesh({ geometry: common }))
    a.render(sceneA, camera())
    b.render(sceneB, camera())
    // three geometries, one texture between them
    expect([count('vertex array'), count('texture')]).toEqual([3, 1])

    a.dispose(sceneA)
    // A's own box goes; the shared sphere and texture stay for B
    expect([count('vertex array'), count('texture'), lost.count]).toEqual([2, 1, 0])
    b.render(sceneB, camera())
    expect(count('vertex array')).toBe(2)

    b.dispose(sceneB)
    expect([lost.count, count('vertex array'), count('program')]).toEqual([1, 0, 0])
  })

  it('leaves out what is still compiling, draws it once compiled, and waits when asked', () => {
    const { gl, compiled, draws } = fakeGL({ parallel: true })
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl) })
    renderer.setSize(10, 10)
    let ready = 0
    renderer.onReady = () => ready++
    const scene = new Scene()
    scene.add(new Mesh({ geometry: box(1) }))
    renderer.render(scene, camera())
    expect([renderer.info.compiling, draws.count]).toEqual([1, 0])
    // a frame that must be complete - an image export - waits instead
    renderer.renderFrame(renderer.render(scene, camera()), { wait: true })
    expect([renderer.info.compiling, draws.count]).toEqual([0, 1])

    // a new kind of program starts compiling; once done it draws, without waiting
    scene.add(new Mesh({ geometry: sphere(), material: { unlit: true } }))
    renderer.render(scene, camera())
    expect(renderer.info.compiling).toBe(1)
    compiled.done = true
    const before = draws.count
    renderer.render(scene, camera())
    expect([renderer.info.compiling, draws.count - before]).toEqual([0, 2])
    expect(ready).toBe(0)
  })
})

describe('bloom settings', () => {
  it('takes true, false or numbers, with hints for the names people reach for', () => {
    expect(bloomSettings('View', true)).toEqual({ strength: 1, radius: 0.6, threshold: 0.6 })
    expect([bloomSettings('View', false), bloomSettings('View', null), bloomSettings('View', undefined)]).toEqual([null, null, null])
    expect(bloomSettings('View', { strength: 2 })).toEqual({ strength: 2, radius: 0.6, threshold: 0.6 })
    expect(() => bloomSettings('View', /** @type {any} */ ({ intensity: 2 }))).toThrow("use 'strength'")
    expect(() => bloomSettings('View', /** @type {any} */ ('on'))).toThrow('bloom is true, false or { strength, radius, threshold }')
    expect(() => bloomSettings('View', /** @type {any} */ ({ radius: 'wide' }))).toThrow('radius')
  })
})
