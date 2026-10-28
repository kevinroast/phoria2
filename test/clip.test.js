// Section planes: a node's clip cuts its subtree away on one side of a plane - in what is drawn,
// what casts shadows, and what picking and the raycaster can hit.
import { describe, expect, it } from 'vitest'
import { Clip, DirectionalLight, Group, Lines, Mesh, PerspectiveCamera, Points, Raycaster, Scene, box, collect, create, edges } from '../src/index.js'
import { worldPlane } from '../src/clip.js'
import { ChangeWatch } from '../src/watch.js'

const camera = () => new PerspectiveCamera({ position: [0, 0, 10], target: [0, 0, 0], aspect: 1 })
const rounded = (v) => Array.from(v, (x) => Math.round(x * 1e5) / 1e5 || 0)

describe('Clip', () => {
  it('takes a normal, an offset and a cap, and says why it refuses', () => {
    const clip = new Clip({ normal: [0, 2, 0], offset: 1, cap: '#ff0000' })
    expect(clip.toJSON()).toEqual({ normal: [0, 2, 0], offset: 1, cap: '#ff0000' })
    expect(new Clip().toJSON()).toEqual({ normal: [0, 0, 1], offset: 0 })
    expect(() => new Clip({ normal: [0, 0, 0] })).toThrow("'normal' can't be [0, 0, 0]")
    expect(() => new Clip({ offset: 'far' })).toThrow("'offset' must be a number")
    expect(() => new Clip({ constant: 1 })).toThrow("use 'offset'")
    expect(() => new Clip({ color: 'red' })).toThrow("use 'cap'")
    expect(() => new Mesh({ geometry: box(), clip: 'front' })).toThrow("'clip' must be { normal, offset, cap } or null")
    expect(() => new Mesh({ geometry: box(), clippingPlanes: [] })).toThrow('use clip: { normal, offset, cap }')
  })

  it('can be set, changed in place and removed', () => {
    const mesh = new Mesh({ geometry: box() })
    expect(mesh.clip).toBeNull()
    mesh.clip = { normal: [1, 0, 0] }
    mesh.clip.offset = 0.25
    expect(mesh.clip.toJSON()).toEqual({ normal: [1, 0, 0], offset: 0.25 })
    mesh.clip = null
    expect(mesh.clip).toBeNull()
  })

  it('round-trips through descriptions', () => {
    const group = create({ type: 'group', clip: { normal: [0, 1, 0], offset: 2, cap: '#00ff00' }, children: [{ type: 'mesh', geometry: { type: 'box' } }] })
    expect(group.toJSON().clip).toEqual({ normal: [0, 1, 0], offset: 2, cap: '#00ff00' })
    expect(group.clone().clip?.toJSON()).toEqual({ normal: [0, 1, 0], offset: 2, cap: '#00ff00' })
  })
})

describe('worldPlane', () => {
  it('lies in the node’s own space, moving and turning with it', () => {
    // offset 1 along x, on a node moved 2 along x: the plane is at x = 3, cutting away beyond it
    const node = new Group({ position: [2, 0, 0], clip: { normal: [1, 0, 0], offset: 1 } })
    node.updateWorld()
    expect(rounded(worldPlane(node))).toEqual([1, 0, 0, -3])
    // turned a quarter about y, +x points to -z
    const turned = new Group({ rotation: [0, Math.PI / 2, 0], clip: { normal: [1, 0, 0], offset: 1 } })
    turned.updateWorld()
    expect(rounded(worldPlane(turned))).toEqual([0, 0, -1, -1])
  })

  it('keeps the normal unit length and the right way round under scaling and mirroring', () => {
    // stretched along x, the plane's offset stretches with it
    const stretched = new Group({ scale: [3, 1, 1], clip: { normal: [1, 0, 0], offset: 1 } })
    stretched.updateWorld()
    expect(rounded(worldPlane(stretched))).toEqual([1, 0, 0, -3])
    // a slanted normal under a non-uniform scale stays perpendicular to the plane
    const skewed = new Group({ scale: [2, 1, 1], clip: { normal: [1, 1, 0], offset: 0 } })
    skewed.updateWorld()
    const p = worldPlane(skewed)
    expect(Math.hypot(p[0], p[1], p[2])).toBeCloseTo(1, 6)
    // the plane x/2 + y = 0 in world space: (2, -1) is on it
    expect(p[0] * 2 + p[1] * -1).toBeCloseTo(0, 6)
    // mirrored in x: the side cut away is mirrored too
    const mirrored = new Group({ scale: [-1, 1, 1], clip: { normal: [1, 0, 0], offset: 1 } })
    mirrored.updateWorld()
    expect(rounded(worldPlane(mirrored))).toEqual([-1, 0, 0, -1])
  })
})

describe('clipping in frames', () => {
  it('gives every mesh under a clip its plane and cap; the nearest clip wins', () => {
    const scene = new Scene()
    const outer = scene.add(new Group({ clip: { normal: [1, 0, 0], cap: '#ff0000' } }))
    const a = outer.add(new Mesh({ geometry: box() }))
    const inner = outer.add(new Group({ position: [0, 1, 0], clip: { normal: [0, 1, 0], offset: 0.5 } }))
    const b = inner.add(new Mesh({ geometry: box() }))
    const free = scene.add(new Mesh({ geometry: box(), position: [0, -2, 0] }))
    scene.updateWorldTree()
    const frame = collect(scene, camera())
    const item = (node) => frame.opaque.find((i) => i.node === node)
    expect(rounded(item(a).clip.plane)).toEqual([1, 0, 0, 0])
    expect(item(a).clip.cap.getHex()).toBe(0xff0000)
    // inner's own clip, in its own space: y = 1 + 0.5
    expect(rounded(item(b).clip.plane)).toEqual([0, 1, 0, -1.5])
    expect(item(b).clip.cap).toBeNull()
    expect(item(free).clip).toBeNull()
  })

  it('leaves out meshes cut away whole, but not points or lines', () => {
    const scene = new Scene()
    const cut = scene.add(new Group({ clip: { normal: [1, 0, 0], offset: 0 } }))
    const gone = cut.add(new Mesh({ geometry: box(), position: [3, 0, 0] }))
    const half = cut.add(new Mesh({ geometry: box(), position: [0, 0, 0] }))
    const dots = cut.add(new Points({ geometry: box().clone(), position: [3, 0, 0] }))
    const outline = cut.add(new Lines({ geometry: edges(box()), position: [3, 0, 0] }))
    scene.updateWorldTree()
    const frame = collect(scene, camera())
    const drawn = [...frame.opaque, ...frame.transparent]
    expect(drawn.some((i) => i.node === gone)).toBe(false)
    expect(drawn.find((i) => i.node === half)?.clip).not.toBeNull()
    // points and lines aren't cut, so they keep no plane
    expect(drawn.find((i) => i.node === dots)?.clip).toBeNull()
    expect(drawn.find((i) => i.node === outline)?.clip).toBeNull()
  })

  it('cuts shadow casters with the same plane', () => {
    const scene = new Scene()
    scene.add(new DirectionalLight({ direction: [0, -1, 0], castShadow: true }))
    const group = scene.add(new Group({ clip: { normal: [0, 0, 1] } }))
    const caster = group.add(new Mesh({ geometry: box(), castShadow: true }))
    scene.add(new Mesh({ geometry: box(10), position: [0, -6, 0], receiveShadow: true }))
    scene.updateWorldTree()
    const frame = collect(scene, camera())
    const c = frame.shadow?.casters.find((i) => i.node === caster)
    expect(c && rounded(c.clip.plane)).toEqual([0, 0, 1, 0])
  })
})

describe('clipping and picking', () => {
  // a box 2 across at the origin, cut away in front of z = 0: the ray straight down -z from the
  // camera meets nothing until the cut
  const cutBox = (cap) => {
    const scene = new Scene()
    const group = scene.add(new Group({ clip: { normal: [0, 0, 1], cap } }))
    const mesh = group.add(new Mesh({ geometry: box(2) }))
    return { scene, mesh }
  }

  it('passes through what is cut away', () => {
    const { scene } = cutBox(null)
    // the front face at z = 1 is gone, and the open box's inside faces away from the ray
    expect(new Raycaster().setFromCamera([0, 0], camera()).intersect(scene)).toEqual([])
  })

  it('hits the cut face of a capped solid, on the plane', () => {
    const { scene, mesh } = cutBox('#ff0000')
    const [hit] = new Raycaster().setFromCamera([0, 0], camera()).intersect(scene)
    expect(hit.node).toBe(mesh)
    expect(rounded(hit.point)).toEqual([0, 0, 0])
    expect(hit.distance).toBeCloseTo(10)
    expect(rounded(hit.normal)).toEqual([0, 0, 1])
  })

  it('cuts a target from a clip above it, and in intersectElement', () => {
    const { mesh } = cutBox(null)
    // the mesh alone, its clip on its parent
    expect(new Raycaster().setFromCamera([0, 0], camera()).intersect(mesh)).toEqual([])
    expect(new Raycaster().setFromCamera([0, 0], camera()).intersectElement(mesh, 0)).toBeNull()
  })

  it('still hits the part that is left', () => {
    const { scene, mesh } = cutBox(null)
    // through the back half from above: the top face behind the cut is still there
    const rc = new Raycaster()
    rc.ray.origin.set(0, 10, -0.5)
    rc.ray.direction.set(0, -1, 0)
    const [hit] = rc.intersect(scene)
    expect(hit.node).toBe(mesh)
    expect(rounded(hit.point)).toEqual([0, 1, -0.5])
  })
})

describe('clipping and redrawing', () => {
  it('redraws when a clip is added, moved, recoloured or removed', () => {
    const scene = new Scene()
    const group = scene.add(new Group())
    group.add(new Mesh({ geometry: box() }))
    const cam = camera()
    const watch = new ChangeWatch()
    watch.changed(scene, cam)
    const changes = [
      () => { group.clip = { normal: [1, 0, 0] } },
      () => { group.clip.offset = 0.3 },
      () => group.clip.normal.set(0, 1, 0),
      () => { group.clip.cap = group.clip.cap ?? null },
      () => { group.clip = { normal: [0, 1, 0], offset: 0.3, cap: 'red' } },
      () => { group.clip = null },
    ]
    for (const change of changes) {
      change()
      const expected = change !== changes[3]
      expect(watch.changed(scene, cam), String(change)).toBe(expected)
    }
  })
})
