import { describe, expect, it, vi } from 'vitest'
import {
  AmbientLight, DirectionalLight, Group, InstancedMesh, Label, Lines, Material, Mesh, NullRenderer,
  OrthographicCamera, PerspectiveCamera, PointLight, Points, Raycaster, Scene, SpotLight, Texture,
  box, edges, plane, sphere,
} from '../src/index.js'
import { collect } from '../src/frame.js'

const camera = () => new PerspectiveCamera({ position: [0, 0, 10], target: [0, 0, 0], aspect: 1 })

describe('Raycaster', () => {
  it('hits the nearest face of a mesh with point, normal, face and uv', () => {
    const scene = new Scene()
    const near = scene.add(new Mesh({ geometry: box(2), position: [0, 0, 2] }))
    scene.add(new Mesh({ geometry: box(2), position: [0, 0, -2] }))
    const hits = new Raycaster().setFromCamera([0, 0], camera()).intersect(scene)
    expect(hits).toHaveLength(2)
    const [hit] = hits
    expect(hit.node).toBe(near)
    expect(hit.distance).toBeCloseTo(7)
    expect(hit.point.equals([0, 0, 3], 1e-5)).toBe(true)
    expect(hit.normal.equals([0, 0, 1], 1e-5)).toBe(true)
    expect(hit.uv[0]).toBeCloseTo(0.5)
    expect(hit.uv[1]).toBeCloseTo(0.5)
  })

  it('respects scale, rotation and parents', () => {
    const g = new Group({ position: [3, 0, 0], rotation: [0, Math.PI / 4, 0] })
    const m = g.add(new Mesh({ geometry: box(1), scale: [4, 1, 1] }))
    const rc = new Raycaster()
    rc.ray.origin.set(3, 0, 10)
    rc.ray.direction.set(0, 0, -1)
    const [hit] = rc.intersect(g)
    expect(hit.node).toBe(m)
    // worked by hand: in the group's frame the ray meets the stretched box's +z face at (-0.5, 0, 0.5),
    // which the 45 degree turn puts at world (3, 0, 0.707), 9.293 from the ray origin
    expect(hit.point.equals([3, 0, Math.SQRT1_2], 1e-4)).toBe(true)
    expect(hit.distance).toBeCloseTo(10 - Math.SQRT1_2, 4)
  })

  it('skips back faces of single sided materials, invisible and unpickable nodes', () => {
    const rc = new Raycaster()
    rc.ray.origin.set(0, -5, 0)
    rc.ray.direction.set(0, 1, 0)
    // a plane faces +Y, so seen from below it's a back face
    expect(rc.intersect(new Mesh({ geometry: plane(4) }))).toHaveLength(0)
    expect(rc.intersect(new Mesh({ geometry: plane(4), material: { doubleSided: true } }))).toHaveLength(1)
    expect(rc.intersect(new Mesh({ geometry: sphere(1), visible: false }))).toHaveLength(0)
    const hidden = new Group({ pickable: false })
    hidden.add(new Mesh({ geometry: sphere(1) }))
    expect(rc.intersect(hidden)).toHaveLength(0)
  })

  it('reports instances, points and lines', () => {
    const scene = new Scene()
    const bars = scene.add(new InstancedMesh({ geometry: box(1), count: 3, instances: [{ position: [-3, 0, 0] }, { position: [0, 0, 0] }, { position: [3, 0, 0] }] }))
    const rc = new Raycaster().setFromCamera([0, 0], camera())
    expect(rc.intersect(scene)[0]).toMatchObject({ node: bars, instance: 1 })

    const pts = new Points({ geometry: { positions: [0, 0, 0, 5, 5, 5] } })
    expect(new Raycaster().setFromCamera([0, 0], camera()).intersect(pts)[0]).toMatchObject({ node: pts, face: 0 })

    const lines = new Lines({ geometry: edges(box(2)) })
    const ortho = new OrthographicCamera({ position: [1, 0, 10], height: 4, aspect: 1 })
    expect(new Raycaster().setFromCamera([0, 0], ortho).intersect(lines)[0].node).toBe(lines)
  })

  it('recolours a picked instance without moving it', () => {
    const bars = new InstancedMesh({ geometry: box(1), count: 2, instances: [{ position: [1, 2, 3] }, {}] })
    const matrices = bars.instanceMatrices.slice()
    const version = bars.version
    bars.setColor(1, '#ff0000')
    expect(Array.from(bars.instanceColors ?? [])).toEqual([1, 1, 1, 1, 0, 0])
    expect(bars.instanceMatrices).toEqual(matrices)
    expect(bars.version).toBe(version + 1)
    expect(() => bars.setColor(2, 'red')).toThrow(/instance 2 is out of range 0-1/)
  })
})

describe('collect', () => {
  it('describes the camera, lights and drawables', () => {
    const scene = new Scene({ background: '#123456' })
    scene.add(new AmbientLight({ intensity: 0.3 }), new DirectionalLight({ direction: [0, -1, 0] }), new PointLight({ position: [1, 2, 3] }))
    scene.add(new Mesh({ geometry: box(1) }), new Label({ text: 'hi', position: [0, 0, 0] }))
    scene.update(0, 0)
    const frame = collect(scene, camera())
    expect(frame.camera.position.toArray()).toEqual([0, 0, 10])
    expect(frame.lights.map((l) => l.kind)).toEqual(['ambient', 'directional', 'point'])
    expect(frame.lights[1].direction.toArray()).toEqual([0, -1, 0])
    expect(frame.lights[2].position.toArray()).toEqual([1, 2, 3])
    expect(frame.opaque).toHaveLength(1)
    expect(frame.labels[0]).toMatchObject({ visible: true })
    expect(frame.labels[0].ndc[0]).toBeCloseTo(0)
    expect(frame.background.getStyle()).toBe('#123456')
  })

  it('culls what the camera cannot see and skips invisible subtrees', () => {
    const scene = new Scene()
    scene.add(new Mesh({ geometry: box(1) }), new Mesh({ geometry: box(1), position: [0, 0, 50] }), new Mesh({ geometry: box(1), position: [100, 0, 0] }))
    const hidden = scene.add(new Group({ visible: false }))
    hidden.add(new Mesh({ geometry: box(1) }))
    scene.update(0, 0)
    const frame = collect(scene, camera())
    expect(frame.stats).toEqual({ drawn: 1, culled: 2 })
  })

  it('sorts opaque front to back and transparent back to front, renderOrder first', () => {
    const scene = new Scene()
    const far = scene.add(new Mesh({ name: 'far', geometry: box(1), position: [0, 0, -5] }))
    const near = scene.add(new Mesh({ name: 'near', geometry: box(1), position: [0, 0, 5] }))
    const glassFar = scene.add(new Mesh({ name: 'glassFar', geometry: box(1), material: { opacity: 0.5 }, position: [0, 0, -5] }))
    const glassNear = scene.add(new Mesh({ name: 'glassNear', geometry: box(1), material: { opacity: 0.5 }, position: [0, 0, 5] }))
    const first = scene.add(new Mesh({ name: 'first', geometry: box(1), position: [0, 0, -8], renderOrder: -1 }))
    scene.update(0, 0)
    const frame = collect(scene, camera())
    expect(frame.opaque.map((d) => d.node)).toEqual([first, near, far])
    expect(frame.transparent.map((d) => d.node)).toEqual([glassFar, glassNear])
  })

  it('caps lights at the renderer limits with one warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const scene = new Scene()
    for (let i = 0; i < 6; i++) scene.add(new PointLight({ position: [i, 0, 0] }))
    scene.add(new SpotLight({ target: [0, 0, 0], position: [0, 5, 0] }))
    scene.update(0, 0)
    collect(scene, camera())
    const frame = collect(scene, camera())
    expect(frame.lights).toHaveLength(4)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('NullRenderer records frames', () => {
    const r = new NullRenderer()
    const scene = new Scene({ children: [new Mesh({ geometry: box(1) })] })
    r.render(scene, camera())
    expect(r.frameCount).toBe(1)
    expect(r.lastFrame.opaque).toHaveLength(1)
  })
})

describe('Material and Texture', () => {
  it('has PBR defaults, validated options and a shader variant key', () => {
    const m = new Material()
    expect(m.color.getStyle()).toBe('#ffffff')
    expect([m.roughness, m.metalness, m.opacity]).toEqual([0.5, 0, 1])
    expect(m.variant).toBe('lit')
    expect(new Material({ unlit: true, flatShading: true }).variant).toBe('unlit+flat')
    expect(() => new Material({ roughness: 2 })).toThrow("'roughness' must be 0-1")
    expect(new Material({ opacity: 0.5 }).transparent).toBe(true)
    // maps with soft alpha edges ask for blending at full opacity; cut-outs stay opaque
    const leaf = new Material({ transparent: true })
    expect([leaf.transparent, leaf.toJSON()]).toEqual([true, { transparent: true }])
    const cutout = new Material({ alphaTest: 0.5, normalScale: -1, aoMapIntensity: 0.5 })
    expect([cutout.transparent, cutout.variant]).toEqual([false, 'lit+cutout'])
    expect(cutout.toJSON()).toEqual({ alphaTest: 0.5, normalScale: -1, aoMapIntensity: 0.5 })
    expect(() => new Material({ aoMapIntensity: 2 })).toThrow("'aoMapIntensity' must be 0-1")
    m.color = 'red'
    expect(m.color.getStyle()).toBe('#ff0000')
  })

  it('makes textures from urls with the colour space the slot needs', () => {
    const m = new Material({ map: 'wood.jpg', normalMap: { url: 'wood_n.png' } })
    expect(m.map).toBeInstanceOf(Texture)
    expect(m.map.colorSpace).toBe('srgb')
    expect(m.normalMap.colorSpace).toBe('linear')
    expect(m.variant).toBe('lit+map+normalMap')
    expect(m.toJSON()).toEqual({ map: { url: 'wood.jpg' }, normalMap: { url: 'wood_n.png', colorSpace: 'linear' } })
  })

  it('wraps in-memory images straight away', async () => {
    const image = { width: 2, height: 2 }
    const t = new Texture({ image, wrap: 'clamp' })
    expect(await t.ready).toBe(t)
    expect(t.toJSON()).toBe(null)
    expect(() => new Texture({ image, wrap: 'tile' })).toThrow("'wrap' 'tile' is not valid")
  })
})
