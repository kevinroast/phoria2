// The product viewer's passes - ambient occlusion, the ground shadow and FXAA: their options, what
// casts a ground shadow, which draws take the occlusion, their buffers made once their code has
// loaded and freed when no view wants them, and kept per size for views sharing a context.
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { HemisphereLight, Lines, Mesh, PerspectiveCamera, Points, Scene, View, box, plane, sphere } from '../src/index.js'
import { collect } from '../src/frame.js'
import { WebGLRenderer, ambientOcclusionSettings, groundShadowSettings } from '../src/webgl/WebGLRenderer.js'
import { fakeCanvas, fakeGL, fakePage } from './fakes.js'

const camera = () => new PerspectiveCamera({ position: [0, 3, 10], target: [0, 0, 0], aspect: 1 })

/** A fake context that also counts the framebuffers made. */
function watchedGL() {
  const fake = fakeGL()
  const made = { framebuffers: 0 }
  const gl = new Proxy(fake.gl, {
    get: (target, key) => key === 'createFramebuffer' ? () => { made.framebuffers++; return target.createFramebuffer() } : target[key],
  })
  return { ...fake, gl, made }
}

/** The defines a program was compiled with, for each program whose fragment source has `marker`. */
const definesOf = (sources, marker) => sources.filter((s) => s.includes(marker)).map((s) => [...s.matchAll(/#define (\w+)/g)].map((m) => m[1]))

/** A renderer once the effects' code has loaded, and the scene drawn with them. Each of these tests
 * loads two chunks - the passes and the effects - side by side, and either can arrive first, so each
 * waits for both before drawing again (on CI the effects chunk can be the slower one). */
async function withEffects(options, scene, gl) {
  const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl), ...options })
  renderer.setSize(64, 64)
  let ready = 0
  renderer.onReady = () => ready++
  renderer.render(scene, camera())
  await vi.waitFor(() => expect(ready).toBeGreaterThanOrEqual(2))
  renderer.render(scene, camera())
  return renderer
}

describe('ambientOcclusion and groundShadow settings', () => {
  it('true for the defaults, false or null for none, numbers checked and names hinted', () => {
    expect(ambientOcclusionSettings('View', true)).toEqual({ strength: 1, radius: null })
    expect(groundShadowSettings('View', true)).toEqual({ opacity: 0.6, softness: 0.5, height: null, y: null, size: null })
    expect([ambientOcclusionSettings('View', false), groundShadowSettings('View', null), groundShadowSettings('View', undefined)]).toEqual([null, null, null])
    expect(groundShadowSettings('View', { softness: 1, y: -2 })).toMatchObject({ softness: 1, y: -2, opacity: 0.6 })
    expect(() => ambientOcclusionSettings('View', /** @type {any} */ ({ intensity: 2 }))).toThrow("use 'strength'")
    expect(() => groundShadowSettings('View', /** @type {any} */ ({ blur: 1 }))).toThrow("use 'softness'")
    expect(() => groundShadowSettings('View', { opacity: 2 })).toThrow('opacity')
    expect(() => ambientOcclusionSettings('View', /** @type {any} */ ('on'))).toThrow('ambientOcclusion is true, false or { strength, radius }')
  })
})

describe("a frame's solids - what casts a ground shadow", () => {
  it('opaque meshes, seen or not, but not floors that only receive shadows, see-through things, points or lines', () => {
    const scene = new Scene()
    const solid = scene.add(new Mesh({ geometry: box(1) }))
    scene.add(new Mesh({ geometry: plane(10), receiveShadow: true }))
    const castingFloor = scene.add(new Mesh({ geometry: plane(10), receiveShadow: true, castShadow: true }))
    scene.add(new Mesh({ geometry: box(1), material: { transparent: true, opacity: 0.5 } }))
    scene.add(new Points({ geometry: box(1) }))
    scene.add(new Lines({ geometry: box(1) }))
    // behind the camera: not drawn, but it still casts on the ground in view
    const behind = scene.add(new Mesh({ geometry: box(1), position: [0, 0, 30] }))
    scene.updateWorldTree()
    const frame = collect(scene, camera())
    expect(frame.solids.map(([node]) => node)).toEqual([solid, castingFloor, behind])
    expect(frame.opaque.some((item) => item.node === behind)).toBe(false)
  })
})

describe('the effects in a frame', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete globalThis.document
  })

  it('ambient occlusion dims only lit solids: not see-through, unlit, points or lines', async () => {
    const { gl, sources } = watchedGL()
    const scene = new Scene()
    scene.add(new Mesh({ geometry: box(1), material: { color: '#ff0000' } }))
    scene.add(new Mesh({ geometry: sphere(0.5), material: { transparent: true, opacity: 0.5 }, position: [2, 0, 0] }))
    scene.add(new Mesh({ geometry: box(1), material: { unlit: true }, position: [-2, 0, 0] }))
    scene.add(new Points({ geometry: box(1) }))
    await withEffects({ ambientOcclusion: true }, scene, gl)
    const occluded = definesOf(sources, 'uSsao').filter((d) => d.includes('SSAO'))
    // the one lit, opaque mesh's program - and not with depth, as this context can't render to floats
    expect(occluded).toHaveLength(1)
    expect(occluded[0]).toContain('LIT')
    expect(occluded[0]).not.toContain('SSAO_DEPTH')
    // the solids' prepass writes their normals, culled as the picture culls them
    expect(definesOf(sources, 'uView;').some((d) => d.includes('NORMALS'))).toBe(true)
  })

  it('loads its code once, draws into buffers of its own, and frees them once frames go by without them', async () => {
    const { gl, count } = watchedGL()
    const scene = new Scene()
    scene.add(new Mesh({ geometry: box(1) }))
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl), ambientOcclusion: true, groundShadow: true, fxaa: true })
    renderer.setSize(64, 64)
    let ready = 0
    renderer.onReady = () => ready++
    renderer.render(scene, camera())
    // drawn plainly while the code loads
    expect(count('framebuffer')).toBe(0)
    await vi.waitFor(() => expect(ready).toBeGreaterThanOrEqual(2))
    renderer.render(scene, camera())
    // occlusion: normals (with depth), occlusion, blurred; ground: depth, darkness, blurred; the
    // scene's picture for FXAA, and the multisampled buffer it is drawn into
    expect(count('framebuffer')).toBe(8)
    renderer.ambientOcclusion = false
    renderer.groundShadow = false
    renderer.fxaa = false
    renderer.render(scene, camera())
    // kept a while - an effect turned back on finds them - then freed
    expect(count('framebuffer')).toBe(8)
    for (let i = 0; i < 31; i++) renderer.render(scene, camera())
    expect(count('framebuffer')).toBe(0)
    renderer.dispose(scene)
  })

  it('with bloom, FXAA smooths what bloom draws: one scene picture, bloom into a picture between, FXAA onto the canvas', async () => {
    const { gl, count, drawLog } = watchedGL()
    const scene = new Scene()
    scene.add(new Mesh({ geometry: box(1) }))
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl), bloom: true, fxaa: true })
    renderer.setSize(64, 64)
    let ready = 0
    renderer.onReady = () => ready++
    renderer.render(scene, camera())
    await vi.waitFor(() => expect(ready).toBe(2))
    renderer.render(scene, camera())
    // the scene (multisampled, and its picture), bloom's three levels, and the picture between bloom and FXAA
    expect([count('framebuffer'), count('renderbuffer')]).toEqual([6, 2])
    drawLog.length = 0
    renderer.render(scene, camera())
    // bloom's last draw - its composite - into the picture between; FXAA's last of all, onto the canvas
    const full = drawLog.filter((d) => d.call === 'drawArrays' && d.viewport[2] === 64)
    expect(full.at(-1)?.framebuffer).toBeNull()
    expect(full.at(-2)?.framebuffer).not.toBeNull()
    renderer.dispose(scene)
  })

  it('keeps buffers for each size of view sharing a context, rather than remaking them every frame', async () => {
    const { gl, made } = watchedGL()
    // the shared context makes its own canvas
    globalThis.document = /** @type {any} */ ({ createElement: () => fakeCanvas(gl) })
    const scene = new Scene()
    scene.add(new Mesh({ geometry: box(1) }))
    const [big, small] = [64, 32].map((size) => {
      const r = new WebGLRenderer({ canvas: fakeCanvas(null), shared: true, ambientOcclusion: true, fxaa: true })
      r.setSize(size, size)
      return r
    })
    expect(big.gl).toBe(small.gl)
    let ready = 0
    big.onReady = () => ready++
    big.render(scene, camera())
    await vi.waitFor(() => expect(ready).toBeGreaterThanOrEqual(2))
    big.render(scene, camera())
    small.render(scene, camera())
    const before = made.framebuffers
    expect(before).toBeGreaterThan(0)
    for (let i = 0; i < 3; i++) {
      big.render(scene, camera())
      small.render(scene, camera())
    }
    expect(made.framebuffers).toBe(before)
    big.dispose(scene)
    small.dispose(scene)
  })

  it('the ground shadow is drawn once the solids are, not while they compile', async () => {
    const fake = fakeGL({ parallel: true })
    const scene = new Scene()
    scene.add(new Mesh({ geometry: box(1) }))
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(fake.gl), groundShadow: true })
    renderer.setSize(64, 64)
    let ready = 0
    renderer.onReady = () => ready++
    renderer.render(scene, camera())
    await vi.waitFor(() => expect(ready).toBeGreaterThanOrEqual(2))
    // the box's program still compiling: the ground's square isn't drawn (a four-vertex strip)
    fake.draws.sizes.length = 0
    renderer.render(scene, camera())
    expect(renderer.info.compiling).toBeGreaterThan(0)
    expect(fake.draws.sizes).not.toContain(4)
    fake.compiled.done = true
    fake.draws.sizes.length = 0
    renderer.render(scene, camera())
    expect(fake.draws.sizes).toContain(4)
    renderer.dispose(scene)
  })
})

describe('explain()', () => {
  const page = fakePage()
  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 50))
    page.restore()
  })

  it('names the effects that are on, with their settings - and says when one has nothing to work on', async () => {
    const view = new View({ canvas: page.canvas(), autoLight: false, ambientOcclusion: { strength: 2 }, groundShadow: true, fxaa: true })
    view.scene.add(new Mesh({ geometry: plane(6), receiveShadow: true }))
    const text = await view.explain()
    expect(text).toContain('Effects: ambient occlusion (strength 2, radius auto), ground shadow under 0 solids (opacity 0.6, softness 0.5, height auto, y auto, size auto), FXAA')
    expect(text).toContain('groundShadow is on but nothing casts it')
    expect(text).toContain('ambientOcclusion is on but there is no light from all round')
    // with something to cast, and light from all round, no warnings about them
    view.scene.add(new Mesh({ geometry: box(1) }), new HemisphereLight())
    const after = await view.explain()
    expect(after).toContain('ground shadow under 1 solid ')
    expect(after).not.toContain('groundShadow is on')
    expect(after).not.toContain('ambientOcclusion is on')
    view.dispose()
  })
})
