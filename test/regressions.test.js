// Bugs found by the code review of 2026-10-29 (REVIEW.md), each pinned by the case that showed it.
import { Buffer } from 'node:buffer'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { DirectionalLight, OrbitControl, OrthographicCamera, collect, Geometry, Group, InstancedMesh, Label, Lines, Material, Mesh, Node, PerspectiveCamera, Raycaster, Scene, SpotLight, Texture, View, WebGLRenderer, box, extrude, outline, plane, sphere } from '../src/index.js'
import { chart, scaleColor, scaleLinear, scaleTime } from '../src/charts/index.js'
import { TransformHandle } from '../src/edit/index.js'
import { Animation, parseGLTF } from '../src/gltf/index.js'
import { Vec3 } from '../src/value/Vec3.js'
import { fakeCanvas, fakeElement, fakeGL, fakePage } from './fakes.js'

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
    const mesh = parts(c).mesh
    for (const fn of mesh.handlersFor('hover')) fn({ node: mesh, instance: 9 })
    expect(parts(c).active.visible).toBe(true)
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
    for (const fn of mesh.handlersFor('hover')) fn({ node: mesh, instance: 0 })
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

// ---- batch 2: the medium bugs

describe('interaction', () => {
  let clock = 1000
  const frame = () => page.frame((clock += 16))
  const viewOf = (options = {}) => new View({ canvas: page.canvas(), camera: { position: [0, 0, 10], target: [0, 0, 0] }, ...options })

  it('keeps a tap that wobbles a pixel or two a click, with orbit on - and a drag not one', () => {
    const view = viewOf({ orbit: true })
    let clicks = 0
    view.on('click', () => clicks++)
    const c = /** @type {any} */ (view.canvas)
    /** Press, move, let go and click - as a browser sends them. */
    const gesture = (dx) => {
      c.dispatch('pointerdown', { clientX: 100, clientY: 50, button: 0, pointerId: 1, pointerType: 'touch' })
      c.dispatch('pointermove', { clientX: 100 + dx, clientY: 51, pointerId: 1, pointerType: 'touch' })
      c.dispatch('pointerup', { clientX: 100 + dx, clientY: 51, pointerId: 1, pointerType: 'touch' })
      c.dispatch('click', { clientX: 100 + dx, clientY: 51 })
    }
    gesture(2)
    expect(clicks).toBe(1)
    gesture(30)
    expect(clicks).toBe(1)
    view.dispose()
  })

  it('frames content that arrives late even while auto-rotating', () => {
    const view = new View({ canvas: page.canvas(), orbit: { autoRotate: true } })
    view.start()
    for (let i = 0; i < 5; i++) frame()
    // a big model, loaded a few frames in
    view.scene.add(new Mesh({ geometry: box(40) }))
    frame()
    expect(view.camera.position.distanceTo(/** @type {any} */ (view.camera).target)).toBeGreaterThan(40)
    view.dispose()
  })

  it('aims cameras with a target, and lights, with lookAt', () => {
    const view = viewOf()
    view.camera.lookAt([10, 0, 10])
    expect(/** @type {any} */ (view.camera).target.toArray()).toEqual([10, 0, 10])
    const sun = new DirectionalLight({ position: [0, 5, 0] })
    sun.lookAt([0, 0, -5])
    sun.worldDirection.toArray().forEach((v, i) => expect(v).toBeCloseTo([0, -Math.SQRT1_2, -Math.SQRT1_2][i], 6))
    const spot = new SpotLight({ position: [0, 5, 0], target: [0, 0, 0] })
    spot.lookAt([3, 0, 0])
    expect(spot.target?.toArray()).toEqual([3, 0, 0])
    view.dispose()
  })

  it("tells hover handlers when the pointer moves to another segment of one line", () => {
    const view = viewOf()
    view.scene.add(new Lines({ geometry: new Geometry({ positions: [-3, 0, 0, -0.5, 0, 0, 0.5, 0, 0, 3, 0, 0] }), material: { width: 6 }, data: ['A', 'B'] }))
    const seen = []
    view.on('hover', (hit) => seen.push(hit?.datum ?? null))
    view.start()
    frame()
    const canvas = /** @type {any} */ (view.canvas)
    for (const x of [-1.5, 1.5]) {
      const p = view.project([x, 0, 0])
      canvas.dispatch('pointermove', { clientX: p.x, clientY: p.y })
      frame()
    }
    expect(seen).toEqual(['A', 'B'])
    view.dispose()
  })

  it("can't pick what showFrom hides, and a pickable: false wall still hides labels", () => {
    const view = viewOf()
    view.scene.add(new Mesh({ geometry: box(2), showFrom: () => false }))
    expect(view.pick(view.project([0, 0, 0]).x, view.project([0, 0, 0]).y)).toBeNull()
    const scene = new Scene()
    scene.add(new Mesh({ geometry: box(4), position: [0, 0, 2], pickable: false }))
    scene.add(new Label({ text: 'behind', position: [0, 0, -3], occlude: true }))
    const walled = viewOf({ scene })
    walled.render()
    expect(/** @type {any} */ (walled.lastFrame)?.labels[0].occluded).toBe(true)
    view.dispose()
    walled.dispose()
  })
})

describe('materials and geometry', () => {
  const pixels = (o = {}) => new Texture({ image: { data: new Uint8Array(4), width: 1, height: 1 }, ...o })

  it('reads a texture in a data slot as numbers, unless its colour space was chosen', () => {
    const left = pixels()
    new Material({ normalMap: left })
    expect(left.colorSpace).toBe('linear')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const chosen = pixels({ colorSpace: 'srgb' })
    new Material({ roughnessMap: chosen })
    expect(chosen.colorSpace).toBe('srgb')
    expect(warn.mock.calls.flat().join(' ')).toContain("should be colorSpace: 'linear'")
    warn.mockRestore()
    // a colour map keeps colour
    const photo = pixels()
    new Material({ map: photo })
    expect(photo.colorSpace).toBe('srgb')
  })

  it('clones colours exactly - past 1, mixed, and dim', () => {
    const m = new Material()
    m.color.set([1, 0.5, 0.25]).multiplyScalar(2)
    m.emissive.set('#ff0000').multiplyScalar(4e-5)
    const copy = m.clone()
    expect([...copy.color]).toEqual([...m.color])
    expect([...copy.emissive]).toEqual([...m.emissive])
  })

  it("saves a generator's geometry as its arrays once edited, and as the generator until then", () => {
    const g = box(1)
    expect(g.normals.length).toBeGreaterThan(0)
    expect(g.toJSON()).toMatchObject({ type: 'box' })
    g.positions[0] += 5
    g.needsUpdate()
    const saved = /** @type {any} */ (g.toJSON())
    expect(saved.type).toBeUndefined()
    expect(saved.positions[0]).toBeCloseTo(5.5, 5)
  })

  it('extrudes a pill - a rect rounded by half its height - with no creased or empty normals', () => {
    const pill = extrude({ shape: outline.rect({ width: 2, height: 1, radius: 0.5 }), depth: 0.2 })
    const n = pill.normals
    for (let i = 0; i < n.length; i += 3) expect(Math.hypot(n[i], n[i + 1], n[i + 2])).toBeCloseTo(1, 5)
    // the side at the far right faces straight out
    const p = pill.positions
    for (let i = 0; i < p.length; i += 3) {
      if (Math.abs(p[i] - 1) < 1e-6 && Math.abs(p[i + 1]) < 1e-6 && Math.abs(n[i + 2]) < 1e-6) expect(n[i]).toBeCloseTo(1, 5)
    }
  })
})

describe('charts', () => {
  it('stacks lines and areas in depth on their own series, inside the box', () => {
    const rows = []
    for (const z of ['a', 'b', 'c']) for (let x = 0; x < 4; x++) rows.push({ x, z, y: 5 })
    const c = chart({ mark: 'area', data: rows, x: 'x', y: 'y', z: 'z', stack: true })
    const top = c.scales.y.range[1]
    for (const m of c.marks) {
      const p = /** @type {any} */ (m).geometry.positions
      for (let i = 1; i < p.length; i += 3) expect(p[i]).toBeLessThanOrEqual(top + 1e-5)
    }
  })

  it("keeps the app's onHover on a network chart", () => {
    const seen = []
    const ns = [{ id: 'a' }, { id: 'b' }]
    const c = chart({ mark: 'network', data: { nodes: ns, links: [{ source: 'a', target: 'b' }] }, onHover: (hit) => seen.push(hit) })
    c.onHover?.(null)
    expect(seen).toEqual([null])
  })

  it('picks a ramp or categories from the colour field’s type, not its values', () => {
    const years = chart({ mark: 'point', data: [{ x: 1, y: 1, yr: 2024 }, { x: 2, y: 2, yr: 2025 }], x: 'x', y: 'y', color: { field: 'yr', type: 'nominal' } })
    expect(years.scales.color?.kind).toBe('categorical')
    // a diverging domain stays a ramp: 75 is between the middle and the top colour
    const ramp = scaleColor({ kind: 'sequential', domain: [0, 50, 100], range: ['#0000ff', '#ffffff', '#ff0000'] })
    const c = ramp(75).toSRGB()
    expect(c[0]).toBeCloseTo(1, 2)
    expect(c[1]).toBeGreaterThan(0.3)
    expect(c[1]).toBeLessThan(0.9)
    // one colour is a flat ramp, not a crash
    expect(scaleColor({ kind: 'sequential', domain: [0, 1], range: ['#ff0000'] })(0.5).getHex()).toBe(0xff0000)
  })

  it('takes a network update that replaces every node', () => {
    const scene = new Scene()
    const nodes = (p, n) => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}` }))
    const ring = (ns) => ns.map((x, i) => ({ source: x.id, target: ns[(i + 1) % ns.length].id }))
    const c = scene.add(chart({ mark: 'network', data: { nodes: nodes('a', 10), links: ring(nodes('a', 10)) } }))
    expect(() => c.update({ nodes: nodes('b', 11), links: ring(nodes('b', 11)) })).not.toThrow()
    for (let i = 1; i <= 20; i++) scene.update(0.05, i * 0.05)
    const mesh = /** @type {any} */ (c.marks.find((m) => m instanceof InstancedMesh))
    expect(mesh.count).toBe(11)
  })

  it('puts time ticks on round calendar times, across daylight saving too', () => {
    const ticks = (a, b, n) => scaleTime({ domain: [a, b] }).ticks(n)
    expect(ticks('2026-01-15', '2027-01-15', 5).map((d) => d.getMonth())).toEqual([3, 6, 9, 0])
    expect(ticks('2026-03-03T10:07:30', '2026-03-03T11:07:30', 5).map((d) => d.getMinutes())).toEqual([15, 30, 45, 0])
    // days through the end of summer time in Europe and the US: every tick at midnight, local time
    for (const d of ticks('2026-10-20', '2026-11-08', 8)) expect([d.getHours(), d.getMinutes()]).toEqual([0, 0])
  })

  it('labels close ticks on a big number apart', () => {
    const s = scaleLinear({ domain: [10000, 10010] })
    const labels = s.ticks().map((v) => s.format(v))
    expect(new Set(labels).size).toBe(labels.length)
  })
})

describe('editors and glTF', () => {
  // a stand-in view: what the handle uses of one
  const handleView = () => ({ scene: new Scene(), camera: new PerspectiveCamera({ position: [0, 10, 10] }), canvas: { clientHeight: 600 }, invalidate() {} })
  const yawDegrees = (n) => 2 * Math.atan2(n.quaternion[1], n.quaternion[3]) * 180 / Math.PI
  /** Sweep the ring from one angle to another, in degrees round from +x in x, z. */
  const turn = (handle, from, to) => {
    const ring = handle.node.children.find((c) => c.name === 'ring')
    const at = (d) => new Vec3(Math.cos(d * Math.PI / 180), 0, Math.sin(d * Math.PI / 180))
    ring.onDrag({ phase: 'start', ray: { intersectPlane: () => 0, at: () => at(from) }, plane: null })
    ring.onDrag({ phase: 'move', point: at(to), delta: new Vec3() })
    ring.onDrag({ phase: 'end' })
  }

  it('turns a target by the ring the same way, whatever its yaw - past 90 degrees too', () => {
    const view = /** @type {any} */ (handleView())
    for (const start of [60, 120, -150]) {
      const target = view.scene.add(new Group())
      target.quaternion.set(0, Math.sin(start * Math.PI / 360), 0, Math.cos(start * Math.PI / 360))
      const handle = new TransformHandle({ view, target })
      turn(handle, 0, -10)
      // the pointer swept 10 degrees anticlockwise seen from above: the target turns 10 degrees the same way
      expect(((yawDegrees(target) - start + 540) % 360) - 180).toBeCloseTo(10, 4)
      handle.dispose()
    }
  })

  it("gives a target back its own onDrag, even after dragTarget is turned off", () => {
    const view = /** @type {any} */ (handleView())
    const a = view.scene.add(new Group()), b = view.scene.add(new Group())
    const own = () => {}
    a.onDrag = own
    const handle = new TransformHandle({ view, target: a })
    handle.dragTarget = false
    handle.target = b
    expect(a.onDrag).toBe(own)
  })

  it('plays a clip that stops at its end from the first frame, and holds a one-key pose', () => {
    const node = new Group()
    const clip = new Animation('wave', [{ node, path: 'position', interpolation: 'LINEAR', times: new Float32Array([0, 1]), values: new Float32Array([0, 0, 0, 2, 0, 0]) }])
    clip.loop = false
    clip.play()
    clip.advance(0)
    expect(clip.playing).toBe(true)
    clip.advance(0.5)
    expect(node.position[0]).toBeCloseTo(1, 5)
    const posed = new Group()
    const pose = new Animation('pose', [{ node: posed, path: 'position', interpolation: 'LINEAR', times: new Float32Array([0]), values: new Float32Array([3, 0, 0]) }])
    pose.play()
    pose.advance(1 / 60)
    expect(posed.position[0]).toBe(3)
  })
})

describe('glTF triangle strips', () => {
  it('get normals from their real triangles when the file has none', async () => {
    // a square as a strip of two triangles, with no NORMAL
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0])
    const json = {
      asset: { version: '2.0' },
      buffers: [{ byteLength: positions.byteLength, uri: `data:application/octet-stream;base64,${Buffer.from(positions.buffer).toString('base64')}` }],
      bufferViews: [{ buffer: 0, byteLength: positions.byteLength }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 5 }] }],
      nodes: [{ mesh: 0 }],
      scenes: [{ nodes: [0] }],
    }
    const model = await parseGLTF(json)
    const n = model.meshes[0].geometry.normals
    for (let i = 0; i < n.length; i += 3) expect(Math.abs(n[i + 2])).toBeCloseTo(1, 5)
  })
})

describe('rendering', () => {
  /** A renderer on a stand-in context that keeps its shader sources, and counts deleted renderbuffers. */
  const recording = () => {
    const { gl: base } = fakeGL()
    const sources = []
    let freed = 0
    const gl = new Proxy(base, {
      get(target, key) {
        if (key === 'shaderSource') return (_shader, source) => sources.push(source)
        if (key === 'deleteRenderbuffer') return () => { freed++ }
        return target[key]
      },
    })
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl) })
    renderer.setSize(10, 10, 1)
    return { renderer, sources, freed: () => freed }
  }
  const camera = () => new PerspectiveCamera({ position: [0, 3, 6], target: [0, 0, 0], aspect: 1 })
  const ready = async (renderer) => {
    let n = 0
    renderer.onReady = () => n++
    await vi.waitFor(() => expect(n).toBeGreaterThan(0))
  }

  it("lights a flat-shaded double-sided face from the side it's seen", () => {
    const { renderer, sources } = recording()
    const scene = new Scene()
    scene.add(new DirectionalLight())
    scene.add(new Mesh({ geometry: box(), material: { flatShading: true, doubleSided: true } }))
    renderer.render(scene, camera())
    const mesh = sources.find((s) => s.includes('#define FLAT_SHADING') && s.includes('#define DOUBLE_SIDED') && s.includes('fragColor = vec4(linearToSrgb'))
    // the screen-space normal already faces the camera, so the back-face flip is skipped for it
    expect(mesh).toContain('#if defined(DOUBLE_SIDED) && !defined(FLAT_SHADING)')
  })

  it("casts a triplanar cut-out's shadow from its projected holes", async () => {
    const { renderer, sources } = recording()
    const scene = new Scene()
    scene.add(new DirectionalLight({ direction: [0, -1, -0.3], castShadow: true }))
    const leaves = new Texture({ image: { data: new Uint8Array([255, 255, 255, 0]), width: 1, height: 1 } })
    scene.add(new Mesh({ geometry: box(), castShadow: true, material: { map: leaves, alphaTest: 0.5, triplanar: 4 } }))
    scene.add(new Mesh({ geometry: plane(6), receiveShadow: true }))
    renderer.render(scene, camera())
    await ready(renderer)
    renderer.render(scene, camera())
    const depth = sources.filter((s) => s.includes('fragColor = vec4(1.0)') && s.includes('#define ALPHA_TEST'))
    expect(depth.some((s) => s.includes('#define TRIPLANAR') && s.includes('alpha *= SAMPLE(uMap).a') && s.includes('vec4 triplanar('))).toBe(true)
  })

  it("frees bloom's buffers once no view wants bloom", async () => {
    const { renderer, freed } = recording()
    const scene = new Scene()
    scene.add(new Mesh({ geometry: box(), material: { emissive: '#ffffff' } }))
    renderer.bloom = true
    renderer.render(scene, camera())
    await ready(renderer)
    renderer.render(scene, camera())
    expect(freed()).toBe(0)
    renderer.bloom = false
    renderer.render(scene, camera())
    expect(freed()).toBeGreaterThan(0)
  })
})

describe('lifecycle and labels', () => {
  it('takes the canvas it made off the page when disposed - and leaves one it was given', () => {
    const made = new View()
    const own = /** @type {any} */ (made.canvas)
    made.dispose()
    expect(own.removed).toBe(true)
    const given = page.canvas()
    new View({ canvas: given }).dispose()
    expect(/** @type {any} */ (given).removed).toBe(false)
  })

  it('keeps its size while its canvas is hidden', () => {
    // at a pixel ratio of 2, where the buffer's size isn't the CSS size it would fall back to
    const dpr = globalThis.devicePixelRatio
    globalThis.devicePixelRatio = 2
    const canvas = /** @type {any} */ (page.canvas())
    const view = new View({ canvas })
    expect(view.width).toBe(300)
    canvas.clientWidth = 0
    canvas.clientHeight = 0
    view.resize()
    expect([view.width, canvas.width]).toEqual([300, 600])
    view.dispose()
    globalThis.devicePixelRatio = dpr
  })

  it("doesn't grow a canvas sized only by its attributes on a high-DPI screen", () => {
    const dpr = globalThis.devicePixelRatio
    globalThis.devicePixelRatio = 2
    const canvas = /** @type {any} */ (page.canvas())
    const view = new View({ canvas })
    expect(canvas.width).toBe(600)
    // with no CSS size, the canvas lays out at its new attribute size: twice as big
    canvas.clientWidth = 600
    canvas.clientHeight = 300
    view.resize()
    expect(view.width).toBe(300)
    expect(canvas.width).toBe(600)
    expect(canvas.style.width).toBe('300px')
    view.dispose()
    globalThis.devicePixelRatio = dpr
  })

  it('orders labels by distance with an orthographic camera, and hides those behind it', () => {
    const scene = new Scene()
    scene.add(new Label({ text: 'near', position: [0, 0, 2] }))
    scene.add(new Label({ text: 'far', position: [0, 0, -4] }))
    scene.add(new Label({ text: 'behind', position: [0, 0, 30] }))
    scene.updateWorldTree()
    const frame = collect(scene, new OrthographicCamera({ position: [0, 0, 20], target: [0, 0, 0], height: 10, aspect: 1 }))
    const by = Object.fromEntries(frame.labels.map((l) => [l.text, l]))
    expect(by.near.depth).toBeCloseTo(18, 4)
    expect(by.far.depth).toBeCloseTo(24, 4)
    expect(by.behind.visible).toBe(false)
  })
})

describe('change watching', () => {
  it('redraws when a node that keeps its own matrix has it edited', async () => {
    const { ChangeWatch } = await import('../src/watch.js')
    const scene = new Scene()
    const fixed = scene.add(new Mesh({ geometry: box(), matrixAutoUpdate: false }))
    const camera = new PerspectiveCamera()
    const watch = new ChangeWatch()
    watch.changed(scene, camera)
    fixed.matrix[12] = 5
    expect(watch.changed(scene, camera)).toBe(true)
  })
})

describe('handlers and the pointer', () => {
  const viewOf = (options = {}) => new View({ canvas: page.canvas(), camera: { position: [0, 0, 10], target: [0, 0, 0] }, ...options })

  it("adds hover and click listeners beside a node's own handler, without replacing it", () => {
    const view = viewOf()
    const cube = view.scene.add(new Mesh({ geometry: box(2), name: 'cube' }))
    const seen = []
    cube.onClick = () => seen.push('own')
    const stop = cube.on('click', () => seen.push('listener'))
    view.render()
    const p = view.project([0, 0, 0])
    const c = /** @type {any} */ (view.canvas)
    c.dispatch('click', { clientX: p.x, clientY: p.y })
    expect(seen).toEqual(['own', 'listener'])
    stop()
    c.dispatch('click', { clientX: p.x, clientY: p.y })
    expect(seen).toEqual(['own', 'listener', 'own'])
    expect(() => cube.on(/** @type {any} */ ('drag'), () => {})).toThrow('onDrag')
    view.dispose()
  })

  it('drags a draggable node without orbiting, orbits anywhere else, and clicks after neither', () => {
    const view = viewOf({ orbit: true })
    const moves = []
    view.scene.add(new Mesh({ geometry: box(2), onDrag: (d) => moves.push(d.phase) }))
    let clicks = 0
    view.on('click', () => clicks++)
    view.render()
    const c = /** @type {any} */ (view.canvas)
    const drag = (from, dx) => {
      c.dispatch('pointerdown', { clientX: from.x, clientY: from.y, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse' })
      for (let i = 1; i <= 4; i++) c.dispatch('pointermove', { clientX: from.x + dx * i / 4, clientY: from.y, buttons: 1, pointerId: 1, pointerType: 'mouse' })
      c.dispatch('pointerup', { clientX: from.x + dx, clientY: from.y, button: 0, pointerId: 1, pointerType: 'mouse' })
      c.dispatch('click', { clientX: from.x + dx, clientY: from.y })
    }
    const camera = view.camera.position.toArray()
    // on the box: the box is dragged, the camera stays
    drag(view.project([0, 0, 0]), 40)
    expect(moves).toContain('start')
    expect(moves.at(-1)).toBe('end')
    expect(view.camera.position.toArray()).toEqual(camera)
    // off it, in the corner: the camera orbits
    drag({ x: 10, y: 10 }, 40)
    expect(view.camera.position.toArray()).not.toEqual(camera)
    expect(clicks).toBe(0)
    view.dispose()
  })
})

// ---- from the agent eval's development pass

describe('labels that answer the pointer', () => {
  let clock = 5000
  const frame = () => page.frame((clock += 16))
  const viewOf = () => new View({ canvas: page.canvas(), camera: { position: [0, 0, 10], target: [0, 0, 0] } })

  it('makes a label of something with click or hover handlers part of it', () => {
    const view = viewOf()
    /** @type {any[]} */
    const clicks = [], hovers = []
    const core = view.scene.add(new Label({ text: 'Core', position: [-2, 2, 0], onClick: (hit) => clicks.push(hit.node) }))
    view.scene.add(new Label({ text: 'Plain', position: [2, 2, 0] }))
    const bars = view.scene.add(new InstancedMesh({ geometry: box(0.5), data: [{ n: 'a' }, { n: 'b' }], labels: { text: (r) => r.n },
      onHover: (hit) => hovers.push(hit?.datum?.n ?? null) }))
    bars.setInstance(0, { position: [-2, -2, 0] })
    bars.setInstance(1, { position: [2, -2, 0] })
    view.render()
    const root = /** @type {any} */ (view.overlay)
    const el = (text) => root.children.find((e) => e.textContent === text)
    expect(el('Core').style.pointerEvents).toBe('auto')
    expect(el('b').style.pointerEvents).toBe('auto')
    // a label of something that doesn't answer the pointer leaves it to the scene behind
    expect(el('Plain').style.pointerEvents).toBeFalsy()

    root.dispatch('click', { target: el('Core') })
    expect(clicks).toEqual([core])
    root.dispatch('click', { target: el('Plain') })
    expect(clicks).toHaveLength(1)

    // hovering an instance's label is hovering that instance, until the pointer leaves it
    root.dispatch('pointerover', { target: el('b'), clientX: 200, clientY: 120 })
    frame()
    expect(hovers.at(-1)).toBe('b')
    root.dispatch('pointerout', { target: el('b') })
    frame()
    expect(hovers.at(-1)).toBe(null)
    view.dispose()
  })
})

describe('orbiting an orthographic camera', () => {
  it('limits its zoom by the height of the view, and leaves its distance alone', () => {
    const camera = new OrthographicCamera({ position: [0, 0, 40], target: [0, 0, 0], height: 10, aspect: 1 })
    const orbit = new OrbitControl(camera, fakeElement('canvas'), { minDistance: 2, maxDistance: 20 })
    orbit.zoomBy(0.01)
    expect(camera.height).toBe(2)
    orbit.zoomBy(100)
    expect(camera.height).toBe(20)
    // turning keeps the camera where it was, though that is beyond maxDistance
    orbit.rotate(0.5, 0)
    expect(camera.position.len()).toBeCloseTo(40)
  })
})

describe('chart ticks', () => {
  const data = [{ a: 3, b: 12, c: 8 }, { a: 97, b: 40, c: 93 }]
  const camera = new PerspectiveCamera({ position: [12, 10, 16], target: [0, 2, 0], aspect: 1.5 })
  const texts = (node) => {
    node.updateWorldTree()
    return collect(node, camera).labels.map((l) => l.text)
  }

  it('marks the values an axis lists - reaching them - or about as many as it asks for', () => {
    const listed = chart({ mark: 'point', data, x: { field: 'a', axis: { ticks: [0, 25, 50, 75, 100] } }, y: 'b' })
    expect(texts(listed)).toEqual(expect.arrayContaining(['0', '25', '50', '75', '100']))
    const few = chart({ mark: 'point', data, x: { field: 'a', axis: { ticks: 2 } }, y: 'b' })
    expect(texts(few).filter((t) => ['0', '50', '100'].includes(t))).toHaveLength(3)
    expect(() => chart({ mark: 'point', data, x: 'a', y: { field: 'b', axis: { ticks: 'five' } } })).toThrow('[0, 25, 50, 75, 100]')
  })

  it('keys a number colour as a ramp with its values marked, listed ones included', () => {
    const keyed = /** @type {any} */ (chart({ mark: 'point', data, x: 'a', y: 'b', color: 'c', legend: { ticks: [0, 25, 50, 75, 100] } }))
    const [ramp, marks] = keyed.overlay.children.at(-1).children
    expect(ramp.style.background).toContain('to top')
    expect(marks.children.map((m) => m.textContent)).toEqual(['0', '25', '50', '75', '100'])
    expect(marks.children.at(-1).style.bottom).toBe('100%')
  })
})

describe('framing with a direction and a glide', () => {
  const viewOf = () => new View({ canvas: page.canvas(), camera: { position: [0, 0, 10], target: [0, 0, 0] } })

  it('glides the camera round to look from the direction given, and ends where frame() puts it', () => {
    const view = viewOf()
    const cube = view.scene.add(new Mesh({ geometry: box(2), position: [3, 0, 0] }))
    view.render()
    const camera = /** @type {any} */ (view.camera)
    const start = camera.position.toArray(), startTarget = camera.target.toArray()
    // where it should end: straight there
    view.frame(cube, { direction: 'top' })
    const there = [...camera.position.toArray(), ...camera.target.toArray()]
    camera.position.set(...start)
    camera.target.set(...startTarget)
    view.frame(cube, { direction: 'top', duration: 1 })
    // nothing moves until frames run
    expect(view.camera.position.toArray()).toEqual(start)
    view.step(0.5)
    const midway = camera.position.clone().sub(camera.target).normalize()
    expect(midway[1]).toBeGreaterThan(0.2)
    expect(midway[1]).toBeLessThan(0.99)
    view.step(0.6)
    const end = camera.position.clone().sub(camera.target).normalize()
    expect(end[1]).toBeCloseTo(1)
    ;[...camera.position.toArray(), ...camera.target.toArray()].forEach((v, i) => expect(v).toBeCloseTo(there[i]))
    // straight there without a duration; a bad direction says what it takes
    view.frame(cube, { direction: [0, 0, 1] })
    expect(camera.position.clone().sub(camera.target).normalize()[2]).toBeCloseTo(1)
    expect(() => view.frame(cube, { direction: [0, 0, 0] })).toThrow('preset name or a vector')
    expect(() => view.frame(cube, { direction: /** @type {any} */ ('above') })).toThrow("use 'top'")
    view.dispose()
  })
})

describe('points that copy what is assigned', () => {
  it("keeps a camera's target and a light's aim as the vectors they were, copying what is assigned", () => {
    const camera = new PerspectiveCamera({ position: [0, 0, 5], target: [0, 0, 0] })
    const held = camera.target
    camera.target = [1, 2, 3]
    expect(camera.target).toBe(held)
    expect(held?.toArray()).toEqual([1, 2, 3])
    camera.target = null
    expect(camera.target).toBe(null)
    const sun = new DirectionalLight()
    sun.direction = [0, 0, -4]
    expect(sun.direction.toArray()).toEqual([0, 0, -1])
    expect(() => { sun.direction = [0, 0, 0] }).toThrow("can't be [0, 0, 0]")
  })
})

describe('the first fit', () => {
  it('fits the canvas as laid out at the first frame, not as it was when the view was made', () => {
    const canvas = /** @type {any} */ (page.canvas())
    const view = new View({ canvas })
    view.scene.add(new Mesh({ geometry: box(2) }))
    // a grid of tiles filling up: this one is reshaped before the browser reports a resize
    canvas.clientWidth = 600
    view.render()
    expect(view.camera.aspect).toBe(4)
    view.dispose()
  })

  it('still fits the scene when keeping the framing moved the camera first', () => {
    const canvas = /** @type {any} */ (page.canvas())
    const view = new View({ canvas, framing: 'both' })
    view.scene.add(new Mesh({ geometry: box(2), position: [5, 0, 0] }))
    // narrower than when made: keeping 'both' in view backs the camera off before it is fitted
    canvas.clientWidth = 150
    view.render()
    expect(/** @type {any} */ (view.camera).target[0]).toBeCloseTo(5, 0)
    view.dispose()
  })
})

describe("a chart's description", () => {
  it("holds the highlight its spec gave, and none it didn't", () => {
    const data = [{ m: 'a', s: 1 }]
    expect(chart({ mark: 'bar', data, x: 'm', y: 's' }).toJSON()).not.toHaveProperty('highlight')
    expect(chart({ mark: 'bar', data, x: 'm', y: 's', highlight: '#ff0000' }).toJSON().highlight).toBe('#ff0000')
  })
})

describe('the camera recipes in llms-full.txt', () => {
  it('follows a moving node, keeping the angle it is seen from', () => {
    const view = new View({ canvas: page.canvas(), camera: { position: [0, 4, 10], target: [0, 0, 0] } })
    const planet = view.scene.add(new Mesh({ geometry: box(1), position: [3, 0, 0] }))
    planet.onUpdate((node, dt) => { node.position.x += dt * 2 })
    /** @type {any} */
    let followed = null, last = null
    // the recipe, as written
    const cam = /** @type {any} */ (view.camera)
    view.start(() => {
      if (!followed) return
      const now = followed.updateWorld().worldPosition
      if (last) {
        const moved = now.clone().sub(last)
        cam.position.add(moved)
        cam.target.add(moved)
      }
      last = now
    })
    last = null
    followed = planet
    view.frame(planet)
    const camera = /** @type {any} */ (view.camera)
    const offset = camera.position.clone().sub(camera.target).toArray()
    for (let i = 0; i < 30; i++) view.step(1 / 30)
    // still looking at the planet, from the same angle and distance
    expect(camera.target.distanceTo(planet.updateWorld().worldPosition)).toBeLessThan(0.1)
    camera.position.clone().sub(camera.target).toArray().forEach((v, i) => expect(v).toBeCloseTo(offset[i]))
    view.dispose()
  })

  it("has 'top' looking down with +x to the right and -z up the screen", () => {
    const top = new View({ canvas: page.canvas(), camera: 'top' })
    top.scene.add(new Mesh({ geometry: box(1) }))
    top.render()
    const m = top.camera.worldMatrix
    expect([m[0], m[1], m[2]].map((v) => Math.round(v) + 0)).toEqual([1, 0, 0])
    expect([m[4], m[5], m[6]].map((v) => Math.round(v) + 0)).toEqual([0, 0, -1])
    top.dispose()
  })
})

describe('multiply blending', () => {
  it('draws in the transparent pass, and a change to it redraws', async () => {
    const { ChangeWatch } = await import('../src/watch.js')
    const filter = new Material({ color: 'cyan', blending: 'multiply' })
    expect(filter.transparent).toBe(true)
    expect(() => new Material({ blending: /** @type {any} */ ('screen') })).toThrow("'multiply'")
    const scene = new Scene()
    const mesh = scene.add(new Mesh({ geometry: box(), material: { blending: 'normal' } }))
    const camera = new PerspectiveCamera()
    const watch = new ChangeWatch()
    watch.changed(scene, camera)
    mesh.material.blending = 'multiply'
    expect(watch.changed(scene, camera)).toBe(true)
  })
})
