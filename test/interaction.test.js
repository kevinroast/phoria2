import { describe, expect, it } from 'vitest'
import {
  DirectionalLight, Group, InstancedMesh, Label, Lines, Mesh, OrthographicCamera, PerspectiveCamera, Points, Raycaster,
  Scene, box, cameraPreset, collect, grid, plane,
} from '../src/index.js'
import { explain } from '../src/explain.js'
import { framingScale } from '../src/presets.js'
import { layoutLabels, placeBox } from '../src/labelLayout.js'
import { OrbitControl } from '../src/OrbitControl.js'
import { ChangeWatch } from '../src/watch.js'

const camera = () => new PerspectiveCamera({ position: [0, 0, 10], target: [0, 0, 0], aspect: 1 })

describe('data binding', () => {
  it('hands back the row for the instance, point or node that was hit', () => {
    const rows = [{ name: 'a' }, { name: 'b' }, { name: 'c' }]
    const bars = new InstancedMesh({ geometry: box(1), data: rows, instances: rows.map((_, i) => ({ position: [(i - 1) * 3, 0, 0] })) })
    expect(bars.count).toBe(3)
    const rc = new Raycaster().setFromCamera([0, 0], camera())
    expect(rc.intersect(bars)[0]).toMatchObject({ instance: 1, datum: { name: 'b' } })

    const pts = new Points({ geometry: { positions: [0, 0, 0, 5, 5, 5] }, data: ['first', 'second'] })
    expect(new Raycaster().setFromCamera([0, 0], camera()).intersect(pts)[0].datum).toBe('first')

    const mesh = new Mesh({ geometry: box(1), data: { id: 7 } })
    expect(new Raycaster().setFromCamera([0, 0], camera()).intersect(mesh)[0].datum).toEqual({ id: 7 })
    expect(new Raycaster().setFromCamera([0, 0], camera()).intersect(new Mesh({ geometry: box(1) }))[0].datum).toBeNull()
  })

  it('takes count from the data and points userData habits at data', () => {
    expect(new InstancedMesh({ geometry: box(1), data: [1, 2, 3, 4] }).count).toBe(4)
    expect(() => new Mesh({ geometry: box(1), userData: {} })).not.toThrow()
    expect(() => new Mesh({ geometry: box(1), rows: [] })).toThrow("use 'data'")
  })
})

describe('labels', () => {
  it('places boxes around their point', () => {
    expect(placeBox(100, 100, 40, 20, 'center', [0, 0])).toEqual([80, 90])
    expect(placeBox(100, 100, 40, 20, 'above', [0, 0])).toEqual([80, 74])
    expect(placeBox(100, 100, 40, 20, 'below', [0, 0])).toEqual([80, 106])
    expect(placeBox(100, 100, 40, 20, 'left', [0, 0])).toEqual([54, 90])
    expect(placeBox(100, 100, 40, 20, 'right', [5, -5])).toEqual([111, 85])
  })

  it('hides overlapping labels by priority, then nearness, and always shows overlap: show', () => {
    const at = (left, priority = 0, depth = 1, overlap = 'hide') => ({ left, top: 0, width: 50, height: 20, priority, overlap, depth })
    // 30px apart, two 50px labels share 40% - too much for a label newly showing
    expect(layoutLabels([at(0), at(30)])).toEqual(['show', 'hide'])
    expect(layoutLabels([at(0), at(30, 1)])).toEqual(['hide', 'show'])
    expect(layoutLabels([at(0, 0, 5), at(30, 0, 2)])).toEqual(['hide', 'show'])
    expect(layoutLabels([at(0, 5), at(30, 0, 1, 'show')])).toEqual(['hide', 'show'])
    // apart, both show; 'show' labels show even when they overlap each other
    expect(layoutLabels([at(0), at(100)])).toEqual(['show', 'show'])
    expect(layoutLabels([at(0, 0, 1, 'show'), at(10, 0, 1, 'show')])).toEqual(['show', 'show'])
  })

  it('lets labels touch a little, keeps labels that were showing, and dims instead of hiding', () => {
    const at = (left, extra = {}) => ({ left, top: 0, width: 50, height: 20, priority: 0, overlap: 'hide', depth: 1, ...extra })
    // sharing 10% is fine
    expect(layoutLabels([at(0), at(45)])).toEqual(['show', 'show'])
    // a label already showing holds on at 40% shared, and wins a tie against a new one
    expect(layoutLabels([at(0, { priority: 1 }), at(30, { sticky: true })])).toEqual(['show', 'show'])
    expect(layoutLabels([at(0), at(30, { sticky: true })])).toEqual(['hide', 'show'])
    // but not at 80%
    expect(layoutLabels([at(0, { priority: 1 }), at(10, { sticky: true })])).toEqual(['show', 'hide'])
    // a dimmed label is drawn faint, and doesn't block the next one
    expect(layoutLabels([at(0), at(30, { overlap: 'dim' }), at(55)])).toEqual(['show', 'dim', 'show'])
    // covered by geometry: always loses, by its own rule, and blocks nothing; 'show' shows anyway
    expect(layoutLabels([at(0, { covered: true }), at(10)])).toEqual(['hide', 'show'])
    expect(layoutLabels([at(0, { covered: true, overlap: 'dim', priority: 1 }), at(10)])).toEqual(['dim', 'show'])
    expect(layoutLabels([at(0, { covered: true, overlap: 'show' })])).toEqual(['show'])
  })

  it('makes one label per instance from its data, at the top of each instance', () => {
    const scene = new Scene()
    const rows = [{ v: 10 }, { v: null }, { v: 30 }]
    scene.add(new InstancedMesh({
      geometry: box(1), data: rows, labels: { text: (row) => row.v, place: 'above', priority: 2 },
      instances: rows.map((_, i) => ({ position: [i, 0, 0], scale: [1, 2, 1] })),
    }))
    scene.add(new Label({ text: 'title', position: [0, 3, 0], overlap: 'show', offset: [0, -4] }))
    scene.updateWorldTree()
    const labels = collect(scene, camera()).labels
    expect(labels.map((l) => l.text)).toEqual(['10', '30', 'title'])
    expect(labels[1].position.toArray()).toEqual([2, 1, 0])
    expect(labels[0]).toMatchObject({ index: 0, style: { place: 'above', priority: 2, overlap: 'hide' } })
    expect(labels[2]).toMatchObject({ index: null, style: { overlap: 'show', offset: [0, -4] } })
    expect(labels[0].key).not.toBe(labels[1].key)
  })

  it('checks label options', () => {
    expect(() => new Label({ text: 'x', place: 'top' })).toThrow("'place' 'top' is not valid")
    expect(() => new Label({ text: 'x', anchor: 'top' })).toThrow("use place:")
    expect(() => new InstancedMesh({ geometry: box(1), count: 1, labels: { text: 'x' } })).toThrow("'labels' must be { text: (datum, index) => string")
    expect(() => new Points({ geometry: { positions: [0, 0, 0] }, labels: { text: () => 'a', zIndex: 2 } })).toThrow("use 'priority'")
    expect(new Label({ text: 'x', place: 'right', priority: 3 }).toJSON()).toMatchObject({ type: 'label', text: 'x', place: 'right', priority: 3 })
  })
})

describe('ChangeWatch', () => {
  it('reports changes to anything that affects the picture, and nothing else', () => {
    const scene = new Scene()
    const cam = camera()
    const cube = scene.add(new Mesh({ geometry: box(1), material: { color: 'red' } }))
    const bars = scene.add(new InstancedMesh({ geometry: box(1), count: 2 }))
    const light = scene.add(new DirectionalLight({ direction: [0, -1, 0] }))
    const label = scene.add(new Label({ text: 'a' }))
    const watch = new ChangeWatch()
    expect(watch.changed(scene, cam)).toBe(true)
    expect(watch.changed(scene, cam)).toBe(false)

    const changes = [
      () => { cube.position.x = 1 },
      () => cube.material.color.set('blue'),
      () => { cube.material.roughness = 0.9 },
      () => cube.geometry.needsUpdate(),
      () => bars.setColor(0, 'green'),
      () => { light.intensity = 2 },
      () => { label.text = 'b' },
      () => { cam.position.z = 12 },
      () => { scene.background = '#123456' },
      () => scene.add(new Group()),
      () => { cube.visible = false },
    ]
    for (const change of changes) {
      change()
      expect(watch.changed(scene, cam)).toBe(true)
      expect(watch.changed(scene, cam)).toBe(false)
    }
    // inside a hidden node nothing matters until it shows again
    cube.material.color.set('white')
    expect(watch.changed(scene, cam)).toBe(false)
  })
})

describe('camera presets', () => {
  it('makes orthographic views from the named directions', () => {
    const iso = cameraPreset('isometric', { distance: 10 })
    expect(iso).toBeInstanceOf(OrthographicCamera)
    const p = iso.position.toArray().map((v) => +v.toFixed(3))
    expect(p[0]).toBe(p[1])
    expect(p[1]).toBe(p[2])
    expect(cameraPreset('top').position.toArray()).toEqual([0, 10, 0])
    expect(cameraPreset('front', { target: [1, 2, 3], distance: 5 }).position.toArray()).toEqual([1, 2, 8])
    expect(cameraPreset('perspective')).toBeInstanceOf(PerspectiveCamera)
    expect(() => cameraPreset(/** @type {any} */ ('plan'))).toThrow("use 'top'")
    expect(() => cameraPreset(/** @type {any} */ ('isometrc'))).toThrow("did you mean 'isometric'")
  })
})

describe('framing', () => {
  it('keeps the framed height, width, or everything as the canvas changes shape', () => {
    // set up for 1.5:1, shown in a square
    expect(framingScale('height', 1.5, 1)).toBe(1)
    expect(framingScale('width', 1.5, 1)).toBe(1.5)
    expect(framingScale('both', 1.5, 1)).toBe(1.5)
    // shown wider than designed: 'width' zooms in to keep the width; 'both' keeps the height
    expect(framingScale('width', 1.5, 3)).toBe(0.5)
    expect(framingScale('both', 1.5, 3)).toBe(1)
    expect(framingScale('both', 1.5, 0)).toBe(1)
  })
})

describe('OrbitControl', () => {
  const element = /** @type {any} */ ({ style: {}, clientHeight: 100, addEventListener() {}, removeEventListener() {} })

  it('zooms towards the pointer, keeping the point under it still', () => {
    const cam = new OrthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 10, aspect: 1 })
    const control = new OrbitControl(cam, element)
    // the pointer at the right edge, half way up: world x = 5 at the target
    control.zoomAt(0.5, 1, 0)
    expect(cam.height).toBe(5)
    // the view is now 5 wide, so the right edge is 2.5 from the centre - the centre moved to 2.5
    expect(cam.target.x).toBeCloseTo(2.5)
    expect(cam.position.x).toBeCloseTo(2.5)
    expect(cam.target.x + cam.height / 2).toBeCloseTo(5)
  })

  it('has a map mode and explains three.js option names', () => {
    expect(new OrbitControl(camera(), element, { mode: 'map' }).mode).toBe('map')
    expect(() => new OrbitControl(camera(), element, { mode: 'pan' })).toThrow("'mode' 'pan' is not valid")
    expect(() => new OrbitControl(camera(), element, { enableRotate: false })).toThrow("use mode: 'map'")
  })
})

describe('explain', () => {
  const info = (scene, cam, extra = {}) => {
    scene.updateWorldTree()
    return explain({
      width: 800, height: 600, pixelRatio: 2, renderMode: 'auto', running: false, frame: collect(scene, cam), labels: null,
      bounds: scene.bounds, nodes: 3, autoLight: true, contextLost: false,
      interaction: { hover: 0, click: 0, tooltip: false, highlight: false }, ...extra,
    })
  }

  it('describes the frame and warns about the usual mistakes', () => {
    const scene = new Scene()
    expect(info(scene, camera())).toContain('the scene has nothing to draw')

    scene.add(new Mesh({ geometry: box(1), position: [0, 0, 50] }))
    expect(info(scene, camera())).toContain('nothing is in view')

    const far = new Scene()
    far.add(new Mesh({ geometry: box(1), position: [0, 0, -2000] }))
    expect(info(far, new PerspectiveCamera({ position: [0, 0, 10], target: [0, 0, -2000], aspect: 1 }))).toContain('beyond camera.far')

    const ok = new Scene()
    ok.add(new Mesh({ geometry: box(2) }), new Lines({ geometry: grid({ size: 4 }) }))
    const text = info(ok, camera())
    expect(text).toContain('drew 2 - 1 mesh, 1 lines')
    expect(text).toContain('No warnings.')
    expect(info(ok, camera(), { autoLight: false })).toContain('no lights and autoLight is off')
    expect(info(ok, camera(), { width: 0 })).toContain('the canvas is 0 x 600')
  })

  it('reports shadows and the environment, and what stops shadows showing', () => {
    const scene = new Scene({ environment: { image: { data: new Float32Array(4), width: 1, height: 1 }, url: 'studio.hdr' } })
    const sun = scene.add(new DirectionalLight({ direction: [0, -1, 0], castShadow: true }))
    expect(info(scene, camera())).toContain("environment 'studio.hdr' (HDR)")
    const cube = scene.add(new Mesh({ geometry: box(1) }))
    expect(info(scene, camera())).toContain('a light has castShadow but nothing casts')
    cube.castShadow = true
    expect(info(scene, camera())).toContain('nothing in view has receiveShadow')
    scene.add(new Mesh({ geometry: plane(10), position: [0, -1, 0], receiveShadow: true }))
    const text = info(scene, camera())
    expect(text).toMatch(/Shadows: 1 caster, 1 receiver in view, [\d.e-]+ units per shadow texel/)
    expect(text).toContain('No warnings.')
    void sun
  })
})
