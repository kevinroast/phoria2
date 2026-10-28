// phoria2/edit: undo and redo, and the handle that moves and turns what is selected.
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { Group, Mesh, Ray, Vec3, View, box } from '../src/index.js'
import { History, TransformHandle } from '../src/edit/index.js'
import { HANDLE_HINTS, HANDLE_OPTIONS } from '../src/edit/TransformHandle.js'
import { HISTORY_OPTIONS } from '../src/edit/History.js'
import { contract } from './contract.js'
import { fakePage } from './fakes.js'

const page = fakePage()
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 50))
  page.restore()
})
/** @type {View[]} */
const made = []
afterEach(() => {
  for (const v of made.splice(0)) v.dispose()
  page.frame(0)
})
/** A vector rounded, so float32 noise doesn't fail an equality. @param {ArrayLike<number>} v */
const r = (v) => Array.from(v, (x) => Math.round(x * 1e4) / 1e4 || 0)
const viewOf = () => {
  const view = new View({ canvas: page.canvas(), camera: { position: [0, 10, 8], target: [0, 0, 0] } })
  made.push(view)
  return view
}

describe('History', () => {
  it('undoes and redoes in order, forgetting what was undone once something new is done', () => {
    const log = []
    const changes = []
    const history = new History({ onChange: (h) => changes.push([h.canUndo, h.canRedo]) })
    const step = (n) => history.push({ label: `step ${n}`, undo: () => log.push(`undo ${n}`), redo: () => log.push(`redo ${n}`) })
    step(1)
    step(2)
    expect(history.undoLabel).toBe('step 2')
    expect(history.undo()).toBe(true)
    expect(history.redoLabel).toBe('step 2')
    expect(history.redo()).toBe(true)
    history.undo()
    step(3)
    expect(history.canRedo).toBe(false)
    history.undo()
    history.undo()
    expect(history.undo()).toBe(false)
    expect(log).toEqual(['undo 2', 'redo 2', 'undo 2', 'undo 3', 'undo 1'])
    expect(changes.at(-1)).toEqual([false, true])
  })

  it('keeps only so many steps back', () => {
    const history = new History({ limit: 2 })
    for (let i = 0; i < 5; i++) history.push({ undo() {}, redo() {} })
    expect([history.undo(), history.undo(), history.undo()]).toEqual([true, true, false])
  })

  it('records a move, turn or resize - only if there was one - and puts it back', () => {
    const history = new History()
    const chair = new Group({ position: [1, 0, 2] })
    expect(history.transform(chair)()).toBe(false)
    const done = history.transform([chair])
    chair.position.set(4, 0, 2)
    chair.rotation.y = 1
    expect(done('Move chair')).toBe(true)
    expect(history.undoLabel).toBe('Move chair')
    history.undo()
    expect([chair.position.toArray(), Math.round(chair.rotation.y * 1e6) / 1e6]).toEqual([[1, 0, 2], 0])
    history.redo()
    expect([chair.position.toArray(), Math.round(chair.rotation.y * 1e6) / 1e6]).toEqual([[4, 0, 2], 1])
  })

  it('says why it refuses', () => {
    expect(() => new History({ limit: 0 })).toThrow("'limit' must be a whole number 1 or more")
    expect(() => new History().push(/** @type {any} */ ({ undo() {} }))).toThrow('push() takes { label, undo, redo }')
    expect(() => new History(/** @type {any} */ ({ max: 3 }))).toThrow("use 'limit'")
  })
})

describe('TransformHandle', () => {
  /** A 2 x 2 table at the origin, a handle on it, and a way to drag the handle's parts. */
  const setup = (options = {}) => {
    const view = viewOf()
    const table = view.scene.add(new Mesh({ geometry: box({ width: 2, height: 0.8, depth: 2 }), position: [0, 0.4, 0] }))
    const handle = new TransformHandle({ view, target: table, ...options })
    const part = (name) => /** @type {any} */ (handle.node.children.find((n) => n.name === name))
    /** Drag a part from a point on the floor to another (both at the table's height). */
    const drag = (name, from, to) => {
      const node = name === 'table' ? table : part(name)
      const down = (p) => new Ray([p[0], 10, p[2]], [0, -1, 0])
      const d = /** @type {any} */ ({ phase: 'start', node, ray: down(from), plane: { normal: new Vec3(0, 1, 0), point: new Vec3(...from) }, start: new Vec3(...from), point: new Vec3(...from), delta: new Vec3() })
      node.onDrag(d)
      d.phase = 'move'
      d.ray = down(to)
      d.point = new Vec3(to[0], from[1], to[2])
      d.delta = d.point.clone().sub(d.start)
      node.onDrag(d)
      d.phase = 'end'
      node.onDrag(d)
    }
    return { view, table, handle, part, drag }
  }

  it('sits on its target, round it, over everything - and hides with no target', () => {
    const { table, handle, part } = setup()
    {
      handle.node.updateWorld()
      expect(handle.node.position.toArray()).toEqual(table.position.toArray())
      // round the table's footprint at least: its half diagonal, and a little more
      expect(handle.node.scale[0]).toBeGreaterThanOrEqual(Math.SQRT2 * 1.1 - 1e-6)
      expect(part('ring').material.depthTest).toBe(false)
      expect(part('y-tip').visible).toBe(false)
    }
    handle.target = null
    expect(handle.node.visible).toBe(false)
  })

  it('moves along an arrow, freely across the floor by its disc, and snaps to the grid', () => {
    const { table, drag } = setup({ snap: { move: 0.25 } })
    drag('x-tip', [1.5, 0.4, 0], [1.87, 0.4, 0.6])
    // only along x, snapped
    expect(r(table.position)).toEqual([0.25, 0.4, 0])
    drag('disc', [0.25, 0.4, 0], [0.9, 0.4, -0.6])
    expect(r(table.position)).toEqual([1, 0.4, -0.5])
  })

  it('turns with the ring, in steps', () => {
    const { table, drag } = setup({ snap: { turn: Math.PI / 4 } })
    // a quarter of the way round the ring, anticlockwise seen from above
    drag('ring', [1.5, 0.4, 0], [0, 0.4, -1.5])
    expect(Math.round(table.rotation.y / (Math.PI / 4))).toBe(2)
  })

  it('drags the target itself, and gives back its own onDrag when it moves on', () => {
    const own = () => {}
    const view = viewOf()
    const table = view.scene.add(new Mesh({ geometry: box(), onDrag: own }))
    const handle = new TransformHandle({ view, target: table })
    expect(table.onDrag).not.toBe(own)
    handle.target = null
    expect(table.onDrag).toBe(own)
  })

  it('asks constrain() first: it can change a move, or refuse it', () => {
    const refused = setup({ constrain: () => null })
    refused.drag('disc', [0, 0.4, 0], [1, 0.4, 1])
    expect(r(refused.table.position)).toEqual([0, 0.4, 0])
    // kept to x of 0.5 at most
    const kept = setup({ constrain: (p) => ({ position: new Vec3(Math.min(p.position[0], 0.5), p.position[1], p.position[2]), rotation: p.rotation }) })
    kept.drag('table', [0, 0.4, 0], [2, 0.4, 0])
    expect(r(kept.table.position)).toEqual([0.5, 0.4, 0])
  })

  it('records each move and turn for undo, and tells onChange as it goes', () => {
    const history = new History(), phases = []
    const { table, drag } = setup({ history, onChange: (t, phase) => phases.push(phase) })
    drag('disc', [0, 0.4, 0], [1, 0.4, 0])
    expect(phases).toEqual(['start', 'move', 'end'])
    expect(history.undoLabel).toBe('Move')
    history.undo()
    expect(r(table.position)).toEqual([0, 0.4, 0])
  })

  it('needs a view, and says why it refuses', () => {
    expect(() => new TransformHandle(/** @type {any} */ ({}))).toThrow("'view' is required")
    const view = viewOf()
    expect(() => new TransformHandle({ view, move: /** @type {any} */ ('xy') })).toThrow("'move'")
    expect(() => new TransformHandle({ view, snap: { move: -1 } })).toThrow("'snap.move' must be a step of 0 or more")
    expect(() => new TransformHandle(/** @type {any} */ ({ view, rotate: true }))).toThrow("use 'turn'")
  })
})

// --- option contracts
contract('History', {
  options: HISTORY_OPTIONS, make: (o) => new History(o),
  rows: {
    limit: { value: 5, read: (h) => h.limit, default: 100, bad: 1.5, error: 'limit' },
    onChange: { value: () => {}, read: (h) => typeof h.onChange, expect: 'function', bad: 'yes', error: 'onChange' },
  },
})
contract('TransformHandle', {
  options: HANDLE_OPTIONS, hints: HANDLE_HINTS, make: (o) => new TransformHandle({ view: viewOf(), ...o }),
  rows: {
    view: { fresh: () => viewOf(), check: (h, v) => expect(v.scene.children).toContain(h.node), bad: 'canvas', error: "'view' is required" },
    target: { fresh: () => new Group(), read: (h) => h.target instanceof Group, expect: true, default: false },
    move: { value: 'xyz', read: (h) => h.move, default: 'xz', bad: 'up', error: 'move' },
    turn: { value: false, read: (h) => h.turn, default: true, bad: 'no', error: 'turn' },
    snap: { value: { move: 0.5, turn: 0.1 }, read: (h) => h.snap, default: null, bad: { move: 'grid' }, error: 'snap.move' },
    size: { value: 80, read: (h) => h.size, default: 120, bad: 0, error: 'size' },
    dragTarget: { value: false, read: (h) => h.dragTarget, default: true, bad: 1, error: 'dragTarget' },
    history: { fresh: () => new History(), read: (h) => h.history instanceof History, expect: true, default: false, bad: {}, error: 'history' },
    constrain: { value: () => null, read: (h) => typeof h.constrain, expect: 'function', bad: 1, error: 'constrain' },
    onChange: { value: () => {}, read: (h) => typeof h.onChange, expect: 'function', bad: 1, error: 'onChange' },
  },
})
