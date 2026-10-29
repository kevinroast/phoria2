import { View } from 'phoria2'
import { chart } from 'phoria2/charts'
import { random, showSpec } from './kit.js'

const SEGMENTS = [
  { name: 'Enterprise', count: 150, centre: [72, 62, 7], spread: [12, 13, 1.6] },
  { name: 'Mid-market', count: 350, centre: [42, 34, 4.5], spread: [11, 11, 1.4] },
  { name: 'Small business', count: 350, centre: [16, 50, 2], spread: [8, 14, 1.1] },
]
// the 3D chart, and three flat projections through the camera presets
const VIEWS = { '3D': 'perspective', 'Spend x Visits': 'front', 'Spend x Tenure': 'top', 'Tenure x Visits': 'side' }

// A 3D scatter of made-up customers from a spec: the legend turns segments off, hovering shows a
// customer, and the view control flattens the chart into two of its axes - the walls and ticks
// follow the camera, so each projection reads as a 2D chart.
export default function run({ canvas, gui, info }) {
  const rand = random(7)
  const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand())
  const clamp = (v, max) => +Math.min(max, Math.max(0, v)).toFixed(1)
  let n = 0
  const customers = SEGMENTS.flatMap((s) => Array.from({ length: s.count }, () => ({
    name: `Customer ${String(++n).padStart(4, '0')}`, segment: s.name,
    spend: Math.round(clamp(s.centre[0] + gauss() * s.spread[0], 100)),
    visits: Math.round(clamp(s.centre[1] + gauss() * s.spread[1], 100)),
    tenure: clamp(s.centre[2] + gauss() * s.spread[2], 10),
  })))

  const view = new View({ canvas, orbit: true, background: '#18181c', camera: 'perspective' })
  const customersChart = view.scene.add(chart({
    mark: 'point', data: customers,
    x: { field: 'spend', title: 'Spend ($k)' }, y: { field: 'visits', title: 'Visits / month' }, z: { field: 'tenure', title: 'Tenure (years)' },
    color: { field: 'segment', title: 'Segment' },
    tooltip: ['name', 'segment', 'spend', 'visits', 'tenure'],
    legend: { position: 'bottom-right' },
  }))

  info.textContent = 'Hover a customer, click to select'
  view.on('click', (hit) => {
    const d = hit?.datum
    info.textContent = d ? `Selected ${d.name} - ${d.segment}, $${d.spend}k a year` : 'Hover a customer, click to select'
  })
  gui.add({ view: '3D' }, 'view', Object.keys(VIEWS)).onChange((name) => {
    view.camera = /** @type {any} */ (VIEWS[name])
    // the flat projections pan rather than turn, like a 2D chart
    if (view.controls) view.controls.mode = name === '3D' ? 'orbit' : 'map'
  })
  showSpec(gui, customersChart)
  return view
}
