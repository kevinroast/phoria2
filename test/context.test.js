import { afterEach, describe, expect, it, vi } from 'vitest'
import { Material, Mesh, PerspectiveCamera, Scene, Texture, box, sphere } from '../src/index.js'
import { WebGLRenderer, bloomSettings } from '../src/webgl/WebGLRenderer.js'

// A stand-in WebGL 2 context that does nothing but count the GPU objects made and freed, and the
// draws, so leaks show without a GPU. Constants are stable made-up numbers; every other call is a
// no-op. With `parallel`, it offers background shader compiling, finished when compiled.done is set.
function fakeGL({ parallel = false } = {}) {
  const compiled = { done: false }
  const draws = { count: 0 }
  const live = new Set()
  const lost = { count: 0, now: false, restores: 0 }
  const consts = new Map()
  const constant = (name) => {
    if (!consts.has(name)) consts.set(name, 1000 + consts.size)
    return consts.get(name)
  }
  const make = (kind) => () => {
    const o = { kind }
    live.add(o)
    return o
  }
  const free = (o) => live.delete(o)
  const gl = {
    createBuffer: make('buffer'), createTexture: make('texture'), createVertexArray: make('vertex array'),
    createFramebuffer: make('framebuffer'), createRenderbuffer: make('renderbuffer'), createProgram: make('program'),
    createShader: () => ({}),
    deleteBuffer: free, deleteTexture: free, deleteVertexArray: free, deleteFramebuffer: free, deleteRenderbuffer: free,
    deleteProgram: free, deleteShader() {},
    getShaderParameter: () => true,
    // 0x91b1 is COMPLETION_STATUS_KHR: is a program compiled yet?
    getProgramParameter: (_p, name) => (name === constant('ACTIVE_UNIFORMS') ? 0 : name === 0x91b1 ? compiled.done : true),
    getExtension: (name) => (name === 'WEBGL_lose_context' ? { loseContext: () => { lost.count++; lost.now = true; live.clear() }, restoreContext: () => { lost.restores++; lost.now = false } }
      : name === 'KHR_parallel_shader_compile' && parallel ? {} : null),
    drawElements: () => draws.count++,
    drawArrays: () => draws.count++,
    isContextLost: () => lost.now,
  }
  const proxy = new Proxy(gl, {
    get: (target, key) => (key in target ? target[key] : typeof key === 'string' && /^[A-Z0-9_]+$/.test(key) ? constant(key) : () => {}),
  })
  const count = (kind) => [...live].filter((o) => o.kind === kind).length
  return { gl: proxy, live, lost, count, compiled, draws }
}

const fakeCanvas = (gl) => ({
  width: 0, height: 0,
  getContext: (type) => (type === 'webgl2' ? gl : type === '2d' ? { drawImage() {}, globalCompositeOperation: '' } : null),
  addEventListener() {}, removeEventListener() {},
})

const camera = () => new PerspectiveCamera({ position: [0, 0, 10], target: [0, 0, 0], aspect: 1 })
const pixels = () => new Texture({ image: { data: new Uint8Array([255, 0, 0, 255]), width: 1, height: 1 } })

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
