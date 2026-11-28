// Shadow maps are kept while nothing in their light or casters changes (src/webgl/drawn.js), and
// drawn again for anything that would change them. Every input a map is drawn from has a test here:
// one missed would leave a stale shadow.
import { describe, expect, it, vi } from 'vitest'
import { DirectionalLight, Group, InstancedMesh, Material, Mesh, PerspectiveCamera, PointLight, Scene, SpotLight, Texture, WebGLRenderer, box, plane } from '../src/index.js'
import { fakeCanvas, fakeGL } from './fakes.js'
import { Skin } from '../src/scene/deform.js'

const camera = () => new PerspectiveCamera({ position: [0, 6, 12], target: [0, 0, 0], aspect: 1 })

/** Draw until the shadow code has loaded and the maps are being drawn. @param {WebGLRenderer} renderer @param {() => void} render */
async function shadowsLoaded(renderer, render) {
  await vi.waitFor(() => {
    render()
    expect(renderer.info.shadowMaps + renderer.info.shadowMapsKept).toBeGreaterThan(0)
  })
}

/**
 * A renderer and a scene - a floor and a crate - lit by `light`, drawn until its shadow code has
 * loaded: its maps drawn once. draw() renders and says what the maps did.
 */
async function lit(light, options = {}) {
  const fake = fakeGL()
  const renderer = new WebGLRenderer({ canvas: fakeCanvas(fake.gl), ...options })
  renderer.setSize(64, 64)
  const scene = new Scene()
  scene.add(new Mesh({ geometry: plane(20), receiveShadow: true }))
  const crate = scene.add(new Mesh({ geometry: box(), position: [0, 0.5, 0], castShadow: true }))
  scene.add(light)
  let view = camera()
  const draw = (at = view) => {
    view = at
    renderer.render(scene, view)
    return { drawn: renderer.info.shadowMaps, kept: renderer.info.shadowMapsKept }
  }
  await shadowsLoaded(renderer, () => renderer.render(scene, view))
  return { renderer, scene, crate, draw, fake }
}

const sun = () => new DirectionalLight({ direction: [-1, -2, -1], castShadow: true })
const DRAWN = { drawn: 1, kept: 0 }, KEPT = { drawn: 0, kept: 1 }

describe('a shadow map', () => {
  it('is kept while nothing moves, and while only the camera does', async () => {
    const { draw } = await lit(sun())
    expect(draw()).toEqual(KEPT)
    expect(draw(new PerspectiveCamera({ position: [8, 3, -6], target: [0, 0, 0], aspect: 1 }))).toEqual(KEPT)
  })

  it('skips its depth draws when kept', async () => {
    const { draw, fake } = await lit(sun())
    draw()
    const before = fake.drawLog.length
    draw()
    const mapped = fake.drawLog.length - before
    // the second frame drew the scene alone: two meshes, no caster into the map
    expect(mapped).toBe(2)
  })

  it('is drawn again when a caster moves, turns, grows, comes or goes', async () => {
    const { draw, scene, crate } = await lit(sun())
    draw()
    crate.position.x = 1
    expect(draw()).toEqual(DRAWN)
    crate.rotation.y = 0.5
    expect(draw()).toEqual(DRAWN)
    crate.scale.set(2, 2, 2)
    expect(draw()).toEqual(DRAWN)
    expect(draw()).toEqual(KEPT)
    const other = scene.add(new Mesh({ geometry: box(), position: [3, 0.5, 0], castShadow: true }))
    expect(draw()).toEqual(DRAWN)
    other.castShadow = false
    expect(draw()).toEqual(DRAWN)
    other.castShadow = true
    draw()
    other.visible = false
    expect(draw()).toEqual(DRAWN)
    scene.remove(other)
    expect(draw()).toEqual(KEPT)
  })

  it("is drawn again when a caster or an instance moves inside the light's fixed bounds - the light's view the same", async () => {
    // shadowBounds fixes the sun's view: only the record of the casters themselves can see them move
    const { draw, crate, scene } = await lit(new DirectionalLight({ direction: [-1, -2, -1], castShadow: true, shadowBounds: { min: [-10, -1, -10], max: [10, 6, 10] } }))
    const many = scene.add(new InstancedMesh({ geometry: box(), count: 2, castShadow: true }))
    many.setInstance(0, { position: [-3, 0.5, 2] }).setInstance(1, { position: [3, 0.5, 2] })
    draw()
    expect(draw()).toEqual(KEPT)
    crate.position.x = 0.25
    expect(draw()).toEqual(DRAWN)
    many.setInstance(1, { position: [3.25, 0.5, 2] })
    expect(draw()).toEqual(DRAWN)
    expect(draw()).toEqual(KEPT)
  })

  it('is drawn again when a parent moves the caster', async () => {
    const { draw, scene, crate } = await lit(sun())
    const group = scene.add(new Group())
    group.add(crate)
    draw()
    expect(draw()).toEqual(KEPT)
    group.position.z = 2
    expect(draw()).toEqual(DRAWN)
  })

  it('is drawn again when the light turns', async () => {
    const light = sun()
    const { draw } = await lit(light)
    draw()
    light.direction.set(1, -2, -1)
    expect(draw()).toEqual(DRAWN)
    expect(draw()).toEqual(KEPT)
  })

  it("is drawn again when a skinned caster's joints move, or a morphed one's weights change - its own matrix standing still", async () => {
    // the light's view fixed, so only the pose can change the map
    const { draw, scene, crate } = await lit(new DirectionalLight({ direction: [-1, -2, -1], castShadow: true, shadowBounds: { min: [-5, -1, -5], max: [5, 5, 5] } }))
    const g = crate.geometry.clone(), n = g.vertexCount
    const joints = new Float32Array(n * 4), weights = new Float32Array(n * 4)
    for (let v = 0; v < n; v++) weights[v * 4] = 1
    g.deform = { joints, weights, targets: [{ positions: new Float32Array(n * 3).fill(0.1), normals: null, reach: 0.18 }] }
    crate.geometry = g
    const joint = scene.add(new Group())
    const deformed = /** @type {any} */ (crate)
    deformed.skin = new Skin([joint], null)
    deformed.morphWeights = new Float32Array([0])
    deformed.morphNames = ['grow']
    draw()
    expect(draw()).toEqual(KEPT)
    joint.position.set(0, 0.5, 0)
    scene.update(0, 0)
    expect(draw()).toEqual(DRAWN)
    expect(draw()).toEqual(KEPT)
    crate.morphs = { grow: 1 }
    expect(draw()).toEqual(DRAWN)
    expect(draw()).toEqual(KEPT)
  })

  it("is drawn again when a caster's geometry changes, or how much of it is drawn", async () => {
    const { draw, crate } = await lit(sun())
    draw()
    crate.geometry.positions[0] += 0.5
    crate.geometry.needsUpdate()
    expect(draw()).toEqual(DRAWN)
    crate.geometry.drawCount = 6
    expect(draw()).toEqual(DRAWN)
    crate.geometry = box({ width: 2 })
    expect(draw()).toEqual(DRAWN)
  })

  it("is drawn again when a cut-out's holes change - threshold, opacity, map, the map's pixels and placement", async () => {
    const image = { width: 1, height: 1, data: new Uint8Array(4) }
    const { draw, crate } = await lit(sun())
    draw()
    crate.material = new Material({ alphaTest: 0.5 })
    expect(draw()).toEqual(DRAWN)
    crate.material.alphaTest = 0.3
    expect(draw()).toEqual(DRAWN)
    crate.material.map = new Texture({ image })
    expect(draw()).toEqual(DRAWN)
    expect(draw()).toEqual(KEPT)
    crate.material.opacity = 0.8
    expect(draw()).toEqual(DRAWN)
    crate.material.map.repeat = [2, 2]
    expect(draw()).toEqual(DRAWN)
    crate.material.map.needsUpdate()
    expect(draw()).toEqual(DRAWN)
    crate.material.triplanar = 1
    expect(draw()).toEqual(DRAWN)
    expect(draw()).toEqual(KEPT)
  })

  it("is kept when what changes doesn't shape the shadow - colour, roughness, a map without a cut-out", async () => {
    const { draw, crate } = await lit(sun())
    draw()
    crate.material.color.set('red')
    crate.material.roughness = 0.1
    crate.material.opacity = 0.9
    crate.material.map = new Texture({ image: { width: 1, height: 1, data: new Uint8Array(4) } })
    expect(draw()).toEqual(KEPT)
  })

  it('is drawn every frame while a caster has shader hooks - they can move it with time', async () => {
    const { draw, crate } = await lit(sun())
    crate.material = new Material({ shader: { vertex: 'local.y += sin(uTime);' } })
    draw()
    expect(draw()).toEqual(DRAWN)
    expect(draw()).toEqual(DRAWN)
    crate.material.shader = null
    draw()
    expect(draw()).toEqual(KEPT)
  })

  it('is drawn again when instances move, or how many are drawn', async () => {
    const { draw, scene } = await lit(sun())
    const many = scene.add(new InstancedMesh({ geometry: box(), count: 3, castShadow: true }))
    for (let i = 0; i < 3; i++) many.setInstance(i, { position: [i * 2 - 2, 0.5, 2] })
    draw()
    expect(draw()).toEqual(KEPT)
    many.setInstance(1, { position: [0, 2, 2] })
    expect(draw()).toEqual(DRAWN)
    many.count = 2
    expect(draw()).toEqual(DRAWN)
    many.instanceMatrices[12] = 5
    many.needsUpdate()
    expect(draw()).toEqual(DRAWN)
  })

  it('is drawn again when a section plane through a caster moves', async () => {
    const { draw, scene, crate } = await lit(sun())
    const cut = scene.add(new Group({ clip: { normal: [1, 0, 0], offset: 0 } }))
    cut.add(crate)
    draw()
    expect(draw()).toEqual(KEPT)
    cut.clip = { normal: [1, 0, 0], offset: 0.2 }
    expect(draw()).toEqual(DRAWN)
  })

  it("is drawn again when glass in the light's way changes colour", async () => {
    const { draw, crate } = await lit(sun())
    crate.material = new Material({ transmission: 1, color: '#88ccff' })
    draw()
    expect(draw()).toEqual(KEPT)
    crate.material.color.set('#ff8800')
    expect(draw()).toEqual(DRAWN)
    crate.material.attenuationColor.set('#00ff00')
    crate.material.thickness = 1
    crate.material.attenuationDistance = 0.5
    expect(draw()).toEqual(DRAWN)
    crate.material.doubleSided = true
    expect(draw()).toEqual(DRAWN)
    expect(draw()).toEqual(KEPT)
  })

  it('is never another scene\'s: one renderer drawing two scenes draws each one\'s map', async () => {
    const one = await lit(sun())
    const other = new Scene()
    other.add(new Mesh({ geometry: plane(20), receiveShadow: true }))
    other.add(new Mesh({ geometry: box(), position: [2, 0.5, 0], castShadow: true }))
    other.add(sun())
    one.draw()
    const otherDraw = () => {
      one.renderer.render(other, camera())
      return { drawn: one.renderer.info.shadowMaps, kept: one.renderer.info.shadowMapsKept }
    }
    expect(otherDraw()).toEqual(DRAWN)
    expect(one.draw()).toEqual(DRAWN)
    expect(otherDraw()).toEqual(DRAWN)
  })

  it('is drawn again after a lost context comes back', async () => {
    const { gl } = fakeGL()
    /** @type {Record<string, (e: any) => void>} */
    const on = {}
    const canvas = { width: 0, height: 0, getContext: (type) => (type === 'webgl2' ? gl : null), addEventListener: (type, fn) => { on[type] = fn }, removeEventListener() {} }
    const renderer = new WebGLRenderer({ canvas })
    renderer.setSize(10, 10, 1)
    const scene = new Scene()
    scene.add(new Mesh({ geometry: plane(20), receiveShadow: true }), new Mesh({ geometry: box(), castShadow: true }), sun())
    await shadowsLoaded(renderer, () => renderer.render(scene, camera()))
    renderer.render(scene, camera())
    expect(renderer.info.shadowMapsKept).toBe(1)
    on.webglcontextlost({ preventDefault() {} })
    on.webglcontextrestored({})
    renderer.render(scene, camera())
    expect([renderer.info.shadowMaps, renderer.info.shadowMapsKept]).toEqual([1, 0])
    renderer.dispose()
  })
})

describe('spot and point shadow maps', () => {
  it('are kept while nothing moves, and drawn again when a light or a caster does', async () => {
    const spot = new SpotLight({ position: [3, 5, 3], direction: [-1, -2, -1], angle: 0.6, castShadow: true })
    const { draw, crate, scene } = await lit(spot)
    const point = scene.add(new PointLight({ position: [-3, 4, 0], castShadow: true }))
    // the point light's map is new; the spot's is kept
    expect(draw()).toEqual({ drawn: 1, kept: 1 })
    expect(draw()).toEqual({ drawn: 0, kept: 2 })
    spot.position.x = 2
    expect(draw()).toEqual({ drawn: 1, kept: 1 })
    point.position.y = 5
    expect(draw()).toEqual({ drawn: 1, kept: 1 })
    crate.position.x = 0.5
    expect(draw()).toEqual({ drawn: 2, kept: 0 })
    expect(draw()).toEqual({ drawn: 0, kept: 2 })
  })

  it('draw a point cube again when the light moves a little - each face seeing the same casters', async () => {
    const point = new PointLight({ position: [0, 4, 0], castShadow: true })
    const { draw } = await lit(point)
    expect(draw()).toEqual(KEPT)
    point.position.x = 0.05
    expect(draw()).toEqual(DRAWN)
    expect(draw()).toEqual(KEPT)
  })

  it("draw a spot atlas again when any one of its lights' casters change", async () => {
    const a = new SpotLight({ position: [3, 5, 3], direction: [-1, -2, -1], angle: 0.6, castShadow: true })
    const { draw, scene } = await lit(a)
    const b = scene.add(new SpotLight({ position: [-3, 5, 3], direction: [1, -2, -1], angle: 0.6, castShadow: true }))
    draw()
    expect(draw()).toEqual(KEPT)
    b.angle = 0.5
    expect(draw()).toEqual(DRAWN)
  })
})

describe('the ground shadow', () => {
  it('is kept while the solids are still, and drawn again when they or its settings change', async () => {
    const { draw, crate, renderer } = await lit(new DirectionalLight({ direction: [0, -1, 0] }), { groundShadow: true })
    expect(draw()).toEqual(KEPT)
    expect(draw(new PerspectiveCamera({ position: [-5, 2, 7], target: [0, 0, 0], aspect: 1 }))).toEqual(KEPT)
    crate.position.x = 1
    expect(draw()).toEqual(DRAWN)
    renderer.groundShadow = { softness: 0.9 }
    expect(draw()).toEqual(DRAWN)
    // opacity is laid on when drawn, not in the map
    renderer.groundShadow = { softness: 0.9, opacity: 0.2 }
    expect(draw()).toEqual(KEPT)
  })

  it('is drawn again into new targets after being off long enough for the pool to free its own', async () => {
    const { draw, renderer } = await lit(new DirectionalLight({ direction: [0, -1, 0] }), { groundShadow: true })
    expect(draw()).toEqual(KEPT)
    renderer.groundShadow = false
    for (let i = 0; i < 40; i++) draw()
    // the same solids and settings as when it was last drawn - but its targets went back to the pool
    renderer.groundShadow = true
    expect(draw()).toEqual(DRAWN)
    expect(draw()).toEqual(KEPT)
  })
})
