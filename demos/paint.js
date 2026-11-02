import { DirectionalLight, Geometry, Group, Mesh, PerspectiveCamera, Texture, View, box, cylinder, icosphere, loadTexture, plane } from 'phoria2'
import { Emitter } from 'phoria2/particles'

// the wall, in metres: wider than it is tall, for room to paint
const WALL_X = 6, WALL_WIDTH = 16, WALL_HEIGHT = 10
// its canvases: SIDE pixels up the wall and as many across as keep them square; the brick photos
// tile TILES times up it, and as often across as fits
const SIDE = 1024, ACROSS = Math.round(SIDE * WALL_WIDTH / WALL_HEIGHT), TILES = 2
// the paints the cannon cycles through, a palette at a time
const PALETTES = {
  primaries: ['#1f5cff', '#e8243c', '#1fbf5a', '#ffc400', '#f4f4f4', '#8a3cff'],
  rainbow: ['#ff2a2a', '#ff8a00', '#ffd400', '#2bd44a', '#00c8e0', '#2a5cff', '#4b2aff', '#a32aff'],
  pastels: ['#ffb3c6', '#ffd1a8', '#fff1a8', '#b8f2c8', '#aee3ff', '#c9c1ff', '#f0c4ff'],
  'grey shades': ['#f4f4f4', '#cfcfcf', '#a6a6a6', '#7c7c7c', '#545454', '#2e2e2e'],
}
// every palette's paints in one list
const COLOURS = Object.values(PALETTES).flat()
// a drop's life in seconds - long enough to reach the wall or the floor - plus a hundredth for each
// place along COLOURS: the drop carries its paint that way, for its splat (see fireDrops), whatever
// the palette has changed to since
const LIFETIME = 4, TAG = 0.01
// the bar's speeds: paints a second
const SPEEDS = { Hold: 0, Slow: 0.75, Fast: 4.0 }
const MOUNT = [-4.7, 1.6, 0.8], BARREL = 1.45, GRAVITY = 9.8
// where the camera starts: on a wide screen, beside the cannon with the wall filling the space between
// the panels; on a phone held upright, further back and higher - the whole wall across the screen
// below the title, the cannon under it
const CAMERAS = {
  landscape: { position: [-9.45, 3.8, 7.56], target: [6.3, 3.3, 1.03], fov: 60 },
  portrait: { position: [-23.77, 13.46, 7.93], target: [6, 4.1, 0.49], fov: 60 },
}
// fresh paint is glossy and dries to satin: roughness (as the ARM map's green, 0-255) by age in seconds
const DRYING = [[0, 30], [1.5, 50], [3, 70], [5, 95], [8, 115]]

// A paint cannon. Drops fly under gravity, and when one reaches the wall it is removed and a splat
// is drawn into the canvases behind the wall's textures: its colour, and its roughness (wet paint is
// glossy, drying to satin) - the bricks' normal map stays as it is, so their bumps show through the
// paint. A splat stretches along the way the drop was going, and throws spatter that way; a big one
// may run in a drip down the bricks, ending in a bead. texture.needsUpdate() sends a canvas to the
// GPU, once a frame, when it changed.
// Press on the wall to fire and drag to sweep the stream: the cannon works out the arc that lands
// under the pointer (the wall's onDrag has the press, and the drag plane is the wall's).
export default async function run({ canvas, gui, info }) {
  // a touch screen has no space bar, and less room: the bar's ⟲ cleans the wall
  info.textContent = matchMedia('(pointer: coarse)').matches ? 'Drag on the wall to spray · elsewhere to look around'
    : 'Press and drag on the wall to spray · drag elsewhere to look around · space cleans it'
  const [brick, arm] = await Promise.all(['diff', 'arm'].map((m) => loadTexture(`textures/red_brick_03_${m}_1k.jpg`)))

  // the wall's colour and ARM (occlusion, roughness, metal) textures are canvases, painted as drops land
  const layer = () => {
    const c = document.createElement('canvas')
    c.width = ACROSS
    c.height = SIDE
    return /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'))
  }
  const colour = layer(), rough = layer()
  const colourMap = new Texture({ image: colour.canvas })
  const armMap = new Texture({ image: rough.canvas, colorSpace: 'linear' })
  // which canvases changed this frame, to send only those
  const dirty = new Set()

  /** @type {{ x: number, y: number, w: number, left: number, speed: number, paint: string, from: number }[]} */
  let drips = []
  /** Paint still drying: its shape, where it is, when it landed and how dry it's drawn. @type {{ shape: Path2D, at: DOMMatrix, born: number, stage: number }[]} */
  let wet = []
  let clock = 0
  const clean = () => {
    // the photos tile TILES times up the wall, and on across it - the last one cut off at the edge
    const t = SIDE / TILES
    for (let i = 0; i < Math.ceil(ACROSS / t); i++) {
      for (let j = 0; j < TILES; j++) {
        colour.drawImage(/** @type {CanvasImageSource} */ (brick.image), i * t, j * t, t, t)
        rough.drawImage(/** @type {CanvasImageSource} */ (arm.image), i * t, j * t, t, t)
      }
    }
    drips = []
    wet = []
    dirty.add(colourMap).add(armMap)
  }
  clean()

  // drag on the wall to spray; anywhere else orbits the camera round the wall. Turning a phone
  // between upright and sideways starts the camera again from that way's view
  const upright = matchMedia('(orientation: portrait)')
  const startCamera = () => CAMERAS[upright.matches ? 'portrait' : 'landscape']
  const view = new View({ canvas, background: '#1b1c21', camera: startCamera(),
    orbit: { minDistance: 8, maxDistance: 40, minPitch: 0.02, maxPitch: 1.2 } })
  upright.addEventListener('change', () => { view.camera = new PerspectiveCamera(startCamera()) })
  const scene = view.scene
  scene.environment = 'hdr/studio_small_09_1k.hdr'
  scene.environmentIntensity = 0.6
  scene.add(new DirectionalLight({ direction: [1, -1.3, -0.45], intensity: 1.6, castShadow: true }))
  scene.add(new Mesh({ geometry: plane(300), material: { color: '#34353a', roughness: 0.9 }, receiveShadow: true, pickable: false }))

  // the wall faces the cannon (-x); built from corners so its textures run upright, u along +z
  const h = WALL_WIDTH / 2
  const wall = scene.add(new Mesh({
    geometry: new Geometry({
      positions: [WALL_X, 0, -h, WALL_X, 0, h, WALL_X, WALL_HEIGHT, h, WALL_X, WALL_HEIGHT, -h],
      uvs: [0, 1, 1, 1, 1, 0, 0, 0],
      indices: [0, 1, 2, 0, 2, 3],
    }),
    material: {
      map: colourMap, roughnessMap: armMap, aoMap: armMap,
      normalMap: { url: 'textures/red_brick_03_nor_gl_1k.jpg', repeat: [TILES * ACROSS / SIDE, TILES] },
    },
    receiveShadow: true,
  }))
  // the wall's body behind its face, and a coping along the top
  scene.add(new Mesh({ geometry: box({ width: 0.5, height: WALL_HEIGHT, depth: WALL_WIDTH }), material: { color: '#5b3a31', roughness: 0.9 }, position: [WALL_X + 0.26, WALL_HEIGHT / 2, 0], castShadow: true, pickable: false }))
  scene.add(new Mesh({ geometry: box({ width: 0.7, height: 0.2, depth: WALL_WIDTH + 0.2 }), material: { color: '#9a958d', roughness: 0.8 }, position: [WALL_X + 0.26, WALL_HEIGHT + 0.1, 0], castShadow: true, pickable: false }))

  // the cannon: a tripod, a head that turns (yaw) and a barrel that tilts (pitch)
  const steel = { color: '#4a4c52', metalness: 0.8, roughness: 0.35 }
  const mount = scene.add(new Group({ position: MOUNT, pickable: false }))
  for (let i = 0; i < 3; i++) {
    const leg = mount.add(new Group({ rotation: [0, (i / 3) * Math.PI * 2 + 0.5, 0] }))
    const spread = 0.9, tilt = Math.atan2(spread, MOUNT[1])
    leg.add(new Mesh({ geometry: cylinder({ radius: 0.05, height: Math.hypot(spread, MOUNT[1]) }), material: steel, position: [spread / 2, -MOUNT[1] / 2, 0], rotation: [0, 0, tilt], castShadow: true }))
  }
  mount.add(new Mesh({ geometry: icosphere({ radius: 0.2, detail: 2 }), material: steel, castShadow: true }))
  const yaw = mount.add(new Group())
  const pitch = yaw.add(new Group())
  // the barrel and its nozzle, lying along +x
  pitch.add(new Mesh({ geometry: cylinder({ radius: 0.28, height: 1.3, segments: 32, axis: 'x' }), material: steel, position: [0.25, 0, 0], castShadow: true }))
  pitch.add(new Mesh({ geometry: cylinder({ radius: 0.2, radiusTop: 0.08, height: 0.5, segments: 32, axis: 'x' }), material: { color: '#c79a4a', metalness: 1, roughness: 0.3 }, position: [1.15, 0, 0], castShadow: true }))
  const tank = pitch.add(new Mesh({ geometry: cylinder({ radius: 0.26, height: 0.55, segments: 32 }), material: { color: PALETTES.primaries[0], roughness: 0.25 }, position: [-0.1, 0.5, 0], castShadow: true }))
  pitch.add(new Mesh({ geometry: cylinder({ radius: 0.12, height: 0.1 }), material: steel, position: [-0.1, 0.82, 0] }))

  // cycle: paints a second (0 holds the one loaded); colour: its place in the palette
  const settings = { palette: 'primaries', colour: 0, cycle: 1.0, rate: 120, power: 12, turn: 0, aim: 0.5, spread: 0.7 }
  /** The paint loaded now. */
  const loaded = () => {
    const list = PALETTES[settings.palette]
    return list[settings.colour % list.length]
  }
  const direction = () => {
    const c = Math.cos(settings.aim)
    return [c * Math.cos(settings.turn), Math.sin(settings.aim), -c * Math.sin(settings.turn)]
  }
  const muzzle = () => direction().map((d, i) => MOUNT[i] + d * BARREL)

  /**
   * Draw a shape, given in a splat's own frame, into a canvas - placed by the splat's transform.
   * @param {CanvasRenderingContext2D} ctx @param {Path2D} shape @param {DOMMatrix} at @param {string} style
   */
  const fill = (ctx, shape, at, style) => {
    ctx.setTransform(at)
    ctx.fillStyle = style
    ctx.fill(shape)
    ctx.resetTransform()
  }

  // a splat: a blob, longer the more glancing the drop's arrival, with spatter thrown ahead of it -
  // drawn in colour, and as wet gloss
  const splat = (y, z, velocity, paint) => {
    const x = (z + h) / WALL_WIDTH * ACROSS, py = (1 - y / WALL_HEIGHT) * SIDE
    // across the wall, the drop runs along (z, -y) in the canvas's terms; the shallower it comes in,
    // the further it smears
    const [vx, vy, vz] = velocity
    const speed = Math.hypot(vx, vy, vz) || 1
    const stretch = Math.min(2.6, 1 / Math.max(0.38, Math.abs(vx) / speed))
    const r = 12 + Math.random() * 22
    const at = new DOMMatrix().translate(x, py).rotate(Math.atan2(-vy, vz) * 180 / Math.PI).scale(stretch, 1)
    const blob = new Path2D()
    blob.ellipse(0, 0, r, r * (0.85 + Math.random() * 0.3), 0, 0, Math.PI * 2)
    // spatter: droplets flung ahead, further and more of them the more glancing the hit
    const spatter = new Path2D()
    for (let i = 3 + Math.random() * 4 + stretch * 3; i > 0; i--) {
      const a = (Math.random() - 0.5) * (2.6 - stretch * 0.6), d = r * (1.1 + Math.random() * (0.8 + stretch * 0.7)), s = r * (0.08 + Math.random() * 0.2)
      spatter.moveTo(Math.cos(a) * d + s, Math.sin(a) * d)
      spatter.arc(Math.cos(a) * d, Math.sin(a) * d, s, 0, Math.PI * 2)
    }
    const shape = new Path2D(blob)
    shape.addPath(spatter)
    fill(colour, shape, at, paint)
    fill(rough, shape, at, gloss(0))
    wet.push({ shape, at, born: clock, stage: 0 })
    if (wet.length > 3000) wet.splice(0, wet.length - 3000)
    if (r > 22 && Math.random() < 0.4 && drips.length < 80) {
      drips.push({ x: x + (Math.random() - 0.5) * r, y: py + r * 0.6, w: r * 0.45, left: 40 + Math.random() * 160, speed: 50 + Math.random() * 40, paint, from: py + r * 0.6 })
    }
    dirty.add(colourMap).add(armMap)
  }

  // drips run down, thinning and slowing until the paint runs out - and gather in a bead where they stop
  const runDrips = (dt) => {
    for (const d of drips) {
      const step = Math.min(d.left, d.speed * dt)
      const line = new Path2D()
      line.moveTo(d.x, d.y)
      line.lineTo(d.x, d.y + step)
      const stroke = (/** @type {CanvasRenderingContext2D} */ ctx, /** @type {string} */ style) => {
        ctx.strokeStyle = style
        ctx.lineWidth = d.w
        ctx.lineCap = 'round'
        ctx.stroke(line)
      }
      stroke(colour, d.paint)
      stroke(rough, gloss(0))
      d.y += step
      d.left -= step
      d.w = Math.max(2, d.w * (1 - 0.6 * dt))
      d.speed *= 1 - 0.5 * dt
    }
    if (!drips.length) return
    dirty.add(colourMap).add(armMap)
    drips = drips.filter((d) => {
      if (d.left > 0.5 && d.speed > 4) return true
      // run out: a bead of what was left, and the run's whole length to dry
      const bead = new Path2D()
      bead.ellipse(0, 0, d.w * 0.9, d.w * 1.15, 0, 0, Math.PI * 2)
      const at = new DOMMatrix().translate(d.x, d.y)
      fill(colour, bead, at, d.paint)
      fill(rough, bead, at, gloss(0))
      const run = new Path2D()
      run.rect(d.x - d.w, d.from, d.w * 2, d.y - d.from)
      run.addPath(bead, at)
      wet.push({ shape: run, at: new DOMMatrix(), born: clock, stage: 0 })
      return false
    })
  }

  // as paint ages it's drawn again, a step less glossy, until it's dry
  const dry = () => {
    for (const w of wet) {
      const age = clock - w.born
      let stage = w.stage
      while (stage + 1 < DRYING.length && age >= DRYING[stage + 1][0]) stage++
      if (stage === w.stage) continue
      w.stage = stage
      fill(rough, w.shape, w.at, gloss(stage))
      dirty.add(armMap)
    }
    wet = wet.filter((w) => w.stage < DRYING.length - 1)
  }

  // the drops: fired in bursts, each burst in the paint of the moment - so drops keep the colour they
  // left the cannon in, and a change of paint shows in the next ones out, not those in the air
  const paint = scene.add(new Emitter({
    max: 4000, rate: 0, gravity: [0, -GRAVITY, 0], lifetime: LIFETIME,
    material: { map: drop(), size: 0.16, blending: 'normal' },
    onParticle: (p) => {
      if (p.position.x < WALL_X) return p.position.y > 0
      // past the wall plane: paint it - in the drop's own paint, read from its lifetime - if it hit
      // the wall, and remove the particle either way
      if (p.position.y > 0 && p.position.y < WALL_HEIGHT && Math.abs(p.position.z) < h) {
        splat(p.position.y, p.position.z, p.velocity, COLOURS[Math.round((p.lifetime - LIFETIME) / TAG)])
      }
      return false
    },
  }))
  /** Drops owed, a fraction of one carried from frame to frame. */
  let owed = 0
  /** Fire this frame's drops, in the paint loaded now, tagged with it. @param {number} dt */
  const fireDrops = (dt) => {
    owed += settings.rate * dt
    const n = Math.floor(owed)
    owed -= n
    const tag = LIFETIME + COLOURS.indexOf(loaded()) * TAG
    if (n) paint.burst(n, { color: loaded(), lifetime: [tag, tag] })
  }
  /** Firing: while the wall is pressed, or for the opening sweep. */
  let firing = false
  const aim = () => {
    const d = direction()
    paint.set({
      origin: muzzle(),
      velocity: d.map((c) => c * settings.power),
      velocitySpread: settings.spread,
    })
    yaw.rotation.y = settings.turn
    pitch.rotation.z = settings.aim
    tank.material.color.set(loaded())
  }
  aim()

  // the low arc from the muzzle to a point, raising the power if it can't reach; a few rounds,
  // since the muzzle moves as the barrel turns
  /** @param {{ x: number, y: number, z: number }} target */
  const aimAt = (target) => {
    for (let round = 0; round < 3; round++) {
      const m = muzzle()
      const dx = target.x - m[0], dy = target.y - m[1], dz = target.z - m[2]
      const across = Math.hypot(dx, dz)
      const least = Math.sqrt(GRAVITY * (dy + Math.hypot(across, dy)))
      if (settings.power < least * 1.03) settings.power = Math.min(30, least * 1.03)
      const v2 = settings.power ** 2
      const reach = Math.max(0, v2 * v2 - GRAVITY * (GRAVITY * across * across + 2 * dy * v2))
      settings.turn = Math.atan2(-dz, dx)
      settings.aim = Math.atan((v2 - Math.sqrt(reach)) / (GRAVITY * across))
    }
    aim()
    gui.updateDisplay()
  }

  // a press on the wall fires straight away - no need to move first - and drags sweep the stream
  // across the wall's plane, past its edges too. Until the first press, an opening sweep shows how
  const SWEEP = 2.6
  let sweep = 0
  /** @param {boolean} on */
  const fire = (on) => {
    firing = on
    aim()
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const hit = view.pick(e)
    if (hit?.node !== wall) return
    sweep = SWEEP
    fire(true)
    aimAt(hit.point)
  })
  const release = () => { if (firing && sweep >= SWEEP) fire(false) }
  window.addEventListener('pointerup', release)
  window.addEventListener('pointercancel', release)
  wall.onDrag = (drag) => {
    if (drag.phase === 'start') {
      drag.plane.normal.set(-1, 0, 0)
      drag.plane.point.set(WALL_X, 0, 0)
    }
    if (drag.point) aimAt(drag.point)
  }

  document.addEventListener('keydown', (e) => { if (e.code === 'Space') clean() })
  // the paint moves on through the palette, cycle paints a second: the next drops out are the new
  // colour, while those in flight keep theirs, and each paints the wall in its own
  let since = 0

  // ---- the bar: what a phone needs - the palette, how fast it cycles, a clean wall - along the
  // bottom; the finer settings stay in the panel
  const bar = document.createElement('div')
  bar.className = 'hud paint-bar'
  bar.innerHTML = `
    ${Object.entries(PALETTES).map(([name, list]) => `<button type="button" class="paint-swatch" data-palette="${name}" title="${name}" aria-label="${name} palette"><span style="background: conic-gradient(${list.join(', ')}, ${list[0]})"></span></button>`).join('')}
    <span class="paint-gap"></span>
    ${Object.keys(SPEEDS).map((name) => `<button type="button" data-speed="${name}" title="${name === 'Hold' ? 'Keep the paint loaded now' : `Change colour ${name === 'Slow' ? 'every two seconds' : 'twice a second'}`}">${name}</button>`).join('')}
    <span class="paint-gap"></span>
    <button type="button" class="paint-clean" data-clean title="Clean the wall" aria-label="Clean the wall">⟲</button>`
  document.body.append(bar)
  const showBar = () => {
    for (const b of bar.querySelectorAll('[data-palette]')) b.classList.toggle('now', /** @type {HTMLElement} */ (b).dataset.palette === settings.palette)
    for (const b of bar.querySelectorAll('[data-speed]')) b.classList.toggle('now', SPEEDS[/** @type {keyof typeof SPEEDS} */ (/** @type {HTMLElement} */ (b).dataset.speed)] === settings.cycle)
  }
  bar.addEventListener('click', (event) => {
    const button = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (event.target).closest('button'))
    if (!button) return
    if (button.dataset.palette) {
      settings.palette = button.dataset.palette
      settings.colour = 0
      since = 0
      aim()
    } else if (button.dataset.speed) {
      settings.cycle = SPEEDS[/** @type {keyof typeof SPEEDS} */ (button.dataset.speed)]
      gui.updateDisplay()
    } else if ('clean' in button.dataset) clean()
    showBar()
  })
  showBar()

  const f = gui.addFolder('Paint cannon')
  f.add(settings, 'cycle', 0, 4, 0.05).name('colour cycle speed').onChange(showBar)
  f.add(settings, 'rate', 10, 300, 5).onChange(aim)
  f.add(settings, 'power', 10, 30, 0.1).onChange(aim)
  f.add(settings, 'spread', 0, 2, 0.05).onChange(aim)

  return view.start((dt) => {
    clock += dt
    if (sweep < SWEEP) {
      firing = true
      sweep += dt
      aimAt({ x: WALL_X, y: 3.2 + Math.sin(sweep * 2.2) * 1.2, z: -4 + sweep * 3 })
      if (sweep >= SWEEP) fire(false)
    }
    if ((since += dt * settings.cycle) >= 1) {
      since %= 1
      settings.colour = (settings.colour + 1) % PALETTES[settings.palette].length
      aim()
    }
    if (firing) fireDrops(dt)
    runDrips(dt)
    dry()
    for (const map of dirty) map.needsUpdate()
    dirty.clear()
  })
}

/** The ARM map's colour for paint at a stage of drying: no occlusion, its roughness, not metal. @param {number} stage */
function gloss(stage) {
  return `rgb(255, ${DRYING[stage][1]}, 0)`
}

/** A shaded drop: a highlight up and to the left, darkening to the rim (grey, so the paint tints it). */
function drop(size = 64) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'))
  const r = size / 2
  const g = ctx.createRadialGradient(r * 0.7, r * 0.7, 0, r, r, r)
  g.addColorStop(0, '#ffffff')
  g.addColorStop(0.18, '#e6e6e6')
  g.addColorStop(0.75, '#8c8c8c')
  g.addColorStop(0.92, '#5a5a5a')
  g.addColorStop(1, 'rgba(90, 90, 90, 0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return new Texture({ image: c })
}
