import { Geometry, InstancedMesh, Lines, Points, View, box, icosphere } from 'phoria2'
import { legend, random } from './kit.js'

const STATUS = {
  ok: { color: '#59a14f', label: 'Healthy', rank: 0 },
  warn: { color: '#f2b134', label: 'Degraded', rank: 1 },
  down: { color: '#e15759', label: 'Down', rank: 2 },
}
const TYPES = { router: 'Core router', switch: 'Distribution switch', server: 'Server', database: 'Database' }

// A made-up network in three tiers: two core routers, a ring of switches, and hosts round each
// switch. Every link joins two rows by index.
function network(rand) {
  const nodes = [], links = []
  const add = (row) => nodes.push({ ...row, index: nodes.length, links: [] }) - 1
  const link = (a, b) => {
    links.push([a, b])
    nodes[a].links.push(b)
    nodes[b].links.push(a)
  }
  const status = () => { const r = rand(); return r < 0.06 ? 'down' : r < 0.18 ? 'warn' : 'ok' }
  const load = (s) => s === 'down' ? 0 : Math.round(20 + rand() * (s === 'warn' ? 75 : 55))
  const cores = [-3, 3].map((x, i) => add({ name: `core-${i + 1}`, type: 'router', status: 'ok', load: load('ok'), position: [x, 6, 0] }))
  link(cores[0], cores[1])
  const SWITCHES = 6, HOSTS = 6
  for (let s = 0; s < SWITCHES; s++) {
    const a = s / SWITCHES * Math.PI * 2
    const sw = add({ name: `dist-${s + 1}`, type: 'switch', status: s === 4 ? 'warn' : 'ok', load: load('ok'), position: [Math.cos(a) * 7, 3, Math.sin(a) * 7] })
    cores.forEach((c) => link(c, sw))
    for (let h = 0; h < HOSTS; h++) {
      const b = a + (h - (HOSTS - 1) / 2) * 0.13
      const st = status()
      const type = h === 0 ? 'database' : 'server'
      const host = add({ name: `${type === 'database' ? 'db' : 'app'}-${s + 1}${String.fromCharCode(97 + h)}`, type, status: st, load: load(st),
        position: [Math.cos(b) * 13, 0, Math.sin(b) * 13] })
      link(sw, host)
    }
  }
  // the switches are also linked in a ring
  const switches = nodes.filter((n) => n.type === 'switch')
  switches.forEach((sw, i) => link(sw.index, switches[(i + 1) % switches.length].index))
  for (const n of nodes) n.ip = `10.${n.type === 'router' ? 0 : n.type === 'switch' ? 1 : 2}.${Math.floor(n.index / 8)}.${10 + n.index % 8}`
  return { nodes, links }
}

// A network topology: hubs and hosts are two InstancedMeshes with their rows bound, coloured by
// status. Hovering a node highlights it, lights up its links and shows its row; labels name as
// many nodes as fit, problem hosts first. Packets run along the live links.
export default function run({ canvas, gui, info }) {
  const { nodes, links } = network(random(11))
  const view = new View({
    canvas, orbit: true, background: '#14161c', camera: 'perspective', highlight: '#ffffff',
    tooltip: (hit) => hit.datum && {
      title: hit.datum.name,
      rows: { Type: TYPES[hit.datum.type], Status: STATUS[hit.datum.status].label, Load: `${hit.datum.load}%`, Links: hit.datum.links.length, Address: hit.datum.ip },
    },
  })
  const { scene } = view
  scene.environment = 'studio'

  // hubs are spheres, hosts are boxes, each coloured by status
  const hubs = nodes.filter((n) => n.type === 'router' || n.type === 'switch')
  const hosts = nodes.filter((n) => n.type === 'server' || n.type === 'database')
  scene.add(new InstancedMesh({
    geometry: icosphere({ radius: 1, detail: 2 }), material: { roughness: 0.35 }, data: hubs,
    instances: hubs.map((n) => ({ position: n.position, scale: n.type === 'router' ? 0.8 : 0.55, color: STATUS[n.status].color })),
    labels: { text: (row) => row.name, place: 'above', className: 'demo-value', occlude: true, priority: 5 },
  }))
  // host labels: problems outrank healthy hosts when labels collide, and can be the only ones shown
  let onlyProblems = false
  scene.add(new InstancedMesh({
    geometry: box(1), material: { roughness: 0.5 }, data: hosts,
    instances: hosts.map((n) => ({ position: n.position, scale: n.type === 'database' ? [0.7, 1.1, 0.7] : [0.6, 0.6, 0.6], color: STATUS[n.status].color })),
    labels: {
      text: (row) => (onlyProblems && row.status === 'ok' ? null : row.name),
      priority: (row) => STATUS[row.status].rank,
      place: 'below', className: 'demo-value', occlude: true,
    },
  }))

  // links: all of them dim, and the hovered node's again on top, bright and wide
  const segment = ([a, b]) => [...nodes[a].position, ...nodes[b].position]
  scene.add(new Lines({ geometry: new Geometry({ positions: links.flatMap(segment) }), material: { color: '#3b4358', width: 1.5 }, pickable: false }))
  const active = scene.add(new Lines({
    geometry: new Geometry({ positions: new Float32Array(links.length * 6) }), material: { color: '#7fd3ff', width: 3 }, pickable: false,
  }))
  active.geometry.drawCount = 0

  view.on('hover', (hit) => {
    const row = hit?.datum
    const own = row ? links.filter(([a, b]) => a === row.index || b === row.index) : []
    active.geometry.positions.set(own.flatMap(segment))
    active.geometry.drawCount = own.length * 2
    active.geometry.needsUpdate()
  })
  view.on('click', (hit) => {
    const row = hit?.datum
    info.textContent = row ? `${row.name}: ${STATUS[row.status].label.toLowerCase()}, ${row.load}% load, ${row.links.length} links` : summary
  })
  const down = nodes.filter((n) => n.status === 'down').length, warn = nodes.filter((n) => n.status === 'warn').length
  const summary = `${nodes.length} nodes - ${down} down, ${warn} degraded. Hover to trace links.`
  info.textContent = summary

  // traffic: one packet per live link, running back and forth at a speed set by load
  const live = links.filter(([a, b]) => nodes[a].status !== 'down' && nodes[b].status !== 'down')
  const packets = scene.add(new Points({
    geometry: new Geometry({ positions: new Float32Array(live.length * 3) }), material: { color: '#9fe8ff', size: 0.22 }, pickable: false,
  }))
  const phase = live.map(() => Math.random())
  const speed = live.map(([a, b]) => 0.15 + (nodes[a].load + nodes[b].load) / 400)

  legend(Object.values(STATUS).map((s) => ({ label: s.label, color: s.color })), { title: 'Status' })

  const settings = { traffic: true, labels: 'problems first' }
  const f = gui.addFolder('Network')
  f.add(settings, 'traffic').onChange((v) => { packets.visible = v })
  f.add(settings, 'labels', ['problems first', 'only problems']).onChange((v) => {
    onlyProblems = v === 'only problems'
    // the label text reads a variable the View can't watch, so ask for a redraw
    view.invalidate()
  })
  f.add({ fit: () => view.frame() }, 'fit').name('fit to view')

  return view.start((dt) => {
    if (!settings.traffic) return
    const p = packets.geometry.positions
    live.forEach(([a, b], i) => {
      phase[i] = (phase[i] + dt * speed[i]) % 2
      // 0..1 out, 1..2 back
      const t = phase[i] < 1 ? phase[i] : 2 - phase[i]
      const pa = nodes[a].position, pb = nodes[b].position
      for (let k = 0; k < 3; k++) p[i * 3 + k] = pa[k] + (pb[k] - pa[k]) * t
    })
    packets.geometry.needsUpdate()
  })
}
