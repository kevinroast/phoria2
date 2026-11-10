// The marks: each turns rows into a flat numeric state - a few numbers per item - and writes a
// state into its nodes. The chart tweens between states for transitions, so a mark only has to
// lay out and draw, never animate.
import { Geometry } from '../geometry/Geometry.js'
import { box as boxGeometry, cylinder, icosphere } from '../geometry/generators.js'
import { Texture } from '../material/Texture.js'
import { InstancedMesh, Lines, Mesh, Points } from '../scene/drawables.js'
import { fail } from '../validate.js'
import { distinct, scaleColor } from './scales.js'

/**
 * Where a row stacks: on the others at its x and in its depth series, negatives down from zero on
 * their own. One rule for the bars, the lines and areas, and the y domain they are drawn in.
 * @param {any} ch the spec's channels @param {any} row @param {number} v its y value
 * @returns {string}
 */
export function stackKey(ch, row, v) {
  const xv = ch.x?.get(row)
  return `${xv instanceof Date ? xv.getTime() : xv}|${ch.z ? ch.z.get(row) : ''}|${v < 0 ? '-' : '+'}`
}

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
          const at = stackKey(ch, row, v)
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
    // dots with a darker rim, so each one reads where they crowd together - drawn furthest first, so
    // each blends over the ones behind it
    : new Points({ geometry: emptyPoints(64), material: { size: ctx.spec.channels.size?.value ?? unit * 1.4, vertexColors: true, map: dot(), depthWrite: false, ...material },
      sort: true, labels: labelsOf(ctx, 'above') })
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

/** @type {Texture | null} */
let dotTexture = null

/**
 * A dot: a white disc whose outer part darkens to a rim, with a soft edge - pixels of its own, so
 * charts need no canvas to make it. Shared by every scatter.
 */
function dot() {
  if (dotTexture) return dotTexture
  const size = 64, data = new Uint8Array(size * size * 4), r = size / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - r, y + 0.5 - r) / r
      // the colour full to 0.78 of the radius, then down to 0.62 at the edge; alpha soft over the last pixel and a half
      const shade = d < 0.78 ? 1 : 1 - (d - 0.78) / 0.22 * 0.38
      const alpha = Math.min(1, Math.max(0, (1 - d) * r / 1.5))
      const o = (y * size + x) * 4
      data[o] = data[o + 1] = data[o + 2] = Math.round(shade * 255)
      data[o + 3] = Math.round(alpha * 255)
    }
  }
  return (dotTexture = new Texture({ image: { data, width: size, height: size } }))
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
          const at = stackKey(ch, row, v)
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
      // a parametric surface's rows come in grid order already: its x and z are where the points are,
      // not the grid's lines
      const layoutGrid = ctx.spec.grid
      if (layoutGrid) {
        const state = new Float32Array(rows.length * 6)
        rows.forEach((row, i) => state.set([x(ch.x.get(row)), y(ch.y.get(row)), z(ch.z.get(row)), ...ctx.rgb(row)], i * 6))
        return { rows, keys: null, state, stride: 6, shape: { nx: layoutGrid.nx, nz: layoutGrid.nz } }
      }
      const xs = distinct(rows.map((r) => ch.x.get(r))), zs = distinct(rows.map((r) => ch.z.get(r)))
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


// --- curves -------------------------------------------------------------------------------

/**
 * A path through x, y and z, drawn in the order of its rows - a helix, an orbit, a GPS track - not
 * sorted along x as a line is. One path, or one per detail value. Coloured by the colour channel,
 * or from end to end along the viridis ramp; size, a number, is its width in pixels.
 * @param {MarkContext} ctx @returns {Mark}
 */
export function curveMark(ctx) {
  const ch = ctx.spec.channels
  const lines = new Lines({ geometry: new Geometry({ positions: [0, 0, 0, 0, 0, 0] }), material: { width: ch.size?.value ?? 3, vertexColors: true } })
  return {
    nodes: [lines],
    layout(rows) {
      const { x, y, z } = ctx.scales
      const by = ch.detail ?? null
      const groups = new Map()
      for (const row of rows) {
        const k = by ? String(by.get(row)) : ''
        if (!groups.has(k)) groups.set(k, [])
        groups.get(k).push(row)
      }
      const series = [...groups.values()], ordered = series.flat()
      // no colour channel: end to end along the ramp; a field or a constant colour as any mark has it
      const ramp = ch.color ? null : scaleColor({ kind: 'sequential', domain: [0, 1], scheme: 'viridis' })
      const state = new Float32Array(ordered.length * 6)
      let i = 0
      for (const path of series) {
        path.forEach((row, k) => {
          const rgb = ramp ? ramp(path.length > 1 ? k / (path.length - 1) : 0).toSRGB() : ctx.rgb(row)
          state.set([pos(x, ch.x, row), pos(y, ch.y, row), pos(z, ch.z, row), ...rgb], i++ * 6)
        })
      }
      return { rows: ordered, keys: null, state, stride: 6, shape: { lengths: series.map((p) => p.length) } }
    },
    apply(state, target) {
      const positions = [], colors = [], data = []
      let i = 0
      for (const n of target.shape.lengths) {
        for (let k = 0; k < n; k++, i++) {
          if (k === 0) continue
          positions.push(...state.subarray((i - 1) * 6, (i - 1) * 6 + 3), ...state.subarray(i * 6, i * 6 + 3))
          colors.push(...state.subarray((i - 1) * 6 + 3, i * 6), ...state.subarray(i * 6 + 3, i * 6 + 6))
          // a segment is its far end's row: hovering a curve names the point it reaches
          data.push(target.rows[i])
        }
      }
      lines.geometry = replace(lines.geometry, positions.length ? { positions, colors } : { positions: [0, 0, 0, 0, 0, 0] })
      lines.data = data
    },
  }
}

// --- vector fields ------------------------------------------------------------------------

/** An arrow a unit long along +Y and a unit wide, centred on the origin: a shaft and a cone. */
function arrowGeometry() {
  const shaft = cylinder({ radius: 0.07, height: 0.68, segments: 10 }), head = cylinder({ radius: 0.2, radiusTop: 0, height: 0.32, segments: 14 })
  const positions = [], normals = [], indices = []
  for (const [g, dy] of /** @type {[Geometry, number][]} */ ([[shaft, -0.16], [head, 0.34]])) {
    const base = positions.length / 3
    const p = g.positions, n = /** @type {Float32Array} */ (g.normals)
    for (let i = 0; i < p.length; i += 3) positions.push(p[i], p[i + 1] + dy, p[i + 2])
    normals.push(...n)
    for (const k of /** @type {Uint32Array} */ (g.indices)) indices.push(base + k)
  }
  return new Geometry({ positions, normals, indices })
}

/**
 * An arrow at each sample of a field, pointing its way, as long as its magnitude allows - the
 * longest nearly the gap to the next sample - and coloured by the colour channel (by default the
 * magnitude). Arrows keep their shape down to a width of a third of the longest, so a weak one is still seen.
 * Directions follow the axes' scales, so with unequal units they lean as drawn.
 * @param {MarkContext} ctx @returns {Mark}
 */
export function vectorMark(ctx) {
  /** @type {any} */
  let node = new InstancedMesh({ geometry: arrowGeometry(), material: { roughness: 0.45 }, count: 64 })
  node.count = 0
  const mark = {
    nodes: [node],
    layout(rows) {
      const { x, y, z } = ctx.scales, ch = ctx.spec.channels
      // world units per data unit along each axis
      const kx = x(1) - x(0), ky = y(1) - y(0), kz = z(1) - z(0)
      const gap = (s, c) => {
        const values = distinct(rows.map((r) => c.get(r)))
        return values.length > 1 ? Math.abs(s(values[1]) - s(values[0])) : Infinity
      }
      const cell = Math.min(gap(x, ch.x), gap(y, ch.y), gap(z, ch.z))
      const dirs = rows.map((r) => [r.vx * kx, r.vy * ky, r.vz * kz])
      const longest = Math.max(...dirs.map((d) => Math.hypot(...d)), 0) || 1
      const reach = Number.isFinite(cell) ? cell * 0.9 : Math.min(...ctx.box) / 10, scale = reach / longest
      const state = new Float32Array(rows.length * 10)
      rows.forEach((row, i) => {
        const d = dirs[i], len = Math.hypot(...d)
        const u = len > 0 ? d.map((v) => v / len) : [0, 1, 0]
        state.set([x(ch.x.get(row)), y(ch.y.get(row)), z(ch.z.get(row)), ...u, len * scale, ...ctx.rgb(row)], i * 10)
      })
      return { rows, keys: null, state, stride: 10, shape: { count: rows.length, width: reach } }
    },
    apply(state, target) {
      const n = state.length / target.stride
      if (n > node.instanceMatrices.length / 16) {
        const bigger = new InstancedMesh({ geometry: node.geometry, material: node.material, count: n })
        node.parent?.add(bigger)
        node.parent?.remove(node)
        mark.nodes[0] = node = bigger
      }
      node.count = n
      node.data = target.rows
      for (let i = 0; i < n; i++) {
        const [px, py, pz, ux, uy, uz, len, r, g, b] = state.subarray(i * 10, i * 10 + 10)
        // turned from +Y to its direction (a tween leaves it a little short of unit length)
        const m = Math.hypot(ux, uy, uz) || 1, dx = ux / m, dy = uy / m, dz = uz / m
        const q = dy < -0.9999 ? [1, 0, 0, 0] : normalised([dz, 0, -dx, 1 + dy])
        // shaped as the arrow is - as wide as it is long - down to a floor, so a weak one is still an arrow, not a disc
        const w = len > 1e-6 ? Math.max(len, target.shape.width * 0.35) : 1e-4
        node.setInstance(i, { position: [px, py, pz], quaternion: q, scale: [w, Math.max(1e-4, len), w], color: [r, g, b] })
      }
    },
  }
  return mark
}

/** @param {number[]} q */
function normalised(q) {
  const l = Math.hypot(...q)
  return q.map((v) => v / l)
}
