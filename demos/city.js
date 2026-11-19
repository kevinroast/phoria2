import { Box3, DirectionalLight, HemisphereLight, InstancedMesh, Mesh, OrthographicCamera, PerspectiveCamera, SpotLight, View, box, plane } from 'phoria2'
import { scaleColor } from 'phoria2/charts'
import { legend, random } from './kit.js'

const LOTS = 3, LOT = 2, ROAD = 1.6, STOREY = 0.32, BLOCK = LOTS * LOT + ROAD
// blocks along each side, for each size: about 1,500, 9,000 and 37,000 buildings
const SIZES = { town: 14, city: 34, metropolis: 68 }
// the town's downtown reach - each business district climbs within this of its centre
const DOWNTOWN = SIZES.town * BLOCK * 0.6
// the searchlights at night: helicopters hovering above the tallest towers, each drifting round a
// small circle and sweeping its beam over the streets - CLEARANCE above the highest roof, TILT down
const SEARCHLIGHTS = 4, SWEEP = 0.245, TILT = 0.75, CLEARANCE = 14, DRIFT = 5
const USES = {
  office: { label: 'Office', color: '#4e79a7', energy: 230, occupancy: [40, 98] },
  residential: { label: 'Residential', color: '#59a14f', energy: 140, occupancy: [70, 100] },
  retail: { label: 'Retail', color: '#f28e2b', energy: 270, occupancy: [30, 95] },
  civic: { label: 'Civic', color: '#b07aa1', energy: 180, occupancy: [20, 80] },
}
const LANDMARKS = ['Meridian Tower', 'One Harbour Place', 'The Lantern', 'Northgate', 'Atlas House', 'The Spire', 'Quayside', 'Kingsway Point']

// What the buildings can be coloured by: a scale and how to read a value
const METRICS = {
  'energy use': { value: (b) => b.energy, scale: scaleColor({ domain: [100, 340], scheme: 'heat' }), format: (v) => `${Math.round(v)} kWh/m²`, title: 'Energy use per m², a year' },
  occupancy: { value: (b) => b.occupancy, scale: scaleColor({ domain: [20, 100], scheme: 'viridis' }), format: (v) => `${Math.round(v)}%`, title: 'Occupancy' },
  'year built': { value: (b) => b.year, scale: scaleColor({ domain: [1890, 2024], scheme: 'cool' }), format: String, title: 'Year built' },
  use: { value: (b) => b.use, scale: scaleColor({ domain: Object.keys(USES), range: Object.values(USES).map((u) => u.color) }), format: (v) => USES[v].label, title: 'Use' },
}

/** A block's column as letters, like a spreadsheet's: A to Z, then AA, AB... @param {number} i */
const column = (i) => (i < 26 ? '' : String.fromCharCode(64 + Math.floor(i / 26))) + String.fromCharCode(65 + (i % 26))

/**
 * A made-up city: every lot's building, with its use, size, age, energy use and occupancy. A bigger
 * city has more business districts: the main one in the middle, the rest scattered, each climbing
 * towards its centre.
 * @param {number} seed @param {number} blocks along each side
 */
function buildings(seed, blocks) {
  const r = random(seed)
  const span = blocks * BLOCK
  const hubs = [{ x: 0, z: 0, height: 1 }]
  for (let i = 1; i < Math.round((blocks / SIZES.town) ** 2 * 0.6); i++) hubs.push({ x: (r() - 0.5) * span * 0.85, z: (r() - 0.5) * span * 0.85, height: 0.55 + r() * 0.3 })
  const rows = []
  for (let bx = 0; bx < blocks; bx++) {
    for (let bz = 0; bz < blocks; bz++) {
      for (let lx = 0; lx < LOTS; lx++) {
        for (let lz = 0; lz < LOTS; lz++) {
          if (r() < 0.12) continue
          const x = -span / 2 + bx * BLOCK + ROAD / 2 + (lx + 0.5) * LOT
          const z = -span / 2 + bz * BLOCK + ROAD / 2 + (lz + 0.5) * LOT
          // offices crowd the districts' middles and climb; homes and shops spread out; the odd civic building
          let centre = 0
          for (const h of hubs) centre = Math.max(centre, h.height * (1 - Math.min(1, Math.hypot(x - h.x, z - h.z) / DOWNTOWN)))
          const pick = r()
          const use = pick < 0.04 ? 'civic' : pick < 0.1 + centre * 0.6 ? 'office' : pick < 0.8 ? 'residential' : 'retail'
          const floors = Math.max(1, Math.round(use === 'office' ? 4 + centre ** 2 * 50 * r() + (r() < 0.03 ? 25 : 0)
            : use === 'residential' ? 3 + r() * 10 + centre * 12 * r() : use === 'retail' ? 1 + r() * 3 : 2 + r() * 4))
          const year = Math.round(1890 + r() ** (use === 'office' ? 0.5 : 1.2) * 134)
          const age = (2024 - year) / 134
          const { energy, occupancy } = USES[use]
          rows.push({
            name: `Block ${column(bx)}${bz + 1}, lot ${lx * LOTS + lz + 1}`, use, floors, year,
            energy: energy * (0.75 + age * 0.6) * (0.8 + r() * 0.4),
            occupancy: occupancy[0] + r() * (occupancy[1] - occupancy[0]),
            x, z, width: LOT * (0.6 + r() * 0.3), depth: LOT * (0.6 + r() * 0.3),
          })
        }
      }
    }
  }
  // the tallest few are landmarks, named and labelled
  ;[...rows].sort((a, b) => b.floors - a.floors).slice(0, LANDMARKS.length).forEach((b, i) => { b.landmark = LANDMARKS[i] })
  return rows
}

// A city as data: every building is an instance of one box with its row of data bound, so
// thousands draw in one call and hovering one hands back its row for the tooltip. Height is its
// floors; colour is whichever measure is chosen, through a colour scale from phoria2/charts - the
// same scales the charts use - with a legend to read it by. The camera switches between
// orthographic (the isometric look) and perspective. Sizes go up to a metropolis of some 37,000
// buildings, still one draw call; at night a moon and four helicopters' searchlights cast
// shadows across all of them - five shadow maps fitted round the whole city every frame.
export default function run({ canvas, gui, info }) {
  const iso = new OrthographicCamera({ position: [60, 60, 60], target: [0, 0, 0], height: 100, near: 1, far: 500 })
  const persp = new PerspectiveCamera({ position: [78, 56, 78], target: [0, 0, 0], fov: 45, near: 1, far: 800 })
  const view = new View({
    canvas, camera: persp, orbit: { maxPitch: 1.45, minDistance: 10, maxDistance: 250 }, background: '#16181d', highlight: '#ffffff',
    tooltip: (hit) => hit.datum && {
      title: hit.datum.landmark ?? hit.datum.name,
      rows: {
        Use: USES[hit.datum.use].label, Floors: hit.datum.floors, Built: String(hit.datum.year),
        'Energy use': METRICS['energy use'].format(hit.datum.energy), Occupancy: METRICS.occupancy.format(hit.datum.occupancy),
      },
    },
  })
  const sky = view.scene.add(new HemisphereLight({ sky: '#dfe8f5', ground: '#3a3a40', intensity: 0.9 }))
  // the sun by day, the moon by night: one light, so one shadow map either way
  const sun = view.scene.add(new DirectionalLight({ direction: [-0.5, -1, -0.35], intensity: 1.1, castShadow: true }))
  const ground = view.scene.add(new Mesh({ geometry: plane(1), material: { color: '#2a2d34', roughness: 1 }, pickable: false, receiveShadow: true }))
  // where each helicopter hovers - over one of the tallest towers, set by placeSearchlights()
  const hover = Array.from({ length: SEARCHLIGHTS }, () => ({ x: 0, y: 0, z: 0 }))
  // each drifts round its spot and sweeps its beam, tilted down onto the streets, at its own pace
  const searchlights = hover.map((at, i) => view.scene.add(new SpotLight({
    color: '#fff1d6', intensity: 0, angle: 0.21, penumbra: 0.4, castShadow: true, visible: false,
    onUpdate: (light, dt, t) => {
      const turn = i % 2 ? -1 : 1
      const drift = t * 0.084 * turn + i * 2.1
      light.position.set(at.x + Math.cos(drift) * DRIFT, at.y + Math.sin(t * 0.49 + i) * 0.4, at.z + Math.sin(drift) * DRIFT)
      const a = t * SWEEP * turn * (1 + i * 0.15) + i * 1.7
      light.direction.set(Math.cos(a) * Math.cos(TILT), -Math.sin(TILT), Math.sin(a) * Math.cos(TILT))
    },
  })))

  const settings = { size: 'city', colour: 'energy use', perspective: true, night: false, shadows: true, seed: 3 }
  /** @type {InstancedMesh | null} */
  let city = null
  /** @type {any[]} */
  let rows = []
  const hidden = new Set()
  let key = null

  // colour every building by the chosen measure; hidden uses shrink to nothing
  const paint = () => {
    const m = METRICS[settings.colour]
    rows.forEach((b, i) => city?.setInstance(i, {
      position: [b.x, b.floors * STOREY / 2, b.z],
      scale: hidden.has(b.use) ? 0 : [b.width, b.floors * STOREY, b.depth],
      color: m.scale(m.value(b)),
    }))
    const shown = rows.filter((b) => !hidden.has(b.use))
    const mean = shown.reduce((s, b) => s + b.energy * b.floors, 0) / (shown.reduce((s, b) => s + b.floors, 0) || 1)
    info.textContent = `${shown.length.toLocaleString()} buildings in one draw call, ${Math.round(mean)} kWh/m² a year on average - hover one for its row`
    showKey()
  }
  // the legend: a ramp for a measure, or one swatch per use that hides and shows it
  const showKey = () => {
    key?.remove()
    const m = METRICS[settings.colour]
    if (m.scale.kind === 'categorical') {
      key = legend(Object.entries(USES).map(([, u]) => ({ label: u.label, color: u.color })), {
        title: m.title,
        onToggle: (i, on) => {
          const use = Object.keys(USES)[i]
          if (on) hidden.delete(use)
          else hidden.add(use)
          paint()
        },
      })
      key.querySelectorAll('.demo-legend-item').forEach((el, i) => el.classList.toggle('off', hidden.has(Object.keys(USES)[i])))
      return
    }
    key = legend([], { title: m.title })
    key.insertAdjacentHTML('beforeend', `<div class="demo-legend-gradient" style="background: linear-gradient(to right, ${m.scale.range.join(', ')})"></div>
      <div class="demo-legend-scale"><span>${m.format(m.scale.domain[0])}</span><span>${m.format(m.scale.domain[1])}</span></div>`)
  }
  // day or night: the light, the sky and the searchlights
  const light = () => {
    const night = settings.night
    sky.intensity = night ? 0.05 : 0.9
    sun.color.set(night ? '#9fb3ff' : '#ffffff')
    sun.intensity = night ? 0.15 : 1.1
    sun.direction.copy(night ? [0.45, -1, 0.3] : [-0.5, -1, -0.35])
    sun.castShadow = settings.shadows
    view.scene.background = night ? '#07080c' : '#16181d'
    for (const s of searchlights) {
      s.visible = night
      s.castShadow = settings.shadows
    }
  }
  // the helicopters over the tallest towers, all clear of the highest roof, each a little higher
  // than the last; bright enough to light the streets their beams reach
  const placeSearchlights = () => {
    const tallest = [...rows].sort((a, b) => b.floors - a.floors)
    const top = tallest[0].floors * STOREY
    searchlights.forEach((s, i) => {
      const b = tallest[i]
      Object.assign(hover[i], { x: b.x, y: top + CLEARANCE + i * 3, z: b.z })
      s.position.set(hover[i].x, hover[i].y, hover[i].z)
      s.intensity = 24 * (hover[i].y / Math.sin(TILT)) ** 2
    })
  }
  const build = (frame = false) => {
    if (city) {
      view.scene.remove(city)
      city.dispose()
    }
    const blocks = SIZES[settings.size], span = blocks * BLOCK, scale = span / (SIZES.town * BLOCK)
    rows = buildings(settings.seed, blocks)
    ground.geometry.dispose()
    ground.geometry = plane(span + 6)
    // the cameras' reach grows with the city
    persp.far = 800 * scale
    iso.far = 500 * scale
    if (view.controls) view.controls.maxDistance = 250 * scale
    city = view.scene.add(new InstancedMesh({
      geometry: box(1), material: { roughness: 0.7 }, count: rows.length, data: rows, castShadow: true, receiveShadow: true,
      labels: { text: (b) => b.landmark ?? null, place: 'above', className: 'demo-value', occlude: true, priority: (b) => b.floors },
    }))
    placeSearchlights()
    paint()
    // the main downtown - all of a town; zoom out for the rest of a bigger city
    const reach = Math.min(span / 2, DOWNTOWN * 1.2)
    if (frame) view.frame(new Box3([-reach, 0, -reach], [reach, 12, reach]), { direction: view.camera.position.clone().sub(view.camera.target ?? [0, 0, 0]), padding: 0 })
  }
  build(true)
  light()

  const f = gui.addFolder('City')
  f.add(settings, 'size', Object.keys(SIZES)).onChange(() => build(true))
  f.add(settings, 'colour', Object.keys(METRICS)).name('colour by').onChange(paint)
  f.add(settings, 'night').name('night, search lights').onChange(light)
  f.add(settings, 'shadows').onChange(light)
  f.add(settings, 'perspective').onChange((v) => {
    // keep looking at the same spot from the same direction
    const from = view.camera, to = v ? persp : iso
    to.target = from.target?.clone() ?? null
    to.position.copy(from.position)
    view.camera = to
  })

  return view.start()
}
