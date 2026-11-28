import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { DirectionalLight, Mesh, PerspectiveCamera, Raycaster, Scene } from '../src/index.js'
import { parseGLTF } from '../src/gltf/index.js'
import { deformedBounds, posedPositions } from '../src/scene/deform.js'
import { ChangeWatch } from '../src/watch.js'
import { WebGLRenderer } from '../src/webgl/WebGLRenderer.js'
import { fakeCanvas, fakeGL } from './fakes.js'

/**
 * A .gltf with its arrays in one embedded buffer: each array a buffer view and an accessor, in the
 * order given - accessor i is arrays[i].
 * @param {{ data: Float32Array | Uint8Array | Uint16Array, type: string }[]} arrays @param {Record<string, any>} json
 */
function gltf(arrays, json) {
  const COMPONENT = (a) => (a instanceof Float32Array ? 5126 : a instanceof Uint16Array ? 5123 : 5121)
  const SIZE = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }
  const views = [], accessors = []
  let length = 0
  for (const { data, type } of arrays) {
    length = Math.ceil(length / 4) * 4
    views.push({ buffer: 0, byteOffset: length, byteLength: data.byteLength })
    const accessor = { bufferView: views.length - 1, componentType: COMPONENT(data), count: data.length / SIZE[type], type }
    if (type === 'VEC3' && data instanceof Float32Array) {
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
      for (let i = 0; i < data.length; i++) {
        min[i % 3] = Math.min(min[i % 3], data[i])
        max[i % 3] = Math.max(max[i % 3], data[i])
      }
      Object.assign(accessor, { min, max })
    }
    accessors.push(accessor)
    length += data.byteLength
  }
  const bytes = new Uint8Array(Math.ceil(length / 4) * 4)
  arrays.forEach(({ data }, i) => bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), views[i].byteOffset))
  const uri = `data:application/octet-stream;base64,${Buffer.from(bytes).toString('base64')}`
  return { asset: { version: '2.0' }, buffers: [{ byteLength: bytes.length, uri }], bufferViews: views, accessors, ...json }
}

const turn = (deg) => [0, 0, Math.sin((deg * Math.PI) / 360), Math.cos((deg * Math.PI) / 360)]

/**
 * A bar two units tall on two joints - Root at the bottom, Tip one up - its top two vertices
 * following Tip (one with a weight short of 1, as exporters round), and a clip bending Tip 90 degrees.
 */
const skinnedBar = () => gltf([
  { data: new Float32Array([-0.1, 0, 0, 0.1, 0, 0, -0.1, 2, 0, 0.1, 2, 0]), type: 'VEC3' },
  { data: new Uint16Array([0, 1, 2, 1, 3, 2]), type: 'SCALAR' },
  { data: new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), type: 'VEC4' },
  { data: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0.6, 0, 0, 0]), type: 'VEC4' },
  // inverse bind matrices: Root at the origin, Tip one up
  { data: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1]), type: 'MAT4' },
  { data: new Float32Array([0, 1]), type: 'SCALAR' },
  { data: new Float32Array([...turn(0), ...turn(90)]), type: 'VEC4' },
], {
  scene: 0,
  scenes: [{ nodes: [0, 1] }],
  nodes: [{ name: 'Bar', mesh: 0, skin: 0 }, { name: 'Root', children: [2] }, { name: 'Tip', translation: [0, 1, 0] }],
  meshes: [{ name: 'Bar', primitives: [{ attributes: { POSITION: 0, JOINTS_0: 2, WEIGHTS_0: 3 }, indices: 1, material: 0 }] }],
  materials: [{ doubleSided: true }],
  skins: [{ joints: [1, 2], inverseBindMatrices: 4 }],
  animations: [{ name: 'Bend', channels: [{ sampler: 0, target: { node: 2, path: 'rotation' } }], samplers: [{ input: 5, output: 6 }] }],
})

/** A triangle with one blend shape, 'lift', moving its top corner a unit towards +z - at 0.25 by default - and a clip raising it to 1. */
const morphedTriangle = () => gltf([
  { data: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), type: 'VEC3' },
  { data: new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 1]), type: 'VEC3' },
  { data: new Float32Array([0, 1]), type: 'SCALAR' },
  { data: new Float32Array([0, 1]), type: 'SCALAR' },
], {
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: 'Leaf', mesh: 0, weights: [0.25] }],
  meshes: [{ name: 'Leaf', weights: [0], extras: { targetNames: ['lift'] }, primitives: [{ attributes: { POSITION: 0 }, targets: [{ POSITION: 1 }] }] }],
  animations: [{ name: 'Lift', channels: [{ sampler: 0, target: { node: 0, path: 'weights' } }], samplers: [{ input: 2, output: 3 }] }],
})

/** Two clips on one node: Here holds it at x 0, There at x 2. The node rests at x 5. */
const twoClips = () => gltf([
  { data: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), type: 'VEC3' },
  { data: new Float32Array([0, 1]), type: 'SCALAR' },
  { data: new Float32Array([0, 0, 0, 0, 0, 0]), type: 'VEC3' },
  { data: new Float32Array([2, 0, 0, 2, 0, 0]), type: 'VEC3' },
], {
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: 'Box', mesh: 0, translation: [5, 0, 0] }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  animations: [
    { name: 'Here', channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }], samplers: [{ input: 1, output: 2 }] },
    { name: 'There', channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }], samplers: [{ input: 1, output: 3 }] },
  ],
})

const round = (a, d = 4) => Array.from(a, (v) => +v.toFixed(d) + 0)

describe('skinned glTF meshes', () => {
  it('load with their skin, follow their joints as an animation bends them, and are hit and bounded where they are posed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const model = await parseGLTF(skinnedBar(), { waitForTextures: false })
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
    const bar = /** @type {Mesh} */ (model.find('Bar'))
    expect(bar.skin?.joints.map((j) => j.name)).toEqual(['Root', 'Tip'])
    const d = /** @type {any} */ (bar.geometry.deform)
    // a vertex's weights made to add up to 1
    expect(round(d.weights.subarray(12, 16))).toEqual([1, 0, 0, 0])

    const scene = new Scene()
    scene.add(model)
    scene.update(0, 0)
    // in the bind pose, the bar stands as modelled
    expect(round(posedPositions(/** @type {any} */ (bar)))).toEqual([-0.1, 0, 0, 0.1, 0, 0, -0.1, 2, 0, 0.1, 2, 0])

    // played once, it holds its last frame
    model.animations[0].loop = false
    model.play('Bend')
    scene.update(0.5, 0.5)
    // half way: Tip turned 45 degrees
    expect(round(posedPositions(/** @type {any} */ (bar)).subarray(6), 3)).toEqual([-0.778, 1.636, 0, -0.636, 1.778, 0])
    scene.update(0.6, 1.1)
    // Tip turned 90 degrees about z at (0, 1): its vertices swing round to the left
    const posed = posedPositions(/** @type {any} */ (bar))
    expect(round(posed.subarray(6))).toEqual([-1, 0.9, 0, -1, 1.1, 0])
    // the bounds follow, and hold every posed vertex
    const box = deformedBounds(/** @type {any} */ (bar))
    for (let i = 0; i < posed.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        expect(posed[i + k]).toBeGreaterThanOrEqual(box.min[k] - 1e-6)
        expect(posed[i + k]).toBeLessThanOrEqual(box.max[k] + 1e-6)
      }
    }
    expect(box.min[0]).toBeLessThan(-0.9)
    // a model's bounds are exact - its posed vertices - so it can be stood on a floor by its feet
    expect(round(model.bounds.min.toArray ? model.bounds.min.toArray() : model.bounds.min)).toEqual([-1, 0, 0])
    expect(round(model.bounds.max.toArray ? model.bounds.max.toArray() : model.bounds.max)).toEqual([0.1, 1.1, 0])

    // a ray finds the bent bar where it is now, not where it was modelled
    const ray = new Raycaster()
    ray.ray.origin.set(-0.5, 0.5, 5)
    ray.ray.direction.set(0, 0, -1)
    expect(ray.intersect(scene)[0]?.node).toBe(bar)
    ray.ray.origin.set(0, 1.8, 5)
    expect(ray.intersect(scene)).toHaveLength(0)
  })

  it('draw skinned in every pass: the joints a float texture, sent again only when they move', async () => {
    const model = await parseGLTF(skinnedBar(), { waitForTextures: false })
    const bar = /** @type {Mesh} */ (model.find('Bar'))
    bar.castShadow = true
    const scene = new Scene()
    scene.add(model)
    scene.add(new DirectionalLight({ direction: [0, -1, -1], castShadow: true }))
    const { gl, sources } = fakeGL()
    let uploads = 0
    const counted = /** @type {any} */ (gl)
    counted.texSubImage2D = () => uploads++
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl) })
    renderer.setSize(64, 64)
    const camera = new PerspectiveCamera({ position: [0, 1, 6], target: [0, 1, 0], aspect: 1 })
    scene.update(0, 0)
    renderer.render(scene, camera)
    // the picture's program and the shadow's both skin it
    const skinned = sources.filter((s) => s.includes('#define SKINNED'))
    expect(skinned.length).toBeGreaterThanOrEqual(2)
    const before = uploads
    renderer.render(scene, camera)
    expect(uploads).toBe(before)
    model.play('Bend')
    scene.update(0.5, 0.5)
    renderer.render(scene, camera)
    expect(uploads).toBeGreaterThan(before)
  })
})

describe('glTF morph targets', () => {
  it('load with their names and the node\'s weights, set by name, animate, mix into rays and bounds, and redraw the view', async () => {
    const model = await parseGLTF(morphedTriangle(), { waitForTextures: false })
    const leaf = /** @type {Mesh} */ (model.find('Leaf'))
    // the node's weights over the mesh's defaults
    expect(leaf.morphs).toEqual({ lift: 0.25 })
    expect(round(posedPositions(/** @type {any} */ (leaf)).subarray(6))).toEqual([0, 1, 0.25])

    const watch = new ChangeWatch()
    const scene = new Scene()
    scene.add(model)
    const camera = new PerspectiveCamera({ position: [0, 0, 5], aspect: 1 })
    watch.changed(scene, camera)
    expect(watch.changed(scene, camera)).toBe(false)
    leaf.morphs = { lift: 0.5 }
    expect(watch.changed(scene, camera)).toBe(true)
    expect(round(posedPositions(/** @type {any} */ (leaf)).subarray(6))).toEqual([0, 1, 0.5])
    expect(deformedBounds(/** @type {any} */ (leaf)).max[2]).toBeGreaterThanOrEqual(0.5)

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    leaf.morphs = { smile: 1 }
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no morph target 'smile' - it has 'lift'"))
    warn.mockRestore()
    expect(() => { leaf.morphs = { lift: 'up' } }).toThrow('morphs.lift')

    model.animations[0].loop = false
    model.play('Lift')
    scene.update(0.5, 0.5)
    expect(leaf.morphs.lift).toBeCloseTo(0.5)
    scene.update(0.6, 1.1)
    expect(leaf.morphs.lift).toBeCloseTo(1)
    // a mesh without any has none
    expect(new Mesh({ geometry: leaf.geometry.clone() }).morphs).toEqual({})
  })

  it('draw with the targets in a texture and their weights as uniforms', async () => {
    const model = await parseGLTF(morphedTriangle(), { waitForTextures: false })
    const scene = new Scene()
    scene.add(model)
    const { gl, sources } = fakeGL()
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl) })
    renderer.setSize(64, 64)
    scene.update(0, 0)
    renderer.render(scene, new PerspectiveCamera({ position: [0, 0, 5], aspect: 1 }))
    const source = sources.find((s) => s.includes('#define MORPH 1'))
    expect(source).toContain('#define MORPH_STRIDE 1')
  })
})

describe('switching animation clips', () => {
  it('crossfades with { fade }, from the rest pose when nothing was playing - and without it, plays alongside as before', async () => {
    const model = await parseGLTF(twoClips(), { waitForTextures: false })
    const box = /** @type {Mesh} */ (model.find('Box'))
    const [here, there] = model.animations
    const scene = new Scene()
    scene.add(model)

    // from nothing playing: fades in from where it rests (x 5) to the clip's x 2
    model.play('There', { fade: 1 })
    scene.update(0.5, 0.5)
    expect(box.position[0]).toBeCloseTo(3.5)
    scene.update(0.5, 1)
    expect(box.position[0]).toBeCloseTo(2)

    // one clip to the other: half way through the fade, half of each
    model.play('Here', { fade: 1 })
    scene.update(0.5, 1.5)
    expect(box.position[0]).toBeCloseTo(1)
    scene.update(0.5, 2)
    expect(box.position[0]).toBeCloseTo(0)
    expect([here.playing, there.playing]).toEqual([true, false])

    // { fade: 0 } cuts at once
    model.play('There', { fade: 0 })
    scene.update(0.1, 2.1)
    expect(box.position[0]).toBeCloseTo(2)
    expect(here.playing).toBe(false)

    // no options: starts it and leaves the others playing, as play() always has
    model.play('Here')
    expect([here.playing, there.playing]).toEqual([true, true])
    expect(() => model.play('Here', /** @type {any} */ ({ crossFade: 1 }))).toThrow("use 'fade'")
  })
})
