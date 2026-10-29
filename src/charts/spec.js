// Chart specs in, normalised specs out: channels resolved to fields or constants, types inferred,
// and every mistake explained - including Vega-Lite, ECharts and Plotly habits - since a spec is
// exactly what an agent writes.
import { Color } from '../value/Color.js'
import { checkNumber, describe, didYouMean, fail } from '../validate.js'
import { toDate } from './scales.js'

/** @typedef {'quantitative' | 'nominal' | 'ordinal' | 'temporal'} FieldType */
/** @typedef {'bar' | 'point' | 'line' | 'area' | 'surface' | 'network'} Mark */

/**
 * A channel after normalising: a field (with a type and a getter) or a constant value.
 * @typedef {object} Channel
 * @property {string | null} field
 * @property {any} value a constant, when there is no field
 * @property {FieldType} type
 * @property {string} title for axes, legends and tooltips
 * @property {any} format Intl options or a function
 * @property {Record<string, any>} scale scale options: domain, range, scheme, zero, nice, type
 * @property {Record<string, any> | false} axis
 * @property {(row: any) => any} get the row's value (dates parsed)
 * @property {any} [priority] labels: a number, a field name or a function
 */

export const MARKS = /** @type {Mark[]} */ (['bar', 'point', 'line', 'area', 'surface', 'network'])
export const CHANNELS = ['x', 'y', 'z', 'color', 'size', 'opacity', 'label', 'key', 'detail']
export const OPTIONS = ['mark', 'data', 'encoding', 'tooltip', 'box', 'stack', 'width', 'layout', 'flat', 'steps', 'seed',
  'source', 'target', 'link', 'highlight', 'legend', 'theme', 'overlap', 'transition', 'title', '$schema', 'description', ...CHANNELS]
export const CHANNEL_OPTIONS = ['field', 'type', 'title', 'format', 'scale', 'axis', 'value', 'priority', 'legend']

// what other chart libraries call things
export const OPTION_HINTS = {
  series: "phoria2 charts map fields to channels instead of listing series - e.g. { mark: 'bar', x: 'month', y: 'sales', color: 'region' }",
  xAxis: "axes come from the channels - use x: { field, axis: { title } }",
  yAxis: "axes come from the channels - use y: { field, axis: { title } }",
  zAxis: "axes come from the channels - use z: { field, axis: { title } }",
  type: "use mark: 'bar' | 'point' | 'line' | 'area' | 'surface' | 'network'",
  transform: "transforms aren't supported - filter, sum or sort the rows before charting them",
  selection: "use view.on('click', (hit) => ...) or a chart's onClick; hit.datum is the row",
  params: "use view.on('click', (hit) => ...) or a chart's onClick; hit.datum is the row",
  facet: 'small multiples aren\'t supported - make one chart (or one View) per panel',
  repeat: 'small multiples aren\'t supported - make one chart (or one View) per panel',
  layer: 'layers aren\'t supported yet - add several charts to the same scene with the same box',
  hconcat: 'put each chart in its own View', vconcat: 'put each chart in its own View', concat: 'put each chart in its own View',
  height: "the canvas sets the size in pixels; 'box' sets the chart's size in the scene",
  colour: "use 'color'", colors: "use color: { field, scale: { range: [...] } }",
  nodes: "a network's nodes and links go in data: { nodes, links }", links: "a network's nodes and links go in data: { nodes, links }",
}
const MARK_HINTS = {
  scatter: 'point', scatter3d: 'point', circle: 'point', dots: 'point', column: 'bar', bars: 'bar', histogram: 'bar',
  heatmap: 'surface', mesh3d: 'surface', graph: 'network', tree: 'network', ribbon: 'area', lines: 'line', rect: 'bar',
}
export const CHANNEL_HINTS = {
  overlap: "set overlap on the chart - { overlap: 'dim' | 'hide' | 'show' } - it applies to all the chart's labels",
  aggregate: 'aggregate the rows first (e.g. sum per month) - charts draw rows as given',
  bin: 'bin the rows first - charts draw rows as given',
  timeUnit: 'round the dates in the rows first - charts draw rows as given',
  sort: 'sort with scale: { domain: [...] } in the order you want',
  stack: "stacking is the chart's option: stack: true",
}

/**
 * @param {Record<string, any>} input the spec as written
 * @returns {{ mark: Mark, rows: any[], links: any[], fields: string[], channels: Record<string, Channel>,
 *   tooltip: Channel[] | ((hit: any) => any) | null, link: Record<string, Channel>, options: Record<string, any> }}
 */
export function normalise(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('chart()', `expected a spec such as { mark: 'bar', data, x, y }, got ${describe(input)}`)
  for (const key of Object.keys(input)) {
    if (OPTIONS.includes(key)) continue
    fail('chart()', `unknown option '${key}' - ${OPTION_HINTS[key] ?? `expected ${OPTIONS.filter((k) => k[0] !== '$').join(', ')}${didYouMean(key, OPTIONS)}`}`)
  }
  if (typeof input.width === 'number' && input.width > 1) fail('chart()', `'width' is a bar's share of its band (0-1); in Vega-Lite it is pixels - here the canvas sets the size`)

  const mark = markOf(input.mark)
  const { rows, links } = dataOf(input.data, mark)
  const fields = fieldsOf(rows)
  // Vega-Lite nests channels under 'encoding'; flat channels win if both are given
  const encoding = { ...(input.encoding ?? {}) }
  for (const key of Object.keys(encoding)) {
    if (!CHANNELS.includes(key) && key !== 'tooltip') fail('chart()', `encoding '${key}' isn't a channel we have - channels are ${CHANNELS.join(', ')}, tooltip`)
  }
  /** @type {Record<string, Channel>} */
  const channels = {}
  for (const name of CHANNELS) {
    const spec = input[name] ?? encoding[name]
    if (spec !== undefined && spec !== null) channels[name] = channel(name, spec, rows, fields)
  }
  if (mark === 'network') {
    for (const name of ['x', 'y', 'z']) {
      if (channels[name] && input.layout !== 'given') fail('chart()', `${name} on a 'network' places its nodes - add layout: 'given' to use positions from the data`)
    }
  } else {
    for (const name of mark === 'surface' ? ['x', 'z', 'y'] : ['x', 'y']) {
      if (!channels[name]) fail('chart()', `a '${mark}' chart needs ${name} - e.g. ${name}: '${fields[0] ?? 'field'}'`)
      // bars, lines, areas and surfaces are laid out along these scales; only points can sit at a constant
      if (mark !== 'point' && channels[name].field === null) {
        fail('chart()', `${name} on a '${mark}' chart lays its marks out along a scale - it needs a field, not a constant value - e.g. ${name}: '${fields[0] ?? 'field'}'`)
      }
    }
  }

  const tooltipSpec = input.tooltip ?? encoding.tooltip
  const markTooltip = typeof input.mark === 'object' ? input.mark.tooltip : undefined
  const tooltip = tooltipOf(tooltipSpec ?? (markTooltip === false ? false : undefined), channels, rows, fields)

  /** @type {Record<string, Channel>} */
  const link = {}
  if (input.link !== undefined) {
    if (mark !== 'network') fail('chart()', "'link' sets a network's link channels - it needs mark: 'network'")
    const linkFields = fieldsOf(links)
    for (const [name, spec] of Object.entries(input.link)) {
      if (!['width', 'color', 'opacity', 'flow', 'tooltip'].includes(name)) fail('chart()', `link has no '${name}' - link channels are width, color, opacity, flow, tooltip`)
      if (name !== 'tooltip') link[name] = channel(`link.${name}`, spec, links, linkFields)
    }
    if (input.link.tooltip !== undefined) link.tooltip = /** @type {any} */ (tooltipOf(input.link.tooltip, {}, links, linkFields))
  }

  const options = {}
  for (const key of OPTIONS) if (!CHANNELS.includes(key) && !['mark', 'data', 'encoding', 'tooltip', 'link'].includes(key) && input[key] !== undefined) options[key] = input[key]
  // a network's force layout: how long it settles, and where it starts
  if (options.steps !== undefined && (!Number.isInteger(options.steps) || options.steps < 1)) {
    fail('chart()', `'steps' is how many steps the force layout takes, a whole number of 1 or more, got ${describe(options.steps)}`)
  }
  if (options.seed !== undefined) checkNumber('chart()', 'seed', options.seed)
  if (options.legend?.ticks !== undefined) checkTicks('legend', options.legend.ticks)
  if (options.box !== undefined && (!Array.isArray(options.box) || options.box.length !== 3 || !options.box.every((n) => n > 0))) {
    fail('chart()', `'box' is the chart's size in the scene, [x, y, z] above 0, got ${describe(options.box)}`)
  }
  return { mark, rows, links, fields, channels, tooltip, link, options }
}

/** @param {unknown} v @returns {Mark} */
function markOf(v) {
  let mark = v
  if (mark && typeof mark === 'object') {
    // Vega-Lite's { type: 'bar', tooltip: true }
    for (const key of Object.keys(mark)) {
      if (key !== 'type' && key !== 'tooltip') fail('chart()', `mark option '${key}' isn't supported - use the chart's options (width, stack, ...) or style the chart's nodes`)
    }
    mark = /** @type {any} */ (mark).type
  }
  if (typeof mark !== 'string') fail('chart()', `'mark' is required: one of ${MARKS.map((m) => `'${m}'`).join(', ')}`)
  if (!MARKS.includes(/** @type {Mark} */ (mark))) {
    const hint = MARK_HINTS[mark]
    if (mark === 'pie' || mark === 'arc' || mark === 'donut') fail('chart()', "pie and donut charts aren't supported - in 3D they distort values; use mark: 'bar'")
    fail('chart()', `mark '${mark}' - ${hint ? `use '${hint}'` : `expected one of ${MARKS.map((m) => `'${m}'`).join(', ')}${didYouMean(mark, MARKS)}`}`)
  }
  return /** @type {Mark} */ (mark)
}

/** @param {any} data @param {Mark} mark */
function dataOf(data, mark) {
  if (data && typeof data === 'object' && !Array.isArray(data) && 'url' in data) {
    fail('chart()', "data: { url } isn't loaded for you - fetch the rows and pass data: rows")
  }
  if (mark === 'network') {
    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.links)) fail('chart()', `a network's data is { nodes: [...], links: [...] }, got ${describe(data)}`)
    return { rows: data.nodes, links: data.links }
  }
  const rows = Array.isArray(data) ? data : data && Array.isArray(data.values) ? data.values : null
  if (!rows) fail('chart()', `'data' must be an array of rows (objects), or { values: [...] }, got ${describe(data)}`)
  if (rows.some((r) => !r || typeof r !== 'object')) fail('chart()', "every row in 'data' must be an object, such as { month: 'Jan', sales: 41 }")
  return { rows, links: [] }
}

/** Field names from the first rows. @param {any[]} rows @returns {string[]} */
function fieldsOf(rows) {
  const names = new Set()
  for (const row of rows.slice(0, 50)) for (const k of Object.keys(row)) names.add(k)
  return [...names]
}

/** @param {any[]} rows @param {string} field @returns {FieldType} */
function inferType(rows, field) {
  const v = rows.find((r) => r[field] !== null && r[field] !== undefined)?.[field]
  if (typeof v === 'number') return 'quantitative'
  if (v instanceof Date || (typeof v === 'string' && /^\d{4}-\d{2}(-\d{2})?([T ][\d:.]+Z?)?$/.test(v))) return 'temporal'
  return 'nominal'
}

/**
 * @param {string} name @param {any} spec @param {any[]} rows @param {string[]} fields
 * @returns {Channel}
 */
function channel(name, spec, rows, fields) {
  const owner = 'chart()'
  /** @type {Record<string, any>} */
  let o
  if (typeof spec === 'string') {
    if (fields.includes(spec)) o = { field: spec }
    else if (/color|colour/.test(name) && isColor(spec)) o = { value: spec }
    else fail(owner, `${name}: field '${spec}' isn't in the data - fields are ${fields.join(', ') || '(none)'}${didYouMean(spec, fields)}`)
  } else if (typeof spec === 'number' && ['size', 'opacity', 'link.width', 'link.opacity', 'link.flow'].includes(name)) {
    o = { value: spec }
  } else if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
    o = spec
    for (const key of Object.keys(o)) {
      if (!CHANNEL_OPTIONS.includes(key)) fail(owner, `${name}: '${key}' - ${CHANNEL_HINTS[key] ?? `unknown; a channel takes ${CHANNEL_OPTIONS.join(', ')}`}`)
    }
    if (o.field !== undefined && !fields.includes(o.field)) {
      fail(owner, `${name}: field '${o.field}' isn't in the data - fields are ${fields.join(', ') || '(none)'}${didYouMean(String(o.field), fields)}`)
    }
    if (o.field === undefined && o.value === undefined) fail(owner, `${name} needs a field (or a constant value)`)
  } else {
    // a size given as [x, y, z] meant the chart's size
    if (name === 'size' && Array.isArray(spec)) fail(owner, "'size' is a channel - the chart's size in the scene is 'box: [x, y, z]'")
    return fail(owner, `${name} must be a field name or { field, ... }, got ${describe(spec)}`)
  }
  if (o.axis?.ticks !== undefined) checkTicks(`${name}: axis`, o.axis.ticks)
  const field = o.field ?? null
  const type = o.type ?? (field ? inferType(rows, field) : 'nominal')
  if (!['quantitative', 'nominal', 'ordinal', 'temporal'].includes(type)) {
    fail(owner, `${name}: type '${type}' - expected 'quantitative', 'nominal', 'ordinal' or 'temporal'${didYouMean(String(type), ['quantitative', 'nominal', 'ordinal', 'temporal'])}`)
  }
  const get = field === null ? () => o.value : type === 'temporal' ? (r) => toDate(r[field]) : (r) => r[field]
  return { field, value: o.value, type, title: o.title ?? field ?? name, format: o.format, scale: o.scale ?? {}, axis: o.axis ?? {}, get,
    priority: o.priority }
}

/** Ticks are a list of the values to mark, or about how many. @param {string} what @param {unknown} ticks */
function checkTicks(what, ticks) {
  if (Array.isArray(ticks) || (Number.isInteger(ticks) && /** @type {number} */ (ticks) > 0)) return
  fail('chart()', `${what} ticks are a list of the values to mark, such as [0, 25, 50, 75, 100], or about how many, got ${describe(ticks)}`)
}

/** @param {string} s */
function isColor(s) {
  try {
    Color.fromInput(s)
    return true
  } catch {
    return false
  }
}

/**
 * Tooltip rows from fields, a function, or (by default) every channel with a field.
 * @param {any} spec @param {Record<string, Channel>} channels @param {any[]} rows @param {string[]} fields
 */
function tooltipOf(spec, channels, rows, fields) {
  if (spec === false || spec === null) return null
  if (typeof spec === 'function') return spec
  if (spec === undefined || spec === true) {
    const seen = new Set()
    return Object.entries(channels).filter(([n, c]) => c.field && n !== 'key' && !seen.has(c.field) && seen.add(c.field)).map(([, c]) => c)
  }
  const list = Array.isArray(spec) ? spec : [spec]
  // a field named on its own reads as its channel does - with that channel's title and format
  const encoded = (item) => typeof item === 'string' && Object.entries(channels).find(([n, c]) => n !== 'key' && c.field === item)?.[1]
  return list.map((item) => encoded(item) || channel('tooltip', item, rows, fields))
}
