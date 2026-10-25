import { DirectionalLight, HemisphereLight, InstancedMesh, Mesh, OrthographicCamera, PerspectiveCamera, View, box, plane } from 'phoria2'
import { scaleColor } from 'phoria2/charts'
import { legend, random } from './kit.js'

const BLOCKS = 14, LOTS = 3, LOT = 2, ROAD = 1.6, STOREY = 0.32
const SPAN = BLOCKS * (LOTS * LOT + ROAD)
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

/** A made-up city: every lot's building, with its use, size, age, energy use and occupancy. */
function buildings(seed) {
  const r = random(seed)
  const rows = []
  for (let bx = 0; bx < BLOCKS; bx++) {
    for (let bz = 0; bz < BLOCKS; bz++) {
      for (let lx = 0; lx < LOTS; lx++) {
        for (let lz = 0; lz < LOTS; lz++) {
          if (r() < 0.12) continue
          const x = -SPAN / 2 + bx * (LOTS * LOT + ROAD) + ROAD / 2 + (lx + 0.5) * LOT
          const z = -SPAN / 2 + bz * (LOTS * LOT + ROAD) + ROAD / 2 + (lz + 0.5) * LOT
          // offices crowd the middle and climb; homes and shops spread out; the odd civic building
          const centre = 1 - Math.min(1, Math.hypot(x, z) / (SPAN * 0.6))
          const pick = r()
          const use = pick < 0.04 ? 'civic' : pick < 0.1 + centre * 0.6 ? 'office' : pick < 0.8 ? 'residential' : 'retail'
          const floors = Math.max(1, Math.round(use === 'office' ? 4 + centre ** 2 * 50 * r() + (r() < 0.03 ? 25 : 0)
            : use === 'residential' ? 3 + r() * 10 + centre * 12 * r() : use === 'retail' ? 1 + r() * 3 : 2 + r() * 4))
          const year = Math.round(1890 + r() ** (use === 'office' ? 0.5 : 1.2) * 134)
          const age = (2024 - year) / 134
          const { energy, occupancy } = USES[use]
          rows.push({
            name: `Block ${String.fromCharCode(65 + bx)}${bz + 1}, lot ${lx * LOTS + lz + 1}`, use, floors, year,
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
// orthographic (the isometric look) and perspective.
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
  view.scene.add(new HemisphereLight({ sky: '#dfe8f5', ground: '#3a3a40', intensity: 0.9 }))
  const sun = view.scene.add(new DirectionalLight({ direction: [-0.5, -1, -0.35], intensity: 1.1, castShadow: true }))
  view.scene.add(new Mesh({ geometry: plane(SPAN + 6), material: { color: '#2a2d34', roughness: 1 }, pickable: false, receiveShadow: true }))

  const settings = { colour: 'energy use', perspective: true, seed: 3 }
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
    info.textContent = `${shown.length.toLocaleString()} buildings, ${Math.round(mean)} kWh/m² a year on average - hover one for its row`
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
  const build = () => {
    if (city) {
      view.scene.remove(city)
      city.dispose()
    }
    rows = buildings(settings.seed)
    city = view.scene.add(new InstancedMesh({
      geometry: box(1), material: { roughness: 0.7 }, count: rows.length, data: rows, castShadow: true, receiveShadow: true,
      labels: { text: (b) => b.landmark ?? null, place: 'above', className: 'demo-value', occlude: true, priority: (b) => b.floors },
    }))
    paint()
  }
  build()

  const f = gui.addFolder('City')
  f.add(settings, 'colour', Object.keys(METRICS)).name('colour by').onChange(paint)
  f.add(sun, 'castShadow').name('shadows')
  f.add(settings, 'perspective').onChange((v) => {
    // keep looking at the same spot from the same direction
    const from = view.camera, to = v ? persp : iso
    to.target = from.target?.clone() ?? null
    to.position.copy(from.position)
    view.camera = to
  })
  f.add({ another: () => { settings.seed++; build() } }, 'another').name('build another')

  return view.start()
}
