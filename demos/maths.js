import { Label, Mesh, View, sphere as sphereGeometry } from 'phoria2'
import { chart } from 'phoria2/charts'
import source from './maths.js?raw'
import { cardPage, tex } from './cards.js'

// Plots of functions - calculus and geometry: each card a live plot and the code that draws it,
// read from this file between its markers, so what you read is what runs. The sliders change the
// plots' params, and the charts tween to the new shapes. Maths at work is on the science page.

const BG = '#1b1c22'

const CARDS = [
  {
    name: 'surface', title: 'A surface, y = f(x, z)',
    note: 'A function and the sample ranges over it, in place of data. Move a or b and the surface tweens to the new shape; y is pinned, so you see it change.',
  },
  {
    name: 'shapes', title: 'Parametric shapes',
    note: 'Surfaces [x, y, z] = f(u, v) that fold back on themselves with equal units on every axis - keeping their proportions - tweening from one to the next.',
  },
  {
    name: 'contours', title: 'A contour map',
    note: 'Lines of equal height, on the surface and projected onto the floor. More lines, closer heights.',
  },
  {
    name: 'curve', title: 'A curve through space',
    note: 'A 3D Lissajous figure, [x, y, z] = f(t), with a point riding round it. Whole-number frequencies closing the loop.',
  },
  {
    name: 'polar', title: 'Polar curves',
    note: 'A radius for each angle, r = f(θ), drawn with coords: \'polar\' on rings and spokes, like polar graph paper. a = 0 draws a rose; a = 1 with k = 1 is a cardioid; in between are limaçons.',
  },
  {
    name: 'gradient', title: 'Its gradient',
    note: 'Arrows on the floor point up the gradient of the surface above them as long as it is steep. A second chart over the same ranges lining up.',
  },
  {
    name: 'matrix', title: 'A linear map',
    note: 'A 2 × 2 matrix as a field: each arrow is where the map sends its point. Along the white lines the arrows point along them - the map only stretches there: its eigenvectors. Give b and c opposite signs and they go - a rotation.',
  },
]

export default function run({ canvas }) {
  return cardPage({ canvas, cards: CARDS, examples: EXAMPLES, source })
}

const EXAMPLES = { surface, shapes, contours, curve, polar, gradient, matrix }

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
  // the function itself, typeset by KaTeX (tex() below) - with plain text if it can't be
  view.scene.add(new Label({
    content: tex('y = \\sin(a x)\\,\\cos(b z)'), text: 'y = sin(ax) cos(bz)',
    position: [0, 4.6, -5], place: 'above', className: 'maths-tex', overlap: 'show',
  }))
  slider('a', 0.5, 3, p.a, (a) => { p.a = a; plot.update({ params: p }) })
  slider('b', 0.5, 3, p.b, (b) => { p.b = b; plot.update({ params: p }) })
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

// contours
function contours({ canvas, slider }) {
  const view = new View({ canvas, orbit: true, background: BG })
  // hills and hollows (MATLAB's peaks, scaled to within -1 and 1)
  const peaks = (x, z) => (3 * (1 - x) ** 2 * Math.exp(-(x * x) - (z + 1) ** 2)
    - 10 * (x / 5 - x ** 3 - z ** 5) * Math.exp(-(x * x) - z * z) - Math.exp(-((x + 1) ** 2) - z * z) / 3) / 8.5
  const plot = view.scene.add(chart({
    mark: 'surface', fn: peaks, x: [-3, 3], z: [-3, 3], y: [-1, 1], samples: 64, legend: false,
    contours: { count: 12, place: 'both' },
  }))
  slider('lines', 2, 24, 12, (count) => plot.update({ contours: { count, place: 'both' } }), 1)
  return view
}
// end

// curve
function curve({ canvas, slider }) {
  const view = new View({ canvas, orbit: true, background: BG })
  const p = { a: 3, b: 2, c: 5 }
  const lissajous = (t, { a, b, c }) => [Math.sin(a * t + Math.PI / 2), Math.sin(b * t), Math.sin(c * t)]
  const plot = view.scene.add(chart({ mark: 'curve', fn: lissajous, t: [0, 2 * Math.PI], samples: 600, params: p, size: 3, y: { axis: { title: '' } } }))
  const rider = view.scene.add(new Mesh({ geometry: sphereGeometry({ radius: 0.25 }), material: { color: '#ffffff', emissive: '#ffffff' } }))
  // the point rides round in the chart's own coordinates, through its scales
  view.start((dt, time) => {
    const [x, y, z] = lissajous((time * 0.4) % (2 * Math.PI), p)
    rider.position.set(plot.scales.x(x), plot.scales.y(y), plot.scales.z(z))
  })
  view.scene.add(new Label({
    content: tex('\\mathbf{r}(t) = \\begin{pmatrix} \\sin(a t + \\tfrac{\\pi}{2}) \\\\ \\sin(b t) \\\\ \\sin(c t) \\end{pmatrix}'),
    text: 'r(t) = (sin(at + pi/2), sin(bt), sin(ct))', position: [-5, 11, 5], edge: 'left', className: 'maths-tex', overlap: 'show',
  }))
  for (const k of ['a', 'b', 'c']) slider(k, 1, 6, p[k], (v) => { p[k] = v; plot.update({ params: p }) }, 1)
  return view
}
// end

// polar
function polar({ canvas, slider }) {
  const view = new View({ canvas, orbit: true, background: BG, camera: { position: [1.5, 5.5, 15], target: [0, 5, 0] } })
  const p = { a: 0, k: 3 }
  const plot = view.scene.add(chart({
    mark: 'curve', coords: 'polar',
    fn: (theta, { a, k }) => a + Math.cos(k * theta),
    // twice round, so a k ending in .5 closes its loop too - in one colour, as a rose goes over itself
    theta: [0, 4 * Math.PI], samples: 720, params: p, size: 3, color: '#76b7b2',
  }))
  view.scene.add(new Label({
    content: tex('r = a + \\cos(k\\theta)'), text: 'r = a + cos(kθ)',
    position: [-5.5, 10.5, 0], edge: 'left', className: 'maths-tex', overlap: 'show',
  }))
  slider('a', 0, 1.5, p.a, (a) => { p.a = a; plot.update({ params: p }) })
  slider('k', 0.5, 6, p.k, (k) => { p.k = k; plot.update({ params: p }) }, 0.5)
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

// matrix
function matrix({ canvas, slider }) {
  // from high above: a map of the plane reads best looking down on it
  const view = new View({ canvas, orbit: true, background: BG, camera: { position: [0, 13.5, 8], target: [0, 0, 0] } })
  const m = { a: 1, b: 0.6, c: 0.2, d: -0.5 }
  const ranges = { x: [-2, 2], z: [-2, 2] }
  const plot = view.scene.add(chart({
    mark: 'vector', fn: (x, y, z, { a, b, c, d }) => [a * x + b * z, 0, c * x + d * z],
    ...ranges, samples: 11, params: m, legend: false, frame: 'origin',
  }))
  // the eigenvectors: lines through the origin, where the map's matrix has real eigenvalues
  const eigenLines = () => {
    const { a, b, c, d } = m, tr = a + d, disc = tr * tr - 4 * (a * d - b * c)
    if (disc < 0) return null
    return [(tr + Math.sqrt(disc)) / 2, (tr - Math.sqrt(disc)) / 2].flatMap((l, i) => {
      const [vx, vz] = Math.abs(b) > 1e-9 ? [b, l - a] : Math.abs(c) > 1e-9 ? [l - d, c] : i ? [0, 1] : [1, 0]
      const k = 2 / Math.max(Math.abs(vx), Math.abs(vz))
      return [{ x: -vx * k, y: 0, z: -vz * k, line: i }, { x: vx * k, y: 0, z: vz * k, line: i }]
    })
  }
  const pinned = (field, domain) => ({ field, scale: { domain, nice: false } })
  const lines = view.scene.add(chart({
    mark: 'curve', data: eigenLines() ?? [], x: pinned('x', ranges.x), y: 'y', z: pinned('z', ranges.z),
    detail: 'line', color: '#ffffff', size: 2, frame: false, tooltip: false,
  }))
  // the matrix, typeset again into the same element as it changes - the label follows its new size
  const n = (v) => String(+v.toFixed(2))
  const matrixTex = () => `A = \\begin{pmatrix} ${n(m.a)} & ${n(m.b)} \\\\ ${n(m.c)} & ${n(m.d)} \\end{pmatrix}`
  const formula = view.scene.add(new Label({
    content: tex(matrixTex()), text: 'the matrix A',
    position: [plot.scales.x(-2.2), 0, plot.scales.z(1.4)], place: 'left', className: 'maths-tex', overlap: 'show',
  }))
  for (const k of ['a', 'b', 'c', 'd']) {
    slider(k, -1.5, 1.5, m[k], (v) => {
      m[k] = v
      plot.update({ params: m })
      if (formula.content) tex(matrixTex(), formula.content)
      const rows = eigenLines()
      lines.visible = !!rows
      if (rows) lines.update(rows)
    })
  }
  return view
}
// end
