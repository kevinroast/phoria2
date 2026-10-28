import { AmbientLight, Box3, DirectionalLight, Geometry, Group, InstancedMesh, Label, Lines, Mesh, PointLight, Points, Texture, View, box, cylinder, edges } from 'phoria2'
import { Timeline } from 'phoria2/motion'
import { glow, random } from './kit.js'

// A processor going into its socket, as a glowing isometric illustration: it hangs above the board
// pulled apart into its layers, stacks, turns to line up, drops in and is clamped down - then the
// board lights up, pulses racing out along its traces. The glow is the view's bloom: anything
// bright enough - emissive materials, additive lines and points - spills light round itself.

const CYAN = '#3cf0ff', GOLD = '#c9a55a'
const SOCKET = 2.5 // half the socket's width
const LIFT = 3.4 // how high the processor hangs before it goes in
const SEATED = 0.17 // its height in the socket, resting on the pins

/** Progress through part of a step: 0 before a, 1 after b. */
const part = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)))
/** Eased 0 - 1. */
const smooth = (t) => t * t * (3 - 2 * t)
const lerp = (a, b, t) => a + (b - a) * t

/** A canvas, drawn on, as a texture. */
function painted(width, height, draw) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  draw(/** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d')), width, height)
  return new Texture({ image: canvas })
}

/** The board: dark solder mask with rows of gold pads and faint silkscreen, darker toward the edges. */
function boardTexture() {
  const rand = random(3)
  return painted(1024, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#0b1714'
    ctx.fillRect(0, 0, w, h)
    // pad arrays, as in the corners of a real board
    for (let n = 0; n < 26; n++) {
      const x = rand() * w, y = rand() * h
      if (Math.abs(x - w / 2) < 230 && Math.abs(y - h / 2) < 230) continue
      const cols = 2 + Math.floor(rand() * 5), rows = 1 + Math.floor(rand() * 3), s = 6 + rand() * 8
      ctx.fillStyle = `rgba(201, 165, 90, ${0.25 + rand() * 0.35})`
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) ctx.fillRect(x + i * s * 1.6, y + j * s * 1.6, s, s)
    }
    // silkscreen outlines
    ctx.strokeStyle = 'rgba(200, 220, 210, 0.12)'
    ctx.lineWidth = 2
    for (let n = 0; n < 30; n++) {
      const x = rand() * w, y = rand() * h
      if (Math.abs(x - w / 2) < 230 && Math.abs(y - h / 2) < 230) continue
      ctx.strokeRect(x, y, 20 + rand() * 60, 12 + rand() * 40)
    }
    const fade = ctx.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w * 0.7)
    fade.addColorStop(0, 'rgba(0, 0, 0, 0)')
    fade.addColorStop(1, 'rgba(0, 0, 0, 0.75)')
    ctx.fillStyle = fade
    ctx.fillRect(0, 0, w, h)
  })
}

/** The heat spreader's etched top. Its canvas top is the lid's back edge (-z). */
function lidTexture() {
  return painted(512, 512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, h)
    g.addColorStop(0, '#d9dde3')
    g.addColorStop(0.5, '#b9bec6')
    g.addColorStop(1, '#d0d4da')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = 'rgba(40, 46, 56, 0.75)'
    ctx.font = '700 58px system-ui, sans-serif'
    ctx.fillText('PHORIA', 60, 200)
    ctx.font = '500 28px system-ui, sans-serif'
    ctx.fillText('X2-9950  ·  5.2 GHz', 62, 250)
    ctx.fillText('24 CORE  ·  2026', 62, 292)
    ctx.font = '400 20px ui-monospace, monospace'
    ctx.fillText('L6R2 0417 A1', 62, 420)
    // the corner triangle that says which way round it goes
    ctx.beginPath()
    ctx.moveTo(24, 24)
    ctx.lineTo(70, 24)
    ctx.lineTo(24, 70)
    ctx.fill()
  })
}

/** The silicon die: cores, caches and buses, drawn to glow. */
function dieTexture() {
  const rand = random(8)
  return painted(512, 384, (ctx, w, h) => {
    ctx.fillStyle = '#010403'
    ctx.fillRect(0, 0, w, h)
    // a grid of cores, each with its cache stripes
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 4; j++) {
        const x = 24 + i * 78, y = 28 + j * 84
        ctx.fillStyle = `rgba(70, 255, 156, ${0.25 + rand() * 0.25})`
        ctx.fillRect(x, y, 66, 72)
        ctx.fillStyle = 'rgba(60, 240, 255, 0.85)'
        for (let k = 0; k < 5; k++) ctx.fillRect(x + 6, y + 8 + k * 12, 54, 3)
        ctx.fillStyle = 'rgba(220, 255, 240, 0.9)'
        ctx.fillRect(x + 22, y + 66, 22, 3)
      }
    }
    // a bus round the edge
    ctx.strokeStyle = 'rgba(60, 240, 255, 0.9)'
    ctx.lineWidth = 3
    ctx.strokeRect(10, 12, w - 20, h - 24)
  })
}

/** The substrate's top: green fibreglass, small capacitors round the edge, its gold triangle. */
function substrateTexture() {
  return painted(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#0d3a2a'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = 'rgba(201, 165, 90, 0.85)'
    for (let i = 0; i < 18; i++) {
      ctx.fillRect(40 + i * 24, 18, 10, 6)
      ctx.fillRect(40 + i * 24, h - 24, 10, 6)
    }
    ctx.beginPath()
    ctx.moveTo(10, 10)
    ctx.lineTo(44, 10)
    ctx.lineTo(10, 44)
    ctx.fill()
  })
}

/**
 * The traces fanning out from the socket, as on a real board: out from each side, a 45 degree
 * bend to spread them apart, then on to a pad. Each is a list of [x, z] corners.
 */
function routeTraces() {
  const rand = random(17)
  /** @type {number[][][]} */
  const traces = []
  const n = 15
  for (let side = 0; side < 4; side++) {
    // turn the +x side's routes round to each side in turn
    const a = side * Math.PI / 2, c = Math.cos(a), s = Math.sin(a)
    const turn = ([x, z]) => [x * c - z * s, x * s + z * c]
    for (let i = 0; i < n; i++) {
      const z0 = (i / (n - 1) - 0.5) * 2 * (SOCKET - 0.45)
      const out = SOCKET + 0.25 + rand() * 0.15
      const spread = Math.abs(z0) * 1.1, dir = Math.sign(z0)
      const reach = 1.4 + rand() * 3.6
      const route = [[SOCKET + 0.05, z0], [out, z0], [out + spread, z0 + dir * spread], [out + spread + reach, z0 + dir * spread]]
      traces.push(route.map(turn))
    }
  }
  return traces
}

/** Lengths along a route: [total, cumulative at each corner]. @param {number[][]} route */
function measure(route) {
  const at = [0]
  for (let i = 1; i < route.length; i++) at.push(at[i - 1] + Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]))
  return at
}

/** The point d along a route. @param {number[][]} route @param {number[]} at @param {number} d */
function along(route, at, d) {
  const total = at[at.length - 1]
  d = Math.min(total, Math.max(0, d))
  let i = 1
  while (i < at.length - 1 && at[i] < d) i++
  const f = (d - at[i - 1]) / ((at[i] - at[i - 1]) || 1)
  return [lerp(route[i - 1][0], route[i][0], f), lerp(route[i - 1][1], route[i][1], f)]
}

export default function run({ canvas, gui, info }) {
  const view = new View({
    canvas, orbit: true, background: '#03060a', camera: 'isometric',
    // the glow: bright parts spill light round them
    bloom: { strength: 1.15, radius: 0.7, threshold: 0.5 },
  })
  const { scene } = view
  scene.environment = 'studio'
  scene.add(new AmbientLight({ intensity: 0.25 }))
  scene.add(new DirectionalLight({ direction: [-0.6, -1, -0.35], intensity: 1.4 }))
  // a cyan wash over the board round the socket as it powers up - from below the lid's top, so the
  // lid itself isn't lit by it
  const wash = scene.add(new PointLight({ color: CYAN, intensity: 0, range: 9, position: [0, 0.3, 0] }))
  const sprite = glow(64)

  // --- the board
  const BOARD = 22
  scene.add(new Mesh({
    geometry: box({ width: BOARD, height: 0.3, depth: BOARD }), position: [0, -0.15, 0], pickable: false,
    material: { map: boardTexture(), roughness: 0.55, metalness: 0.2 },
  }))
  // components round about: capacitors by the socket, memory slots behind it
  const rand = random(5)
  const caps = []
  for (let n = 0; n < 46; n++) {
    const x = (rand() - 0.5) * 16, z = (rand() - 0.5) * 16
    if (Math.max(Math.abs(x), Math.abs(z)) < SOCKET + 1.6 || (z < -6.5 && Math.abs(x) < 6)) continue
    caps.push({ position: [x, 0.22, z], scale: [1, 0.8 + rand() * 0.8, 1] })
  }
  scene.add(new InstancedMesh({
    geometry: cylinder({ radius: 0.16, height: 0.4, segments: 16 }), instances: caps, pickable: false,
    material: { color: '#1d2836', metalness: 0.7, roughness: 0.3 },
  }))
  for (let i = 0; i < 4; i++) {
    const slot = scene.add(new Group({ position: [0, 0, -7.2 - i * 0.7] }))
    slot.add(new Mesh({ geometry: box({ width: 11, height: 0.35, depth: 0.32 }), position: [0, 0.175, 0], material: { color: '#0f2a26', roughness: 0.6 }, pickable: false }))
    slot.add(new Mesh({ geometry: box({ width: 10.6, height: 0.04, depth: 0.12 }), position: [0, 0.36, 0], material: { color: GOLD, metalness: 1, roughness: 0.3 }, pickable: false }))
  }

  // --- the traces, dim copper, with pads at their ends
  const traces = routeTraces()
  const lengths = traces.map(measure)
  const tracePositions = []
  for (const route of traces) {
    for (let i = 1; i < route.length; i++) tracePositions.push(route[i - 1][0], 0.006, route[i - 1][1], route[i][0], 0.006, route[i][1])
  }
  scene.add(new Lines({ geometry: new Geometry({ positions: tracePositions }), material: { color: '#6a5526', width: 2 }, pickable: false }))
  const ends = traces.map((r) => r[r.length - 1])
  scene.add(new InstancedMesh({
    geometry: box({ width: 0.22, height: 0.03, depth: 0.22 }), pickable: false,
    instances: ends.map(([x, z]) => ({ position: [x, 0.015, z] })),
    material: { color: GOLD, metalness: 1, roughness: 0.35 },
  }))
  // each pad glows when a pulse reaches it
  const padGlow = scene.add(new Points({
    geometry: new Geometry({ positions: ends.flatMap(([x, z]) => [x, 0.05, z]), colors: new Float32Array(ends.length * 3) }),
    material: { size: 0.9, map: sprite, vertexColors: true, blending: 'additive', depthWrite: false }, pickable: false,
  }))

  // the pulses: short bright streaks on the traces, fading toward their tails - written into one
  // buffer each frame, with drawCount saying how much of it is in use
  const ROOM = 6000
  const pulses = scene.add(new Lines({
    geometry: new Geometry({ positions: new Float32Array(ROOM * 3), colors: new Float32Array(ROOM * 3) }),
    material: { width: 3, vertexColors: true, blending: 'additive', depthWrite: false }, pickable: false, frustumCulled: false,
  }))

  // --- the socket: a black frame round a field of gold pins, a hinged load plate and its lever
  const socket = scene.add(new Group())
  const wall = 0.42, height = 0.32
  for (const [x, z, w, d] of [[0, SOCKET - wall / 2, SOCKET * 2, wall], [0, -SOCKET + wall / 2, SOCKET * 2, wall], [SOCKET - wall / 2, 0, wall, SOCKET * 2 - wall * 2], [-SOCKET + wall / 2, 0, wall, SOCKET * 2 - wall * 2]]) {
    socket.add(new Mesh({ geometry: box({ width: w, height, depth: d }), position: [x, height / 2, z], material: { color: '#15171c', roughness: 0.65 }, pickable: false }))
  }
  socket.add(new Mesh({ geometry: box({ width: SOCKET * 2 - wall * 2, height: 0.08, depth: SOCKET * 2 - wall * 2 }), position: [0, 0.04, 0], material: { color: '#0c0d10', roughness: 0.8 }, pickable: false }))
  const pins = []
  const PITCH = 0.13, inner = SOCKET - wall - 0.12
  for (let x = -inner; x <= inner + 1e-6; x += PITCH) {
    for (let z = -inner; z <= inner + 1e-6; z += PITCH) {
      if (Math.abs(x) < 0.55 && Math.abs(z) < 0.55) continue
      pins.push([x, z])
    }
  }
  socket.add(new InstancedMesh({
    geometry: box({ width: 0.05, height: 0.08, depth: 0.05 }), pickable: false,
    instances: pins.map(([x, z]) => ({ position: [x, 0.12, z] })),
    material: { color: GOLD, metalness: 1, roughness: 0.3 },
  }))
  // the pins light in a wave as the processor comes down onto them
  const pinGlow = socket.add(new Points({
    geometry: new Geometry({ positions: pins.flatMap(([x, z]) => [x, 0.17, z]), colors: new Float32Array(pins.length * 3) }),
    material: { size: 0.16, map: sprite, vertexColors: true, blending: 'additive', depthWrite: false }, pickable: false,
  }))
  // the socket's outline, which flashes as it powers up
  const socketEdge = socket.add(new Lines({
    geometry: edges(box({ width: SOCKET * 2, height, depth: SOCKET * 2 })), position: [0, height / 2, 0],
    material: { color: CYAN, width: 2, blending: 'additive', depthWrite: false, opacity: 0 }, pickable: false,
  }))
  // the load plate swings on a hinge along the -x side. The lever is a rod along the +x side, hinged at
  // its front end: its back end, with the handle, lifts a little off the board to let go
  const plate = socket.add(new Group({ position: [-SOCKET - 0.05, height + 0.03, 0] }))
  const metal = { color: '#aab1bb', metalness: 1, roughness: 0.28 }
  for (const [x, z, w, d] of [[SOCKET + 0.05, SOCKET - 0.12, SOCKET * 2 + 0.1, 0.24], [SOCKET + 0.05, -SOCKET + 0.12, SOCKET * 2 + 0.1, 0.24], [0.17, 0, 0.24, SOCKET * 2 - 0.48], [SOCKET * 2 - 0.07, 0, 0.24, SOCKET * 2 - 0.48]]) {
    plate.add(new Mesh({ geometry: box({ width: w, height: 0.05, depth: d }), position: [x, 0, z], material: metal, pickable: false }))
  }
  const lever = socket.add(new Group({ position: [SOCKET + 0.32, 0.18, SOCKET - 0.1] }))
  lever.add(new Mesh({ geometry: cylinder({ radius: 0.05, height: SOCKET * 2 + 0.3, segments: 12, axis: 'z' }), position: [0, 0, -SOCKET], material: metal, pickable: false }))
  lever.add(new Mesh({ geometry: cylinder({ radius: 0.07, height: 0.6, segments: 12, axis: 'x' }), position: [0.27, 0, -SOCKET * 2 - 0.1], material: metal, pickable: false }))

  // guides from the socket's corners up to the processor as it lines up, and a band of light
  // that sweeps up and down them
  const guidePositions = []
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) guidePositions.push(x * SOCKET, height, z * SOCKET, x * SOCKET, LIFT + 1.2, z * SOCKET)
  const guides = scene.add(new Lines({ geometry: new Geometry({ positions: guidePositions }), material: { color: CYAN, width: 1.5, blending: 'additive', depthWrite: false, opacity: 0 }, pickable: false }))
  const S2 = SOCKET
  const square = [[-S2, -S2], [S2, -S2], [S2, S2], [-S2, S2]].flatMap(([x, z], i, all) => [x, 0, z, all[(i + 1) % 4][0], 0, all[(i + 1) % 4][1]])
  const scan = scene.add(new Lines({ geometry: new Geometry({ positions: square }), material: { color: CYAN, width: 2.5, blending: 'additive', depthWrite: false, opacity: 0 }, pickable: false }))
  const column = scene.add(new Mesh({
    geometry: box({ width: SOCKET * 2, height: LIFT + 1.2 - height, depth: SOCKET * 2 }), position: [0, (LIFT + 1.2 + height) / 2, 0],
    material: { color: CYAN, unlit: true, opacity: 0, blending: 'additive', depthWrite: false, doubleSided: true }, pickable: false,
  }))

  // --- the processor: substrate, die and heat spreader, each with a glowing outline
  const cpu = scene.add(new Group())
  /** A layer of the processor, with its outline. */
  const layer = (geometry, material, y) => {
    const mesh = cpu.add(new Mesh({ geometry, material, position: [0, y, 0], pickable: false }))
    const outline = mesh.add(new Lines({ geometry: edges(geometry), material: { color: CYAN, width: 2, blending: 'additive', depthWrite: false, opacity: 0 }, pickable: false }))
    return { mesh, outline }
  }
  const substrate = layer(box({ width: 4, height: 0.1, depth: 4 }), { map: substrateTexture(), roughness: 0.5 }, 0.05)
  const die = layer(box({ width: 1.9, height: 0.05, depth: 1.4 }), { color: '#050807', emissive: '#ffffff', emissiveMap: dieTexture(), emissiveIntensity: 1.6, roughness: 0.3 }, 0.13)
  const lid = layer(box({ width: 3.3, height: 0.16, depth: 3.3 }), { map: lidTexture(), metalness: 0.85, roughness: 0.3, transparent: true }, 0.18)
  // where each layer sits stacked, and pulled apart
  const STACKED = [0.05, 0.13, 0.18], APART = [0, 1.15, 2.4]
  const names = ['Substrate', 'Silicon die · 24 cores', 'Heat spreader']
  // named off to the left of the layers (seen from the front right), whichever way the processor is turned
  const tags = names.map((text) => scene.add(new Label({ text, place: 'left', className: 'chip-layer', overlap: 'show' })))

  // --- what the story controls, set by its steps each frame, then applied
  const state = { explode: 1, lift: LIFT, spin: Math.PI / 2, guides: 0, pins: 0, plate: 1, lever: 1, power: 0, wave: 0, flow: 0, flowTime: 0, tags: 1 }
  const story = new Timeline({ loop: true })
  const STEPS = ['Pulled apart into its layers', 'The layers come together', 'Lining up with the socket', 'Into the socket', 'Clamped down', 'Power on', 'Running', 'Released']
  story
    .add(3.5, (t) => {
      // where everything starts: the step that sets every channel, which later steps override
      Object.assign(state, { explode: 1, lift: LIFT, spin: Math.PI / 2, guides: 0, pins: 0, plate: 1, lever: 1, power: 0, wave: 0, flow: 0, flowTime: 0, tags: smooth(part(t, 0, 0.15)) })
    }, { label: STEPS[0] })
    .add(2, (t) => {
      if (t === 0) return
      state.explode = 1 - t
      state.tags = 1 - part(t, 0, 0.3)
    }, { label: STEPS[1], ease: 'inOut' })
    .add(2, (t) => {
      if (t === 0) return
      state.spin = (1 - smooth(t)) * Math.PI / 2
      state.guides = smooth(part(t, 0, 0.6))
    }, { label: STEPS[2] })
    .add(2.2, (t) => {
      if (t === 0) return
      state.lift = lerp(LIFT, SEATED, t)
      state.pins = part(t, 0.55, 1)
    }, { label: STEPS[3], ease: 'inOut' })
    .add(1.8, (t) => {
      if (t === 0) return
      state.plate = 1 - smooth(part(t, 0, 0.55))
      state.lever = 1 - smooth(part(t, 0.5, 1))
      state.guides = 1 - part(t, 0, 0.5)
      state.pins = 1 - part(t, 0.3, 1)
    }, { label: STEPS[4] })
    .add(3, (t) => {
      if (t === 0) return
      state.power = smooth(part(t, 0, 0.25))
      state.wave = t
    }, { label: STEPS[5] })
    .add(6, (t) => {
      if (t === 0) return
      state.wave = 1
      state.flow = smooth(part(t, 0, 0.2))
      state.flowTime = t * 6
    }, { label: STEPS[6] })
    .add(3, (t) => {
      if (t === 0) return
      state.flowTime = 6 + t * 3
      state.flow = 1 - part(t, 0, 0.3)
      state.wave = 1
      state.power = 1 - smooth(part(t, 0, 0.35))
      state.lever = smooth(part(t, 0, 0.25))
      state.plate = smooth(part(t, 0.15, 0.45))
      state.lift = lerp(SEATED, LIFT, smooth(part(t, 0.4, 0.75)))
      state.spin = smooth(part(t, 0.6, 1)) * Math.PI / 2
      state.explode = smooth(part(t, 0.7, 1))
    }, { label: STEPS[7] })

  // the pulses' speed and spacing along the traces
  const TAIL = 1.1, SPEED = 4.5, GAP = 2.6
  const maxLength = Math.max(...lengths.map((at) => at[at.length - 1]))
  const cyan = [0.24, 0.94, 1], green = [0.27, 1, 0.61]
  /** Draw the pulses for the story so far. @param {number} time seconds, for the gentle flicker */
  const drawPulses = (time) => {
    const positions = pulses.geometry.positions, tint = /** @type {Float32Array} */ (pulses.geometry.colors)
    const lit = /** @type {Float32Array} */ (padGlow.geometry.colors)
    let used = 0
    const piece = (x0, z0, x1, z1, b0, b1, color) => {
      if (used + 2 > ROOM) return
      positions.set([x0, 0.012, z0, x1, 0.012, z1], used * 3)
      tint.set([color[0] * b0, color[1] * b0, color[2] * b0, color[0] * b1, color[1] * b1, color[2] * b1], used * 3)
      used += 2
    }
    const streak = (route, at, head, strength, color) => {
      // a streak of six pieces, brightest at its head
      for (let k = 0; k < 6; k++) {
        const d0 = head - TAIL * k / 6, d1 = head - TAIL * (k + 1) / 6
        const total = at[at.length - 1]
        if (d0 < 0 || d1 > total) continue
        const [x0, z0] = along(route, at, d0), [x1, z1] = along(route, at, Math.max(0, d1))
        piece(x0, z0, x1, z1, strength * (1 - k / 6), strength * (1 - (k + 1) / 6), color)
      }
    }
    traces.forEach((route, i) => {
      const at = lengths[i], total = at[at.length - 1]
      // the first wave, out from the socket all at once
      const head = state.wave * (maxLength + TAIL)
      if (state.wave > 0 && state.wave < 1) streak(route, at, head, 1.6, cyan)
      // then a steady flow, half the traces out and half in
      if (state.flow > 0) {
        const phase = (i * 0.618) % 1
        for (let d = ((state.flowTime * SPEED + phase * GAP) % GAP) - GAP; d < total + TAIL; d += GAP) {
          const outward = i % 2 === 0
          const pos = outward ? d : total - d
          if (outward) streak(route, at, pos, state.flow * 1.2, i % 3 ? cyan : green)
          else streakBack(route, at, pos, state.flow * 1.2, green)
        }
      }
      // pads light as the first wave reaches them, and pulse gently while running
      const reached = state.wave > 0 && head >= total ? 1 : 0
      const glowAmount = reached * state.power * (0.55 + 0.25 * Math.sin(time * 3 + i))
      lit.set([0.24 * glowAmount, 0.94 * glowAmount, glowAmount], i * 3)
    })
    /** A streak running in toward the socket: brightest at its head, nearest the socket. */
    function streakBack(route, at, head, strength, color) {
      for (let k = 0; k < 6; k++) {
        const d0 = head + TAIL * k / 6, d1 = head + TAIL * (k + 1) / 6
        const total = at[at.length - 1]
        if (d0 < 0 || d1 > total) continue
        const [x0, z0] = along(route, at, d0), [x1, z1] = along(route, at, d1)
        piece(x0, z0, x1, z1, strength * (1 - k / 6), strength * (1 - (k + 1) / 6), color)
      }
    }
    pulses.geometry.drawCount = used
    pulses.visible = used > 0
    pulses.geometry.needsUpdate()
    padGlow.geometry.needsUpdate()
  }

  /** Put everything where the story says. @param {number} time */
  const apply = (time) => {
    const e = smooth(state.explode)
    cpu.position.set(0, state.lift, 0)
    cpu.rotation.set(0, state.spin, 0)
    ;[substrate, die, lid].forEach(({ mesh, outline }, i) => {
      mesh.position.y = lerp(STACKED[i], APART[i], e)
      // the outlines glow while it's apart and lining up, and breathe while it runs
      outline.material.opacity = Math.min(1, e * 0.9 + state.guides * 0.5 + state.power * (0.55 + 0.25 * Math.sin(time * 2.5)))
      outline.visible = outline.material.opacity > 0.01
    })
    // the lid turns see-through as the layers part, showing the die
    lid.mesh.material.opacity = lerp(1, 0.28, e)
    die.mesh.material.emissiveIntensity = 0.6 + e * 1.4
    tags.forEach((tag, i) => {
      tag.visible = state.tags > 0.05
      tag.position.set(-2.2, state.lift + lerp(STACKED[i], APART[i], e), 2.2)
    })
    plateHinge(state.plate)
    // up about its hinge at the front: a positive turn about x lifts the back end (-z) above the board
    lever.rotation.set(0.3 * smooth(state.lever), 0, 0)
    guides.material.opacity = state.guides * 0.8
    guides.visible = state.guides > 0
    column.material.opacity = state.guides * 0.05
    column.visible = state.guides > 0
    // the band of light sweeps up and down the guides
    scan.position.y = lerp(height, state.lift + 0.1, 0.5 + 0.5 * Math.sin(time * 2.2))
    scan.material.opacity = state.guides
    scan.visible = state.guides > 0
    // the pins nearest the middle first
    const colors = /** @type {Float32Array} */ (pinGlow.geometry.colors)
    pins.forEach(([x, z], i) => {
      const r = Math.hypot(x, z) / (SOCKET * 1.4)
      const b = Math.max(0, Math.min(1, state.pins * 1.6 - r)) * (state.pins > 0 ? 1 : 0)
      colors.set([0.24 * b, 0.94 * b, b], i * 3)
    })
    pinGlow.geometry.needsUpdate()
    pinGlow.visible = state.pins > 0
    socketEdge.material.opacity = state.power * (0.5 + 0.5 * Math.max(0, 1 - state.wave * 3)) + state.guides * 0.3
    socketEdge.visible = socketEdge.material.opacity > 0.01
    wash.intensity = state.power * (3 + Math.sin(time * 2.5))
    drawPulses(time)
  }
  /** @param {number} open 0 shut - 1 swung up */
  function plateHinge(open) {
    plate.rotation.set(0, 0, smooth(open) * 1.95)
  }

  story.onStep((index, label) => {
    info.textContent = `${index + 1} / ${STEPS.length}  ${label}`
  })
  story.seek(0)
  apply(0)
  if (import.meta.env.DEV) Object.assign(window, { story, view })
  view.frame(new Box3([-6.5, -0.3, -6.5], [6.5, LIFT + 2.6, 6.5]), { padding: 0.02 })

  const controls = {
    'play / pause': () => (story.playing ? story.pause() : story.play()),
    'previous step': () => story.seekStep(Math.max(0, story.step - 1)),
    'next step': () => story.seekStep(Math.min(STEPS.length - 1, story.step + 1)),
  }
  for (const name of Object.keys(controls)) gui.add(controls, name)
  gui.add(story, 'speed', 0.25, 3, 0.25)
  const bloom = /** @type {Required<import('phoria2').BloomOptions>} */ (view.bloom)
  gui.add(bloom, 'strength', 0, 3, 0.05).name('glow').onChange(() => view.invalidate())

  return view.start((dt, t) => {
    story.update(dt)
    apply(t)
  })
}
