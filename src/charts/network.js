// The network mark: nodes as instanced spheres, links as lines, laid out by force, by tiers or from
// the data. Layouts are deterministic (seeded), and updates start from where nodes already are, so a
// live map changes colour without moving.
import { seeded } from '../math/random.js'
import { Geometry } from '../geometry/Geometry.js'
import { icosphere } from '../geometry/generators.js'
import { InstancedMesh, Lines, Points } from '../scene/drawables.js'
import { Color } from '../value/Color.js'
import { describe, fail } from '../validate.js'
import { grow, labelsOf } from './marks.js'

/** @import { MarkContext, Mark } from './marks.js' */

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
  const nodesMesh = new InstancedMesh({ geometry: icosphere({ radius: 1, detail: 2 }), material: { roughness: 0.35 }, count: Math.max(8, ctx.spec.rows.length * 2), labels: labelsOf(ctx, 'above') })
  nodesMesh.count = 0
  // links in up to three widths; each segment carries its link's row
  const linkNodes = WIDTHS.map((width) => new Lines({ geometry: new Geometry({ positions: [0, 0, 0, 0, 0, 0] }), material: { width, vertexColors: true }, data: [] }))
  const active = new Lines({ geometry: new Geometry({ positions: [] }), material: { width: 4, color: '#7fd3ff' }, pickable: false, visible: false })
  // packets small beside the nodes, so the traffic reads as motion along the links, not more nodes
  const packets = linkCh.flow ? new Points({ geometry: new Geometry({ positions: [] }), material: { size: 0.012 * Math.min(...ctx.box), color: '#bff0ff' }, pickable: false }) : null
  /** @type {{ a: number, b: number, speed: number, phase: number }[]} */
  let flows = []
  /** the drawn node positions, by row index, as of the last apply */
  let at = []
  /** @type {any[]} */ let links = []
  /** @type {any[]} */ let rowsNow = []
  /** row index by key, for rowsNow @type {Map<unknown, number>} */ let indexNow = new Map()
  /** the largest link width and flow values, for scaling each link against @type {{ width: number, flow: number }} */
  let linkMax = { width: 1, flow: 1 }
  /** the hovered node by its key, not its row - rows move and go when the data changes; null for none */
  /** @type {unknown} */ let hovered = null

  const mark = {
    nodes: [...linkNodes, active, nodesMesh, ...(packets ? [packets] : [])],
    layout(rows) {
      const keys = rows.map(keyOf)
      const index = new Map(keys.map((k, i) => [k, i]))
      const known = new Set(ctx.spec.rows.map(keyOf))
      links = ctx.spec.links.filter((l, i) => {
        const a = l[source], b = l[target]
        if (a === undefined || b === undefined) fail('chart()', `link ${i} has no '${a === undefined ? source : target}' - links name their ends with source: '${source}', target: '${target}' (set 'source' and 'target' to your field names)`)
        if (!known.has(a)) fail('chart()', `link ${i}: ${source} ${describe(a)} names no node`)
        if (!known.has(b)) fail('chart()', `link ${i}: ${target} ${describe(b)} names no node`)
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
      const keys = t.rows.map(keyOf)
      const index = new Map(keys.map((k, i) => [k, i]))
      indexNow = index
      // a hovered node that has gone from the data is hovered no longer
      if (hovered !== null && !index.has(hovered)) {
        hovered = null
        active.visible = false
      }
      // each link's width and flow scale against the largest - found once, not once a link
      linkMax = { width: largest(linkCh.width), flow: largest(linkCh.flow) }
      // more nodes than room - arriving and leaving ones together, in a transition
      grow(nodesMesh, n)
      nodesMesh.count = n
      nodesMesh.data = t.rows
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
    nodesMesh.on('hover', hover)
  }
  /** @param {any} hit */
  function hover(hit) {
    const key = hit && hit.node === nodesMesh && hit.instance !== null ? keyOf(rowsNow[hit.instance]) : null
    if (key === hovered) return
    hovered = key
    active.visible = key !== null
    if (key !== null) showNeighbours(key)
    // recolour every node for the dimming, or back
    for (let k = 0; k < nodesMesh.count; k++) nodesMesh.setColor(k, dimmed(k, ctx.rgb(rowsNow[k])))
  }

  /** @param {unknown} key */
  function showNeighbours(key) {
    const p = []
    for (const l of links) {
      if (l[source] !== key && l[target] !== key) continue
      const a = indexNow.get(l[source]), b = indexNow.get(l[target])
      if (a !== undefined && b !== undefined) p.push(...at[a], ...at[b])
    }
    active.geometry.dispose()
    active.geometry = new Geometry({ positions: p })
  }

  /** the hovered node's neighbours by key, and what they were found for @type {{ key: unknown, links: any[], near: Set<unknown> } | null} */
  let nearHovered = null
  /** The hovered node's neighbours, found once per hover and per layout - not per node. @returns {Set<unknown>} */
  function neighboursOfHovered() {
    if (nearHovered && nearHovered.key === hovered && nearHovered.links === links) return nearHovered.near
    const near = new Set()
    for (const l of links) {
      if (l[source] === hovered) near.add(l[target])
      if (l[target] === hovered) near.add(l[source])
    }
    nearHovered = { key: hovered, links, near }
    return near
  }

  /** A node's colour, dimmed while another node and its neighbours are highlighted. @param {number} k @param {number[]} rgb */
  function dimmed(k, rgb) {
    if (hovered === null || !neighbours) return rgb
    const other = keyOf(rowsNow[k])
    if (other === hovered || neighboursOfHovered().has(other)) return rgb
    const c = new Color().setSRGB(rgb[0], rgb[1], rgb[2]).lerp(ctx.theme === 'light' ? '#ffffff' : '#202024', 0.65)
    return c.toSRGB()
  }

  /** @param {any} link */
  function widthClass(link) {
    const c = linkCh.width
    if (!c) return 0
    if (c.field === null) return c.value >= 3.5 ? 2 : c.value >= 2 ? 1 : 0
    return Math.min(2, Math.floor((Number(c.get(link)) || 0) / linkMax.width * 2.999))
  }

  /** The largest value a link channel takes over every link, or 1 when none is above 0. @param {any} c */
  function largest(c) {
    if (!c || c.field === null) return 1
    let max = 0
    for (const l of ctx.spec.links) max = Math.max(max, Number(c.get(l)) || 0)
    return max || 1
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
    return 0.15 + 0.6 * (Number(c.get(link)) || 0) / linkMax.flow
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
    if (layout && typeof layout === 'object' && 'tiers' in layout) return tiers(rows, pairs, layout, [w, h, d])
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

  /**
   * An organic layout by stress: nodes are placed so the distance between any two is as near as it
   * can be to the number of links between them. Every link comes out about the same length, a node
   * with one link sits beside its neighbour rather than flung out, and the whole spreads evenly -
   * where a force layout leaves a dense middle and far-off leaves, which then set the scale.
   */
  function force(keys, pairs) {
    // the same nodes and links as last time, all placed: they stay where they are - an update that
    // only recolours costs nothing here
    if (sameGraph(keys, pairs)) return keys.map((key) => [.../** @type {number[]} */ (placed.get(key))])
    const n = keys.length, rand = seeded(o.seed ?? 1)
    const warm = keys.some((key) => placed.has(key))
    const steps = o.steps ?? (warm ? 60 : 300)
    // links between every pair: breadth first from each node; parts not joined sit a hop beyond the furthest
    const near = keys.map(() => /** @type {number[]} */ ([]))
    for (const [a, b] of pairs) {
      near[a].push(b)
      near[b].push(a)
    }
    const hops = new Float32Array(n * n).fill(Infinity)
    let furthest = 1
    for (let s = 0; s < n; s++) {
      const queue = [s]
      hops[s * n + s] = 0
      for (let q = 0; q < queue.length; q++) {
        const at = queue[q], h = hops[s * n + at] + 1
        for (const t of near[at]) {
          if (hops[s * n + t] !== Infinity) continue
          hops[s * n + t] = h
          furthest = Math.max(furthest, h)
          queue.push(t)
        }
      }
    }
    // positions flat, x y z per node - the loop below is O(steps x n^2), so it reads no nested arrays
    const p = new Float64Array(n * 3)
    keys.forEach((key, i) => {
      let at = placed.get(key)
      if (!at) {
        // a new node starts beside a neighbour that is already placed, or anywhere
        const next = near[i].find((j) => placed.has(keys[j]))
        const from = next === undefined ? [0, 0, 0] : /** @type {number[]} */ (placed.get(keys[next]))
        const spread = next === undefined ? Math.sqrt(n) : 0.5
        at = [from[0] + (rand() - 0.5) * spread, o.flat ? 0 : from[1] + (rand() - 0.5) * spread, from[2] + (rand() - 0.5) * spread]
      }
      p.set(at, i * 3)
    })
    // each node in turn moves to where its distances to all the others fit best, nearer ones counting
    // more - until no node moves more than a ten-thousandth of a link
    const flat = !!o.flat
    for (let step = 0; step < steps; step++) {
      let moved = 0
      for (let i = 0; i < n; i++) {
        const px = p[i * 3], py = p[i * 3 + 1], pz = p[i * 3 + 2]
        let tx = 0, ty = 0, tz = 0, weights = 0
        for (let j = 0; j < n; j++) {
          if (i === j) continue
          const h = hops[i * n + j], want = h === Infinity ? furthest + 1 : h, w = 1 / (want * want)
          const qx = p[j * 3], qy = p[j * 3 + 1], qz = p[j * 3 + 2]
          const dx = px - qx, dy = py - qy, dz = pz - qz
          const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6
          tx += w * (qx + want * dx / len)
          ty += w * (qy + want * dy / len)
          tz += w * (qz + want * dz / len)
          weights += w
        }
        if (!weights) continue
        const nx = tx / weights, ny = flat ? py : ty / weights, nz = tz / weights
        moved = Math.max(moved, Math.abs(nx - px), Math.abs(ny - py), Math.abs(nz - pz))
        p[i * 3] = nx
        p[i * 3 + 1] = ny
        p[i * 3 + 2] = nz
      }
      if (moved < 1e-4) break
    }
    const out = keys.map((_, i) => [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]])
    placed = new Map(keys.map((key, i) => [key, [...out[i]]]))
    laidOut = { keys, pairs }
    return out
  }

  /** the nodes and links the force layout last ran for @type {{ keys: any[], pairs: number[][] } | null} */
  let laidOut = null
  /** Whether these are the nodes and links the force layout last ran for. @param {any[]} keys @param {number[][]} pairs */
  function sameGraph(keys, pairs) {
    if (!laidOut || laidOut.keys.length !== keys.length || laidOut.pairs.length !== pairs.length || o.steps !== undefined) return false
    for (let i = 0; i < keys.length; i++) if (laidOut.keys[i] !== keys[i] || !placed.has(keys[i])) return false
    for (let i = 0; i < pairs.length; i++) if (laidOut.pairs[i][0] !== pairs[i][0] || laidOut.pairs[i][1] !== pairs[i][1]) return false
    return true
  }

  return mark
}

/**
 * Tiers: rings stacked top to bottom by a field, each ring ordered to sit under its links.
 * @param {any[]} rows @param {number[][]} pairs
 * @param {{ tiers: string, order?: any[] }} layout @param {number[]} box
 */
function tiers(rows, pairs, layout, [w, h, d]) {
  const field = layout.tiers
  if (!rows.length) return []
  if (!(field in rows[0])) fail('chart()', `layout: { tiers: '${field}' } - '${field}' isn't a node field`)
  const order = layout.order ?? [...new Set(rows.map((r) => r[field]))]
  const tierOf = rows.map((r) => Math.max(0, order.indexOf(r[field])))
  const count = Math.max(...tierOf) + 1
  const angle = new Array(rows.length).fill(0)
  const out = new Array(rows.length)
  const radius = Math.min(w, d) / 2 * 0.92
  const near = rows.map(() => /** @type {number[]} */ ([]))
  for (const [a, b] of pairs) {
    near[a].push(b)
    near[b].push(a)
  }
  for (let t = 0; t < count; t++) {
    const members = rows.map((_, i) => i).filter((i) => tierOf[i] === t)
    // sit under the nodes they link to in the tier above: order by those nodes' angles - each found
    // once, before sorting
    if (t > 0) {
      const pull = new Map(members.map((i, m) => {
        const above = near[i].filter((j) => tierOf[j] < t)
        return [i, above.length ? above.reduce((s, j) => s + angle[j], 0) / above.length : m]
      }))
      members.sort((a, b) => /** @type {number} */ (pull.get(a)) - /** @type {number} */ (pull.get(b)))
    }
    const r = members.length === 1 ? 0 : t === 0 ? radius * 0.25 : radius * (0.35 + 0.65 * t / Math.max(1, count - 1))
    members.forEach((i, m) => {
      angle[i] = (m + 0.5) / members.length * Math.PI * 2
      out[i] = [Math.cos(angle[i]) * r, h * (1 - t / Math.max(1, count - 1)), Math.sin(angle[i]) * r]
    })
  }
  return out
}

/** @param {MarkContext} ctx */
function keyGetter(ctx) {
  const k = ctx.spec.channels.key
  if (k) return (row) => k.get(row)
  if (ctx.spec.rows.length && !('id' in ctx.spec.rows[0])) fail('chart()', "network nodes need an 'id' field, or key: 'yourIdField' - links name nodes by it")
  return (row) => row.id
}
