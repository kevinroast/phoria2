import { DirectionalLight, Geometry, Group, HemisphereLight, InstancedMesh, Label, Mesh, Vec3, View, curve, cylinder, icosphere, sphere } from 'phoria2'
import { follow } from 'phoria2/motion'
import { random } from './kit.js'

// A biology poster: an animal cell and a plant cell side by side, each sliced open to show what's
// inside, every part named. Nothing plays in sequence - it is all there at once - but the cells are
// alive: membranes wobble, organelles drift and turn, the nucleus pulses, and in the plant cell the
// chloroplasts stream round the vacuole, as they really do. Two views on one page, each with its own
// callouts down its sides; hover a part to light it up and read what it does.

const TAU = Math.PI * 2
const lerp = (a, b, t) => a + (b - a) * t

/** What each part does, shown on hover. */
const ABOUT = {
  membrane: 'Cell membrane - a thin skin of fat that decides what comes in and out',
  wall: 'Cell wall - rigid cellulose round the membrane, holding the plant up',
  cytoplasm: 'Cytoplasm - the jelly everything else floats in',
  nucleus: 'Nucleus - holds the DNA, and runs the cell',
  nucleolus: 'Nucleolus - inside the nucleus, where ribosomes are made',
  er: 'Endoplasmic reticulum - folded membranes where proteins and fats are made',
  mitochondria: 'Mitochondria - burn sugar to release energy',
  golgi: 'Golgi apparatus - packs proteins up to send them where they are needed',
  vesicles: 'Golgi vesicles - little bubbles carrying the packed proteins away',
  ribosome: 'Ribosomes - build proteins, following instructions from the nucleus',
  lysosome: 'Lysosomes - break down waste and worn-out parts',
  peroxisome: 'Peroxisomes - break down fats and clear away toxins',
  centrioles: 'Centrioles - organise the cell\'s skeleton when it divides',
  microtubule: 'Microtubules - hollow rods that give the cell its shape and tracks to move along',
  vacuole: 'Vacuole - stores water, food and waste',
  pinocytosis: 'Pinocytotic vesicle - the membrane folding in to drink in fluid from outside',
  chloroplast: 'Chloroplasts - catch sunlight and make sugar from it (photosynthesis)',
  amyloplast: 'Amyloplast - stores starch',
  druse: 'Druse crystal - a spiky ball of calcium oxalate, kept in the vacuole',
  raphide: 'Raphide crystals - needles of calcium oxalate, to put off things that would eat the plant',
}

// --- shapes

/**
 * A blob: a sphere pushed into an outline (rx, rz) and height, squashed below - for organelles and
 * the vacuole.
 * @param {(a: number) => number} radius the outline's radius at each angle, 1 is round
 * @param {number} rx @param {number} rz @param {number} up @param {number} [down]
 */
function blob(radius, rx, rz, up, down = up) {
  const g = sphere({ radius: 1, segments: 40, rings: 20 })
  const p = g.positions
  for (let i = 0; i < p.length; i += 3) {
    const a = Math.atan2(p[i + 2], p[i]), r = radius(a)
    p[i] *= rx * r
    p[i + 2] *= rz * r
    p[i + 1] *= p[i + 1] > 0 ? up : down
  }
  return g.computeNormals()
}

/** Make a geometry's faces point the way the first vertex's normal should: flip the winding if not. */
function windTo(g, sign) {
  g.computeNormals()
  const n = /** @type {Float32Array} */ (g.normals)
  if (Math.sign(n[1]) !== sign) {
    const ix = /** @type {Uint16Array | Uint32Array} */ (g.indices)
    for (let i = 0; i < ix.length; i += 3) [ix[i + 1], ix[i + 2]] = [ix[i + 2], ix[i + 1]]
    g.computeNormals()
  }
  return g
}

/**
 * A cell sliced across: a flat cut face over a rounded underside, both following an outline that
 * can change each frame. Returns the meshes' geometry and a function to reshape them.
 * @param {(a: number, t: number) => [number, number]} outline the edge at angle a, time t: [x, z]
 * @param {number} depth how far the underside bulges down
 */
function slice(outline, depth) {
  const RINGS = 14, AROUND = 120
  const grid = (rows) => {
    const indices = []
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < AROUND; j++) {
        const a = i * AROUND + j, b = i * AROUND + (j + 1) % AROUND, c = a + AROUND, d = b + AROUND
        indices.push(a, c, d, a, d, b)
      }
    }
    return indices
  }
  const count = (RINGS + 1) * AROUND * 3
  const cap = new Geometry({ positions: new Float32Array(count), indices: grid(RINGS) })
  const belly = new Geometry({ positions: new Float32Array(count), indices: grid(RINGS) })
  const shape = (t) => {
    for (let j = 0; j < AROUND; j++) {
      const [x, z] = outline(j / AROUND * TAU, t)
      for (let i = 0; i <= RINGS; i++) {
        const k = (i * AROUND + j) * 3
        // the cut face: rings out to the edge
        const r = i / RINGS
        cap.positions[k] = x * r
        cap.positions[k + 1] = 0
        cap.positions[k + 2] = z * r
        // the underside: from the edge down and in to the bottom
        const phi = i / RINGS * Math.PI / 2, c = Math.cos(phi)
        belly.positions[k] = x * c
        belly.positions[k + 1] = -depth * Math.sin(phi)
        belly.positions[k + 2] = z * c
      }
    }
    belly.computeNormals()
    cap.needsUpdate()
  }
  shape(0)
  windTo(cap, 1)
  // the underside's last ring is its bottom: its normals point down
  belly.computeNormals()
  const n = /** @type {Float32Array} */ (belly.normals)
  if (n[(RINGS * AROUND) * 3 + 1] > 0) {
    const ix = /** @type {Uint16Array | Uint32Array} */ (belly.indices)
    for (let i = 0; i < ix.length; i += 3) [ix[i + 1], ix[i + 2]] = [ix[i + 2], ix[i + 1]]
    belly.computeNormals()
  }
  return { cap, belly, shape }
}

/** A tube round an outline, at the cut face - the membrane or the wall - rebuilt as it wobbles. */
function rim(outline, radius, lift) {
  const N = 72
  const make = (t) => curve(Array.from({ length: N }, (_, i) => {
    const [x, z] = outline(i / N * TAU, t)
    return [x, lift, z]
  }), { closed: true }).tube({ radius, segments: 180, sides: 10 })
  const geometry = make(0)
  return {
    geometry,
    shape(t) {
      const next = make(t)
      const normals = /** @type {Float32Array} */ (geometry.normals)
      geometry.positions.set(next.positions)
      normals.set(/** @type {Float32Array} */ (next.normals))
      geometry.needsUpdate()
    },
  }
}

// --- organelles: each a Group, built along x (long axis) lying in the cut face

const shiny = (color, extra = {}) => ({ color, roughness: 0.35, ...extra })

/** A mitochondrion: a capsule with a wavy fold (its cristae) along the top. */
function mitochondrion(color = '#e0607e', fold = '#ffd2dc') {
  const g = new Group()
  g.add(new Mesh({ geometry: blob(() => 1, 0.55, 0.27, 0.22), material: shiny(color) }))
  const wave = Array.from({ length: 13 }, (_, i) => [-0.42 + i * 0.07, 0.2, (i % 2 ? 1 : -1) * 0.14])
  g.add(new Mesh({ geometry: curve(wave).tube({ radius: 0.025, segments: 80, sides: 6 }), material: shiny(fold) }))
  return g
}

/** A chloroplast: a green capsule with stacks of discs (grana) on top. */
function chloroplast() {
  const g = new Group()
  g.add(new Mesh({ geometry: blob(() => 1, 0.42, 0.26, 0.18), material: shiny('#52a447') }))
  const disc = cylinder({ radius: 0.07, height: 0.035, segments: 14 })
  const stacks = []
  for (const x of [-0.24, -0.08, 0.08, 0.24]) {
    for (let k = 0; k < 3; k++) stacks.push({ position: [x, 0.13 + k * 0.045, ((x * 7) % 2 > 1 ? 0.04 : -0.04)] })
  }
  g.add(new InstancedMesh({ geometry: disc, instances: stacks, material: shiny('#2d6e2c') }))
  return g
}

/** The Golgi apparatus: a stack of curved flattened sacs, shortest on top. */
function golgi() {
  const g = new Group()
  for (let k = 0; k < 5; k++) {
    const span = 0.9 - k * 0.12, bend = 0.22
    const arc = Array.from({ length: 9 }, (_, i) => {
      const u = i / 8 - 0.5
      return [u * span, 0.05 + k * 0.07, -bend * Math.cos(u * Math.PI) + k * 0.06]
    })
    g.add(new Mesh({ geometry: curve(arc).tube({ radius: 0.045, segments: 30, sides: 8 }), material: shiny(k % 2 ? '#f6a54a' : '#f08a2e') }))
  }
  return g
}

/** Small spheres - vesicles, lysosomes, peroxisomes - at points in a group. */
function beads(color, at, radius) {
  return new InstancedMesh({
    geometry: icosphere({ radius, detail: 2 }), material: shiny(color),
    instances: at.map((position) => ({ position })),
  })
}

/** A centriole pair: two short striped barrels at right angles. */
function centrioles() {
  const g = new Group()
  /** @type {[[number, number, number], [number, number, number]][]} */
  const pair = [[[0, 0, Math.PI / 2], [0, 0.1, 0]], [[Math.PI / 2, 0, 0], [0.3, 0.1, 0.05]]]
  for (const [rot, at] of pair) {
    const barrel = g.add(new Group({ position: at, rotation: rot }))
    barrel.add(new Mesh({ geometry: cylinder({ radius: 0.09, height: 0.32, segments: 16 }), material: shiny('#f2cf3c') }))
    for (const y of [-0.08, 0, 0.08]) barrel.add(new Mesh({ geometry: cylinder({ radius: 0.095, height: 0.018, segments: 16 }), position: [0, y, 0], material: shiny('#d8a51e') }))
  }
  return g
}

/** The nucleus, rising out of the cut face, its nucleolus a dark dome on top and pores round it. */
function nucleus(bright = '#c53b32') {
  const g = new Group()
  // a deep red nucleus, its nucleolus bright on top
  const body = g.add(new Mesh({ geometry: blob(() => 1, 0.82, 0.78, 0.42, 0.5), material: shiny('#7d1f20', { roughness: 0.3 }) }))
  body.userData.kind = 'nucleus'
  const nucleolus = g.add(new Mesh({ geometry: blob(() => 1, 0.28, 0.27, 0.16), position: [0.12, 0.33, -0.05], material: shiny(bright) }))
  nucleolus.userData.kind = 'nucleolus'
  const pores = []
  for (let i = 0; i < 18; i++) {
    const a = i / 18 * TAU
    pores.push([Math.cos(a) * 0.74, 0.17, Math.sin(a) * 0.7])
  }
  // pores, light enough to show on the dark nucleus
  g.add(beads('#c4554a', pores, 0.035)).userData.kind = 'nucleus'
  return { group: g, nucleolus }
}

/** Rough endoplasmic reticulum: folded bands round the nucleus, studded with ribosomes. */
function reticulum(radii, color = '#6c4fb3') {
  const g = new Group()
  const studs = []
  radii.forEach((r, k) => {
    // arcs with gaps, each band a little further out
    for (let s = 0; s < 3; s++) {
      const a0 = s * TAU / 3 + k * 0.5 + 0.25, a1 = a0 + TAU / 3 - 0.55
      const arc = Array.from({ length: 12 }, (_, i) => {
        const a = lerp(a0, a1, i / 11), wob = 1 + 0.05 * Math.sin(a * 5 + k)
        return [Math.cos(a) * r * wob, 0.06, Math.sin(a) * r * 0.95 * wob]
      })
      g.add(new Mesh({ geometry: curve(arc).tube({ radius: 0.05, segments: 40, sides: 8 }), material: shiny(color) }))
      for (let i = 1; i < 11; i += 2) {
        const a = lerp(a0, a1, i / 11)
        studs.push([Math.cos(a) * (r + 0.07), 0.08, Math.sin(a) * (r + 0.07) * 0.95])
      }
    }
  })
  g.add(beads('#3d2a6e', studs, 0.022))
  return g
}

/** A druse crystal: a ball of spikes. */
function druse() {
  const g = icosphere({ radius: 0.16, detail: 1 })
  const p = g.positions
  for (let i = 0; i < p.length; i += 3) {
    const k = 1 + 0.6 * ((i / 3) % 3 === 0 ? 1 : 0)
    p[i] *= k
    p[i + 1] *= k
    p[i + 2] *= k
  }
  return new Mesh({ geometry: g.computeNormals({ flat: true }), material: { color: '#c9d4da', roughness: 0.2, metalness: 0.3, flatShading: true } })
}

// --- the cells

/**
 * Build a cell into a scene: its slab, rims, organelles, the drift that keeps it alive, and its
 * callouts. Returns the per-frame update.
 * @param {import('phoria2').Scene} scene
 * @param {'animal' | 'plant'} kind
 */
function buildCell(scene, kind) {
  const rand = random(kind === 'animal' ? 3 : 8)
  // the plant cell stands upright, as tall as it is long, like the poster's
  const cell = scene.add(new Group({ rotation: [0, kind === 'plant' ? Math.PI / 2 : 0, 0] }))
  /** @type {{ node: import('phoria2').Node, base: number[], amp: number, speed: number, phase: number, spin: number, bob?: number }[]} */
  const drifting = []
  /** Put an organelle in the cell, drifting a little about where it's put. */
  // (a group of separate parts - beads - is placed with turn: 0, spin: 0, so its outer ones stay inside)
  const place = (node, at, what, { amp = 0.06, spin = 0.15, turn = rand() * TAU } = {}) => {
    node.position.copy(at)
    node.rotation.y = turn
    node.userData.kind = node.userData.kind ?? what
    node.traverse((n) => { n.userData.kind ??= what })
    cell.add(node)
    drifting.push({ node, base: [...at], amp, speed: 0.25 + rand() * 0.35, phase: rand() * TAU, spin: (rand() - 0.5) * spin })
    return node
  }

  // the outline: round and soft for the animal, a stiff rounded box for the plant
  const animal = kind === 'animal'
  /** @type {(a: number, t: number) => [number, number]} */
  const outline = animal
    ? (a, t) => {
      // a dimple at the top, where the membrane folds in to drink (pinocytosis)
      const dimple = 0.09 * Math.exp(-(((a - 4.55 + TAU) % TAU - Math.PI) ** 2) / 0.012)
      const r = 1 + 0.035 * Math.sin(3 * a + 0.7 * t) + 0.025 * Math.sin(5 * a - 0.5 * t + 1) - dimple
      return [Math.cos(a) * 3 * r, Math.sin(a) * 2.75 * r]
    }
    : (a, t) => {
      const n = 5, ca = Math.abs(Math.cos(a)) / 3, sa = Math.abs(Math.sin(a)) / 2.15
      const r = (ca ** n + sa ** n) ** (-1 / n) * (1 + 0.01 * Math.sin(2 * a + 0.6 * t))
      return [Math.cos(a) * r, Math.sin(a) * r]
    }
  const cytoplasm = animal ? '#f6cdd4' : '#d9eda0'
  const body = slice(outline, animal ? 0.9 : 0.7)
  const jelly = { color: cytoplasm, roughness: 0.3, opacity: 0.88 }
  cell.add(new Mesh({ geometry: body.cap, material: jelly })).userData.kind = 'cytoplasm'
  cell.add(new Mesh({ geometry: body.belly, material: { ...jelly, opacity: 0.94 } })).userData.kind = 'cytoplasm'
  const rims = []
  if (animal) {
    rims.push(rim(outline, 0.1, 0.02))
    cell.add(new Mesh({ geometry: rims[0].geometry, material: shiny('#d1567a') })).userData.kind = 'membrane'
  } else {
    // a thick wall outside a thin membrane, and stubs of the neighbours' walls at the corners
    /** @type {(a: number, t: number) => [number, number]} */
    const inset = (a, t) => {
      const [x, z] = outline(a, t)
      return [x * 0.955, z * 0.955]
    }
    rims.push(rim(outline, 0.2, 0.05), rim(inset, 0.06, 0.03))
    cell.add(new Mesh({ geometry: rims[0].geometry, material: shiny('#5b8a30', { roughness: 0.55 }) })).userData.kind = 'wall'
    cell.add(new Mesh({ geometry: rims[1].geometry, material: shiny('#f0f2a0') })).userData.kind = 'membrane'
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const [x, z] = outline(Math.atan2(sz * 2.15, sx * 3), 0)
      const stub = cell.add(new Mesh({ geometry: cylinder({ radius: 0.16, height: 0.9, segments: 10 }), position: [x + sx * 0.32, 0.03, z + sz * 0.32], rotation: [Math.PI / 2, 0, Math.atan2(sx, sz) * 0], material: shiny('#5b8a30', { roughness: 0.55 }) }))
      stub.lookAt([x + sx * 2, 0.03, z + sz * 2])
      stub.rotateX(Math.PI / 2)
      stub.userData.kind = 'wall'
    }
  }

  // ribosomes: tiny dots all through the cytoplasm, jostling
  const dots = []
  for (let i = 0; i < (animal ? 160 : 120); i++) {
    const a = rand() * TAU, r = Math.sqrt(rand()) * 0.88, [x, z] = outline(a, 0)
    dots.push([x * r, 0.02, z * r])
  }
  const ribosomes = new InstancedMesh({ geometry: icosphere({ radius: 0.03, detail: 1 }), material: shiny(animal ? '#8b3d52' : '#5f7d2a'), instances: dots.map((position) => ({ position })) })
  ribosomes.userData.kind = 'ribosome'
  cell.add(ribosomes)

  /** @type {Record<string, import('phoria2').Node>} anchors for the callouts, by part */
  const parts = {}
  let nucleolusNode, nucleusGroup
  /** @type {{ node: Group, offset: number }[]} */
  let chloroplasts = []
  /** @type {import('phoria2').Curve | null} */
  let stream = null
  if (animal) {
    const n = nucleus()
    nucleusGroup = place(n.group, [-1.05, 0, -0.45], 'nucleus', { amp: 0.03, spin: 0.05 })
    nucleolusNode = n.nucleolus
    parts.nucleus = n.group.children[0]
    parts.nucleolus = n.nucleolus
    parts.er = place(reticulum([1.05, 1.25, 1.45]), [-1.05, 0, -0.45], 'er', { amp: 0.03, spin: 0.04 })
    parts.mitochondria = place(mitochondrion(), [1.35, 0.03, -1.4], 'mitochondria', { turn: 0.5 })
    place(mitochondrion(), [2.05, 0.03, -0.2], 'mitochondria', { turn: 1.9 })
    place(mitochondrion(), [-2.05, 0.03, 1.0], 'mitochondria', { turn: 2.6 })
    parts.golgi = place(golgi(), [0.05, 0, 0.95], 'golgi', { turn: 0.3, spin: 0.05 })
    parts.vesicles = place(beads('#f3b25f', [[0.55, 0.1, 0.55], [0.7, 0.12, 0.75], [0.62, 0.1, 1.0]], 0.07), [0.05, 0, 0.95], 'vesicles', { turn: 0.3, spin: 0 })
    parts.vacuole = place(new Mesh({ geometry: blob((a) => 1 + 0.25 * Math.sin(2 * a + 0.5), 0.75, 0.45, 0.18, 0.3), material: shiny('#55b6d8', { opacity: 0.85 }) }), [1.35, 0, 1.2], 'vacuole', { turn: 0.8, spin: 0.05 })
    parts.centrioles = place(centrioles(), [1.9, 0, 0.45], 'centrioles', { turn: 0.4 })
    parts.lysosome = place(beads('#f5c443', [[0, 0.07, 0], [0.5, 0.07, -0.6], [-0.4, 0.07, 0.5]], 0.11), [0.6, 0, -0.35], 'lysosome', { turn: 0, spin: 0 })
    parts.peroxisome = place(beads('#b45ad3', [[0, 0.07, 0], [0.75, 0.07, 0.3], [-0.2, 0.07, -1.45]], 0.09), [-1.75, 0, 1.45], 'peroxisome', { turn: 0, spin: 0 })
    const tubes = new Group()
    for (const [x, z, a, l] of [[0.55, -1.75, 0.3, 0.9], [-0.1, -1.65, -0.2, 0.7], [-0.6, 1.95, 0.9, 1.0], [0.75, 0.25, 1.4, 0.6]]) {
      tubes.add(new Mesh({ geometry: cylinder({ radius: 0.025, height: l, segments: 6 }), position: [x, 0.05, z], rotation: [Math.PI / 2, 0, a], material: shiny('#5e3646') }))
    }
    parts.microtubule = place(tubes, [0, 0, 0], 'microtubule', { amp: 0.02, spin: 0, turn: 0 })
    parts.pinocytosis = place(beads('#f6cdd4', [[0, 0.12, 0]], 0.13), [-0.48, 0, -2.25], 'pinocytosis', { turn: 0, spin: 0 })
  } else {
    const n = nucleus('#c8402f')
    nucleusGroup = place(n.group, [-1.45, 0, -0.55], 'nucleus', { amp: 0.03, spin: 0.05 })
    nucleolusNode = n.nucleolus
    parts.nucleus = n.group.children[0]
    parts.nucleolus = n.nucleolus
    parts.er = place(reticulum([1.05, 1.25]), [-1.45, 0, -0.55], 'er', { amp: 0.03, spin: 0.04 })
    // the big central vacuole, with its crystals
    const vac = new Group()
    vac.add(new Mesh({ geometry: blob((a) => 1 + 0.18 * Math.sin(2 * a + 2.4) + 0.08 * Math.sin(3 * a), 1.15, 1.3, 0.22, 0.45), material: shiny('#4bb3d9', { opacity: 0.88 }) }))
    parts.vacuole = place(vac, [0.75, 0, 0.2], 'vacuole', { amp: 0.02, spin: 0.02, turn: 0.4 })
    const dr = druse()
    dr.position.set(0.15, 0.24, -0.2)
    vac.add(dr).userData.kind = 'druse'
    parts.druse = dr
    const needles = new Group({ position: [-0.45, 0.24, 0.55] })
    for (let i = 0; i < 4; i++) needles.add(new Mesh({ geometry: cylinder({ radius: 0.015, height: 0.6, segments: 5 }), position: [i * 0.06, 0, i * 0.03], rotation: [Math.PI / 2, 0, 0.6], material: { color: '#dbe4ea', roughness: 0.2, metalness: 0.3 } }))
    vac.add(needles).userData.kind = 'raphide'
    needles.traverse((m) => { m.userData.kind = 'raphide' })
    parts.raphide = needles
    parts.mitochondria = place(mitochondrion('#d44d73'), [2.2, 0.03, -1.15], 'mitochondria', { turn: 1.2 })
    place(mitochondrion('#d44d73'), [-2.25, 0.03, -1.45], 'mitochondria', { turn: 0.2 })
    parts.golgi = place(golgi(), [2.05, 0, 1.35], 'golgi', { turn: 2.6, spin: 0.05 })
    parts.vesicles = place(beads('#f3b25f', [[0.25, 0.1, 0.0], [0.4, 0.12, 0.15], [0.35, 0.1, -0.2]], 0.065), [2.35, 0, 1.55], 'vesicles', { turn: 0, spin: 0 })
    const amylo = new Group()
    amylo.add(new Mesh({ geometry: blob(() => 1, 0.38, 0.3, 0.17), material: shiny('#6a4ab0') }))
    for (const r of [0.22, 0.13]) amylo.add(new Mesh({ geometry: curve(Array.from({ length: 20 }, (_, i) => [Math.cos(i / 20 * TAU) * r * 1.2, 0.17, Math.sin(i / 20 * TAU) * r]), { closed: true }).tube({ radius: 0.018, segments: 40, sides: 6 }), material: shiny('#b39cf0') }))
    parts.amyloplast = place(amylo, [-2.3, 0, 0.45], 'amyloplast', { turn: 1.4 })
    parts.peroxisome = place(beads('#f2c94c', [[0, 0.07, 0], [-1.3, 0.07, 1.55]], 0.1), [-0.4, 0, -1.6], 'peroxisome', { turn: 0, spin: 0 })
    // chloroplasts, streaming round the vacuole on the current
    stream = curve(Array.from({ length: 16 }, (_, i) => {
      const a = i / 16 * TAU, [x, z] = outline(a, 0)
      return [x * 0.78, 0.04, z * 0.74]
    }), { closed: true })
    chloroplasts = Array.from({ length: 6 }, (_, i) => {
      const c = chloroplast()
      c.traverse((n) => { n.userData.kind = 'chloroplast' })
      cell.add(c)
      return { node: c, offset: i / 6 + rand() * 0.05 }
    })
    parts.chloroplast = chloroplasts[0].node
  }

  // --- callouts, down the sides of the view: those on the left half to the left
  const NAMES = {
    nucleus: 'Nucleus', nucleolus: 'Nucleolus', er: 'Endoplasmic reticulum', mitochondria: 'Mitochondria', golgi: 'Golgi apparatus',
    vesicles: 'Golgi vesicles', vacuole: 'Vacuole', centrioles: 'Centrioles', lysosome: 'Lysosome', peroxisome: 'Peroxisome',
    microtubule: 'Microtubule', pinocytosis: 'Pinocytotic vesicle', chloroplast: 'Chloroplast', amyloplast: 'Amyloplast',
    druse: 'Druse crystal', raphide: 'Raphide crystals', ribosome: 'Ribosome', membrane: 'Cell membrane', wall: 'Cell wall', cytoplasm: 'Cytoplasm',
  }
  /**
   * A point on the outer rim - the animal's membrane, the plant's wall - at an angle round the cell
   * (the animal's top is about -PI/2; the plant is turned, so its top is about 0) and a height.
   * @param {number} a @param {number} [y]
   */
  const rimAt = (a, y = 0.12) => {
    const [x, z] = outline(a, 0)
    return [x, y, z]
  }
  // where on each part the leader points, in the part's own space
  const POINTS = animal
    ? { pinocytosis: [0, 0.2, 0], er: [0.2, 0.08, -1.25], nucleus: [-0.4, 0.3, 0.2], nucleolus: [0, 0.12, 0], peroxisome: [0, 0.12, 0],
      cytoplasm: [-1.6, 0, 1.9], vesicles: [0.6, 0.15, 1.0], golgi: [0, 0.3, -0.1], microtubule: [0.55, 0.06, -1.75], mitochondria: [0, 0.24, 0],
      membrane: rimAt(-1.15), centrioles: [0.1, 0.25, 0], lysosome: [0.5, 0.18, -0.6], vacuole: [0, 0.2, 0] }
    : { er: [0.1, 0.08, -1.2], nucleus: [-0.4, 0.3, 0.2], nucleolus: [0, 0.12, 0], amyloplast: [0, 0.2, 0], chloroplast: [0, 0.25, 0],
      cytoplasm: [-1.0, 0, 1.5], peroxisome: [0, 0.12, 0], wall: rimAt(-0.35, 0.25), membrane: [1.0, 0.08, -2.05], mitochondria: [0, 0.24, 0],
      druse: [0, 0.2, 0], golgi: [0, 0.3, -0.1], vesicles: [0.35, 0.15, 0], vacuole: [0.3, 0.2, 0.5], raphide: [0.1, 0.05, 0] }
  // the ribosomes are everywhere; name one near the edge
  const someDot = dots.reduce((best, d) => (Math.hypot(d[0], d[2]) > Math.hypot(best[0], best[2]) && d[2] > 0.5 ? d : best), [0, 0, 0])
  /** @type {[string, import('phoria2').Node, number[]][]} */
  const spots = [...Object.entries(POINTS).map(([part, at]) => /** @type {[string, import('phoria2').Node, number[]]} */ ([part, parts[part] ?? cell, at])),
    ['ribosome', cell, [someDot[0], 0.05, someDot[2]]]]
  // each name goes down the side of the view its part is on - wherever the cell's turning has put it
  scene.updateWorldTree()
  /** @type {Record<string, Label>} */
  const labels = {}
  for (const [part, host, at] of spots) {
    const edge = new Vec3(at[0], at[1], at[2]).applyMatrix4(host.worldMatrix).x < 0 ? 'left' : 'right'
    labels[part] = host.add(new Label({ text: NAMES[part], position: at, edge, leader: true, className: 'cell-callout', overlap: 'dim' }))
  }

  /** Light up a part's callout, or none. @param {string | null} part */
  const focus = (part) => {
    for (const [name, label] of Object.entries(labels)) label.className = name === part ? 'cell-callout now' : 'cell-callout'
  }

  /** @param {number} t */
  const update = (t) => {
    // the membrane wobbles; everything drifts about where it was put, turning slowly
    body.shape(t)
    for (const r of rims) r.shape(t)
    for (const d of drifting) {
      const s = d.speed * t + d.phase
      d.node.position.set(d.base[0] + Math.sin(s) * d.amp, d.base[1] + Math.sin(s * 1.7) * 0.015, d.base[2] + Math.cos(s * 0.8) * d.amp)
      d.node.rotation.y += d.spin * 0.016
    }
    // the nucleus pulses, very slightly
    const pulse = 1 + 0.018 * Math.sin(t * 1.6)
    nucleusGroup.scale.set(pulse, pulse, pulse)
    if (nucleolusNode) nucleolusNode.position.y = 0.33 + 0.012 * Math.sin(t * 2.3)
    // the ribosomes jostle
    for (let i = 0; i < dots.length; i++) {
      const [x, y, z] = dots[i]
      ribosomes.setInstance(i, { position: [x + 0.02 * Math.sin(t * 3 + i), y, z + 0.02 * Math.cos(t * 2.6 + i * 1.3)] })
    }
    // cytoplasmic streaming: the chloroplasts ride the current round the vacuole
    if (stream) for (const c of chloroplasts) follow(c.node, stream, (c.offset + t * 0.018) % 1, { forward: '+x' })
  }
  return { update, focus, cell }
}

export default function run({ canvas, gui, info }) {
  canvas.style.display = 'none'
  const poster = document.createElement('div')
  poster.className = 'cells-poster'
  poster.innerHTML = `
    <header><h2>Animal and plant cells</h2><p>What's inside the two kinds of cell. Hover a part to see what it does.</p></header>
    <div class="cells-pair">
      <section><h3>Animal cell</h3><canvas></canvas></section>
      <section><h3>Plant cell</h3><canvas></canvas></section>
    </div>`
  document.body.append(poster)
  const canvases = poster.querySelectorAll('canvas')
  const titles = /** @type {NodeListOf<HTMLElement>} */ (poster.querySelectorAll('h3'))

  const views = /** @type {const} */ (['animal', 'plant']).map((kind, i) => {
    const view = new View({
      // turn and zoom, but no panning - the cell stays in the middle of its part of the poster
      canvas: canvases[i], orbit: { pan: false, minPitch: 0.35, maxPitch: 1.45, minDistance: 6, maxDistance: 20 },
      camera: { position: [0, 11.2, 10.1], target: [0, -0.2, 0.15], fov: 38 }, framing: 'both', highlight: '#ffffff',
      tooltip: (hit) => ABOUT[kindOf(hit?.node)] ?? null,
    })
    const { scene } = view
    scene.environment = 'studio'
    scene.environmentIntensity = 0.6
    scene.add(new HemisphereLight({ sky: '#ffffff', ground: '#e8e0d8', intensity: 1.1 }))
    scene.add(new DirectionalLight({ direction: [-0.4, -1, -0.5], intensity: 1.6 }))
    const cell = buildCell(scene, kind)
    view.on('hover', (hit) => cell.focus(kindOf(hit?.node)))
    // the cell's name sits just above it, wherever the framing and the turning have put its top - placed
    // from the cell's bounds at rest, with room for its wobble, so the title holds still as it breathes
    const title = titles[i], canvasEl = canvases[i]
    const rest = cell.cell.bounds
    const room = rest.getSize().multiplyScalar(0.04)
    rest.min.sub(room)
    rest.max.add(room)
    let placed = NaN
    view.start((dt, t) => {
      cell.update(t)
      const bounds = view.screenBounds(rest)
      if (!bounds) return
      const top = Math.round(canvasEl.offsetTop + bounds.top - title.offsetHeight - 4)
      if (top !== placed) title.style.top = `${(placed = top)}px`
    })
    return view
  })
  info.textContent = 'Two views on one page - each cell sliced open, every part named; hover a part to see what it does'
  if (import.meta.env.DEV) Object.assign(window, { views })
  void gui
  return views[0]
}

/** The kind of part a node belongs to: its own, or its nearest ancestor's. @param {import('phoria2').Node | undefined} node */
function kindOf(node) {
  for (let n = node; n; n = n.parent) if (n.userData?.kind) return n.userData.kind
  return null
}
