import { View } from 'phoria2'
import { chart } from 'phoria2/charts'
import { random } from './kit.js'

const STATUS = { healthy: '#59a14f', degraded: '#f2b134', down: '#e15759' }
const SEVERITY = { healthy: 0, degraded: 1, down: 2 }

// A made-up service map: gateways in front of services, services in front of data stores.
function services(rand) {
  const nodes = [], links = []
  const add = (id, tier) => nodes.push({ id, tier, status: 'healthy', severity: 0, rps: Math.round(50 + rand() * 950) })
  for (const g of ['gateway-eu', 'gateway-us']) add(g, 'edge')
  const names = ['auth', 'search', 'cart', 'checkout', 'catalog', 'pricing', 'orders', 'shipping', 'payments', 'reviews', 'users', 'notify']
  for (const s of names) add(s, 'service')
  for (const d of ['postgres', 'redis', 'kafka', 'elastic', 's3']) add(d, 'data')
  const link = (a, b) => links.push({ source: a, target: b, rps: Math.round(20 + rand() * 600) })
  for (const s of names) link(rand() < 0.5 ? 'gateway-eu' : 'gateway-us', s)
  link('gateway-eu', 'auth')
  link('gateway-us', 'search')
  const calls = { checkout: ['cart', 'pricing', 'payments', 'orders'], orders: ['shipping', 'notify', 'postgres', 'kafka'], cart: ['redis', 'catalog'],
    search: ['elastic', 'catalog'], catalog: ['postgres', 's3'], auth: ['users', 'redis'], reviews: ['postgres', 'users'], pricing: ['redis'],
    payments: ['postgres', 'kafka'], users: ['postgres'], shipping: ['kafka'], notify: ['kafka'] }
  for (const [from, to] of Object.entries(calls)) for (const t of to) link(from, t)
  return { nodes, links }
}

// A service dependency map as a network chart: a seeded force layout (or tiers), status colours,
// node size by traffic, link width and flowing packets by request rate. Hover traces a service's
// dependencies; failing a service recolours the map without moving it.
export default function run({ canvas, gui, info }) {
  const rand = random(21)
  let data = services(rand)
  const view = new View({ canvas, orbit: true, background: '#14161c', camera: 'perspective' })
  view.scene.environment = 'studio'
  const layouts = { force: 'force', tiers: { tiers: 'tier', order: ['edge', 'service', 'data'] } }
  const spec = {
    mark: 'network', data,
    color: { field: 'status', title: 'Status', scale: { domain: Object.keys(STATUS), range: Object.values(STATUS) } },
    size: 'rps', label: { field: 'id', priority: 'severity' },
    link: { width: 'rps', flow: 'rps' },
    tooltip: ['id', 'tier', 'status', { field: 'rps', title: 'requests/s' }],
    legend: { position: 'bottom-right' },
  }
  const map = view.scene.add(chart({ ...spec, layout: layouts.force }))

  // failing a service degrades whatever calls it
  const fail = () => {
    const pick = data.nodes.filter((n) => n.tier !== 'edge' && n.status === 'healthy')
    if (!pick.length) return
    const down = pick[Math.floor(rand() * pick.length)].id
    const callers = new Set(data.links.filter((l) => l.target === down).map((l) => l.source))
    data = {
      links: data.links,
      nodes: data.nodes.map((n) => {
        const status = n.id === down ? 'down' : callers.has(n.id) && n.status === 'healthy' ? 'degraded' : n.status
        return { ...n, status, severity: SEVERITY[status] }
      }),
    }
    map.update(data)
    info.textContent = `${down} is down - ${callers.size} services degraded`
  }
  const recover = () => {
    data = { links: data.links, nodes: data.nodes.map((n) => ({ ...n, status: 'healthy', severity: 0 })) }
    map.update(data)
    info.textContent = 'All services healthy'
  }

  info.textContent = 'Hover a service to trace its dependencies'
  gui.add({ layout: 'force' }, 'layout', Object.keys(layouts)).onChange((name) => {
    map.update({ layout: layouts[name] })
    view.frame(map)
  })
  gui.add({ fail }, 'fail').name('fail a service')
  gui.add({ recover }, 'recover').name('recover all')
  return view
}
