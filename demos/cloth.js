import RAPIER from '@dimforge/rapier3d-compat'
import { Box3, DirectionalLight, Geometry, Group, Mesh, Texture, View, box, cylinder, icosphere, plane } from 'phoria2'

// A gingham tablecloth dropped over a table - or hung as a curtain - simulated by Rapier's soft bodies
// (rapier.rs, Rust compiled to WebAssembly). Rapier owns the cloth: a grid of particles held together
// by springs, colliding with the table and what stands on it. phoria2 owns the picture and the hands:
// each frame the bridge copies every particle's position into one Geometry, whose normals phoria2
// works out again as the cloth moves; grab the cloth and the particle under the pointer follows it;
// drag the ball, the vase or the box across the table and the cloth slides over them.

const N = 32 // particles along each side of the cloth
const SIZE = 2 // the cloth's side, in m
const TABLE = { w: 1.6, d: 1, top: 0.78 }
const STEP = 1 / 60
// how quickly the cloth's motion dies away, per second: without it, cloth resting on the ball and the
// box creeps over them for ever - about 5 mm a step - and with it, it all but stops
const DAMPING = 2.5
// what damping leaves - cloth over the ball still trembling a few millimetres a step, the solver's own
// noise at this many particles - is smoothed where it's drawn: each point eases towards the simulated
// one, a fraction of the way each 60th of a second for a small difference, all the way once the
// difference is SMALL metres - so a fall, a drag or a gust passes straight through
const EASE = 0.12, SMALL = 0.02
// hanging, the cloth's top row is pinned along a rail over the middle of the table. It starts high,
// clear of everything, and lowers until the cloth gathers on the table and over what stands on it
const RAIL = { z: 0.05, from: 3.3, to: 2.45, speed: 0.6 }
// the cloth Rapier simulates is a sheet with no thickness, a particle every 6.5 cm; the one drawn is
// finer and has some body. A smooth surface is drawn through the particles - FINE points for every
// particle along each side - then made into a slab THICK metres deep: a top, an underside and an edge
// joining them, all moving with the particles, at no cost to the simulation. Round the border the
// cloth is folded under - a hem, HEM times as thick, which shows it has a thickness more than its depth
const FINE = 3, THICK = 0.006, HEM = 2
const M = (N - 1) * FINE + 1 // points drawn along each side
const MOVE = '#ffb000' // what can be dragged on the table is outlined in this
// the things on the table: Rapier sees each as a kinematic body you can push across it
const THINGS = [
  { name: 'Ball', at: [0.35, 0.12], shape: 'ball', size: 0.17, color: '#3b6fb6' },
  { name: 'Vase', at: [-0.4, -0.15], shape: 'vase', size: [0.1, 0.34], color: '#e0a23a' },
  { name: 'Box', at: [-0.15, 0.25], shape: 'box', size: 0.26, color: '#4f9a6a' },
]

const CHECKS = 8 // gingham checks across the cloth, each way
const THREADS = 24 // threads across each check, in the weave

/**
 * The cloth's face, painted in code: red and white gingham - white, the red stripes one way and the
 * other in mid red, deep red where they cross - with every thread a touch lighter or darker, so it
 * reads as woven rather than printed. One check a tile, repeated across the cloth.
 */
function gingham() {
  const S = 256, cell = S / THREADS, canvas = document.createElement('canvas')
  canvas.width = canvas.height = S
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'))
  const img = ctx.createImageData(S, S)
  const white = [250, 246, 238], stripe = [214, 74, 92], cross = [158, 16, 38]
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const across = x < S / 2, down = y < S / 2
      const base = across && down ? cross : across || down ? stripe : white
      // each thread's own shade, and where it dips under the crossing thread, a shadow
      const thread = 0.94 + 0.06 * Math.sin(Math.floor(x / cell) * 12.9898 + Math.floor(y / cell) * 78.233) ** 2
      const dip = 1 - 0.06 * Math.abs(Math.sin((x / cell) * Math.PI) * Math.sin((y / cell) * Math.PI))
      const o = (y * S + x) * 4
      for (let c = 0; c < 3; c++) img.data[o + c] = base[c] * thread * dip
      img.data[o + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return new Texture({ image: canvas, repeat: [CHECKS, CHECKS] })
}

/**
 * The weave as a normal map: threads over and under each other, plain weave - each little bump
 * tilting towards its neighbours - so the light catches the cloth's grain, at the same repeat as the
 * colour, thread for thread.
 */
function weave() {
  const S = 256, cell = S / THREADS, canvas = document.createElement('canvas')
  canvas.width = canvas.height = S
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'))
  const img = ctx.createImageData(S, S)
  // height: warp threads rise where weft threads fall, alternating each crossing
  const h = (/** @type {number} */ x, /** @type {number} */ y) => {
    const u = (x / cell) * Math.PI, v = (y / cell) * Math.PI
    return Math.sin(u) * Math.sin(v) * (Math.floor(x / cell + y / cell) % 2 ? 1 : -1) * 0.5 + 0.5 * Math.abs(Math.sin(u)) * 0.6
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = h(x + 1, y) - h(x - 1, y), dy = h(x, y + 1) - h(x, y - 1)
      const nx = -dx * 2.2, ny = -dy * 2.2, l = Math.hypot(nx, ny, 1), o = (y * S + x) * 4
      img.data[o] = (nx / l * 0.5 + 0.5) * 255
      img.data[o + 1] = (ny / l * 0.5 + 0.5) * 255
      img.data[o + 2] = (1 / l * 0.5 + 0.5) * 255
      img.data[o + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return new Texture({ image: canvas, colorSpace: 'linear', repeat: [CHECKS, CHECKS] })
}

/**
 * Normals across a grid of points, rows of `n` - each from its neighbours either way, so smooth - facing
 * the side the grid's rows turn to the left of its columns: up for the cloth laid flat, out to the
 * front hanging.
 * @param {Float32Array} p @param {number} n @param {Float32Array} out
 */
function gridNormals(p, n, out) {
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const a = (Math.min(i + 1, n - 1) * n + j) * 3, b = (Math.max(i - 1, 0) * n + j) * 3
      const c = (i * n + Math.min(j + 1, n - 1)) * 3, d = (i * n + Math.max(j - 1, 0)) * 3
      const ux = p[a] - p[b], uy = p[a + 1] - p[b + 1], uz = p[a + 2] - p[b + 2]
      const vx = p[c] - p[d], vy = p[c + 1] - p[d + 1], vz = p[c + 2] - p[d + 2]
      const x = vy * uz - vz * uy, y = vz * ux - vx * uz, z = vx * uy - vy * ux, l = Math.hypot(x, y, z) || 1
      out.set([x / l, y / l, z / l], (i * n + j) * 3)
    }
  }
  return out
}

/**
 * The cloth as it's drawn: a slab - top, underside and edge - over a fine grid of M by M points. The
 * grid's layout - texture coordinates and triangles - is made once; shape() then places it each frame,
 * from the particles.
 */
function sheet() {
  const top = 0, under = M * M, edge = 2 * M * M
  // the edge runs round the border, the cloth's front on its left: down one side, along, back, along
  /** @type {number[]} */
  const loop = []
  for (let j = 0; j < M - 1; j++) loop.push(j)
  for (let i = 0; i < M - 1; i++) loop.push(i * M + M - 1)
  for (let j = M - 1; j > 0; j--) loop.push((M - 1) * M + j)
  for (let i = M - 1; i > 0; i--) loop.push(i * M)
  const L = loop.length, count = edge + 2 * L

  const uvs = new Float32Array(count * 2)
  for (let i = 0; i < M; i++) {
    for (let j = 0; j < M; j++) {
      uvs.set([i / (M - 1), j / (M - 1)], (top + i * M + j) * 2)
      uvs.set([i / (M - 1), j / (M - 1)], (under + i * M + j) * 2)
    }
  }
  // the edge's texture: the border's, the underside a thread's width in from the top - so it has some
  for (let k = 0; k < L; k++) {
    const i = Math.floor(loop[k] / M) / (M - 1), j = (loop[k] % M) / (M - 1)
    uvs.set([i, j], (edge + k * 2) * 2)
    uvs.set([i + (i < 0.5 ? 1 : -1) * 0.002, j + (j < 0.5 ? 1 : -1) * 0.002], (edge + k * 2 + 1) * 2)
  }
  /** @type {number[]} */
  const indices = []
  for (let i = 0; i < M - 1; i++) {
    for (let j = 0; j < M - 1; j++) {
      const a = i * M + j, b = a + M, c = a + 1, d = b + 1
      indices.push(top + a, top + c, top + b, top + b, top + c, top + d)
      indices.push(under + a, under + b, under + c, under + b, under + d, under + c)
    }
  }
  for (let k = 0; k < L; k++) {
    const t0 = edge + k * 2, t1 = edge + ((k + 1) % L) * 2
    indices.push(t0, t0 + 1, t1, t1, t0 + 1, t1 + 1)
  }

  // a Catmull-Rom spline through every row of particles, then through every column of those: each
  // point drawn from the four particles nearest it, each way, passing through the particles themselves
  const seg = new Int32Array(M), w = new Float32Array(M * 4)
  for (let f = 0; f < M; f++) {
    const s = Math.min(Math.floor(f / FINE), N - 2), t = f / FINE - s
    seg[f] = s
    w.set([(-t * t * t + 2 * t * t - t) / 2, (3 * t * t * t - 5 * t * t + 2) / 2, (-3 * t * t * t + 4 * t * t + t) / 2, (t * t * t - t * t) / 2], f * 4)
  }
  /**
   * N points, `stride` apart from `from` in `src`, to M, `out` apart from `to` in `dst` - past each end
   * the line carries straight on.
   * @param {Float32Array} src @param {number} from @param {number} stride
   * @param {Float32Array} dst @param {number} to @param {number} out
   */
  const spline = (src, from, stride, dst, to, out) => {
    for (let f = 0; f < M; f++) {
      const s = seg[f]
      for (let c = 0; c < 3; c++) {
        const at = (/** @type {number} */ k) => src[from + k * stride + c]
        const p1 = at(s), p2 = at(s + 1)
        const p0 = s > 0 ? at(s - 1) : 2 * p1 - p2, p3 = s < N - 2 ? at(s + 2) : 2 * p2 - p1
        dst[to + f * out + c] = w[f * 4] * p0 + w[f * 4 + 1] * p1 + w[f * 4 + 2] * p2 + w[f * 4 + 3] * p3
      }
    }
  }
  const rows = new Float32Array(N * M * 3), mid = new Float32Array(M * M * 3), up = new Float32Array(M * M * 3)
  /** Half the cloth's thickness at each point - more round the hem. */
  const half = new Float32Array(M * M).fill(THICK / 2)
  for (const q of loop) half[q] = (THICK / 2) * HEM
  return {
    count, uvs, indices: new Uint32Array(indices),
    /**
     * Place the slab on the particles: the smooth surface through them, its top and underside half the
     * thickness either side, and the edge round them.
     * @param {Float32Array} particles @param {Geometry} g
     */
    shape(particles, g) {
      for (let i = 0; i < N; i++) spline(particles, i * N * 3, 3, rows, i * M * 3, 3)
      for (let j = 0; j < M; j++) spline(rows, j * 3, M * 3, mid, j * 3, M * 3)
      gridNormals(mid, M, up)
      const p = g.positions, n = g.normals
      for (let v = 0; v < M * M * 3; v += 3) {
        const h = half[v / 3]
        for (let c = 0; c < 3; c++) {
          p[top * 3 + v + c] = mid[v + c] + up[v + c] * h
          p[under * 3 + v + c] = mid[v + c] - up[v + c] * h
          n[top * 3 + v + c] = up[v + c]
          n[under * 3 + v + c] = -up[v + c]
        }
      }
      // the edge faces out: across the border, square to the way it runs and to the cloth's normal
      for (let k = 0; k < L; k++) {
        const q = loop[k] * 3, a = loop[(k + 1) % L] * 3, b = loop[(k + L - 1) % L] * 3
        const tx = mid[a] - mid[b], ty = mid[a + 1] - mid[b + 1], tz = mid[a + 2] - mid[b + 2]
        const ox = ty * up[q + 2] - tz * up[q + 1], oy = tz * up[q] - tx * up[q + 2], oz = tx * up[q + 1] - ty * up[q]
        const l = Math.hypot(ox, oy, oz) || 1, e = (edge + k * 2) * 3
        for (let c = 0; c < 3; c++) {
          p[e + c] = p[top * 3 + q + c]
          p[e + 3 + c] = p[under * 3 + q + c]
        }
        n.set([ox / l, oy / l, oz / l, ox / l, oy / l, oz / l], e)
      }
      g.needsUpdate()
    },
  }
}

export default async function run({ canvas, info }) {
  // the WebAssembly loads here; the -compat build has it inlined, so there is no .wasm file to serve
  await RAPIER.init()

  const view = new View({ canvas, orbit: true, background: '#e6e2db' })
  const { scene } = view
  scene.environment = 'studio'
  scene.environmentIntensity = 0.8
  scene.add(new DirectionalLight({ direction: [-0.4, -1, -0.5], intensity: 1.4, castShadow: true,
    shadowBounds: { min: [-2, 0, -2], max: [2, 2.6, 2] } }))
  scene.add(new Mesh({ geometry: plane(30), material: { color: '#cfc8bd', roughness: 0.9 }, receiveShadow: true, pickable: false }))

  // ---- the table, drawn, and as Rapier sees it: a top and four legs
  const wood = { color: '#9a6b44', roughness: 0.55 }
  const table = scene.add(new Group({ pickable: false }))
  table.add(new Mesh({ geometry: box({ width: TABLE.w, height: 0.05, depth: TABLE.d }), position: [0, TABLE.top - 0.025, 0], material: wood }))
  const legs = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => [sx * (TABLE.w / 2 - 0.08), sz * (TABLE.d / 2 - 0.08)])
  for (const [x, z] of legs) table.add(new Mesh({ geometry: box({ width: 0.06, height: TABLE.top - 0.05, depth: 0.06 }), position: [x, (TABLE.top - 0.05) / 2, z], material: wood }))
  table.traverse((n) => { /** @type {any} */ (n).castShadow = /** @type {any} */ (n).receiveShadow = true })

  // ---- the cloth, drawn: one Geometry - the slab - built once, its points and normals worked out
  // from the particles each frame, then needsUpdate() has phoria2 upload them
  const slab = sheet()
  const cloth = scene.add(new Mesh({ geometry: plane(0.01), castShadow: true, receiveShadow: true,
    // cotton: rough, with little of a hard surface's reflection - a soft sheen at grazing angles, the
    // fabric's own red rather than white, so it glows rather than greys
    material: { map: gingham(), normalMap: weave(), normalScale: 0.8, roughness: 0.82, specularIntensity: 0.35,
      sheen: 0.7, sheenColor: '#ffb3bd', sheenRoughness: 0.55 } }))

  /**
   * Where the particles were at the last step but one, and at the last - the cloth is drawn between -
   * and where they're drawn, eased towards that.
   */
  const before = new Float32Array(N * N * 3), after = new Float32Array(N * N * 3), drawn = new Float32Array(N * N * 3)

  // ---- the world: rebuilt for each way of showing the cloth
  /** @type {RAPIER.World} */
  let world
  /** @type {RAPIER.SoftBody} */
  let body
  /** @type {{ thing: typeof THINGS[number], node: Group, body: RAPIER.RigidBody }[]} */
  const things = []
  /** Everything solid the cloth lies on: the floor, the table, the things on it. @type {RAPIER.Collider[]} */
  let solids = []
  let mode = /** @type {'drape' | 'hang'} */ ('drape')
  /** The rail's height, while it lowers. */
  let rail = RAIL.from
  /** Lower the rail a step, taking the cloth's top row with it - all but a particle being dragged. @param {number} dt */
  const lower = (dt) => {
    if (mode !== 'hang' || rail <= RAIL.to) return
    rail = Math.max(RAIL.to, rail - RAIL.speed * dt)
    for (let i = 0; i < N; i++) {
      if (i * N !== grabbed) body.setParticleKinematicTarget(i * N, { x: -SIZE / 2 + (i * SIZE) / (N - 1), y: rail, z: RAIL.z })
    }
  }
  let wind = false

  const build = () => {
    world?.free()
    world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    world.timestep = STEP
    solids = [
      world.createCollider(RAPIER.ColliderDesc.cuboid(15, 0.5, 15).setTranslation(0, -0.5, 0)),
      world.createCollider(RAPIER.ColliderDesc.cuboid(TABLE.w / 2, 0.025, TABLE.d / 2).setTranslation(0, TABLE.top - 0.025, 0)),
      ...legs.map(([x, z]) => world.createCollider(RAPIER.ColliderDesc.cuboid(0.03, (TABLE.top - 0.05) / 2, 0.03).setTranslation(x, (TABLE.top - 0.05) / 2, z))),
    ]
    for (const t of things) {
      const p = t.node.position
      t.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, p.y, p.z))
      solids.push(world.createCollider(colliderOf(t.thing), t.body))
    }
    // the cloth: flat above the table, to fall on it - or hanging from its rail, its top row pinned
    const step = SIZE / (N - 1)
    rail = RAIL.from
    const desc = mode === 'drape'
      ? RAPIER.SoftBodyDesc.cloth({ x: -SIZE / 2, y: 1.5, z: -SIZE / 2 }, { x: step, y: 0, z: 0 }, { x: 0, y: 0, z: step }, N, N)
      : RAPIER.SoftBodyDesc.cloth({ x: -SIZE / 2, y: RAIL.from, z: RAIL.z }, { x: step, y: 0, z: 0 }, { x: 0, y: -step, z: 0 }, N, N)
          .setPinnedParticles(Array.from({ length: N }, (_, i) => i * N))
    body = world.createSoftBody(desc.setLinearDamping(DAMPING))
    before.set(body.particlePositions())
    after.set(before)
    drawn.set(before)
    const geometry = new Geometry({ positions: new Float32Array(slab.count * 3), normals: new Float32Array(slab.count * 3), uvs: slab.uvs, indices: slab.indices })
    cloth.geometry.dispose()
    cloth.geometry = geometry
    slab.shape(drawn, geometry)
    grabbed = -1
  }
  /** @param {typeof THINGS[number]} t */
  const colliderOf = (t) => (t.shape === 'ball' ? RAPIER.ColliderDesc.ball(/** @type {number} */ (t.size))
    : t.shape === 'vase' ? RAPIER.ColliderDesc.cylinder(/** @type {number[]} */ (t.size)[1] / 2, /** @type {number[]} */ (t.size)[0])
    : RAPIER.ColliderDesc.cuboid(/** @type {number} */ (t.size) / 2, /** @type {number} */ (t.size) / 2, /** @type {number} */ (t.size) / 2))

  // ---- the things on the table, outlined, as the path finding demo's cabinets are: drag one and its
  // kinematic body follows, pushing the cloth over it
  for (const thing of THINGS) {
    const half = thing.shape === 'ball' ? /** @type {number} */ (thing.size) : thing.shape === 'vase' ? /** @type {number[]} */ (thing.size)[1] / 2 : /** @type {number} */ (thing.size) / 2
    const node = scene.add(new Group({ position: [thing.at[0], TABLE.top + half, thing.at[1]], highlight: '#dbe9ff', highlightWhole: true,
      outline: { color: MOVE, width: 2 }, tooltip: () => `${thing.name} - drag to move` }))
    const geometry = thing.shape === 'ball' ? icosphere({ radius: /** @type {number} */ (thing.size), detail: 3 })
      : thing.shape === 'vase' ? cylinder({ radius: /** @type {number[]} */ (thing.size)[0], height: /** @type {number[]} */ (thing.size)[1] })
      : box(/** @type {number} */ (thing.size))
    node.add(new Mesh({ geometry, material: { color: thing.color, roughness: 0.35 }, castShadow: true, receiveShadow: true }))
    const t = { thing, node, body: /** @type {any} */ (null) }
    node.onDrag = (drag) => {
      if (!drag.point) return
      const r = thing.shape === 'box' ? 0.14 : 0.12
      const x = Math.min(TABLE.w / 2 - r, Math.max(-TABLE.w / 2 + r, drag.point[0]))
      const z = Math.min(TABLE.d / 2 - r, Math.max(-TABLE.d / 2 + r, drag.point[2]))
      node.position.set(x, node.position.y, z)
      t.body.setNextKinematicTranslation({ x, y: node.position.y, z })
    }
    things.push(t)
  }

  // ---- grabbing the cloth: the particle nearest the pointer is pinned and led by it, across a
  // plane through it that faces the camera - so you can lift the cloth, not only slide it - and let
  // go when you do. A pinned particle goes where it's told, through anything: led through the table,
  // it would drag the cloth through after it, its neighbours shaking as their contacts fight it. So
  // it's led as a ball would be pushed: from where it was, it stops at the first surface in its way -
  // a particle's thickness off it - and carries on along it, so pulled down onto the table, it slides
  // across it, and pulled lower still, stays on top
  let grabbed = -1
  /** Where the grabbed particle was last led. */
  let led = { x: 0, y: 0, z: 0 }
  /** Lead the grabbed particle from where it was towards `to`, sliding over whatever's in the way. @param {ArrayLike<number>} to */
  const lead = (to) => {
    const r = body.particleRadius()
    let p = led, move = { x: to[0] - p.x, y: to[1] - p.y, z: to[2] - p.z }
    for (let pass = 0; pass < 3; pass++) {
      const length = Math.hypot(move.x, move.y, move.z)
      if (length < 1e-6) break
      const ray = new RAPIER.Ray(p, { x: move.x / length, y: move.y / length, z: move.z / length })
      /** @type {RAPIER.RayIntersection | null} */
      let first = null
      for (const solid of solids) {
        const hit = solid.castRayAndGetNormal(ray, length + r, true)
        // heading into the surface, not already leaving it
        if (hit && hit.normal.x * ray.dir.x + hit.normal.y * ray.dir.y + hit.normal.z * ray.dir.z < 0 && (!first || hit.timeOfImpact < first.timeOfImpact)) first = hit
      }
      if (!first) {
        p = { x: p.x + move.x, y: p.y + move.y, z: p.z + move.z }
        break
      }
      // stop a particle's thickness short, measured off the surface, then slide: what's left of the
      // move, less the part into the surface
      const n = first.normal, into = ray.dir.x * n.x + ray.dir.y * n.y + ray.dir.z * n.z
      const go = Math.max(0, first.timeOfImpact + r / into)
      const left = length - go
      p = { x: p.x + ray.dir.x * go, y: p.y + ray.dir.y * go, z: p.z + ray.dir.z * go }
      move = { x: ray.dir.x * left, y: ray.dir.y * left, z: ray.dir.z * left }
      const push = move.x * n.x + move.y * n.y + move.z * n.z
      move = { x: move.x - n.x * push, y: move.y - n.y * push, z: move.z - n.z * push }
    }
    led = clear([p.x, p.y, p.z])
    return led
  }
  /** The nearest place to `at` that a particle could be - outside every solid, by its radius. @param {ArrayLike<number>} at */
  const clear = (at) => {
    let p = { x: at[0], y: at[1], z: at[2] }
    const r = body.particleRadius()
    for (let pass = 0; pass < 3; pass++) {
      let moved = false
      for (const solid of solids) {
        const on = solid.projectPoint(p, false)
        if (!on) continue
        const dx = p.x - on.point.x, dy = p.y - on.point.y, dz = p.z - on.point.z, d = Math.hypot(dx, dy, dz)
        if (!on.isInside && d >= r) continue
        // inside, out is towards the surface; outside but too close, out is away from it
        const k = (on.isInside ? -r : r) / (d || 1)
        p = d ? { x: on.point.x + dx * k, y: on.point.y + dy * k, z: on.point.z + dz * k } : { x: p.x, y: on.point.y + r, z: p.z }
        moved = true
      }
      if (!moved) break
    }
    return p
  }
  cloth.onDrag = (drag) => {
    if (drag.phase === 'start') {
      const p = body.particlePositions(), at = drag.hit.point
      let best = Infinity
      for (let i = 0; i < p.length / 3; i++) {
        const d = (p[i * 3] - at[0]) ** 2 + (p[i * 3 + 1] - at[1]) ** 2 + (p[i * 3 + 2] - at[2]) ** 2
        if (d < best) [best, grabbed] = [d, i]
      }
      const eye = view.camera.position
      const facing = [eye[0] - at[0], 0, eye[2] - at[2]], l = Math.hypot(facing[0], facing[2]) || 1
      drag.plane.normal.set(facing[0] / l, 0, facing[2] / l)
      drag.plane.point.copy(at)
      // a particle already pinned - the curtain's top row - is moved along its rail, and stays pinned
      held = body.isParticlePinned(grabbed)
      body.setParticlePinned(grabbed, true)
      led = clear(p.subarray(grabbed * 3, grabbed * 3 + 3))
    }
    if (grabbed < 0) return
    if (drag.point) body.setParticleKinematicTarget(grabbed, lead(drag.point))
    if (drag.phase === 'end') {
      if (!held) body.setParticlePinned(grabbed, false)
      grabbed = -1
    }
  }
  let held = false

  // ---- wind: a gusting breeze from the front left, pushing hardest where the cloth faces into it -
  // as a share of each particle's weight, so it blows the same whatever the cloth's mass
  const WIND = [0.55, 0, -0.84], STRENGTH = 1.6
  /** @param {number} t */
  const blow = (t) => {
    body.resetForces(false)
    if (!wind) return
    const p = body.particlePositions(), n = gridNormals(p, N, new Float32Array(N * N * 3)), weight = body.particleMass(0) * 9.81
    const gust = 0.6 + 0.4 * Math.sin(t * 1.3) * Math.sin(t * 0.7 + 1)
    for (let i = 0; i < N * N; i++) {
      const face = Math.abs(n[i * 3] * WIND[0] + n[i * 3 + 2] * WIND[2])
      const ripple = 0.7 + 0.3 * Math.sin(t * 4 + p[i * 3] * 3 + p[i * 3 + 1] * 2)
      const k = STRENGTH * weight * gust * ripple * face
      body.addParticleForce(i, { x: WIND[0] * k, y: 0.15 * k, z: WIND[2] * k }, true)
    }
  }

  // ---- the controls: drape it or hang it, and the wind
  const bar = document.createElement('div')
  bar.className = 'hud cloth-bar'
  bar.innerHTML = `
    <button type="button" data-mode="drape" title="Drop the cloth over the table">Drape</button>
    <button type="button" data-mode="hang" title="Hang the cloth from a rail, as a curtain">Hang</button>
    <span class="cloth-gap"></span>
    <button type="button" data-wind title="A gusting breeze">Wind</button>`
  document.body.append(bar)
  const show = () => {
    for (const b of bar.querySelectorAll('[data-mode]')) b.classList.toggle('now', /** @type {HTMLElement} */ (b).dataset.mode === mode)
    bar.querySelector('[data-wind]')?.classList.toggle('now', wind)
  }
  bar.addEventListener('click', (event) => {
    const button = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (event.target).closest('button'))
    if (!button) return
    if (button.dataset.mode) {
      mode = /** @type {'drape' | 'hang'} */ (button.dataset.mode)
      build()
      frame(0.8)
    } else if ('wind' in button.dataset) wind = !wind
    show()
  })

  /** Frame the table, close - and, hanging, the rail above it. @param {number} [duration] */
  const frame = (duration = 0) => view.frame(mode === 'drape' ? new Box3([-1.05, 0, -0.7], [1.05, 1.25, 0.7]) : new Box3([-1.05, 0, -0.6], [1.05, RAIL.to + 0.05, 0.6]),
    { direction: [0.5, 0.65, 1], padding: 0.04, duration })

  build()
  show()
  frame()
  if (import.meta.env.DEV) Object.assign(window, { view, cloth, body: () => body })

  // ---- each frame: Rapier steps - once or twice, for the time that passed - then the bridge copies
  // the particles into the cloth's positions, and needsUpdate() has phoria2 upload them and work out
  // the normals again. The screen draws more often than Rapier steps - 144 times a second against 60 -
  // so the cloth is drawn part way from the step before last towards the last, by how far into the next
  // step the frame falls; otherwise it would move on some frames and not others, and judder
  let owed = 0, spent = 0, steps = 0, shown = 0
  return view.start((dt, t) => {
    owed = Math.min(owed + dt, STEP * 2)
    const t0 = performance.now()
    while (owed >= STEP) {
      lower(STEP)
      blow(t)
      before.set(after)
      world.step()
      after.set(body.particlePositions())
      owed -= STEP
      steps++
    }
    spent += performance.now() - t0
    // where the cloth is now, between the last two steps - and where it's drawn, eased towards that
    const k = owed / STEP, at = drawn, ease = 1 - (1 - EASE) ** (dt * 60)
    for (let i = 0; i < at.length; i += 3) {
      const dx = before[i] + (after[i] - before[i]) * k - at[i]
      const dy = before[i + 1] + (after[i + 1] - before[i + 1]) * k - at[i + 1]
      const dz = before[i + 2] + (after[i + 2] - before[i + 2]) * k - at[i + 2]
      const f = Math.min(1, ease + Math.hypot(dx, dy, dz) / SMALL)
      at[i] += dx * f
      at[i + 1] += dy * f
      at[i + 2] += dz * f
    }
    slab.shape(drawn, cloth.geometry)
    for (const { node, body: b } of things) {
      const p = b.translation()
      node.position.set(p.x, p.y, p.z)
    }
    if ((shown += dt) > 0.5) {
      info.textContent = `Rapier ${RAPIER.version()} · ${(N * N).toLocaleString()} particles · ${steps ? (spent / steps).toFixed(1) : '0.0'} ms a step`
      shown = spent = steps = 0
    }
  })
}
