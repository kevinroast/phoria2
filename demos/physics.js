import RAPIER from '@dimforge/rapier3d-compat'
import { Box3, DirectionalLight, Geometry, InstancedMesh, Label, Mesh, Texture, View, icosphere, plane } from 'phoria2'
import { random } from './kit.js'

// A tower of 477 bricks, knocked down with Rapier (rapier.rs) - a physics engine written in Rust,
// compiled to WebAssembly. Rapier owns the motion: the bodies, their collisions and the forces between
// them. phoria2 owns the picture: every brick is one instance of one InstancedMesh, so the tower is a
// single draw call. Each frame Rapier steps and the bridge copies its bodies' positions and turns into
// the instances. Then phoria2's own features go on top: a click fires a ball along the ray under the
// pointer, the hardest hits get callouts at the point of impact, and hovering a brick says what Rapier
// knows about it. Rapier sees each brick as a plain box; phoria2 draws it with its frog - the hollow in
// its top - and a sandy, pitted face painted in code.

const RINGS = 26, AROUND = 18 // the tower's courses, and bricks in each
const RADIUS = 2.6
// a brick in a real one's proportions (215 x 65 x 102.5 mm), sized to just clear its neighbours at the
// tower's inner face
const [LONG, HIGH, DEEP] = [0.82, 0.26, 0.4]
const BALL = 0.5 // a ball's radius
const SPEED = 34 // and how fast it leaves the camera, in m/s
const MAX_BALLS = 12 // the oldest ball goes when another is fired
const STEP = 1 / 60 // Rapier's fixed timestep; the frame's time is spent in steps of this
const HIT = 400 // newtons: hits harder than this get a callout
const BRICK = ['#a64b36', '#9c4432', '#b0553c', '#94402f', '#a95a42', '#9f4a37', '#8e3d2d']
const ASLEEP = '#5b7fa6'

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
    tooltip: (hit) => (hit.node === bricks && hit.instance !== null ? aboutBrick(hit.instance) : null) })
  const { scene } = view
  scene.environment = 'studio'
  scene.environmentIntensity = 0.5
  scene.add(new DirectionalLight({ direction: [-0.5, -1, -0.35], intensity: 1.6, castShadow: true }))
  scene.add(new Mesh({ geometry: plane(400), material: { color: '#d9d3c7', roughness: 0.95 }, receiveShadow: true, pickable: false }))

  // ---- the tower as Rapier sees it: where each brick starts, and how it is turned. A course's bricks
  // stand side by side round a circle, every other course shifted half a brick, like brickwork; on top,
  // every other brick of a last course makes the battlements
  const rand = random(7)
  /** @type {{ position: [number, number, number], turn: number, course: number }[]} */
  const layout = []
  for (let course = 0; course <= RINGS; course++) {
    for (let j = 0; j < AROUND; j++) {
      if (course === RINGS && j % 2) continue
      const a = ((j + (course % 2) / 2) / AROUND) * Math.PI * 2
      // turned so the brick's length runs round the circle
      layout.push({ position: [RADIUS * Math.cos(a), HIGH / 2 + course * HIGH, RADIUS * Math.sin(a)], turn: -a - Math.PI / 2, course })
    }
  }
  const colours = layout.map(() => BRICK[Math.floor(rand() * BRICK.length)])

  // ---- what phoria2 draws: one InstancedMesh of bricks, one of balls
  const bricks = scene.add(new InstancedMesh({ geometry: brickGeometry(), count: layout.length,
    material: { ...brickSurface(), roughness: 0.9 }, castShadow: true, receiveShadow: true }))
  const balls = scene.add(new InstancedMesh({ geometry: icosphere({ radius: 1, detail: 3 }), count: MAX_BALLS,
    material: { color: '#3b3f46', metalness: 0.9, roughness: 0.25 }, castShadow: true, pickable: false }))

  // ---- the physics world: rebuilt from the layout on reset
  /** @type {RAPIER.World} */
  let world
  /** @type {RAPIER.RigidBody[]} */
  let bodies = []
  /** The balls in flight, oldest first, each with the instance it is drawn as. @type {{ body: RAPIER.RigidBody, slot: number, called: boolean }[]} */
  let flying = []
  /** Ball colliders by handle, for telling which body in a contact is the ball. @type {Map<number, typeof flying[number]>} */
  let ballOf = new Map()
  const events = new RAPIER.EventQueue(true)

  const build = () => {
    world?.free()
    world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    world.timestep = STEP
    // the ground: a fixed slab whose top is y = 0, where the plane is drawn
    world.createCollider(RAPIER.ColliderDesc.cuboid(60, 0.5, 60).setTranslation(0, -0.5, 0).setFriction(0.9))
    bodies = layout.map(({ position: [x, y, z], turn }) => {
      // asleep to begin with, so the tower stands still until something hits it
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z)
        .setRotation({ x: 0, y: Math.sin(turn / 2), z: 0, w: Math.cos(turn / 2) }).setSleeping(true))
      world.createCollider(RAPIER.ColliderDesc.cuboid(LONG / 2, HIGH / 2, DEEP / 2).setFriction(1).setDensity(4), body)
      return body
    })
    flying = []
    ballOf = new Map()
    for (let i = 0; i < MAX_BALLS; i++) balls.setInstance(i, { scale: 0 })
    for (const c of callouts) c.label.visible = false
    sync()
  }

  // ---- the bridge: Rapier's bodies into phoria2's instances, once a frame after stepping. Rapier
  // gives a translation and a rotation quaternion; setInstance takes them as they are
  const sync = () => {
    for (const [i, body] of bodies.entries()) {
      const t = body.translation(), q = body.rotation()
      bricks.setInstance(i, { position: [t.x, t.y, t.z], quaternion: [q.x, q.y, q.z, q.w], color: showSleeping && body.isSleeping() ? ASLEEP : colours[i] })
    }
    for (const ball of [...flying]) {
      const t = ball.body.translation(), q = ball.body.rotation()
      // a ball that got away - past the debris, or over the ground's edge - goes, before it stretches
      // the shadows over the whole plain
      if (Math.hypot(t.x, t.z) > 20 || t.y < -2) drop(ball)
      else balls.setInstance(ball.slot, { position: [t.x, t.y, t.z], quaternion: [q.x, q.y, q.z, q.w], scale: BALL })
    }
  }
  /** Take a ball out of the world and the picture. @param {typeof flying[number]} ball */
  const drop = (ball) => {
    flying.splice(flying.indexOf(ball), 1)
    for (const [handle, b] of ballOf) if (b === ball) ballOf.delete(handle)
    world.removeRigidBody(ball.body)
    balls.setInstance(ball.slot, { scale: 0 })
  }

  // ---- firing: a ball from the camera, along the ray through the pointer
  let fired = 0
  /** @param {import('phoria2').Ray} ray */
  const fire = (ray) => {
    const [ox, oy, oz] = ray.at(1)
    const [dx, dy, dz] = ray.direction
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(ox, oy, oz)
      .setLinvel(dx * SPEED, dy * SPEED, dz * SPEED).setCcdEnabled(true))
    // iron, twice a brick's density - so it knocks out what it hits rather than shoving the whole
    // tower - and it reports the forces of its contacts
    const collider = world.createCollider(RAPIER.ColliderDesc.ball(BALL).setDensity(8).setFriction(0.5).setRestitution(0.2)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(HIT), body)
    if (flying.length === MAX_BALLS) drop(flying[0])
    // the slot the oldest ball in play isn't using
    const used = new Set(flying.map((b) => b.slot))
    let slot = fired++ % MAX_BALLS
    while (used.has(slot)) slot = (slot + 1) % MAX_BALLS
    const ball = { body, slot, called: false }
    flying.push(ball)
    ballOf.set(collider.handle, ball)
  }
  view.on('click', (_hit, event) => { if (event) fire(view.rayAt(/** @type {MouseEvent} */ (event))) })

  // ---- callouts: a ball's first hard hit is named where it happened, with a line down to the spot,
  // and fades a moment later. A few labels, reused
  const callouts = Array.from({ length: 6 }, () => ({
    label: scene.add(new Label({ text: '', position: [0, 0, 0], place: 'above', offset: [0, -46], leader: true, className: 'phx-hit', overlap: 'show', priority: 5, visible: false })),
    age: 0,
  }))
  let nextCallout = 0
  /** @param {number} newtons @param {[number, number, number]} at */
  const callout = (newtons, at) => {
    const c = callouts[nextCallout++ % callouts.length]
    c.label.text = newtons >= 1000 ? `${(newtons / 1000).toFixed(1)} kN` : `${Math.round(newtons)} N`
    c.label.position.set(...at)
    c.label.className = 'phx-hit'
    c.label.visible = true
    c.age = 0
  }
  const hits = () => {
    events.drainContactForceEvents((e) => {
      const ball = ballOf.get(e.collider1()) ?? ballOf.get(e.collider2())
      if (!ball || ball.called) return
      ball.called = true
      // Rapier has no rolling resistance, so once it has hit something the ball is slowed, to come to
      // rest among the debris rather than roll away for ever
      ball.body.setLinearDamping(1.2)
      ball.body.setAngularDamping(1.2)
      // the point of contact, from the pair's contact manifold - or the ball, when Rapier has none
      const t = ball.body.translation()
      /** @type {[number, number, number]} */
      let at = [t.x, t.y, t.z]
      world.contactPair(world.getCollider(e.collider1()), world.getCollider(e.collider2()), (manifold) => {
        const p = manifold.numSolverContacts() ? manifold.solverContactPoint(0) : null
        if (p) at = [p.x, p.y, p.z]
      })
      callout(e.maxForceMagnitude(), at)
    })
  }

  // ---- the tooltip: what Rapier knows about a brick
  /** @param {number} i */
  const aboutBrick = (i) => {
    const body = bodies[i], v = body.linvel()
    const speed = Math.hypot(v.x, v.y, v.z)
    return { title: `Brick ${i + 1}`, rows: {
      Course: String(layout[i].course + 1),
      Mass: `${body.mass().toFixed(2)} kg`,
      Speed: `${speed.toFixed(2)} m/s`,
      State: body.isSleeping() ? 'Asleep' : 'Moving',
    } }
  }

  // ---- the controls
  let showSleeping = false
  const bar = document.createElement('div')
  bar.className = 'hud phx-bar'
  bar.innerHTML = `
    <button type="button" data-toggle="sleeping" title="Tint the bodies Rapier has put to sleep - at rest, so it skips them">Show sleeping</button>
    <button type="button" class="phx-reset" data-reset title="Build the tower again">⟲</button>`
  document.body.append(bar)
  const showBar = () => {
    bar.querySelector('[data-toggle="sleeping"]')?.classList.toggle('now', showSleeping)
  }
  const reset = (duration = 0.8) => {
    build()
    view.frame(new Box3([-RADIUS, 0, -RADIUS], [RADIUS, (RINGS + 1) * HIGH, RADIUS]), { direction: [1.3, 0.75, 1.6], padding: 0.3, duration })
  }
  bar.addEventListener('click', (event) => {
    const button = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (event.target).closest('button'))
    if (!button) return
    if (button.dataset.toggle === 'sleeping') showSleeping = !showSleeping
    else if ('reset' in button.dataset) reset()
    showBar()
  })
  showBar()
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
