// The network mark: nodes as instanced spheres, links as lines, laid out by force, by tiers or from
// the data. Layouts are deterministic (seeded), and updates start from where nodes already are, so a
// live map changes colour without moving.
import { Geometry } from '../geometry/Geometry.js'
import { icosphere } from '../geometry/generators.js'
import { InstancedMesh, Lines, Points } from '../scene/drawables.js'
import { Color } from '../value/Color.js'
import { describe, fail } from '../validate.js'
import { labelsOf } from './marks.js'

/** @import { MarkContext, Mark } from './marks.js' */

/** Seeded random numbers (mulberry32): the same graph lays out the same way every time. @param {number} seed */
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// link widths in pixels for thin, medium and thick links
const WIDTHS = [1.2, 2.5, 4.5]

/**
 * @param {MarkContext} ctx
 * @returns {Mark}
 */
export function networkMark(ctx) {
  const o = ctx.spec.options
  const keyOf = keyGetter(ctx)
  const linkCh = ctx.spec.link
  const source = o.source ?? 'source', target = o.target ?? 'target'
  /** @type {Map<any, number[]>} layout positions by key, kept between updates for stability */
  let placed = new Map()
  const makeNodes = (/** @type {number} */ capacity) => new InstancedMesh({ geometry: icosphere({ radius: 1, detail: 2 }), material: { roughness: 0.35 }, count: capacity, labels: labelsOf(ctx, 'above') })
  let nodesMesh = makeNodes(Math.max(8, ctx.spec.rows.length * 2))
  nodesMesh.count = 0
  // links in up to three widths; each segment carries its link's row
  const linkNodes = WIDTHS.map((width) => new Lines({ geometry: new Geometry({ positions: [0, 0, 0, 0, 0, 0] }), material: { width, vertexColors: true }, data: [] }))
  const active = new Lines({ geometry: new Geometry({ positions: [] }), material: { width: 4, color: '#7fd3ff' }, pickable: false, visible: false })
  const packets = linkCh.flow ? new Points({ geometry: new Geometry({ positions: [] }), material: { size: 0.022 * Math.min(...ctx.box), color: '#bff0ff' }, pickable: false }) : null
  /** @type {{ a: number, b: number, speed: number, phase: number }[]} */
  let flows = []
  /** the drawn node positions, by row index, as of the last apply */
  let at = []
  /** @type {any[]} */ let links = []
  /** @type {any[]} */ let rowsNow = []
  /** the hovered node by its key, not its row - rows move and go when the data changes; null for none */
  /** @type {unknown} */ let hovered = null

  const mark = {
    nodes: [...linkNodes, active, nodesMesh, ...(packets ? [packets] : [])],
    layout(rows) {
      const keys = rows.map(keyOf)
      const index = new Map(keys.map((k, i) => [k, i]))
      links = ctx.spec.links.filter((l, i) => {
        const a = l[source], b = l[target]
        if (a === undefined || b === undefined) fail('chart()', `link ${i} has no '${a === undefined ? source : target}' - links name their ends with source: '${source}', target: '${target}' (set 'source' and 'target' to your field names)`)
        if (!ctx.spec.rows.some((r) => keyOf(r) === a)) fail('chart()', `link ${i}: ${source} ${describe(a)} names no node`)
        if (!ctx.spec.rows.some((r) => keyOf(r) === b)) fail('chart()', `link ${i}: ${target} ${describe(b)} names no node`)
        // links to hidden nodes are hidden too
        return index.has(a) && index.has(b)
      })
      const pairs = links.map((l) => [index.get(l[source]), index.get(l[target])])
      const positions = place(rows, keys, pairs)
      const stride = 7, state = new Float32Array(rows.length * stride)
      rows.forEach((row, i) => state.set([...positions[i], ctx.size ? ctx.size(ctx.spec.channels.size.get(row)) : 0.06 * Math.min(...ctx.box), ...ctx.rgb(row)], i * stride))
      return { rows, keys, state, stride, shape: { pairs: links.map((l) => [l[source], l[target]]) } }
    },
    apply(state, t) {
      const n = state.length / t.stride
      rowsNow = t.rows
      // a hovered node that has gone from the data is hovered no longer
      if (hovered !== null && !rowsNow.some((r) => keyOf(r) === hovered)) {
        hovered = null
        active.visible = false
      }
      if (n > nodesMesh.instanceMatrices.length / 16) {
        // more nodes than room - arriving and leaving ones together, in a transition: a bigger mesh,
        // swapped in place, keeping its hover handler
        const bigger = makeNodes(n * 2)
        bigger.onHover = nodesMesh.onHover
        nodesMesh.parent?.add(bigger)
        nodesMesh.parent?.remove(nodesMesh)
        nodesMesh.dispose()
        mark.nodes[mark.nodes.indexOf(nodesMesh)] = bigger
        nodesMesh = bigger
      }
      nodesMesh.count = n
      nodesMesh.data = t.rows
      const keys = t.rows.map(keyOf)
      const index = new Map(keys.map((k, i) => [k, i]))
      at = []
      for (let i = 0; i < n; i++) {
        const [x, y, z, s, r, g, b] = state.subarray(i * 7, i * 7 + 7)
        at.push([x, y, z])
        nodesMesh.setInstance(i, { position: [x, y, z], scale: Math.max(1e-4, s), color: dimmed(i, [r, g, b]) })
      }
      // links follow their nodes, so they move with any transition
      const byWidth = WIDTHS.map(() => ({ positions: [], colors: [], rows: [] }))
      flows = []
      links.forEach((link, li) => {
        const a = index.get(link[source]), b = index.get(link[target])
        if (a === undefined || b === undefined) return
        const bucket = byWidth[widthClass(link)]
        const c = linkColor(link)
        bucket.positions.push(...at[a], ...at[b])
        bucket.colors.push(...c, ...c)
        bucket.rows.push(link)
        if (linkCh.flow) flows.push({ a, b, speed: flowSpeed(link), phase: (li * 0.618) % 1 })
      })
      linkNodes.forEach((node, i) => {
        const bucket = byWidth[i]
        node.geometry.dispose()
        node.geometry = new Geometry(bucket.positions.length ? { positions: bucket.positions, colors: bucket.colors } : { positions: [0, 0, 0, 0, 0, 0] })
        node.visible = bucket.positions.length > 0
        node.data = bucket.rows
      })
      if (hovered !== null) showNeighbours(hovered)
    },
    enter(item) {
      item[3] = 0
    },
    tick(dt) {
      if (!packets || !flows.length) return
      const p = new Float32Array(flows.length * 3)
      flows.forEach((f, i) => {
        f.phase = (f.phase + dt * f.speed) % 1
        const a = at[f.a], b = at[f.b]
        for (let k = 0; k < 3; k++) p[i * 3 + k] = a[k] + (b[k] - a[k]) * f.phase
      })
      if (packets.geometry.vertexCount !== flows.length) {
        packets.geometry.dispose()
        packets.geometry = new Geometry({ positions: p })
      } else {
        packets.geometry.positions.set(p)
        packets.geometry.needsUpdate()
      }
    },
    tooltipRows(hit) {
      return linkNodes.includes(hit.node) ? 'link' : 'node'
    },
  }

  // neighbour highlight: the hovered node's links light up, and nodes it doesn't touch dim
  const neighbours = (o.highlight ?? 'neighbours') === 'neighbours'
  if (neighbours) {
    // on the nodes themselves, so the chart's own onHover stays the app's: the view tells this one
    // the hit while the pointer is over a node, and null when it leaves them
    nodesMesh.onHover = (hit) => {
      const key = hit && hit.node === nodesMesh && hit.instance !== null ? keyOf(rowsNow[hit.instance]) : null
      if (key === hovered) return
      hovered = key
      active.visible = key !== null
      if (key !== null) showNeighbours(key)
      // recolour every node for the dimming, or back
      for (let k = 0; k < nodesMesh.count; k++) nodesMesh.setColor(k, dimmed(k, ctx.rgb(rowsNow[k])))
    }
  }

  /** @param {unknown} key */
  function showNeighbours(key) {
    const p = []
    for (const l of links) {
      if (l[source] !== key && l[target] !== key) continue
      const a = rowsNow.findIndex((r) => keyOf(r) === l[source]), b = rowsNow.findIndex((r) => keyOf(r) === l[target])
      if (a >= 0 && b >= 0) p.push(...at[a], ...at[b])
    }
    active.geometry.dispose()
    active.geometry = new Geometry({ positions: p })
  }

  /** A node's colour, dimmed while another node and its neighbours are highlighted. @param {number} k @param {number[]} rgb */
  function dimmed(k, rgb) {
    if (hovered === null || !neighbours) return rgb
    const other = keyOf(rowsNow[k])
    if (other === hovered) return rgb
    const near = links.some((l) => (l[source] === hovered && l[target] === other) || (l[target] === hovered && l[source] === other))
    if (near) return rgb
    const c = new Color().setSRGB(rgb[0], rgb[1], rgb[2]).lerp(ctx.theme === 'light' ? '#ffffff' : '#202024', 0.65)
    return c.toSRGB()
  }

  /** @param {any} link */
  function widthClass(link) {
    const c = linkCh.width
    if (!c) return 0
    if (c.field === null) return c.value >= 3.5 ? 2 : c.value >= 2 ? 1 : 0
    const values = ctx.spec.links.map((l) => Number(c.get(l)) || 0)
    const max = Math.max(...values) || 1
    return Math.min(2, Math.floor((Number(c.get(link)) || 0) / max * 2.999))
  }

  /** @param {any} link @returns {number[]} */
  function linkColor(link) {
    const c = linkCh.color
    const base = ctx.theme === 'light' ? '#9aa3b2' : '#4a5266'
    if (!c) return Color.fromInput(base).toSRGB()
    if (c.field === null) return Color.fromInput(c.value).toSRGB()
    return ctx.linkColor(c.get(link)).toSRGB()
  }

  /** @param {any} link */
  function flowSpeed(link) {
    const c = linkCh.flow
    if (c.field === null) return 0.4
    const max = Math.max(...ctx.spec.links.map((l) => Number(c.get(l)) || 0)) || 1
    return 0.15 + 0.6 * (Number(c.get(link)) || 0) / max
  }

  /**
   * Node positions in the chart box, by layout.
   * @param {any[]} rows @param {any[]} keys @param {number[][]} pairs
   * @returns {number[][]}
   */
  function place(rows, keys, pairs) {
    const [w, h, d] = ctx.box
    const layout = o.layout ?? 'force'
    if (layout === 'given') {
      const { x, y, z } = ctx.scales, ch = ctx.spec.channels
      return rows.map((r) => [x && ch.x ? x(ch.x.get(r)) : 0, y && ch.y ? y(ch.y.get(r)) : h / 2, z && ch.z ? z(ch.z.get(r)) : 0])
    }
    if (layout && typeof layout === 'object' && 'tiers' in layout) return tiers(rows, keys, pairs, layout, [w, h, d])
    if (layout !== 'force') fail('chart()', `layout ${describe(layout)} - expected 'force', 'given' or { tiers: 'field' }`)
    const raw = force(keys, pairs)
    // fit the layout into the box, keeping its proportions
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
    for (const p of raw) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]) }
    const span = Math.max(...hi.map((v, k) => v - lo[k]), 1e-6)
    const s = Math.min(w, o.flat ? d : Math.min(h, d)) * 0.9 / span
    const c = hi.map((v, k) => (v + lo[k]) / 2)
    return raw.map((p) => [(p[0] - c[0]) * s, o.flat ? 0 : (p[1] - c[1]) * s + h / 2, (p[2] - c[2]) * s])
  }

  /** Force-directed: links pull, everything repels, cooling over a fixed number of steps. */
  function force(keys, pairs) {
    const n = keys.length, rand = random(o.seed ?? 1), k = o.spacing ?? 1
    const warm = keys.some((key) => placed.has(key))
    const steps = o.steps ?? (warm ? 60 : 300)
    const p = keys.map((key, i) => {
      if (placed.has(key)) return [...placed.get(key)]
      // a new node starts beside a neighbour that is already placed, or anywhere
      const pair = pairs.find(([a, b]) => (a === i && placed.has(keys[b])) || (b === i && placed.has(keys[a])))
      const from = pair ? placed.get(keys[pair[0] === i ? pair[1] : pair[0]]) : [0, 0, 0]
      const spread = pair ? k * 0.5 : Math.cbrt(n) * k
      return [from[0] + (rand() - 0.5) * spread, o.flat ? 0 : from[1] + (rand() - 0.5) * spread, from[2] + (rand() - 0.5) * spread]
    })
    const disp = p.map(() => [0, 0, 0])
    for (let step = 0; step < steps; step++) {
      const heat = (warm ? 0.02 : 0.1) * Math.sqrt(n) * k * (1 - step / steps)
      for (const v of disp) v.fill(0)
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = p[i][0] - p[j][0], dy = p[i][1] - p[j][1], dz = p[i][2] - p[j][2]
          const f = (k * k) / Math.max(dx * dx + dy * dy + dz * dz, 0.01)
          disp[i][0] += dx * f; disp[i][1] += dy * f; disp[i][2] += dz * f
          disp[j][0] -= dx * f; disp[j][1] -= dy * f; disp[j][2] -= dz * f
        }
      }
      for (const [a, b] of pairs) {
        const dx = p[a][0] - p[b][0], dy = p[a][1] - p[b][1], dz = p[a][2] - p[b][2]
        const f = Math.hypot(dx, dy, dz) / k
        disp[a][0] -= dx * f; disp[a][1] -= dy * f; disp[a][2] -= dz * f
        disp[b][0] += dx * f; disp[b][1] += dy * f; disp[b][2] += dz * f
      }
      for (let i = 0; i < n; i++) {
        // a little gravity keeps disconnected parts from drifting off
        for (let c = 0; c < 3; c++) disp[i][c] -= p[i][c] * 0.05
        const len = Math.hypot(...disp[i]) || 1, move = Math.min(len, heat) / len
        for (let c = 0; c < 3; c++) p[i][c] += disp[i][c] * move
        if (o.flat) p[i][1] = 0
      }
    }
    placed = new Map(keys.map((key, i) => [key, p[i]]))
    return p
  }

  return mark
}

/**
 * Tiers: rings stacked top to bottom by a field, each ring ordered to sit under its links.
 * @param {any[]} rows @param {any[]} keys @param {number[][]} pairs
 * @param {{ tiers: string, order?: any[] }} layout @param {number[]} box
 */
function tiers(rows, keys, pairs, layout, [w, h, d]) {
  const field = layout.tiers
  if (!rows.length) return []
  if (!(field in rows[0])) fail('chart()', `layout: { tiers: '${field}' } - '${field}' isn't a node field`)
  const order = layout.order ?? [...new Set(rows.map((r) => r[field]))]
  const tierOf = rows.map((r) => Math.max(0, order.indexOf(r[field])))
  const count = Math.max(...tierOf) + 1
  const angle = new Array(rows.length).fill(0)
  const out = new Array(rows.length)
  const radius = Math.min(w, d) / 2 * 0.92
  for (let t = 0; t < count; t++) {
    const members = rows.map((_, i) => i).filter((i) => tierOf[i] === t)
    // sit under the nodes they link to in the tier above: order by those nodes' angles
    const pull = (i) => {
      const above = pairs.filter(([a, b]) => a === i || b === i).map(([a, b]) => (a === i ? b : a)).filter((j) => tierOf[j] < t)
      return above.length ? above.reduce((s, j) => s + angle[j], 0) / above.length : members.indexOf(i)
    }
    if (t > 0) members.sort((a, b) => pull(a) - pull(b))
    const r = members.length === 1 ? 0 : t === 0 ? radius * 0.25 : radius * (0.35 + 0.65 * t / Math.max(1, count - 1))
    members.forEach((i, m) => {
      angle[i] = (m + 0.5) / members.length * Math.PI * 2
      out[i] = [Math.cos(angle[i]) * r, h * (1 - t / Math.max(1, count - 1)), Math.sin(angle[i]) * r]
    })
  }
  void keys
  return out
}

/** @param {MarkContext} ctx */
function keyGetter(ctx) {
  const k = ctx.spec.channels.key
  if (k) return (row) => k.get(row)
  if (ctx.spec.rows.length && !('id' in ctx.spec.rows[0])) fail('chart()', "network nodes need an 'id' field, or key: 'yourIdField' - links name nodes by it")
  return (row) => row.id
}
