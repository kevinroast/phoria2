// Caustics: one light's (light.caustics), bent by glass with thickness - the option on the lights that
// take it, the frame's caustic view (what bends it, what it lands on, fitted round the glass), and the
// renderer drawing them into a texture the lit programs read, kept while nothing changes.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DirectionalLight, Mesh, PerspectiveCamera, RectAreaLight, Scene, SpotLight, Texture, WebGLRenderer, box, plane } from '../src/index.js'
import { collect } from '../src/frame.js'
import { changesShape } from '../src/webgl/drawn.js'
import { CAUSTIC_GRID } from '../src/webgl/caustics.js'
import { fakeCanvas, fakeGL } from './fakes.js'

const camera = () => new PerspectiveCamera({ position: [0, 4, 10], target: [0, 0, 0], aspect: 1 })
const glass = { transmission: 1, thickness: 0.5, ior: 1.5 }

/** A floor, and a block of glass on it lit by `light`. */
function scene(light, material = glass) {
  const s = new Scene()
  s.add(new Mesh({ geometry: plane(10), receiveShadow: true }))
  const block = s.add(new Mesh({ geometry: box(1), material, position: [0, 0.5, 0], castShadow: true }))
  s.add(light)
  s.updateWorldTree()
  return { s, block }
}

afterEach(() => vi.restoreAllMocks())

describe('the caustics option', () => {
  it('is off by default on the sun, spot and rect lights, and kept by clone and JSON', () => {
    for (const Light of [DirectionalLight, SpotLight, RectAreaLight]) {
      expect(new Light().caustics).toBe(false)
      const on = new Light({ castShadow: true, caustics: true })
      expect(on.caustics).toBe(true)
      expect(/** @type {any} */ (on.clone()).caustics).toBe(true)
      expect(on.toJSON().caustics).toBe(true)
      expect(new Light().toJSON().caustics).toBeUndefined()
    }
  })
})

describe("a frame's caustics", () => {
  it('the asking light, the glass with thickness that bends it and what it lands on', () => {
    const sun = new DirectionalLight({ direction: [0.3, -1, 0.2], castShadow: true, caustics: true })
    const { s, block } = scene(sun)
    const frame = collect(s, camera())
    expect(frame.caustics).not.toBeNull()
    const c = /** @type {NonNullable<typeof frame.caustics>} */ (frame.caustics)
    expect(c.light.node).toBe(sun)
    expect(c.tile).toBe(-1)
    expect(c.glass.map((i) => i.node)).toEqual([block])
    // the floor only receives, but the light lands on it
    expect(c.surfaces.some((i) => i.node.receiveShadow && !i.node.castShadow)).toBe(true)
    expect(c.surfaces.some((i) => i.node === block)).toBe(false)
    expect(c.blur).toBeGreaterThanOrEqual(1.5)
  })

  it('none without glass that bends - thin walls only tint - or without castShadow, or a light asking', () => {
    const asking = () => new DirectionalLight({ direction: [0, -1, 0], castShadow: true, caustics: true })
    expect(collect(scene(asking(), { ...glass, thinWalled: true }).s, camera()).caustics).toBeNull()
    expect(collect(scene(asking(), { ...glass, thickness: 0 }).s, camera()).caustics).toBeNull()
    expect(collect(scene(asking(), { color: '#808080' }).s, camera()).caustics).toBeNull()
    expect(collect(scene(new DirectionalLight({ direction: [0, -1, 0], caustics: true })).s, camera()).caustics).toBeNull()
    expect(collect(scene(new DirectionalLight({ direction: [0, -1, 0], castShadow: true })).s, camera()).caustics).toBeNull()
  })

  it("a spot or rect light's, from where it is, in its spot shadow tile", () => {
    for (const light of [new SpotLight({ position: [0, 4, 0], direction: [0, -1, 0], angle: 0.6, castShadow: true, caustics: true }),
      new RectAreaLight({ position: [0, 4, 0], direction: [0, -1, 0], width: 0.2, height: 0.2, castShadow: true, caustics: true })]) {
      const frame = collect(scene(light).s, camera())
      const c = /** @type {NonNullable<typeof frame.caustics>} */ (frame.caustics)
      expect(c.tile).toBe(0)
      expect(Array.from(/** @type {any} */ (c.from))).toEqual([0, 4, 0])
    }
  })

  it('one light a scene: a second asking warns and goes without', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { s } = scene(new DirectionalLight({ direction: [0, -1, 0], castShadow: true, caustics: true }))
    s.add(new SpotLight({ position: [0, 4, 0], direction: [0, -1, 0], castShadow: true, caustics: true }))
    s.updateWorldTree()
    const frame = collect(s, camera())
    expect(frame.caustics?.light.kind).toBe('directional')
    expect(warn.mock.calls.flat().join(' ')).toContain('more than one light asks for caustics')
  })

  it("a bigger light's are softer; a refine sample's, from a point on the light, hardly at all", () => {
    const blurOf = (width, lightSample = null) => {
      const light = new RectAreaLight({ position: [0, 4, 0], direction: [0, -1, 0], width, height: width, castShadow: true, caustics: true })
      return /** @type {any} */ (collect(scene(light).s, camera(), { lightSample })).caustics.blur
    }
    expect(blurOf(1)).toBeGreaterThan(blurOf(0.1))
    expect(blurOf(1, [0.3, 0.7])).toBe(1.5)
  })
})

describe('caustics drawn', () => {
  /** A fake context that can draw to float textures, counting the caustic splats drawn. */
  function floatGL() {
    const fake = fakeGL()
    const gl = new Proxy(fake.gl, {
      get: (target, key) => key === 'getExtension' ? (name) => (name === 'EXT_color_buffer_float' ? {} : target.getExtension(name)) : target[key],
    })
    return { ...fake, gl }
  }
  const splats = (drawLog) => drawLog.filter((d) => d.call === 'drawArrays' && d.count === (CAUSTIC_GRID - 1) ** 2 * 6).length

  it('the lit programs read them for the caustic light; drawn once while nothing changes', async () => {
    const { gl, sources, drawLog } = floatGL()
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl) })
    renderer.setSize(64, 64)
    let ready = 0
    renderer.onReady = () => ready++
    const sun = new DirectionalLight({ direction: [0.3, -1, 0.2], castShadow: true, caustics: true })
    const { s, block } = scene(sun)
    const cam = camera()
    renderer.render(s, cam)
    // the shadows' code, then the caustics'
    await vi.waitFor(() => {
      renderer.render(s, cam)
      expect(sources.some((src) => src.includes('#define CAUSTICS'))).toBe(true)
    })
    const before = splats(drawLog)
    expect(before).toBeGreaterThan(0)
    // the camera moving doesn't draw them again
    cam.position.set(1, 4, 10)
    renderer.render(s, cam)
    expect(splats(drawLog)).toBe(before)
    // the glass moving does
    block.position.x = 0.3
    s.updateWorldTree()
    renderer.render(s, cam)
    expect(splats(drawLog)).toBe(before + 1)
    expect(ready).toBeGreaterThan(0)
  })

  it('with dispersion, once a colour of the spectrum - without, once', async () => {
    const drawn = async (/** @type {number} */ dispersion) => {
      const { gl, drawLog, sources } = floatGL()
      const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl) })
      renderer.setSize(64, 64)
      const { s } = scene(new DirectionalLight({ direction: [0, -1, 0], castShadow: true, caustics: true }), { ...glass, dispersion })
      await vi.waitFor(() => {
        renderer.render(s, camera())
        expect(sources.some((src) => src.includes('#define CAUSTICS'))).toBe(true)
      })
      return splats(drawLog)
    }
    const plain = await drawn(0), split = await drawn(1)
    expect(split).toBe(plain * 7)
  })

  it('the lit programs add the bent light and take the straight light that went through glass', async () => {
    const { gl, sources } = floatGL()
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl) })
    renderer.setSize(64, 64)
    const { s } = scene(new SpotLight({ position: [0, 4, 0], direction: [0, -1, 0], angle: 0.3, castShadow: true, caustics: true }))
    await vi.waitFor(() => {
      renderer.render(s, camera())
      expect(sources.some((src) => src.includes('#define CAUSTICS'))).toBe(true)
    })
    const lit = sources.find((src) => src.includes('#define CAUSTICS') && src.includes('uCausticLanding'))
    expect(lit).toBeDefined()
    // the straight share loses the glass's, and the bent light - its cone taken at the glass - is added
    expect(lit).toContain('lit *= causticStraight()')
    expect(lit).toContain('radiance += uPunctualColor[i] * falloff * causticBent()')
  })

  it('faceted glass bends by its faces: drawn flat for the caustics', async () => {
    const { gl, sources } = floatGL()
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl) })
    renderer.setSize(64, 64)
    const { s } = scene(new DirectionalLight({ direction: [0, -1, 0], castShadow: true, caustics: true }), { ...glass, flatShading: true })
    await vi.waitFor(() => {
      renderer.render(s, camera())
      expect(sources.some((src) => src.includes('#define CAUSTIC_GLASS') && src.includes('#define FLAT_SHADING'))).toBe(true)
    })
  })

  it("a thickness map: the caustics' glass and the coloured shadow read it, and moving it draws them again", async () => {
    const { gl, sources, drawLog } = floatGL()
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl) })
    renderer.setSize(64, 64)
    const thicknessMap = new Texture({ image: { data: new Uint8Array([0, 128, 0, 255]), width: 1, height: 1 } })
    const { s } = scene(new DirectionalLight({ direction: [0, -1, 0], castShadow: true, caustics: true }), { ...glass, thicknessMap })
    const cam = camera()
    await vi.waitFor(() => {
      renderer.render(s, cam)
      expect(sources.some((src) => src.includes('#define CAUSTIC_GLASS') && src.includes('#define THICKNESS_MAP'))).toBe(true)
    })
    expect(sources.some((src) => src.includes('#define GLASS_FILTER') && src.includes('#define THICKNESS_MAP'))).toBe(true)
    // the lit glass reads it too, scaling how far what is behind is bent
    expect(sources.some((src) => src.includes('#define TRANSMISSION') && src.includes('#define THICKNESS_MAP') && src.includes('t *= uThicknessMapTexel.g'))).toBe(true)
    const before = splats(drawLog)
    thicknessMap.repeat = [2, 2]
    renderer.render(s, cam)
    expect(splats(drawLog)).toBe(before + 1)
  })

  it("without float targets, a warning and the light drawn without them", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { gl, sources } = fakeGL()
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl) })
    renderer.setSize(64, 64)
    const { s } = scene(new DirectionalLight({ direction: [0, -1, 0], castShadow: true, caustics: true }))
    // once the shadows' code is in
    await vi.waitFor(() => {
      renderer.render(s, camera())
      expect(warn.mock.calls.flat().join(' ')).toContain('caustics need a device that can draw to float textures')
    })
    expect(sources.some((src) => src.includes('#define CAUSTICS'))).toBe(false)
  })
})

describe('shader hooks and kept maps', () => {
  it('a fragment hook that only colours leaves a depth map as it was; one that cuts, or a vertex hook, does not', () => {
    expect(changesShape({ vertex: '', fragment: 'base.rgb *= 0.5;' })).toBe(false)
    expect(changesShape({ vertex: '', fragment: 'emissive += base.rgb; normal = normalize(normal + vec3(0.1));' })).toBe(false)
    expect(changesShape({ vertex: '', fragment: 'if (x > 0.5) discard;' })).toBe(true)
    expect(changesShape({ vertex: '', fragment: 'base.a = 0.0;' })).toBe(true)
    expect(changesShape({ vertex: '', fragment: 'base = vec4(1.0);' })).toBe(true)
    expect(changesShape({ vertex: 'local.y += 1.0;', fragment: '' })).toBe(true)
  })
})
