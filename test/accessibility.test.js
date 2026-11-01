// Using a View without a pointer or without motion: keyboard stepping through what can be hovered,
// what a screen reader hears, reduced motion - and the two small gaps 1.2 closed beside them: a node
// opting out of the View's highlight, and string colours set on instances every frame.
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { Color, Geometry, Group, InstancedMesh, Lines, Mesh, Scene, View, box, create } from '../src/index.js'
import { chart } from '../src/charts/index.js'
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
  page.frame(0)
  delete globalThis.matchMedia
})

/** A view looking down -z at the origin from 10 away; the canvas is 300 x 150. */
const viewOf = (options = {}) => {
  const view = new View({ canvas: page.canvas(), camera: { position: [0, 0, 10], target: [0, 0, 0] }, ...options })
  made.push(view)
  return view
}
let clock = 0
const frame = () => page.frame((clock += 16))
// the keyboard's code loads on first use
const loaded = async () => {
  await import('../src/keyboard.js')
  await new Promise((r) => setTimeout(r, 0))
}
/** @param {View} view @param {string} key */
const press = (view, key) => /** @type {any} */ (view.canvas).dispatch('keydown', { key })

/** Three bars with data, in a row. */
const bars = () => {
  const rows = [{ name: 'North', sales: 10 }, { name: 'South', sales: 20 }, { name: 'East', sales: 30 }]
  return new InstancedMesh({ geometry: box(1), data: rows, instances: rows.map((_, i) => ({ position: [i * 2 - 2, 0, 0] })) })
}

describe('a node opting out of the highlight', () => {
  it('stays plain under a View that tints everything', () => {
    const view = viewOf({ highlight: '#ffffff' })
    const floor = view.scene.add(new Mesh({ geometry: box(1), highlight: false }))
    const canvas = /** @type {any} */ (view.canvas)
    frame()
    canvas.dispatch('pointermove', { clientX: 150, clientY: 75 })
    frame()
    frame()
    expect(view.hovered?.node).toBe(floor)
    expect(view.lastFrame?.highlight).toBeNull()
  })

  it('lets a nearer colour tint again, and keeps false through toJSON and create()', () => {
    const room = new Group({ highlight: false })
    const lamp = room.add(new Mesh({ geometry: box(1), highlight: '#ff0000' }))
    expect(room.highlight).toBe(false)
    expect(lamp.highlight).toBeInstanceOf(Color)
    const json = room.toJSON()
    expect(json.highlight).toBe(false)
    expect(/** @type {any} */ (create(json)).highlight).toBe(false)
  })

  it('says what highlight takes when given true', () => {
    expect(() => new Mesh({ geometry: box(1), highlight: /** @type {any} */ (true) })).toThrow(/false for no tint/)
  })
})

describe('string colours on instances', () => {
  it('come out the same each time they are set', () => {
    const mesh = new InstancedMesh({ geometry: box(1), count: 2 })
    for (let k = 0; k < 3; k++) mesh.setInstance(0, { color: 'hsl(20, 60%, 40%)' })
    mesh.setInstance(1, { color: 'hsl(20, 60%, 40%)' })
    const first = Array.from(mesh.instanceColors?.subarray(0, 3) ?? [])
    expect(Array.from(mesh.instanceColors?.subarray(3, 6) ?? [])).toEqual(first)
    expect(first).toEqual(Array.from(Color.fromInput('hsl(20, 60%, 40%)')))
    // and a bad one still says why, every time
    expect(() => mesh.setInstance(0, { color: 'notacolour' })).toThrow(/not a colour/)
    expect(() => mesh.setInstance(0, { color: 'notacolour' })).toThrow(/not a colour/)
  })
})

describe('reduced motion', () => {
  it('follows the system setting by default, and can be set either way', () => {
    globalThis.matchMedia = /** @type {any} */ ((q) => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} }))
    const view = viewOf()
    expect(view.reducedMotion).toBe(true)
    view.reducedMotion = false
    expect(view.reducedMotion).toBe(false)
    view.reducedMotion = 'auto'
    expect(view.reducedMotion).toBe(true)
    expect(() => { view.reducedMotion = /** @type {any} */ ('yes') }).toThrow(/reducedMotion/)
    expect(viewOf().reducedMotion).toBe(true)
    delete globalThis.matchMedia
    expect(viewOf().reducedMotion).toBe(false)
  })

  it('makes frame() go straight there rather than glide', () => {
    const glide = viewOf(), jump = viewOf({ reducedMotion: true })
    for (const view of [glide, jump]) {
      const far = view.scene.add(new Mesh({ geometry: box(1), position: [20, 0, 0] }))
      view.frame(far, { duration: 1 })
    }
    expect(glide.camera.position[0]).toBeLessThan(1)
    expect(jump.camera.position[0]).toBeCloseTo(20)
  })

  it('holds auto-rotation', () => {
    const view = viewOf({ reducedMotion: true, orbit: { autoRotate: true } })
    view.scene.add(new Mesh({ geometry: box(1) }))
    const at = view.camera.position.clone()
    view.step(0.5)
    expect(view.camera.position.distanceTo(at)).toBeLessThan(1e-9)
    view.reducedMotion = false
    view.step(0.5)
    expect(view.camera.position.distanceTo(at)).toBeGreaterThan(0.1)
  })

  it("shows a chart's change at once", () => {
    const rows = [{ month: 'Jan', sales: 10 }, { month: 'Feb', sales: 20 }]
    const view = viewOf({ reducedMotion: true })
    const c = view.scene.add(chart({ mark: 'bar', data: rows, x: 'month', y: 'sales', transition: { duration: 1 } }))
    view.step(0.1)
    const mesh = /** @type {any} */ (c.marks[0])
    const height = () => mesh.instanceMatrices[5]
    const before = height()
    c.update([{ month: 'Jan', sales: 40 }, rows[1]])
    view.step(1 / 60)
    // there in one step: a second more changes nothing
    const now = height()
    expect(now).not.toBeCloseTo(before)
    view.step(1)
    expect(height()).toBeCloseTo(now)
  })
})

describe('keyboard use', () => {
  it('makes the canvas a tab stop that a screen reader knows how to use', async () => {
    const view = viewOf({ keyboard: true, tooltip: (hit) => hit.datum?.name })
    view.scene.add(bars())
    await loaded()
    const canvas = /** @type {any} */ (view.canvas)
    expect(canvas.getAttribute('tabindex')).toBe('0')
    expect(canvas.getAttribute('role')).toBe('application')
    expect(canvas.getAttribute('aria-label')).toBe('3D view of 3 items')
    const help = canvas.siblings.find((/** @type {any} */ el) => el.id === canvas.getAttribute('aria-describedby'))
    expect(help.textContent).toMatch(/arrow keys to move between 3 items/)
    view.dispose()
    expect(canvas.hasAttribute('role')).toBe(false)
    expect(canvas.hasAttribute('tabindex')).toBe(false)
  })

  it('steps through instances with the arrows, as hovering would, and clicks with Enter', async () => {
    const hovered = [], clicked = []
    const view = viewOf({ keyboard: true, highlight: '#ffffff' })
    view.on('hover', (hit) => hovered.push(hit?.datum?.name ?? null))
    view.on('click', (hit, event) => clicked.push([hit?.instance, event]))
    const mesh = view.scene.add(bars())
    await loaded()
    frame()
    press(view, 'ArrowRight')
    frame()
    expect(hovered).toEqual(['North'])
    expect(view.lastFrame?.highlight).toMatchObject({ node: mesh, index: 0 })
    press(view, 'ArrowRight')
    press(view, 'End')
    frame()
    expect(hovered).toEqual(['North', 'East'])
    // past the end stays at the end
    press(view, 'ArrowRight')
    frame()
    expect(view.hovered?.instance).toBe(2)
    press(view, 'Enter')
    expect(clicked).toEqual([[2, null]])
    press(view, 'Home')
    frame()
    expect(view.hovered?.instance).toBe(0)
    press(view, 'Escape')
    frame()
    expect(view.hovered).toBeNull()
    expect(hovered.at(-1)).toBeNull()
  })

  it('says what each one is, and where it is in the list', async () => {
    const view = viewOf({ keyboard: true, tooltip: (hit) => ({ title: hit.datum.name, rows: { Sales: hit.datum.sales } }) })
    view.scene.add(bars())
    await loaded()
    const say = /** @type {any} */ (view.canvas).siblings.find((/** @type {any} */ el) => el.getAttribute?.('aria-live') === 'polite' || el.textContent === '')
    press(view, 'ArrowDown')
    press(view, 'ArrowDown')
    expect(say.textContent).toBe('South, Sales: 20. 2 of 3')
  })

  it('reads data, or a label of your own, when there is no tooltip', async () => {
    const plain = viewOf({ keyboard: true })
    const mesh = bars()
    mesh.onClick = () => {}
    plain.scene.add(mesh)
    const own = viewOf({ keyboard: { label: (hit) => `Bar ${hit.instance}` } })
    const other = bars()
    other.onClick = () => {}
    own.scene.add(other)
    await loaded()
    for (const view of [plain, own]) press(view, 'ArrowRight')
    const said = (view) => /** @type {any} */ (view.canvas).siblings[0].textContent
    expect(said(plain)).toBe('name: North, sales: 10. 1 of 3')
    expect(said(own)).toBe('Bar 0. 1 of 3')
  })

  it('leaves out what nothing answers, and counts a highlightWhole subtree once', async () => {
    const view = viewOf({ keyboard: true })
    view.scene.add(new Mesh({ geometry: box(1), name: 'floor' }))
    const desk = view.scene.add(new Group({ name: 'desk', highlightWhole: true, onClick: () => {} }))
    desk.add(new Mesh({ geometry: box(1) }))
    desk.add(new Mesh({ geometry: box(1), position: [1, 0, 0] }))
    await loaded()
    frame()
    press(view, 'ArrowRight')
    frame()
    expect(view.hovered?.node.parent).toBe(desk)
    press(view, 'ArrowRight')
    frame()
    expect(view.hovered?.node.parent).toBe(desk)
    expect(/** @type {any} */ (view.canvas).getAttribute('aria-label')).toBe('3D view of one item')
  })

  it("steps a surface's grid points and a network's links - the links after what they join", async () => {
    const view = viewOf({ keyboard: true })
    const said = () => /** @type {any} */ (view.canvas).siblings[0].textContent
    const grid = [{ x: 0, z: 0, y: 1 }, { x: 1, z: 0, y: 2 }, { x: 0, z: 1, y: 3 }, { x: 1, z: 1, y: 4 }]
    const holder = view.scene.add(new Group({ tooltip: (hit) => (hit.datum?.y !== undefined ? `height ${hit.datum.y}` : hit.datum?.link) }))
    const links = holder.add(new Lines({ geometry: new Geometry({ positions: [0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0] }), data: [{ link: 'a → b' }, { link: 'b → c' }] }))
    holder.add(new Mesh({ geometry: new Geometry({ positions: [0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1], indices: [0, 2, 1, 1, 2, 3] }), data: grid }))
    // the rows of no one: shares the group's tooltip, but has no data or name
    holder.add(new Mesh({ geometry: box(1) }))
    await loaded()
    frame()
    press(view, 'ArrowRight')
    expect(said()).toBe('height 1. 1 of 6')
    press(view, 'End')
    expect(said()).toBe('b → c. 6 of 6')
    frame()
    frame()
    expect(view.hovered).toMatchObject({ node: links, face: 1, instance: null })
  })

  it('tints the focus even when nothing sets a highlight colour', async () => {
    const view = viewOf({ keyboard: true })
    const mesh = bars()
    mesh.onClick = () => {}
    view.scene.add(mesh)
    await loaded()
    frame()
    press(view, 'ArrowRight')
    frame()
    expect(view.lastFrame?.highlight?.color.getHex()).toBe(0xffcc00)
  })

  it('hands over to the pointer as soon as it moves', async () => {
    const view = viewOf({ keyboard: true, highlight: '#ffffff' })
    view.scene.add(bars())
    view.on('hover', () => {})
    await loaded()
    frame()
    press(view, 'ArrowRight')
    frame()
    expect(view.hovered?.instance).toBe(0)
    const canvas = /** @type {any} */ (view.canvas)
    canvas.dispatch('pointermove', { clientX: 299, clientY: 1 })
    frame()
    frame()
    expect(view.hovered).toBeNull()
  })

  it('checks what keyboard takes', () => {
    expect(() => viewOf({ keyboard: /** @type {any} */ ('yes') })).toThrow(/keyboard/)
    expect(() => viewOf({ keyboard: /** @type {any} */ ({ text: () => '' }) })).toThrow(/label/)
  })
})

describe('describing a view', () => {
  it('labels the canvas as a picture, and takes the label away again', () => {
    const view = viewOf({ description: 'Sales by region' })
    const canvas = /** @type {any} */ (view.canvas)
    expect(canvas.getAttribute('aria-label')).toBe('Sales by region')
    expect(canvas.getAttribute('role')).toBe('img')
    view.description = null
    expect(canvas.hasAttribute('aria-label')).toBe(false)
    expect(canvas.hasAttribute('role')).toBe(false)
    expect(() => { view.description = /** @type {any} */ (3) }).toThrow(/description/)
  })

  it("is made from a chart's title and channels, or its own description", async () => {
    const rows = [{ month: 'Jan', sales: 10 }, { month: 'Feb', sales: 20 }]
    const view = viewOf({ keyboard: true })
    view.scene.add(chart({ mark: 'bar', data: rows, x: 'month', y: 'sales', title: 'Sales by month' }))
    await loaded()
    expect(/** @type {any} */ (view.canvas).getAttribute('aria-label')).toBe('Sales by month: bar chart of 2 rows by month, sales')
    expect(chart({ mark: 'bar', data: rows, x: 'month', y: 'sales', description: 'Two good months' }).summary()).toBe('Two good months')
  })

  it('is in explain()', async () => {
    const view = viewOf({ description: 'A cube', reducedMotion: true })
    view.scene.add(new Mesh({ geometry: box(1) }))
    expect(await view.explain()).toMatch(/Accessibility: reduced motion, described as "A cube"/)
  })
})

// the scene clock reaches charts through the scene, so a scene drawn by no View moves as before
it('leaves a scene with no View animating', () => {
  const scene = new Scene()
  expect(scene.motionReduced).toBe(false)
})
