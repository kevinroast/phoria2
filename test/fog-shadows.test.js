// Night scenes: distance fog, and shadows from spot and point lights.
import { describe, expect, it, vi } from 'vitest'
import { DirectionalLight, Fog, Group, Mesh, PerspectiveCamera, PointLight, Points, Scene, SpotLight, WebGLRenderer, box, collect, cylinder, plane, sphere } from '../src/index.js'
import { fitPointShadow, fitSpotShadow } from '../src/shadow.js'
import { ChangeWatch } from '../src/watch.js'
import { Box3 } from '../src/value/Box3.js'
import { fakeCanvas, fakeGL } from './fakes.js'

const camera = () => new PerspectiveCamera({ position: [0, 4, 10], target: [0, 0, 0], aspect: 1 })

/** A renderer on a stand-in context that keeps the shader sources it is given. */
function recording() {
  const { gl, ...rest } = fakeGL()
  const sources = []
  const proxy = new Proxy(gl, {
    get(target, key) {
      if (key === 'shaderSource') return (_shader, source) => sources.push(source)
      return target[key]
    },
  })
  const renderer = new WebGLRenderer({ canvas: fakeCanvas(proxy) })
  renderer.setSize(10, 10)
  /** The #defines of the programs compiled since the last call. */
  const defines = () => {
    const defines = sources.map((s) => [...s.matchAll(/#define (\w+)/g)].map((m) => m[1]))
    sources.length = 0
    return defines
  }
  return { renderer, defines, ...rest }
}

describe('Fog', () => {
  it('is exponential by default, linear given near and far, and says why it refuses', () => {
    expect(new Fog().toJSON()).toEqual({ color: '#808080', density: 0.05 })
    const linear = new Fog({ color: '#102030', near: 5, far: 40 })
    expect(linear.linear).toBe(true)
    expect(linear.toJSON()).toEqual({ color: '#102030', near: 5, far: 40 })
    expect(() => new Fog({ density: 0.1, far: 10 })).toThrow("give 'density' for exponential fog, or 'near' and 'far' for linear - not both")
    expect(() => new Fog({ near: 10, far: 5 })).toThrow("'far' beyond it")
    expect(() => new Fog({ density: 0 })).toThrow("'density' must be more than 0")
    expect(() => new Fog({ start: 1 })).toThrow("use 'near'")
    expect(() => new Scene({ fog: 'thick' })).toThrow("'fog' must be { color, density } or { color, near, far }")
  })

  it('is set on the scene, changed in place, and redraws an idle view when it changes', () => {
    const scene = new Scene({ fog: { color: '#000000', density: 0.1 } })
    scene.add(new Mesh({ geometry: box() }))
    const cam = camera(), watch = new ChangeWatch()
    watch.changed(scene, cam)
    const changes = [
      () => { scene.fog.density = 0.2 },
      () => scene.fog.color.set('#ffffff'),
      () => { scene.fog = { near: 1, far: 20 } },
      () => { scene.fog = null },
    ]
    for (const change of changes) {
      change()
      expect(watch.changed(scene, cam), String(change)).toBe(true)
    }
    expect(collect(scene, cam).fog).toBeNull()
  })

  it('compiles into what is drawn - meshes, points and lines - unless a material opts out', () => {
    const { renderer, defines } = recording()
    const scene = new Scene({ fog: { density: 0.1 } })
    scene.add(new Mesh({ geometry: box() }))
    scene.add(new Points({ geometry: sphere(), material: { size: 2 } }), new Mesh({ geometry: sphere(), position: [3, 0, 0], material: { fog: false, unlit: true } }))
    renderer.render(scene, camera())
    const fogged = defines().filter((d) => d.includes('FOG'))
    // the lit mesh's and the points' programs, each a vertex and fragment shader; not the unlit one that opted out
    expect(fogged).toHaveLength(4)
    // linear, and additive glows fading out rather than to the fog's colour
    scene.fog = { near: 2, far: 30 }
    scene.add(new Mesh({ geometry: box(), material: { blending: 'additive' } }))
    renderer.render(scene, camera())
    const now = defines()
    expect(now.some((d) => d.includes('FOG_LINEAR') && d.includes('FOG_ADD'))).toBe(true)
  })
})

describe('spot light shadows', () => {
  /** A spot light over a box on the ground, optionally in a lamp of its own. */
  const lit = ({ lamp = false, spots = 1 } = {}) => {
    const scene = new Scene()
    const ground = scene.add(new Mesh({ geometry: plane(20), receiveShadow: true }))
    const crate = scene.add(new Mesh({ geometry: box(1), position: [0, 0.5, 0], castShadow: true }))
    const lights = []
    for (let i = 0; i < spots; i++) {
      const post = scene.add(new Group({ position: [i * 2, 5, 0] }))
      lights.push(post.add(new SpotLight({ direction: [0, -1, 0], angle: 0.6, castShadow: true })))
      if (lamp) post.add(new Mesh({ geometry: cylinder({ radius: 0.4, height: 0.5 }), castShadow: true }))
    }
    scene.updateWorldTree()
    return { scene, ground, crate, lights }
  }

  it('gives each casting spot light its own view and tile, and its casters', () => {
    const { scene, crate } = lit()
    const frame = collect(scene, camera())
    expect(frame.spotShadows).toHaveLength(1)
    const [shadow] = frame.spotShadows
    expect(shadow.tile).toBe(0)
    expect(shadow.light.shadowTile).toBe(0)
    expect(shadow.casters.map((c) => c.node)).toEqual([crate])
    // the light looks straight down at the crate: its middle lands in the middle of the view
    const m = shadow.viewProjection, p = [0, 0.5, 0]
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15]
    expect((m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / w).toBeCloseTo(0, 5)
    expect((m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w).toBeCloseTo(0, 5)
  })

  it("leaves the light's own lamp out of its shadow", () => {
    const { scene, crate } = lit({ lamp: true })
    const [shadow] = collect(scene, camera()).spotShadows
    expect(shadow.casters.map((c) => c.node)).toEqual([crate])
  })

  it('has room for four, and leaves non-casting spot lights without', () => {
    const { scene, lights } = lit({ spots: 4 })
    lights[3].castShadow = false
    const frame = collect(scene, camera())
    expect(frame.spotShadows.map((s) => s.tile)).toEqual([0, 1, 2])
    expect(frame.lights.filter((l) => l.kind === 'spot').map((l) => l.shadowTile)).toEqual([0, 1, 2, -1])
  })

  it('fits its view from just short of the casters to the furthest receiver, within range', () => {
    const casters = [new Box3([-0.5, 0, -0.5], [0.5, 1, 0.5])], receivers = [new Box3([-10, 0, -10], [10, 0, 10])]
    const fit = /** @type {NonNullable<ReturnType<typeof fitSpotShadow>>} */ (fitSpotShadow([0, 5, 0], [0, -1, 0], 0.5, 0, casters, receivers))
    // the ground straight below and the top of the crate are inside the depth range; a point nearer the light than any caster isn't
    const depth = (y) => {
      const m = fit.viewProjection
      return (m[2] * 0 + m[6] * y + m[10] * 0 + m[14]) / (m[3] * 0 + m[7] * y + m[11] * 0 + m[15])
    }
    expect(Math.abs(depth(0))).toBeLessThan(1)
    expect(Math.abs(depth(1))).toBeLessThan(1)
    expect(depth(4.2)).toBeLessThan(-1)
    expect(fit.texelAngle).toBeGreaterThan(0)
    expect(fitSpotShadow([0, 5, 0], [0, -1, 0], 0.5, 0, [], receivers)).toBeNull()
  })

  it('draws the casters into the spot shadow map once its code has loaded, and the receivers sample it', async () => {
    const { renderer, defines } = recording()
    let ready = 0
    renderer.onReady = () => ready++
    const { scene } = lit()
    // a directional light too: the two kinds of shadow sit side by side
    scene.add(new DirectionalLight({ direction: [0, -1, 0], castShadow: true }))
    renderer.render(scene, camera())
    await vi.waitFor(() => expect(ready).toBeGreaterThan(0))
    defines()
    renderer.render(scene, camera())
    const programs = defines()
    expect(programs.some((d) => d.includes('SPOT_SHADOWS') && d.includes('SHADOW'))).toBe(true)
  })
})

describe('point light shadows', () => {
  /** A candle in a lantern: a point light inside a hollow box, a crate beside it, and the ground. */
  const lantern = ({ lights = 1 } = {}) => {
    const scene = new Scene()
    scene.add(new Mesh({ geometry: plane(20), receiveShadow: true }))
    const shell = scene.add(new Mesh({ geometry: box(1), position: [0, 1, 0], castShadow: true, material: { doubleSided: true } }))
    const flame = scene.add(new Mesh({ geometry: sphere(0.05), position: [0, 1, 0], castShadow: false }))
    const crate = scene.add(new Mesh({ geometry: box(1), position: [3, 0.5, 0], castShadow: true }))
    const candles = []
    for (let i = 0; i < lights; i++) candles.push(scene.add(new PointLight({ position: [0, 1, 0], range: 8, castShadow: true })))
    scene.updateWorldTree()
    return { scene, shell, flame, crate, candles }
  }

  it("is cast all round, and the light's own shell blocks it - a lantern, a pumpkin", () => {
    const { scene, shell, crate } = lantern()
    const frame = collect(scene, camera())
    const shadow = /** @type {NonNullable<typeof frame.pointShadow>} */ (frame.pointShadow)
    expect(shadow.light.kind).toBe('point')
    expect(shadow.faces).toHaveLength(6)
    // the shell is round the light, so every face sees it; the crate only from +X
    for (const face of shadow.faces) expect(face.casters.map((c) => c.node)).toContain(shell)
    expect(shadow.faces.map((f) => f.casters.some((c) => c.node === crate))).toEqual([true, false, false, false, false, false])
    expect(shadow.near).toBeGreaterThan(0)
    expect(shadow.far).toBeCloseTo(8 * 1.02, 5) // the range, and a little over
    // a light with castShadow off: no shadow
    const candle = /** @type {PointLight} */ (shadow.light.node)
    candle.castShadow = false
    expect(collect(scene, camera()).pointShadow).toBeNull()
  })

  it('looks along each axis in cube map order, so the shader finds a direction in the right face', () => {
    const fit = /** @type {NonNullable<ReturnType<typeof fitPointShadow>>} */ (fitPointShadow([1, 2, 3], 0, [new Box3([0, 0, 0], [2, 4, 6])], []))
    const axes = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
    fit.viewProjections.forEach((m, i) => {
      // a point one unit along the face's axis lands in the middle of that face, in front
      const p = [1 + axes[i][0], 2 + axes[i][1], 3 + axes[i][2]]
      const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15]
      expect(w).toBeGreaterThan(0)
      expect((m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / w).toBeCloseTo(0, 5)
      expect((m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w).toBeCloseTo(0, 5)
    })
    // out to the furthest corner, or the range
    expect(fit.far).toBeCloseTo(Math.hypot(1, 2, 3) * 1.02, 5)
    expect(fitPointShadow([1, 2, 3], 2, [new Box3([0, 0, 0], [2, 4, 6])], [])?.far).toBeCloseTo(2.04, 5)
    expect(fitPointShadow([0, 0, 0], 0, [], [])).toBeNull()
  })

  it('has one: a second casting point light warns and goes without', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { scene, candles } = lantern({ lights: 2 })
    expect(collect(scene, camera()).pointShadow?.light.node).toBe(candles[0])
    expect(warn.mock.calls.flat().join(' ')).toContain('more than one point light casts shadows')
    warn.mockRestore()
  })

  it('draws the cube once its code has loaded, and the receivers sample it', async () => {
    const { renderer, defines } = recording()
    let ready = 0
    renderer.onReady = () => ready++
    const { scene } = lantern()
    renderer.render(scene, camera())
    await vi.waitFor(() => expect(ready).toBeGreaterThan(0))
    defines()
    renderer.render(scene, camera())
    const programs = defines()
    expect(programs.some((d) => d.includes('POINT_SHADOW'))).toBe(true)
    expect(programs.some((d) => d.includes('SPOT_SHADOWS'))).toBe(false)
  })

  it('keeps castShadow through clone and JSON', () => {
    const light = new PointLight({ castShadow: true, range: 4 })
    expect(light.clone().castShadow).toBe(true)
    expect(light.toJSON()).toMatchObject({ castShadow: true, range: 4 })
    expect(new PointLight().toJSON()).not.toHaveProperty('castShadow')
  })
})
