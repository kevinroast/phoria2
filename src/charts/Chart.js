// A chart: a Group that builds its marks, axes and legend from a spec, and animates to new data.
// Everything it makes is ordinary nodes - restyle, pick or add to them like anything else.
import { Group, NODE_OPTIONS } from '../scene/Node.js'
import { Label } from '../scene/drawables.js'
import { Color } from '../value/Color.js'
import { registerType } from '../registry.js'
import { describe, fail } from '../validate.js'
import { chartFrame } from './axes.js'
import { legend } from './legend.js'
import { barMark, lineMark, pointMark, stackKey, surfaceMark } from './marks.js'
import { networkMark } from './network.js'
import { SCHEMES, distinct, scaleBand, scaleColor, scaleLinear, scaleLog, scaleTime, toDate } from './scales.js'
import { normalise } from './spec.js'
import { addStyle } from './style.js'
import { EASES } from '../ease.js'

/** @import { Mark, MarkContext, Target } from './marks.js' */
/** @import { Scale, ColorScale } from './scales.js' */
/** @import { Channel } from './spec.js' */

// node options a chart passes to its Group; 'tooltip' and 'highlight' are the chart's own
const NODE_KEYS = NODE_OPTIONS.filter((k) => !['children', 'tooltip', 'highlight'].includes(k))

/**
 * Build a chart from a spec - mark, data and channels:
 *
 *     scene.add(chart({ mark: 'bar', data: rows, x: 'month', z: 'region', y: 'sales', color: 'region' }))
 * @param {Record<string, any>} spec
 * @returns {Chart}
 */
export function chart(spec) {
  return new Chart(spec)
}

export class Chart extends Group {
  static type = 'chart'
  // only node options reach Node's own checks; the spec is checked by normalise()
  static get OPTIONS() { return NODE_OPTIONS }

  /** The scales in use - place your own content in data coordinates: chart.scales.y(50). @type {{ x?: Scale, y?: Scale, z?: Scale, color?: ColorScale, size?: Scale }} */
  scales = {}

  /** @type {Record<string, any>} the spec as given, data included */ #input
  /** @type {ReturnType<typeof normalise> | null} */ #spec = null
  /** @type {Mark | null} */ #mark = null
  #signature = ''
  /** @type {MarkContext} */ #ctx
  /** @type {Group | null} */ #frame = null
  /** @type {Label | null} */ #title = null
  /** @type {Set<string>} colour values switched off in the legend */ #hidden = new Set()
  /** @type {((row: any) => boolean) | null} */ #filter = null
  // what is drawn now: its state, and the layout that state is in
  /** @type {Float32Array | null} */ #current = null
  /** @type {Target | null} */ #shown = null
  /** @type {{ from: Float32Array, to: Float32Array, t: number, frame: Target, final: Target } | null} */ #tween = null

  /** @param {Record<string, any>} spec mark, data, channels and options - and node options such as position */
  constructor(spec) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) fail('chart()', `expected a spec such as { mark: 'bar', data, x, y }, got ${describe(spec)}`)
    const node = {}, rest = {}
    for (const [k, v] of Object.entries(spec)) (NODE_KEYS.includes(k) ? node : rest)[k] = v
    if (spec.children) fail('chart()', "a chart makes its own children - add other nodes to a Group beside it")
    super(node)
    addStyle()
    this.#input = rest
    this.#ctx = /** @type {MarkContext} */ ({})
    this.#rebuild(true)
    // transitions and flowing links run from the scene clock
    this.onUpdate((_, dt) => this.#step(dt))
  }

  /** The normalised spec: mark, channels (fields, types, titles) and options. */
  get spec() {
    const s = /** @type {ReturnType<typeof normalise>} */ (this.#spec)
    return { mark: s.mark, channels: s.channels, options: s.options }
  }

  /** The data as given. */
  get data() {
    return this.#input.data
  }

  /** The nodes drawing the data, for styling: chart.marks[0].material.roughness = 0.2. @returns {import('../scene/Node.js').Node[]} */
  get marks() {
    return this.#mark ? [...this.#mark.nodes] : []
  }

  /**
   * New data - rows, or { nodes, links } for a network - or changed spec options. Marks animate:
   * new ones grow in, changed ones move, removed ones shrink away, matched by the key channel (or
   * an id field, or position).
   * @param {any[] | Record<string, any>} change
   * @returns {this}
   */
  update(change) {
    const data = Array.isArray(change) || (change && 'nodes' in change && 'links' in change)
    this.#input = data ? { ...this.#input, data: change } : { ...this.#input, ...change }
    this.#rebuild(true)
    return this
  }

  /** Show only the rows that pass, animated; null shows them all. @param {((row: any) => boolean) | null} fn @returns {this} */
  filter(fn) {
    if (fn !== null && typeof fn !== 'function') fail('Chart', `filter() takes (row) => boolean, or null, got ${describe(fn)}`)
    this.#filter = fn
    this.#rebuild(true)
    return this
  }

  /** One line about this chart, for view.explain(). */
  explain() {
    const s = /** @type {ReturnType<typeof normalise>} */ (this.#spec)
    const axes = ['x', 'y', 'z'].filter((k) => this.scales[k]).map((k) => {
      const sc = this.scales[k]
      return sc.kind === 'band' ? `${k} band of ${sc.domain.length}` : `${k} ${sc.kind} ${sc.format(sc.domain[0])}-${sc.format(sc.domain[1])}`
    })
    const shown = this.#shown?.rows.length ?? 0
    return `Chart (${s.mark}): ${shown} of ${s.rows.length} rows shown${axes.length ? `; ${axes.join(', ')}` : ''}${s.links.length ? `; ${s.links.length} links` : ''}`
  }

  /** @returns {Record<string, unknown>} */
  jsonOptions() {
    return { ...this.#input }
  }

  toJSON() {
    // the children are made from the spec, so the spec is the description
    const json = super.toJSON()
    delete json.children
    return json
  }

  /** A new chart from the same spec and transform. @returns {any} */
  clone() {
    // the node options a chart takes (its tooltip and highlight are its own, in its spec)
    const { name, position, quaternion, scale, visible, pickable, highlightWhole, onHover, onClick, showFrom, clip, onDrag, outline } = super.cloneOptions()
    const copy = new Chart({ ...this.#input, name, position, quaternion, scale, visible, pickable, highlightWhole, onHover, onClick, showFrom, clip, onDrag, outline })
    // as Node.clone() does - but not the update handlers, which include this chart's own
    copy.userData = structuredClone(this.userData)
    copy.matrixAutoUpdate = this.matrixAutoUpdate
    if (!copy.matrixAutoUpdate) copy.matrix.copy(this.matrix)
    return copy
  }

  /** @param {boolean} animate */
  #rebuild(animate) {
    const spec = normalise(this.#input)
    const o = spec.options, ch = spec.channels
    this.#spec = spec
    const box = /** @type {[number, number, number]} */ (o.box ?? defaultBox(spec))
    const theme = o.theme ?? 'dark'
    if (theme !== 'dark' && theme !== 'light') fail('chart()', `theme '${theme}' - expected 'dark' or 'light'`)
    // one rule for every label the chart draws, covered by another label or by the marks: by default
    // they fade rather than vanish, so the chart keeps its shape as it turns
    const overlap = o.overlap ?? 'dim'
    if (!['dim', 'hide', 'show'].includes(overlap)) fail('chart()', `overlap '${overlap}' - expected 'dim', 'hide' or 'show'`)
    const visible = spec.rows.filter((r) => (!this.#filter || this.#filter(r)) && (!ch.color?.field || !this.#hidden.has(String(ch.color.get(r)))))

    this.scales = scalesFor(spec, box)
    const color = this.scales.color
    const fallback = Color.fromInput(ch.color?.field ? SCHEMES.category[0] : ch.color?.value ?? SCHEMES.category[0], 'chart()').toSRGB()
    const linkColors = spec.link.color?.field ? colorScale(spec.link.color, spec.links.map((l) => spec.link.color.get(l))) : null
    Object.assign(this.#ctx, {
      spec, box, theme, overlap, scales: this.scales,
      size: this.scales.size ?? null,
      rgb: (row) => (color ? color(colorValue(spec, row)).toSRGB() : fallback),
      format: formatValue,
      linkColor: (v) => /** @type {ColorScale} */ (linkColors)(v),
    })

    // a different kind of chart (or channels) means new marks; the same kind keeps them, to animate
    const signature = JSON.stringify([spec.mark, Object.entries(ch).map(([k, c]) => [k, c.field, c.type]), box, theme, overlap, o.stack, o.layout, o.flat, Object.keys(spec.link)])
    if (signature !== this.#signature) {
      this.#signature = signature
      if (this.#mark) this.remove(.../** @type {any[]} */ (this.#mark.nodes))
      this.#mark = makeMark(spec.mark, this.#ctx)
      for (const node of this.#mark.nodes) this.add(node)
      this.#current = this.#shown = null
      this.#tween = null
    }
    if (this.#frame) this.remove(this.#frame)
    this.#frame = spec.mark === 'network' && o.layout !== 'given' ? null : this.add(chartFrame({ box, theme, overlap, axes: axesFor(spec, this.scales) }))
    if (this.#title) this.remove(this.#title)
    this.#title = o.title ? this.add(new Label({ text: String(o.title), position: [0, box[1] * 1.12, -box[2] / 2], className: `phoria-axis-title phoria-${theme}`, overlap: 'show' })) : null

    this.#setLegend(spec, theme)
    this.tooltip = spec.tooltip === null && !spec.link.tooltip ? null : (hit) => this.#tooltipFor(hit)
    const hl = o.highlight
    this.highlight = hl === false ? null : Color.fromInput(hl === undefined || hl === 'neighbours' || hl === 'node' ? '#ffffff' : hl, 'chart()')

    this.#show(/** @type {Mark} */ (this.#mark).layout(visible), animate && o.transition !== false)
  }

  /** @param {ReturnType<typeof normalise>} spec @param {'dark' | 'light'} theme */
  #setLegend(spec, theme) {
    this.overlay?.remove()
    this.overlay = null
    const c = spec.channels.color, o = spec.options.legend
    // no legend outside a browser (tests, servers)
    if (!c?.field || o === false || !this.scales.color || typeof document === 'undefined') return
    const el = legend(this.scales.color, {
      title: c.title, theme, position: o?.position, ticks: o?.ticks, format: (v) => formatValue(c, v),
      onToggle: (value, on) => {
        if (on) this.#hidden.delete(String(value))
        else this.#hidden.add(String(value))
        this.#rebuild(true)
      },
    })
    // keep switched-off entries looking off
    el.querySelectorAll('.phoria-legend-item').forEach((item, i) => {
      if (this.#hidden.has(String(this.scales.color?.domain[i]))) item.classList.add('off')
    })
    const container = o?.container
    if (container) {
      const host = typeof container === 'string' ? document.querySelector(container) : container
      if (!host) fail('chart()', `legend container ${describe(container)} not found`)
      el.classList.remove(`phoria-legend-${o?.position ?? 'top-right'}`)
      // laid out in the page's flow: a row that wraps, as tall as it needs - not the floating box
      Object.assign(el.style, { position: 'static', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center',
        columnGap: '12px', maxHeight: 'none', overflow: 'visible' })
      host.replaceChildren(el)
    } else {
      this.overlay = el
    }
  }

  /** @param {any} hit */
  #tooltipFor(hit) {
    const spec = /** @type {ReturnType<typeof normalise>} */ (this.#spec)
    const row = hit.datum
    if (!row) return null
    const link = this.#mark?.tooltipRows?.(hit) === 'link'
    const list = /** @type {any} */ (link ? spec.link.tooltip : spec.tooltip)
    if (typeof list === 'function') return list(row, hit)
    if (link && (!list || !list.length)) {
      const s = spec.options.source ?? 'source', t = spec.options.target ?? 'target'
      return { title: `${row[s]} → ${row[t]}`, rows: Object.fromEntries(Object.entries(spec.link).filter(([k, c]) => k !== 'tooltip' && c.field).map(([, c]) => [c.title, formatValue(c, c.get(row))])) }
    }
    if (!list || !list.length) return null
    // the first category names the row; the rest are name/value pairs
    const head = list.find((/** @type {Channel} */ c) => c.type === 'nominal' || c.type === 'ordinal')
    const rows = Object.fromEntries(list.filter((/** @type {Channel} */ c) => c !== head).map((/** @type {Channel} */ c) => [c.title, formatValue(c, c.get(row))]))
    return head ? { title: formatValue(head, head.get(row)), rows } : { rows }
  }

  // move to a new target: straight there, or by a tween from what is drawn now
  /** @param {Target} target @param {boolean} animate */
  #show(target, animate) {
    const mark = /** @type {Mark} */ (this.#mark)
    const now = this.#shown, cur = this.#current
    if (!animate) return this.#draw(target.state, target, target)
    const { stride } = target
    let from, to, frame = target
    if (target.keys && mark.enter) {
      // keyed: match items by key; new ones enter from nothing, missing ones leave to nothing
      const before = new Map(now?.keys?.map((k, i) => [k, i]) ?? [])
      const keep = new Set(target.keys)
      // rows the interrupted animation was already taking away go now, rather than leaving all
      // over again - or under a steady stream of changes they would never be gone
      const going = new Set(this.#tween?.final.keys ?? now?.keys)
      const leaving = now?.keys ? now.keys.map((_, i) => i).filter((i) => {
        const key = /** @type {any[]} */ (now.keys)[i]
        return !keep.has(key) && going.has(key)
      }) : []
      const n = target.keys.length + leaving.length
      from = new Float32Array(n * stride)
      to = new Float32Array(n * stride)
      to.set(target.state)
      target.keys.forEach((key, i) => {
        const j = before.get(key)
        const slot = from.subarray(i * stride, (i + 1) * stride)
        if (j !== undefined && cur && now?.stride === stride) slot.set(cur.subarray(j * stride, (j + 1) * stride))
        else {
          slot.set(target.state.subarray(i * stride, (i + 1) * stride))
          mark.enter(slot)
        }
      })
      leaving.forEach((j, e) => {
        const i = target.keys.length + e
        from.set(/** @type {Float32Array} */ (cur).subarray(j * stride, (j + 1) * stride), i * stride)
        to.set(/** @type {Float32Array} */ (cur).subarray(j * stride, (j + 1) * stride), i * stride)
        mark.enter(to.subarray(i * stride, (i + 1) * stride))
      })
      frame = { ...target, rows: [...target.rows, ...leaving.map((j) => /** @type {Target} */ (now).rows[j])],
        // leaving is empty unless there were keys before
        keys: [...target.keys, ...leaving.map((j) => /** @type {any[]} */ (/** @type {Target} */ (now).keys)[j])], state: to }
    } else if (now && cur && cur.length === target.state.length && now.stride === stride && sameShape(now.shape, target.shape)) {
      from = cur.slice()
      to = target.state
    } else {
      return this.#draw(target.state, target, target)
    }
    this.#tween = { from, to, t: 0, frame, final: target }
    this.#draw(from, frame, frame)
  }

  /** @param {Float32Array} state @param {Target} frame @param {Target} shown */
  #draw(state, frame, shown) {
    /** @type {Mark} */ (this.#mark).apply(state, frame)
    this.#current = state.slice()
    this.#shown = shown
  }

  /** @param {number} dt */
  #step(dt) {
    this.#mark?.tick?.(dt)
    const tw = this.#tween
    if (!tw) return
    const o = this.#input.transition ?? {}
    const duration = o.duration ?? 0.5
    const ease = EASES[o.ease ?? 'out']
    if (!ease) fail('chart()', `transition ease '${o.ease}' - expected ${Object.keys(EASES).map((e) => `'${e}'`).join(', ')}`)
    tw.t = Math.min(1, tw.t + dt / duration)
    const k = ease(tw.t)
    const state = new Float32Array(tw.from.length)
    for (let i = 0; i < state.length; i++) state[i] = tw.from[i] + (tw.to[i] - tw.from[i]) * k
    if (tw.t < 1) return this.#draw(state, tw.frame, tw.frame)
    this.#tween = null
    this.#draw(tw.final.state, tw.final, tw.final)
  }
}

registerType(Chart)

/** Do two layouts have the same shape (series lengths, grid size), so one can tween into the other? */
function sameShape(a, b) {
  const key = (s) => JSON.stringify(s ? { lengths: s.lengths, nx: s.nx, nz: s.nz } : null)
  return key(a) === key(b)
}

/** @param {string} mark @param {MarkContext} ctx */
function makeMark(mark, ctx) {
  if (mark === 'bar') return barMark(ctx)
  if (mark === 'point') return pointMark(ctx)
  if (mark === 'line' || mark === 'area') return lineMark(ctx, mark === 'area')
  if (mark === 'surface') return surfaceMark(ctx)
  return networkMark(ctx)
}

/** @param {ReturnType<typeof normalise>} spec @returns {[number, number, number]} */
function defaultBox(spec) {
  const z = !!spec.channels.z
  if (spec.mark === 'surface') return [10, 4, 10]
  if (spec.mark === 'network') return spec.options.flat ? [12, 1, 12] : [12, 8, 12]
  if (spec.mark === 'point') return [8, 6, z ? 8 : 1.6]
  return [10, 6, z ? 6 : 1.6]
}

/** @param {any[]} values @returns {[number, number]} */
function extent(values) {
  let lo = Infinity, hi = -Infinity
  for (const v of values) {
    const n = +v
    if (!Number.isFinite(n)) continue
    if (n < lo) lo = n
    if (n > hi) hi = n
  }
  return lo === Infinity ? [0, 1] : [lo, hi]
}

/** @param {Channel} c */
function colorOptions(c) {
  return { scheme: c.scale.scheme, range: c.scale.range }
}

/**
 * A channel's colour scale: its type says ramp or categories - not the shape of its values, which
 * can't tell two nominal years from a numeric range.
 * @param {any} c the channel @param {any[]} values @param {keyof typeof SCHEMES} [scheme] the default scheme
 */
function colorScale(c, values, scheme) {
  return c.type === 'quantitative'
    ? scaleColor({ kind: 'sequential', domain: c.scale.domain ?? extent(values), ...colorOptions(c), scheme: c.scale.scheme ?? scheme })
    : scaleColor({ kind: 'categorical', domain: c.scale.domain ?? distinct(values), ...colorOptions(c) })
}

/** The value a row is coloured by: the colour field, or (for surfaces, by default) its height. */
function colorValue(spec, row) {
  const c = spec.channels.color
  return c?.field ? c.get(row) : spec.channels.y.get(row)
}

/**
 * Scales for the channels, over all the rows (not just those shown), so the axes stay put while a
 * legend entry or filter hides some.
 * @param {ReturnType<typeof normalise>} spec @param {[number, number, number]} box
 */
function scalesFor(spec, box) {
  const [w, h, d] = box
  const ch = spec.channels, rows = spec.rows, out = {}
  const ranges = { x: [-w / 2, w / 2], y: [0, h], z: [d / 2, -d / 2] }
  for (const name of ['x', 'y', 'z']) {
    const c = ch[name]
    if (!c?.field) continue
    // the values listed as ticks are always on the axis
    const listed = c.axis && c.axis.ticks
    const values = [...rows.map((r) => c.get(r)), ...(Array.isArray(listed) ? listed : [])]
    const o = { range: ranges[name], format: (c.axis && c.axis.format) ?? c.format }
    const banded = c.type === 'nominal' || c.type === 'ordinal' || (spec.mark === 'bar' && name !== 'y')
    if (banded) {
      out[name] = scaleBand({ domain: c.scale.domain ?? distinct(values), padding: 0.2, ...o })
    } else if (c.type === 'temporal') {
      const [a, b] = extent(values.map((v) => toDate(v).getTime()))
      out[name] = scaleTime({ domain: /** @type {any} */ (c.scale.domain ?? [a, b]), ...o })
    } else {
      let domain = c.scale.domain ?? extent(values)
      // stacked bars and areas reach the totals, not the single values
      if (name === 'y' && spec.options.stack) domain = extent([0, ...stackTotals(spec)])
      if (c.scale.type === 'log') out[name] = scaleLog({ domain, ...o })
      else out[name] = scaleLinear({ domain, nice: c.scale.nice ?? true, zero: c.scale.zero ?? (name === 'y' && ['bar', 'area'].includes(spec.mark)), ...o })
    }
  }
  const color = ch.color
  if (color?.field || spec.mark === 'surface') {
    const c = color?.field ? color : ch.y
    const ticks = spec.options.legend?.ticks
    // as on an axis, a number key reaches the values listed as its ticks
    const values = [...rows.map((r) => c.get(r)), ...(c.type === 'quantitative' && Array.isArray(ticks) ? ticks : [])]
    out.color = colorScale(c, values, spec.mark === 'surface' && !color?.field ? 'viridis' : undefined)
  }
  const size = ch.size
  if (size?.field) {
    const unit = Math.min(...box) / 40
    // network nodes stay small beside their links, so the links read as the connections they are
    const range = spec.mark === 'network' ? [unit * 0.6, unit * 1.8] : [unit * 0.5, unit * 2]
    out.size = scaleLinear({ domain: extent(rows.map((r) => size.get(r))), range: /** @type {[number, number]} */ (size.scale.range ?? range) })
  }
  return out
}

/** Running totals per x (and z) for stacked charts. */
function stackTotals(spec) {
  const ch = spec.channels, totals = new Map()
  for (const r of spec.rows) {
    const v = Number(ch.y.get(r)) || 0
    const k = stackKey(ch, r, v)
    totals.set(k, (totals.get(k) ?? 0) + v)
  }
  return [...totals.values()]
}

/** @param {ReturnType<typeof normalise>} spec @param {Chart['scales']} scales */
function axesFor(spec, scales) {
  const axes = {}
  for (const name of ['x', 'y', 'z']) {
    const c = spec.channels[name]
    if (scales[name] && c) axes[name] = { scale: scales[name], channel: c, title: (c.axis && c.axis.title) ?? c.title }
  }
  return axes
}

const NUMBER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })
const COMPACT = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
const DATE = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

/** A value as text, by its channel's format (Intl options or a function). @param {Channel} c @param {any} v */
export function formatValue(c, v) {
  if (v === null || v === undefined) return ''
  const f = c.format
  if (typeof f === 'function') return String(f(v))
  if (v instanceof Date) return f ? new Intl.DateTimeFormat(undefined, f).format(v) : DATE.format(v)
  if (typeof v === 'number') return f ? new Intl.NumberFormat(undefined, f).format(v) : (Math.abs(v) >= 1e4 ? COMPACT : NUMBER).format(v)
  return String(v)
}
