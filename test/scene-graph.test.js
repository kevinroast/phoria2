import { describe, expect, it, vi } from 'vitest'
import {
  Group, Label, Mesh, Node, PerspectiveCamera, PointLight, Scene, box, create,
} from '../src/index.js'

const close = (a, b, digits = 5) => {
  expect(a.length).toBe(b.length)
  for (let i = 0; i < b.length; i++) expect(a[i]).toBeCloseTo(b[i], digits)
}

describe('Node transforms', () => {
  it('takes position, rotation and scale options in any vector form', () => {
    const n = new Node({ position: { x: 1, y: 2, z: 3 }, rotation: [0, Math.PI / 2, 0], scale: 2 })
    expect(n.position.toArray()).toEqual([1, 2, 3])
    expect(n.scale.toArray()).toEqual([2, 2, 2])
    n.updateWorld()
    // +x turned 90 degrees about y points down -z
    close(n.worldMatrix.slice(0, 3), [0, 0, -2])
  })

  it('keeps rotation and quaternion in sync both ways', () => {
    const n = new Node()
    n.rotation.y = Math.PI / 2
    close(n.quaternion, [0, Math.SQRT1_2, 0, Math.SQRT1_2])
    n.quaternion.set(Math.SQRT1_2, 0, 0, Math.SQRT1_2)
    close(n.rotation.toArray(), [Math.PI / 2, 0, 0])
    // incremental three.js-style spinning keeps working
    for (let i = 0; i < 10; i++) n.rotation.y += 0.1
    expect(n.rotation.y).toBeCloseTo(1)
  })

  it('chains local-axis moves', () => {
    const n = new Node().rotateY(Math.PI / 2).translateX(2)
    // local +x is world -z after the turn
    close(n.position, [0, 0, -2])
    expect(n.rotateZ(0.1)).toBe(n)
  })

  it('composes world = parent x child', () => {
    const parent = new Group({ position: [10, 0, 0], rotation: [0, Math.PI / 2, 0] })
    const child = parent.add(new Node({ position: [1, 0, 0] }))
    child.updateWorld()
    // child's +x offset is turned by the parent: +x -> -z
    close(child.worldPosition, [10, 0, -1])
    close(child.worldQuaternion, [0, Math.SQRT1_2, 0, Math.SQRT1_2])
  })

  it('lookAt points -Z at the target, including inside a rotated parent', () => {
    const cam = new Node({ position: [0, 0, 5] })
    cam.lookAt([0, 0, 0])
    cam.updateWorld()
    // local -z in world space
    const forward = [-cam.worldMatrix[8], -cam.worldMatrix[9], -cam.worldMatrix[10]]
    close(forward, [0, 0, -1])

    const parent = new Group({ rotation: [0, 1, 0], position: [3, 0, 0] })
    const n = parent.add(new Node({ position: [0, 2, 0] }))
    n.lookAt([0, 0, 0])
    n.updateWorld()
    const f = [-n.worldMatrix[8], -n.worldMatrix[9], -n.worldMatrix[10]]
    const to = n.worldPosition.clone().negate().normalize()
    close(f, to, 4)
  })

  it('looks straight down without NaN', () => {
    const n = new Node({ position: [0, 10, 0] }).lookAt([0, 0, 0])
    expect(n.quaternion.every((v) => !Number.isNaN(v))).toBe(true)
  })
})

describe('graph management', () => {
  it('adds, reparents and finds', () => {
    const a = new Group({ name: 'a' }), b = new Group({ name: 'b' })
    const leaf = a.add(new Node({ name: 'leaf' }))
    expect(leaf.parent).toBe(a)
    b.add(leaf)
    expect(a.children).toHaveLength(0)
    expect(b.find('leaf')).toBe(leaf)
    expect(b.findAll((n) => n.name.length === 1)).toEqual([b])
    expect(leaf.root).toBe(b)
  })

  it('refuses loops', () => {
    const a = new Group(), b = a.add(new Group())
    expect(() => b.add(a)).toThrow("can't add an ancestor")
    expect(() => a.add(a)).toThrow("can't add a node to itself")
  })

  it('defers removals made during an update until the walk ends', () => {
    const scene = new Scene()
    const seen = []
    const first = scene.add(new Node({ name: 'first', onUpdate: (n) => { seen.push(n.name); n.removeFromParent() } }))
    scene.add(new Node({ name: 'second', onUpdate: (n) => seen.push(n.name) }))
    scene.update(1 / 60, 0)
    // removing 'first' mid-walk didn't make the walk skip 'second'
    expect(seen).toEqual(['first', 'second'])
    expect(scene.children.map((n) => n.name)).toEqual(['second'])
    expect(first.parent).toBe(null)
  })

  it('passes dt and t, and unsubscribes', () => {
    const fn = vi.fn()
    const n = new Node()
    const off = n.onUpdate(fn)
    const scene = new Scene({ children: [n] })
    scene.update(0.5, 2)
    expect(fn).toHaveBeenCalledWith(n, 0.5, 2)
    off()
    scene.update(0.5, 2.5)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('computes world bounds of a subtree', () => {
    const g = new Group({ position: [5, 0, 0] })
    g.add(new Mesh({ geometry: box(2) }), new Mesh({ geometry: box(2), position: [0, 3, 0] }))
    const b = g.bounds
    close(b.min, [4, -1, -1])
    close(b.max, [6, 4, 1])
  })

  it('counts a label as the point it is pinned to, so framing leaves room for it', () => {
    const g = new Group({ position: [5, 0, 0] })
    g.add(new Mesh({ geometry: box(2) }), new Label({ text: 'Sales', position: [0, 3, 0] }))
    close(g.bounds.max, [6, 3, 1])
    // a label on its own has a point for bounds
    close(new Label({ text: 'x', position: [1, 2, 3] }).bounds.min, [1, 2, 3])
  })

  it('clones deeply, sharing geometry and material', () => {
    const m = new Mesh({ name: 'm', geometry: box(1), material: { color: 'red' }, position: [1, 2, 3], userData: { id: 7 } })
    m.add(new Label({ text: 'hi' }))
    const c = m.clone()
    expect(c).not.toBe(m)
    expect(c.geometry).toBe(m.geometry)
    expect(c.material).toBe(m.material)
    expect(c.position.toArray()).toEqual([1, 2, 3])
    expect(c.userData).toEqual({ id: 7 })
    expect(c.userData).not.toBe(m.userData)
    expect(c.children[0]).toBeInstanceOf(Label)
  })
})

describe('validation', () => {
  it('names the problem and the fix', () => {
    expect(() => new Mesh({ geometry: box(1), colour: 'red' })).toThrow("Mesh: unknown option 'colour'")
    expect(() => new Mesh({})).toThrow("Mesh: 'geometry' is required")
    expect(() => new Mesh({ geometry: box(1), material: { color: 'red', type: 'phong' } })).toThrow("phoria2 has one material")
    expect(() => new Mesh({ geometry: box(1), material: { color: 'red', side: 2 } })).toThrow("doubleSided: true")
    expect(() => new Node({ position: [1, 2] })).toThrow('Node: expected [x, y, z]')
    expect(() => new PointLight({ color: 'blu' })).toThrow("did you mean 'blue'")
    expect(() => new PointLight({ distance: 5 })).toThrow("use 'range'")
    expect(() => new PerspectiveCamera({ fov: 1.2, near: 0 })).toThrow('0 < near < far')
    expect(() => create({ type: 'mesh', geometry: { type: 'cuboid' } })).toThrow("'geometry.type' 'cuboid' is not valid")
    expect(() => new Mesh({ geometry: { type: 'box' } })).toThrow("use the generator directly, e.g. box(...)")
  })
})

describe('descriptions', () => {
  it('builds nodes and nested children from plain data', () => {
    const scene = create({
      type: 'scene',
      background: '#101418',
      children: [
        { type: 'mesh', name: 'cube', geometry: { type: 'box', size: 2 }, material: { color: 'orange', roughness: 0.4 }, rotation: [0, 0.5, 0] },
        { type: 'directional-light', direction: [-1, -2, -1], intensity: 2 },
        { type: 'group', children: [{ type: 'label', text: 'Hello', position: [0, 1.6, 0] }] },
      ],
    })
    expect(scene).toBeInstanceOf(Scene)
    const cube = scene.find('cube')
    expect(cube).toBeInstanceOf(Mesh)
    expect(cube.material.color.getStyle()).toBe('#ffa500')
    expect(cube.geometry.bounds.getSize().toArray()).toEqual([2, 2, 2])
  })

  it('round-trips through toJSON', () => {
    const scene = create({ type: 'scene', background: 'black', environment: 'studio', children: [
      { type: 'mesh', name: 'a', geometry: { type: 'sphere', radius: 2 }, material: { color: '#c33', metalness: 1, map: 'wood.jpg' }, position: [1, 2, 3], scale: [1, 2, 1] },
      { type: 'point-light', color: '#ffeedd', intensity: 3, range: 10, position: [0, 5, 0] },
      { type: 'perspective-camera', fov: 40, target: [0, 1, 0], position: [0, 2, 8] },
      { type: 'instanced-mesh', geometry: { type: 'box' }, count: 2, instances: [{ position: [1, 0, 0], color: 'red' }, { scale: 2 }] },
    ] })
    const json = JSON.parse(JSON.stringify(scene))
    expect(json.type).toBe('scene')
    expect(json.children[0].material).toEqual({ color: '#cc3333', metalness: 1, map: { url: 'wood.jpg' } })
    expect(json.children[0].geometry).toEqual({ type: 'sphere', radius: 2, segments: 32, rings: 16 })
    const again = create(json)
    expect(JSON.parse(JSON.stringify(again))).toEqual(json)
  })

  it('explains bad types, including three.js names', () => {
    expect(() => create({ type: 'MeshStandardMaterial' })).toThrow("unknown type 'MeshStandardMaterial' - materials aren't nodes - give a mesh material:")
    expect(() => create({ type: 'BoxGeometry' })).toThrow("geometry isn't a node - give a mesh geometry: { type: 'box', ... }")
    expect(() => create({ type: 'mesh', geometry: { type: 'cube' } })).toThrow("geometry type 'cube' - use 'box'")
    expect(() => create({ type: 'PointLight' })).toThrow("use 'point-light'")
    expect(() => create({ type: 'mesj', geometry: { type: 'box' } })).toThrow("did you mean 'mesh'")
    expect(() => create({ geometry: { type: 'box' } })).toThrow("needs a 'type'")
  })

  it('add() takes nodes, and points descriptions at create()', () => {
    const g = new Group()
    const m = g.add(create({ type: 'mesh', geometry: { type: 'plane' } }))
    expect(m).toBeInstanceOf(Mesh)
    expect(m.parent).toBe(g)
    expect(() => g.add({ type: 'mesh' })).toThrow("add(create({ type: 'mesh', ... }))")
  })
})
