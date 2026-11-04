import { Color, View } from 'phoria2'
import { chart } from 'phoria2/charts'
import { random, showSpec } from './kit.js'

const SEGMENTS = [
  { name: 'Enterprise', count: 150, centre: [72, 62, 7], spread: [12, 13, 1.6] },
  { name: 'Mid-market', count: 350, centre: [42, 34, 4.5], spread: [11, 11, 1.4] },
  { name: 'Small business', count: 350, centre: [16, 50, 2], spread: [8, 14, 1.1] },
]
// the 3D chart, and three flat projections through the camera presets
const VIEWS = { '3D': 'perspective', 'Spend x Visits': 'front', 'Spend x Tenure': 'top', 'Tenure x Visits': 'side' }
// what dragging does: turn the chart, or select the customers in a box or a lasso drawn over it
const DRAGS = ['orbit', 'box select', 'lasso select']
const UNSELECTED = new Color('#34343c').toSRGB()

// A 3D scatter of made-up customers from a spec: the legend turns segments off, hovering shows a
// customer, and the view control flattens the chart into two of its axes - the walls and ticks
// follow the camera, so each projection reads as a 2D chart. Switch dragging to a box or lasso to
// select a region of customers - view.pickArea() finds every point inside it, front to back - and
// the rest are greyed out while the selection is summed up.
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

  const view = new View({ canvas, orbit: true, background: '#18181c', camera: 'perspective', keyboard: true })
  const customersChart = view.scene.add(chart({
    mark: 'point', data: customers,
    x: { field: 'spend', title: 'Spend ($k)' }, y: { field: 'visits', title: 'Visits / month' }, z: { field: 'tenure', title: 'Tenure (years)' },
    color: { field: 'segment', title: 'Segment' },
    tooltip: ['name', 'segment', 'spend', 'visits', 'tenure'],
    legend: { position: 'bottom-right' },
  }))
  // the points: the chart's one Points node, a point a customer with its row bound, coloured through
  // the geometry's colours
  let marks = /** @type {import('phoria2').Points | null} */ (null)
  customersChart.traverse((node) => { if (/** @type {any} */ (node).drawMode === 'points' && Array.isArray(/** @type {any} */ (node).data)) marks = /** @type {any} */ (node) })

  const hint = () => (settings.drag === 'orbit' ? 'Hover a customer, click to select' : `Drag a ${settings.drag === 'box select' ? 'box' : 'lasso'} round customers to select them`)
  const settings = { view: '3D', drag: 'lasso select' }
  info.textContent = hint()
  // lasso to start with: a drag selects, so the chart doesn't turn
  if (view.controls) view.controls.enabled = false
  view.on('click', (hit) => {
    if (settings.drag !== 'orbit') return
    const d = hit?.datum
    info.textContent = d ? `Selected ${d.name} - ${d.segment}, $${d.spend}k a year` : hint()
  })

  // ---- selecting an area: the shape drawn over the canvas as the pointer drags, then everything
  // inside it picked, the rest greyed out
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  Object.assign(svg.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' })
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  shape.setAttribute('style', 'fill: rgba(127, 211, 255, 0.12); stroke: #7fd3ff; stroke-width: 1.5; stroke-dasharray: 5 4')
  svg.append(shape)
  document.body.append(svg)
  /** @type {Float32Array | null} the points' own colours, while some are greyed out */
  let colours = null
  const paint = () => /** @type {import('phoria2').Points} */ (marks).geometry.needsUpdate()
  /** @type {[number, number][]} */
  let drawn = []
  const at = (/** @type {PointerEvent} */ e) => {
    const r = canvas.getBoundingClientRect()
    return /** @type {[number, number]} */ ([e.clientX - r.left, e.clientY - r.top])
  }
  const box = () => {
    const [[x0, y0], [x1, y1]] = [drawn[0], drawn[drawn.length - 1]]
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
  }
  // the shape in the window, where the drawing layer is
  const outline = () => {
    const r = canvas.getBoundingClientRect()
    if (settings.drag === 'box select') {
      const { x, y, width, height } = box()
      return `M${x + r.left},${y + r.top}h${width}v${height}h${-width}Z`
    }
    return `M${drawn.map(([x, y]) => `${x + r.left},${y + r.top}`).join('L')}Z`
  }
  const restore = () => {
    if (marks && colours) {
      /** @type {Float32Array} */ (marks.geometry.colors).set(colours)
      paint()
    }
    colours = null
  }
  /** @param {import('phoria2').Hit[]} hits */
  const select = (hits) => {
    restore()
    const picked = hits.filter((h) => h.node === marks)
    const chosen = new Set(picked.map((h) => /** @type {number} */ (h.face)))
    if (!marks || !chosen.size) {
      info.textContent = `Nothing there - ${hint().toLowerCase()}`
      return
    }
    const own = /** @type {Float32Array} */ (marks.geometry.colors)
    colours = Float32Array.from(own)
    for (let i = 0; i < own.length / 3; i++) if (!chosen.has(i)) own.set(UNSELECTED, i * 3)
    paint()
    const rows = picked.map((h) => h.datum)
    const bySegment = SEGMENTS.map((s) => [s.name, rows.filter((r) => r.segment === s.name).length]).filter(([, count]) => count)
    const mean = (key) => Math.round(rows.reduce((sum, r) => sum + r[key], 0) / rows.length)
    info.textContent = `${rows.length} selected (${bySegment.map(([s, count]) => `${count} ${s}`).join(', ')}) - average spend $${mean('spend')}k, ${mean('visits')} visits a month`
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (settings.drag === 'orbit' || e.button !== 0) return
    drawn = [at(e)]
    canvas.setPointerCapture(e.pointerId)
  })
  canvas.addEventListener('pointermove', (e) => {
    if (!drawn.length) return
    const p = at(e), last = drawn[drawn.length - 1]
    // a box needs only its corners; a lasso a point every few pixels
    if (settings.drag === 'box select') drawn = [drawn[0], p]
    else if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 4) drawn.push(p)
    shape.setAttribute('d', outline())
  })
  canvas.addEventListener('pointerup', () => {
    if (!drawn.length) return
    const dragged = drawn.length > 1 && (settings.drag === 'box select' ? Math.abs(box().width) + Math.abs(box().height) > 6 : drawn.length > 3)
    // a click without a drag clears the selection
    if (dragged) select(view.pickArea(settings.drag === 'box select' ? box() : drawn))
    else {
      restore()
      info.textContent = hint()
    }
    drawn = []
    shape.setAttribute('d', '')
  })

  gui.add(settings, 'view', Object.keys(VIEWS)).onChange((name) => {
    view.camera = /** @type {any} */ (VIEWS[name])
    // the flat projections pan rather than turn, like a 2D chart
    if (view.controls) view.controls.mode = name === '3D' ? 'orbit' : 'map'
  })
  gui.add(settings, 'drag', DRAGS).onChange(() => {
    // while selecting, a drag draws the shape rather than turning the chart
    if (view.controls) view.controls.enabled = settings.drag === 'orbit'
    if (!colours) info.textContent = hint()
  })
  showSpec(gui, customersChart)
  return view
}
