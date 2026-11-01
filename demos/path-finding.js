import { Crowd, NavMeshQuery, getNavMeshPositionsAndIndices, init } from 'recast-navigation'
import { generateTileCache } from 'recast-navigation/generators'
import { Box3, DirectionalLight, Geometry, Group, InstancedMesh, Label, Lines, Mesh, View, box, cylinder, edges, icosphere, lathe, plane, torus } from 'phoria2'
import { random } from './kit.js'

// People going about an office, steered with recast-navigation (recast-navigation-js) - Recast and
// Detour, the navigation libraries behind many game engines, compiled to WebAssembly. Recast owns the
// walking: from the office's floor, walls and furniture it builds a navigation mesh - where a person
// can stand - and Detour's crowd moves everyone along it, each on a path round the furniture and
// round each other. phoria2 owns the picture and the hands: the people are two InstancedMeshes,
// bodies and heads, moved each frame from the crowd; tap one and then the floor to send them there,
// along a path drawn from Detour's; drag a filing cabinet and Recast cuts it out of the navigation
// mesh as it goes, so everyone re-routes round it. The navigation mesh itself can be shown.

const ROOM = { x0: -8, x1: 8, z0: -5, z1: 5 }
const WALL = { thick: 0.15, high: 1.1 } // drawn cut away, low, so you can see in
const AGENT = { radius: 0.3, height: 1.75 }
const PEOPLE = [
  ['Ana', '#d9534f'], ['Ben', '#3b7dd8'], ['Chloe', '#5cb85c'], ['Dev', '#f0ad4e'],
  ['Erin', '#8e5ea2'], ['Femi', '#2ab0b0'], ['Gus', '#e57fb0'], ['Hana', '#6b7280'],
]
const white = { color: '#ecebe7', roughness: 0.55 }
const charcoal = { color: '#30343a', roughness: 0.6 }
const wood = { color: '#b58a5c', roughness: 0.55 }

// ---- the office as boxes: what Recast builds the navigation mesh from, and what's drawn for each.
// Walls run round the outside and enclose a meeting room (top left, a door in each wall) and part
// off a kitchen (top right); desks stand back to back in two clusters
/** @type {{ at: [number, number], size: [number, number, number], look: 'wall' | 'desk' | 'table' | 'counter' | 'plant' }[]} */
const FIXED = []
const wall = (x0, z0, x1, z1) => FIXED.push({ at: [(x0 + x1) / 2, (z0 + z1) / 2], size: [Math.max(Math.abs(x1 - x0), WALL.thick), WALL.high, Math.max(Math.abs(z1 - z0), WALL.thick)], look: 'wall' })
wall(ROOM.x0, ROOM.z0, ROOM.x1, ROOM.z0)
wall(ROOM.x0, ROOM.z1, ROOM.x1, ROOM.z1)
wall(ROOM.x0, ROOM.z0, ROOM.x0, ROOM.z1)
wall(ROOM.x1, ROOM.z0, ROOM.x1, ROOM.z1)
// the meeting room: x -8 to -3, z -5 to -1, a door into the office from each side
wall(-3, -5, -3, -3.4)
wall(-3, -2.3, -3, -1)
wall(-8, -1, -5.6, -1)
wall(-4.5, -1, -3, -1)
// the kitchen's partition
wall(3, -5, 3, -2.4)
FIXED.push({ at: [-5.5, -3], size: [2.4, 0.75, 1.1], look: 'table' })
FIXED.push({ at: [5.6, -4.6], size: [4.4, 0.92, 0.6], look: 'counter' })
FIXED.push({ at: [5.8, -2.6], size: [1.8, 0.92, 0.8], look: 'counter' })
for (const cx of [-4, 3.6]) {
  for (const dx of [-1.6, 0, 1.6]) {
    for (const z of [1.4, 2.2]) FIXED.push({ at: [cx + dx, z], size: [1.6, 0.75, 0.8], look: 'desk' })
  }
}
for (const at of [[-7.5, 4.5], [7.5, 4.5], [-0.2, -4.5]]) FIXED.push({ at: /** @type {[number, number]} */ (at), size: [0.5, 1, 0.5], look: 'plant' })

// filing cabinets, which you can drag: obstacles Recast cuts out of the navigation mesh as they move.
// A cabinet's size is its width, height and depth
const CABINET = [0.5, 1, 0.6]
const CABINETS = [[0.4, -0.6], [-1.4, 3.6], [6.6, 0.2], [-2.4, -0.4], [3.6, 4]]
const MOVE = '#ffb000' // what can be dragged is outlined in this
const WALL_SNAP = 0.3 // how near a wall a dragged piece slides flush against it, as in the planner

/** Where a box stands on the floor: its least and greatest x and z. @param {number} x @param {number} z @param {number} w @param {number} d */
const footprint = (x, z, w, d) => ({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 })
/** Do two footprints overlap - by more than a hair, so pieces can stand side by side? @param {ReturnType<typeof footprint>} a @param {ReturnType<typeof footprint>} b */
const overlap = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.01 && Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0) > 0.01
/** The room inside its outer walls. */
const INSIDE = { x0: ROOM.x0 + WALL.thick / 2, x1: ROOM.x1 - WALL.thick / 2, z0: ROOM.z0 + WALL.thick / 2, z1: ROOM.z1 - WALL.thick / 2 }

// where people go when left to themselves: a seat at every desk, the kitchen and the meeting table
const SPOTS = [
  ...FIXED.filter((f) => f.look === 'desk').map((f) => [f.at[0], f.at[1] < 1.8 ? f.at[1] - 0.75 : f.at[1] + 0.75]),
  [4.2, -3.9], [5.6, -3.6], [7, -3.9], [5.8, -1.8],
  [-6.4, -2.1], [-4.6, -2.1], [-6.4, -3.9], [-4.6, -3.9],
  [0, 3.8], [-0.2, -3.6],
]

/** The triangles of axis-aligned boxes standing on the floor, and the floor, for Recast. */
function navInput() {
  /** @type {number[]} */ const positions = [], indices = []
  /** @param {number[][]} corners */
  const quad = (...corners) => {
    const n = positions.length / 3
    for (const c of corners) positions.push(...c)
    indices.push(n, n + 1, n + 2, n, n + 2, n + 3)
  }
  const m = 0.5
  quad([ROOM.x0 - m, 0, ROOM.z0 - m], [ROOM.x0 - m, 0, ROOM.z1 + m], [ROOM.x1 + m, 0, ROOM.z1 + m], [ROOM.x1 + m, 0, ROOM.z0 - m])
  for (const { at: [x, z], size: [w, h, d] } of FIXED) {
    const [x0, x1, z0, z1] = [x - w / 2, x + w / 2, z - d / 2, z + d / 2]
    quad([x0, h, z0], [x0, h, z1], [x1, h, z1], [x1, h, z0])
    quad([x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1])
    quad([x1, 0, z0], [x0, 0, z0], [x0, h, z0], [x1, h, z0])
    quad([x1, 0, z1], [x1, 0, z0], [x1, h, z0], [x1, h, z1])
    quad([x0, 0, z0], [x0, 0, z1], [x0, h, z1], [x0, h, z0])
  }
  return { positions, indices }
}

export default async function run({ canvas, info }) {
  // the WebAssembly loads here; the default build has it inlined, so there is no .wasm file to serve
  await init()

  // only what you can act on lights up under the pointer - the people and what can be dragged, as in the
  // planner - not the floor or the furniture
  const view = new View({ canvas, orbit: true, background: '#e9e7e2' })
  const { scene } = view
  scene.environment = 'studio'
  scene.environmentIntensity = 0.7
  scene.add(new DirectionalLight({ direction: [-0.4, -1, -0.3], intensity: 1.3, castShadow: true,
    shadowBounds: { min: [ROOM.x0 - 1, 0, ROOM.z0 - 1], max: [ROOM.x1 + 1, 2.5, ROOM.z1 + 1] } }))
  const floor = scene.add(new Mesh({ geometry: plane({ width: ROOM.x1 - ROOM.x0, depth: ROOM.z1 - ROOM.z0 }),
    material: { color: '#9aa4ad', roughness: 0.95 }, receiveShadow: true }))

  // ---- the office, drawn
  const looks = {
    wall: (/** @type {number[]} */ s) => [new Mesh({ geometry: box({ width: s[0], height: s[1], depth: s[2] }), material: white, position: [0, s[1] / 2, 0] })],
    desk: (/** @type {number[]} */ s) => [
      new Mesh({ geometry: box({ width: s[0], height: 0.04, depth: s[2] }), material: white, position: [0, 0.73, 0] }),
      ...[-0.76, 0.76].map((x) => new Mesh({ geometry: box({ width: 0.04, height: 0.71, depth: 0.7 }), material: charcoal, position: [x, 0.355, 0] })),
      new Mesh({ geometry: box({ width: 0.6, height: 0.36, depth: 0.03 }), material: charcoal, position: [0, 1.0, 0] }),
    ],
    table: (/** @type {number[]} */ s) => [
      new Mesh({ geometry: box({ width: s[0], height: 0.05, depth: s[2] }), material: wood, position: [0, 0.73, 0] }),
      ...[-0.8, 0.8].map((x) => new Mesh({ geometry: cylinder({ radius: 0.06, height: 0.71 }), material: charcoal, position: [x, 0.355, 0] })),
    ],
    counter: (/** @type {number[]} */ s) => [
      new Mesh({ geometry: box({ width: s[0], height: 0.86, depth: s[2] }), material: { color: '#dad6cd', roughness: 0.6 }, position: [0, 0.43, 0] }),
      new Mesh({ geometry: box({ width: s[0] + 0.04, height: 0.06, depth: s[2] + 0.04 }), material: { color: '#55595f', roughness: 0.35 }, position: [0, 0.89, 0] }),
    ],
    plant: () => [
      new Mesh({ geometry: cylinder({ radius: 0.22, radiusTop: 0.25, height: 0.4 }), material: { color: '#d9d2c3', roughness: 0.7 }, position: [0, 0.2, 0] }),
      new Mesh({ geometry: icosphere({ radius: 0.42, detail: 1 }), material: { color: '#3f7a3a', roughness: 0.8, flatShading: true }, position: [0, 0.85, 0] }),
    ],
  }
  for (const f of FIXED) {
    const g = scene.add(new Group({ position: [f.at[0], 0, f.at[1]], pickable: false }))
    for (const m of looks[f.look](f.size)) {
      m.castShadow = m.receiveShadow = true
      g.add(m)
    }
  }

  // ---- the navigation mesh, built in tiles so obstacles can be cut out of it as they move. Recast
  // measures in cells of its grid - 10 cm here - so a person's 0.3 m radius is 3 cells
  const { positions, indices } = navInput()
  const cell = 0.1
  const built = generateTileCache(positions, indices, {
    cs: cell, ch: cell, tileSize: 32, expectedLayersPerTile: 4, maxObstacles: 32,
    walkableRadius: Math.ceil(AGENT.radius / cell), walkableHeight: Math.ceil(AGENT.height / cell), walkableClimb: 3,
  })
  if (!built.success) throw new Error(`recast couldn't build the navigation mesh`)
  const { navMesh, tileCache } = built
  const query = new NavMeshQuery(navMesh)
  /** The nearest point on the navigation mesh. @param {number[]} p */
  const onMesh = (p) => query.findClosestPoint({ x: p[0], y: 0, z: p[1] ?? p[2] }).point

  // ---- what can be dragged, each drawn as a group - so hovering any part lights it all - and each an
  // obstacle in the tile cache. Each is outlined, so it reads as something to pick up even on a phone,
  // where nothing lights up under a finger before it presses
  const pieces = CABINETS.map(([x, z]) => {
    const size = CABINET, [w, h, d] = size
    // turned to face into the room, its drawers towards the camera
    const node = scene.add(new Group({ position: [x, 0, z], rotation: [0, Math.PI, 0], highlight: '#dbe9ff', highlightWhole: true,
      outline: { color: MOVE, width: 2 }, tooltip: () => 'Filing cabinet - drag to move' }))
    node.add(new Mesh({ geometry: box({ width: w, height: h, depth: d }), position: [0, h / 2, 0], material: { color: '#8f969c', metalness: 0.5, roughness: 0.45 } }))
    for (let i = 0; i < 3; i++) node.add(new Mesh({ geometry: box({ width: 0.18, height: 0.025, depth: 0.03 }), position: [0, 0.2 + i * 0.3, -d / 2 - 0.01], material: charcoal }))
    node.traverse((n) => { if (n !== node) /** @type {any} */ (n).castShadow = /** @type {any} */ (n).receiveShadow = true })
    const piece = { size, node, obstacle: block(x, z, size), grab: [0, 0] }
    node.onDrag = (drag) => {
      if (!drag.point) return
      if (drag.phase === 'start') piece.grab = [node.position.x - drag.point[0], node.position.z - drag.point[2]]
      // where it's dragged to - slid flush against a wall it comes near - if it fits there; where it was
      // if not, so it stops against what it meets, as in the planner
      const [x, z] = againstWalls(piece, drag.point[0] + piece.grab[0], drag.point[2] + piece.grab[1])
      if (fits(piece, x, z) && (x !== node.position.x || z !== node.position.z)) {
        node.position.set(x, 0, z)
        tileCache.removeObstacle(piece.obstacle)
        piece.obstacle = block(x, z, size)
        settle()
      }
      // everyone on the move finds a new way round
      if (drag.phase === 'end') for (const p of people) p.agent.requestMoveTarget(p.agent.target())
    }
    return piece
  })
  /** Slide a piece flush against a wall it comes near. @param {typeof pieces[number]} piece @param {number} x @param {number} z @returns {[number, number]} */
  function againstWalls(piece, x, z) {
    const f = footprint(x, z, piece.size[0], piece.size[2])
    if (f.x0 - INSIDE.x0 < WALL_SNAP) x += INSIDE.x0 - f.x0
    else if (INSIDE.x1 - f.x1 < WALL_SNAP) x += INSIDE.x1 - f.x1
    if (f.z0 - INSIDE.z0 < WALL_SNAP) z += INSIDE.z0 - f.z0
    else if (INSIDE.z1 - f.z1 < WALL_SNAP) z += INSIDE.z1 - f.z1
    return [x, z]
  }
  /**
   * Would a piece fit here: inside the walls, clear of the walls and furniture and the other pieces, and
   * not on top of anyone - who would be shut in.
   * @param {typeof pieces[number]} piece @param {number} x @param {number} z
   */
  function fits(piece, x, z) {
    const f = footprint(x, z, piece.size[0], piece.size[2])
    if (f.x0 < INSIDE.x0 - 1e-6 || f.x1 > INSIDE.x1 + 1e-6 || f.z0 < INSIDE.z0 - 1e-6 || f.z1 > INSIDE.z1 + 1e-6) return false
    if (FIXED.some((b) => overlap(f, footprint(b.at[0], b.at[1], b.size[0], b.size[2])))) return false
    if (pieces.some((o) => o !== piece && overlap(f, footprint(o.node.position.x, o.node.position.z, o.size[0], o.size[2])))) return false
    const r = AGENT.radius
    return !people.some((p) => {
      const at = p.agent.position()
      return overlap(f, footprint(at.x, at.z, r * 2, r * 2))
    })
  }
  /**
   * A piece's footprint as a tile cache obstacle, grown by a person's radius. The navigation mesh is
   * where a person's middle can be: Recast shrinks it by their radius away from the walls and furniture
   * it was built from, but cuts an obstacle out at just the size it's given - so without the margin,
   * people would walk half into a cabinet, and squeeze through gaps narrower than they are.
   * @param {number} x @param {number} z @param {number[]} size
   */
  function block(x, z, [w, h, d]) {
    const made = tileCache.addBoxObstacle({ x, y: h / 2, z }, { x: w / 2 + AGENT.radius, y: h / 2, z: d / 2 + AGENT.radius }, 0)
    return /** @type {NonNullable<typeof made.obstacle>} */ (made.obstacle)
  }
  /**
   * Rebuild the tiles obstacles have changed, and the drawing of the navigation mesh. Detour rebuilds
   * one tile per update, and an obstacle - grown by a person's radius - can lie across several, so it
   * goes on until the cache says it's up to date (the bound only guards against a cache that never is).
   */
  function settle() {
    for (let i = 0; i < 256 && !tileCache.update(navMesh).upToDate; i++);
    drawMesh()
  }

  // ---- the navigation mesh, drawn on request: its walkable floor in see-through teal, outlined.
  // Recast also finds the tops of desks and counters walkable - out of reach from the floor - so only
  // the floor's part is drawn
  const meshView = scene.add(new Mesh({ geometry: plane(0.01), visible: false, pickable: false, renderOrder: 1,
    material: { color: '#1aa39a', opacity: 0.35, depthWrite: false } }))
  const meshLines = scene.add(new Lines({ geometry: edges(plane(0.01)), visible: false, pickable: false, material: { color: '#0f766e' } }))
  function drawMesh() {
    const [p, idx] = getNavMeshPositionsAndIndices(navMesh)
    const kept = []
    for (let t = 0; t < idx.length; t += 3) {
      if (Math.max(p[idx[t] * 3 + 1], p[idx[t + 1] * 3 + 1], p[idx[t + 2] * 3 + 1]) < 0.3) kept.push(idx[t], idx[t + 1], idx[t + 2])
    }
    const lifted = p.map((v, i) => (i % 3 === 1 ? v + 0.03 : v))
    const geometry = new Geometry({ positions: lifted, indices: kept })
    meshView.geometry.dispose()
    meshLines.geometry.dispose()
    meshView.geometry = geometry
    meshLines.geometry = edges(geometry, { angle: 1 })
  }
  // the cabinets were queued as obstacles as they were made: build them into the mesh, and draw it
  settle()

  // ---- the people: Detour's crowd moves them; phoria2 draws a body and a head for each
  const crowd = new Crowd(navMesh, { maxAgents: PEOPLE.length, maxAgentRadius: 0.6 })
  const rand = random(4)
  const bodies = scene.add(new InstancedMesh({ count: PEOPLE.length, castShadow: true, highlight: '#dbe9ff',
    geometry: lathe({ points: [[0, 0], [0.17, 0], [0.2, 0.12], [0.21, 0.9], [0.24, 1.2], [0.2, 1.4], [0.08, 1.46], [0, 1.46]], segments: 20 }),
    material: { roughness: 0.75 } }))
  const heads = scene.add(new InstancedMesh({ geometry: icosphere({ radius: 0.13, detail: 2 }), count: PEOPLE.length, castShadow: true, highlight: '#dbe9ff',
    material: { color: '#e0b48f', roughness: 0.7 } }))
  const people = PEOPLE.map(([name, colour], i) => {
    bodies.setColor(i, colour)
    const start = onMesh(SPOTS[(i * 3) % SPOTS.length])
    const agent = crowd.addAgent(start, { radius: AGENT.radius, height: AGENT.height, maxSpeed: 1.2 + rand() * 0.4, maxAcceleration: 6,
      collisionQueryRange: 1.5, pathOptimizationRange: 6, separationWeight: 2 })
    return { name, agent, wait: rand() * 2, heading: rand() * Math.PI * 2 }
  })
  /** Send someone to a spot, wherever on the navigation mesh is nearest. @param {typeof people[number]} p @param {number[]} spot */
  const send = (p, spot) => p.agent.requestMoveTarget(onMesh(spot))
  for (const p of people) send(p, SPOTS[Math.floor(rand() * SPOTS.length)])

  // ---- choosing someone, and where they go: the chosen one has a ring at their feet, their name
  // above them, and the way they'll walk drawn on the floor to a marker where they're going
  /** @type {typeof people[number] | null} */
  let chosen = null
  const ring = scene.add(new Mesh({ geometry: torus({ radius: 0.42, tube: 0.03 }), rotation: [Math.PI / 2, 0, 0], visible: false, pickable: false,
    material: { color: '#ffb000', unlit: true } }))
  const goal = scene.add(new Mesh({ geometry: cylinder({ radius: 0.18, height: 0.02 }), visible: false, pickable: false, material: { color: '#ffb000', unlit: true } }))
  const route = scene.add(new Lines({ geometry: new Geometry({ positions: [0, 0, 0, 0, 0, 0] }), visible: false, pickable: false, material: { color: '#ffb000', width: 3 } }))
  const tag = scene.add(new Label({ text: '', position: [0, 0, 0], place: 'above', offset: [0, -6], className: 'nav-name', visible: false }))
  const showRoute = () => {
    if (!chosen) return
    const from = chosen.agent.position(), to = chosen.agent.target()
    const { path } = query.computePath(from, to)
    const segments = []
    for (let i = 1; i < (path?.length ?? 0); i++) {
      const [a, b] = [path[i - 1], path[i]]
      segments.push(a.x, a.y + 0.04, a.z, b.x, b.y + 0.04, b.z)
    }
    route.geometry.dispose()
    route.geometry = new Geometry({ positions: segments.length ? segments : [0, 0, 0, 0, 0, 0] })
    goal.position.set(to.x, to.y + 0.01, to.z)
  }
  /** @param {typeof people[number] | null} p */
  const choose = (p) => {
    chosen = p
    for (const n of [ring, goal, route, tag]) n.visible = !!p
    if (p) tag.text = p.name
    showRoute()
    hint()
  }
  view.on('click', (hit) => {
    const node = hit?.node
    if ((node === bodies || node === heads) && hit?.instance !== null && hit?.instance !== undefined) return choose(people[hit.instance])
    // on a phone a person is a few pixels across: a tap on the floor at their feet chooses them too
    if (node === floor && hit) {
      const near = people.map((p) => ({ p, d: Math.hypot(p.agent.position().x - hit.point[0], p.agent.position().z - hit.point[2]) })).sort((a, b) => a.d - b.d)[0]
      if (near.d < 0.8 && near.p !== chosen) return choose(near.p)
    }
    if (node === floor && chosen && hit) {
      send(chosen, [hit.point[0], hit.point[2]])
      // sent somewhere, they stay a while once there
      chosen.wait = -1
      showRoute()
      return
    }
    choose(null)
  })
  const hint = () => {
    info.textContent = chosen ? `${chosen.name} - tap the floor to send them there` : `Recast · ${people.length} people · tap one to direct them`
  }

  // ---- the controls: show the navigation mesh; start again
  const bar = document.createElement('div')
  bar.className = 'hud nav-bar'
  bar.innerHTML = `
    <button type="button" data-mesh title="Show the navigation mesh Recast built - where a person can stand">Navmesh</button>
    <button type="button" class="nav-reset" data-reset title="Put everything back">⟲</button>`
  document.body.append(bar)
  bar.addEventListener('click', (event) => {
    const button = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (event.target).closest('button'))
    if (!button) return
    if ('mesh' in button.dataset) {
      meshView.visible = meshLines.visible = !meshView.visible
      button.classList.toggle('now', meshView.visible)
    } else if ('reset' in button.dataset) {
      for (const [i, p] of pieces.entries()) {
        const [x, z] = CABINETS[i]
        p.node.position.set(x, 0, z)
        tileCache.removeObstacle(p.obstacle)
        p.obstacle = block(x, z, p.size)
      }
      settle()
      for (const [i, p] of people.entries()) {
        p.agent.teleport(onMesh(SPOTS[(i * 3) % SPOTS.length]))
        send(p, SPOTS[Math.floor(rand() * SPOTS.length)])
      }
      choose(null)
    }
  })

  hint()
  // seen from the front and well above, or - on a screen taller than wide - from the end, so the office's length runs
  // up the screen and fills more of it
  const tall = canvas.clientHeight > canvas.clientWidth
  view.frame(new Box3([ROOM.x0, 0, ROOM.z0], [ROOM.x1, 1.8, ROOM.z1]), { direction: tall ? [1, 1.6, 0.25] : [0, 2.2, 1], padding: tall ? 0.04 : 0.14 })
  if (import.meta.env.DEV) Object.assign(window, { view, people, crowd, tileCache, pieces })

  // ---- each frame: the crowd steps, the people are drawn where it puts them - turned to face where
  // they're walking, with a little bob - and anyone who has arrived waits a moment, then goes on
  let sinceRoute = 0
  return view.start((dt, t) => {
    crowd.update(Math.min(dt, 0.1))
    for (const [i, p] of people.entries()) {
      const at = p.agent.position(), v = p.agent.velocity(), to = p.agent.target()
      const speed = Math.hypot(v.x, v.z)
      if (speed > 0.1) p.heading = Math.atan2(v.x, v.z)
      const bob = speed > 0.1 ? Math.abs(Math.sin(t * 9 + i)) * 0.03 : 0
      const turn = [0, Math.sin(p.heading / 2), 0, Math.cos(p.heading / 2)]
      bodies.setInstance(i, { position: [at.x, at.y + bob, at.z], quaternion: turn })
      heads.setInstance(i, { position: [at.x, at.y + 1.6 + bob, at.z] })
      // arrived: wait, then pick somewhere else - longer after being sent somewhere
      if (Math.hypot(at.x - to.x, at.z - to.z) < 0.35 && speed < 0.2) {
        if (p.wait < 0) p.wait = 6
        p.wait -= dt
        if (p.wait <= 0) {
          p.wait = 1.5 + rand() * 3
          send(p, SPOTS[Math.floor(rand() * SPOTS.length)])
          if (p === chosen) showRoute()
        }
      }
      if (p === chosen) {
        ring.position.set(at.x, at.y + 0.03, at.z)
        tag.position.set(at.x, at.y + 1.8 + bob, at.z)
      }
    }
    if (chosen && (sinceRoute += dt) > 0.25) {
      sinceRoute = 0
      showRoute()
    }
  })
}
