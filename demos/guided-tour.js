import { Box3, Geometry, Group, HemisphereLight, InstancedMesh, Label, Mesh, Points, SpotLight, Texture, View, box, curve, cylinder, plane } from 'phoria2'
import { follow } from 'phoria2/motion'
import { random } from './kit.js'

// A guided tour of a data centre: four rows of racks round two contained cold aisles, server LEDs
// blinking in the dark, a glossy raised floor, cooling, power, the network core, the operations
// wall and an inspection robot on its rounds. Next and Back - or a numbered pin in the centre - glide
// the camera to a stop with frame({ direction, duration }), and a card is pinned beside what it
// is about with view.project(). The robot's stop follows it. The floor's shine is the centre drawn
// again upside down beneath a glassy floor - the LEDs and light bars reflect, blink for blink.

const HALL = { w: 22, d: 16, h: 4 }
const RACK = { w: 0.6, h: 2.1, d: 1.1 }
const PER_ROW = 14
// rows run along x; A and B face across the first cold aisle, C and D across the second
const ROWS = [
  { name: 'A', z: -5.55, face: 1 },
  { name: 'B', z: -2.05, face: -1 },
  { name: 'C', z: 2.05, face: 1 },
  { name: 'D', z: 5.55, face: -1 },
]
const COLD = [-3.8, 3.8]
const rackX = (i) => (i - (PER_ROW - 1) / 2) * RACK.w
// the network core: the two racks in the middle of row C
const CORE = [6, 7]

/** The raised floor's tiles, perforated in the cold aisles: a texture to repeat. */
function tiles(perforated) {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'))
  g.fillStyle = perforated ? '#2a3038' : '#16191e'
  g.fillRect(0, 0, 128, 128)
  if (perforated) {
    g.fillStyle = '#0b0d10'
    for (let y = 10; y < 122; y += 9) for (let x = 10; x < 122; x += 9) g.fillRect(x, y, 4, 4)
  }
  g.strokeStyle = '#05060a'
  g.lineWidth = 4
  g.strokeRect(0, 0, 128, 128)
  return new Texture({ image: c, repeat: [1, 1], anisotropy: 8 })
}

/** The operations wall's live display, drawn on a canvas. */
function operations() {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 384
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'))
  const series = [0, 1, 2].map((k) => Array.from({ length: 60 }, (_, i) => 0.5 + 0.3 * Math.sin(i / 6 + k * 2)))
  const draw = (t) => {
    g.fillStyle = '#05080d'
    g.fillRect(0, 0, 1024, 384)
    g.font = '600 26px system-ui, sans-serif'
    g.fillStyle = '#7fb6ff'
    g.fillText('CENTRE 1 · LIVE', 28, 44)
    g.fillStyle = '#59d88a'
    g.fillText('● ALL SYSTEMS NORMAL', 700, 44)
    const panels = [['POWER kW', '#ffb547'], ['INLET °C', '#59c3ff'], ['NETWORK Gb/s', '#9b7bff']]
    panels.forEach(([name, colour], k) => {
      const x0 = 28 + k * 330, y0 = 80, w = 300, h = 270
      g.strokeStyle = '#1c2633'
      g.strokeRect(x0, y0, w, h)
      g.fillStyle = '#8a97a8'
      g.font = '600 18px system-ui, sans-serif'
      g.fillText(name, x0 + 12, y0 + 28)
      const s = series[k]
      s.push(Math.min(0.95, Math.max(0.1, s.at(-1) + (Math.sin(t * (1 + k) + k) * 0.04))))
      s.shift()
      g.strokeStyle = colour
      g.lineWidth = 3
      g.beginPath()
      s.forEach((v, i) => g[i ? 'lineTo' : 'moveTo'](x0 + 10 + i * (w - 20) / 59, y0 + h - 16 - v * (h - 70)))
      g.stroke()
      g.fillStyle = '#e6edf5'
      g.font = '700 34px system-ui, sans-serif'
      g.fillText(String(Math.round([182, 21.4, 46][k] * (0.9 + s.at(-1) * 0.2) * 10) / 10), x0 + 180, y0 + 34)
    })
  }
  draw(0)
  return { texture: new Texture({ image: c, wrap: 'clamp' }), draw }
}

/**
 * The tour's stops: where to look from, what to frame, and what the card says. Racks are seen from
 * down their aisle, at an angle: straight on, the camera would have to stand inside the facing row.
 * Neighbouring stops are seen from the same side where they can be, so a glide between them turns
 * a little and rises over the racks rather than swinging round through them.
 */
function stopsOf(at) {
  return [
    { title: 'The data centre', text: 'Four rows of 14 racks, 56 in all, round two contained cold aisles. 412 kW of IT load at 1.31 PUE.', frame: at.hall, direction: [0.75, 0.9, 1], pin: [0, 3.6, 0] },
    { title: 'Cold aisle 1', text: 'Air at 18–22 °C rises through the perforated tiles into the servers’ fronts. Glass over the aisle keeps it from mixing with the hot exhaust.', frame: at.coldAisle, direction: [1, 0.32, 0.02], pin: [5.4, 2.4, COLD[0]] },
    { title: 'Rack B-07', text: '38 servers · 7.4 kW · inlet 21.2 °C · outlet 34.8 °C. Blue lights are healthy drives, amber a disk rebuilding.', frame: at.rack, direction: [1, 0.22, -0.55], pin: [rackX(7), 2.3, ROWS[1].z - RACK.d / 2] },
    { title: 'Network core', text: 'Two spine switches, 64 × 400 Gb/s ports each. Every rack in the centre has two uplinks here.', frame: at.core, direction: [0.9, 0.62, 0.75], pin: [rackX(6.5), 2.4, ROWS[2].z + RACK.d / 2] },
    { title: 'Hot aisle', text: 'Exhaust at about 35 °C. The racks’ backs face each other, so the heat is drawn straight back to cooling.', frame: at.hotAisle, direction: [-1, 0.35, 0.02], pin: [-5.4, 2.4, 0] },
    { title: 'Cooling', text: 'Four computer-room air handlers push 18 °C air under the raised floor; chilled water carries the heat out to the roof.', frame: at.cooling, direction: [1, 0.3, 0.7], pin: [-HALL.w / 2 + 0.6, 2.6, -3.6] },
    { title: 'Power', text: 'Two UPS systems, A and B, each able to carry the whole hall for eight minutes - long enough for the generators to start.', frame: at.power, direction: [-1, 0.3, 0.7], pin: [HALL.w / 2 - 0.6, 2.4, -2.6] },
    { title: 'Operations wall', text: 'Power, temperature and network for the centre, live. The team on shift watches from here.', frame: at.wall, direction: [0, 0.38, 1], pin: [0, 3.5, -7.85] },
    { title: 'Inspection robot', text: 'Laps every aisle each hour, checking temperatures and listening for failing fans. Lap 3 of the night: no alerts.', follow: true, direction: [0.9, 0.8, 1] },
  ]
}

export default function run({ canvas, gui, info }) {
  const rand = random(7)
  const view = new View({
    canvas, background: '#05070b', toneMapping: 'neutral', bloom: { strength: 0.9, radius: 0.5, threshold: 0.7 },
    orbit: { minDistance: 2, maxDistance: 40, maxPitch: 1.4, minPitch: 0.02 },
    camera: { fov: 42 },
  })
  const { scene } = view
  scene.fog = { color: '#05070b', density: 0.028 }
  scene.add(new HemisphereLight({ sky: '#3a4f70', ground: '#0a0d12', intensity: 0.9 }))

  // everything in the centre, drawn twice: once above the floor, once mirrored below it
  const hall = scene.add(new Group({ name: 'hall' }))

  // ---- racks: bodies, server fronts and their LEDs
  const racks = hall.add(new InstancedMesh({ geometry: box({ width: RACK.w - 0.02, height: RACK.h, depth: RACK.d }), count: ROWS.length * PER_ROW,
    material: { color: '#22272f', metalness: 0.6, roughness: 0.38 }, castShadow: true }))
  const servers = []
  /** @type {number[]} */
  const ledPositions = [], ledColors = []
  /** @type {{ index: number, rgb: number[], rate: number }[]} */
  const leds = []
  const LED = { green: [0.25, 1, 0.45], blue: [0.3, 0.6, 1], amber: [1, 0.62, 0.15] }
  ROWS.forEach((row, r) => {
    for (let i = 0; i < PER_ROW; i++) {
      const x = rackX(i), front = row.z + row.face * (RACK.d / 2 + 0.006)
      racks.setInstance(r * PER_ROW + i, { position: [x, RACK.h / 2, row.z] })
      // the power strips down each rack's back, an outlet light per socket in use
      const back = row.z - row.face * (RACK.d / 2 + 0.006)
      for (let s = 0; s < 14; s++) {
        if (rand() < 0.25) continue
        leds.push({ index: ledPositions.length / 3, rgb: LED.green, rate: 0 })
        ledPositions.push(x + 0.22, 0.25 + s * 0.12, back - row.face * 0.012)
        ledColors.push(...LED.green)
      }
      const core = r === 2 && CORE.includes(i)
      const units = core ? 14 : 12 + Math.floor(rand() * 8)
      for (let u = 0; u < units; u++) {
        const y = 0.2 + u * (core ? 0.13 : 0.095)
        servers.push({ position: [x, y, front], scale: [1, core ? 1.4 : 1, 1] })
        // a few lights per server; a switch has a row of ports
        const n = core ? 12 : 2 + Math.floor(rand() * 3)
        for (let k = 0; k < n; k++) {
          const rgb = core ? (rand() < 0.8 ? LED.green : LED.blue) : rand() < 0.04 ? LED.amber : rand() < 0.5 ? LED.blue : LED.green
          leds.push({ index: ledPositions.length / 3, rgb, rate: core ? 0.25 + rand() : rand() < 0.4 ? 0.6 + rand() * 2 : 0 })
          ledPositions.push(x - 0.24 + (core ? k * 0.04 : k * 0.035), y + 0.01, front + row.face * 0.012)
          ledColors.push(...rgb)
        }
      }
    }
  })
  hall.add(new InstancedMesh({ geometry: box({ width: RACK.w - 0.1, height: 0.08, depth: 0.02 }), material: { color: '#3a404a', metalness: 0.5, roughness: 0.4 },
    instances: servers }))
  // the network core's two racks, their doors framed in blue light, so the stop looks like somewhere new
  for (const i of CORE) {
    const front = ROWS[2].z + RACK.d / 2 + 0.012
    for (const s of [-1, 1]) {
      hall.add(new Mesh({ geometry: box({ width: 0.018, height: RACK.h - 0.1, depth: 0.018 }), position: [rackX(i) + s * 0.27, RACK.h / 2, front], material: { color: '#4aa3ff', unlit: true }, pickable: false }))
    }
    hall.add(new Mesh({ geometry: box({ width: 0.56, height: 0.018, depth: 0.018 }), position: [rackX(i), RACK.h - 0.06, front], material: { color: '#4aa3ff', unlit: true }, pickable: false }))
  }
  const ledGeometry = new Geometry({ positions: ledPositions, colors: ledColors })
  hall.add(new Points({ geometry: ledGeometry, material: { size: 0.05, vertexColors: true, blending: 'additive' }, pickable: false }))

  // ---- the cold aisles' glass roofs and end doors, and the cable trays over the rows
  for (const z of COLD) {
    hall.add(new Mesh({ geometry: plane({ width: PER_ROW * RACK.w, depth: 2.4 }), position: [0, RACK.h + 0.08, z], material: { color: '#7fb6ff', opacity: 0.14, roughness: 0.1, doubleSided: true }, pickable: false }))
    for (const s of [-1, 1]) {
      hall.add(new Mesh({ geometry: box({ width: 0.04, height: RACK.h, depth: 2.4 }), position: [s * (PER_ROW * RACK.w / 2 + 0.02), RACK.h / 2, z], material: { color: '#9cc8ff', opacity: 0.16, roughness: 0.1 }, pickable: false }))
    }
  }
  for (const row of ROWS) {
    hall.add(new Mesh({ geometry: box({ width: PER_ROW * RACK.w + 0.6, height: 0.06, depth: 0.45 }), position: [0, RACK.h + 0.6, row.z], material: { color: '#c39a2b', metalness: 0.4, roughness: 0.5 }, pickable: false }))
  }

  // ---- light bars over the aisles: they glow, and spot lights below them do the lighting
  for (const z of [...COLD, 0]) {
    const cold = z !== 0
    hall.add(new Mesh({ geometry: box({ width: PER_ROW * RACK.w - 1, height: 0.05, depth: 0.12 }), position: [0, HALL.h - 0.3, z],
      material: { color: cold ? '#cfe6ff' : '#ffb08a', unlit: true }, pickable: false }))
  }
  COLD.forEach((z) => scene.add(new SpotLight({ color: '#a9d0ff', intensity: 60, position: [0, HALL.h - 0.4, z], target: [0, 0, z], angle: 1.1, penumbra: 0.6, range: 12, castShadow: true })))
  scene.add(new SpotLight({ color: '#ff7a4a', intensity: 45, position: [0, HALL.h - 0.4, 0], target: [0, 0, 0], angle: 1.05, penumbra: 0.7, range: 10 }))
  // the power cabinets along the east wall, in a cooler wash - the fourth spot light, the most a scene
  // has; the cooling units to the west are pale enough to read in the centre's fill
  scene.add(new SpotLight({ color: '#9fc0ee', intensity: 34, position: [HALL.w / 2 - 2.6, HALL.h - 0.3, -2.6], target: [HALL.w / 2 - 0.6, 0.9, -2.6], angle: 1.15, penumbra: 0.8, range: 10 }))

  // ---- cooling along the west wall, power along the east, the operations wall to the north
  const cooling = hall.add(new Group({ name: 'cooling' }))
  for (const z of [-5.5, -1.8, 1.8, 5.5]) {
    cooling.add(new Mesh({ geometry: box({ width: 0.9, height: 2.3, depth: 2.2 }), position: [-HALL.w / 2 + 0.6, 1.15, z], material: { color: '#c9ced6', metalness: 0.3, roughness: 0.5 }, castShadow: true }))
    cooling.add(new Mesh({ geometry: box({ width: 0.02, height: 0.5, depth: 1.6 }), position: [-HALL.w / 2 + 1.06, 1.7, z], material: { color: '#1b1f25', roughness: 0.8 }, pickable: false }))
    cooling.add(new Mesh({ geometry: box({ width: 0.02, height: 0.08, depth: 0.3 }), position: [-HALL.w / 2 + 1.07, 2.05, z + 0.6], material: { color: '#59d88a', unlit: true }, pickable: false }))
  }
  const power = hall.add(new Group({ name: 'power' }))
  /** The UPS status bars, which breathe slowly. @type {{ mesh: Mesh, base: string }[]} */
  const glows = []
  for (let k = 0; k < 6; k++) {
    const z = -5.2 + k * 1.05
    power.add(new Mesh({ geometry: box({ width: 0.8, height: 2, depth: 1 }), position: [HALL.w / 2 - 0.6, 1, z], material: { color: k < 3 ? '#3e5a80' : '#6a4242', metalness: 0.35, roughness: 0.45 }, castShadow: true }))
    const base = k < 3 ? '#7fb6ff' : '#ffb547'
    glows.push({ mesh: power.add(new Mesh({ geometry: box({ width: 0.02, height: 0.12, depth: 0.5 }), position: [HALL.w / 2 - 1.01, 1.6, z], material: { color: base, unlit: true }, pickable: false })), base })
  }
  const ops = operations()
  const wall = hall.add(new Mesh({ geometry: plane({ width: 6.4, depth: 2.4 }), rotation: [Math.PI / 2, 0, 0], position: [0, 2.3, -HALL.d / 2 + 0.15],
    material: { map: ops.texture, unlit: true, doubleSided: true } }))

  // ---- the room: walls, and the floor - glossy and a little see-through, over the mirrored centre
  const room = scene.add(new Group({ name: 'room', pickable: false }))
  for (const [w, d, x, z] of [[HALL.w, 0.1, 0, -HALL.d / 2], [HALL.w, 0.1, 0, HALL.d / 2], [0.1, HALL.d, -HALL.w / 2, 0], [0.1, HALL.d, HALL.w / 2, 0]]) {
    room.add(new Mesh({ geometry: box({ width: w, height: HALL.h, depth: d }), position: [x, HALL.h / 2, z], material: { color: '#15191f', roughness: 0.85 }, receiveShadow: true }))
  }
  const plain = tiles(false), perforated = tiles(true)
  plain.repeat = [HALL.w / 0.6, HALL.d / 0.6]
  room.add(new Mesh({ geometry: plane({ width: HALL.w, depth: HALL.d }), material: { map: plain, roughness: 0.12, metalness: 0.4, opacity: 0.86 }, receiveShadow: true }))
  perforated.repeat = [PER_ROW, 4]
  for (const z of COLD) {
    room.add(new Mesh({ geometry: plane({ width: PER_ROW * RACK.w, depth: 2.4 }), position: [0, 0.004, z], material: { map: perforated, roughness: 0.2, metalness: 0.4, opacity: 0.9 }, receiveShadow: true }))
  }
  const mirror = scene.add(hall.clone())
  mirror.scale = [1, -1, 1]
  mirror.pickable = false
  mirror.traverse((n) => { /** @type {any} */ (n).castShadow = false })

  // ---- the inspection robot, lapping the aisles
  const route = curve([[-5.2, 0, COLD[0]], [5.2, 0, COLD[0]], [5.8, 0, 0], [5.2, 0, COLD[1]], [-5.2, 0, COLD[1]], [-5.8, 0, 0]], { closed: true })
  const robot = scene.add(new Group({ name: 'robot' }))
  robot.add(new Mesh({ geometry: cylinder({ radius: 0.28, height: 0.5, segments: 32 }), position: [0, 0.3, 0], material: { color: '#e9edf2', roughness: 0.35, metalness: 0.2 }, castShadow: true }))
  robot.add(new Mesh({ geometry: cylinder({ radius: 0.1, height: 0.12, segments: 24 }), position: [0, 0.61, 0], material: { color: '#1c2028', roughness: 0.3 } }))
  robot.add(new Mesh({ geometry: box({ width: 0.3, height: 0.05, depth: 0.04 }), position: [0, 0.42, 0.27], material: { color: '#59c3ff', unlit: true } }))
  let lap = 0

  // ---- the tour
  /** What each stop frames: a node, or a box round part of the centre. @type {Record<string, any>} */
  const at = { hall, wall }
  const area = (/** @type {number[]} */ min, /** @type {number[]} */ max) => new Box3(min, max)
  at.coldAisle = area([-PER_ROW * RACK.w / 2, 0, COLD[0] - 1.2], [PER_ROW * RACK.w / 2, RACK.h, COLD[0] + 1.2])
  at.hotAisle = area([-PER_ROW * RACK.w / 2, 0, -1.6], [PER_ROW * RACK.w / 2, RACK.h, 1.6])
  at.rack = area([rackX(7) - 0.35, 0, ROWS[1].z - 0.6], [rackX(7) + 0.35, RACK.h, ROWS[1].z + 0.6])
  // the equipment along the walls, framed from inside the room - the whole wall's length would put the camera outside it
  at.cooling = area([-HALL.w / 2 + 0.1, 0, -6.7], [-HALL.w / 2 + 1.1, 2.3, -0.6])
  at.power = area([HALL.w / 2 - 1.1, 0, -5.8], [HALL.w / 2 - 0.1, 2, 0.6])
  at.core = area([rackX(6) - 0.35, 0, ROWS[2].z - 0.6], [rackX(7) + 0.35, RACK.h, ROWS[2].z + 0.6])
  const stops = stopsOf(at)

  const ui = document.createElement('div')
  ui.className = 'tour'
  ui.innerHTML = `
    <div class="tour-card" hidden><h3></h3><p></p></div>
    <nav class="tour-bar">
      <button type="button" data-step="-1" aria-label="Back">‹</button>
      <div class="tour-now"><span class="tour-count"></span><strong></strong><div class="tour-dots">${stops.map((_, i) => `<i data-i="${i}"></i>`).join('')}</div></div>
      <button type="button" data-step="1" aria-label="Next">›</button>
    </nav>`
  document.body.append(ui)
  const card = /** @type {HTMLElement} */ (ui.querySelector('.tour-card'))
  const dots = [...ui.querySelectorAll('.tour-dots i')]

  // a numbered pin for each stop, in the centre: click one to go there
  stops.forEach((stop, i) => {
    if (!stop.pin) return
    scene.add(new Label({ text: String(i + 1), position: stop.pin, className: 'tour-pin', overlap: 'show', onClick: () => go(i) }))
  })

  let current = 0
  // seconds since the last move: the card waits for the glide to finish
  let settle = 0
  /** @type {any} */
  let followed = null
  /** @type {import('phoria2').Vec3 | null} */
  let last = null
  /** Go to a stop: glide there, then pin its card beside what it is about. @param {number} i */
  const go = (i) => {
    current = (i + stops.length) % stops.length
    const stop = stops[current]
    followed = null
    last = null
    settle = 0
    if (stop.follow) {
      // a few metres round the robot, then keep up with it
      const r = robot.worldPosition
      view.frame(area([r[0] - 1.6, 0, r[2] - 1.6], [r[0] + 1.6, 1.2, r[2] + 1.6]), { direction: stop.direction, duration: 1.2 })
      setTimeout(() => { if (stops[current] === stop) followed = robot }, 1250)
    } else view.frame(stop.frame, { direction: stop.direction, padding: 0.12, duration: 1.4 })
    ui.querySelector('.tour-count').textContent = `${current + 1} of ${stops.length}`
    ui.querySelector('.tour-now strong').textContent = stop.title
    card.querySelector('h3').textContent = stop.title
    card.querySelector('p').textContent = stop.text
    dots.forEach((d, k) => d.classList.toggle('on', k === current))
    card.hidden = true
    info.textContent = `${stop.title} - Next and Back, the arrow keys, or a numbered pin in the centre`
  }
  ui.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => go(current + Number(/** @type {HTMLElement} */ (b).dataset.step))))
  dots.forEach((d, k) => d.addEventListener('click', () => go(k)))
  const keys = (/** @type {KeyboardEvent} */ e) => {
    if (e.key === 'ArrowRight') go(current + 1)
    else if (e.key === 'ArrowLeft') go(current - 1)
  }
  window.addEventListener('keydown', keys)

  // the card is placed by the stop's point on screen, after the glide has settled
  view.start((dt, t) => {
    // the robot laps, and a stop that follows it moves the camera as far as it moved
    const along = (t / 70) % 1
    if (along < 0.01 && t > 1) lap = Math.floor(t / 70) + 3
    follow(robot, route, along, { forward: '+z' })
    if (followed) {
      const now = followed.updateWorld().worldPosition
      if (last) {
        const moved = now.clone().sub(last), camera = /** @type {any} */ (view.camera)
        camera.position.add(moved)
        camera.target.add(moved)
      }
      last = now
    }
    // the UPS bars breathe, each a little behind the one before
    glows.forEach(({ mesh, base }, k) => mesh.material.color.set(base).multiplyScalar(0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 1.4 - k * 0.6))))
    // the LEDs: steady ones stay lit, the rest flicker at their own rates
    const colors = /** @type {Float32Array} */ (ledGeometry.colors)
    for (const led of leds) {
      if (!led.rate) continue
      const on = Math.sin(t * led.rate * 9 + led.index) > -0.2 ? 1 : 0.15
      colors.set(led.rgb.map((v) => v * on), led.index * 3)
    }
    ledGeometry.needsUpdate()
    // the operations wall, twice a second
    if (Math.floor(t * 2) !== Math.floor((t - dt) * 2)) {
      ops.draw(t)
      ops.texture.needsUpdate()
    }
    // the card, beside its point once the camera is there
    settle += dt
    const stop = stops[current]
    const point = stop.follow ? robot.worldPosition.toArray().map((v, k) => (k === 1 ? v + 0.9 : v)) : stop.pin
    const p = view.project(point)
    card.hidden = settle < 1.3 || !p.visible
    if (!card.hidden) {
      const rect = canvas.getBoundingClientRect()
      card.style.transform = `translate(${Math.round(rect.left + p.x + 18)}px, ${Math.round(rect.top + p.y - 20)}px)`
    }
    if (stop.follow) card.querySelector('p').textContent = `Laps every aisle each hour, checking temperatures and listening for failing fans. Lap ${lap || 3} of the night: no alerts.`
  })
  view.frame(hall, { direction: stops[0].direction, padding: 0.12 })
  go(0)

  void gui
  if (import.meta.env.DEV) Object.assign(window, { go, stops })
  return view
}
