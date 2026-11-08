// The frame's plumbing: render targets made from one description and kept in a pool, a frame drawn
// into a target of its own rather than the canvas, and a frame drawn in linear light - the post
// chain in its fixed order, bloom, the encode to sRGB, FXAA. Watched through the GL fake's draw log.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Mesh, PerspectiveCamera, Scene, box } from '../src/index.js'
import { collect } from '../src/frame.js'
import { WebGLRenderer } from '../src/webgl/WebGLRenderer.js'
import { TargetPool, makeTarget } from '../src/webgl/targets.js'
import { fakeCanvas, fakeGL } from './fakes.js'

afterEach(() => vi.restoreAllMocks())
const camera = () => new PerspectiveCamera({ position: [0, 0, 10], target: [0, 0, 0], aspect: 1 })
const scene = () => {
  const s = new Scene()
  s.add(new Mesh({ geometry: box(1) }))
  s.updateWorldTree()
  return s
}
/** A renderer whose lazy code has loaded, for the options given. */
async function loaded(options, gl) {
  const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl), ...options })
  renderer.setSize(64, 48)
  let ready = 0
  renderer.onReady = () => ready++
  const s = scene()
  renderer.render(s, camera())
  await vi.waitFor(() => expect(ready).toBeGreaterThan(0))
  renderer.render(s, camera())
  return { renderer, s }
}
/** The defines of the program a draw used. @param {any} program */
const definesOf = (program) => program.shaders.flatMap((/** @type {any} */ sh) => [...sh.source.matchAll(/#define (\w+)/g)].map((m) => m[1]))

describe('render targets', () => {
  it('are made from a description - colour formats, depth, multisampling - and freed whole', () => {
    const { gl, count } = fakeGL()
    const plain = makeTarget(gl, { width: 8, height: 8 })
    expect([plain.texture !== null, plain.renderbuffers.length, plain.depthTexture]).toEqual([true, 0, null])
    const deep = makeTarget(gl, { width: 8, height: 8, color: null, depth: 'texture' })
    expect([deep.texture, deep.depthTexture !== null]).toEqual([null, true])
    // multisampled: buffers, not textures - read by resolving into another target
    const msaa = makeTarget(gl, { width: 8, height: 8, color: [gl.RGBA8, gl.R8], depth: 'stencil', samples: 4 })
    expect([msaa.textures.length, msaa.renderbuffers.length]).toEqual([0, 3])
    expect([count('framebuffer'), count('texture'), count('renderbuffer')]).toEqual([3, 2, 3])
  })

  it('a pool hands back the same target for a name and description, and frees what frames stop using', () => {
    const { gl, count } = fakeGL()
    const pool = new TargetPool(gl)
    const a = pool.get('bloom-0', { width: 32, height: 32 })
    expect(pool.get('bloom-0', { width: 32, height: 32 })).toBe(a)
    // another size, or another name, is another target
    expect(pool.get('bloom-0', { width: 16, height: 16 })).not.toBe(a)
    expect(pool.get('bloom-1', { width: 32, height: 32 })).not.toBe(a)
    expect(pool.size).toBe(3)
    // a target used every frame stays; the rest go once 30 frames have passed since they were last
    // used (in the first of these) - 30 per view sharing the context
    for (let i = 0; i < 31; i++) {
      pool.get('bloom-0', { width: 32, height: 32 })
      pool.sweep(1)
    }
    expect(pool.size).toBe(1)
    expect(count('framebuffer')).toBe(1)
    pool.dispose()
    expect([pool.size, count('framebuffer'), count('texture')]).toEqual([0, 0, 0])
  })
})

describe('a frame drawn into a target', () => {
  it('draws everything there - nothing on the canvas - at the target\'s size', () => {
    const { gl, drawLog } = fakeGL()
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl) })
    renderer.setSize(64, 48)
    const target = makeTarget(gl, { width: 20, height: 10, depth: 'buffer' })
    const s = scene()
    renderer.renderFrame(collect(s, camera()), { target })
    expect(drawLog.length).toBeGreaterThan(0)
    expect(drawLog.every((d) => d.framebuffer === target.framebuffer)).toBe(true)
    expect(drawLog.map((d) => d.viewport)).toEqual([[0, 0, 20, 10]])
  })

  it('with a post chain too: its last step draws into the target', async () => {
    const { gl, drawLog } = fakeGL()
    const { renderer, s } = await loaded({ fxaa: true }, gl)
    const target = makeTarget(gl, { width: 20, height: 10 })
    drawLog.length = 0
    renderer.renderFrame(collect(s, camera()), { target })
    expect(drawLog.some((d) => d.framebuffer === null)).toBe(false)
    expect([drawLog.at(-1)?.framebuffer, drawLog.at(-1)?.viewport]).toEqual([target.framebuffer, [0, 0, 20, 10]])
  })
})

describe('a frame drawn in linear light', () => {
  /** A fake that can render to float targets, as nearly every WebGL 2 device can. */
  const floatGL = () => {
    const fake = fakeGL()
    const gl = new Proxy(fake.gl, {
      get: (t, k) => (k === 'getExtension' ? (/** @type {string} */ n) => (n === 'EXT_color_buffer_float' ? {} : t.getExtension(n)) : t[k]),
    })
    return { ...fake, gl }
  }

  it('draws the scene in linear light into a float picture, encoded to sRGB by one last step', () => {
    const { gl, drawLog } = floatGL()
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl) })
    renderer.setSize(64, 48)
    renderer.renderFrame(collect(scene(), camera()), { linear: true })
    const [box3, encode] = drawLog
    expect(drawLog).toHaveLength(2)
    expect(definesOf(box3.program)).toContain('LINEAR_OUTPUT')
    expect(box3.framebuffer).not.toBeNull()
    expect([encode.call, encode.framebuffer]).toEqual(['drawArrays', null])
    expect(encode.program.shaders[1].source).toContain('linearToSrgb(c.rgb / c.a) * c.a')
  })

  it('runs its chain in order - bloom in linear light, the encode, then FXAA onto the canvas', async () => {
    const { gl, drawLog } = floatGL()
    const { renderer, s } = await loaded({ bloom: true, fxaa: true }, gl)
    drawLog.length = 0
    renderer.renderFrame(collect(s, camera()), { linear: true })
    // the full-size full-screen draws: bloom's composite, the encode, FXAA
    const steps = drawLog.filter((d) => d.call === 'drawArrays' && d.viewport[2] === 64)
    const kinds = steps.map((d) => {
      const fragment = d.program.shaders[1].source
      return fragment.includes('uBloom') ? 'bloom' : fragment.includes('linearToSrgb(c.rgb / c.a)') ? 'encode' : fragment.includes('uTexel') && fragment.includes('luma') ? 'fxaa' : 'other'
    })
    expect(kinds).toEqual(['bloom', 'encode', 'fxaa'])
    // bloom reads and writes linear light; only the last draws on the canvas
    expect(definesOf(steps[0].program)).toContain('LINEAR_INPUT')
    expect(steps.map((d) => d.framebuffer === null)).toEqual([false, false, true])
  })

  it('without float targets, is drawn as any other frame', () => {
    const { gl, drawLog } = fakeGL()
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl) })
    renderer.setSize(64, 48)
    renderer.renderFrame(collect(scene(), camera()), { linear: true })
    expect(drawLog).toHaveLength(1)
    expect(definesOf(drawLog[0].program)).not.toContain('LINEAR_OUTPUT')
    expect(drawLog[0].framebuffer).toBeNull()
  })
})
