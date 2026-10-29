import { Geometry, Group, Lines, Points, View } from 'phoria2'
import { scaleColor } from 'phoria2/charts'
import { glow, random } from './kit.js'

// how a memory relates to another, and the colour its links take when coloured by type
const TYPES = {
  semantic: { label: 'semantic', color: '#4e9bff', share: 0.4 },
  temporal: { label: 'temporal', color: '#2ec4b6', share: 0.2 },
  entity: { label: 'entity', color: '#f2a03d', share: 0.3 },
  causal: { label: 'causal', color: '#a77bff', share: 0.1 },
}
// how bright the links are: additive, so thousands of faint lines add up to a glow where they're dense
const LINK_GLOW = 0.07
// older memories are violet, newer ones run through rose and orange to gold
const RECENCY = scaleColor({ domain: [0, 1], range: ['#5b4bd6', '#c0509a', '#f28e2b', '#ffd166'] })

/**
 * A made-up memory graph: clusters of memories (topics), each formed at a time of its own, with a
 * few hubs that everything in the cluster links to, links within clusters, fewer to nearby
 * clusters and a scattering across the whole graph. Laid out as clusters, not by force - a force
 * layout of thousands of nodes would take seconds.
 */
function memories(seed, count, perNode) {
  const r = random(seed)
  const gauss = () => (r() + r() + r() - 1.5) / 1.5
  const topics = Math.max(6, Math.round(count / 80))
  const clusters = Array.from({ length: topics }, (_, i) => {
    const a = r() * Math.PI * 2, y = r() * 2 - 1, d = 13 * Math.cbrt(r())
    return {
      at: [Math.cos(a) * Math.sqrt(1 - y * y) * d, y * d * 0.6, Math.sin(a) * Math.sqrt(1 - y * y) * d],
      spread: 2.2 + r() * 2.6, born: i / (topics - 1), members: /** @type {number[]} */ ([]), hubs: /** @type {number[]} */ ([]),
    }
  })
  const nodes = []
  for (let i = 0; i < count; i++) {
    // some topics are much bigger than others
    const c = Math.floor(r() ** 1.6 * clusters.length), cluster = clusters[c]
    const recency = Math.min(1, Math.max(0, cluster.born + gauss() * 0.12))
    nodes.push({
      index: i, cluster: c, recency, degree: 0, links: /** @type {number[]} */ ([]),
      name: `memory #${1000 + i}`, at: cluster.at.map((v) => v + gauss() * cluster.spread),
    })
    cluster.members.push(i)
  }
  for (const c of clusters) c.hubs = c.members.filter(() => r() < 0.04).concat(c.members.slice(0, 1))
  const near = clusters.map((c) => clusters.map((o, j) => [Math.hypot(...c.at.map((v, k) => v - o.at[k])), j]).sort((a, b) => a[0] - b[0]).slice(1, 4).map(([, j]) => j))

  const links = []
  const seen = new Set()
  const typeOf = () => {
    let t = r()
    for (const [name, { share }] of Object.entries(TYPES)) if ((t -= share) < 0) return name
    return 'semantic'
  }
  const link = (a, b) => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`
    if (a === b || seen.has(key)) return
    seen.add(key)
    links.push({ a, b, type: typeOf() })
    for (const [x, y] of [[a, b], [b, a]]) {
      nodes[x].degree++
      nodes[x].links.push(y)
    }
  }
  for (const n of nodes) {
    const home = clusters[n.cluster]
    for (let k = 0; k < perNode / 2; k++) {
      const pick = r()
      // mostly to a hub of its own topic or anything in it, then a nearby topic, now and then anywhere
      const pool = pick < 0.35 ? home.hubs : pick < 0.65 ? home.members : pick < 0.88 ? clusters[near[n.cluster][Math.floor(r() * near[n.cluster].length)]].members : nodes.map((m) => m.index)
      link(n.index, pool[Math.floor(r() * pool.length)])
    }
  }
  return { nodes, links }
}

// A memory graph, for the look of it: thousands of memories as glowing points, coloured from older
// (violet) to newer (gold), and their links as additive lines that blend from one end's colour to the
// other's - so dense places glow. Sparks run along the links. Hover a memory to light up its
// neighbourhood; the legend switches link types on and off.
export default function run({ canvas, gui, info }) {
  const view = new View({
    canvas, orbit: { autoRotate: 0.04 }, background: '#07070b', camera: { position: [0, 7, 30], target: [0, 0, 0], far: 500 },
    tooltip: (hit) => hit.datum && {
      title: hit.datum.name,
      rows: { Links: hit.datum.degree, Recency: `${Math.round(hit.datum.recency * 100)}%`, Topic: `#${hit.datum.cluster + 1}` },
    },
  })
  const settings = { memories: 1500, linksPerMemory: 12, colour: 'recency', sparks: true, turn: true }
  const shown = new Set(Object.keys(TYPES))
  const sprite = glow(32, { core: 0.3 })
  const graph = view.scene.add(new Group())

  /** @type {ReturnType<typeof memories>} */
  let data
  /** @type {Points[]} */
  let layers = []
  /** @type {Lines | null} */
  let lines = null
  // the hovered memory's links, bright and wide, and its neighbours drawn larger
  const lit = graph.add(new Lines({ geometry: new Geometry({ positions: [] }), material: { color: '#ffffff', width: 2, opacity: 0.8, blending: 'additive', depthWrite: false }, pickable: false }))
  const near = graph.add(new Points({ geometry: new Geometry({ positions: [] }), material: { color: '#ffffff', size: 0.55, map: sprite, blending: 'additive', depthWrite: false }, pickable: false }))
  // sparks: each runs from one end of a link to the other, then picks another link
  const SPARKS = 600
  const sparks = graph.add(new Points({
    geometry: new Geometry({ positions: new Float32Array(SPARKS * 3) }), material: { color: '#fff3d6', size: 0.15, opacity: 0.8, map: sprite, blending: 'additive', depthWrite: false }, pickable: false,
  }))
  const runs = Array.from({ length: SPARKS }, () => ({ link: 0, t: Math.random(), speed: 0.3 + Math.random() * 0.7 }))

  const colourOf = (n) => RECENCY(n.recency)
  const drawLinks = () => {
    const visible = data.links.filter((l) => shown.has(l.type))
    const positions = new Float32Array(visible.length * 6), colors = new Float32Array(visible.length * 6)
    visible.forEach((l, i) => {
      const a = data.nodes[l.a], b = data.nodes[l.b]
      positions.set([...a.at, ...b.at], i * 6)
      // by recency the line blends from one end's colour to the other's; by type it is one colour
      const ca = settings.colour === 'type' ? TYPES[l.type].color : colourOf(a), cb = settings.colour === 'type' ? TYPES[l.type].color : colourOf(b)
      colors.set([...srgb(ca), ...srgb(cb)], i * 6)
    })
    if (lines) {
      graph.remove(lines)
      lines.dispose()
    }
    lines = graph.add(new Lines({ geometry: new Geometry({ positions, colors }), material: { vertexColors: true, opacity: LINK_GLOW, blending: 'additive', depthWrite: false }, pickable: false }))
    for (const s of runs) s.link = Math.floor(Math.random() * data.links.length)
    info.textContent = `${data.nodes.length.toLocaleString()} memories · ${visible.length.toLocaleString()} links · hover a memory to light up its neighbourhood`
  }
  const build = () => {
    data = memories(7, settings.memories, settings.linksPerMemory)
    for (const p of layers) {
      graph.remove(p)
      p.dispose()
    }
    // hubs - the most linked memories - are drawn bigger, as a layer of their own
    const cut = [...data.nodes].map((n) => n.degree).sort((a, b) => b - a)[Math.floor(data.nodes.length * 0.03)]
    layers = [data.nodes.filter((n) => n.degree < cut), data.nodes.filter((n) => n.degree >= cut)].map((rows, i) => graph.add(new Points({
      geometry: new Geometry({ positions: rows.flatMap((n) => n.at), colors: rows.flatMap((n) => srgb(colourOf(n))) }),
      material: { size: i ? 0.5 : 0.2, map: sprite, vertexColors: true, blending: 'additive', depthWrite: false, opacity: 0.6 },
      data: rows,
    })))
    drawLinks()
    light(null)
  }
  /** @param {any} n */
  const light = (n) => {
    const others = n ? n.links.map((j) => data.nodes[j]) : []
    lit.geometry.dispose()
    lit.geometry = new Geometry({ positions: others.flatMap((o) => [...n.at, ...o.at]) })
    near.geometry.dispose()
    near.geometry = new Geometry({ positions: others.flatMap((o) => o.at) })
    // the rest of the graph steps back while a neighbourhood is lit
    if (lines) lines.material.opacity = n ? LINK_GLOW / 3 : LINK_GLOW
  }
  build()
  view.frame(graph, { padding: 0.05 })
  // a quarter closer than the fit: the dense middle fills the view, the outer reaches run off its edges
  view.controls?.zoomBy(0.8)
  view.on('hover', (hit) => light(hit?.datum ?? null))

  // the legend: the recency ramp, and link types to switch on and off
  const key = document.createElement('div')
  key.className = 'demo-legend'
  key.innerHTML = `<div class="demo-legend-title">Recency</div>
    <div class="demo-legend-gradient" style="background: linear-gradient(to right, ${RECENCY.range.join(', ')})"></div>
    <div class="demo-legend-scale"><span>older</span><span>newer</span></div>
    <div class="demo-legend-title" style="margin-top: 8px">Links</div>`
  for (const [name, t] of Object.entries(TYPES)) {
    const item = document.createElement('button')
    item.className = 'demo-legend-item'
    item.innerHTML = `<span class="demo-legend-swatch" style="background:${t.color}"></span>${t.label}`
    item.addEventListener('click', () => {
      if (item.classList.toggle('off')) shown.delete(name)
      else shown.add(name)
      drawLinks()
    })
    key.append(item)
  }
  document.body.append(key)

  const f = gui.addFolder('Graph')
  f.add(settings, 'memories', 300, 5000, 100).onChange(build)
  f.add(settings, 'linksPerMemory', 2, 24, 1).name('links per memory').onChange(build)
  f.add(settings, 'colour', ['recency', 'type']).name('colour links by').onChange(drawLinks)
  f.add(settings, 'sparks').onChange((v) => { sparks.visible = v })
  f.add(settings, 'turn').onChange((v) => { /** @type {any} */ (view.controls).autoRotate = v ? 0.04 : false })

  return view.start((dt) => {
    if (!settings.sparks) return
    const p = sparks.geometry.positions
    runs.forEach((s, i) => {
      s.t += s.speed * dt
      if (s.t >= 1) {
        s.t = 0
        s.link = Math.floor(Math.random() * data.links.length)
      }
      const l = data.links[s.link], a = data.nodes[l.a].at, b = data.nodes[l.b].at
      for (let k = 0; k < 3; k++) p[i * 3 + k] = a[k] + (b[k] - a[k]) * s.t
    })
    sparks.geometry.needsUpdate()
  })
}

/** A colour as sRGB numbers 0-1, the form geometry colours take. @param {any} c */
function srgb(c) {
  const style = typeof c === 'string' ? c : c.getStyle()
  const n = parseInt(style.slice(1), 16)
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}
