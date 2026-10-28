import { AmbientLight, Box3, DirectionalLight, Geometry, Group, Label, Lines, Mesh, PointLight, View, box, curve, cylinder, extrude, lathe } from 'phoria2'

// An inline four-cylinder engine, cut away to show it running. The block, crankcase, head, cam
// cover and sump are one group with a section plane through the cylinders (node.clip), its cut
// faces filled in red as on a real cutaway; the moving parts inside are whole. Pistons, valves,
// plugs and pulleys are turned profiles (lathe); the block with its bores, the crankcase, the
// connecting rods with their bearing eyes, the crank webs, cam lobes and the toothed flywheel are
// flat outlines pushed out (extrude). The cylinders fire 1-3-4-2.

const TAU = Math.PI * 2
const CYLINDERS = [-1.5, -0.5, 0.5, 1.5] // along x, cylinder 1 at the back (-x) to 4 at the front
const BORE = 0.4 // radius
const THROW = 0.4 // crank radius: half the stroke
const ROD = 1.4 // connecting rod, centre to centre
const DECK = 2.25 // top of the block, where the head sits
const HEAD_TOP = 2.85
const CAM = { y: 3.25, z: 0.3, base: 0.12, lift: 0.11 } // camshaft axes, exhaust at +z
const PIN = 0.3 // piston pin above the skirt's bottom
const FLOOR = -1.5
// each cylinder's power stroke starts this far round the crank's 720 degree cycle: 1-3-4-2
const FIRES = [0, 3 * Math.PI, Math.PI, 2 * Math.PI]
// pistons 1 and 4 go up together, 2 and 3 opposite
const PHASES = [0, Math.PI, Math.PI, 0]
const CUT_COLOUR = '#d2382c'
// where two cut parts meet, a hairline apart: faces in one plane would fight to be seen through the cut
const SEAM = 0.003

const ABOUT = {
  block: 'Cylinder block - cast aluminium, bored for the four cylinders',
  crankcase: 'Crankcase - carries the crankshaft in its main bearings',
  head: 'Cylinder head - closes the cylinders; the valves and plugs live here',
  cover: 'Cam cover - keeps the oil in round the camshafts',
  sump: 'Sump - holds the oil',
  piston: 'Piston - pushed down by the burning mixture on the power stroke',
  rod: 'Connecting rod - turns the piston going up and down into the crank going round',
  crank: 'Crankshaft - one throw per cylinder, counterweighted',
  cam: 'Camshaft - turns at half engine speed; each lobe opens a valve',
  valve: 'Valve - intake at the back, exhaust at the front, two of each per cylinder',
  spring: 'Valve spring - closes the valve as the cam lobe passes',
  plug: 'Spark plug - fires each cylinder in turn: 1, 3, 4, 2',
  belt: 'Timing belt - drives the camshafts at half the crank\'s speed',
  pulley: 'Pulley',
  flywheel: 'Flywheel - smooths out the pulses of the four power strokes',
  intake: 'Intake runners - air into the cylinders from the plenum',
}

// --- outlines

/** Points round a circle. @returns {[number, number][]} */
const circle = (r, n = 32, cx = 0, cy = 0, from = 0, to = TAU) =>
  Array.from({ length: n }, (_, i) => {
    const a = from + (to - from) * i / (to - from >= TAU - 1e-9 ? n : n - 1)
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]
  })

const rad = (deg) => deg * Math.PI / 180

// part orientations: extrude() pushes along z and lathe() turns about y
/** An outline drawn in the y-z plane (x of the outline is z), pushed along x. */
const ACROSS = { rotation: [0, -Math.PI / 2, 0] }
/** An outline drawn in plan (x, z), pushed up y. */
const UPRIGHT = { rotation: [Math.PI / 2, 0, 0] }
/** A lathe or cylinder lying along x. */
const ALONG_X = { rotation: [0, 0, -Math.PI / 2] }

// --- materials
const alloy = { color: '#b9bec5', metalness: 0.75, roughness: 0.42 }
const iron = { color: '#6c7077', metalness: 0.7, roughness: 0.55 }
const steel = { color: '#d7dbe0', metalness: 1, roughness: 0.28 }
const darkSteel = { color: '#8a9099', metalness: 1, roughness: 0.38 }
const paint = { color: '#24272b', metalness: 0.2, roughness: 0.6 }

/** A mesh that says what part it is, for the tooltip. */
function part(kind, options) {
  const m = new Mesh({ castShadow: true, receiveShadow: true, ...options })
  m.userData.part = kind
  return m
}

// --- the cut parts: block, crankcase, head, cam cover, sump

function casing() {
  const g = new Group()
  const bottom = 0.9 + SEAM, top = DECK - SEAM
  // the block in plan, bored for the cylinders, from the crankcase up to the deck
  const blockShape = [[-2.1, -0.65], [2.1, -0.65], [2.1, 0.65], [-2.1, 0.65]]
  const bores = CYLINDERS.map((x) => circle(BORE, 48, x, 0))
  g.add(part('block', { geometry: extrude({ shape: blockShape, holes: bores, depth: top - bottom }), position: [0, (top + bottom) / 2, 0], ...UPRIGHT, material: alloy }))
  // the crankcase: a U in section, open at the top under the bores
  const crankcase = [[0.65, 0.9], [0.95, 0.3], [0.95, -0.7], [0.8, -0.9], [-0.8, -0.9], [-0.95, -0.7], [-0.95, 0.3], [-0.65, 0.9],
    [-0.55, 0.9], [-0.85, 0.3], [-0.85, -0.65], [-0.75, -0.8], [0.75, -0.8], [0.85, -0.65], [0.85, 0.3], [0.55, 0.9]]
  g.add(part('crankcase', { geometry: extrude({ shape: crankcase, depth: 4.2 }), ...ACROSS, material: iron }))
  // its end walls, with a hole for the crankshaft
  const end = [[0.65, 0.9], [0.95, 0.3], [0.95, -0.7], [0.8, -0.9], [-0.8, -0.9], [-0.95, -0.7], [-0.95, 0.3], [-0.65, 0.9]]
  for (const x of [-2.15 - SEAM, 2.15 + SEAM]) {
    g.add(part('crankcase', { geometry: extrude({ shape: end, holes: [circle(0.26, 32)], depth: 0.1 }), position: [x, 0, 0], ...ACROSS, material: iron }))
  }
  // the head, and the cam cover over it: an arch in section, round the camshafts
  g.add(part('head', { geometry: box({ width: 4.3, height: HEAD_TOP - DECK, depth: 1.3 }), position: [0, (DECK + HEAD_TOP) / 2, 0], material: alloy }))
  const arch = [[0.72, 0], ...circle(0.72, 24, 0, 0.3, 0, Math.PI).map(([z, y]) => [z, y + 0.05]), [-0.72, 0], [-0.62, 0],
    ...circle(0.62, 24, 0, 0.3, Math.PI, 0).map(([z, y]) => [z, y + 0.05]), [0.62, 0]]
  g.add(part('cover', { geometry: extrude({ shape: arch, depth: 4.2 }), position: [0, HEAD_TOP + SEAM, 0], ...ACROSS, material: paint }))
  // the sump, narrowing to its floor
  const sump = [[0.82, 0], [0.7, -0.6], [-0.7, -0.6], [-0.82, 0], [-0.74, 0], [-0.63, -0.52], [0.63, -0.52], [0.74, 0]]
  g.add(part('sump', { geometry: extrude({ shape: sump, depth: 4.0 }), position: [0, -0.9 - SEAM, 0], ...ACROSS, material: iron }))
  for (const x of [-2.04 - SEAM, 2.04 + SEAM]) {
    g.add(part('sump', { geometry: extrude({ shape: [[0.82, 0], [0.7, -0.6], [-0.7, -0.6], [-0.82, 0]], depth: 0.08 }), position: [x, -0.9 - SEAM, 0], ...ACROSS, material: iron }))
  }
  return g
}

// --- the moving parts

/** A piston: hollow skirt, three ring grooves, a flat crown; with its wrist pin. Origin at the pin. */
function piston() {
  const g = new Group()
  const groove = (y) => [[0.39, y], [0.37, y], [0.37, y + 0.035], [0.39, y + 0.035]]
  const profile = [[0, 0.55], [0.33, 0.55], [0.33, 0], [0.39, 0], [0.39, 0.45], ...groove(0.47), ...groove(0.54), ...groove(0.61), [0.39, 0.67], [0.375, 0.7], [0, 0.7]]
  g.add(part('piston', { geometry: lathe({ points: profile, segments: 48 }), position: [0, -PIN, 0], material: { color: '#e3e6ea', metalness: 0.9, roughness: 0.3 } }))
  g.add(part('piston', { geometry: cylinder({ radius: 0.085, height: 0.64, segments: 20 }), ...ALONG_X, material: steel }))
  return g
}

/** A connecting rod: big eye round the crank pin at the origin, small eye at the piston pin, up y. */
function rod() {
  const outline = [...circle(0.15, 16, 0, ROD, rad(-25), rad(205)), ...circle(0.3, 24, 0, 0, rad(155), rad(385))]
  const holes = [circle(0.195, 32), circle(0.09, 20, 0, ROD)]
  return part('rod', { geometry: extrude({ shape: outline, holes, depth: 0.16 }), ...ACROSS, material: darkSteel })
}

/** The crankshaft, along x: main journals, a throw per cylinder, counterweighted webs, and the snouts. */
function crankshaft() {
  const g = new Group()
  // a web: round the crank pin at the top, a counterweight under the main journal
  const web = [...circle(0.27, 16, 0, THROW, 0, Math.PI), ...circle(0.64, 28, 0, 0, rad(205), rad(335))]
  for (const x of [-2, -1, 0, 1, 2]) g.add(part('crank', { geometry: cylinder({ radius: 0.24, height: 0.36, segments: 32 }), position: [x, 0, 0], ...ALONG_X, material: steel }))
  CYLINDERS.forEach((x, i) => {
    const throwAt = g.add(new Group({ rotation: [PHASES[i], 0, 0] }))
    for (const side of [-1, 1]) throwAt.add(part('crank', { geometry: extrude({ shape: web, depth: 0.12 }), position: [x + side * 0.22, 0, 0], ...ACROSS, material: darkSteel }))
    throwAt.add(part('crank', { geometry: cylinder({ radius: 0.19, height: 0.34, segments: 32 }), position: [x, THROW, 0], ...ALONG_X, material: steel }))
  })
  for (const x of [-2.3, 2.3]) g.add(part('crank', { geometry: cylinder({ radius: 0.2, height: 0.4, segments: 24 }), position: [x, 0, 0], ...ALONG_X, material: steel }))
  return g
}

/** A cam lobe's outline: a base circle with a nose up +y. */
function lobeOutline() {
  return Array.from({ length: 72 }, (_, i) => {
    const a = i / 72 * TAU, off = Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2))
    const nose = Math.abs(off) < rad(70) ? Math.cos(off / rad(70) * Math.PI / 2) ** 2 : 0
    const r = CAM.base + CAM.lift * nose
    return /** @type {[number, number]} */ ([Math.cos(a) * r, Math.sin(a) * r])
  })
}

/** A camshaft along x at its axis, with a lobe over each valve; lobes turn on their own. */
function camshaft(z) {
  const g = new Group({ position: [0, CAM.y, z] })
  g.add(part('cam', { geometry: cylinder({ radius: 0.07, height: 4.4, segments: 20 }), position: [0.1, 0, 0], ...ALONG_X, material: steel }))
  const geometry = extrude({ shape: lobeOutline(), depth: 0.13 })
  const lobes = []
  for (const x of CYLINDERS) {
    for (const dx of [-0.17, 0.17]) {
      const turn = g.add(new Group({ position: [x + dx, 0, 0] }))
      turn.add(part('cam', { geometry, ...ACROSS, material: steel }))
      lobes.push(turn)
    }
  }
  return { node: g, lobes }
}

/** A poppet valve: a tulip head and a long stem, standing on its face. With its spring and bucket. */
function valve(x, z) {
  const g = new Group({ position: [x, 0, z] })
  const profile = [[0, 0], [0.155, 0], [0.155, 0.025], [0.05, 0.11], [0.034, 0.16], [0.034, 0.8], [0, 0.8]]
  const stem = g.add(part('valve', { geometry: lathe({ points: profile, segments: 32 }), material: steel }))
  const bucket = g.add(part('valve', { geometry: cylinder({ radius: 0.12, height: 0.12, segments: 24 }), material: darkSteel }))
  // the spring: a helix round the stem, squashed as the valve opens
  const coil = [], turns = 6
  for (let i = 0; i <= turns * 16; i++) {
    const a = i / 16 * TAU
    coil.push([Math.cos(a) * 0.1, i / (turns * 16), Math.sin(a) * 0.1])
  }
  const spring = g.add(part('spring', { geometry: curve(coil).tube({ radius: 0.018, segments: turns * 24, sides: 6 }), material: { color: '#e2b23a', metalness: 0.6, roughness: 0.35 } }))
  return { node: g, stem, bucket, spring }
}

/** A spark plug: ceramic body, hex, threads into the head; tip at the origin, up y. */
function plug() {
  const g = new Group()
  const profile = [[0, 0], [0.05, 0], [0.05, 0.25], [0.11, 0.25], [0.11, 0.37], [0.075, 0.4], [0.075, 0.95], [0.04, 1.0], [0.03, 1.12], [0, 1.12]]
  g.add(part('plug', { geometry: lathe({ points: profile, segments: 24 }), material: { color: '#f1efe8', roughness: 0.35 } }))
  g.add(part('plug', { geometry: cylinder({ radius: 0.13, height: 0.1, segments: 6 }), position: [0, 0.3, 0], material: steel }))
  return g
}

/** A pulley for the timing belt, turning about x: a flanged rim, its face cut with holes so it can be seen to turn. */
function pulley(radius, width = 0.16) {
  const g = new Group()
  const profile = [[radius - 0.04, -width / 2], [radius + 0.03, -width / 2], [radius + 0.03, -width / 2 + 0.02], [radius, -width / 2 + 0.03],
    [radius, width / 2 - 0.03], [radius + 0.03, width / 2 - 0.02], [radius + 0.03, width / 2], [radius - 0.04, width / 2], [radius - 0.04, -width / 2]]
  g.add(part('pulley', { geometry: lathe({ points: profile, segments: 48 }), ...ALONG_X, material: alloy }))
  const holes = Array.from({ length: 5 }, (_, i) => circle(radius * 0.22, 16, Math.cos(i / 5 * TAU) * radius * 0.55, Math.sin(i / 5 * TAU) * radius * 0.55))
  g.add(part('pulley', { geometry: extrude({ shape: circle(radius - 0.03, 48), holes: [circle(0.06, 16), ...holes], depth: 0.05 }), ...ACROSS, material: alloy }))
  return g
}

/** The flywheel: a toothed ring gear with bolt and lightening holes, in the y-z plane. */
function flywheel() {
  const teeth = 72, outline = []
  for (let i = 0; i < teeth * 4; i++) {
    const a = i / (teeth * 4) * TAU
    outline.push([Math.cos(a) * (i % 4 < 2 ? 1.0 : 0.95), Math.sin(a) * (i % 4 < 2 ? 1.0 : 0.95)])
  }
  const holes = [circle(0.12, 24), ...Array.from({ length: 6 }, (_, i) => circle(0.045, 12, Math.cos(i / 6 * TAU) * 0.26, Math.sin(i / 6 * TAU) * 0.26)),
    ...Array.from({ length: 4 }, (_, i) => circle(0.15, 24, Math.cos((i + 0.5) / 4 * TAU) * 0.6, Math.sin((i + 0.5) / 4 * TAU) * 0.6))]
  return part('flywheel', { geometry: extrude({ shape: outline, holes, depth: 0.1 }), ...ACROSS, material: darkSteel })
}

/** The timing belt, round the crank pulley and both cam pulleys, at the front - drawn in the y-z plane at x. */
function belt(x) {
  const crank = 0.16, cams = 0.31
  const loop = [[0, -crank], [crank * 0.8, -crank * 0.6], [crank, 0], [CAM.z + cams, CAM.y], [CAM.z + cams * 0.7, CAM.y + cams * 0.7], [CAM.z, CAM.y + cams],
    [0, CAM.y + cams * 0.75], [-CAM.z, CAM.y + cams], [-CAM.z - cams * 0.7, CAM.y + cams * 0.7], [-CAM.z - cams, CAM.y], [-crank, 0], [-crank * 0.8, -crank * 0.6]]
  return part('belt', { geometry: curve(loop.map(([z, y]) => [x, y, z]), { closed: true, tension: 0.6 }).tube({ radius: 0.035, segments: 200, sides: 6 }), material: { color: '#1a1b1d', roughness: 0.8 } })
}

/** Intake runners from the back of the head down to a plenum. */
function intake() {
  const g = new Group()
  for (const x of CYLINDERS) {
    g.add(part('intake', { geometry: curve([[x, 2.55, -0.62], [x, 2.62, -1.0], [x * 0.9, 2.35, -1.38], [x * 0.85, 1.95, -1.52]]).tube({ radius: 0.11, segments: 32, sides: 16 }), material: alloy }))
  }
  g.add(part('intake', { geometry: lathe({ points: [[0, -2.0], [0.32, -2.0], [0.34, -1.9], [0.34, 1.9], [0.32, 2.0], [0, 2.0]], segments: 32 }), position: [0, 1.75, -1.55], ...ALONG_X, material: alloy }))
  return g
}

// --- the cycle

/** How far a valve is open (0 - 1) at a point in its cylinder's 720 degree cycle (radians). */
function lift(cycle, opens, closes) {
  const c = ((cycle % (2 * TAU)) + 2 * TAU) % (2 * TAU), t = (c - opens) / (closes - opens)
  return t > 0 && t < 1 ? Math.sin(Math.PI * t) ** 2 : 0
}
const EXHAUST = [rad(140), rad(380)], INTAKE = [rad(340), rad(580)]

export default function run({ canvas, gui, info }) {
  const view = new View({
    canvas, background: '#16181b', bloom: { strength: 0.9, radius: 0.5, threshold: 0.85 },
    orbit: { minDistance: 5, maxDistance: 22, maxPitch: 1.4 },
    camera: { position: [6.5, 4.6, 8.4], target: [0, 0.9, 0], fov: 38 }, highlight: '#ffd36b',
    tooltip: (hit) => ABOUT[hit?.node?.userData.part] ?? null,
  })
  const { scene } = view
  scene.environment = 'studio'
  scene.environmentIntensity = 0.7
  scene.add(new AmbientLight({ intensity: 0.15 }))
  scene.add(new DirectionalLight({ direction: [-0.35, -1, -0.55], intensity: 2.2, castShadow: true }))
  scene.add(new DirectionalLight({ direction: [0.8, -0.3, 0.4], intensity: 0.5, color: '#9fb6ff' }))
  // a glow in whichever cylinder is firing
  const flashLight = scene.add(new PointLight({ color: '#ff8a2a', intensity: 0, range: 3 }))

  // a turntable plinth for it to sit on
  scene.add(new Mesh({ geometry: cylinder({ radius: 4.2, height: 0.12, segments: 96 }), position: [0, FLOOR - 0.06, 0], receiveShadow: true, pickable: false, material: { color: '#2a2d32', roughness: 0.7, metalness: 0.2 } }))

  // the casing, cut through the cylinders' axes; the cut sweeps in at the start
  const cutaway = scene.add(casing())
  cutaway.clip = { normal: [0, 0, 1], offset: 1.2, cap: CUT_COLOUR }
  // the section plane itself, as a faint outline while it moves
  const frame = [[-2.4, -1.6], [2.4, -1.6], [2.4, 3.8], [-2.4, 3.8]]
  const planeOutline = scene.add(new Lines({
    geometry: new Geometry({ positions: frame.flatMap(([x, y], i) => [x, y, 0, frame[(i + 1) % 4][0], frame[(i + 1) % 4][1], 0]) }),
    material: { color: CUT_COLOUR, opacity: 0, width: 2 }, pickable: false,
  }))

  const crank = scene.add(crankshaft())
  crank.add(flywheel()).position.x = -2.5
  crank.add(pulley(0.14)).position.x = 2.45
  const pistons = CYLINDERS.map((x) => scene.add(new Group({ position: [x, 0, 0], children: [piston()] })))
  const rods = CYLINDERS.map((x) => scene.add(new Group({ position: [x, 0, 0], children: [rod()] })))
  const cams = [camshaft(-CAM.z), camshaft(CAM.z)]
  // the cam pulleys, twice the crank pulley's size, so the cams turn at half its speed
  const camPulleys = cams.map((c) => {
    scene.add(c.node)
    const p = c.node.add(pulley(0.28))
    p.position.x = 2.45
    return p
  })
  scene.add(belt(2.45))
  // two valves a side per cylinder: intake at the back, exhaust at the front
  const valves = CYLINDERS.flatMap((x, i) => [-0.17, 0.17].flatMap((dx) => [
    { ...valve(x + dx, -CAM.z), cylinder: i, exhaust: false },
    { ...valve(x + dx, CAM.z), cylinder: i, exhaust: true },
  ]))
  for (const v of valves) scene.add(v.node)
  CYLINDERS.forEach((x) => scene.add(new Group({ position: [x, DECK - 0.04, 0], children: [plug()] })))
  scene.add(intake())
  // the flame in each combustion chamber as it fires
  const flames = CYLINDERS.map((x) => scene.add(new Mesh({
    geometry: cylinder({ radius: BORE - 0.01, height: 1, segments: 40 }), position: [x, DECK, 0], pickable: false,
    material: { color: '#ff7a1e', emissive: '#ff6a10', emissiveIntensity: 3, blending: 'additive', opacity: 0, depthWrite: false },
  })))

  // callouts down each side: on the parts that slide, at fixed points by the ones that spin
  const callout = (host, text, at, edge) => host.add(new Label({ text, position: at, edge, leader: true, className: 'engine-callout', overlap: 'dim' }))
  const labels = [
    callout(scene, 'Exhaust camshaft', [1.67, CAM.y + CAM.base, CAM.z], 'right'),
    callout(valves[7].spring, 'Valve spring', [0.1, 0.6, 0], 'right'),
    callout(valves[13].stem, 'Exhaust valve', [0.155, 0.02, 0], 'right'),
    callout(scene, 'Timing belt', [2.45, 1.6, 0.38], 'right'),
    callout(rods[2], 'Connecting rod', [0.08, 0.7, 0], 'right'),
    callout(cutaway, 'Cylinder block', [1.0, 1.4, 0], 'right'),
    callout(scene, 'Crankshaft', [2, 0, 0.24], 'right'),
    callout(scene, 'Intake camshaft', [-1.33, CAM.y + CAM.base, -CAM.z], 'left'),
    callout(scene, 'Spark plug', [-1.5, 3.3, 0.04], 'left'),
    callout(pistons[1], 'Piston', [0, 0.4, 0.39], 'left'),
    callout(scene, 'Flywheel', [-2.5, 0.98, 0.2], 'left'),
    callout(cutaway, 'Sump', [-1.2, -1.3, 0], 'left'),
  ]

  const state = { rpm: 40, cut: 0, cutaway: true, labels: true, time: 0, angle: 0, reveal: 0 }
  gui.add(state, 'rpm', 0, 240, 1).name('speed (rpm)')
  gui.add(state, 'cut', -0.6, 1.2, 0.01).name('section plane').onChange(() => { state.reveal = 1 })
  gui.add(state, 'cutaway').name('cut away')
  gui.add(state, 'labels')
  info.textContent = 'Inline four, cut away - hover a part'
  if (import.meta.env.DEV) Object.assign(window, { view, state, cutaway })
  // the engine itself, flywheel to timing belt, not the whole plinth
  view.frame(new Box3([-2.7, -1.5, -1.7], [2.7, 3.9, 1.0]), { padding: 0.04 })

  return view.start((dt) => {
    state.time += dt
    state.angle += state.rpm / 60 * TAU * dt
    const theta = state.angle
    // the cut sweeps in from the front once, then follows the slider
    const sweep = state.reveal >= 1 ? 1 : Math.min(1, Math.max(0, (state.time - 0.8) / 2.2))
    if (sweep >= 1) state.reveal = 1
    const eased = sweep * sweep * (3 - 2 * sweep)
    const offset = state.cutaway ? 1.2 + (state.cut - 1.2) * eased : 1.2
    cutaway.clip.offset = offset
    planeOutline.position.z = offset
    planeOutline.material.opacity = state.cutaway ? 0.8 * Math.sin(Math.PI * Math.min(1, sweep)) : 0
    planeOutline.visible = planeOutline.material.opacity > 0.01

    crank.rotation.set(theta, 0, 0)
    let brightest = 0
    CYLINDERS.forEach((x, i) => {
      const a = theta + PHASES[i], pinY = THROW * Math.cos(a) + Math.sqrt(ROD ** 2 - (THROW * Math.sin(a)) ** 2)
      pistons[i].position.y = pinY
      rods[i].position.set(x, THROW * Math.cos(a), THROW * Math.sin(a))
      rods[i].rotation.set(Math.atan2(-THROW * Math.sin(a), pinY - THROW * Math.cos(a)), 0, 0)
      // the flame: bright as it fires at the top, fading as the piston goes down
      const cycle = (((theta - FIRES[i]) % (2 * TAU)) + 2 * TAU) % (2 * TAU)
      const burn = cycle < rad(70) ? (1 - cycle / rad(70)) ** 2 : 0
      const crown = pinY - PIN + 0.7
      const flame = flames[i]
      flame.position.y = (crown + DECK) / 2
      flame.scale.set(1, Math.max(0.01, DECK - crown - 0.01), 1)
      flame.material.opacity = burn * 0.85
      flame.visible = burn > 0.01
      if (burn > brightest) {
        brightest = burn
        flashLight.position.set(x, DECK - 0.1, 0.6)
      }
    })
    flashLight.intensity = brightest * 6
    // the valves follow their cam lobes, which turn at half speed
    valves.forEach((v, k) => {
      const cycle = theta - FIRES[v.cylinder], [opens, closes] = v.exhaust ? EXHAUST : INTAKE
      // each cylinder's pair of valves a side, and the lobe over each
      const open = lift(cycle, opens, closes) * CAM.lift
      v.stem.position.y = DECK - 0.04 - open
      v.bucket.position.y = CAM.y - CAM.base - 0.06 - open
      // the spring from the head up to under the bucket
      const top = CAM.y - CAM.base - 0.12 - open
      v.spring.position.y = HEAD_TOP
      v.spring.scale.set(1, top - HEAD_TOP, 1)
      // the lobe points straight down at the valve when it is open widest
      const lobe = cams[v.exhaust ? 1 : 0].lobes[v.cylinder * 2 + (k % 4 < 2 ? 0 : 1)]
      lobe.rotation.set(Math.PI + (cycle - (opens + closes) / 2) / 2, 0, 0)
    })
    for (const p of camPulleys) p.rotation.set(theta / 2, 0, 0)
    for (const label of labels) label.visible = state.labels
  })
}
