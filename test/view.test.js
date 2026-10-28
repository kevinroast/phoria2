// The View's behaviour on a stand-in page: when it draws, how it keeps its framing as the canvas
// changes shape, what it picks, and who hears about clicks and hovering.
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { DirectionalLight, Group, InstancedMesh, Label, Mesh, Scene, Vec3, View, box } from '../src/index.js'
import { fakePage } from './fakes.js'

const page = fakePage()
afterAll(async () => {
  // code that loads on first use settles before the page goes
  await new Promise((r) => setTimeout(r, 50))
  page.restore()
})
/** @type {View[]} */
const made = []
afterEach(() => {
  for (const v of made.splice(0)) v.dispose()
  // drop frames a disposed view asked for
  page.frame(0)
})

/** A view of a scene, looking down -z at the origin from 10 away; the canvas is 300 x 150. */
const viewOf = (options = {}) => {
  const view = new View({ canvas: page.canvas(), camera: { position: [0, 0, 10], target: [0, 0, 0] }, ...options })
  made.push(view)
  return view
}
let clock = 0
/** Run one animation frame, 16ms after the last. */
const frame = () => page.frame((clock += 16))

describe('View drawing', () => {
  it("in 'auto' mode draws, then only when something changes", () => {
    const view = viewOf()
    const cube = view.scene.add(new Mesh({ geometry: box(1) }))
    frame()
    frame()
    const render = vi.spyOn(view, 'render')
    frame()
    frame()
    // nothing changed: idle
    expect(render).toHaveBeenCalledTimes(0)
    cube.position.x = 1
    frame()
    expect(render).toHaveBeenCalledTimes(1)
    frame()
    expect(render).toHaveBeenCalledTimes(1)
    // something it can't see changes: invalidate() asks for a frame, and only one
    view.invalidate()
    frame()
    frame()
    expect(render).toHaveBeenCalledTimes(2)
  })

  it("in 'auto' mode draws its first frame once - even when that frame fits a preset camera to the scene", () => {
    for (const camera of [undefined, 'isometric']) {
      const view = viewOf(camera ? { camera } : {})
      view.scene.add(new Mesh({ geometry: box(1) }))
      const render = vi.spyOn(view, 'render')
      frame()
      frame()
      frame()
      expect(render, camera ?? 'a camera of its own').toHaveBeenCalledTimes(1)
    }
  })

  it("in 'always' mode draws every frame, and in 'manual' only when asked - and then sleeps", () => {
    const always = viewOf({ renderMode: 'always' })
    always.scene.add(new Mesh({ geometry: box(1) }))
    const drawn = vi.spyOn(always, 'render')
    frame()
    frame()
    frame()
    expect(drawn).toHaveBeenCalledTimes(3)
    always.dispose()

    const manual = viewOf({ renderMode: 'manual' })
    const cube = manual.scene.add(new Mesh({ geometry: box(1) }))
    const asked = vi.spyOn(manual, 'render')
    frame()
    expect(asked).toHaveBeenCalledTimes(1)
    // asleep: no frame asked for, and a change alone doesn't wake it
    expect(page.pending).toBe(0)
    cube.position.x = 2
    frame()
    expect(asked).toHaveBeenCalledTimes(1)
    manual.invalidate()
    expect(page.pending).toBe(1)
    frame()
    expect(asked).toHaveBeenCalledTimes(2)
  })

  it('runs its frame function with the time, steps no more than maxDelta, and stops and starts', () => {
    const view = viewOf({ maxDelta: 0.05 })
    const calls = []
    view.start((dt, t) => calls.push([Math.round(dt * 1000) / 1000, Math.round(t * 1000) / 1000]))
    page.frame(1000)
    page.frame(1016)
    // a long gap - a background tab - counts as maxDelta
    page.frame(3016)
    expect(calls).toEqual([[0, 0], [0.016, 0.016], [0.05, 0.066]])
    expect(view.running).toBe(true)
    view.stop()
    page.frame(3032)
    expect(calls).toHaveLength(3)
    expect(view.running).toBe(false)
  })

  it('steps exactly, for tests and screenshots: time, update handlers and a frame', () => {
    const view = viewOf()
    const seen = []
    view.scene.add(new Mesh({ geometry: box(1), onUpdate: (_, dt, t) => seen.push([dt, t]) }))
    const frameDrawn = view.step(0.5)
    view.step(0.25)
    expect(view.time).toBe(0.75)
    expect(seen).toEqual([[0.5, 0.5], [0.25, 0.75]])
    expect(frameDrawn.opaque).toHaveLength(1)
  })

  it('lights a scene that has none, until it has its own or is told not to', () => {
    const view = viewOf()
    view.scene.add(new Mesh({ geometry: box(1) }))
    expect(view.render().lights.map((l) => l.kind)).toEqual(['hemisphere', 'directional'])
    view.scene.add(new DirectionalLight())
    expect(view.render().lights).toHaveLength(1)
    const dark = viewOf({ autoLight: false })
    dark.scene.add(new Mesh({ geometry: box(1) }))
    expect(dark.render().lights).toHaveLength(0)
  })

  it('stops asking for frames once disposed', () => {
    const view = viewOf()
    const render = vi.spyOn(view, 'render')
    view.dispose()
    frame()
    expect(render).not.toHaveBeenCalled()
    expect(page.pending).toBe(0)
  })
})

describe('View framing', () => {
  /** Change the canvas's shape and let the view follow. */
  const reshape = (view, width, height) => {
    Object.assign(view.canvas, { clientWidth: width, clientHeight: height })
    view.resize()
    return Math.round(view.camera.position.z * 1000) / 1000
  }

  it("keeps the height in view by default, so a narrower canvas shows less from side to side", () => {
    const view = viewOf()
    expect(reshape(view, 150, 150)).toBe(10)
    expect(view.camera.aspect).toBe(1)
  })

  it("with keep: 'width', moves back as the canvas narrows so the sides stay in view", () => {
    const view = viewOf({ framing: 'width' })
    // 2:1 to 1:1 - half as wide for its height - so twice as far back
    expect(reshape(view, 150, 150)).toBe(20)
    expect(reshape(view, 300, 150)).toBe(10)
  })

  it("with keep: 'both', never cuts anything off: back when narrower, unmoved when wider", () => {
    const view = viewOf({ framing: 'both' })
    expect(reshape(view, 150, 150)).toBe(20)
    expect(reshape(view, 600, 150)).toBe(10)
  })

  it('takes the shape the camera was set up for from framing.aspect', () => {
    const view = viewOf({ framing: { keep: 'width', aspect: 1 } })
    // set up for 1:1, shown at 2:1 - twice as wide for its height - so half as far back
    expect(reshape(view, 300, 150)).toBe(5)
  })
})

describe('View projection', () => {
  it('says where a world position is on the canvas, how deep, and whether it is in view', () => {
    const view = viewOf()
    // straight ahead: the middle of the 300 x 150 canvas
    const middle = view.project([0, 0, 0])
    expect([Math.round(middle.x), Math.round(middle.y), middle.visible]).toEqual([150, 75, true])
    expect(middle.depth).toBeGreaterThan(0)
    expect(middle.depth).toBeLessThan(1)
    // up and to the right of the middle on screen
    const corner = view.project([1, 1, 0])
    expect(corner.x).toBeGreaterThan(150)
    expect(corner.y).toBeLessThan(75)
    // behind the camera, or far off to the side
    expect(view.project([0, 0, 20]).visible).toBe(false)
    expect(view.project([500, 0, 0]).visible).toBe(false)
  })

  it('gives the rectangle a node or box covers on the canvas - or null for nothing', () => {
    const view = viewOf()
    const cube = view.scene.add(new Mesh({ geometry: box(2) }))
    const r = /** @type {NonNullable<ReturnType<View['screenBounds']>>} */ (view.screenBounds(cube))
    // centred on the middle, as wide as it is tall (a cube, face on)
    expect(Math.round((r.left + r.right) / 2)).toBe(150)
    expect(Math.round((r.top + r.bottom) / 2)).toBe(75)
    expect(Math.round(r.width)).toBe(Math.round(r.height))
    expect(r.width).toBeGreaterThan(0)
    // the scene's covers the cube's; an empty group covers nothing
    expect(view.screenBounds()?.width).toBeCloseTo(r.width)
    expect(view.screenBounds(view.scene.add(new Group()))).toBeNull()
  })

  it('frames what the camera draws, centred and filling the view - not hidden or turned-away parts', () => {
    const view = viewOf({ camera: { position: [6, 5, 9], target: [0, 0, 0] } })
    const chart = view.scene.add(new Group())
    chart.add(new Mesh({ geometry: box({ width: 4, height: 3, depth: 2 }), position: [0, 1.5, 0] }))
    // a label set only shown from behind, and a hidden marker - neither should count
    chart.add(new Group({ showFrom: (cam) => cam.worldPosition[2] < 0, children: [new Label({ text: 'far', position: [0, 0, -12] })] }))
    chart.add(new Mesh({ geometry: box(1), position: [20, 0, 0], visible: false }))
    expect(chart.bounds.max[0]).toBe(20.5)
    const drawn = chart.boundsFrom(view.camera)
    expect([drawn.min.toArray(), drawn.max.toArray()]).toEqual([[-2, 0, -1], [2, 3, 1]])

    view.frame(chart, { padding: 0 })
    const tight = /** @type {NonNullable<ReturnType<View['screenBounds']>>} */ (view.screenBounds(chart))
    // touches two opposite edges, and is centred both ways
    expect(Math.max(tight.width / 300, tight.height / 150)).toBeCloseTo(1, 2)
    expect((tight.left + tight.right) / 2).toBeCloseTo(150, 0)
    expect((tight.top + tight.bottom) / 2).toBeCloseTo(75, 0)
    // padding is the margin, as a fraction of the size
    view.frame(chart, { padding: 0.25 })
    const padded = /** @type {NonNullable<ReturnType<View['screenBounds']>>} */ (view.screenBounds(chart))
    expect(Math.max(padded.width / 300, padded.height / 150)).toBeCloseTo(1 / 1.25, 2)
  })

  it('says how much of the view the drawn scene spans on screen', async () => {
    const view = viewOf({ camera: { position: [0, 0, 10], target: [0, 0, 0] } })
    view.scene.add(new Mesh({ geometry: box(2) }))
    view.frame(view.scene, { padding: 0 })
    const line = (await view.explain()).split('\n').find((l) => l.startsWith('Bounds'))
    expect(line).toMatch(/on screen it spans \d+% of the view's width and 100% of its height/)
  })
})

describe('View picking and events', () => {
  /** Two boxes in a line along the view, and an instanced row off to the side with data. */
  const pickScene = () => {
    const view = viewOf()
    const near = view.scene.add(new Mesh({ geometry: box(1), position: [0, 0, 2], name: 'near' }))
    const far = view.scene.add(new Mesh({ geometry: box(1), position: [0, 0, -2], name: 'far' }))
    const bars = view.scene.add(new InstancedMesh({
      geometry: box(1), name: 'bars', data: [{ id: 'a' }, { id: 'b' }],
      instances: [{ position: [-4, 2, 0] }, { position: [-4, -2, 0] }],
    }))
    view.render()
    return { view, near, far, bars }
  }
  // where a world point is on the 300 x 150 canvas
  const at = (view, p) => {
    const v = view.camera.position.constructor.fromInput(p).applyMatrix4(view.lastFrame.camera.viewProjection)
    return [(v.x + 1) / 2 * 300, (1 - v.y) / 2 * 150]
  }

  it('picks the nearest thing under a point, every hit with pickAll, and an instance with its row', () => {
    const { view, near, far, bars } = pickScene()
    expect(view.pick(150, 75)?.node).toBe(near)
    expect(view.pickAll(150, 75).map((h) => h.node)).toEqual([near, far])
    const [x, y] = at(view, [-4, -2, 0])
    expect(view.pick(x, y)).toMatchObject({ node: bars, instance: 1, datum: { id: 'b' } })
    // empty space
    expect(view.pick(5, 5)).toBeNull()
    // a pointer event works as well as a position
    expect(view.pick(/** @type {any} */ ({ clientX: 150, clientY: 75 }))?.node).toBe(near)
  })

  it("tells click handlers - the view's and the node's - what was clicked, and stops when removed", () => {
    const { view, near } = pickScene()
    const clicks = [], nodeClicks = []
    const off = view.on('click', (hit) => clicks.push(hit?.node.name ?? null))
    near.onClick = (hit) => nodeClicks.push(hit.node.name)
    view.canvas.dispatch('click', { clientX: 150, clientY: 75 })
    view.canvas.dispatch('click', { clientX: 5, clientY: 5 })
    expect(clicks).toEqual(['near', null])
    expect(nodeClicks).toEqual(['near'])
    off()
    view.canvas.dispatch('click', { clientX: 150, clientY: 75 })
    expect(clicks).toHaveLength(2)
    expect(() => view.on(/** @type {any} */ ('mouseover'), () => {})).toThrow("use 'hover'")
  })

  it('tells hover handlers as the thing under the pointer changes, and highlights it', () => {
    const view = viewOf({ highlight: '#ffffff' })
    const cube = view.scene.add(new Mesh({ geometry: box(1), name: 'cube' }))
    const heard = [], nodeHeard = []
    view.on('hover', (hit) => heard.push(hit?.node.name ?? null))
    cube.onHover = (hit) => nodeHeard.push(hit?.node.name ?? null)
    frame()
    view.canvas.dispatch('pointermove', { clientX: 150, clientY: 75 })
    frame()
    frame()
    expect(heard).toEqual(['cube'])
    expect(view.lastFrame?.highlight?.node).toBe(cube)
    // moving within the same thing says nothing new
    view.canvas.dispatch('pointermove', { clientX: 152, clientY: 76 })
    frame()
    expect(heard).toEqual(['cube'])
    view.canvas.dispatch('pointermove', { clientX: 5, clientY: 5 })
    frame()
    frame()
    expect(heard).toEqual(['cube', null])
    expect(nodeHeard).toEqual(['cube', null])
    expect(view.lastFrame?.highlight).toBeNull()
  })

  it('tints a whole highlightWhole subtree when any part of it is hovered', () => {
    const view = viewOf()
    const desk = view.scene.add(new Group({ highlight: '#dbe9ff', highlightWhole: true }))
    const top = desk.add(new Mesh({ geometry: box(1), name: 'top' }))
    const leg = desk.add(new Mesh({ geometry: box(0.1), position: [3, 0, 0], name: 'leg' }))
    const floor = view.scene.add(new Mesh({ geometry: box(1), position: [0, 0, -5] }))
    frame()
    view.canvas.dispatch('pointermove', { clientX: 150, clientY: 75 })
    frame()
    frame()
    const hl = view.lastFrame?.highlight
    expect(hl?.node).toBe(top)
    expect(hl?.index).toBeNull()
    expect([hl?.nodes?.has(top), hl?.nodes?.has(leg), hl?.nodes?.has(floor)]).toEqual([true, true, false])
    expect(hl?.color).toBe(desk.highlight)
  })

  describe('dragging', () => {
    /** A box on the ground seen from above and in front, with orbiting on; where its top is on the canvas. */
    const dragScene = () => {
      const view = viewOf({ orbit: true, camera: { position: [0, 8, 6], target: [0, 0, 0] } })
      const box1 = view.scene.add(new Mesh({ geometry: box(1), position: [0, 0.5, 0], name: 'box' }))
      frame()
      const p = view.project([0, 1, 0])
      const press = (type, dx = 0, dy = 0, buttons = 1) => view.canvas.dispatch(type, { clientX: p.x + dx, clientY: p.y + dy, pointerId: 1, button: 0, buttons, pointerType: 'mouse' })
      return { view, box1, press }
    }

    it('drags across the plane through the pressed point: start once it moves, then where it is, then end - the camera staying still', () => {
      const { view, box1, press } = dragScene()
      /** @type {any[]} */
      const heard = []
      box1.onDrag = (d) => heard.push({ phase: d.phase, node: d.node.name, y: d.point && Math.round(d.point[1] * 1000) / 1000, moved: Math.round(d.delta.len() * 100) / 100 })
      frame()
      const camera = view.camera.position.toArray()
      press('pointerdown')
      // a nudge under the threshold is still a press
      press('pointermove', 2, 0)
      expect(heard).toEqual([])
      press('pointermove', 40, 0)
      press('pointermove', 80, 20)
      press('pointerup', 80, 20, 0)
      expect(heard.map((h) => h.phase)).toEqual(['start', 'move', 'move', 'end'])
      // on the horizontal plane through the top of the box, further from the start each move
      expect(heard.every((h) => h.node === 'box' && (h.y === null || h.y === 1))).toBe(true)
      expect(heard[2].moved).toBeGreaterThan(heard[1].moved)
      expect(view.camera.position.toArray()).toEqual(camera)
    })

    it("doesn't click when a drag ends, but a press that doesn't move still does", () => {
      const { view, box1, press } = dragScene()
      const clicks = []
      box1.onDrag = () => {}
      box1.onClick = (hit) => clicks.push(hit.node.name)
      frame()
      press('pointerdown')
      press('pointermove', 40, 0)
      press('pointerup', 40, 0, 0)
      view.canvas.dispatch('click', { clientX: view.project([0, 1, 0]).x + 40, clientY: view.project([0, 1, 0]).y })
      expect(clicks).toEqual([])
      press('pointerdown')
      press('pointerup', 0, 0, 0)
      view.canvas.dispatch('click', { clientX: view.project([0, 1, 0]).x, clientY: view.project([0, 1, 0]).y })
      expect(clicks).toEqual(['box'])
    })

    it('lets a handler choose the plane at the start - an upright one facing the camera, to lift something', () => {
      const { box1, press } = dragScene()
      const xs = []
      box1.onDrag = (d) => {
        if (d.phase === 'start') d.plane = { normal: new Vec3(0, 0, 1), point: new Vec3(0, 0, 0) }
        else if (d.point) xs.push(Math.round(d.point[2] * 1e4) / 1e4 || 0)
      }
      frame()
      press('pointerdown')
      press('pointermove', 0, -40)
      press('pointerup', 0, -40, 0)
      expect(xs.length).toBeGreaterThan(0)
      expect(xs.every((x) => x === 0)).toBe(true)
    })

    it('gives the ray under a canvas position', () => {
      const { view } = dragScene()
      const p = view.project([0, 0, 0])
      const ray = view.rayAt(p.x, p.y)
      const t = /** @type {number} */ (ray.intersectPlane([0, 1, 0], [0, 0, 0]))
      expect(ray.at(t).toArray().map((v) => Math.round(v * 1e4) / 1e4 || 0)).toEqual([0, 0, 0])
    })
  })

  it('switches camera by preset name, keeping the orbit control on the new camera', () => {
    const view = viewOf({ orbit: true, scene: new Scene() })
    view.scene.add(new Mesh({ geometry: box(1) }))
    view.camera = 'top'
    expect(view.camera.constructor.name).toBe('OrthographicCamera')
    expect(view.controls?.camera).toBe(view.camera)
    expect(() => { view.camera = /** @type {any} */ ('sideways') }).toThrow('sideways')
  })
})
