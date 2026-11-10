import { Mesh, View, sphere as sphereGeometry } from 'phoria2'
import { chart } from 'phoria2/charts'
import source from './maths.js?raw'
import { random } from './kit.js'

// Plots of functions: each card a live plot and the code that draws it - read from this file,
// between its markers, so what you read is what runs. The sliders change the plots' params, and
// the charts tween to the new shapes.

const BG = '#1b1c22'

const CARDS = [
  {
    name: 'surface', title: 'A surface, y = f(x, z)',
    note: 'A function and the ranges to sample it over, in place of data. Move a or b and the surface tweens to the new shape; y is pinned, so you see it change.',
  },
  {
    name: 'gradient', title: 'Its gradient',
    note: 'Arrows on the floor point uphill - the gradient of the surface above them, as long as it is steep. A second chart over the same ranges, so the two line up.',
  },
  {
    name: 'curve', title: 'A curve through space',
    note: 'A 3D Lissajous figure, [x, y, z] = f(t), with a point riding round it. Whole-number frequencies close the loop.',
  },
  {
    name: 'shapes', title: 'Parametric shapes',
    note: 'Surfaces [x, y, z] = f(u, v) that fold back on themselves, with equal units on every axis so they keep their proportions - tweening from one to the next.',
  },
  {
    name: 'descent', title: 'Gradient descent',
    note: 'A loss landscape and an optimiser rolling down it. Too high a learning rate and it overshoots; momentum carries it through the shallow valley.',
  },
  {
    name: 'field', title: 'An electric field',
    note: 'The field round two charges, on a plane. Arrow lengths and colours follow the log of its strength, so the far field still shows its way; change the second charge and the field swings.',
  },
  {
    name: 'response', title: 'A response surface',
    note: 'A fitted model of yield over temperature and pressure, with the measurements it was fitted to. Hover the surface or a point to read it.',
  },
]

export default function run({ canvas }) {
  canvas.style.display = 'none'
  const page = document.createElement('div')
  page.className = 'demo-cards demo-maths'
  const views = []
  for (const card of CARDS) {
    const section = document.createElement('section')
    section.className = 'demo-cards-card'
    const h = document.createElement('h3')
    h.textContent = card.title
    const p = document.createElement('p')
    p.textContent = card.note
    const live = document.createElement('canvas')
    live.className = 'demo-maths-canvas'
    const row = document.createElement('div')
    row.className = 'demo-cards-row'
    const pre = document.createElement('pre')
    pre.textContent = sourceOf(card.name)
    section.append(h, p, live, row, pre)
    page.append(section)
    card.section = section
    card.canvas = live
    card.row = row
  }
  document.body.append(page)
  // below the title panel, with the page's usual 16px between
  const title = document.querySelector('.hud-title')
  const place = () => { page.style.top = `${title.getBoundingClientRect().bottom + 16}px` }
  new ResizeObserver(place).observe(title)
  place()
  for (const card of CARDS) views.push(EXAMPLES[card.name]({ canvas: card.canvas, slider: sliders(card.row) }))
  // every plot's view, for poking at from the console in dev (window.view is the first)
  if (import.meta.env.DEV) Object.assign(window, { views })
  return views[0]
}

const EXAMPLES = { surface, gradient, curve, shapes, descent, field, response }

// surface
function surface({ canvas, slider }) {
  const view = new View({ canvas, orbit: true, background: BG })
  const p = { a: 1, b: 1 }
  const plot = view.scene.add(chart({
    mark: 'surface',
    fn: (x, z, { a, b }) => Math.sin(a * x) * Math.cos(b * z),
    x: [-3, 3], z: [-3, 3], y: [-1, 1],
    params: p, samples: 64, legend: false,
  }))
  slider('a', 0.5, 3, p.a, (a) => { p.a = a; plot.update({ params: p }) })
  slider('b', 0.5, 3, p.b, (b) => { p.b = b; plot.update({ params: p }) })
  return view
}
// end

// gradient
function gradient({ canvas }) {
  const view = new View({ canvas, orbit: true, background: BG })
  const f = (x, z) => Math.exp(-(x * x + z * z) / 3) * Math.cos(x) + 0.3 * Math.sin(z)
  const box = [10, 4, 10]
  const surface = view.scene.add(chart({ mark: 'surface', fn: f, x: [-3, 3], z: [-3, 3], y: [-1.2, 1.2], box, legend: false, samples: 48 }))
  // see-through, so the arrows show beneath it
  surface.marks[0].material.opacity = 0.55
  // the gradient by central differences: x and z only, laid on the floor (one layer, at y's start)
  const h = 1e-3
  view.scene.add(chart({
    mark: 'vector',
    fn: (x, y, z) => [(f(x + h, z) - f(x - h, z)) / (2 * h), 0, (f(x, z + h) - f(x, z - h)) / (2 * h)],
    x: [-3, 3], y: [-1.2, 1.2], z: [-3, 3], samples: [13, 1, 13],
    box, equal: false, frame: false, legend: false,
  }))
  return view
}
// end

// curve
function curve({ canvas, slider }) {
  const view = new View({ canvas, orbit: true, background: BG })
  const p = { a: 3, b: 2, c: 5 }
  const lissajous = (t, { a, b, c }) => [Math.sin(a * t + Math.PI / 2), Math.sin(b * t), Math.sin(c * t)]
  const plot = view.scene.add(chart({ mark: 'curve', fn: lissajous, t: [0, 2 * Math.PI], samples: 600, params: p, size: 3 }))
  const rider = view.scene.add(new Mesh({ geometry: sphereGeometry({ radius: 0.25 }), material: { color: '#ffffff', emissive: '#ffffff' } }))
  // the point rides round in the chart's own coordinates, through its scales
  view.start((dt, time) => {
    const [x, y, z] = lissajous((time * 0.4) % (2 * Math.PI), p)
    rider.position.set(plot.scales.x(x), plot.scales.y(y), plot.scales.z(z))
  })
  for (const k of ['a', 'b', 'c']) slider(k, 1, 6, p[k], (v) => { p[k] = v; plot.update({ params: p }) }, 1)
  return view
}
// end

// shapes
function shapes({ canvas }) {
  // looking at the middle of the shapes' box, close enough to fill the card
  const view = new View({ canvas, orbit: { autoRotate: 0.3 }, background: BG, camera: { position: [0, 8.5, 9.5], target: [0, 5, 0] } })
  view.scene.environment = 'studio'
  const TAU = 2 * Math.PI
  const SHAPES = [
    { u: [0, TAU], v: [0, Math.PI], fn: (u, v) => [Math.cos(u) * Math.sin(v), Math.cos(v), Math.sin(u) * Math.sin(v)] },
    { u: [0, TAU], v: [0, TAU], fn: (u, v) => [(1 + 0.4 * Math.cos(v)) * Math.cos(u), 0.4 * Math.sin(v), (1 + 0.4 * Math.cos(v)) * Math.sin(u)] },
    { u: [0, TAU], v: [-0.5, 0.5], fn: (u, v) => [(1 + v * Math.cos(u / 2)) * Math.cos(u), v * Math.sin(u / 2), (1 + v * Math.cos(u / 2)) * Math.sin(u)] },
    { u: [0, TAU], v: [0, TAU], fn: (u, v) => { // a Klein bottle - the figure-8 immersion, scaled to fit
      const r = 2 + Math.cos(u / 2) * Math.sin(v) - Math.sin(u / 2) * Math.sin(2 * v)
      return [r * Math.cos(u) * 0.4, (Math.sin(u / 2) * Math.sin(v) + Math.cos(u / 2) * Math.sin(2 * v)) * 0.4, r * Math.sin(u) * 0.4]
    } },
  ]
  // every shape in the same cube, so each sits in its middle - and the morphs stay put
  const cube = { x: [-1.6, 1.6], y: [-1.6, 1.6], z: [-1.6, 1.6] }
  // coloured by height over each shape's own heights - the y axis is the cube's, so a flat shape
  // coloured by the axis would be one colour
  const plot = view.scene.add(chart({ mark: 'surface', ...SHAPES[0], ...cube, color: 'y', samples: 72, frame: false, legend: false, transition: { duration: 1.2, ease: 'inOut' } }))
  let shown = 0, since = 0
  view.start((dt) => {
    if ((since += dt) < 3.5) return
    since = 0
    shown = (shown + 1) % SHAPES.length
    plot.update(SHAPES[shown])
  })
  return view
}
// end

// descent
function descent({ canvas, slider }) {
  const view = new View({ canvas, orbit: true, background: BG })
  // a valley with two basins, the left one deeper; its gradient by hand
  const loss = (x, z) => 0.25 * (x * x - 1) ** 2 + 0.5 * z * z + 0.15 * x
  const grad = (x, z) => [x * (x * x - 1) + 0.15, z]
  const ranges = { x: [-2, 2], z: [-1.6, 1.6], y: [-0.4, 3] }, box = [10, 4, 8]
  view.scene.add(chart({ mark: 'surface', fn: loss, ...ranges, box, legend: false, samples: 56 }))
  const pinned = (field, domain) => ({ field, scale: { domain, nice: false } })
  const o = { rate: 0.12, momentum: 0.6 }
  const path = () => {
    const rows = []
    let x = 1.9, z = 1.5, vx = 0, vz = 0
    for (let i = 0; i < 120; i++) {
      rows.push({ x, z, y: loss(x, z) + 0.03 })
      const [gx, gz] = grad(x, z)
      vx = o.momentum * vx - o.rate * gx
      vz = o.momentum * vz - o.rate * gz
      x = Math.max(-2, Math.min(2, x + vx))
      z = Math.max(-1.6, Math.min(1.6, z + vz))
    }
    return rows
  }
  const walk = view.scene.add(chart({
    mark: 'curve', data: path(), x: pinned('x', ranges.x), y: pinned('y', ranges.y), z: pinned('z', ranges.z),
    color: '#ffffff', size: 3, box, equal: false, frame: false, tooltip: false,
  }))
  slider('learning rate', 0.02, 0.3, o.rate, (v) => { o.rate = v; walk.update(path()) }, 0.01)
  slider('momentum', 0, 0.95, o.momentum, (v) => { o.momentum = v; walk.update(path()) }, 0.05)
  return view
}
// end

// field
function field({ canvas, slider }) {
  const view = new View({ canvas, orbit: true, background: BG })
  const p = { q: -1 }
  const charges = (q) => [{ x: -1, z: 0, q: 1 }, { x: 1, z: 0, q }]
  const plot = view.scene.add(chart({
    mark: 'vector',
    fn: (x, y, z, { q }) => {
      let ex = 0, ez = 0
      for (const c of charges(q)) {
        const dx = x - c.x, dz = z - c.z, r3 = Math.max(Math.hypot(dx, dz), 0.25) ** 3
        ex += c.q * dx / r3
        ez += c.q * dz / r3
      }
      // 0.3 to 1 long by the log of the field's strength, so the far field still shows its way
      const m = Math.hypot(ex, ez) || 1, strength = Math.min(1, Math.max(0, (Math.log10(m) + 1.5) / 2.5))
      return [ex / m * (0.3 + 0.7 * strength), 0, ez / m * (0.3 + 0.7 * strength)]
    },
    x: [-3, 3], z: [-2, 2], samples: [19, 13], params: p,
    color: { field: 'magnitude', scale: { scheme: 'heat' } }, legend: false,
  }))
  const balls = charges(p.q).map(() => view.scene.add(new Mesh({ geometry: sphereGeometry({ radius: 0.3 }) })))
  const show = () => charges(p.q).forEach((c, i) => {
    balls[i].position.set(plot.scales.x(c.x), plot.scales.y(0), plot.scales.z(c.z))
    balls[i].material.color.set(c.q > 0 ? '#ff6b6b' : c.q < 0 ? '#4fc3f7' : '#888888')
  })
  show()
  slider('second charge', -2, 2, p.q, (q) => { p.q = q; plot.update({ params: p }); show() }, 0.1)
  return view
}
// end

// response
function response({ canvas }) {
  const view = new View({ canvas, orbit: true, background: BG })
  // the fitted model, and the measurements it came from (made up here, with noise)
  const model = (t, p) => 88 - (t - 62) ** 2 / 45 - 3.5 * (p - 3.2) ** 2 + 0.08 * (t - 62) * (p - 3.2)
  const rand = random(7)
  const measured = Array.from({ length: 40 }, () => {
    const t = 20 + rand() * 80, p = 1 + rand() * 4
    return { temperature: t, pressure: p, yield: model(t, p) + (rand() - 0.5) * 8 }
  })
  const x = { domain: [20, 100], title: 'Temperature (°C)' }, z = { domain: [1, 5], title: 'Pressure (bar)' }
  const y = { domain: [20, 95], title: 'Yield (%)' }
  view.scene.add(chart({ mark: 'surface', fn: model, x, z, y, legend: false, samples: 40 }))
  const pinned = (field, c) => ({ field, title: c.title, scale: { domain: c.domain, nice: false } })
  view.scene.add(chart({
    mark: 'point', data: measured, x: pinned('temperature', x), z: pinned('pressure', z), y: pinned('yield', y),
    color: '#ffffff', box: [10, 4, 10], frame: false,
  }))
  return view
}
// end

/** An example's code as it reads, between its markers. @param {string} name */
function sourceOf(name) {
  const lines = source.split('\n')
  const from = lines.findIndex((l) => l.trim() === `// ${name}`) + 1
  const to = lines.findIndex((l, i) => i > from && l.trim() === '// end')
  return lines.slice(from, to).join('\n')
}

/**
 * Sliders in a card's row: each a label, a range input and its value.
 * @param {HTMLElement} row
 */
function sliders(row) {
  return (/** @type {string} */ name, /** @type {number} */ min, /** @type {number} */ max, /** @type {number} */ value, /** @type {(v: number) => void} */ change, step = 0.05) => {
    const label = document.createElement('label')
    const input = Object.assign(document.createElement('input'), { type: 'range', min, max, step, value })
    const shown = document.createElement('span')
    const say = () => { shown.textContent = String(+(+input.value).toFixed(2)) }
    say()
    input.addEventListener('input', () => {
      say()
      change(+input.value)
    })
    label.append(`${name} `, input, shown)
    row.append(label)
  }
}
