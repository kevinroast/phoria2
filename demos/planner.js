import { AmbientLight, DirectionalLight, Geometry, Group, HemisphereLight, InstancedMesh, Label, Lines, Mesh, Texture, box, cylinder, extrude, icosphere, lathe, outline } from 'phoria2'
import { View } from 'phoria2'
import { History, TransformHandle } from 'phoria2/edit'
import { random } from './kit.js'

// An office floor planner. Drag furniture in from the catalogue, click a piece to select it - an
// outline and a handle - then drag it or its handle across the floor: it snaps to a half-metre
// grid, turns in 15 degree steps, slides flush against a wall it comes near and won't go through
// one or into another piece. Distances to the walls show while it moves. Undo and redo, Delete,
// R to turn a quarter, and a plan view for laying out.

const ROOM = { x0: -6, x1: 6, z0: -4, z1: 4, height: 2.7, wall: 0.15 }
const GRID = 0.5
const TURN = Math.PI / 12
const WALL_SNAP = 0.3 // how near a wall a piece slides flush against it
const SELECTED = '#ffb000', BLOCKED = '#ff4b4b'

const wood = { color: '#b58a5c', roughness: 0.55 }
const white = { color: '#eceae6', roughness: 0.5 }
const charcoal = { color: '#2e3136', roughness: 0.6 }
const metal = { color: '#9aa1a8', metalness: 0.9, roughness: 0.35 }
const fabric = (color) => ({ color, roughness: 0.9 })

/** A mesh that casts and catches shadows. */
const part = (geometry, material, position = [0, 0, 0], rotation = [0, 0, 0]) => new Mesh({ geometry, material, position, rotation, castShadow: true, receiveShadow: true })

// --- the catalogue: each piece's size on the floor (w along x, d along z) and how to build it
const CATALOGUE = {
  desk: {
    name: 'Desk', w: 1.6, d: 0.8, build() {
      const g = new Group()
      g.add(part(box({ width: 1.6, height: 0.04, depth: 0.8 }), white, [0, 0.74, 0]))
      for (const x of [-0.76, 0.76]) g.add(part(box({ width: 0.04, height: 0.72, depth: 0.72 }), charcoal, [x, 0.36, 0]))
      g.add(part(box({ width: 0.6, height: 0.36, depth: 0.03 }), charcoal, [0, 1.06, -0.25]))
      g.add(part(cylinder({ radius: 0.02, height: 0.18, segments: 8 }), metal, [0, 0.85, -0.27]))
      g.add(part(box({ width: 0.42, height: 0.015, depth: 0.14 }), charcoal, [0, 0.765, 0.12]))
      return g
    },
  },
  chair: {
    name: 'Office chair', w: 0.6, d: 0.6, build() {
      const g = new Group()
      // a five-star base turned on a lathe would be round; this is the post and its foot
      g.add(part(lathe({ points: [[0, 0.04], [0.3, 0.04], [0.3, 0.07], [0.04, 0.09], [0.035, 0.42], [0, 0.42]], segments: 5 }), charcoal))
      g.add(part(extrude({ shape: outline.rect({ width: 0.5, height: 0.48, radius: 0.08 }), depth: 0.08, axis: 'y' }), fabric('#3c5a7a'), [0, 0.46, 0]))
      g.add(part(extrude({ shape: outline.rect({ width: 0.46, height: 0.5, radius: 0.08 }), depth: 0.06 }), fabric('#3c5a7a'), [0, 0.8, 0.24], [-0.12, 0, 0]))
      return g
    },
  },
  meeting: {
    name: 'Meeting table', w: 2.4, d: 1.2, build() {
      const g = new Group()
      g.add(part(extrude({ shape: outline.rect({ width: 2.4, height: 1.2, radius: 0.5 }), depth: 0.05, axis: 'y' }), wood, [0, 0.74, 0]))
      for (const x of [-0.7, 0.7]) g.add(part(lathe({ points: [[0, 0], [0.32, 0], [0.3, 0.03], [0.06, 0.06], [0.06, 0.71], [0, 0.71]], segments: 24 }), metal, [x, 0, 0]))
      return g
    },
  },
  sofa: {
    name: 'Sofa', w: 2.0, d: 0.9, build() {
      const g = new Group(), cloth = fabric('#6b7d5c')
      g.add(part(box({ width: 2.0, height: 0.4, depth: 0.9 }), cloth, [0, 0.2, 0]))
      g.add(part(box({ width: 2.0, height: 0.5, depth: 0.2 }), cloth, [0, 0.65, 0.35]))
      for (const x of [-0.92, 0.92]) g.add(part(box({ width: 0.16, height: 0.25, depth: 0.9 }), cloth, [x, 0.52, 0]))
      for (const x of [-0.45, 0.45]) g.add(part(box({ width: 0.82, height: 0.12, depth: 0.62 }), fabric('#7d9068'), [x, 0.46, -0.08]))
      return g
    },
  },
  bookcase: {
    name: 'Bookcase', w: 1.0, d: 0.35, build() {
      const g = new Group(), rand = random(5)
      for (const x of [-0.49, 0.49]) g.add(part(box({ width: 0.02, height: 1.9, depth: 0.35 }), wood, [x, 0.95, 0]))
      for (let i = 0; i < 5; i++) g.add(part(box({ width: 1.0, height: 0.02, depth: 0.35 }), wood, [0, 0.05 + i * 0.45, 0]))
      g.add(part(box({ width: 1.0, height: 1.9, depth: 0.01 }), wood, [0, 0.95, 0.17]))
      const books = []
      for (let shelf = 0; shelf < 4; shelf++) {
        for (let x = -0.44; x < 0.42;) {
          const t = 0.03 + rand() * 0.04, h = 0.24 + rand() * 0.12
          books.push({ position: [x + t / 2, 0.06 + shelf * 0.45 + h / 2, 0], scale: [t, h, 0.24], color: ['#8a3a2c', '#2f5d7a', '#c4a24a', '#3e6b48', '#5b4a7a', '#d9d4c7'][Math.floor(rand() * 6)] })
          x += t + 0.004
        }
      }
      g.add(new InstancedMesh({ geometry: box(1), material: { roughness: 0.8 }, instances: books, castShadow: true }))
      return g
    },
  },
  cabinet: {
    name: 'Filing cabinet', w: 0.5, d: 0.6, build() {
      const g = new Group()
      g.add(part(box({ width: 0.5, height: 1.0, depth: 0.6 }), { color: '#8f969c', metalness: 0.5, roughness: 0.45 }, [0, 0.5, 0]))
      for (let i = 0; i < 3; i++) g.add(part(box({ width: 0.18, height: 0.025, depth: 0.03 }), metal, [0, 0.2 + i * 0.3, -0.31]))
      return g
    },
  },
  plant: {
    name: 'Plant', w: 0.5, d: 0.5, build() {
      const g = new Group(), rand = random(11)
      g.add(part(lathe({ points: [[0, 0], [0.16, 0], [0.22, 0.38], [0.24, 0.42], [0.2, 0.42], [0, 0.36]], segments: 24 }), { color: '#d9d2c3', roughness: 0.7 }))
      for (let i = 0; i < 9; i++) {
        const a = i / 9 * Math.PI * 2, r = 0.05 + rand() * 0.13
        g.add(part(icosphere({ radius: 0.13 + rand() * 0.08, detail: 1 }), { color: '#3f7a3a', roughness: 0.8, flatShading: true }, [Math.cos(a) * r, 0.58 + rand() * 0.45, Math.sin(a) * r]))
      }
      return g
    },
  },
  armchair: {
    name: 'Armchair', w: 0.85, d: 0.85, build() {
      const g = new Group(), cloth = fabric('#a8573e')
      g.add(part(box({ width: 0.85, height: 0.4, depth: 0.85 }), cloth, [0, 0.2, 0]))
      g.add(part(box({ width: 0.85, height: 0.45, depth: 0.18 }), cloth, [0, 0.62, 0.33]))
      for (const x of [-0.36, 0.36]) g.add(part(box({ width: 0.13, height: 0.22, depth: 0.85 }), cloth, [x, 0.5, 0]))
      return g
    },
  },
}

/** Carpet tiles: quiet blue-grey squares, each a touch different. */
function carpet() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 512
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d')), rand = random(2)
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const v = 120 + rand() * 14
      ctx.fillStyle = `rgb(${v - 18}, ${v - 8}, ${v + 6})`
      ctx.fillRect(x * 128, y * 128, 128, 128)
      for (let i = 0; i < 600; i++) {
        ctx.fillStyle = `rgba(255, 255, 255, ${rand() * 0.06})`
        ctx.fillRect(x * 128 + rand() * 128, y * 128 + rand() * 128, 2, 2)
      }
    }
  }
  return new Texture({ image: canvas, repeat: [(ROOM.x1 - ROOM.x0) / 2, (ROOM.z1 - ROOM.z0) / 2] })
}

// --- where pieces may go: inside the walls, and not into each other

/** A piece's corners on the floor, placed at position and turned by rotation. */
function footprint(item, position = item.position, rotation = item.rotation.y) {
  const { w, d } = item.userData, c = Math.cos(rotation), s = Math.sin(rotation)
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, z]) => [position[0] + x * c + z * s, position[2] - x * s + z * c])
}

/** Do two footprints overlap - by more than a hair, so pieces can stand side by side? Separating axes. */
function overlap(a, b) {
  for (const shape of [a, b]) {
    for (let i = 0; i < 4; i++) {
      const [x0, z0] = shape[i], [x1, z1] = shape[(i + 1) % 4], nx = z1 - z0, nz = x0 - x1, l = Math.hypot(nx, nz)
      const along = (p) => (p[0] * nx + p[1] * nz) / l
      const pa = a.map(along), pb = b.map(along)
      if (Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb)) < 0.01) return false
    }
  }
  return true
}

/** How far a footprint reaches on the floor. */
function extent(corners) {
  const xs = corners.map((c) => c[0]), zs = corners.map((c) => c[1])
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) }
}

export default function run({ canvas, info }) {
  const view = new View({
    canvas, background: '#e7e9ec',
    orbit: { minDistance: 6, maxDistance: 30, maxPitch: 1.45, minPitch: 0.35 },
    camera: { position: [0, 11.5, 11.5], target: [0, 0, 0.6], fov: 40 },
    tooltip: (hit) => {
      const item = furnitureOf(hit?.node)
      return item ? `${item.userData.name}\n${item.userData.w} x ${item.userData.d} m` : null
    },
  })
  const { scene } = view
  scene.environment = 'studio'
  scene.environmentIntensity = 0.5
  scene.add(new HemisphereLight({ sky: '#ffffff', ground: '#b8b2a8', intensity: 0.45 }))
  scene.add(new AmbientLight({ intensity: 0.1 }))
  scene.add(new DirectionalLight({ direction: [-0.3, -1, -0.25], intensity: 1.5, castShadow: true }))

  // --- the room: carpet, a half-metre grid, and walls that step aside for the camera
  const width = ROOM.x1 - ROOM.x0, depth = ROOM.z1 - ROOM.z0
  scene.add(new Mesh({ geometry: box({ width, height: 0.04, depth }), position: [0, -0.02, 0], receiveShadow: true, material: { map: carpet(), roughness: 0.95 } }))
  const lines = []
  for (let x = ROOM.x0 + GRID; x < ROOM.x1 - 1e-6; x += GRID) lines.push(x, 0.002, ROOM.z0, x, 0.002, ROOM.z1)
  for (let z = ROOM.z0 + GRID; z < ROOM.z1 - 1e-6; z += GRID) lines.push(ROOM.x0, 0.002, z, ROOM.x1, 0.002, z)
  scene.add(new Lines({ geometry: new Geometry({ positions: lines }), material: { color: '#ffffff', opacity: 0.18 }, pickable: false }))
  const walls = scene.add(new Group({ pickable: false }))
  const wallMaterial = { color: '#f4f2ee', roughness: 0.85 }
  for (const [x, z, w, d, nx, nz] of [
    [0, ROOM.z0 - ROOM.wall / 2, width + ROOM.wall * 2, ROOM.wall, 0, -1], [0, ROOM.z1 + ROOM.wall / 2, width + ROOM.wall * 2, ROOM.wall, 0, 1],
    [ROOM.x0 - ROOM.wall / 2, 0, ROOM.wall, depth, -1, 0], [ROOM.x1 + ROOM.wall / 2, 0, ROOM.wall, depth, 1, 0],
  ]) {
    // a wall is left out while the camera is beyond it, so it never hides the room
    walls.add(new Mesh({
      geometry: box({ width: w, height: ROOM.height, depth: d }), position: [x, ROOM.height / 2, z], material: wallMaterial, castShadow: true, receiveShadow: true,
      showFrom: (camera) => (camera.position[0] - x) * nx + (camera.position[2] - z) * nz < 1,
    }))
  }

  // --- the furniture
  const furniture = scene.add(new Group())
  const history = new History({ onChange: () => updateButtons() })
  /** The piece a node belongs to, or null. */
  function furnitureOf(node) {
    for (let n = node; n; n = n.parent) if (n.parent === furniture) return n
    return null
  }
  /** A new piece from the catalogue, ready to place. */
  function make(kind) {
    const spec = CATALOGUE[kind]
    const item = spec.build()
    item.userData = { kind, name: spec.name, w: spec.w, d: spec.d }
    // hovering any part lights the whole piece; the floor and walls have no highlight
    item.highlight = '#dbe9ff'
    item.highlightWhole = true
    item.onClick = () => select(item)
    return item
  }
  /** Would a piece fit here: inside the walls, and clear of every other piece? */
  function fits(item, position, rotation) {
    const corners = footprint(item, position, rotation), e = extent(corners)
    if (e.x0 < ROOM.x0 - 1e-6 || e.x1 > ROOM.x1 + 1e-6 || e.z0 < ROOM.z0 - 1e-6 || e.z1 > ROOM.z1 + 1e-6) return false
    return furniture.children.every((other) => other === item || !overlap(corners, footprint(other)))
  }
  /** Slide a placement flush against any wall it comes near. */
  function againstWalls(item, position, rotation) {
    const e = extent(footprint(item, position, rotation))
    if (e.x0 - ROOM.x0 < WALL_SNAP) position[0] += ROOM.x0 - e.x0
    else if (ROOM.x1 - e.x1 < WALL_SNAP) position[0] += ROOM.x1 - e.x1
    if (e.z0 - ROOM.z0 < WALL_SNAP) position[2] += ROOM.z0 - e.z0
    else if (ROOM.z1 - e.z1 < WALL_SNAP) position[2] += ROOM.z1 - e.z1
    return position
  }

  // --- selection: an outline, and the handle to move and turn it
  const handle = new TransformHandle({
    view, history, snap: { move: GRID, turn: TURN }, size: 150,
    constrain: (p, item) => {
      againstWalls(item, p.position, p.rotation)
      return fits(item, p.position, p.rotation) ? p : null
    },
    onChange: (item, phase) => showDistances(phase === 'end' ? null : item),
  })
  /** @type {Group | null} */
  let selected = null
  function select(item) {
    if (selected) selected.outline = null
    selected = item
    if (item) item.outline = { color: SELECTED, width: 3 }
    handle.target = item
    updateButtons()
  }
  // a click on the floor or nothing clears the selection
  view.on('click', (hit) => { if (!furnitureOf(hit?.node)) select(null) })

  // --- distances to the walls while a piece moves: a line and a label each way
  const ruler = scene.add(new Lines({ geometry: new Geometry({ positions: new Float32Array(4 * 6) }), material: { color: '#d4573b', width: 2, depthTest: false }, renderOrder: 10, pickable: false, visible: false }))
  const marks = [0, 1, 2, 3].map(() => scene.add(new Label({ text: '', className: 'planner-distance', visible: false })))
  function showDistances(item) {
    ruler.visible = !!item
    for (const m of marks) m.visible = !!item
    if (!item) return
    const e = extent(footprint(item)), cx = (e.x0 + e.x1) / 2, cz = (e.z0 + e.z1) / 2, y = 0.03
    const runs = [[e.x0, cz, ROOM.x0, cz], [e.x1, cz, ROOM.x1, cz], [cx, e.z0, cx, ROOM.z0], [cx, e.z1, cx, ROOM.z1]]
    const p = /** @type {Float32Array} */ (ruler.geometry.positions)
    runs.forEach(([ax, az, bx, bz], i) => {
      p.set([ax, y, az, bx, y, bz], i * 6)
      const length = Math.hypot(bx - ax, bz - az)
      marks[i].text = `${length.toFixed(2)} m`
      marks[i].position.set((ax + bx) / 2, y, (az + bz) / 2)
      marks[i].visible = length > 0.05
    })
    ruler.geometry.needsUpdate()
  }

  // --- adding and removing, undoably
  function add(item) {
    furniture.add(item)
    view.invalidate()
  }
  function remove(item) {
    if (selected === item) select(null)
    item.removeFromParent()
    view.invalidate()
  }
  function place(kind, x, z, rotation = 0) {
    const item = make(kind)
    item.position.set(x, 0, z)
    item.rotation.y = rotation
    add(item)
    return item
  }
  // a starting layout
  for (const [kind, x, z, r] of /** @type {[string, number, number, number][]} */ ([
    ['desk', -4, -3.2, 0], ['chair', -4, -2.4, 0], ['desk', -1.5, -3.2, 0], ['chair', -1.5, -2.4, 0],
    ['meeting', 2.5, 0.5, 0], ['chair', 1.8, -0.4, Math.PI], ['chair', 3.2, -0.4, Math.PI], ['chair', 1.8, 1.4, 0], ['chair', 3.2, 1.4, 0],
    ['sofa', -3.5, 3.5, 0], ['plant', -5.5, 3.5, 0], ['bookcase', 4.5, -3.75, Math.PI], ['cabinet', 5.6, 2, Math.PI / 2], ['plant', 5.5, 3.5, 0],
  ])) place(kind, x, z, r)

  // --- the page: a catalogue to drag from, and a toolbar
  const panel = document.createElement('div')
  panel.className = 'hud planner-panel'
  panel.innerHTML = `<h3>Furniture</h3><p>Drag onto the floor</p><div class="planner-items">${Object.entries(CATALOGUE).map(([kind, s]) => `<button class="planner-item" data-kind="${kind}">${s.name}<small>${s.w} x ${s.d} m</small></button>`).join('')}</div>
    <div class="planner-tools"><button data-do="undo">Undo</button><button data-do="redo">Redo</button><button data-do="turn">Turn</button><button data-do="delete">Delete</button><button data-do="plan">Plan view</button></div>`
  document.body.append(panel)
  const button = (name) => /** @type {HTMLButtonElement} */ (panel.querySelector(`[data-do="${name}"]`))
  function updateButtons() {
    button('undo').disabled = !history.canUndo
    button('undo').title = history.undoLabel ? `Undo ${history.undoLabel}` : ''
    button('redo').disabled = !history.canRedo
    button('turn').disabled = button('delete').disabled = !selected
  }
  /** Turn the selection a quarter, if it fits turned. */
  function turnSelected() {
    if (!selected) return
    const item = selected, rotation = item.rotation.y + Math.PI / 2, position = againstWalls(item, item.position.clone(), rotation)
    if (!fits(item, position, rotation)) return
    const done = history.transform(item)
    item.position.copy(position)
    item.rotation.y = rotation
    done('Turn')
    view.invalidate()
  }
  function deleteSelected() {
    const item = selected
    if (!item) return
    remove(item)
    history.push({ label: `Delete ${item.userData.name.toLowerCase()}`, undo: () => add(item), redo: () => remove(item) })
  }
  let plan = false
  const actions = {
    undo: () => history.undo(),
    redo: () => history.redo(),
    turn: turnSelected,
    delete: deleteSelected,
    plan: () => {
      plan = !plan
      view.camera = plan ? 'top' : 'perspective'
      if (view.controls) view.controls.mode = plan ? 'map' : 'orbit'
      view.frame(furniture.parent ?? scene, { padding: 0.05 })
      button('plan').textContent = plan ? '3D view' : 'Plan view'
    },
  }
  panel.addEventListener('click', (e) => {
    const name = /** @type {HTMLElement} */ (e.target).closest?.('[data-do]')?.getAttribute('data-do')
    if (name) actions[name]()
  })
  window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase()
    if ((e.ctrlKey || e.metaKey) && key === 'z') { e.preventDefault(); e.shiftKey ? history.redo() : history.undo() }
    else if ((e.ctrlKey || e.metaKey) && key === 'y') { e.preventDefault(); history.redo() }
    else if (key === 'delete' || key === 'backspace') deleteSelected()
    else if (key === 'r') turnSelected()
    else if (key === 'escape') select(null)
  })

  // dragging a new piece in from the catalogue: it follows the pointer over the floor, red where it won't fit
  panel.addEventListener('pointerdown', (e) => {
    const kind = /** @type {HTMLElement} */ (e.target).closest?.('[data-kind]')?.getAttribute('data-kind')
    if (!kind) return
    e.preventDefault()
    const item = make(kind)
    let ok = false
    const follow = (ev) => {
      const r = view.canvas.getBoundingClientRect()
      const over = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom
      const ray = view.rayAt(ev.clientX - r.left, ev.clientY - r.top), t = over ? ray.intersectPlane([0, 1, 0], [0, 0, 0]) : null
      if (t === null) {
        item.removeFromParent()
        ok = false
        view.invalidate()
        return
      }
      if (!item.parent) furniture.add(item)
      const at = ray.at(t)
      const position = againstWalls(item, at.set(Math.round(at[0] / GRID) * GRID, 0, Math.round(at[2] / GRID) * GRID), 0)
      item.position.copy(position)
      ok = fits(item, position, 0)
      item.outline = { color: ok ? SELECTED : BLOCKED, width: 3 }
      view.invalidate()
    }
    const drop = () => {
      window.removeEventListener('pointermove', follow)
      window.removeEventListener('pointerup', drop)
      item.outline = null
      if (!ok || !item.parent) {
        item.removeFromParent()
        view.invalidate()
        return
      }
      history.push({ label: `Add ${item.userData.name.toLowerCase()}`, undo: () => remove(item), redo: () => add(item) })
      select(item)
    }
    window.addEventListener('pointermove', follow)
    window.addEventListener('pointerup', drop)
  })

  updateButtons()
  info.textContent = 'Click a piece to select it · drag it or its handle · ring turns · R turns 90° · Delete · Ctrl+Z'
  if (import.meta.env.DEV) Object.assign(window, { view, handle, edits: history, furniture, select })
  view.start()
}
