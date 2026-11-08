// Cut-outs (alphaTest) everywhere the picture's shape matters: a leaf card, a fence or a decal is
// picked, outlined, shadowed and occluded with its holes, never as its whole rectangle. One helper
// says how each shape-only pass draws a mesh, so they can't drift apart again.
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { Geometry, Mesh, PerspectiveCamera, Scene, Texture, View, box } from '../src/index.js'
import { WebGLRenderer } from '../src/webgl/WebGLRenderer.js'
import { shapeDefines } from '../src/webgl/shape.js'
import { fakeCanvas, fakeGL, fakePage } from './fakes.js'

const camera = () => new PerspectiveCamera({ position: [0, 0, 10], target: [0, 0, 0], aspect: 1 })
const map = () => new Texture({ image: { data: new Uint8Array([255, 255, 255, 0]), width: 1, height: 1 } })
/** A leaf card: a square with a cut-out map. @param {object} [options] */
const leaf = (options = {}) => new Mesh({ geometry: box({ width: 2, height: 2, depth: 0.01 }), material: { map: map(), alphaTest: 0.5 }, ...options })
/** The defines of each program compiled whose source has `marker`. @param {string[]} sources @param {string} marker */
const definesOf = (sources, marker) => sources.filter((s) => s.includes(marker)).map((s) => [...s.matchAll(/#define (\w+)/g)].map((m) => m[1]))

describe('shapeDefines', () => {
  const item = (node) => ({ node, material: node.material, geometry: node.geometry, worldMatrix: node.worldMatrix, instances: null, clip: null, depth: 0 })

  it("adds a cut-out's alpha test and its map - projected, or from the second UV set, as the picture reads it", () => {
    expect(shapeDefines(/** @type {any} */ (item(new Mesh({ geometry: box(1) }))), true)).toEqual({ defines: [], hook: null, cutout: false })
    expect(shapeDefines(/** @type {any} */ (item(leaf())), true).defines).toEqual(['ALPHA_TEST', 'MAP'])
    const triplanar = leaf()
    triplanar.material.triplanar = 2
    expect(shapeDefines(/** @type {any} */ (item(triplanar)), true).defines).toEqual(['ALPHA_TEST', 'MAP', 'TRIPLANAR'])
    // opacity alone against the threshold, with no map
    expect(shapeDefines(/** @type {any} */ (item(new Mesh({ geometry: box(1), material: { alphaTest: 0.5, opacity: 0.4 } }))), true).defines).toEqual(['ALPHA_TEST'])
    const second = new Mesh({ geometry: new Geometry({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], uvs: [0, 0, 1, 0, 0, 1], uvs2: [0, 0, 1, 0, 0, 1] }), material: { alphaTest: 0.5, map: new Texture({ image: { data: new Uint8Array(4), width: 1, height: 1 }, uvSet: 1 }) } })
    expect(shapeDefines(/** @type {any} */ (item(second)), true).defines).toEqual(['ALPHA_TEST', 'MAP', 'UV2', 'uMapSet vUv2'])
  })
})

describe('the shape-only passes', () => {
  afterEach(() => vi.restoreAllMocks())

  it('outline masks and GPU picking draw a cut-out with its holes, as shadows already did', async () => {
    const { gl, sources } = fakeGL()
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl) })
    renderer.setSize(64, 64)
    let ready = 0
    renderer.onReady = () => ready++
    const scene = new Scene()
    const card = scene.add(leaf())
    card.outline = { color: '#ff0000' }
    renderer.render(scene, camera())
    await vi.waitFor(() => expect(ready).toBeGreaterThan(0))
    const frame = renderer.render(scene, camera())
    // the outline's mask
    expect(definesOf(sources, 'uMask;').filter((d) => d.includes('ALPHA_TEST'))).toEqual([expect.arrayContaining(['ALPHA_TEST', 'MAP'])])
    // GPU picking, once its code has loaded
    const before = ready
    renderer.pick(frame, 32, 32)
    await vi.waitFor(() => expect(ready).toBeGreaterThan(before))
    renderer.pick(frame, 32, 32)
    expect(definesOf(sources, 'uPickId')[0]).toEqual(expect.arrayContaining(['PICK', 'ALPHA_TEST', 'MAP']))
    // and the source discards what the threshold leaves out
    const pick = sources.find((s) => s.includes('uPickId'))
    expect(pick).toContain('if (alpha < uAlphaTest) discard;')
    expect(pick).toContain('cutOut();')
    renderer.dispose(scene)
  })
})

describe('picking a cut-out', () => {
  const page = fakePage()
  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 50))
    page.restore()
  })
  /** @type {View[]} */
  const made = []
  afterEach(() => {
    vi.restoreAllMocks()
    for (const v of made.splice(0)) v.dispose()
  })
  const viewOf = () => {
    const view = new View({ canvas: page.canvas(), camera: { position: [0, 0, 10], target: [0, 0, 0] } })
    made.push(view)
    return view
  }

  it('goes to the GPU however small the scene - the CPU can\'t see through its holes', () => {
    const view = viewOf()
    view.scene.add(leaf())
    view.render()
    const gpu = vi.spyOn(view.renderer, 'pick')
    view.pick(150, 75)
    expect(gpu).toHaveBeenCalled()
    // a scene as small with no cut-out picks on the CPU
    const plain = viewOf()
    plain.scene.add(new Mesh({ geometry: box(2) }))
    plain.render()
    const none = vi.spyOn(plain.renderer, 'pick')
    plain.pick(150, 75)
    expect(none).not.toHaveBeenCalled()
  })

  it("is where the GPU saw it, not on a nearer card's hole the CPU's ray met first", () => {
    const view = viewOf()
    // two cards in one mesh: the near one at z = 1, the far one at z = 0
    const quad = (z) => [-1, -1, z, 1, -1, z, 1, 1, z, -1, 1, z]
    const geometry = new Geometry({
      positions: [...quad(1), ...quad(0)], normals: Array(8).fill([0, 0, 1]).flat(),
      uvs: Array(2).fill([0, 0, 1, 0, 1, 1, 0, 1]).flat(), indices: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
    })
    const cards = view.scene.add(new Mesh({ geometry, material: { map: map(), alphaTest: 0.5 } }))
    view.render()
    // the GPU found the far card: the pixel's depth is the origin's
    const z = view.project([0, 0, 0]).depth * 2 - 1
    vi.spyOn(view.renderer, 'pick').mockImplementation((frame) => ({ item: frame.opaque[0], element: 0, ndc: [0, 0, z] }))
    const hit = view.pick(150, 75)
    expect(hit?.node).toBe(cards)
    expect(hit?.distance).toBeCloseTo(10, 3)
    expect(hit?.point.toArray().map((v) => +v.toFixed(3) || 0)).toEqual([0, 0, 0])
    // a solid mesh's CPU hit stands: the nearer card, as the GPU would also have found
    cards.material.alphaTest = 0
    vi.spyOn(view.renderer, 'pick').mockImplementation((frame) => ({ item: frame.opaque[0], element: 0, ndc: [0, 0, z] }))
    expect(view.pick(150, 75)?.distance).toBeCloseTo(9, 3)
  })
})
