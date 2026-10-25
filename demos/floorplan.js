import { Color, InstancedMesh, Label, Mesh, View, box, plane } from 'phoria2'
import { download, random } from './kit.js'

const ROWS = ['A', 'B', 'C', 'D']
const ROW_Z = [-3.3, -1.3, 1.3, 3.3]
const RACKS = 10, PITCH = 0.7
// a cold-to-hot ramp (ColorBrewer RdYlBu, reversed)
const RAMP = ['#2c7bb6', '#abd9e9', '#ffffbf', '#fdae61', '#d7191c']
const METRICS = {
  temperature: { label: 'Inlet temperature', unit: '°C', min: 18, max: 35, value: (r) => r.temp },
  power: { label: 'Power draw', unit: 'kW', min: 0, max: 12, value: (r) => r.power },
}
const ALERT_TEMP = 32
const VIEWS = { isometric: 'isometric', plan: 'top', elevation: 'front' }

/** A colour on the ramp for t in 0..1. @param {number} t */
const heat = (t) => {
  const x = Math.min(1, Math.max(0, t)) * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(x))
  return new Color(RAMP[i]).lerp(RAMP[i + 1], x - i)
}

// A data hall floor plan: forty racks in hot and cold aisles, one InstancedMesh with a row of
// telemetry per rack, coloured as a heat map. The isometric preset frames it; the plan view pans
// like a map. Rack labels give way hottest first, alerts pulse, and the picture exports as a PNG.
export default function run({ canvas, gui, info }) {
  const rand = random(3)
  const racks = ROWS.flatMap((row, r) => Array.from({ length: RACKS }, (_, i) => {
    // warmer towards the middle of the hall and away from the cooling units at the ends
    const temp = 20 + 6 * Math.sin((i + 0.5) / RACKS * Math.PI) + (r === 1 || r === 2 ? 2 : 0) + rand() * 4 + (rand() < 0.06 ? 7 : 0)
    return { id: `${row}-${String(i + 1).padStart(2, '0')}`, row, temp: +temp.toFixed(1), power: +(2 + rand() * 9).toFixed(1),
      load: Math.round(30 + rand() * 65), x: (i - (RACKS - 1) / 2) * PITCH, z: ROW_Z[r] }
  }))
  const status = (r) => (r.temp >= ALERT_TEMP ? 'Alert' : r.temp >= 29 ? 'Warm' : 'Normal')

  const view = new View({
    canvas, orbit: true, camera: 'isometric', background: '#e9ecf1', highlight: '#ffffff',
    tooltip: (hit) => hit.datum && {
      title: `Rack ${hit.datum.id}`,
      rows: { Temperature: `${hit.datum.temp} °C`, Power: `${hit.datum.power} kW`, Load: `${hit.datum.load}%`, Status: status(hit.datum) },
    },
  })
  const { scene } = view
  scene.environment = 'studio'

  // the room: floor, see-through walls, and two cooling units at the ends
  scene.add(new Mesh({ geometry: plane({ width: 9, depth: 10 }), material: { color: '#c9ced6', roughness: 0.9 }, pickable: false }))
  const wall = { material: { color: '#8a94a6', opacity: 0.25 }, pickable: false }
  scene.add(new Mesh({ ...wall, geometry: box({ width: 9, height: 2.4, depth: 0.12 }), position: [0, 1.2, -5] }))
  scene.add(new Mesh({ ...wall, geometry: box({ width: 0.12, height: 2.4, depth: 10 }), position: [-4.5, 1.2, 0] }))
  for (const x of [-3.9, 3.9]) {
    scene.add(new Mesh({ geometry: box({ width: 0.8, height: 1.9, depth: 2.6 }), material: { color: '#5b6b82', roughness: 0.6 }, position: [x, 0.95, 0], data: { cooling: true } }))
    scene.add(new Label({ text: `CRAC-${x < 0 ? 1 : 2}`, position: [x, 2.2, 0], className: 'demo-tag', overlap: 'show' }))
  }
  // aisle names on the floor
  for (const { z, name } of [{ z: -2.3, name: 'Hot aisle' }, { z: 0, name: 'Cold aisle' }, { z: 2.3, name: 'Hot aisle' }]) {
    scene.add(new Label({ text: name, position: [0, 0.01, z], className: 'demo-floor', overlap: 'show' }))
  }

  const settings = { metric: 'temperature', view: 'isometric', live: true, pulse: true }
  const hall = scene.add(new InstancedMesh({
    geometry: box(1), material: { roughness: 0.55 }, data: racks,
    instances: racks.map((r) => ({ position: [r.x, 1, r.z], scale: [0.6, 2, 0.9] })),
    // rack names: when they collide the hotter rack keeps its label
    labels: { text: (r) => r.id, place: 'above', className: 'demo-value', priority: (r) => r.temp, occlude: true },
  }))
  const recolour = () => {
    const m = METRICS[settings.metric]
    racks.forEach((r, i) => hall.setColor(i, heat((m.value(r) - m.min) / (m.max - m.min))))
  }
  recolour()

  // the heat map's key
  const key = document.createElement('div')
  key.className = 'demo-legend'
  document.body.append(key)
  const showKey = () => {
    const m = METRICS[settings.metric]
    key.innerHTML = `<div class="demo-legend-title">${m.label}</div>
      <div class="demo-legend-gradient" style="background: linear-gradient(to right, ${RAMP.join(', ')})"></div>
      <div class="demo-legend-scale"><span>${m.min} ${m.unit}</span><span>${m.max} ${m.unit}</span></div>`
  }
  showKey()

  const alerts = () => racks.filter((r) => r.temp >= ALERT_TEMP).map((r) => r.id)
  const summary = () => {
    const a = alerts()
    info.textContent = a.length ? `${a.length} rack${a.length > 1 ? 's' : ''} over ${ALERT_TEMP} °C: ${a.join(', ')}` : 'All racks within limits'
  }
  summary()
  view.on('click', (hit) => {
    const r = hit?.datum
    if (!r || r.cooling) return summary()
    info.textContent = `Rack ${r.id}: ${r.temp} °C, ${r.power} kW, ${r.load}% load - ${status(r).toLowerCase()}`
  })

  gui.add(settings, 'view', Object.keys(VIEWS)).onChange((v) => {
    view.camera = /** @type {any} */ (VIEWS[v])
    // the plan view pans like a map; the others turn
    if (view.controls) view.controls.mode = v === 'plan' ? 'map' : 'orbit'
  })
  gui.add(settings, 'metric', Object.keys(METRICS)).onChange(() => {
    recolour()
    showKey()
  })
  gui.add(settings, 'live').name('live telemetry')
  gui.add(settings, 'pulse').name('pulse alerts')
  gui.add({ save: () => view.toImage().then((blob) => download(blob, 'floor-plan.png')) }, 'save').name('export PNG')

  let sinceUpdate = 0
  return view.start((dt, t) => {
    // telemetry drifts a little every couple of seconds
    if (settings.live && (sinceUpdate += dt) > 2) {
      sinceUpdate = 0
      for (const r of racks) {
        r.temp = +Math.min(36, Math.max(18, r.temp + (rand() - 0.5) * 0.8)).toFixed(1)
        r.power = +Math.min(12, Math.max(1, r.power + (rand() - 0.5) * 0.6)).toFixed(1)
      }
      recolour()
      summary()
    }
    // alert racks pulse towards white
    if (settings.pulse) {
      const m = METRICS[settings.metric], k = 0.5 + 0.5 * Math.sin(t * 5)
      racks.forEach((r, i) => {
        if (r.temp >= ALERT_TEMP) hall.setColor(i, heat((m.value(r) - m.min) / (m.max - m.min)).lerp('#ffffff', k * 0.6))
      })
    }
  })
}
