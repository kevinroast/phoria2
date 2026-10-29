// Bugs found by the code review of 2026-10-29 (REVIEW.md), each pinned by the case that showed it.
import { afterAll, describe, expect, it } from 'vitest'
import { Group, InstancedMesh, Lines, Mesh, Node, PerspectiveCamera, Raycaster, Scene, Texture, View, WebGLRenderer, box, sphere } from '../src/index.js'
import { chart } from '../src/charts/index.js'
import { fakeCanvas, fakeGL, fakePage } from './fakes.js'

const page = fakePage()
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 50))
  page.restore()
})

describe('the frame loop', () => {
  it('keeps going after a frame that throws', () => {
    const view = new View({ canvas: page.canvas() })
    let calls = 0
    view.scene.add(new Node({ onUpdate: () => { if (++calls === 1) throw new Error('a bad handler') } }))
    view.start()
    expect(() => page.frame(16)).toThrow('a bad handler')
    // the next frame was still asked for, and runs
    expect(page.pending).toBeGreaterThan(0)
    page.frame(32)
    expect(calls).toBe(2)
    view.dispose()
  })
})

describe('changing the graph inside update handlers', () => {
  it('moves a node to another parent without crashing, and runs it once', () => {
    const scene = new Scene()
    const shelf = scene.add(new Group({ name: 'shelf' }))
    const hand = scene.add(new Group({ name: 'hand' }))
    let runs = 0
    const box1 = shelf.add(new Node({ name: 'box', onUpdate: (n) => { runs++; hand.add(n) } }))
    shelf.add(new Node({ name: 'other' }))
    expect(() => scene.update(1 / 60, 0)).not.toThrow()
    expect(box1.parent).toBe(hand)
    // the hand is walked after the shelf, but the box ran once this frame
    expect(runs).toBe(1)
  })

  it('keeps a node removed and added again in one handler - a reorder', () => {
    const scene = new Scene()
    const a = scene.add(new Node({ name: 'a' }))
    scene.add(new Node({ name: 'b', onUpdate: () => { scene.remove(a); scene.add(a) } }))
    scene.update(1 / 60, 0)
    expect(scene.children.map((n) => n.name)).toEqual(['b', 'a'])
    expect(a.parent).toBe(scene)
  })

  it('lets traverse() remove nodes without skipping their siblings', () => {
    const group = new Group()
    for (const name of ['tmp1', 'tmp2', 'keep', 'tmp3']) group.add(new Mesh({ name, geometry: box() }))
    group.traverse((n) => { if (n.name.startsWith('tmp')) n.removeFromParent() })
    expect(group.children.map((n) => n.name)).toEqual(['keep'])
  })
})

describe('an HDR background', () => {
  it("is prefiltered before the scene's target is bound, so the scene draws full size", async () => {
    const { gl: base } = fakeGL()
    const log = []
    const gl = new Proxy(base, {
      get(target, key) {
        if (key === 'getExtension') return (name) => (name === 'EXT_color_buffer_float' ? {} : target.getExtension(name))
        if (key === 'viewport') return (...a) => log.push(`viewport ${a.join(',')}`)
        if (key === 'drawElements') return () => log.push('draw')
        return target[key]
      },
    })
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl) })
    renderer.setSize(400, 300, 1)
    const hdr = new Texture({ image: { width: 64, height: 32, data: new Float32Array(64 * 32 * 4) }, colorSpace: 'linear', mipmaps: false })
    // the environment is another texture (or the built-in studio), so the background prefilters on its own
    const scene = new Scene({ background: hdr, environment: 'studio' })
    scene.add(new Mesh({ geometry: box() }))
    const camera = new PerspectiveCamera({ position: [0, 0, 5], aspect: 4 / 3 })
    renderer.render(scene, camera)
    await new Promise((r) => setTimeout(r, 50))
    log.length = 0
    renderer.render(scene, camera)
    const drawAt = log.indexOf('draw')
    expect(drawAt).toBeGreaterThan(-1)
    expect(log.slice(0, drawAt).filter((l) => l.startsWith('viewport')).at(-1)).toBe('viewport 0,0,400,300')
  })
})

describe("the network chart's hover", () => {
  const nodes = (n) => Array.from({ length: n }, (_, i) => ({ id: `n${i}` }))
  const ring = (ns) => ns.map((x, i) => ({ source: x.id, target: ns[(i + 1) % ns.length].id }))
  const parts = (c) => ({
    mesh: c.marks.find((m) => m instanceof InstancedMesh),
    // the hovered node's links, drawn over the rest
    active: c.marks.find((m) => m instanceof Lines && !m.pickable),
  })

  it('survives the hovered node leaving the data', () => {
    const scene = new Scene()
    const c = scene.add(chart({ mark: 'network', data: { nodes: nodes(10), links: ring(nodes(10)) } }))
    c.onHover({ node: parts(c).mesh, instance: 9 })
    c.update({ nodes: nodes(5), links: ring(nodes(5)) })
    // through the update's transition and past it
    for (let i = 1; i <= 20; i++) expect(() => scene.update(0.05, i * 0.05)).not.toThrow()
    expect(parts(c).active.visible).toBe(false)
  })

  it('keeps highlighting the same node when the rows are reordered', () => {
    const scene = new Scene()
    const ns = nodes(6)
    const c = scene.add(chart({ mark: 'network', data: { nodes: ns, links: ring(ns) } }))
    const { mesh, active } = parts(c)
    c.onHover({ node: mesh, instance: 0 })
    c.update({ nodes: [...ns].reverse(), links: ring(ns) })
    for (let i = 1; i <= 20; i++) scene.update(0.05, i * 0.05)
    // n0 is now the last row; its two links start or end where it is drawn
    const row = mesh.data.findIndex((r) => r.id === 'n0')
    const at = [...mesh.instanceMatrices.subarray(row * 16 + 12, row * 16 + 15)]
    const p = active.geometry.positions
    const ends = Array.from({ length: p.length / 3 }, (_, i) => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]])
    expect(ends).toHaveLength(4)
    expect(ends.filter((e) => e.every((v, k) => Math.abs(v - at[k]) < 1e-5))).toHaveLength(2)
  })
})

describe('picking rays', () => {
  it('aim the same way whatever the far plane, infinite included', () => {
    const aim = (far) => {
      const camera = new PerspectiveCamera({ position: [5, 3, 10], target: [5, 3, 0], aspect: 1, far })
      return new Raycaster().setFromCamera([0.5, 0], camera).ray.direction.toArray()
    }
    const sane = aim(100)
    for (const far of [1e7, Infinity]) aim(far).forEach((v, i) => expect(v).toBeCloseTo(sane[i], 5))
    // half way to the right edge, level: right and ahead, not down
    expect(sane[0]).toBeGreaterThan(0)
    expect(sane[1]).toBeCloseTo(0, 5)
    expect(sane[2]).toBeLessThan(0)
  })
})

describe('a restored context', () => {
  it('asks for its extensions again - the lost context took them with it', () => {
    const { gl: base } = fakeGL()
    const asked = []
    const gl = new Proxy(base, {
      get(target, key) {
        if (key === 'getExtension') return (name) => { asked.push(name); return target.getExtension(name) }
        return target[key]
      },
    })
    /** @type {Record<string, (e: any) => void>} */
    const on = {}
    const canvas = { width: 0, height: 0, getContext: (type) => (type === 'webgl2' ? gl : null), addEventListener: (type, fn) => { on[type] = fn }, removeEventListener() {} }
    const renderer = new WebGLRenderer({ canvas })
    renderer.setSize(10, 10, 1)
    const scene = new Scene()
    scene.add(new Mesh({ geometry: box(), material: { map: new Texture({ image: { data: new Uint8Array(16), width: 2, height: 2 } }) } }))
    const camera = new PerspectiveCamera({ position: [0, 0, 5], aspect: 1 })
    renderer.render(scene, camera)
    asked.length = 0
    on.webglcontextlost({ preventDefault() {} })
    on.webglcontextrestored({})
    renderer.render(scene, camera)
    expect(asked).toContain('KHR_parallel_shader_compile')
    expect(asked).toContain('EXT_texture_filter_anisotropic')
    renderer.dispose()
  })
})

describe('an instanced mesh given another geometry', () => {
  it('draws the new one, and keeps it when the old one is disposed', () => {
    const { gl: base } = fakeGL()
    const counts = [], deleted = [], drawnFrom = []
    let bound = null
    const gl = new Proxy(base, {
      get(target, key) {
        if (key === 'bindVertexArray') return (vao) => { bound = vao; target.bindVertexArray(vao) }
        if (key === 'drawElementsInstanced') return (_mode, count) => { counts.push(count); drawnFrom.push(bound) }
        if (key === 'deleteVertexArray') return (vao) => { deleted.push(vao); target.deleteVertexArray(vao) }
        return target[key]
      },
    })
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl) })
    renderer.setSize(10, 10, 1)
    const scene = new Scene()
    const crate = box()
    const many = scene.add(new InstancedMesh({ geometry: crate, count: 3 }))
    const camera = new PerspectiveCamera({ position: [0, 0, 5], aspect: 1 })
    renderer.render(scene, camera)
    expect(counts.at(-1)).toBe(crate.elementCount)
    const boxBuffers = drawnFrom.at(-1)

    const ball = sphere()
    many.geometry = ball
    renderer.render(scene, camera)
    // drawn from buffers of its own - not the sphere's count from the box's buffers
    expect(drawnFrom.at(-1)).not.toBe(boxBuffers)
    expect(counts.at(-1)).toBe(ball.elementCount)
    expect(renderer.info.geometries).toBe(1)

    // the box's buffers went with the swap; disposing it now frees nothing of the sphere's
    const before = deleted.length
    crate.dispose()
    expect(deleted.length).toBe(before)
    renderer.render(scene, camera)
    expect(counts.at(-1)).toBe(ball.elementCount)
    expect(renderer.info.geometries).toBe(1)
  })
})

describe('a camera set on the view', () => {
  it('stays where it was put - only a preset name is fitted to the scene', () => {
    const view = new View({ canvas: page.canvas() })
    view.scene.add(new Mesh({ geometry: box() }))
    view.camera = new PerspectiveCamera({ position: [0, 0, 50], target: [0, 0, 0] })
    view.render()
    expect(view.camera.position.toArray()).toEqual([0, 0, 50])
    // a preset is still fitted
    view.camera = 'front'
    view.render()
    expect(view.camera.position.distanceTo([0, 0, 0])).toBeLessThan(10)
    view.dispose()
  })
})
