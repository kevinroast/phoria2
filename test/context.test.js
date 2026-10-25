import { afterEach, describe, expect, it } from 'vitest'
import { Material, Mesh, PerspectiveCamera, Scene, Texture, box, sphere } from '../src/index.js'
import { WebGLRenderer } from '../src/webgl/WebGLRenderer.js'

// A stand-in WebGL 2 context that does nothing but count the GPU objects made and freed, and the
// draws, so leaks show without a GPU. Constants are stable made-up numbers; every other call is a
// no-op. With `parallel`, it offers background shader compiling, finished when compiled.done is set.
function fakeGL({ parallel = false } = {}) {
  const compiled = { done: false }
  const draws = { count: 0 }
  const live = new Set()
  const lost = { count: 0 }
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
    getExtension: (name) => (name === 'WEBGL_lose_context' ? { loseContext: () => { lost.count++; live.clear() } }
      : name === 'KHR_parallel_shader_compile' && parallel ? {} : null),
    drawElements: () => draws.count++,
    drawArrays: () => draws.count++,
    isContextLost: () => false,
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
  })

  it('a renderer with its own context frees everything on dispose', () => {
    const { gl, live, lost } = fakeGL()
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl) })
    renderer.setSize(10, 10)
    const scene = new Scene()
    scene.add(new Mesh({ geometry: box(1), material: new Material({ map: pixels() }) }))
    renderer.render(scene, camera())
    expect(live.size).toBeGreaterThan(0)
    renderer.dispose(scene)
    expect([lost.count, live.size]).toEqual([1, 0])
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
