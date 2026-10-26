import { DirectionalLight, Geometry, HemisphereLight, Lines, View } from 'phoria2'
import { chart } from 'phoria2/charts'
import { random } from './kit.js'

// The gallery's front scene: a 3D bar chart that builds itself, then runs through what charts can
// do - new data, stacking, filtering - each step a real call, named in the caption as it happens.
// It stands on a grid that fades into the dark, seen from a fixed three-quarter view.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const REGIONS = ['North', 'South', 'East', 'West']
const COLORS = ['#ff4d6d', '#ffd166', '#06d6a0', '#4cc9f0']
const rand = random(3)
/** A year of made-up monthly sales per region, with a seasonal swing. */
const year = () => {
  const lift = REGIONS.map(() => rand() * 8)
  return REGIONS.flatMap((region, s) => MONTHS.map((month, m) => ({
    id: `${region}-${month}`, region, month, sales: Math.round(22 + 12 * Math.sin(m / 2 + s * 1.4 + rand()) + s * 4 + lift[s] + rand() * 8),
  })))
}

/** A floor grid whose lines fade into the background towards its edges. */
function fadingGrid(size = 30, divisions = 30, line = [0.27, 0.27, 0.31], background = [0.08, 0.08, 0.08]) {
  const positions = [], colors = []
  const half = size / 2, step = size / divisions, pieces = 24
  const shade = (x, z) => {
    const fade = Math.min(1, Math.hypot(x, z) / half) ** 1.5
    return line.map((c, k) => c + (background[k] - c) * fade)
  }
  // each line is cut into short pieces, so the fade is smooth along it
  for (let i = 0; i <= divisions; i++) {
    const v = -half + i * step
    for (let j = 0; j < pieces; j++) {
      const a = -half + j / pieces * size, b = -half + (j + 1) / pieces * size
      for (const [x0, z0, x1, z1] of [[a, v, b, v], [v, a, v, b]]) {
        positions.push(x0, 0, z0, x1, 0, z1)
        colors.push(...shade(x0, z0), ...shade(x1, z1))
      }
    }
  }
  return new Lines({ geometry: new Geometry({ positions, colors }), material: { vertexColors: true }, pickable: false })
}

/**
 * The scene on a canvas, with a caption element naming each call as it's made.
 * @param {string | HTMLCanvasElement} canvas @param {HTMLElement} [caption]
 */
export function hero(canvas, caption) {
  // drawn at no more than 1.5x the page's pixels: on a moving scene the difference doesn't show,
  // and a small GPU is spared the extra pixels
  const view = new View({
    canvas, background: '#141414', pixelRatio: Math.min(globalThis.devicePixelRatio || 1, 1.5),
    camera: { position: [4.7, 5.6, 12.8], target: [0, 2.3, 0] },
  })
  const { scene } = view
  scene.environment = 'studio'
  scene.environmentIntensity = 0.45
  scene.add(new HemisphereLight({ sky: '#dfe6ff', ground: '#1a1a20', intensity: 0.5 }))
  scene.add(new DirectionalLight({ direction: [-0.5, -1, -0.6], intensity: 1.1 }))
  scene.add(fadingGrid())

  let rows = year()
  // the regions in depth, untitled - set again when the chart unstacks
  const depth = { field: 'region', axis: { title: '' } }
  const sales = scene.add(chart({
    // no axis or legend titles: this is a showpiece, and the values speak for themselves
    mark: 'bar', data: rows, x: { field: 'month', axis: { title: '' } }, z: depth,
    y: { field: 'sales', axis: { title: '' } },
    color: { field: 'region', title: '', scale: { domain: REGIONS, range: COLORS } },
    legend: { position: 'top-right' },
    // every label at full strength, even where one covers another - a showpiece, not a dashboard
    overlap: 'show',
    // made with nothing animating, so hiding every bar for the start is instant - animated, the
    // bars would show at the bottom for a moment, shrinking away, before the show begins
    transition: false,
  }))
  sales.filter(() => false)
  // then quick animations, so each month has grown before the next is revealed
  sales.update({ transition: { duration: 0.35 } })

  // the show: each step a call on the chart, held for a while; the bars reveal a month at a time
  const STEPS = [
    { say: "chart({ mark: 'bar', data, x: 'month', y: 'sales', z: 'region' })", hold: 7, grow: true },
    { say: 'chart.update(nextYear)', hold: 3.5, run: () => sales.update(rows = year()) },
    { say: 'chart.update(nextYear)', hold: 3.5, run: () => sales.update(rows = year()) },
    { say: 'chart.update({ stack: true })', hold: 4, run: () => sales.update({ z: null, stack: true }) },
    { say: "chart.update({ stack: false, z: 'region' })", hold: 3.5, run: () => sales.update({ z: depth, stack: false }) },
    { say: "chart.filter((row) => row.region === 'East' || row.region === 'West')", hold: 4, run: () => sales.filter((row) => row.region === 'East' || row.region === 'West') },
    { say: 'chart.filter(null)', hold: 3.5, run: () => sales.filter(null) },
    { say: 'chart.filter(() => false)', hold: 2, run: () => sales.filter(() => false) },
  ]
  let step = -1, stepAt = 0, shown = 0
  const next = (t) => {
    step = (step + 1) % STEPS.length
    stepAt = t
    shown = 0
    STEPS[step].run?.()
    if (caption) caption.textContent = STEPS[step].say
  }

  view.start((_dt, t) => {
    // a moment first, for the chart's opening "nothing shown" to settle
    if (t < 0.5) return
    if (step < 0 || t - stepAt > STEPS[step].hold) next(t)
    // growing: one more month every 0.45 s, each after the last has finished growing
    if (STEPS[step].grow && shown < MONTHS.length) {
      const want = Math.min(MONTHS.length, Math.floor((t - stepAt) / 0.45) + 1)
      if (want !== shown) {
        shown = want
        const months = new Set(MONTHS.slice(0, shown))
        sales.filter((row) => months.has(row.month))
      }
    }
  })

  // nothing moves while the scene is scrolled out of sight
  new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) view.start()
    else view.stop()
  }).observe(view.canvas)
  return view
}
