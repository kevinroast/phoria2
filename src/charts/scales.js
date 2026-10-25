// Scales map data values to positions or colours. Each is a function with a few members - ticks(),
// format(), invert() - in the spirit of d3-scale, but a small subset written for charts in a box.
import { Color } from '../value/Color.js'
import { describe, fail } from '../validate.js'

/** @typedef {Intl.NumberFormatOptions | Intl.DateTimeFormatOptions | ((value: any) => string)} FormatOption */

/**
 * @typedef {object} ScaleBase
 * @property {'linear' | 'log' | 'time' | 'band'} kind
 * @property {any[]} domain
 * @property {[number, number]} range
 * @property {(count?: number) => any[]} ticks
 * @property {(value: any) => string} format
 */
/** @typedef {((value: any) => number) & ScaleBase & { invert?: (y: number) => any, bandwidth?: number, step?: number }} Scale */

const LOG10 = Math.log(10)

/** A round step near span / count: 1, 2 or 5 times a power of ten. @param {number} span @param {number} count */
export function tickStep(span, count) {
  const raw = span / Math.max(1, count)
  const power = 10 ** Math.floor(Math.log(raw) / LOG10)
  const error = raw / power
  return power * (error >= 7.07 ? 10 : error >= 3.16 ? 5 : error >= 1.41 ? 2 : 1)
}

/** @param {FormatOption | undefined} option @param {(v: any) => string} fallback */
function formatter(option, fallback, date = false) {
  if (typeof option === 'function') return option
  if (option && typeof option === 'object') {
    const f = date ? new Intl.DateTimeFormat(undefined, /** @type {Intl.DateTimeFormatOptions} */ (option))
      : new Intl.NumberFormat(undefined, /** @type {Intl.NumberFormatOptions} */ (option))
    return (v) => f.format(v)
  }
  if (option !== undefined) fail('charts', `'format' must be Intl format options or a function, got ${describe(option)}`)
  return fallback
}

/** Plain numbers to a step's precision; compact (1.2K) from ten thousand. @param {number} step @param {number} max */
function numberFormat(step, max) {
  const digits = Math.max(0, Math.min(6, -Math.floor(Math.log(step || 1) / LOG10)))
  const plain = new Intl.NumberFormat(undefined, { maximumFractionDigits: digits })
  const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
  return (v) => (Math.abs(max) >= 1e4 ? compact : plain).format(v)
}

/** @param {unknown} v @param {string} name @returns {[number, number]} */
function pair(v, name) {
  if (!Array.isArray(v) || v.length !== 2 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    fail('charts', `'${name}' must be [min, max] numbers, got ${describe(v)}`)
  }
  return /** @type {[number, number]} */ ([v[0], v[1]])
}

/**
 * Numbers to numbers in proportion.
 *
 *     const y = scaleLinear({ domain: [0, 120], range: [0, 6] })
 *     y(60)        // 3
 *     y.ticks(5)   // [0, 20, 40, 60, 80, 100, 120]
 * @param {{ domain: [number, number], range?: [number, number], nice?: boolean, zero?: boolean, clamp?: boolean,
 *   format?: FormatOption }} options nice widens the domain to round ends; zero takes it to include 0
 * @returns {Scale}
 */
export function scaleLinear({ domain, range = [0, 1], nice = false, zero = false, clamp = false, format }) {
  let [d0, d1] = pair(domain, 'domain')
  const [r0, r1] = pair(range, 'range')
  if (zero) {
    d0 = Math.min(0, d0)
    d1 = Math.max(0, d1)
  }
  if (d0 === d1) {
    // a single value still gets a little room
    d0 -= d0 ? Math.abs(d0) * 0.5 : 1
    d1 += d1 ? Math.abs(d1) * 0.5 : 1
  }
  if (nice) {
    const step = tickStep(d1 - d0, 5)
    d0 = Math.floor(d0 / step) * step
    d1 = Math.ceil(d1 / step) * step
  }
  const k = (r1 - r0) / (d1 - d0)
  const scale = /** @type {Scale} */ ((v) => {
    const t = r0 + (v - d0) * k
    return clamp ? Math.min(Math.max(t, Math.min(r0, r1)), Math.max(r0, r1)) : t
  })
  scale.kind = 'linear'
  scale.domain = [d0, d1]
  scale.range = [r0, r1]
  scale.invert = (y) => d0 + (y - r0) / k
  scale.ticks = (count = 5) => {
    const step = tickStep(d1 - d0, count), out = []
    for (let v = Math.ceil(d0 / step) * step; v <= d1 + step * 1e-9; v += step) out.push(+v.toFixed(12))
    return out
  }
  scale.format = formatter(format, numberFormat(tickStep(d1 - d0, 5), Math.max(Math.abs(d0), Math.abs(d1))))
  return scale
}

/**
 * Positive numbers on a log scale, for values spanning orders of magnitude.
 * @param {{ domain: [number, number], range?: [number, number], format?: FormatOption }} options
 * @returns {Scale}
 */
export function scaleLog({ domain, range = [0, 1], format }) {
  const [d0, d1] = pair(domain, 'domain')
  if (d0 <= 0 || d1 <= 0) fail('charts', `a log scale needs a domain above 0, got [${d0}, ${d1}] - use a linear scale for zero or negative values`)
  const inner = scaleLinear({ domain: [Math.log10(d0), Math.log10(d1)], range })
  const scale = /** @type {Scale} */ ((v) => inner(Math.log10(v)))
  scale.kind = 'log'
  scale.domain = [d0, d1]
  scale.range = inner.range
  scale.invert = (y) => 10 ** /** @type {number} */ (inner.invert?.(y))
  scale.ticks = () => {
    const out = []
    for (let p = Math.floor(Math.log10(d0)); p <= Math.ceil(Math.log10(d1)); p++) {
      for (const m of [1, 2, 5]) {
        const v = m * 10 ** p
        if (v >= d0 * 0.999 && v <= d1 * 1.001) out.push(v)
      }
    }
    return out
  }
  scale.format = formatter(format, (v) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(v))
  return scale
}

// tick intervals for time, in ms, and how to label each
const SECOND = 1000, MINUTE = 60 * SECOND, HOUR = 60 * MINUTE, DAY = 24 * HOUR
/** @type {[number, string][]} */
const INTERVALS = [
  [SECOND, 's'], [5 * SECOND, 's'], [15 * SECOND, 's'], [30 * SECOND, 's'], [MINUTE, 'm'], [5 * MINUTE, 'm'], [15 * MINUTE, 'm'],
  [30 * MINUTE, 'm'], [HOUR, 'h'], [3 * HOUR, 'h'], [6 * HOUR, 'h'], [12 * HOUR, 'h'], [DAY, 'd'], [2 * DAY, 'd'], [7 * DAY, 'w'],
  [30 * DAY, 'M'], [91 * DAY, 'Q'], [365 * DAY, 'Y'],
]
const DATE_FORMATS = {
  s: { hour: '2-digit', minute: '2-digit', second: '2-digit' }, m: { hour: '2-digit', minute: '2-digit' }, h: { hour: '2-digit', minute: '2-digit' },
  d: { month: 'short', day: 'numeric' }, w: { month: 'short', day: 'numeric' }, M: { month: 'short', year: 'numeric' },
  Q: { month: 'short', year: 'numeric' }, Y: { year: 'numeric' },
}

/** A Date from a Date, a timestamp or a date string. @param {unknown} v @returns {Date} */
export function toDate(v) {
  const d = v instanceof Date ? v : new Date(/** @type {any} */ (v))
  if (Number.isNaN(d.getTime())) fail('charts', `${describe(v)} isn't a date - use Date objects, timestamps or ISO strings like '2026-10-25'`)
  return d
}

/**
 * Dates to numbers, with ticks on calendar boundaries (days, months, years) and labels to match.
 * @param {{ domain: [unknown, unknown], range?: [number, number], format?: FormatOption }} options
 * @returns {Scale}
 */
export function scaleTime({ domain, range = [0, 1], format }) {
  const t0 = toDate(domain[0]).getTime(), t1 = toDate(domain[1]).getTime()
  const inner = scaleLinear({ domain: [t0, t1], range })
  const span = Math.max(1, t1 - t0)
  const pick = (count) => INTERVALS.find(([ms]) => span / ms <= count) ?? INTERVALS[INTERVALS.length - 1]
  const scale = /** @type {Scale} */ ((v) => inner(toDate(v).getTime()))
  scale.kind = 'time'
  scale.domain = [new Date(t0), new Date(t1)]
  scale.range = inner.range
  scale.invert = (y) => new Date(/** @type {number} */ (inner.invert?.(y)))
  scale.ticks = (count = 5) => {
    const [ms, unit] = pick(count)
    const out = []
    const d = new Date(t0)
    // start on a boundary of the interval's unit
    d.setMilliseconds(0)
    if (unit !== 's') d.setSeconds(0)
    if (!'sm'.includes(unit)) d.setMinutes(0)
    if ('dwMQY'.includes(unit)) d.setHours(0)
    if ('MQY'.includes(unit)) d.setDate(1)
    if (unit === 'Y') d.setMonth(0)
    const months = unit === 'M' ? 1 : unit === 'Q' ? 3 : unit === 'Y' ? 12 : 0
    while (d.getTime() < t0) months ? d.setMonth(d.getMonth() + months) : d.setTime(d.getTime() + /** @type {number} */ (ms))
    for (let i = 0; d.getTime() <= t1 && i < 200; i++) {
      out.push(new Date(d))
      if (months) d.setMonth(d.getMonth() + months)
      else d.setTime(d.getTime() + /** @type {number} */ (ms))
    }
    return out
  }
  const auto = new Intl.DateTimeFormat(undefined, /** @type {any} */ (DATE_FORMATS[pick(6)[1]]))
  scale.format = formatter(format, (v) => auto.format(toDate(v)), true)
  return scale
}

/**
 * Categories to evenly spaced bands; the value is the band's centre.
 *
 *     const months = scaleBand({ domain: ['Jan', 'Feb', 'Mar'], range: [0, 9], padding: 0.2 })
 *     months('Feb')        // 4.5
 *     months.bandwidth     // 2.4 - the band's width without its padding
 * @param {{ domain: unknown[], range?: [number, number], padding?: number, format?: FormatOption }} options
 * @returns {Scale}
 */
export function scaleBand({ domain, range = [0, 1], padding = 0.2, format }) {
  if (!Array.isArray(domain)) fail('charts', `a band scale's domain is a list of categories, got ${describe(domain)}`)
  const [r0, r1] = pair(range, 'range')
  const index = new Map(domain.map((v, i) => [String(v), i]))
  const step = (r1 - r0) / Math.max(1, domain.length)
  const scale = /** @type {Scale} */ ((v) => {
    const i = index.get(String(v))
    return i === undefined ? NaN : r0 + step * (i + 0.5)
  })
  scale.kind = 'band'
  scale.domain = domain
  scale.range = [r0, r1]
  scale.step = step
  scale.bandwidth = Math.abs(step) * (1 - padding)
  scale.ticks = () => domain
  scale.format = formatter(format, (v) => String(v))
  return scale
}

// colour schemes: categorical (Tableau 10) and ramps for numbers, as sRGB hex stops
export const SCHEMES = {
  category: ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#76b7b2', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'],
  viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
  blues: ['#eff3ff', '#bdd7e7', '#6baed6', '#3182bd', '#08519c'],
  heat: ['#2c7bb6', '#abd9e9', '#ffffbf', '#fdae61', '#d7191c'],
  cool: ['#f7fcf0', '#ccebc5', '#7bccc4', '#2b8cbe', '#084081'],
  redblue: ['#b2182b', '#ef8a62', '#f7f7f7', '#67a9cf', '#2166ac'],
}

/**
 * @typedef {((value: any) => Color) & { kind: 'categorical' | 'sequential', domain: any[], range: string[],
 *   colors: () => { value: any, color: Color }[] }} ColorScale
 */

/**
 * Values to colours: categories to a categorical scheme, numbers along a ramp (mixed in linear
 * space). Give a scheme name or a range of colours.
 *
 *     scaleColor({ domain: ['ok', 'warn', 'down'], range: ['#59a14f', '#f2b134', '#e15759'] })
 *     scaleColor({ domain: [18, 35], scheme: 'heat' })
 * @param {{ domain: any[], scheme?: keyof typeof SCHEMES, range?: string[] }} options numbers in the domain make a
 *   sequential scale, anything else categorical
 * @returns {ColorScale}
 */
export function scaleColor({ domain, scheme, range }) {
  if (scheme !== undefined && !(scheme in SCHEMES)) {
    fail('charts', `colour scheme '${scheme}' isn't one we have - use ${Object.keys(SCHEMES).map((k) => `'${k}'`).join(', ')}, or a range of colours`)
  }
  const sequential = domain.length === 2 && domain.every((v) => typeof v === 'number')
  const stops = (range ?? SCHEMES[scheme ?? (sequential ? 'viridis' : 'category')]).map((c) => Color.fromInput(c, 'charts'))
  /** @type {ColorScale} */
  let scale
  if (sequential) {
    const [d0, d1] = domain
    scale = /** @type {ColorScale} */ ((v) => {
      const t = Math.min(1, Math.max(0, (v - d0) / (d1 - d0 || 1))) * (stops.length - 1)
      const i = Math.min(stops.length - 2, Math.floor(t))
      return stops[i].clone().lerp(stops[i + 1], t - i)
    })
    scale.kind = 'sequential'
    scale.colors = () => []
  } else {
    const index = new Map(domain.map((v, i) => [String(v), i]))
    scale = /** @type {ColorScale} */ ((v) => stops[(index.get(String(v)) ?? 0) % stops.length].clone())
    scale.kind = 'categorical'
    scale.colors = () => domain.map((value) => ({ value, color: scale(value) }))
  }
  scale.domain = domain
  scale.range = stops.map((c) => c.getStyle())
  return scale
}
