import { View } from 'phoria2'
import { chart } from 'phoria2/charts'
import { random } from './kit.js'

// Every chart mark, and the axis and legend options, each in a tile of its own View: grouped and
// stacked bars, listed and counted ticks, number keys, formats, a light theme, log and time axes,
// stacked areas, surfaces, force and tiered networks. Live updates animate every tile to new data
// each second; more copies of the set put more views on the page - past four they share one WebGL
// context. The readout counts the frames the views draw and the time they take.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']
const REGIONS = ['North', 'South', 'East', 'West']
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const PRODUCTS = ['Widgets', 'Gadgets', 'Gizmos', 'Doohickeys', 'Sprockets']
const SERVICES = [['edge', 'gateway'], ['edge', 'cdn'], ['service', 'auth'], ['service', 'orders'], ['service', 'search'],
  ['service', 'billing'], ['data', 'users-db'], ['data', 'orders-db'], ['data', 'cache'], ['data', 'queue']]
const CALLS = [['gateway', 'auth'], ['gateway', 'orders'], ['gateway', 'search'], ['cdn', 'search'], ['orders', 'billing'],
  ['auth', 'users-db'], ['orders', 'orders-db'], ['search', 'cache'], ['billing', 'queue'], ['orders', 'queue'], ['auth', 'cache']]

export default function run({ canvas, gui, info }) {
  const rand = random(29)
  const jitter = (v, by) => Math.max(0, Math.round(v * (1 + (rand() - 0.5) * by)))
  const start = Date.UTC(2026, 6, 1)

  // each tile's data, made afresh for every live update
  const data = {
    sales: () => REGIONS.flatMap((region, r) => MONTHS.map((month, m) => ({ id: `${region}-${month}`, region, month, sales: jitter(30 + 14 * Math.sin(m / 1.5 + r) + r * 8, 0.3) }))),
    products: () => PRODUCTS.map((product) => ({ id: product, product, units: jitter(560, 0.8) })),
    revenue: () => PRODUCTS.map((product, p) => ({ id: product, product, revenue: jitter(42000 + p * 9000, 0.5) })),
    customers: () => Array.from({ length: 240 }, (_, i) => ({ id: i, spend: Math.round(rand() * 100), visits: Math.round(rand() * 100),
      tenure: +(rand() * 10).toFixed(1), score: Math.round(rand() * 100), segment: ['Retail', 'Trade', 'Online'][i % 3], orders: 1 + Math.round(rand() * 20) })),
    traffic: () => ['Organic', 'Paid', 'Referral'].flatMap((channel, c) => Array.from({ length: 45 }, (_, d) => ({ id: `${channel}-${d}`, channel,
      date: new Date(start + d * 864e5), visitors: jitter((900 - c * 260) * (1 + 0.25 * Math.sin(d / 7 * Math.PI * 2)), 0.2) }))),
    growth: () => Array.from({ length: 30 }, (_, d) => ({ id: d, day: d + 1, users: Math.round(40 * 1.22 ** d * (0.85 + rand() * 0.3)) })),
    errors: () => Array.from({ length: 48 }, (_, h) => ({ id: h, time: new Date(start + h * 36e5), rate: +(0.5 + Math.abs(Math.sin(h / 5)) * 2 + rand() * 0.6).toFixed(2) })),
    latency: () => DAYS.flatMap((day, d) => Array.from({ length: 24 }, (_, hour) => ({ id: `${day}-${hour}`, day, hour,
      latency: Math.round(40 + 160 * Math.exp(-((hour - 14) ** 2) / 18) * (d < 5 ? 1 : 0.4) + rand() * 25) }))),
    change: () => Array.from({ length: 12 }, (_, x) => Array.from({ length: 12 }, (_, z) => ({ id: `${x}-${z}`, x, z,
      change: Math.round(45 * Math.sin(x / 2.2 + rand() * 0.4) * Math.cos(z / 2.6)) }))).flat(),
    services: () => ({
      nodes: SERVICES.map(([tier, id]) => ({ id, tier, status: rand() < 0.15 ? 'degraded' : 'healthy', load: Math.round(20 + rand() * 80) })),
      links: CALLS.map(([source, target]) => ({ source, target })),
    }),
  }

  const TILES = [
    { title: 'Bar - grouped, value labels', data: 'sales',
      spec: { mark: 'bar', x: 'month', z: 'region', y: 'sales', color: 'region', label: 'sales', legend: { position: 'top-left' } } },
    { title: 'Bar - stacked, legend bottom right', data: 'sales',
      spec: { mark: 'bar', x: 'month', y: { field: 'sales', title: 'Sales (£k)' }, color: 'region', stack: true, legend: { position: 'bottom-right' } } },
    { title: 'Bar - one colour, listed ticks', data: 'products',
      spec: { mark: 'bar', x: 'product', y: { field: 'units', axis: { ticks: [0, 250, 500, 750, 1000] } }, color: '#76b7b2', label: 'units' } },
    { title: 'Bar - currency, light theme', data: 'revenue', light: true, camera: 'front',
      spec: { mark: 'bar', x: 'product', y: { field: 'revenue', format: { style: 'currency', currency: 'GBP', notation: 'compact' } }, color: 'product', theme: 'light', legend: false } },
    { title: 'Point - 3D, number key with ticks', data: 'customers',
      spec: { mark: 'point', x: { field: 'spend', axis: { ticks: [0, 25, 50, 75, 100] } }, y: 'visits', z: 'tenure',
        color: { field: 'score', title: 'Score' }, legend: { ticks: [0, 25, 50, 75, 100] } } },
    { title: 'Point - size and segments', data: 'customers', camera: 'front',
      spec: { mark: 'point', x: 'spend', y: { field: 'visits', axis: { ticks: 3 } }, size: 'orders', color: 'segment' } },
    { title: 'Line - series over time', data: 'traffic',
      spec: { mark: 'line', x: 'date', y: 'visitors', z: 'channel', color: 'channel' } },
    { title: 'Line - log scale', data: 'growth', camera: 'front',
      spec: { mark: 'line', x: { field: 'day', axis: { ticks: [1, 10, 20, 30] } }, y: { field: 'users', scale: { type: 'log' } }, color: '#edc948' } },
    { title: 'Area - stacked over time', data: 'traffic',
      spec: { mark: 'area', x: 'date', y: 'visitors', color: 'channel', stack: true } },
    { title: 'Area - one series, untitled', data: 'errors', camera: 'front',
      spec: { mark: 'area', x: { field: 'time', axis: { title: '' } }, y: { field: 'rate', title: 'Errors (%)' }, color: '#e15759' } },
    { title: 'Surface - heat, counted key', data: 'latency',
      spec: { mark: 'surface', x: 'hour', z: 'day', y: 'latency', color: { field: 'latency', title: 'ms', scale: { scheme: 'heat' } }, legend: { ticks: 4 } } },
    { title: 'Surface - diverging, three stops', data: 'change',
      spec: { mark: 'surface', x: 'x', z: 'z', y: 'change', color: { field: 'change', title: 'Change', scale: { domain: [-50, 0, 50], scheme: 'redblue' } } } },
    { title: 'Network - force', data: 'services',
      spec: { mark: 'network', color: { field: 'status', scale: { domain: ['healthy', 'degraded'], range: ['#59a14f', '#f2b134'] } }, size: 'load', label: 'id', legend: { position: 'bottom-left' } } },
    { title: 'Network - tiered', data: 'services',
      spec: { mark: 'network', layout: { tiers: 'tier', order: ['edge', 'service', 'data'] }, color: 'tier', label: 'id', link: { flow: 1 }, legend: false } },
  ]

  canvas.style.display = 'none'
  const grid = document.createElement('div')
  grid.className = 'demo-dashboard demo-chartlab'
  document.body.append(grid)

  const settings = { copies: 1, live: false }
  /** @type {{ view: View, chart: any, data: string }[]} */
  let tiles = []
  // the readout: frames drawn across every view, and the time drawing took, each second
  const stats = { frames: 0, ms: 0, update: 0 }

  const build = () => {
    for (const t of tiles) t.view.dispose()
    grid.replaceChildren()
    tiles = []
    for (let copy = 0; copy < settings.copies; copy++) {
      for (const tile of TILES) {
        const section = document.createElement('section')
        section.className = 'demo-tile'
        if (tile.light) section.style.background = '#f4f5f7'
        section.innerHTML = '<h3></h3><canvas></canvas>'
        section.querySelector('h3').textContent = tile.title
        grid.append(section)
        const view = new View({ canvas: section.querySelector('canvas'), orbit: true, framing: 'both',
          background: tile.light ? '#f4f5f7' : '#1b1c22', camera: /** @type {import('phoria2').CameraPreset} */ (tile.camera ?? 'perspective') })
        const made = view.scene.add(chart({ ...tile.spec, data: data[tile.data](), tooltip: true }))
        // instrumentation for the readout: count each frame a view draws, and time it
        const render = view.render.bind(view)
        view.render = () => {
          const t0 = performance.now()
          const frame = render()
          stats.ms += performance.now() - t0
          stats.frames++
          return frame
        }
        tiles.push({ view, chart: made, data: tile.data })
      }
    }
  }
  build()

  const update = () => {
    const t0 = performance.now()
    for (const t of tiles) t.chart.update(data[t.data]())
    stats.update = performance.now() - t0
  }
  let timer = 0
  const live = (on) => {
    clearInterval(timer)
    if (on) timer = setInterval(update, 1000)
  }

  const show = () => {
    info.textContent = `${tiles.length} views - ${stats.frames} frames drawn in the last second, ${stats.ms.toFixed(1)} ms drawing` +
      (settings.live ? `, ${stats.update.toFixed(1)} ms to give every chart new data` : ' - idle until touched')
    stats.frames = 0
    stats.ms = 0
  }
  setInterval(show, 1000)
  show()

  gui.add(settings, 'live').name('live updates').onChange(live)
  gui.add(settings, 'copies', { '14 views': 1, '28 views': 2, '56 views': 4, '112 views': 8 }).name('views').onChange((n) => {
    settings.copies = Number(n)
    build()
  })
  gui.add({ update }, 'update').name('new data once')
  return tiles[0].view
}
