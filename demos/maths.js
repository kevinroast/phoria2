import { Label, Mesh, View, sphere as sphereGeometry } from 'phoria2'
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
    note: 'A function and the sample ranges over it, in place of data. Move a or b and the surface tweens to the new shape; y is pinned, so you see it change.',
  },
  {
    name: 'waves', title: 'Waves',
    note: 'Ripples spread from two sources - adding where crests meet, cancelling in a trough. With "time: true" the function is given the time as t, so the surface moves. Drag the sliders to move the sources apart or change the wavelength.',
  },
  {
    name: 'shapes', title: 'Parametric shapes',
    note: 'Surfaces [x, y, z] = f(u, v) that fold back on themselves with equal units on every axis - keeping their proportions - tweening from one to the next.',
  },
  {
    name: 'response', title: 'A response surface',
    note: 'A fitted model of yield over temperature and pressure, with the measurements it was fitted to. Hover the surface or a point to read it.',
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
    name: 'descent', title: 'Gradient descent',
    note: 'A loss landscape and an optimiser rolling down it. Too high a learning rate and it overshoots; momentum carries it through the shallow valley.',
  },
  {
    name: 'field', title: 'An electric field',
    note: 'The field round two charges on a plane. Arrow lengths and colours follow the log of its strength. Change the second charge and the field swings.',
  },
  {
    name: 'microphones', title: 'Microphone patterns',
    note: 'The datasheet picture: how a microphone hears from each direction, in dB, one curve per pattern - polar data, read off its labelled rings. 0° is straight ahead.',
  },
  {
    name: 'antenna', title: 'An antenna pattern',
    note: 'Measured data, not a formula: a Yagi antenna\'s gain in dBi every 5° round and down, as an antenna range records it - the rows drawn with coords: \'spherical\' and angles in degrees. r\'s domain puts -20 dBi at the centre. More elements, a narrower beam.',
  },
  {
    name: 'orbitals', title: 'Atomic orbitals',
    note: 'The shapes of electron orbitals: spherical harmonics, drawn with coords: \'spherical\' as a radius over the angles. The two colours are the sign of the wave - its phase. Pick l and m: l = 0 is s, 1 is p, 2 is d and 3 is f.',
  },
  {
    name: 'matrix', title: 'A linear map',
    note: 'A 2 × 2 matrix as a field: each arrow is where the map sends its point. Along the white lines the arrows point along them - the map only stretches there: its eigenvectors. Give b and c opposite signs and they go - a rotation.',
  },
]

export default async function run({ canvas }) {
  canvas.style.display = 'none'
  // the formulas on the cards are typeset by KaTeX, loaded from the CDN for this page only
  await loadKatex()
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

const EXAMPLES = { surface, waves, gradient, contours, curve, polar, shapes, orbitals, antenna, microphones, descent, field, matrix, response }

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

// waves
function waves({ canvas, slider }) {
  const view = new View({ canvas, orbit: true, background: BG })
  const p = { apart: 2, wavelength: 1.6 }
  // a ripple spreading from a source as t goes on, fading as it goes
  const ripple = (r, t, wavelength) => Math.sin((2 * Math.PI / wavelength) * r - 3 * t) / Math.sqrt(1 + r)
  const plot = view.scene.add(chart({
    mark: 'surface',
    // where crests meet they add; where a crest meets a trough they cancel
    fn: (x, z, { t, apart, wavelength }) => ripple(Math.hypot(x - apart / 2, z), t, wavelength) + ripple(Math.hypot(x + apart / 2, z), t, wavelength),
    x: [-4, 4], z: [-4, 4], y: { domain: [-1.6, 1.6], axis: { ticks: 3 } }, box: [10, 2.5, 10], params: p, time: true, samples: 84, legend: false,
    color: { field: 'y', scale: { scheme: 'blues' } },
  }))
  view.scene.add(new Label({
    content: tex('y = \\sum_{i=1}^{2} \\frac{\\sin(k r_i - 3t)}{\\sqrt{1 + r_i}}'), text: 'y = sum of sin(k r - 3t) / sqrt(1 + r)',
    position: [0, 3.1, -5], place: 'above', className: 'maths-tex', overlap: 'show',
  }))
  slider('apart', 0.5, 4, p.apart, (v) => { p.apart = v; plot.update({ params: p }) })
  slider('wavelength', 0.8, 3, p.wavelength, (v) => { p.wavelength = v; plot.update({ params: p }) })
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

// orbitals
function orbitals({ canvas, slider }) {
  const view = new View({ canvas, orbit: { autoRotate: 0.25 }, background: BG, camera: { position: [8.5, 10.5, 13.5], target: [0, 5.3, 0] } })
  const p = { l: 2, m: 0 }
  // each shape scaled so its largest lobe reaches 1 - the shapes are the point here, not their sizes
  let scale = 1 / peak(p.l, p.m)
  const plot = view.scene.add(chart({
    mark: 'surface', coords: 'spherical',
    // the radius is the harmonic's size, and its sign a field to colour by: the + and - lobes
    fn: (theta, phi, { l, m }) => {
      const y = harmonic(l, m, phi, theta) * scale
      return { r: Math.abs(y), sign: y < 0 ? '−' : '+' }
    },
    params: p, samples: 72, legend: false, transition: { duration: 0.8, ease: 'inOut' },
    color: { field: 'sign', scale: { domain: ['+', '−'], range: ['#f28e2b', '#4e79a7'] } },
    // the same box for every shape, so each grows and shrinks in place - with no ticks, as the sizes
    // are scaled - and the axes named as chemists name them, z up
    x: { domain: [-1, 1], title: 'x', axis: { ticks: [] } }, y: { domain: [-1, 1], title: 'z', axis: { ticks: [] } }, z: { domain: [-1, 1], title: 'y', axis: { ticks: [] } },
  }))
  const formula = view.scene.add(new Label({
    content: tex(orbitalTex(p.l, p.m)), text: `r = |Y(l = ${p.l}, m = ${p.m})|`,
    position: [-6, 10, 5], edge: 'left', className: 'maths-tex', overlap: 'show',
  }))
  const show = () => {
    scale = 1 / peak(p.l, p.m)
    plot.update({ params: p })
    if (formula.content) tex(orbitalTex(p.l, p.m), formula.content)
  }
  // m runs from -l to l: its slider narrows and widens with l
  const mInput = slider('m', -p.l, p.l, p.m, (m) => { p.m = m; show() }, 1)
  slider('l', 0, 3, p.l, (l) => {
    p.l = l
    Object.assign(mInput, { min: -l, max: l })
    mInput.value = String(Math.max(-l, Math.min(l, p.m)))
    mInput.dispatchEvent(new Event('input'))
  }, 1)
  return view
}

/**
 * A real spherical harmonic Y(l, m) at a polar angle down from the top, and an azimuth round it -
 * normalised, through the associated Legendre polynomial P(l, |m|).
 */
function harmonic(l, m, polarAngle, azimuth) {
  const k = Math.abs(m), x = Math.cos(polarAngle), s = Math.sin(polarAngle)
  // up from P(k, k) by the usual recurrence - without the (-1)^m physicists add, as chemists draw
  // real orbitals: p_x's + lobe along +x
  let below = 1
  for (let i = 1; i <= k; i++) below *= (2 * i - 1) * s
  let legendre = below
  if (l > k) {
    let at = x * (2 * k + 1) * below
    for (let n = k + 2; n <= l; n++) {
      const next = (x * (2 * n - 1) * at - (n + k - 1) * below) / (n - k)
      below = at
      at = next
    }
    legendre = at
  }
  let ratio = 1
  for (let i = l - k + 1; i <= l + k; i++) ratio /= i
  const norm = Math.sqrt((2 * l + 1) / (4 * Math.PI) * ratio)
  if (m === 0) return norm * legendre
  return Math.SQRT2 * norm * legendre * (m > 0 ? Math.cos(k * azimuth) : Math.sin(k * azimuth))
}

/** The largest size a harmonic reaches, over the sphere. */
function peak(l, m) {
  let most = 0
  for (let i = 0; i <= 48; i++) {
    for (let j = 0; j <= 24; j++) most = Math.max(most, Math.abs(harmonic(l, m, (j / 24) * Math.PI, (i / 48) * 2 * Math.PI)))
  }
  return most
}

// the orbitals' names, by l and then m from -l to l - with z up, as chemists draw them
const ORBITALS = [
  ['s'],
  ['p_y', 'p_z', 'p_x'],
  ['d_{xy}', 'd_{yz}', 'd_{z^2}', 'd_{xz}', 'd_{x^2 - y^2}'],
  ['f_{y(3x^2 - y^2)}', 'f_{xyz}', 'f_{yz^2}', 'f_{z^3}', 'f_{xz^2}', 'f_{z(x^2 - y^2)}', 'f_{x(x^2 - 3y^2)}'],
]
const orbitalTex = (l, m) => `r = \\left| Y_{${l}}^{${m}}(\\theta, \\varphi) \\right| \\qquad ${ORBITALS[l][m + l]}`
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

// antenna
function antenna({ canvas, slider }) {
  const view = new View({ canvas, orbit: true, background: BG, camera: { position: [2, 8.5, 15], target: [0, 4.5, 0] } })
  const p = { elements: 6 }
  const plot = view.scene.add(chart({
    mark: 'surface', coords: 'spherical', angles: 'degrees',
    data: yagi(p.elements), theta: 'azimuth', phi: 'polar',
    // -20 dBi at the centre, 15 dBi on the outer ring
    r: { field: 'gain', scale: { domain: [-20, 15] } },
    color: { field: 'gain', title: 'Gain (dBi)', scale: { scheme: 'heat', domain: [-20, 15] } },
    legend: { position: 'bottom-right' }, transition: { duration: 0.6 },
  }))
  slider('elements', 2, 12, p.elements, (n) => { plot.update({ data: yagi(n) }) }, 1)
  return view
}

/**
 * A Yagi antenna's gain in dBi, every 5° round (azimuth) and down from the top (polar) - made up as
 * an antenna range would measure it: n half-wave dipoles in a row along x, each lying across it.
 */
function yagi(n) {
  const kd = 2 * Math.PI * 0.2, beta = -(kd + Math.PI / n), rad = Math.PI / 180
  const rows = []
  for (let azimuth = 0; azimuth < 360; azimuth += 5) {
    for (let polar = 0; polar <= 180; polar += 5) {
      // which way: along the row (x) and along a dipole (z)
      const ux = Math.sin(polar * rad) * Math.cos(azimuth * rad), uz = Math.sin(polar * rad) * Math.sin(azimuth * rad)
      // the row adds up in step only straight ahead; a dipole is quiet off its ends
      const psi = kd * ux + beta, half = Math.sin(psi / 2)
      const array = Math.abs(half) < 1e-9 ? 1 : Math.abs(Math.sin(n * psi / 2) / (n * half))
      rows.push({ azimuth, polar, strength: array * Math.sqrt(Math.max(0, 1 - uz * uz)) })
    }
  }
  // in dB from the peak, which is about 10 log10(n) + 3 dBi
  const peak = Math.max(...rows.map((r) => r.strength)), top = 10 * Math.log10(n) + 3
  return rows.map(({ azimuth, polar, strength }) => ({ azimuth, polar, gain: +(top + 20 * Math.log10(Math.max(strength / peak, 1e-4))).toFixed(1) }))
}
// end

// microphones
function microphones({ canvas }) {
  const view = new View({ canvas, orbit: true, background: BG, camera: { position: [1, 5.2, 13.5], target: [0, 5, 0] } })
  // how much each hears from the side and behind: from all round (1) to a figure 8 (0)
  const PATTERNS = { omni: 1, cardioid: 0.5, supercardioid: 0.37, 'figure 8': 0 }
  const rows = Object.entries(PATTERNS).flatMap(([pattern, a]) => Array.from({ length: 72 }, (_, i) => {
    const angle = i * 5, heard = Math.abs(a + (1 - a) * Math.cos(angle * Math.PI / 180))
    return { pattern, angle, level: +(20 * Math.log10(Math.max(heard, 1e-3))).toFixed(1) }
  }))
  view.scene.add(chart({
    mark: 'curve', coords: 'polar', angles: 'degrees', data: rows, theta: 'angle',
    r: { field: 'level', scale: { domain: [-30, 0] } }, color: 'pattern', size: 3,
    legend: { position: 'bottom-right' },
  }))
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

// KaTeX, pinned, from the CDN - for this page only; phoria2 knows nothing of it
const KATEX = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist'
/** @type {any} */
let katex = null

/** Load KaTeX and its stylesheet; without the network the formulas fall back to their text. */
async function loadKatex() {
  const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: `${KATEX}/katex.min.css` })
  document.head.append(link)
  try {
    katex = (await import(/* @vite-ignore */ `${KATEX}/katex.mjs`)).default
  } catch {
    katex = null
  }
}

/**
 * TeX typeset by KaTeX into an element - a new one, or the one given to change it - or null when
 * KaTeX couldn't load, so a Label shows its text instead.
 * @param {string} source @param {Element} [into]
 */
function tex(source, into = document.createElement('span')) {
  if (!katex) return null
  katex.render(source, into, { throwOnError: false })
  return into
}

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
    // handed back, so a card can change its range
    return input
  }
}
