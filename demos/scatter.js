import { Geometry, Label, Lines, Points, View, box, edges, grid } from 'phoria2'
import { legend, random } from './kit.js'

// made-up customers in three segments: spend ($k a year), visits a month and tenure (years)
const SEGMENTS = [
  { name: 'Enterprise', color: '#4e79a7', count: 150, centre: [72, 62, 7], spread: [12, 13, 1.6] },
  { name: 'Mid-market', color: '#f28e2b', count: 350, centre: [42, 34, 4.5], spread: [11, 11, 1.4] },
  { name: 'Small business', color: '#59a14f', count: 350, centre: [16, 50, 2], spread: [8, 14, 1.1] },
]
const AXES = [
  { name: 'Spend ($k)', max: 100 },
  { name: 'Visits / month', max: 100 },
  { name: 'Tenure (years)', max: 10 },
]
const SIZE = 8
// the views: the 3D chart, and three flat projections through the camera presets
const VIEWS = { '3D': 'perspective', 'Spend x Visits': 'front', 'Spend x Tenure': 'top', 'Tenure x Visits': 'side' }

// A 3D scatter chart: each segment is one Points node with its rows bound to it, so hovering a point
// shows that customer and clicking selects them. The legend turns segments on and off; the view
// control flattens the chart into any two of its axes with an orthographic preset.
export default function run({ canvas, gui, info }) {
  const rand = random(7)
  const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand())
  const clamp = (v, max) => Math.min(max, Math.max(0, v))
  let n = 0
  const segments = SEGMENTS.map((seg) => ({ ...seg, rows: makeRows(seg) }))
  function makeRows(seg) {
    return Array.from({ length: seg.count }, () => ({
      name: `Customer ${String(++n).padStart(4, '0')}`, segment: seg.name,
      spend: Math.round(clamp(seg.centre[0] + gauss() * seg.spread[0], 100)),
      visits: Math.round(clamp(seg.centre[1] + gauss() * seg.spread[1], 100)),
      tenure: +clamp(seg.centre[2] + gauss() * seg.spread[2], 10).toFixed(1),
    }))
  }
  // data to chart space: each axis 0..SIZE
  const toChart = (row) => [row.spend / AXES[0].max * SIZE, row.visits / AXES[1].max * SIZE, row.tenure / AXES[2].max * SIZE]

  const view = new View({
    canvas, orbit: true, background: '#18181c', camera: 'perspective', highlight: '#ffffff',
    tooltip: (hit) => hit.datum && {
      title: hit.datum.name,
      rows: { Segment: hit.datum.segment, Spend: `$${hit.datum.spend}k`, Visits: `${hit.datum.visits} / month`, Tenure: `${hit.datum.tenure} years` },
    },
  })
  const { scene } = view

  // the chart box: a floor and two back walls of grid lines, and the box's edges
  const wall = { geometry: grid({ size: SIZE, divisions: 4 }), material: { color: '#34343c' }, pickable: false }
  scene.add(new Lines({ ...wall, position: [SIZE / 2, 0, SIZE / 2] }))
  scene.add(new Lines({ ...wall, position: [SIZE / 2, SIZE / 2, 0], rotation: [-Math.PI / 2, 0, 0] }))
  scene.add(new Lines({ ...wall, position: [0, SIZE / 2, SIZE / 2], rotation: [0, 0, Math.PI / 2] }))
  scene.add(new Lines({ geometry: edges(box(SIZE)), material: { color: '#2a2a32' }, position: [SIZE / 2, SIZE / 2, SIZE / 2], pickable: false }))

  // ticks give way to each other and to the axis titles - in a flat projection one axis collapses
  /** @param {string} text @param {number[]} position @param {'center' | 'left'} [place] */
  const tick = (text, position, place = 'center') => scene.add(new Label({ text, position, place, className: 'demo-tick', priority: 1 }))
  for (let i = 0; i <= 4; i++) {
    const t = i / 4 * SIZE
    tick(String(AXES[0].max * i / 4), [t, 0, SIZE + 0.4])
    tick(String(AXES[1].max * i / 4), [-0.3, t, 0], 'left')
    tick(String(AXES[2].max * i / 4), [SIZE + 0.4, 0, t])
  }
  scene.add(new Label({ text: AXES[0].name, position: [SIZE / 2, 0, SIZE + 1.3], className: 'demo-axis', priority: 2 }))
  scene.add(new Label({ text: AXES[1].name, position: [-1.4, SIZE / 2, 0], place: 'left', className: 'demo-axis', priority: 2 }))
  scene.add(new Label({ text: AXES[2].name, position: [SIZE + 1.6, 0, SIZE / 2], className: 'demo-axis', priority: 2 }))

  const clouds = segments.map((seg) => scene.add(new Points({
    geometry: new Geometry({ positions: seg.rows.flatMap(toChart) }),
    material: { color: seg.color, size: 0.2 },
    data: seg.rows,
  })))

  legend(segments.map((s) => ({ label: `${s.name} (${s.rows.length})`, color: s.color })), {
    title: 'Segment',
    onToggle: (i, on) => { clouds[i].visible = on },
  })

  info.textContent = 'Hover a customer, click to select'
  view.on('click', (hit) => {
    const d = hit?.datum
    info.textContent = d ? `Selected ${d.name} - ${d.segment}, $${d.spend}k a year` : 'Hover a customer, click to select'
  })

  const settings = { view: '3D' }
  gui.add(settings, 'view', Object.keys(VIEWS)).onChange((name) => {
    view.camera = /** @type {any} */ (VIEWS[name])
    // the flat projections pan rather than turn, like a 2D chart
    if (view.controls) view.controls.mode = name === '3D' ? 'orbit' : 'map'
  })
  gui.add(clouds[0].material, 'size', 0.05, 0.6, 0.01).name('point size').onChange((v) => clouds.forEach((c) => { c.material.size = v }))

  return view
}
