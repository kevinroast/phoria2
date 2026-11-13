import { Label, Mesh, View, sphere as sphereGeometry } from 'phoria2'
import { chart } from 'phoria2/charts'
import source from './science.js?raw'
import { random } from './kit.js'
import { cardPage, tex } from './cards.js'

// Maths at work - the plots physics, chemistry, engineering and data science use: functions and
// measured data, each card a live plot and the code that draws it, read from this file between its
// markers, so what you read is what runs. The pure maths is on the maths page.

const BG = '#1b1c22'

const CARDS = [
  {
    name: 'waves', title: 'Waves',
    note: 'Ripples spread from two sources - adding where crests meet, cancelling in a trough. With "time: true" the function is given the time as t, so the surface moves. Drag the sliders to move the sources apart or change the wavelength.',
  },
  {
    name: 'response', title: 'A response surface',
    note: 'A fitted model of yield over temperature and pressure, with the measurements it was fitted to. Hover the surface or a point to read it.',
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
    name: 'filter', title: 'A filter\'s poles',
    note: 'A low-pass filter\'s transfer function over the complex s-plane: height its size |H(s)|, colour its phase, round the hue wheel. The two spikes are its poles. Along the white line - the imaginary axis, s = jω - the height is its frequency response: less damping pulls the poles towards it, and a resonance peak rises.',
  },
  {
    name: 'microphones', title: 'Microphone patterns',
    note: 'The datasheet picture: how a microphone hears from each direction, in dB, one curve per pattern - polar data, read off its labelled rings, with 0° - straight ahead - at the top and the angles turning clockwise, as angles: { zero, clockwise } sets them.',
  },
  {
    name: 'antenna', title: 'An antenna pattern',
    note: 'Measured data, not a formula: a Yagi antenna\'s gain in dBi every 5° round and down, as an antenna range records it - the rows drawn with coords: \'spherical\' and angles in degrees. r\'s domain puts -20 dBi at the centre. More elements, a narrower beam.',
  },
  {
    name: 'orbitals', title: 'Atomic orbitals',
    note: 'The shapes of electron orbitals: spherical harmonics, drawn with coords: \'spherical\' as a radius over the angles. The two colours are the sign of the wave - its phase. Pick l and m: l = 0 is s, 1 is p, 2 is d and 3 is f.',
  },
]

export default function run({ canvas }) {
  return cardPage({ canvas, cards: CARDS, examples: EXAMPLES, source })
}

const EXAMPLES = { waves, response, descent, field, filter, microphones, antenna, orbitals }

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

// filter
function filter({ canvas, slider }) {
  const view = new View({ canvas, orbit: true, background: BG, camera: { position: [13, 8.5, 9], target: [0, 0.8, 0] } })
  const p = { frequency: 1, damping: 0.25 }
  // H(s) = w0² / (s² + 2ζw0 s + w0²) at s = σ + jω: its size, capped where it runs off to the poles,
  // and its phase
  const CAP = 5
  const H = (sigma, omega, { frequency: w, damping: d }) => {
    const re = sigma * sigma - omega * omega + 2 * d * w * sigma + w * w, im = 2 * sigma * omega + 2 * d * w * omega
    return { size: (w * w) / Math.hypot(re, im), phase: -Math.atan2(im, re) }
  }
  const ranges = { x: { domain: [-2, 0.5], title: 'σ' }, z: { domain: [-2, 2], title: 'jω' }, y: { domain: [0, CAP], title: '|H|' } }
  const plot = view.scene.add(chart({
    mark: 'surface', ...ranges, samples: 80, params: p, legend: false,
    fn: (sigma, omega, params) => {
      const h = H(sigma, omega, params)
      return { y: Math.min(h.size, CAP), phase: h.phase }
    },
    color: { field: 'phase', scale: { scheme: 'hue', domain: [-Math.PI, Math.PI] } },
  }))
  // the frequency response: the surface along the imaginary axis, a hair above it
  const pinned = (field, c) => ({ field, scale: { domain: c.domain, nice: false } })
  const response = () => Array.from({ length: 161 }, (_, i) => {
    const omega = -2 + i / 40
    return { sigma: 0, omega, size: Math.min(H(0, omega, p).size, CAP) + 0.04 }
  })
  const line = view.scene.add(chart({
    mark: 'curve', data: response(), x: pinned('sigma', ranges.x), z: pinned('omega', ranges.z), y: pinned('size', ranges.y),
    // in the surface's box, not a curve's own cube
    color: '#ffffff', size: 3, box: [10, 4, 10], equal: false, frame: false, tooltip: false, transition: false,
  }))
  view.scene.add(new Label({
    content: tex('H(s) = \\frac{\\omega_0^2}{s^2 + 2\\zeta\\omega_0 s + \\omega_0^2}'), text: 'H(s) = w0² / (s² + 2ζ w0 s + w0²)',
    position: [-5, 6, -5], edge: 'left', className: 'maths-tex', overlap: 'show',
  }))
  const show = () => {
    plot.update({ params: p })
    line.update(response())
  }
  slider('frequency ω₀', 0.5, 1.5, p.frequency, (v) => { p.frequency = v; show() })
  slider('damping ζ', 0.12, 1, p.damping, (v) => { p.damping = v; show() }, 0.01)
  return view
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
    // as a datasheet draws it: 0° - straight ahead - at the top, the angles going round clockwise
    mark: 'curve', coords: 'polar', angles: { units: 'degrees', zero: 'top', clockwise: true }, data: rows, theta: 'angle',
    r: { field: 'level', scale: { domain: [-30, 0] } }, color: 'pattern', size: 3,
    legend: { position: 'bottom-right' },
  }))
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
