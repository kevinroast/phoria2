import { DirectionalLight, Group, HemisphereLight, Label, Material, Mesh, Texture, View, box, plane } from 'phoria2'
import { random } from './kit.js'

// A distribution centre as separate parts: every rack upright, beam, pallet and load is a mesh of its
// own - thousands of them, as scenes built from parts are (no instancing) - sharing a dozen
// materials. Each material's meshes are drawn together, its maps bound and its settings sent once,
// so the cost is in the parts, not the materials. The sun's shadow map is kept while nothing that
// casts moves: stop the forklifts, and the stats corner shows it kept frame after frame.
//
// Sizes, in rack rows: about 2,000, 5,000 and 11,000 meshes.
const SIZES = { small: 6, medium: 16, large: 34 }
const BAY = 2.7, LEVEL = 1.55, LEVELS = 4, DEPTH = 1.1, AISLE = 3.4, BAYS = 14
// a rack row runs along x; rows stand back to back in pairs, an aisle between each pair
const ROW_LENGTH = BAYS * BAY

/**
 * A Poly Haven texture set as a material: colour, normal, and one ARM texture for occlusion,
 * roughness and metalness.
 * @param {string} name @param {number[]} repeat @param {boolean} [metal]
 */
function surface(name, repeat, metal = false) {
  const url = (map) => `textures/${name}_${map}_1k.jpg`
  const arm = new Texture({ url: url('arm'), colorSpace: 'linear', repeat })
  // roughness multiplies the map's: 1 takes the texture's own, as it was made to be read
  return new Material({
    roughness: 1, map: { url: url('diff'), repeat }, normalMap: { url: url('nor_gl'), repeat }, roughnessMap: arm, aoMap: arm,
    ...(metal ? { metalness: 1, metalnessMap: arm } : {}),
  })
}

// the dozen materials every part shares
const MATERIALS = {
  upright: new Material({ color: '#2f5f9e', roughness: 0.45, metalness: 0.3 }),
  beam: new Material({ color: '#e0701c', roughness: 0.4, metalness: 0.3 }),
  pallet: surface('weathered_brown_planks', [0.5, 0.5]),
  drum: surface('rusty_metal_02', [0.5, 0.5], true),
  cartons: ['#b8925c', '#a9824f', '#c7a774', '#9a7444'].map((color) => new Material({ color, roughness: 0.85 })),
  wrap: new Material({ color: '#dfe6ea', roughness: 0.25, opacity: 1 }),
  floor: new Material({ color: '#6a6d70', roughness: 0.8 }),
  line: new Material({ color: '#f2c230', roughness: 0.6 }),
  wall: surface('red_brick_03', [8, 2]),
  lift: new Material({ color: '#f2b705', roughness: 0.35, metalness: 0.1 }),
  mast: new Material({ color: '#24272c', roughness: 0.5, metalness: 0.6 }),
}
const SKUS = ['Bottled water 24 x 500 ml', 'Copier paper A4, 5 reams', 'Garden compost 50 l', 'Cat litter 10 kg', 'Kettle, stainless',
  'Dog food 12 kg', 'Coffee beans 1 kg x 6', 'Towels, cotton x 4', 'Light bulbs LED x 12', 'Tinned tomatoes x 24', 'Desk lamp',
  'Washing liquid 4 l x 4', 'Bike tyres 700c x 10', 'Paint, white 10 l', 'Phone cases x 50', 'Rice 10 kg']

/**
 * The racking and its stock for a number of rows, as a group of separate meshes.
 * @param {number} rows @param {ReturnType<typeof random>} r
 */
function racking(rows, r) {
  const group = new Group({ name: 'racking' })
  const unit = box(1)
  /** @type {Mesh[]} */
  const parts = []
  const add = (/** @type {Mesh} */ mesh) => { parts.push(group.add(mesh)); return mesh }
  const width = rows / 2 * (DEPTH * 2 + AISLE)
  for (let row = 0; row < rows; row++) {
    // pairs of rows back to back, an aisle in front of each pair
    const pair = Math.floor(row / 2), back = row % 2
    const z = -width / 2 + pair * (DEPTH * 2 + AISLE) + AISLE / 2 + DEPTH / 2 + back * DEPTH
    const aisle = String.fromCharCode(65 + pair)
    for (let bay = 0; bay <= BAYS; bay++) {
      const x = -ROW_LENGTH / 2 + bay * BAY
      for (const side of [-1, 1]) {
        add(new Mesh({ geometry: unit, material: MATERIALS.upright, position: [x, LEVEL * LEVELS / 2, z + side * (DEPTH / 2 - 0.04)], scale: [0.08, LEVEL * LEVELS, 0.08], castShadow: true, receiveShadow: true, pickable: false }))
      }
      if (bay === BAYS) continue
      for (let level = 0; level < LEVELS; level++) {
        const y = level * LEVEL + 0.12
        for (const side of [-1, 1]) {
          add(new Mesh({ geometry: unit, material: MATERIALS.beam, position: [x + BAY / 2, y, z + side * (DEPTH / 2 - 0.04)], scale: [BAY - 0.08, 0.12, 0.06], castShadow: true, receiveShadow: true, pickable: false }))
        }
        // two pallet places a bay, most of them full
        for (const slot of [0, 1]) {
          if (r() < 0.12) continue
          const px = x + BAY * (slot === 0 ? 0.27 : 0.73), py = y + 0.06
          add(new Mesh({ geometry: unit, material: MATERIALS.pallet, position: [px, py + 0.07, z], scale: [1.1, 0.14, 0.95], castShadow: true, receiveShadow: true, pickable: false }))
          const drums = r() < 0.15, h = drums ? 0.9 : 0.55 + r() * 0.7
          const sku = SKUS[Math.floor(r() * SKUS.length)]
          const data = { aisle, bay: bay + 1, level: level + 1, slot: slot + 1, sku, units: drums ? 4 : 8 + Math.floor(r() * 40), weight: Math.round(120 + r() * 680) }
          add(new Mesh({
            geometry: unit, material: drums ? MATERIALS.drum : r() < 0.25 ? MATERIALS.wrap : MATERIALS.cartons[Math.floor(r() * 4)],
            position: [px, py + 0.14 + h / 2, z], scale: [1.0, h, 0.86], castShadow: true, receiveShadow: true, data,
          }))
        }
      }
    }
    // the aisle's letter, on the floor at its end
    if (back === 0) group.add(new Label({ text: `Aisle ${aisle}`, position: [-ROW_LENGTH / 2 - 1.2, 0.05, z - DEPTH / 2 - AISLE / 2], className: 'demo-label', overlap: 'show' }))
  }
  return { group, parts, width }
}

/** A forklift: a body, a mast and forks, as one group. */
function forklift() {
  const lift = new Group({ name: 'forklift' })
  const unit = box(1)
  const part = (material, position, scale) => lift.add(new Mesh({ geometry: unit, material, position, scale, castShadow: true, receiveShadow: true, pickable: false }))
  part(MATERIALS.lift, [0, 0.55, 0], [1.6, 0.8, 1.05])
  part(MATERIALS.lift, [-0.25, 1.35, 0], [0.9, 0.08, 1.0])
  for (const z of [-0.45, 0.45]) part(MATERIALS.mast, [-0.25, 0.95, z], [0.06, 0.8, 0.06])
  for (const z of [-0.42, 0.42]) part(MATERIALS.mast, [0.95, 1.2, z], [0.08, 2.3, 0.08])
  for (const z of [-0.3, 0.3]) part(MATERIALS.mast, [1.45, 0.12, z], [1.0, 0.05, 0.1])
  for (const [x, z] of [[-0.55, -0.55], [-0.55, 0.55], [0.55, -0.55], [0.55, 0.55]]) part(MATERIALS.mast, [x, 0.22, z], [0.42, 0.42, 0.18])
  return lift
}

export default function run({ canvas, gui, info }) {
  const view = new View({
    canvas, background: '#1b1e23', highlight: '#ffffff',
    orbit: { maxPitch: 1.4, minPitch: 0.08, minDistance: 6, maxDistance: 160 },
    camera: { fov: 45, near: 0.5, far: 600 },
    tooltip: (hit) => hit.datum && {
      title: hit.datum.sku,
      rows: { Location: `Aisle ${hit.datum.aisle} · bay ${hit.datum.bay} · level ${hit.datum.level}`, Units: hit.datum.units, Weight: `${hit.datum.weight} kg` },
    },
    debug: { stats: 'bottom-left' },
  })
  const { scene } = view
  // the stats corner above the page's info line, which runs along the bottom
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: '.phoria-debug-stats { margin-bottom: 52px }' }))
  scene.add(new HemisphereLight({ sky: '#e8eef5', ground: '#4a4740', intensity: 0.75 }))
  // the sun through the roof lights: one soft shadow over every part, kept while nothing moves
  const sun = scene.add(new DirectionalLight({ direction: [-0.7, -0.75, -0.45], intensity: 1.5, castShadow: true, shadowSoftness: 0.15 }))

  const settings = { size: 'medium', forklifts: true }
  const r = random(11)
  /** @type {Group | null} */ let hall = null
  /** @type {{ node: Group, z: number, x: number, dir: number, speed: number }[]} */ let lifts = []
  let meshes = 0

  const build = () => {
    if (hall) scene.remove(hall)
    hall = scene.add(new Group({ name: 'hall' }))
    const rack = racking(SIZES[settings.size], r)
    hall.add(rack.group)
    const w = ROW_LENGTH + 12, d = rack.width + 8
    hall.add(new Mesh({ geometry: plane({ width: w, depth: d }), material: MATERIALS.floor, receiveShadow: true, pickable: false }))
    // walls round three sides, low enough to see in over
    for (const [x, z, sx, sz] of [[0, -d / 2, w, 0.3], [-w / 2, 0, 0.3, d], [w / 2, 0, 0.3, d]]) {
      hall.add(new Mesh({ geometry: box(1), material: MATERIALS.wall, position: [x, 1.6, z], scale: [sx, 3.2, sz], castShadow: true, receiveShadow: true, pickable: false }))
    }
    // the aisles' yellow lines, either side of each
    const pairs = SIZES[settings.size] / 2
    const aisles = []
    for (let p = 0; p < pairs; p++) {
      const z = -rack.width / 2 + p * (DEPTH * 2 + AISLE) + AISLE / 2 - 0.25
      aisles.push(z - 0.75)
      for (const side of [-1, 1]) hall.add(new Mesh({ geometry: plane({ width: ROW_LENGTH, depth: 0.08 }), material: MATERIALS.line, position: [0, 0.01, z - 0.25 + side * (AISLE / 2 - 0.35)], pickable: false }))
    }
    // two forklifts working the aisles, each up and down its own
    lifts = [0, Math.max(1, aisles.length - 1)].map((a, i) => {
      const node = hall.add(forklift())
      return { node, z: aisles[Math.min(a, aisles.length - 1)], x: (i ? 1 : -1) * ROW_LENGTH * 0.3, dir: i ? -1 : 1, speed: 2.2 + i * 0.6 }
    })
    for (const lift of lifts) lift.node.position.set(lift.x, 0, lift.z)
    meshes = 0
    hall.traverse((n) => { if (n instanceof Mesh) meshes++ })
    // raised, looking down the aisles
    view.frame(hall, { padding: 0.06, direction: [-0.55, 0.75, 0.95] })
  }
  build()

  gui.add(settings, 'size', Object.keys(SIZES)).onChange(build)
  gui.add(settings, 'forklifts').name('forklifts running')
  // 0 is the plain filtered edge; above it, contact-hardening - crisp where a load meets its pallet
  gui.add(sun, 'shadowSoftness', 0, 1, 0.05).name('shadow softness')
  // 'auto' (the default) draws only when something changed - a still hall costs nothing; 'always'
  // draws every frame without that check: a little faster while everything moves
  gui.add({ always: false }, 'always').name("renderMode 'always'").onChange((on) => { view.renderMode = on ? 'always' : 'auto' })
  gui.add({ stats: true }, 'stats').name('stats corner').onChange((on) => { view.debug = on ? { stats: 'bottom-left' } : false })

  const materials = new Set(Object.values(MATERIALS).flat()).size
  let shown = ''
  return view.start((dt) => {
    if (settings.forklifts) {
      for (const lift of lifts) {
        lift.x += lift.dir * lift.speed * dt
        if (Math.abs(lift.x) > ROW_LENGTH / 2 - 1.5) {
          lift.x = Math.sign(lift.x) * (ROW_LENGTH / 2 - 1.5)
          lift.dir = -lift.dir
        }
        lift.node.position.set(lift.x, 0, lift.z)
        lift.node.rotation.set(0, lift.dir > 0 ? 0 : Math.PI, 0)
      }
    }
    const i = view.renderer.info
    const text = `${meshes.toLocaleString()} meshes sharing ${materials} materials · ${i.drawCalls.toLocaleString()} draw calls · shadow map ${i.shadowMapsKept ? 'kept' : 'drawn'} - ${settings.forklifts ? 'stop the forklifts to keep it' : 'nothing casting moves'} · hover a load`
    if (text !== shown) info.textContent = shown = text
  })
}
