// The marks: each turns rows into a flat numeric state - a few numbers per item - and writes a
// state into its nodes. The chart tweens between states for transitions, so a mark only has to
// lay out and draw, never animate.
import { Geometry } from '../geometry/Geometry.js'
import { box as boxGeometry, icosphere } from '../geometry/generators.js'
import { InstancedMesh, Lines, Mesh, Points } from '../scene/drawables.js'
import { fail } from '../validate.js'

/** @import { Node } from '../scene/Node.js' */
/** @import { Scale, ColorScale } from './scales.js' */
/** @import { Channel, normalise } from './spec.js' */

/**
 * @typedef {object} MarkContext
 * @property {ReturnType<typeof normalise>} spec
 * @property {[number, number, number]} box
 * @property {{ x?: Scale, y?: Scale, z?: Scale }} scales
 * @property {Scale | null} size
 * @property {(row: any) => number[]} rgb a row's colour, sRGB 0-1
 * @property {'dark' | 'light'} theme
 * @property {'dim' | 'hide' | 'show'} overlap what the chart's labels do when covered
 * @property {(channel: Channel, value: any) => string} format
 * @property {(value: any) => import('../value/Color.js').Color} linkColor a network link's colour for a value
 */

/**
 * What a mark draws for some rows: a state of `stride` numbers per item, and the rows behind them.
 * Keyed items can enter, move and leave one by one; unkeyed states only tween when their shapes match.
 * @typedef {object} Target
 * @property {any[]} rows
 * @property {any[] | null} keys
 * @property {Float32Array} state
 * @property {number} stride
 * @property {any} [shape] mark-specific layout that stays fixed through a tween (series lengths, grid size)
 */

/**
 * @typedef {object} Mark
 * @property {Node[]} nodes
 * @property {(rows: any[]) => Target} layout
 * @property {(state: Float32Array, target: Target) => void} apply
 * @property {(item: Float32Array) => void} [enter] make one item's state absent (zero height, zero size)
 * @property {(dt: number) => void} [tick] per-frame work, such as flowing packets
 * @property {(hit: any) => any} [tooltipRows] which tooltip channels apply to a hit, when not the chart's
 */

/** The theme's label class for values on marks. @param {MarkContext} ctx */
const valueClass = (ctx) => `phoria-value phoria-${ctx.theme}`

/**
 * The label option for an InstancedMesh or Points, from the label channel.
 * @param {MarkContext} ctx @param {'above' | 'center'} place
 */
export function labelsOf(ctx, place) {
  const c = ctx.spec.channels.label
  if (!c) return null
  const p = c.priority
  const priority = typeof p === 'function' ? p : typeof p === 'string' ? (row) => Number(row[p]) || 0 : (p ?? 0)
  return { text: (row) => (row ? ctx.format(c, c.get(row)) : null), place, className: valueClass(ctx), priority, occlude: true, overlap: ctx.overlap }
}

/** A position along a scale; bands give their centre. @param {Scale | undefined} s @param {Channel | undefined} c @param {any} row */
const pos = (s, c, row) => (s && c ? s(c.get(row)) : 0)

// --- bars ---------------------------------------------------------------------------------

/** @param {MarkContext} ctx @returns {Mark} */
export function barMark(ctx) {
  let mesh = makeBars(64, ctx)
  const mark = {
    nodes: [mesh],
    layout(rows) {
      const { x, y, z } = ctx.scales, ch = ctx.spec.channels
      const share = ctx.spec.options.width ?? 0.7
      const w = (x.bandwidth ?? ctx.box[0] / 20) * share / (1 - 0.2)
      const d = z?.bandwidth !== undefined ? z.bandwidth * share / (1 - 0.2) : Math.min(w, ctx.box[2] * 0.8)
      const base = y(Math.max(y.domain[0], Math.min(0, y.domain[1])))
      // stacking: running totals per x (and z), in row order
      const stacks = new Map()
      const stride = 9, state = new Float32Array(rows.length * stride)
      rows.forEach((row, i) => {
        const v = Number(ch.y.get(row)) || 0
        let y0 = base, y1 = y(v)
        if (ctx.spec.options.stack) {
          const at = `${ch.x.get(row)}|${ch.z ? ch.z.get(row) : ''}|${v < 0 ? '-' : '+'}`
          const below = stacks.get(at) ?? 0
          y0 = y(below)
          y1 = y(below + v)
          stacks.set(at, below + v)
        }
        state.set([pos(x, ch.x, row), pos(z, ch.z, row), y0, y1, w, d, ...ctx.rgb(row)], i * stride)
      })
      return { rows, keys: keysOf(ctx, rows), state, stride }
    },
    apply(state, target) {
      const n = state.length / target.stride
      if (n > mesh.instanceMatrices.length / 16) {
        // more bars than room: a bigger mesh, swapped in place
        const bigger = makeBars(n * 2, ctx)
        mesh.parent?.add(bigger)
        mesh.parent?.remove(mesh)
        mesh.dispose()
        mark.nodes[0] = mesh = bigger
      }
      mesh.count = n
      mesh.data = target.rows
      for (let i = 0; i < n; i++) {
        const [x, z, y0, y1, w, d, r, g, b] = state.subarray(i * 9, i * 9 + 9)
        mesh.setInstance(i, { position: [x, (y0 + y1) / 2, z], scale: [w, Math.max(1e-3, Math.abs(y1 - y0)), d], color: [r, g, b] })
      }
    },
    enter(item) {
      item[3] = item[2]
    },
  }
  return mark
}

/** @param {number} capacity @param {MarkContext} ctx */
function makeBars(capacity, ctx) {
  const mesh = new InstancedMesh({ geometry: boxGeometry(1), material: { roughness: 0.55 }, count: capacity, labels: labelsOf(ctx, 'above') })
  mesh.count = 0
  return mesh
}

/** Keys for transitions: the key channel, an id field, or nothing (match by order). @param {MarkContext} ctx @param {any[]} rows */
function keysOf(ctx, rows) {
  const k = ctx.spec.channels.key
  if (k) return rows.map((r) => k.get(r))
  if (rows.length && rows[0] && 'id' in rows[0]) return rows.map((r) => r.id)
  return rows.map((_, i) => i)
}

// --- points -------------------------------------------------------------------------------

/** @param {MarkContext} ctx @returns {Mark} */
export function pointMark(ctx) {
  const sized = !!ctx.spec.channels.size?.field
  const unit = Math.min(...ctx.box) / 40
  const opacity = ctx.spec.channels.opacity?.value
  const material = { roughness: 0.4, ...(opacity !== undefined ? { opacity } : {}) }
  /** @type {any} */
  let node = sized
    ? new InstancedMesh({ geometry: icosphere({ radius: 1, detail: 1 }), material, count: 64, labels: labelsOf(ctx, 'above') })
    : new Points({ geometry: emptyPoints(64), material: { size: ctx.spec.channels.size?.value ?? unit * 1.4, vertexColors: true, ...material },
      labels: labelsOf(ctx, 'above') })
  if (sized) node.count = 0
  const mark = {
    nodes: [node],
    layout(rows) {
      const { x, y, z } = ctx.scales, ch = ctx.spec.channels
      const stride = sized ? 7 : 6, state = new Float32Array(rows.length * stride)
      rows.forEach((row, i) => {
        const p = [pos(x, ch.x, row), pos(y, ch.y, row), pos(z, ch.z, row)]
        state.set(sized ? [...p, ctx.size(ch.size.get(row)), ...ctx.rgb(row)] : [...p, ...ctx.rgb(row)], i * stride)
      })
      return { rows, keys: keysOf(ctx, rows), state, stride }
    },
    apply(state, target) {
      const n = state.length / target.stride
      node.data = target.rows
      if (sized) {
        if (n > node.instanceMatrices.length / 16) {
          const bigger = new InstancedMesh({ geometry: node.geometry, material: node.material, count: n * 2, labels: node.labels })
          node.parent?.add(bigger)
          node.parent?.remove(node)
          mark.nodes[0] = node = bigger
        }
        node.count = n
        for (let i = 0; i < n; i++) {
          const [x, y, z, s, r, g, b] = state.subarray(i * 7, i * 7 + 7)
          node.setInstance(i, { position: [x, y, z], scale: Math.max(1e-4, s), color: [r, g, b] })
        }
        return
      }
      const geometry = node.geometry
      if (n > geometry.vertexCount) node.geometry = emptyPoints(n * 2)
      const p = node.geometry.positions, c = node.geometry.colors
      for (let i = 0; i < n; i++) {
        p.set(state.subarray(i * 6, i * 6 + 3), i * 3)
        c.set(state.subarray(i * 6 + 3, i * 6 + 6), i * 3)
      }
      node.geometry.drawCount = n
      node.geometry.needsUpdate()
      if (node.geometry !== geometry) geometry.dispose()
    },
    enter(item) {
      // points rise from the floor; sized points grow from nothing
      if (sized) item[3] = 0
      else item[1] = 0
    },
  }
  return mark
}

/** @param {number} n */
function emptyPoints(n) {
  const g = new Geometry({ positions: new Float32Array(n * 3), colors: new Float32Array(n * 3) })
  g.drawCount = 0
  return g
}

// --- lines and areas ----------------------------------------------------------------------

/** @param {MarkContext} ctx @param {boolean} area @returns {Mark} */
export function lineMark(ctx, area) {
  const lines = new Lines({ geometry: new Geometry({ positions: [0, 0, 0, 0, 0, 0] }), material: { width: 2.5, vertexColors: true }, pickable: false })
  const dots = new Points({ geometry: emptyPoints(8), material: { size: 7, sizeAttenuation: false, vertexColors: true }, labels: labelsOf(ctx, 'above') })
  const fill = area ? new Mesh({ geometry: new Geometry({ positions: [0, 0, 0, 0, 0, 0, 0, 0, 0] }), material: { vertexColors: true, opacity: 0.55, doubleSided: true, unlit: true }, pickable: false }) : null
  return {
    nodes: fill ? [fill, lines, dots] : [lines, dots],
    layout(rows) {
      const { x, y, z } = ctx.scales, ch = ctx.spec.channels
      // series by colour, detail or z field; each in x order
      const by = ch.color?.field ? ch.color : ch.detail ?? (ch.z?.field ? ch.z : null)
      const groups = new Map()
      for (const row of rows) {
        const k = by ? String(by.get(row)) : ''
        if (!groups.has(k)) groups.set(k, [])
        groups.get(k).push(row)
      }
      // in order along the x axis, whatever its type (numbers, dates or categories)
      const series = [...groups.values()].map((g) => g.sort((a, b) => x(ch.x.get(a)) - x(ch.x.get(b))))
      // stacked areas: each series sits on the running total at its x
      const totals = new Map()
      const ordered = series.flat()
      const state = new Float32Array(ordered.length * 4)
      let i = 0
      for (const s of series) {
        for (const row of s) {
          const xv = ch.x.get(row), v = Number(ch.y.get(row)) || 0
          const at = xv instanceof Date ? xv.getTime() : xv
          const below = ctx.spec.options.stack ? totals.get(at) ?? 0 : 0
          if (ctx.spec.options.stack) totals.set(at, below + v)
          state.set([x(xv), y(below + v), pos(z, ch.z, row), y(below)], i * 4)
          i++
        }
      }
      return { rows: ordered, keys: null, state, stride: 4, shape: { lengths: series.map((s) => s.length), colors: series.map((s) => ctx.rgb(s[0])) } }
    },
    apply(state, target) {
      const { lengths, colors } = target.shape
      const seg = [], segColors = [], dotPos = [], dotColors = [], tri = [], triColors = [], index = []
      let i = 0
      lengths.forEach((n, s) => {
        const c = colors[s]
        for (let k = 0; k < n; k++, i++) {
          const [px, py, pz, base] = state.subarray(i * 4, i * 4 + 4)
          dotPos.push(px, py, pz)
          dotColors.push(...c)
          if (k > 0) {
            seg.push(...state.subarray((i - 1) * 4, (i - 1) * 4 + 3), px, py, pz)
            segColors.push(...c, ...c)
          }
          if (fill) {
            const v = triColors.length / 3
            tri.push(px, py, pz, px, base, pz)
            triColors.push(...c, ...c)
            if (k > 0) index.push(v - 2, v - 1, v, v - 1, v + 1, v)
          }
        }
      })
      lines.geometry = replace(lines.geometry, seg.length ? { positions: seg, colors: segColors } : { positions: [0, 0, 0, 0, 0, 0] })
      dots.geometry = replace(dots.geometry, { positions: dotPos.length ? dotPos : [0, 0, 0], colors: dotPos.length ? dotColors : [0, 0, 0] })
      dots.geometry.drawCount = dotPos.length / 3
      // dense series get smaller dots, so the line still reads
      dots.material.size = Math.max(...lengths, 0) > 40 ? 4 : 7
      dots.data = target.rows
      if (fill) fill.geometry = replace(fill.geometry, index.length ? { positions: tri, colors: triColors, indices: index } : { positions: [0, 0, 0, 0, 0, 0, 0, 0, 0] })
    },
  }
}

/** A new geometry in place of an old one, freeing the old one's GPU copy. @param {Geometry} old @param {any} options */
function replace(old, options) {
  old.dispose()
  return new Geometry(options)
}

// --- surfaces -----------------------------------------------------------------------------

/** @param {MarkContext} ctx @returns {Mark} */
export function surfaceMark(ctx) {
  const mesh = new Mesh({ geometry: new Geometry({ positions: [0, 0, 0, 0, 0, 0, 0, 0, 0] }), material: { vertexColors: true, roughness: 0.6, doubleSided: true } })
  return {
    nodes: [mesh],
    layout(rows) {
      const { x, y, z } = ctx.scales, ch = ctx.spec.channels
      const xs = unique(rows.map((r) => ch.x.get(r))), zs = unique(rows.map((r) => ch.z.get(r)))
      const grid = new Map(rows.map((r) => [`${+ch.x.get(r)}|${+ch.z.get(r)}|${ch.x.get(r)}|${ch.z.get(r)}`, r]))
      const cell = (a, b) => grid.get(`${+a}|${+b}|${a}|${b}`)
      const missing = xs.length * zs.length - grid.size
      if (missing > 0) {
        const gap = xs.flatMap((a) => zs.map((b) => [a, b])).find(([a, b]) => !cell(a, b))
        fail('chart()', `a surface needs a value for every x and z pair - ${missing} of ${xs.length * zs.length} are missing (first: x ${gap[0]}, z ${gap[1]})`)
      }
      const ordered = [], state = new Float32Array(xs.length * zs.length * 6)
      let i = 0
      for (const b of zs) {
        for (const a of xs) {
          const row = cell(a, b)
          ordered.push(row)
          state.set([x(a), y(Number(ch.y.get(row)) || 0), z(b), ...ctx.rgb(row)], i++ * 6)
        }
      }
      return { rows: ordered, keys: null, state, stride: 6, shape: { nx: xs.length, nz: zs.length } }
    },
    apply(state, target) {
      const { nx, nz } = target.shape
      const positions = [], colors = [], indices = []
      for (let i = 0; i < nx * nz; i++) {
        positions.push(...state.subarray(i * 6, i * 6 + 3))
        colors.push(...state.subarray(i * 6 + 3, i * 6 + 6))
      }
      for (let j = 0; j < nz - 1; j++) {
        for (let i = 0; i < nx - 1; i++) {
          const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1
          indices.push(a, c, b, b, c, d)
        }
      }
      mesh.geometry = replace(mesh.geometry, { positions, colors, indices })
      // a row per vertex: picking gives the nearest grid point's row
      mesh.data = target.rows
    },
  }
}

/** Distinct values in order: numbers and dates ascending, anything else as first seen. @param {any[]} values */
function unique(values) {
  const seen = new Map()
  for (const v of values) seen.set(v instanceof Date ? v.getTime() : v, v)
  const list = [...seen.values()]
  return typeof list[0] === 'number' || list[0] instanceof Date ? list.sort((a, b) => +a - +b) : list
}
