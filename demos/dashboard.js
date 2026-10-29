import { OrthographicCamera, PerspectiveCamera, View } from 'phoria2'
import { chart } from 'phoria2/charts'
import { random } from './kit.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const REGIONS = ['North', 'South', 'East', 'West']

// A dashboard of eight chart tiles, each its own View on its own canvas. Every view draws only
// when something in it changes, so the page sits idle until you touch a tile - and a tile scrolled
// out of sight does nothing at all. Each tile starts from a camera set by hand to fill its space.

// a perspective camera (fov) or an orthographic one (height), from where and looking at what
const persp = (position, target) => new PerspectiveCamera({ position, target, fov: 45 })
const ortho = (position, target, height) => new OrthographicCamera({ position, target, height })
export default function run({ canvas, info }) {
  const rand = random(17)
  canvas.style.display = 'none'
  const grid = document.createElement('div')
  grid.className = 'demo-dashboard'
  document.body.append(grid)

  const sales = REGIONS.flatMap((region, s) => MONTHS.map((month, m) => ({ region, month, sales: Math.round(20 + 12 * Math.sin(m / 2 + s) + s * 6 + rand() * 8) })))
  const traffic = ['Organic', 'Paid', 'Referral'].flatMap((channel, c) => Array.from({ length: 60 }, (_, d) => ({
    channel, date: new Date(Date.UTC(2026, 6, 1) + d * 864e5), visitors: Math.round((900 - c * 250) * (1 + 0.2 * Math.sin(d / 7 * Math.PI * 2)) * (0.9 + rand() * 0.2)) })))
  const scatter = Array.from({ length: 300 }, (_, i) => ({ segment: ['A', 'B', 'C'][i % 3], spend: Math.round(rand() * 100), visits: Math.round(rand() * 100), tenure: +(rand() * 10).toFixed(1) }))
  const latency = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].flatMap((day, d) => Array.from({ length: 24 }, (_, hour) => ({ day, hour,
    latency: Math.round(40 + 150 * Math.exp(-((hour - 14) ** 2) / 18) * (d < 5 ? 1 : 0.4) + rand() * 20) })))
  const products = ['Widgets', 'Gadgets', 'Gizmos', 'Doohickeys', 'Thingamajigs'].map((product) => ({ product, units: Math.round(200 + rand() * 800) }))
  const errors = Array.from({ length: 48 }, (_, h) => ({ time: new Date(Date.UTC(2026, 9, 24) + h * 36e5), rate: +(0.5 + Math.abs(Math.sin(h / 5)) * 2 + (h === 31 ? 6 : 0) + rand() * 0.4).toFixed(2) }))
  const net = { nodes: ['api', 'auth', 'db', 'cache', 'queue', 'worker'].map((id, i) => ({ id, status: i === 4 ? 'degraded' : 'healthy' })),
    links: [['api', 'auth'], ['api', 'db'], ['api', 'cache'], ['api', 'queue'], ['queue', 'worker'], ['worker', 'db'], ['auth', 'cache']].map(([source, target]) => ({ source, target })) }

  const tiles = [
    { title: 'Sales by region (£k)', camera: persp([8.904, 8.465, 11.996], [0.212, 2.143, -0.134]), spec: { mark: 'bar', data: sales, x: 'month', z: 'region', y: 'sales', color: 'region' } },
    { title: 'Visitors by channel', camera: ortho([11.53, 9.742, 18.372], [-0.539, 2.953, -0.668], 11.32), spec: { mark: 'area', data: traffic, x: 'date', y: 'visitors', color: 'channel', stack: true } },
    { title: 'Customers', camera: persp([10.678, 5.659, 11.392], [0.108, 1.984, 0.202]), spec: { mark: 'point', data: scatter, x: 'spend', y: 'visits', z: 'tenure', color: 'segment' } },
    { title: 'Latency by hour (ms)', camera: persp([6.275, 7.959, 13.573], [-0.912, 0.571, 0.887]), spec: { mark: 'surface', data: latency, x: 'hour', z: 'day', y: 'latency', color: { field: 'latency', scale: { scheme: 'heat' } } } },
    { title: 'Units by product', camera: ortho([4.63, 9.183, 22.286], [-0.391, 2.563, 0.258], 10.189), spec: { mark: 'bar', data: products, x: 'product', y: 'units', label: 'units', color: '#76b7b2' } },
    { title: 'Error rate (%)', camera: ortho([9.689, 11.452, 19.992], [-0.288, 2.884, 0.465], 9.169), spec: { mark: 'line', data: errors, x: 'time', y: 'rate', color: '#e15759' } },
    { title: 'Services', camera: persp([2.052, 5.793, 6.366], [0.63, 3.729, -0.914]), spec: { mark: 'network', data: net, color: { field: 'status', scale: { domain: ['healthy', 'degraded'], range: ['#59a14f', '#f2b134'] } }, label: 'id' } },
    { title: 'Stacked sales', camera: ortho([10.178, 9.591, 19.54], [-0.709, 2.793, -0.197], 9.268), spec: { mark: 'bar', data: sales, x: 'month', y: 'sales', color: 'region', stack: true } },
  ]
  const views = tiles.map(({ title, camera, spec }) => {
    const tile = document.createElement('section')
    tile.className = 'demo-tile'
    tile.innerHTML = '<h3></h3><canvas></canvas>'
    tile.querySelector('h3').textContent = title
    grid.append(tile)
    // the cameras were set in tiles 1.5 times as wide as tall; in any other shape, keep all of
    // that framing in view rather than cutting off the sides
    const view = new View({ canvas: tile.querySelector('canvas'), orbit: true, background: '#1b1c22', camera, framing: { keep: 'both', aspect: 1.5 } })
    view.scene.add(chart({ legend: false, ...spec }))
    return view
  })
  info.textContent = `${views.length} views - each draws only when something in it changes`
  return views[0]
}
