import RAPIER from '@dimforge/rapier3d-compat'
import { Box3, DirectionalLight, Geometry, InstancedMesh, Label, Mesh, PointLight, Raycaster, Texture, View, icosphere, plane } from 'phoria2'
import { random } from './kit.js'

// A tower of 477 bricks - or two or four times as many, smaller - knocked down with Rapier (rapier.rs),
// a physics engine written in Rust, compiled to WebAssembly. Rapier owns the motion: the bodies, their
// collisions and the forces between them. phoria2 owns the picture: the bricks are instances of one
// InstancedMesh and the bands of stone every fifth course another, so the tower is two draw calls.
// Each frame Rapier steps and the bridge copies its bodies' positions and turns into the instances.
// Then phoria2's own features go on top: a click fires a ball at what is under the pointer - or drops
// a bomb on it from above, which bursts where it lands - the hardest hits and the blasts get callouts
// at the point of impact, and hovering a block says what Rapier knows about it. Rapier sees each block
// as a plain box, a stone three times as dense as a brick; phoria2 draws the brick with its frog - the
// hollow in its top - the stone with rounded edges, both with a sandy, pitted face painted in code.

// a brick in a real one's proportions (215 x 65 x 102.5 mm)
const [LONG, HIGH, DEEP] = [0.82, 0.26, 0.4]
// the tower: the same size whatever it's built of - its outside face 2.8 m from the middle, 26 full-size
// courses tall. More bricks are smaller ones: two or four times as many, more round each course and more
// courses, each brick scaled down by the square root
const OUTSIDE = 2.8, COURSES = 26
const DENSITIES = [1, 2, 4]
/** The tower built of n times the bricks: their scale, the radius of the wall's middle, bricks round and courses. @param {number} n */
const towerOf = (n) => {
  const s = 1 / Math.sqrt(n), radius = OUTSIDE - (DEEP * s) / 2
  // as many bricks round as clear each other at the wall's inner face - an even number, so the
  // battlements on top alternate all the way round
  let around = Math.floor(Math.PI / Math.atan((LONG * s) / 2 / (OUTSIDE - DEEP * s - 0.07 * s)))
  around -= around % 2
  return { s, radius, around, rings: Math.round(COURSES / s) }
}
/**
 * A tower's button: a patch of wall in its size of brick - two, three or four courses in the same
 * square, so the bricks shrink as the towers' do - drawn in the button's text colour.
 * @param {number} n the tower, as times the first's bricks
 */
const wallIcon = (n) => {
  const rows = { 1: 2, 2: 3, 4: 4 }[n] ?? 2, h = 16 / rows, long = h * 2
  let bricks = ''
  for (let r = 0; r < rows; r++) {
    // every other course shifted half a brick, as in the tower
    for (let x = r % 2 ? -long / 2 : 0; x < 24; x += long) {
      bricks += `<rect x="${(x + 0.6).toFixed(2)}" y="${(r * h + 0.6).toFixed(2)}" width="${(long - 1.2).toFixed(2)}" height="${(h - 1.2).toFixed(2)}" rx="0.6"/>`
    }
  }
  return `<svg viewBox="0 0 24 16" width="24" height="16" fill="currentColor" aria-hidden="true">${bricks}</svg>`
}
const BRICK_SIZES = { 1: 'Large', 2: 'Medium', 4: 'Small' }
/** Bricks in the tower: its courses, and every other brick of the battlements on top. @param {number} n */
const bricksIn = (n) => {
  const { around, rings } = towerOf(n)
  return rings * around + around / 2
}
const BALL = 0.45 // a ball's radius
const SPEED = 35 // and how fast it leaves the camera, in m/s
const MAX_BALLS = 10 // the oldest ball goes when another is fired
const BOMB = 0.3, MAX_BOMBS = 2 // a bomb's radius, and how many can be in the air
const DROP = 11 // the height every bomb falls from, in m - well above the tower's top
const BLAST = { radius: 3.3, kick: 30 } // how far a blast reaches, and the speed it gives a body at its centre, in m/s
const STEP = 1 / 60 // Rapier's fixed timestep; the frame's time is spent in steps of this
const SETTLE = 300 // the most steps a new tower is given to settle under its own weight
const HIT = 400 // newtons: hits harder than this get a callout
const BRICK = ['#a64b36', '#9c4432', '#b0553c', '#94402f', '#a95a42', '#9f4a37', '#8e3d2d']
const STONE = ['#8e8f8f', '#9b9a95', '#7d8083', '#a5a39d', '#888a8c', '#949189', '#82847f']
// every fifth course is a band of stone: rounded grey blocks, three times a brick's density
const BAND = 5, DENSITY = { brick: 4, stone: 12 }
// how many courses deep a band is, for each tower: the smaller the blocks, the more courses of them
const BAND_DEPTH = { 1: 1, 2: 2, 4: 3 }

/**
 * A brick with its frog: a box whose top is a rim round a hollow, the hollow's sides sloping in to its
 * floor. Each face has its own corners, so the edges stay sharp, and its texture coordinates are
 * taken straight from its position - side on to the face - so the surface is the same scale all over.
 */
function brickGeometry() {
  const [x, y, z] = [LONG / 2, HIGH / 2, DEEP / 2]
  // the hollow: its opening in from the edges, its floor further in and down
  const [ox, oz, slope, depth] = [x - 0.1, z - 0.08, 0.035, 0.06]
  const [fx, fz, fy] = [ox - slope, oz - slope, y - depth]
  /** @type {number[]} */ const positions = [], normals = [], uvs = [], indices = []
  /** A face from four corners round it, turned to face along `towards`. @param {number[][]} corners @param {number[]} towards */
  const face = (corners, towards) => {
    const [a, b, c] = corners
    const u = b.map((v, i) => v - a[i]), w = c.map((v, i) => v - a[i])
    let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
    if (n[0] * towards[0] + n[1] * towards[1] + n[2] * towards[2] < 0) {
      corners = [...corners].reverse()
      n = n.map((v) => -v)
    }
    const l = Math.hypot(...n)
    // the texture across the face, from the two axes it lies most along
    const up = Math.abs(n[1]) >= Math.max(Math.abs(n[0]), Math.abs(n[2])), side = Math.abs(n[0]) > Math.abs(n[2])
    const start = positions.length / 3
    for (const p of corners) {
      positions.push(...p)
      normals.push(...n.map((v) => v / l))
      uvs.push((up || !side ? p[0] : p[2]) * 2.4, (up ? p[2] : p[1]) * 2.4)
    }
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3)
  }
  // the bottom and the four sides
  face([[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]], [0, -1, 0])
  face([[x, -y, -z], [x, y, -z], [x, y, z], [x, -y, z]], [1, 0, 0])
  face([[-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]], [-1, 0, 0])
  face([[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]], [0, 0, 1])
  face([[-x, -y, -z], [-x, y, -z], [x, y, -z], [x, -y, -z]], [0, 0, -1])
  // the rim round the top, in four pieces, from the edge in to the hollow
  face([[-x, y, z], [x, y, z], [ox, y, oz], [-ox, y, oz]], [0, 1, 0])
  face([[-x, y, -z], [-ox, y, -oz], [ox, y, -oz], [x, y, -z]], [0, 1, 0])
  face([[x, y, -z], [ox, y, -oz], [ox, y, oz], [x, y, z]], [0, 1, 0])
  face([[-x, y, -z], [-x, y, z], [-ox, y, oz], [-ox, y, -oz]], [0, 1, 0])
  // the hollow's sloping sides, each facing in across it, and its floor
  face([[-ox, y, oz], [ox, y, oz], [fx, fy, fz], [-fx, fy, fz]], [0, 0, -1])
  face([[-ox, y, -oz], [-fx, fy, -fz], [fx, fy, -fz], [ox, y, -oz]], [0, 0, 1])
  face([[ox, y, -oz], [fx, fy, -fz], [fx, fy, fz], [ox, y, oz]], [-1, 0, 0])
  face([[-ox, y, -oz], [-ox, y, oz], [-fx, fy, fz], [-fx, fy, -fz]], [1, 0, 0])
  face([[-fx, fy, -fz], [-fx, fy, fz], [fx, fy, fz], [fx, fy, -fz]], [0, 1, 0])
  return new Geometry({ positions, normals, uvs, indices })
}

/**
 * A stone: a brick-sized block with every edge and corner rounded. Each face is a grid, finer towards
 * its edges; each point is pulled onto the rounded box - kept within a box shrunk by the rounding,
 * then pushed out from it by the rounding's radius - and faces that way, so the curves shade smoothly.
 * The grid lines towards an edge are spaced so the curve is cut into even angles.
 * @param {number} [round] the radius of the rounding
 */
function stoneGeometry(round = 0.035) {
  const half = [LONG / 2, HIGH / 2, DEEP / 2], steps = 4
  /** Grid lines across one side of a face, from edge to edge. @param {number} h half the side */
  const across = (h) => {
    const out = []
    for (let i = steps; i >= 0; i--) out.push(-(h - round + round * Math.tan((Math.PI / 4) * (i / steps))))
    for (let i = 0; i <= steps; i++) out.push(h - round + round * Math.tan((Math.PI / 4) * (i / steps)))
    return out
  }
  /** @type {number[]} */ const positions = [], normals = [], uvs = [], indices = []
  for (const k of [0, 1, 2]) {
    // the two axes across a face that looks along axis k, in the order that makes it face outward
    const a = (k + 1) % 3, b = (k + 2) % 3, ta = across(half[a]), tb = across(half[b])
    for (const sign of [1, -1]) {
      const start = positions.length / 3
      for (const vb of tb) {
        for (const va of ta) {
          const p = [0, 0, 0]
          p[k] = sign * half[k]
          p[a] = va
          p[b] = vb
          const c = p.map((v, i) => Math.max(-(half[i] - round), Math.min(half[i] - round, v)))
          const d = p.map((v, i) => v - c[i]), l = Math.hypot(...d)
          const n = d.map((v) => v / l), at = c.map((v, i) => v + n[i] * round)
          positions.push(...at)
          normals.push(...n)
          // the texture across the face from the two axes it lies along, as on the bricks
          uvs.push((k === 0 ? at[2] : at[0]) * 2.4, (k === 1 ? at[2] : at[1]) * 2.4)
        }
      }
      const w = ta.length
      for (let j = 0; j < tb.length - 1; j++) {
        for (let i = 0; i < w - 1; i++) {
          const q = start + j * w + i, quad = [q, q + 1, q + w + 1, q + w]
          if (sign < 0) quad.reverse()
          indices.push(quad[0], quad[1], quad[2], quad[0], quad[2], quad[3])
        }
      }
    }
  }
  return new Geometry({ positions, normals, uvs, indices })
}

/**
 * A brick's face, painted in code as two tiling textures: a mottled, speckled shade that each brick's
 * own colour multiplies, and a normal map of the same grain - sandy, with pits - so light catches it.
 */
function brickSurface() {
  const S = 256, rand = random(11)
  /** Smooth noise that tiles, `cells` blobs across. @param {number} cells */
  const noise = (cells) => {
    const grid = Array.from({ length: cells * cells }, rand)
    const at = (i, j) => grid[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)]
    return (/** @type {number} */ px, /** @type {number} */ py) => {
      const gx = (px / S) * cells, gy = (py / S) * cells, i = Math.floor(gx), j = Math.floor(gy)
      const sx = (gx - i) ** 2 * (3 - 2 * (gx - i)), sy = (gy - j) ** 2 * (3 - 2 * (gy - j))
      const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1)
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
    }
  }
  const [broad, fine, grain] = [noise(6), noise(24), noise(96)]
  const shade = new Float32Array(S * S), height = new Float32Array(S * S)
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const i = py * S + px, speck = rand()
      // pits: a few dark specks sunk into the surface; flecks: a few lighter grains
      const pit = speck < 0.025 ? 1 : 0
      shade[i] = Math.min(1, 0.8 + 0.12 * broad(px, py) + 0.08 * fine(px, py) - pit * 0.3 + (speck > 0.985 ? 0.15 : 0))
      height[i] = 0.5 * fine(px, py) + 0.5 * grain(px, py) - pit * 0.9
    }
  }
  const canvas = (/** @type {(i: number, out: Uint8ClampedArray, o: number) => void} */ paint) => {
    const c = document.createElement('canvas')
    c.width = c.height = S
    const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'))
    const img = ctx.createImageData(S, S)
    for (let i = 0; i < S * S; i++) paint(i, img.data, i * 4)
    ctx.putImageData(img, 0, 0)
    return c
  }
  const h = (px, py) => height[((py + S) % S) * S + ((px + S) % S)]
  const map = canvas((i, out, o) => {
    out[o] = out[o + 1] = out[o + 2] = shade[i] * 255
    out[o + 3] = 255
  })
  const normalMap = canvas((i, out, o) => {
    const px = i % S, py = Math.floor(i / S)
    const nx = -(h(px + 1, py) - h(px - 1, py)) * 1.6, ny = -(h(px, py + 1) - h(px, py - 1)) * 1.6, l = Math.hypot(nx, ny, 1)
    out[o] = (nx / l * 0.5 + 0.5) * 255
    out[o + 1] = (ny / l * 0.5 + 0.5) * 255
    out[o + 2] = (1 / l * 0.5 + 0.5) * 255
    out[o + 3] = 255
  })
  return { map: new Texture({ image: map }), normalMap: new Texture({ image: normalMap, colorSpace: 'linear' }) }
}

export default async function run({ canvas, info }) {
  // the WebAssembly loads here; the -compat build has it inlined, so there is no .wasm file to serve
  await RAPIER.init()

  const view = new View({ canvas, orbit: true, background: '#e8e4dc', highlight: '#ffffff',
    tooltip: (hit) => ((hit.node === bricks || hit.node === stones) && hit.instance !== null ? aboutBrick(slots[hit.node === stones ? 'stone' : 'brick'][hit.instance]) : null) })
  const { scene, camera } = view
  scene.environment = 'studio'
  scene.environmentIntensity = 0.5
  // shadows over the ground round the tower, where the debris lands - kept sharp however far a brick
  // flies; the area grows with the tower
  const sun = scene.add(new DirectionalLight({ direction: [-0.5, -1, -0.35], intensity: 1.6, castShadow: true }))
  scene.add(new Mesh({ geometry: plane(400), material: { color: '#d9d3c7', roughness: 0.95 }, receiveShadow: true, pickable: false }))

  // ---- what phoria2 draws: one InstancedMesh of bricks and one of stones - each with room for the
  // biggest tower, drawing as many as the tower has - one of balls, one of bombs. Bricks and stones
  // share the painted surface, the stones a little smoother
  const surface = brickSurface(), most = bricksIn(Math.max(...DENSITIES))
  const bricks = scene.add(new InstancedMesh({ geometry: brickGeometry(), count: most,
    material: { ...surface, roughness: 0.9 }, castShadow: true, receiveShadow: true }))
  const stones = scene.add(new InstancedMesh({ geometry: stoneGeometry(), count: most,
    material: { ...surface, roughness: 0.7 }, castShadow: true, receiveShadow: true }))
  const MESHES = { brick: bricks, stone: stones }

  // ---- the tower as Rapier sees it: where each brick starts, and how it is turned. A course's bricks
  // stand side by side round a circle, every other course shifted half a brick, like brickwork; on top
  // every other brick of a last course makes the battlements
  /** How many times the first tower's bricks. */
  let size = 2
  /** The bricks' scale: smaller, the more of them there are. */
  let scale = 1
  /**
   * Each block of the tower: where it starts, how it is turned, its course, what it is and the instance
   * it's drawn as - its slot in its kind's InstancedMesh.
   * @type {{ position: [number, number, number], turn: number, course: number, kind: 'brick' | 'stone', slot: number }[]}
   */
  let layout = []
  /** Which block each instance of each kind is, for the tooltip. @type {{ brick: number[], stone: number[] }} */
  let slots = { brick: [], stone: [] }
  let radius = 0, height = 0
  /** Lay out the tower at the size chosen, colour its bricks - once, as the bridge never recolours them - and shade round it. */
  const plan = () => {
    const { s, radius: r, around, rings } = towerOf(size), rand = random(7), high = HIGH * s
    scale = s
    radius = OUTSIDE
    height = (rings + 1) * high
    layout = []
    slots = { brick: [], stone: [] }
    for (let course = 0; course <= rings; course++) {
      // a band of stone every fifth course - counting the courses as full-size bricks, so the bands are
      // as far apart however small the bricks - one, two or three courses deep, but never the battlements
      const starts = (/** @type {number} */ c) => c >= 0 && Math.floor((c + 1) * s / BAND) > Math.floor(c * s / BAND)
      const depth = BAND_DEPTH[/** @type {keyof typeof BAND_DEPTH} */ (size)] ?? 1
      const kind = course < rings && Array.from({ length: depth }, (_, k) => starts(course - k)).some(Boolean) ? 'stone' : 'brick'
      for (let j = 0; j < around; j++) {
        if (course === rings && j % 2) continue
        const a = ((j + (course % 2) / 2) / around) * Math.PI * 2
        const slot = slots[kind].push(layout.length) - 1
        // turned so the brick's length runs round the circle
        layout.push({ position: [r * Math.cos(a), high / 2 + course * high, r * Math.sin(a)], turn: -a - Math.PI / 2, course, kind, slot })
        MESHES[kind].setColor(slot, (kind === 'stone' ? STONE : BRICK)[Math.floor(rand() * 7)])
      }
    }
    bricks.count = slots.brick.length
    stones.count = slots.stone.length
    const reach = radius + 7.5
    sun.shadowBounds = { min: [-reach, 0, -reach], max: [reach, height + 0.5, reach] }
  }
  const balls = scene.add(new InstancedMesh({ geometry: icosphere({ radius: 1, detail: 3 }), count: MAX_BALLS,
    material: { color: '#3b3f46', metalness: 0.9, roughness: 0.25 }, castShadow: true, pickable: false }))
  // bombs: smaller, glowing at the seams
  const bombs = scene.add(new InstancedMesh({ geometry: icosphere({ radius: 1, detail: 3 }), count: MAX_BOMBS,
    material: { color: '#26221f', emissive: '#c2410c', roughness: 0.4 }, castShadow: true, pickable: false }))
  /** What each kind of shot is drawn as, and how big. */
  const KINDS = { ball: { mesh: balls, size: BALL, most: MAX_BALLS }, bomb: { mesh: bombs, size: BOMB, most: MAX_BOMBS } }

  // ---- the physics world: rebuilt from the layout on reset
  /** @type {RAPIER.World} */
  let world
  /** @type {RAPIER.RigidBody[]} */
  let bodies = []
  /**
   * The shots in flight, oldest first, each with the instance it is drawn as.
   * @typedef {{ kind: keyof typeof KINDS, body: RAPIER.RigidBody, slot: number, called: boolean, born: number }} Shot
   * @type {Shot[]}
   */
  let flying = []
  /** Shot colliders by handle, for telling which body in a contact is the shot. @type {Map<number, Shot>} */
  let ballOf = new Map()
  const events = new RAPIER.EventQueue(true)

  const build = () => {
    world?.free()
    world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    world.timestep = STEP
    // the ground: a fixed slab whose top is y = 0, where the plane is drawn
    world.createCollider(RAPIER.ColliderDesc.cuboid(60, 0.5, 60).setTranslation(0, -0.5, 0).setFriction(0.9))
    bodies = layout.map(({ position: [x, y, z], turn, kind }) => {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z)
        .setRotation({ x: 0, y: Math.sin(turn / 2), z: 0, w: Math.cos(turn / 2) }))
      // the same box to Rapier either way - a stone is just denser, so heavier, and smoother
      world.createCollider(RAPIER.ColliderDesc.cuboid((LONG * scale) / 2, (HIGH * scale) / 2, (DEEP * scale) / 2)
        .setFriction(kind === 'stone' ? 0.8 : 1).setDensity(DENSITY[kind]), body)
      return body
    })
    // settled, then asleep, so the tower stands still until something hits it. Rapier's contacts are
    // soft - each sinks a little under the weight above it, like a stiff spring - so a tower stacked
    // exactly sags as it wakes: the bottom courses squeeze down by about a centimetre each, and the
    // top drops by half a brick or more. So it's left to sag here, before it's seen: stepped until it
    // has stopped moving, then put to sleep as it stands
    for (let step = 0, still = 0; step < SETTLE && still < 10; step++) {
      world.step()
      let fastest = 0
      for (const body of bodies) {
        const v = body.linvel()
        fastest = Math.max(fastest, Math.abs(v.x), Math.abs(v.y), Math.abs(v.z))
      }
      still = fastest < 0.005 ? still + 1 : 0
    }
    for (const body of bodies) body.sleep()
    flying = []
    ballOf = new Map()
    for (let i = 0; i < MAX_BALLS; i++) balls.setInstance(i, { scale: 0 })
    for (let i = 0; i < MAX_BOMBS; i++) bombs.setInstance(i, { scale: 0 })
    for (const c of callouts) c.label.visible = false
    blast.age = Infinity
    sync()
  }

  // ---- the bridge: Rapier's bodies into phoria2's instances, once a frame after stepping. Rapier
  // gives a translation { x, y, z } and a rotation { x, y, z, w }; setInstance takes them as they are
  const sync = () => {
    for (const [i, body] of bodies.entries()) {
      const { kind, slot } = layout[i]
      MESHES[kind].setInstance(slot, { position: body.translation(), quaternion: body.rotation(), scale })
    }
    for (const shot of [...flying]) {
      const t = shot.body.translation(), { mesh, size } = KINDS[shot.kind]
      // a shot that got away - past the debris, or over the ground's edge - goes
      if (Math.hypot(t.x, t.z) > 20 || t.y < -2) drop(shot)
      // a bomb swells into being over a fifth of a second, rather than popping in mid-air
      else mesh.setInstance(shot.slot, { position: t, quaternion: shot.body.rotation(),
        scale: shot.kind === 'bomb' ? size * Math.min(1, (performance.now() - shot.born) / 200) : size })
    }
  }
  /** Take a shot out of the world and the picture: scaled to 0, its instance is hidden until reused. @param {Shot} shot */
  const drop = (shot) => {
    flying.splice(flying.indexOf(shot), 1)
    for (const [handle, s] of ballOf) if (s === shot) ballOf.delete(handle)
    world.removeRigidBody(shot.body)
    KINDS[shot.kind].mesh.setInstance(shot.slot, { scale: 0 })
  }

  // ---- firing: a ball launched from just below the camera, so it rises into view rather than
  // filling the screen for a frame, and aimed to land on what is under the pointer: the first brick
  // along the ray, or else the ground. Its speed sets the time of flight, and the launch allows for
  // the drop on the way, so it comes down on the spot. A bomb drops on the same spot from above
  let fired = 0
  /** What a click fires. @type {keyof typeof KINDS} */
  let mode = 'ball'
  const aim = new Raycaster()
  /** @param {import('phoria2').Ray} ray @param {keyof typeof KINDS} [kind] */
  const fire = (ray, kind = mode) => {
    aim.ray.origin.copy(ray.origin)
    aim.ray.direction.copy(ray.direction)
    const hit = aim.intersect([bricks, stones])[0]
    const t = hit?.distance ?? ray.intersectPlane([0, 1, 0], [0, 0, 0]) ?? 40
    const goal = ray.at(Math.min(t, 60))
    let from, v
    if (kind === 'bomb') {
      // a bomb appears high above the spot - at the same height every time - and falls from rest,
      // gathering speed, straight down. Clicked on the side of something rather than its top, it
      // hangs just clear of it, back towards the camera, to fall down the outside to its foot
      if (hit && !(hit.normal && hit.normal[1] > 0.7)) {
        const back = Math.hypot(ray.direction[0], ray.direction[2]) || 1
        goal.sub([ray.direction[0] / back * (BOMB + 0.15), 0, ray.direction[2] / back * (BOMB + 0.15)])
      }
      from = goal.clone().set(goal[0], DROP, goal[2])
      v = [0, 0, 0]
    } else {
      const forward = camera.target.clone().sub(camera.position).normalize()
      const right = forward.clone().cross([0, 1, 0]).normalize(), up = right.clone().cross(forward)
      // out of sight below the view for its first frame, and above the ground however low the camera is
      from = camera.position.clone().add(forward.multiplyScalar(4)).sub(up.multiplyScalar(2.8))
      from[1] = Math.max(from[1], BALL + 0.1)
      const way = goal.clone().sub(from), time = way.len() / SPEED
      v = way.multiplyScalar(1 / time).add([0, 4.905 * time, 0])
    }
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(from[0], from[1], from[2])
      .setLinvel(v[0], v[1], v[2]).setCcdEnabled(true))
    // a ball is iron, twice a brick's density - so it knocks out what it hits rather than shoving the
    // whole tower - and it reports the forces of its contacts; a bomb reports any touch at all, and
    // goes off at the first
    const collider = world.createCollider(kind === 'ball'
      ? RAPIER.ColliderDesc.ball(BALL).setDensity(8).setFriction(0.5).setRestitution(0.2).setContactForceEventThreshold(HIT)
      : RAPIER.ColliderDesc.ball(BOMB).setDensity(3).setContactForceEventThreshold(0), body)
    collider.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
    const { most } = KINDS[kind], same = flying.filter((s) => s.kind === kind)
    if (same.length === most) drop(same[0])
    // the slot the oldest shot of its kind isn't using
    const used = new Set(flying.filter((s) => s.kind === kind).map((s) => s.slot))
    let slot = fired++ % most
    while (used.has(slot)) slot = (slot + 1) % most
    const shot = { kind, body, slot, called: false, born: performance.now() }
    flying.push(shot)
    ballOf.set(collider.handle, shot)
  }
  view.on('click', (_hit, event) => { if (event) fire(view.rayAt(/** @type {MouseEvent} */ (event))) })

  // ---- callouts: a ball's first hard hit is named where it happened, with a line down to the spot,
  // and fades a moment later. A few labels, reused
  const callouts = Array.from({ length: 6 }, () => ({
    label: scene.add(new Label({ text: '', position: [0, 0, 0], place: 'above', offset: [0, -46], leader: true, className: 'phx-hit', overlap: 'show', priority: 5, visible: false })),
    age: 0,
  }))
  let nextCallout = 0
  /** @param {string} text @param {[number, number, number]} at */
  const callout = (text, at) => {
    const c = callouts[nextCallout++ % callouts.length]
    c.label.text = text
    c.label.position.set(...at)
    c.label.className = 'phx-hit'
    c.label.visible = true
    c.age = 0
  }
  const hits = () => {
    /** Bombs that touched something this step - they go off once the events are read. @type {Shot[]} */
    const bursting = []
    events.drainContactForceEvents((e) => {
      const shot = ballOf.get(e.collider1()) ?? ballOf.get(e.collider2())
      if (!shot || shot.called) return
      shot.called = true
      if (shot.kind === 'bomb') {
        bursting.push(shot)
        return
      }
      // Rapier has no rolling resistance, so once it has hit something the ball is slowed, to come to
      // rest among the debris rather than roll away for ever
      shot.body.setLinearDamping(1.2)
      shot.body.setAngularDamping(1.2)
      // the point of contact, from the pair's contact manifold - or the ball, when Rapier has none
      const t = shot.body.translation()
      /** @type {[number, number, number]} */
      let at = [t.x, t.y, t.z]
      world.contactPair(world.getCollider(e.collider1()), world.getCollider(e.collider2()), (manifold) => {
        const p = manifold.numSolverContacts() ? manifold.solverContactPoint(0) : null
        if (p) at = [p.x, p.y, p.z]
      })
      const newtons = e.maxForceMagnitude()
      callout(newtons >= 1000 ? `${(newtons / 1000).toFixed(1)} kN` : `${Math.round(newtons)} N`, at)
    })
    for (const bomb of bursting) {
      const t = bomb.body.translation()
      drop(bomb)
      explode([t.x, t.y, t.z])
    }
  }

  // ---- a blast. Rapier has no explosions of its own; they're made from what it does have: every
  // body near enough gets an impulse straight away from the centre - strongest close in, falling to
  // nothing at the edge, with a little lift - applied a touch off its centre of mass, so it spins as
  // it flies. phoria2 draws the fireball, lights the bricks round it for a moment, and names the damage
  const jitter = random(3)
  const blast = {
    ball: scene.add(new Mesh({ geometry: icosphere({ radius: 1, detail: 3 }), visible: false, pickable: false,
      material: { color: '#ffb547', unlit: true, opacity: 0.9 } })),
    light: scene.add(new PointLight({ color: '#ff9a3c', intensity: 0, range: 12 })),
    age: Infinity,
  }
  /** @param {[number, number, number]} at */
  const explode = (at) => {
    /** Push a body away, if it's in reach; says whether it was. @param {RAPIER.RigidBody} body */
    const push = (body) => {
      const t = body.translation(), d = [t.x - at[0], t.y - at[1], t.z - at[2]], r = Math.hypot(d[0], d[1], d[2])
      if (r > BLAST.radius) return false
      // the change in speed this body gets, along the way out from the centre
      const kick = BLAST.kick * (1 - r / BLAST.radius) * body.mass(), out = 1 / Math.max(r, 0.05)
      const off = () => (jitter() - 0.5) * 0.2
      body.applyImpulseAtPoint({ x: d[0] * out * kick, y: (d[1] * out + 0.4) * kick, z: d[2] * out * kick },
        { x: t.x + off(), y: t.y + off(), z: t.z + off() }, true)
      return true
    }
    let moved = 0
    for (const body of bodies) if (push(body)) moved++
    for (const shot of flying) push(shot.body)
    blast.ball.position.set(...at)
    blast.light.position.set(...at)
    blast.age = 0
    callout(`Blast · ${moved} brick${moved === 1 ? '' : 's'}`, at)
  }
  /** The fireball swelling and fading, and its light dying away. @param {number} dt */
  const burn = (dt) => {
    if (blast.age === Infinity) return
    blast.age += dt
    const t = Math.min(1, blast.age / 0.45)
    blast.ball.visible = t < 1
    blast.ball.scale.setScalar(0.3 + BLAST.radius * 0.9 * Math.sqrt(t))
    blast.ball.material.opacity = 0.9 * (1 - t)
    blast.light.intensity = 160 * Math.max(0, 1 - blast.age / 0.35) ** 2
    if (t >= 1 && blast.light.intensity === 0) blast.age = Infinity
  }

  // ---- the tooltip: what Rapier knows about a brick
  /** @param {number} i */
  const aboutBrick = (i) => {
    const body = bodies[i], v = body.linvel()
    const speed = Math.hypot(v.x, v.y, v.z)
    return { title: `${layout[i].kind === 'stone' ? 'Stone' : 'Brick'} ${i + 1}`, rows: {
      Course: String(layout[i].course + 1),
      Mass: `${body.mass().toFixed(2)} kg`,
      Speed: `${speed.toFixed(2)} m/s`,
      State: body.isSleeping() ? 'Asleep' : 'Moving',
    } }
  }

  // ---- the controls
  const bar = document.createElement('div')
  bar.className = 'hud phx-bar'
  bar.innerHTML = `
    <button type="button" data-mode="ball" title="Click to fire an iron ball">Ball</button>
    <button type="button" data-mode="bomb" title="Click to drop a bomb from above the spot - it bursts where it lands">Bomb</button>
    <span class="phx-gap"></span>
    <span class="phx-caption">Bricks</span>
    ${DENSITIES.map((n) => { const name = `${BRICK_SIZES[/** @type {1 | 2 | 4} */ (n)]} bricks - ${bricksIn(n).toLocaleString()} of them`; return `<button type="button" class="phx-icon" data-size="${n}" title="${name}" aria-label="${name}">${wallIcon(n)}</button>` }).join('')}
    <button type="button" class="phx-reset" data-reset title="Build the tower again">⟲</button>`
  document.body.append(bar)
  const showBar = () => {
    for (const b of bar.querySelectorAll('[data-mode]')) b.classList.toggle('now', /** @type {HTMLElement} */ (b).dataset.mode === mode)
    for (const b of bar.querySelectorAll('[data-size]')) b.classList.toggle('now', Number(/** @type {HTMLElement} */ (b).dataset.size) === size)
  }
  const reset = (duration = 0.8) => {
    build()
    view.frame(new Box3([-radius, 0, -radius], [radius, height, radius]), { direction: [1.3, 0.75, 1.6], padding: 0.1, duration })
  }
  bar.addEventListener('click', (event) => {
    const button = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (event.target).closest('button'))
    if (!button) return
    if (button.dataset.mode) mode = /** @type {keyof typeof KINDS} */ (button.dataset.mode)
    else if (button.dataset.size) {
      // a new size of tower: laid out again, and rebuilt
      size = Number(button.dataset.size)
      plan()
      reset()
    } else if ('reset' in button.dataset) reset()
    showBar()
  })
  showBar()
  plan()
  reset(0)
  if (import.meta.env.DEV) Object.assign(window, { view, fire })

  // ---- each frame: step Rapier in fixed steps for the time that passed, copy the bodies across, and
  // keep the readout of what it cost
  let owed = 0, spent = 0, steps = 0, shown = 0
  return view.start((dt) => {
    owed = Math.min(owed + dt, STEP * 4)
    const t0 = performance.now()
    while (owed >= STEP) {
      world.step(events)
      hits()
      owed -= STEP
      steps++
    }
    spent += performance.now() - t0
    sync()
    burn(dt)
    for (const c of callouts) {
      if (!c.label.visible) continue
      c.age += dt
      if (c.age > 0.9) c.label.className = 'phx-hit fading'
      if (c.age > 1.6) c.label.visible = false
    }
    if ((shown += dt) > 0.5) {
      let awake = 0
      for (const body of bodies) if (!body.isSleeping()) awake++
      info.textContent = `Rapier ${RAPIER.version()} · ${bodies.length + flying.length} bodies, ${awake} awake · ${steps ? (spent / steps).toFixed(2) : '0.00'} ms a step`
      shown = spent = steps = 0
    }
  })
}
