// Rect-area lights: a glowing rectangle - its options, which way its edges run, the frame's limit,
// its lookup tables loaded with the first one, what the lit shaders are given, and its shadow (a
// spot shadow tile from its middle, as soft as the light is big).
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Group, Mesh, PerspectiveCamera, RectAreaLight, Scene, SpotLight, WebGLRenderer, box, create, plane } from '../src/index.js'
import { collect } from '../src/frame.js'
import { ChangeWatch } from '../src/watch.js'
import { fakeCanvas, fakeGL, preprocess } from './fakes.js'

const camera = () => new PerspectiveCamera({ position: [0, 4, 10], target: [0, 0, 0], aspect: 1 })
const close = (/** @type {ArrayLike<number>} */ v, /** @type {number[]} */ want) => want.forEach((x, i) => expect(v[i]).toBeCloseTo(x, 5))

describe('RectAreaLight', () => {
  it('is a metre square shining down by default, checks its size, and hints what it has instead', () => {
    const light = new RectAreaLight()
    expect([light.width, light.height, light.castShadow, light.lightKind, light.lightGroup]).toEqual([1, 1, false, 'rect', 'rect'])
    expect(() => new RectAreaLight({ width: 0 })).toThrow("'width' must be above 0")
    expect(() => new RectAreaLight({ height: -1 })).toThrow("'height' must be above 0")
    expect(() => new RectAreaLight(/** @type {any} */ ({ shadowSoftness: 0.5 }))).toThrow('as soft as the light is big')
    expect(() => new RectAreaLight(/** @type {any} */ ({ size: 2 }))).toThrow("use 'width' and 'height'")
  })

  it('runs its width level with the ground and its height across it, facing the way it shines', () => {
    // a window shining along -z: width along x, height up
    const pane = new RectAreaLight({ direction: [0, 0, -1], width: 2, height: 1 })
    let [hw, hh] = pane.worldEdges
    close(hw.clone().normalize().cross([1, 0, 0]), [0, 0, 0])
    expect(hw.len()).toBeCloseTo(1)
    close(hh.clone().normalize().cross([0, 1, 0]), [0, 0, 0])
    expect(hh.len()).toBeCloseTo(0.5)
    // width x height points against the way it shines - the corner order the shader integrates round
    close(hw.clone().cross(hh).normalize(), [0, 0, 1])

    // a ceiling panel shining straight down: width along x
    ;[hw, hh] = new RectAreaLight({ width: 3, height: 1 }).worldEdges
    close(hw, [hw[0], 0, 0])
    expect(Math.abs(hw[0])).toBeCloseTo(1.5)
    close(hw.clone().cross(hh).normalize(), [0, 1, 0])

    // turned with its parent: a group turned a quarter round z carries its "ground" with it
    const group = new Group({ rotation: [0, 0, Math.PI / 2] })
    const turned = group.add(new RectAreaLight({ direction: [0, 0, -1], width: 2, height: 1 }))
    group.updateWorldTree()
    ;[hw] = turned.worldEdges
    close(hw.clone().normalize().cross([0, 1, 0]), [0, 0, 0])
  })

  it('keeps its size and shadow through clone, JSON and descriptions, and is a change to watch', () => {
    const light = new RectAreaLight({ width: 2, height: 0.5, castShadow: true, position: [0, 3, 0], intensity: 4 })
    expect(light.toJSON()).toMatchObject({ type: 'rect-area-light', width: 2, height: 0.5, castShadow: true, intensity: 4 })
    expect(new RectAreaLight().toJSON()).not.toHaveProperty('width')
    const copy = /** @type {RectAreaLight} */ (create(light.toJSON()))
    expect([copy.width, copy.height, copy.castShadow]).toEqual([2, 0.5, true])
    expect(light.clone().width).toBe(2)

    const scene = new Scene()
    scene.add(light)
    const watch = new ChangeWatch()
    watch.changed(scene, camera())
    light.width = 3
    expect(watch.changed(scene, camera())).toBe(true)
  })

  it('has a limit of its own - four a scene - apart from point and spot lights', () => {
    const scene = new Scene()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (let i = 0; i < 5; i++) scene.add(new RectAreaLight({ position: [i, 3, 0] }))
    for (let i = 0; i < 4; i++) scene.add(new SpotLight({ position: [i, 3, 0] }))
    scene.updateWorldTree()
    const frame = collect(scene, camera())
    expect(frame.lights.filter((l) => l.kind === 'rect')).toHaveLength(4)
    expect(frame.lights.filter((l) => l.kind === 'spot')).toHaveLength(4)
    expect(warn.mock.calls.flat().join(' ')).toContain('more than 4 rect-area lights')
    warn.mockRestore()
  })
})

describe('rect-area lights in the renderer', () => {
  // the chunks a frame may wait for, loaded once up front: each renderer's own load of them then
  // arrives at once, together, rather than in whichever order the imports finish
  beforeAll(async () => {
    await import('../src/webgl/passes.js')
    await import('../src/webgl/ltc.js')
  })

  /**
   * A renderer on a stand-in context, drawn until nothing more is loading. `all` is every shader
   * source compiled, `sources` those of the last frame; `halfFloats` counts the half-float textures
   * sent (only the rect lights' tables are).
   * @param {Scene} scene
   */
  async function drawn(scene) {
    const fake = fakeGL()
    let halfFloats = 0
    const gl = new Proxy(fake.gl, {
      get: (target, key) => key === 'texImage2D'
        ? (/** @type {any[]} */ ...args) => {
            if (args[7] === target.HALF_FLOAT) halfFloats++
            return target.texImage2D(...args)
          }
        : target[key],
    })
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl) })
    renderer.setSize(16, 16)
    let ready = 0
    renderer.onReady = () => ready++
    renderer.render(scene, camera())
    const all = [...fake.sources]
    const first = fake.sources.filter((s) => s.includes('NUM_RECT')).map((s) => /#define NUM_RECT (\d+)/.exec(s)?.[1])
    await vi.waitFor(() => expect(ready).toBeGreaterThan(0))
    await new Promise((r) => setTimeout(r, 0))
    fake.sources.length = 0
    renderer.render(scene, camera())
    all.push(...fake.sources)
    return { ...fake, renderer, first, all, halfFloats: () => halfFloats }
  }

  /** The lit program a draw used - the last one with rect lights compiled in. @param {any} fake */
  const litProgram = (fake) => fake.drawLog.map((d) => d.program).filter((p) => p?.uniforms.some((u) => u.name === 'uRectColor')).at(-1)

  it('loads its tables with the first one, leaving rect lights out until they arrive', async () => {
    const scene = new Scene()
    scene.add(new Mesh({ geometry: box(1) }))
    scene.add(new RectAreaLight({ position: [0, 3, 0], width: 2, height: 0.5, color: '#ff8000', intensity: 3 }))
    const fake = await drawn(scene)
    // the first frame, before they loaded: none
    expect(fake.first.length).toBeGreaterThan(0)
    expect(fake.first.every((n) => n === '0')).toBe(true)
    expect(fake.sources.some((s) => s.includes('#define NUM_RECT 1'))).toBe(true)
    const program = litProgram(fake)
    expect(program).toBeTruthy()
    // a point light's intensity over its area (and PI): orange, 3, over 2 x 0.5
    const c = program.values.uRectColor
    const scale = 3 * Math.PI / 1
    expect(c[0]).toBeCloseTo(1 * scale, 4)
    expect(c[1] / scale).toBeGreaterThan(0.2)
    expect(c[2]).toBeCloseTo(0, 4)
    close(program.values.uRectPosition, [0, 3, 0])
    expect(Math.hypot(...program.values.uRectHalfWidth)).toBeCloseTo(1)
    expect(Math.hypot(...program.values.uRectHalfHeight)).toBeCloseTo(0.25)
    // its two tables, as half floats: four channels and two
    expect(fake.count('texture')).toBeGreaterThanOrEqual(2)
    fake.renderer.dispose(scene)
  })

  it('costs nothing unless used: no rect light, none of its code or tables; no shadow from it, no soft lookup', async () => {
    const live = (/** @type {string[]} */ sources) => sources.flatMap((s) => preprocess(s).lines).join('\n')
    const without = new Scene()
    without.add(new Mesh({ geometry: box(1), castShadow: true }))
    without.add(new SpotLight({ position: [0, 4, 0], target: [0, 0, 0], castShadow: true }))
    const a = await drawn(without)
    expect(a.all.length).toBeGreaterThan(0)
    expect(live(a.all)).not.toMatch(/ltcIntegral|uRect|uLtc/)
    // its tables never made
    expect(a.halfFloats()).toBe(0)
    a.renderer.dispose(without)

    const unshadowed = new Scene()
    unshadowed.add(new Mesh({ geometry: box(1), castShadow: true }))
    unshadowed.add(new SpotLight({ position: [0, 4, 0], target: [0, 0, 0], castShadow: true }))
    unshadowed.add(new RectAreaLight({ position: [0, 3, 1] }))
    const b = await drawn(unshadowed)
    expect(live(b.all)).toMatch(/ltcIntegral/)
    expect(b.halfFloats()).toBe(2)
    expect(b.all.some((s) => s.includes('#define SPOT_SHADOWS_SOFT'))).toBe(false)
    b.renderer.dispose(unshadowed)
  })

  it('casts from its middle onto a spot shadow tile, its cone fitted to what casts, its edge as soft as it is big', async () => {
    const scene = new Scene()
    scene.add(new Mesh({ geometry: box(1), castShadow: true }))
    scene.add(new Mesh({ geometry: plane(10), rotation: [-Math.PI / 2, 0, 0], position: [0, -0.5, 0], receiveShadow: true }))
    const light = scene.add(new RectAreaLight({ position: [0, 4, 0], width: 2, height: 2, castShadow: true }))
    scene.updateWorldTree()
    const frame = collect(scene, camera())
    expect(frame.spotShadows).toHaveLength(1)
    const tile = frame.spotShadows[0]
    expect(tile.light.node).toBe(light)
    expect(tile.light.shadowTile).toBe(0)

    const fake = await drawn(scene)
    // compiled with the soft lookup, the light's size given as a negative spread: the longer semi-axis of
    // the ellipse that spreads an edge as the rectangle does (its half width x 2 / root 3), and its shape -
    // a square light's a circle
    expect(fake.sources.some((s) => s.includes('#define SPOT_SHADOWS_SOFT'))).toBe(true)
    const program = litProgram(fake)
    expect(program.values.uRectShadow[0]).toBe(0)
    expect(program.values.uSpotShadowSoft[0]).toBeCloseTo(-2 / Math.sqrt(3), 4)
    expect([...program.values.uSpotShadowShape.slice(2, 4)]).toEqual([1, 1])
    expect(Math.hypot(program.values.uSpotShadowShape[0], program.values.uSpotShadowShape[1])).toBeCloseTo(1, 4)
    fake.renderer.dispose(scene)
  })

  it('shares the four spot shadow tiles with spot lights', () => {
    const scene = new Scene()
    scene.add(new Mesh({ geometry: box(1), castShadow: true }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (let i = 0; i < 3; i++) scene.add(new SpotLight({ position: [i - 1, 4, 0], target: [0, 0, 0], castShadow: true }))
    for (let i = 0; i < 2; i++) scene.add(new RectAreaLight({ position: [i, 4, 1], castShadow: true }))
    scene.updateWorldTree()
    expect(collect(scene, camera()).spotShadows).toHaveLength(4)
    expect(warn.mock.calls.flat().join(' ')).toContain('more than 4 spot and rect-area lights cast shadows')
    warn.mockRestore()
  })

  it("doesn't count a caster round its own middle - the panel drawn at it", () => {
    const scene = new Scene()
    scene.add(new Mesh({ geometry: box(1), castShadow: true }))
    const panel = scene.add(new Mesh({ geometry: box({ width: 2, height: 0.05, depth: 2 }), position: [0, 4, 0], castShadow: true }))
    scene.add(new RectAreaLight({ position: [0, 4, 0], width: 2, height: 2, castShadow: true }))
    scene.updateWorldTree()
    const casters = collect(scene, camera()).spotShadows[0].casters.map((c) => c.node)
    expect(casters).not.toContain(panel)
    expect(casters).toHaveLength(1)
  })
})
