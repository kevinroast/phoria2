// Charts of functions: a spec with `fn` and the ranges to sample it over, instead of data. The
// function is sampled into rows here, and from there the chart is drawn as any other - axes,
// colour scales, tooltips and the tweens between one function (or one set of params) and the next.
//
//     chart({ mark: 'surface', fn: (x, z) => Math.sin(x) * Math.cos(z), x: [-3, 3], z: [-3, 3] })
//     chart({ mark: 'surface', fn: (u, v) => [x, y, z], u: [0, 2 * Math.PI], v: [0, Math.PI] })
//     chart({ mark: 'curve', fn: (t) => [Math.cos(t), t / 4, Math.sin(t)], t: [0, 12 * Math.PI] })
//     chart({ mark: 'vector', fn: (x, y, z) => [-z, 0, x], x: [-2, 2], z: [-2, 2] })
import { describe, fail } from '../validate.js'

// the options a chart of a function adds: its function, how finely to sample it, its parameters,
// and the ranges of the parameters that aren't axes
export const FUNCTION_OPTIONS = ['fn', 'samples', 'params', 't', 'u', 'v']

const DEFAULT_SAMPLES = { surface: 48, parametric: 64, curve: 256, vector: 9 }
const MAX_SAMPLES = 250_000

/**
 * What sampling gave: the spec with rows in place of fn, the grid a parametric surface is laid out
 * on, a line about it for summaries, and whether its axes default to equal units.
 * @typedef {object} Sampled
 * @property {Record<string, any>} input
 * @property {{ nx: number, nz: number } | null} grid rows in grid order, u along x - for surfaces whose
 *   x and z aren't the grid's (parametric ones)
 * @property {string} about
 * @property {boolean} equal
 */

/**
 * A spec with `fn`, as a spec with rows.
 * @param {Record<string, any>} input
 * @returns {Sampled}
 */
export function sampleFunction(input) {
  const { fn, samples, params, t, u, v, ...rest } = input
  const mark = typeof input.mark === 'object' && input.mark ? input.mark.type : input.mark
  if (typeof fn !== 'function') {
    fail('chart()', `'fn' is a function to plot, such as (x, z) => Math.sin(x) * Math.cos(z), got ${describe(fn)}`)
  }
  if (input.data !== undefined) fail('chart()', "a chart of a function has no 'data' - its rows are sampled from fn; leave data out")
  if (params !== undefined && (!params || typeof params !== 'object' || Array.isArray(params))) {
    fail('chart()', `'params' is an object of values handed to fn as its last argument, such as { a: 2 }, got ${describe(params)}`)
  }
  const p = params ?? {}
  const call = (/** @type {any[]} */ args) => fn(...args, p)
  if (mark === 'surface') {
    if (u !== undefined || v !== undefined) return parametric(rest, call, samples, u, v)
    if (t !== undefined) fail('chart()', "'t' is a curve's range - a surface is over x and z, or over u and v")
    return heights(rest, call, samples)
  }
  if (mark === 'curve') {
    if (u !== undefined || v !== undefined) fail('chart()', "'u' and 'v' are a parametric surface's ranges - a curve is over t")
    return curve(rest, call, samples, t)
  }
  if (mark === 'vector') return field(rest, call, samples)
  return fail('chart()', `'fn' is plotted as mark: 'surface', 'curve' or 'vector', not ${describe(mark)}`)
}

// y = fn(x, z): a height over the x-z grid
/** @param {Record<string, any>} spec @param {(args: any[]) => any} call @param {any} samples @returns {Sampled} */
function heights(spec, call, samples) {
  const x = axisRange(spec, 'x', true), z = axisRange(spec, 'z', true)
  const [nx, nz] = counts(samples, 2, DEFAULT_SAMPLES.surface)
  const rows = []
  for (let j = 0; j < nz; j++) {
    const zv = along(z, j, nz)
    for (let i = 0; i < nx; i++) {
      const xv = along(x, i, nx)
      rows.push({ x: xv, z: zv, y: number(call([xv, zv]), `x ${round(xv)}, z ${round(zv)}`) })
    }
  }
  return {
    input: { ...spec, data: rows, x: channel(spec, 'x', x), z: channel(spec, 'z', z), y: valueChannel(spec, 'y') },
    grid: null, about: `a function of x and z, ${nx} × ${nz} samples`, equal: false,
  }
}

// [x, y, z] = fn(u, v): a surface that can fold back on itself - a sphere, a torus
/** @param {Record<string, any>} spec @param {(args: any[]) => any} call @param {any} samples @param {any} u @param {any} v @returns {Sampled} */
function parametric(spec, call, samples, u, v) {
  const ur = paramRange('u', u), vr = paramRange('v', v)
  noAxisRanges(spec, 'a parametric surface')
  const [nu, nv] = counts(samples, 2, DEFAULT_SAMPLES.parametric)
  const rows = []
  for (let j = 0; j < nv; j++) {
    const vv = along(vr, j, nv)
    for (let i = 0; i < nu; i++) {
      const uv = along(ur, i, nu)
      rows.push({ u: uv, v: vv, ...point(call([uv, vv]), `u ${round(uv)}, v ${round(vv)}`) })
    }
  }
  return { input: { ...spec, data: rows, ...pointChannels(spec) }, grid: { nx: nu, nz: nv }, about: `a parametric surface, ${nu} × ${nv} samples`, equal: true }
}

// [x, y, z] = fn(t): a path through space, in order of t
/** @param {Record<string, any>} spec @param {(args: any[]) => any} call @param {any} samples @param {any} t @returns {Sampled} */
function curve(spec, call, samples, t) {
  const tr = paramRange('t', t)
  noAxisRanges(spec, 'a curve')
  const [n] = counts(samples, 1, DEFAULT_SAMPLES.curve)
  const rows = []
  for (let i = 0; i < n; i++) {
    const tv = along(tr, i, n)
    rows.push({ t: tv, ...point(call([tv]), `t ${round(tv)}`) })
  }
  return { input: { ...spec, data: rows, ...pointChannels(spec) }, grid: null, about: `a parametric curve, ${n} samples`, equal: true }
}

// [vx, vy, vz] = fn(x, y, z): an arrow at each point of a grid - over x and z, and y if given
/** @param {Record<string, any>} spec @param {(args: any[]) => any} call @param {any} samples @returns {Sampled} */
function field(spec, call, samples) {
  const x = axisRange(spec, 'x', true), z = axisRange(spec, 'z', true), y = axisRange(spec, 'y', false)
  // over x, y and z when y has a range - one sample in y is a layer at its start, the floor of a
  // surface drawn over the same range; with no y range, one layer over x and z at y = 0
  let nx, ny = 1, nz
  if (y) [nx, ny, nz] = counts(samples, 3, DEFAULT_SAMPLES.vector, false, [2, 1, 2])
  else [nx, nz] = counts(samples, 2, DEFAULT_SAMPLES.vector, true)
  if (nx * ny * nz > 20_000) fail('chart()', `a vector field of ${nx} × ${ny} × ${nz} arrows is too many to read - use samples of 20 or fewer a side`)
  const rows = []
  for (let k = 0; k < ny; k++) {
    const yv = y ? along(y, k, ny) : 0
    for (let j = 0; j < nz; j++) {
      const zv = along(z, j, nz)
      for (let i = 0; i < nx; i++) {
        const xv = along(x, i, nx)
        const d = point(call([xv, yv, zv]), `x ${round(xv)}, y ${round(yv)}, z ${round(zv)}`, 'a direction')
        rows.push({ x: xv, y: yv, z: zv, vx: d.x, vy: d.y, vz: d.z, magnitude: Math.hypot(d.x, d.y, d.z) })
      }
    }
  }
  // a field in a plane has no height to mark: no y axis unless asked for
  const yChannel = y ? channel(spec, 'y', y) : { axis: false, ...object(spec.y, 'y'), field: 'y' }
  return {
    input: { ...spec, data: rows, x: channel(spec, 'x', x), y: yChannel, z: channel(spec, 'z', z), color: spec.color ?? 'magnitude' },
    grid: null, about: `a vector field, ${nx} × ${ny} × ${nz} arrows`, equal: true,
  }
}

// ---- ranges, counts and values ------------------------------------------------------------

/**
 * An axis's range to sample over: x: [-3, 3], or x: { domain: [-3, 3], title, axis, ... }.
 * @param {Record<string, any>} spec @param {'x' | 'y' | 'z'} name @param {boolean} required
 * @returns {[number, number] | null}
 */
function axisRange(spec, name, required) {
  const c = spec[name]
  const domain = Array.isArray(c) ? c : c && typeof c === 'object' ? c.domain ?? c.scale?.domain : undefined
  if (domain === undefined) {
    if (!required) return null
    return fail('chart()', `a chart of a function needs the range of ${name} to sample - e.g. ${name}: [-3, 3]`)
  }
  return pair(name, domain)
}

/** @param {string} name @param {any} r @returns {[number, number]} */
function paramRange(name, r) {
  if (r === undefined) fail('chart()', `the function needs the range of ${name} to sample - e.g. ${name}: [0, 2 * Math.PI]`)
  return pair(name, r)
}

/** @param {string} name @param {any} r @returns {[number, number]} */
function pair(name, r) {
  if (!Array.isArray(r) || r.length !== 2 || !r.every((n) => typeof n === 'number' && Number.isFinite(n)) || r[0] === r[1]) {
    fail('chart()', `${name}'s range is two different numbers, such as [-3, 3], got ${describe(r)}`)
  }
  return /** @type {[number, number]} */ (r)
}

/** Ranges aren't given for axes the function's values make. @param {Record<string, any>} spec @param {string} what */
function noAxisRanges(spec, what) {
  for (const name of ['x', 'y', 'z']) {
    const c = spec[name]
    if (Array.isArray(c) || (c && typeof c === 'object' && c.domain !== undefined)) {
      fail('chart()', `${what}'s ${name} comes from its function - give its title or axis, not a range (set the parameters' ranges instead)`)
    }
    if (typeof c === 'string') fail('chart()', `${what}'s ${name} comes from its function, not a field - leave it out, or give { title, axis }`)
  }
}

/**
 * Samples along each dimension: a number for all, or one each.
 * @param {any} samples @param {number} dims @param {number} fallback @param {boolean} [plane] a vector field's x and z only
 * @param {number[]} [least] the fewest for each (default 2)
 * @returns {number[]}
 */
function counts(samples, dims, fallback, plane = false, least = Array(dims).fill(2)) {
  const list = samples === undefined ? Array(dims).fill(fallback) : typeof samples === 'number' ? Array(dims).fill(samples) : samples
  if (!Array.isArray(list) || list.length !== dims || !list.every((n, i) => Number.isInteger(n) && n >= least[i])) {
    const example = dims === 1 ? '400' : `64, or [${Array(dims).fill(32).join(', ')}]`
    fail('chart()', `'samples' is how many points to sample${dims > 1 ? `, for all or for each of ${plane ? 'x and z' : dims === 2 ? 'the two ranges' : 'x, y and z'}` : ''} - whole numbers of 2 or more, such as ${example} - got ${describe(samples)}`)
  }
  if (list.reduce((a, b) => a * b, 1) > MAX_SAMPLES) fail('chart()', `'samples' of ${list.join(' × ')} is more than ${MAX_SAMPLES.toLocaleString('en')} points - fewer will look the same`)
  return list
}

/** The i-th of n evenly spaced values over a range, ends included - or its start, for one. @param {[number, number]} r @param {number} i @param {number} n */
const along = (r, i, n) => (n === 1 ? r[0] : r[0] + (r[1] - r[0]) * (i / (n - 1)))

const round = (/** @type {number} */ v) => +v.toFixed(3)

/** @param {any} v @param {string} where */
function number(v, where) {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    fail('chart()', `fn gave ${describe(v)} at ${where} - a surface's fn returns a finite number at every point (clamp it where it blows up)`)
  }
  return v
}

/** A point - [x, y, z] or { x, y, z } - from fn. @param {any} v @param {string} where @param {string} [what] */
function point(v, where, what = 'a point') {
  const p = Array.isArray(v) ? { x: v[0], y: v[1], z: v[2] } : v && typeof v === 'object' ? { x: v.x, y: v.y, z: v.z } : null
  if (!p || (Array.isArray(v) && v.length !== 3) || ![p.x, p.y, p.z].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    fail('chart()', `fn gave ${describe(v)} at ${where} - it returns ${what}, [x, y, z] of finite numbers`)
  }
  return /** @type {{ x: number, y: number, z: number }} */ (p)
}

/** A channel option given as an object (title, axis, format...), or none. @param {any} c @param {string} name */
function object(c, name) {
  if (c === undefined || c === null) return {}
  if (typeof c !== 'object' || Array.isArray(c)) fail('chart()', `${name} on a chart of a function is its range, or { title, axis, format, ... } - got ${describe(c)}`)
  return c
}

/** An axis channel over the range sampled: the axis spans exactly that range. */
function channel(/** @type {Record<string, any>} */ spec, /** @type {string} */ name, /** @type {[number, number]} */ range) {
  const c = Array.isArray(spec[name]) ? {} : object(spec[name], name)
  // the range is sampled; the rest is the channel as given
  const rest = { ...c }
  delete rest.domain
  return { ...rest, field: name, scale: { nice: false, ...(rest.scale ?? {}), domain: [...range] } }
}

/**
 * The function's value as a channel: its title, axis and format as given - and a range, y: [-1, 1],
 * pins the axis there, so a change of params shows as the surface rising or falling, rather than
 * the axis refitting to it.
 */
function valueChannel(/** @type {Record<string, any>} */ spec, /** @type {string} */ name) {
  const c = spec[name]
  if (typeof c === 'string') fail('chart()', `${name} on a chart of a function is its value - leave it out, give a range to show such as ${name}: [-1, 1], or { title, axis, format }`)
  const range = axisRange(spec, /** @type {'y'} */ (name), false)
  return range ? channel(spec, name, range) : { ...object(c, name), field: name }
}

/** x, y and z made by the function, with what was given for each (title, axis, format). @param {Record<string, any>} spec */
function pointChannels(spec) {
  return Object.fromEntries(['x', 'y', 'z'].map((name) => [name, { ...object(spec[name], name), field: name }]))
}
