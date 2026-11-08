// Render textures: a camera's picture as a material's map - drawn before the frame that shows it,
// into its own target, plainly and without whatever shows it; when it is due; read the right way up;
// redrawing the view when its camera moves; and an off-screen frame with no labels or interaction.
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { Label, Material, Mesh, PerspectiveCamera, RenderTexture, Scene, View, box, plane } from '../src/index.js'
import { collect } from '../src/frame.js'
import { ChangeWatch } from '../src/watch.js'
import { WebGLRenderer } from '../src/webgl/WebGLRenderer.js'
import { fakeCanvas, fakeGL, fakePage } from './fakes.js'

afterEach(() => vi.restoreAllMocks())
const camera = () => new PerspectiveCamera({ position: [0, 0, 10], target: [0, 0, 0], aspect: 1 })
/** A scene with a box, and a screen showing what a camera of its own sees. */
function withScreen(options = {}) {
  const scene = new Scene()
  scene.add(new Mesh({ name: 'box', geometry: box(1) }))
  const eye = scene.add(new PerspectiveCamera({ position: [0, 0, 5], target: [0, 0, 0] }))
  const feed = new RenderTexture({ camera: eye, width: 64, height: 32, ...options })
  const screen = scene.add(new Mesh({ name: 'screen', geometry: plane(2), rotation: [Math.PI / 2, 0, 0], position: [3, 0, 0], material: { map: feed, unlit: true } }))
  scene.updateWorldTree()
  return { scene, eye, feed, screen }
}
const definesOf = (program) => program.shaders.flatMap((/** @type {any} */ sh) => [...sh.source.matchAll(/#define (\w+)/g)].map((m) => m[1]))

describe('RenderTexture', () => {
  it('is a texture for any map, drawn from a camera, its options checked', () => {
    const eye = camera()
    const feed = new RenderTexture({ camera: eye, width: 320, height: 200, update: 4 })
    expect([feed.width, feed.height, feed.update, feed.wrap, feed.mipmaps]).toEqual([320, 200, 4, 'clamp', true])
    expect(new Material({ map: feed }).map).toBe(feed)
    // it can't be written as JSON - its camera is a live object
    expect(feed.toJSON()).toBeNull()
    expect(() => new RenderTexture(/** @type {any} */ ({ width: 64 }))).toThrow("'camera' must be a camera")
    expect(() => new RenderTexture({ camera: eye, width: 0 })).toThrow("'width' must be a whole number of pixels")
    expect(() => new RenderTexture({ camera: eye, update: 0 })).toThrow("'update' as a number")
    expect(() => new RenderTexture({ camera: eye, update: /** @type {any} */ ('sometimes') })).toThrow('update')
    expect(() => new RenderTexture(/** @type {any} */ ({ camera: eye, size: 256 }))).toThrow("use 'width' and 'height'")
    expect(() => new RenderTexture(/** @type {any} */ ({ camera: eye, url: 'a.png' }))).toThrow('for an image use Texture')
    expect(() => new RenderTexture(/** @type {any} */ ({ camera: eye, scene: {} }))).toThrow("'scene' must be a Scene")
  })
})

describe('an off-screen frame', () => {
  it('has what is drawn, and none of what the view shows on top - labels, overlays, outlines, interaction', () => {
    const scene = new Scene()
    const m = scene.add(new Mesh({ geometry: box(1), outline: '#ff0000', tooltip: () => 'a box' }))
    m.overlay = /** @type {any} */ ({})
    scene.add(new Label({ text: 'hello' }))
    scene.updateWorldTree()
    const shown = collect(scene, camera())
    expect([shown.labels.length, shown.outlines.length, shown.overlays.length, shown.interactive]).toEqual([1, 1, 1, true])
    const off = collect(scene, camera(), { display: false })
    expect([off.labels.length, off.outlines.length, off.overlays.length, off.interactive, off.opaque.length]).toEqual([0, 0, 0, false, 1])
  })
})

describe('drawing render textures', () => {
  it('draws one first, from its camera, into its own target - in linear light, for its sRGB texture - without what shows it', () => {
    const { gl, drawLog } = fakeGL()
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl) })
    renderer.setSize(40, 30)
    const { scene } = withScreen()
    renderer.render(scene, camera())
    // the texture's frame: the box only, into its own target at its size; then the view's: the box and the screen
    const [feed, ...view] = drawLog
    expect([feed.viewport, feed.framebuffer !== null]).toEqual([[0, 0, 64, 32], true])
    expect(definesOf(feed.program)).toContain('LINEAR_OUTPUT')
    expect(view.map((d) => [d.framebuffer, d.viewport])).toEqual([[null, [0, 0, 40, 30]], [null, [0, 0, 40, 30]]])
    expect(definesOf(view[0].program)).not.toContain('LINEAR_OUTPUT')
    expect(renderer.info.renderTextures).toBe(1)
    // read the right way up: its rows run from the picture's bottom, so v is turned over
    const screen = view.find((d) => 'uMapUv' in d.program.values)
    expect(screen?.program.values.uMapUv.map((/** @type {number} */ v) => v + 0)).toEqual([1, 0, 0, 0, -1, 0, 0, 1, 1])
  })

  it('when it is due: each frame, every nth, or once and after needsUpdate()', () => {
    const { gl } = fakeGL()
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl) })
    renderer.setSize(40, 30)
    const counts = (/** @type {any} */ update) => {
      const { scene, feed } = withScreen({ update })
      const drawn = []
      for (let i = 0; i < 7; i++) {
        if (update === 'manual' && i === 4) feed.needsUpdate()
        renderer.render(scene, camera())
        drawn.push(renderer.info.renderTextures)
      }
      return drawn.join('')
    }
    expect(counts('frame')).toBe('1111111')
    expect(counts(3)).toBe('1001001')
    expect(counts('manual')).toBe('1000100')
  })

  it('is made again at a new size', () => {
    const { gl, count } = fakeGL()
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl) })
    renderer.setSize(40, 30)
    const { scene, feed } = withScreen()
    renderer.render(scene, camera())
    const before = count('texture')
    feed.width = 128
    renderer.render(scene, camera())
    expect(count('texture')).toBe(before)
    feed.dispose()
    expect(count('texture')).toBe(before - 1)
  })
})

describe('the view', () => {
  const page = fakePage()
  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 50))
    page.restore()
  })

  it('draws again when a render texture\'s camera moves, and explain() names its render textures', async () => {
    const { scene, eye } = withScreen({ update: 2 })
    const watch = new ChangeWatch()
    const viewer = camera()
    watch.changed(scene, viewer)
    expect(watch.changed(scene, viewer)).toBe(false)
    eye.position.set(1, 0, 5)
    expect(watch.changed(scene, viewer)).toBe(true)

    const view = new View({ canvas: page.canvas(), scene })
    expect(await view.explain()).toContain('Render textures: 64 x 32 from a perspective camera, drawn every 2 frames')
    view.dispose()
  })
})
