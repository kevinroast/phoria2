// Charts of functions: a spec with `fn` and the ranges to sample it over, instead of data. The
// function is sampled into rows here, and from there the chart is drawn as any other - axes,
// colour scales, tooltips and the tweens between one function (or one set of params) and the next.
//
//     chart({ mark: 'surface', fn: (x, z) => Math.sin(x) * Math.cos(z), x: [-3, 3], z: [-3, 3] })
//     chart({ mark: 'surface', fn: (u, v) => [x, y, z], u: [0, 2 * Math.PI], v: [0, Math.PI] })
//     chart({ mark: 'curve', fn: (t) => [Math.cos(t), t / 4, Math.sin(t)], t: [0, 12 * Math.PI] })
//     chart({ mark: 'vector', fn: (x, y, z) => [-z, 0, x], x: [-2, 2], z: [-2, 2] })
//     chart({ mark: 'area', fn: (x) => Math.sin(x), x: [0, Math.PI] })      // or [y, y2]: between two curves
//     chart({ mark: 'bar', fn: (x) => x * x, x: [0, 2], samples: 8 })       // a Riemann sum
//
// and in curved coordinates, where fn gives a radius (or a height) over angles:
//
//     chart({ mark: 'surface', coords: 'spherical', fn: (theta, phi) => 1 + 0.3 * Math.cos(3 * theta) })
//     chart({ mark: 'surface', coords: 'cylindrical', fn: (theta, y) => 1 + y * y / 4, y: [-2, 2] })
//     chart({ mark: 'surface', coords: 'polar', fn: (r, theta) => Math.cos(r * 3), r: [0, 3] })
//     chart({ mark: 'curve', coords: 'polar', fn: (theta) => Math.cos(3 * theta) })
//
// or from data measured by angle - each row a direction and its value (placeData):
//
//     chart({ mark: 'surface', coords: 'spherical', data, theta: 'azimuth', phi: 'polar', r: 'gain', angles: 'degrees' })
import { describe, fail } from '../validate.js'

// the options a chart of a function adds: its function, how finely to sample it, its parameters,
// and the ranges of the parameters that aren't axes
export const FUNCTION_OPTIONS = ['fn', 'samples', 'params', 't', 'u', 'v', 'coords', 'theta', 'phi', 'r', 'angles', 'rule']
// those a chart of data takes too, in curved coordinates - theta, phi and r name its fields
export const CURVED_OPTIONS = ['coords', 'theta', 'phi', 'r', 'angles']

const COORDS = ['cartesian', 'polar', 'cylindrical', 'spherical']
/** A full turn, and a half, in radians or degrees. @param {boolean} deg */
const turn = (deg) => (deg ? 360 : 2 * Math.PI)

/**
 * Curved coordinates for a surface: the two ranges sampled - the grid's along and across - the name
 * of fn's value, and the point they make, in the chart's own units - x right, y up and z away from
 * the front (its scale runs that way): theta turns anticlockwise seen from above, from +x towards +z,
 * and phi runs down from +y (0) to -y (π).
 * @type {Record<string, { along: string, across: string, value: string, about: string, point: (a: number, b: number, v: number) => [number, number, number] }>}
 */
const CURVED = {
  spherical: {
    along: 'theta', across: 'phi', value: 'r', about: 'r = fn(theta, phi), in spherical coordinates',
    point: (theta, phi, r) => [r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)],
  },
  cylindrical: {
    along: 'theta', across: 'y', value: 'r', about: 'r = fn(theta, y), in cylindrical coordinates',
    point: (theta, y, r) => [r * Math.cos(theta), y, r * Math.sin(theta)],
  },
  polar: {
    along: 'r', across: 'theta', value: 'y', about: 'y = fn(r, theta), in polar coordinates',
    point: (r, theta, y) => [r * Math.cos(theta), y, r * Math.sin(theta)],
  },
}

// enough for smooth plots at a steady frame rate - the normals come from fn, so shading stays smooth at these
const DEFAULT_SAMPLES = { surface: 48, parametric: 64, curve: 256, vector: 9, graph: 200, bar: 10 }
// where a Riemann sum's rectangle takes its height: its left end, its middle or its right end
const RULES = { left: 0, mid: 0.5, right: 1 }

const MAX_SAMPLES = 250_000

/**
 * What sampling gave: the spec with rows in place of fn, the grid a parametric surface is laid out
 * on, a line about it for summaries, and whether its axes default to equal units.
 * @typedef {object} Sampled
 * @property {Record<string, any>} input
 * @property {{ nx: number, nz: number } | null} grid rows in grid order, z (or v) across and x (or u) along
 * @property {Float32Array | null} normals a surface's normals, three numbers a row in the rows' order
 *   and in data units, from fn by central differences - so shading follows the function rather than
 *   the triangles between samples. Each faces the way the grid's triangles do: across x along, in
 *   the order the grid is laid out. Beside the rows, not on them: rows are the data a hit gives back
 * @property {string | null} coords the curved coordinates it was drawn in, or null
 * @property {Rings | null} [rings] how the rings round the origin are labelled, in curved coordinates
 * @property {string} about
 * @property {boolean} equal
 */

/**
 * The rings round the origin: whether they're labelled - with their radii, and the angles round the
 * outermost - the value at the centre (a dB floor), and how far out they go, if pinned.
 * @typedef {object} Rings
 * @property {boolean} labelled
 * @property {number} offset
 * @property {number | null} reach
 * @property {number} zero where theta 0 points, in radians from +x
 * @property {number} sign 1 for angles turning anticlockwise, -1 clockwise
 */

/**
 * How angles are given: in degrees or radians, where theta 0 points, and which way theta turns.
 * @typedef {{ deg: boolean, zero: number, sign: number }} Angles
 */

/**
 * A spec with `fn`, as a spec with rows.
 * @param {Record<string, any>} input
 * @returns {Sampled}
 */
export function sampleFunction(input) {
  const { fn, samples, params, t, u, v, coords, theta, phi, r, angles: units, rule, ...rest } = input
  const mark = typeof input.mark === 'object' && input.mark ? input.mark.type : input.mark
  if (typeof fn !== 'function') {
    fail('chart()', `'fn' is a function to plot, such as (x, z) => Math.sin(x) * Math.cos(z), got ${describe(fn)}`)
  }
  if (input.data !== undefined) fail('chart()', "a chart of a function has no 'data' - its rows are sampled from fn; leave data out")
  if (params !== undefined && (!params || typeof params !== 'object' || Array.isArray(params))) {
    fail('chart()', `'params' is an object of values handed to fn as its last argument, such as { a: 2 }, got ${describe(params)}`)
  }
  const p = params ?? {}
  // fn called directly, with its params last - nothing made for a call, as a surface takes
  // thousands of them a frame when it moves with time
  const call1 = (/** @type {number} */ a) => fn(a, p)
  const call2 = (/** @type {number} */ a, /** @type {number} */ b) => fn(a, b, p)
  const call3 = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ c) => fn(a, b, c, p)
  if (coords !== undefined && !COORDS.includes(coords)) {
    fail('chart()', `'coords' is 'cartesian' (the default), 'polar', 'cylindrical' or 'spherical', got ${describe(coords)}`)
  }
  const curved = coords !== undefined && coords !== 'cartesian' ? coords : null
  const angles = { theta, phi, r }
  const turns = anglesOf(units)
  if (!curved) {
    for (const [name, value] of Object.entries({ ...angles, angles: units })) {
      if (value !== undefined) fail('chart()', `'${name}' is for curved coordinates - add coords: 'polar', 'cylindrical' or 'spherical'`)
    }
  } else {
    const over = mark === 'curve' ? 'theta' : CURVED[curved] ? `${CURVED[curved].along} and ${CURVED[curved].across}` : ''
    const other = ['t', 'u', 'v'].filter((k) => input[k] !== undefined)
    if (other.length) fail('chart()', `in coords: '${curved}' fn is sampled over ${over}, not ${other.join(' or ')}`)
    if (mark === 'curve') {
      if (curved !== 'polar') fail('chart()', `a curve takes coords: 'polar' - r = fn(theta) - not '${curved}'; for a path in space, fn: (t) => [x, y, z]`)
      if (phi !== undefined || r !== undefined) fail('chart()', `a polar curve is sampled over theta - leave out ${phi !== undefined ? 'phi' : 'r'}`)
      return polarCurve(rest, call1, samples, theta, turns)
    }
    if (mark !== 'surface') fail('chart()', `'coords' is for a surface or a curve, not mark: ${describe(mark)}`)
    const c = CURVED[curved]
    for (const [name, value] of Object.entries(angles)) {
      if (value !== undefined && name !== c.along && name !== c.across) fail('chart()', `coords: '${curved}' is sampled over ${c.along} and ${c.across} - leave out ${name}`)
    }
    return curvedSurface(rest, call2, samples, curved, angles, turns)
  }
  if (mark === 'surface') {
    if (u !== undefined || v !== undefined) return parametric(rest, call2, samples, u, v)
    if (t !== undefined) fail('chart()', "'t' is a curve's range - a surface is over x and z, or over u and v")
    return heights(rest, call2, samples)
  }
  if (mark === 'curve') {
    if (u !== undefined || v !== undefined) fail('chart()', "'u' and 'v' are a parametric surface's ranges - a curve is over t")
    return curve(rest, call1, samples, t)
  }
  if (rule !== undefined && mark !== 'bar') fail('chart()', "'rule' is where a bar from fn takes its height - for mark: 'bar'")
  if (mark === 'line' || mark === 'area' || mark === 'bar') {
    const other = ['t', 'u', 'v'].filter((k) => input[k] !== undefined)
    if (other.length) fail('chart()', `a '${mark}' from fn is over x - y = fn(x), x: [0, 4] - not ${other.join(' or ')}`)
    return mark === 'bar' ? riemann(rest, call1, samples, rule) : graph(rest, call1, samples, mark)
  }
  if (mark === 'vector') return field(rest, call3, samples)
  return fail('chart()', `'fn' is plotted as mark: 'surface', 'curve', 'vector', 'line', 'area' or 'bar', not ${describe(mark)}`)
}

// y = fn(x, z): a height over the x-z grid
/** @param {Record<string, any>} spec @param {(a: number, b: number) => any} call @param {any} samples @returns {Sampled} */
function heights(spec, call, samples) {
  const x = axisRange(spec, 'x', true), z = axisRange(spec, 'z', true)
  const [nx, nz] = counts(samples, 2, DEFAULT_SAMPLES.surface)
  // sampled low to high whichever way the ranges are given, so the rows are in grid order - z
  // across, x along - and the surface mark takes them as they come
  const xr = /** @type {[number, number]} */ ([Math.min(...x), Math.max(...x)]), zr = /** @type {[number, number]} */ ([Math.min(...z), Math.max(...z)])
  const rows = new Array(nx * nz), normals = new Float32Array(nx * nz * 3)
  // a small step for the slopes, well under a sample's spacing
  const hx = (xr[1] - xr[0]) * 1e-4, hz = (zr[1] - zr[0]) * 1e-4
  const slope = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ h) => {
    const d = (a - b) / (2 * h)
    return Number.isFinite(d) ? d : 0
  }
  let k = 0
  for (let j = 0; j < nz; j++) {
    const zv = along(zr, j, nz)
    for (let i = 0; i < nx; i++) {
      const xv = along(xr, i, nx), yv = call(xv, zv)
      // checked as it comes; the message made only when it is needed
      if (typeof yv !== 'number' || !Number.isFinite(yv)) number(yv, `x ${round(xv)}, z ${round(zv)}`)
      // across the tangents along z and along x: (0, dy/dz, 1) x (1, dy/dx, 0)
      normals[k * 3] = -slope(call(xv + hx, zv), call(xv - hx, zv), hx)
      normals[k * 3 + 1] = 1
      normals[k * 3 + 2] = -slope(call(xv, zv + hz), call(xv, zv - hz), hz)
      rows[k++] = { x: xv, z: zv, y: yv }
    }
  }
  return {
    input: { ...spec, data: rows, x: channel(spec, 'x', x), z: channel(spec, 'z', z), y: valueChannel(spec, 'y') },
    grid: { nx, nz }, normals, coords: null, about: `a function of x and z, ${nx} × ${nz} samples`, equal: false,
  }
}

// [x, y, z] = fn(u, v): a surface that can fold back on itself - a sphere, a torus
/** @param {Record<string, any>} spec @param {(a: number, b: number) => any} call @param {any} samples @param {any} u @param {any} v @returns {Sampled} */
function parametric(spec, call, samples, u, v) {
  const ur = paramRange('u', u), vr = paramRange('v', v)
  noAxisRanges(spec, 'a parametric surface')
  const [nu, nv] = counts(samples, 2, DEFAULT_SAMPLES.parametric)
  const rows = [], normals = new Float32Array(nu * nv * 3)
  // where fn puts (u, v), for the normals - nothing said if it's wrong there, just off the grid
  const at = (/** @type {number} */ a, /** @type {number} */ b) => {
    const p = call(a, b)
    return Array.isArray(p) ? p : p && typeof p === 'object' ? [p.x, p.y, p.z] : [NaN, NaN, NaN]
  }
  for (let j = 0; j < nv; j++) {
    const vv = along(vr, j, nv)
    for (let i = 0; i < nu; i++) {
      const uv = along(ur, i, nu)
      const p = point(call(uv, vv), () => `u ${round(uv)}, v ${round(vv)}`)
      surfaceNormal(normals, rows.length, at, uv, vv, ur, vr, nu, nv, [p.x, p.y, p.z])
      rows.push({ u: uv, v: vv, ...p })
    }
  }
  return { input: { ...spec, data: rows, ...pointChannels(spec) }, grid: { nx: nu, nz: nv }, normals, coords: null, about: `a parametric surface, ${nu} × ${nv} samples`, equal: true }
}

// [x, y, z] = fn(t): a path through space, in order of t
/** @param {Record<string, any>} spec @param {(a: number) => any} call @param {any} samples @param {any} t @returns {Sampled} */
function curve(spec, call, samples, t) {
  const tr = paramRange('t', t)
  noAxisRanges(spec, 'a curve')
  const [n] = counts(samples, 1, DEFAULT_SAMPLES.curve)
  const rows = []
  for (let i = 0; i < n; i++) {
    const tv = along(tr, i, n)
    rows.push({ t: tv, ...point(call(tv), () => `t ${round(tv)}`) })
  }
  return { input: { ...spec, data: rows, ...pointChannels(spec) }, grid: null, normals: null, coords: null, about: `a parametric curve, ${n} samples`, equal: true }
}

// y = fn(x): a graph over an x range - a line, or an area down to zero; fn may give [y, y2], and an
// area fills between them
/** @param {Record<string, any>} spec @param {(a: number) => any} call @param {any} samples @param {string} mark @returns {Sampled} */
function graph(spec, call, samples, mark) {
  const xr = /** @type {[number, number]} */ (axisRange(spec, 'x', true))
  if (typeof spec.y2 === 'string') fail('chart()', "y2 on a chart of a function is its second value - return [y, y2] from fn, and leave y2 out (or give { title, axis })")
  const [n] = counts(samples, 1, DEFAULT_SAMPLES.graph)
  const rows = new Array(n)
  let ranged = false
  for (let i = 0; i < n; i++) {
    const xv = along(xr, i, n), v = call(xv)
    if (Array.isArray(v)) {
      if (mark !== 'area') fail('chart()', `fn gave ${describe(v)} at x ${round(xv)} - a line has one value; [y, y2] fills between them with mark: 'area'`)
      if (v.length !== 2 || !finite(v[0]) || !finite(v[1])) fail('chart()', `fn gave ${describe(v)} at x ${round(xv)} - an area's fn returns y, or [y, y2] to fill between them, finite numbers`)
      if (i > 0 && !ranged) fail('chart()', `fn gave [y, y2] at x ${round(xv)} but a single y before - give the same at every x`)
      ranged = true
      rows[i] = { x: xv, y: v[0], y2: v[1] }
    } else {
      if (ranged) fail('chart()', `fn gave ${describe(v)} at x ${round(xv)} but [y, y2] before - give the same at every x`)
      if (typeof v !== 'number' || !Number.isFinite(v)) fail('chart()', `fn gave ${describe(v)} at x ${round(xv)} - y = fn(x) is a finite number at every x (clamp it where it blows up)`)
      rows[i] = { x: xv, y: v }
    }
  }
  return {
    input: {
      ...spec, data: rows, x: channel(spec, 'x', xr), y: valueChannel(spec, 'y'),
      ...(ranged ? { y2: { ...object(spec.y2, 'y2'), field: 'y2' } } : {}),
    },
    grid: null, normals: null, coords: null, about: `y = fn(x)${ranged ? ' and a second edge' : ''}, ${n} samples`, equal: false,
  }
}

// rectangles under y = fn(x): the range cut into equal widths, each as high as fn at its left end,
// middle or right end - a Riemann sum
/** @param {Record<string, any>} spec @param {(a: number) => any} call @param {any} samples @param {any} rule @returns {Sampled} */
function riemann(spec, call, samples, rule) {
  const xr = /** @type {[number, number]} */ (axisRange(spec, 'x', true))
  if (rule !== undefined && !(rule in RULES)) fail('chart()', `'rule' is 'left', 'mid' (the default) or 'right' - where each rectangle takes its height - got ${describe(rule)}`)
  if (spec.x2 !== undefined) fail('chart()', 'a bar from fn spans its share of the x range - leave x2 out')
  const k = RULES[rule ?? 'mid']
  const [n] = counts(samples, 1, DEFAULT_SAMPLES.bar, false, [1])
  const lo = Math.min(...xr), hi = Math.max(...xr), width = (hi - lo) / n
  const rows = []
  for (let i = 0; i < n; i++) {
    const from = lo + i * width, to = from + width, at = from + width * k, v = call(at)
    if (typeof v !== 'number' || !Number.isFinite(v)) fail('chart()', `fn gave ${describe(v)} at x ${round(at)} - y = fn(x) is a finite number at every x`)
    rows.push({ x: from, x2: to, at, y: v })
  }
  return {
    input: { ...spec, data: rows, x: channel(spec, 'x', xr), x2: { field: 'x2' }, y: valueChannel(spec, 'y') },
    grid: null, normals: null, coords: null, about: `a Riemann sum of fn, ${n} rectangles, each at its ${rule === 'left' ? 'left end' : rule === 'right' ? 'right end' : 'middle'}`, equal: false,
  }
}

// r = fn(theta): a curve around the origin, upright in the x-y plane - facing you, as a chart's page does
/** @param {Record<string, any>} spec @param {(a: number) => any} call @param {any} samples @param {any} theta @param {Angles} turns @returns {Sampled} */
function polarCurve(spec, call, samples, theta, turns) {
  const tr = theta === undefined ? /** @type {[number, number]} */ ([0, turn(turns.deg)]) : pair('theta', theta)
  noAxisRanges(spec, 'a polar curve')
  const [n] = counts(samples, 1, DEFAULT_SAMPLES.curve)
  const rows = []
  for (let i = 0; i < n; i++) {
    const th = along(tr, i, n), r = call(th)
    if (typeof r !== 'number' || !Number.isFinite(r)) fail('chart()', `fn gave ${describe(r)} at theta ${round(th)} - a polar curve's fn returns its radius, a finite number (a negative one is drawn through the origin, opposite)`)
    const a = radians('theta', th, turns)
    rows.push({ theta: th, r, x: r * Math.cos(a), y: r * Math.sin(a), z: 0 })
  }
  // flat, and read off its labelled rings: no axes unless asked for
  const channels = hideAxes(pointChannels(spec), spec, ['x', 'y', 'z'])
  return {
    input: { ...spec, data: rows, ...channels, tooltip: spec.tooltip ?? ['theta', 'r'] }, grid: null, normals: null, coords: 'polar',
    rings: { labelled: true, offset: 0, reach: null, zero: turns.zero, sign: turns.sign }, about: `r = fn(theta), a polar curve, ${n} samples`, equal: true,
  }
}

// a radius (or a height) over two of theta, phi, y and r: see CURVED
/**
 * @param {Record<string, any>} spec @param {(a: number, b: number) => any} call @param {any} samples
 * @param {string} coords @param {Record<string, any>} given the ranges given, of theta, phi and r
 * @param {Angles} turns how the angles are given
 * @returns {Sampled}
 */
function curvedSurface(spec, call, samples, coords, given, turns) {
  const c = CURVED[coords]
  // fn is handed angles as they're given; the points are made in radians, from +x anticlockwise
  const place = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ v) => c.point(radians(c.along, a, turns), radians(c.across, b, turns), v)
  // angles go all the way round (and phi top to bottom) unless told otherwise; r and y need a range
  const range = (/** @type {string} */ name) => {
    if (name === 'y') return /** @type {[number, number]} */ (axisRange(spec, 'y', true))
    const r = given[name]
    if (r !== undefined) return pair(name, r)
    if (name === 'theta') return /** @type {[number, number]} */ ([0, turn(turns.deg)])
    if (name === 'phi') return /** @type {[number, number]} */ ([0, turn(turns.deg) / 2])
    return fail('chart()', `coords: '${coords}' needs the range of ${name} to sample - e.g. ${name}: [0, 3]`)
  }
  const ar = range(c.along), br = range(c.across)
  noAxisRanges(spec, `a surface in ${coords} coordinates`)
  const [na, nb] = counts(samples, 2, DEFAULT_SAMPLES.parametric)
  const rows = new Array(na * nb), normals = new Float32Array(na * nb * 3)
  // fn's value: a number, or { [value]: number, ...fields } - the fields kept on the row, to colour by
  const valueOf = (/** @type {any} */ v, /** @type {() => string} */ where) => {
    if (typeof v === 'number' && Number.isFinite(v)) return v
    const n = v && typeof v === 'object' && !Array.isArray(v) ? v[c.value] : v
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      fail('chart()', `fn gave ${describe(v)} at ${where()} - in coords: '${coords}' it returns ${c.value}, a finite number, or { ${c.value}, ...fields to colour by }`)
    }
    return n
  }
  // where (a, b) lands, for the normals - a value that isn't a number just leaves that normal out
  const at = (/** @type {number} */ a, /** @type {number} */ b) => {
    const v = call(a, b)
    return place(a, b, typeof v === 'number' ? v : v && typeof v === 'object' ? v[c.value] : NaN)
  }
  const reserved = [c.along, c.across, c.value, 'x', 'y', 'z']
  let k = 0
  for (let j = 0; j < nb; j++) {
    const b = along(br, j, nb)
    for (let i = 0; i < na; i++) {
      const a = along(ar, i, na), got = call(a, b)
      const v = valueOf(got, () => `${c.along} ${round(a)}, ${c.across} ${round(b)}`)
      const p = place(a, b, v)
      surfaceNormal(normals, k, at, a, b, ar, br, na, nb, p)
      /** @type {Record<string, any>} */
      const row = { [c.along]: a, [c.across]: b, [c.value]: v, x: p[0], y: p[1], z: p[2] }
      if (typeof got === 'object') {
        for (const key of Object.keys(got)) {
          if (key === c.value) continue
          if (reserved.includes(key)) fail('chart()', `fn's ${key} is the row's own in coords: '${coords}' - give the field to colour by another name`)
          row[key] = got[key]
        }
      }
      rows[k++] = row
    }
  }
  // coloured by the radius, out from the middle - or by the height, as any surface; a polar surface
  // is read off its labelled rings on the floor, and its height axis
  const channels = coords === 'polar' ? hideAxes(pointChannels(spec), spec, ['x', 'z']) : pointChannels(spec)
  return {
    input: {
      ...spec, data: rows, ...channels, ...(c.value === 'r' && spec.color === undefined ? { color: 'r' } : {}),
      tooltip: spec.tooltip ?? [c.along, c.across, c.value],
    },
    grid: { nx: na, nz: nb }, normals, coords, rings: { labelled: coords === 'polar', offset: 0, reach: null, zero: turns.zero, sign: turns.sign },
    about: `${c.about}, ${na} × ${nb} samples`, equal: true,
  }
}

// ---- data in curved coordinates ------------------------------------------------------------

/**
 * Rows measured by angle, placed as a chart in curved coordinates draws them: theta, phi, r (and y,
 * for a cylinder's height or a polar surface's) name the fields. A surface's rows are a full grid
 * of its two directions - a turn short of all the way round is closed - and a polar curve's are a
 * path round the origin, one per series (detail, or a colour field), each closed if it goes round.
 * r: { field, scale: { domain: [lo, hi] } } puts lo at the centre and hi on the outer ring - a dB
 * floor - with what's beyond clamped there.
 * @param {Record<string, any>} input
 * @returns {Sampled}
 */
export function placeData(input) {
  const { coords, theta, phi, r, angles: units, data, ...rest } = input
  const mark = typeof input.mark === 'object' && input.mark ? input.mark.type : input.mark
  if (!COORDS.includes(coords) || coords === 'cartesian') fail('chart()', `'coords' is 'cartesian' (the default), 'polar', 'cylindrical' or 'spherical', got ${describe(coords)}`)
  if (!Array.isArray(data)) fail('chart()', `in coords: '${coords}' data is an array of rows, one for each direction measured, got ${describe(data)}`)
  const turns = anglesOf(units)
  /** @type {Record<string, any>} */
  const given = { theta, phi, r, y: rest.y }
  // the fields this kind of chart reads, in order: along and across a surface's grid, then its value
  const names = mark === 'curve' ? ['theta', 'r'] : CURVED[coords] ? [CURVED[coords].along, CURVED[coords].across, CURVED[coords].value] : []
  if (mark === 'curve' && coords !== 'polar') fail('chart()', `a curve takes coords: 'polar' - theta and r fields - not '${coords}'`)
  if (mark !== 'curve' && mark !== 'surface') fail('chart()', `'coords' is for a surface or a curve, not mark: ${describe(mark)}`)
  for (const name of ['theta', 'phi', 'r']) {
    if (given[name] !== undefined && !names.includes(name)) fail('chart()', `${mark === 'curve' ? 'a polar curve' : `coords: '${coords}'`} reads ${names.join(', ')} - leave out ${name}`)
  }
  const fields = Object.fromEntries(names.map((name) => [name, fieldOf(name, given[name], coords)]))
  for (const name of ['x', 'z', ...(names.includes('y') ? [] : ['y'])]) {
    if (typeof rest[name] === 'string') fail('chart()', `in coords: '${coords}' ${name} comes from the angles - leave it out, or give a range to show such as ${name}: [-2, 2]`)
  }
  const rField = fields.r, domain = rField?.domain ?? null
  // a value at a row - a finite number, or an error naming the row
  const read = (/** @type {any} */ row, /** @type {number} */ i, /** @type {string} */ name) => {
    const v = row?.[fields[name].field]
    if (typeof v !== 'number' || !Number.isFinite(v)) fail('chart()', `row ${i}'s ${fields[name].field} is ${describe(v)} - ${name} is a number in every row`)
    if (row.x !== undefined || (row.y !== undefined && fields.y?.field !== 'y') || row.z !== undefined) {
      fail('chart()', `row ${i} has its own x, y or z - in coords: '${coords}' they're made from the angles; rename those fields`)
    }
    return v
  }
  // the radius drawn: as given, or out from the floor of r's domain, within it
  const radius = (/** @type {number} */ v) => (domain ? Math.min(Math.max(v, domain[0]), domain[1]) - domain[0] : v)
  const rings = { labelled: true, offset: domain ? domain[0] : 0, reach: domain ? domain[1] - domain[0] : null, zero: turns.zero, sign: turns.sign }
  const full = turn(turns.deg)
  const tooltip = rest.tooltip ?? names.map((n) => fields[n].field)

  if (mark === 'curve') {
    // one path per series - detail, or a colour field - each in order of theta, closed if it goes round
    // (a colour field of names, that is - a colour by number runs along a path)
    const colorField = typeof rest.color === 'string' ? rest.color : rest.color?.field
    const named = colorField && typeof data[0]?.[colorField] === 'string' ? colorField : undefined
    const by = typeof rest.detail === 'string' ? rest.detail : rest.detail?.field ?? named
    const series = new Map()
    data.forEach((row, i) => {
      const key = by ? String(row?.[by]) : ''
      if (!series.has(key)) series.set(key, [])
      series.get(key).push({ row, th: read(row, i, 'theta'), rv: read(row, i, 'r') })
    })
    const rows = []
    for (const path of series.values()) {
      path.sort((a, b) => a.th - b.th)
      if (closes(path.map((p) => p.th), full)) path.push(path[0])
      for (const { row, th, rv } of path) {
        const rr = radius(rv), a = radians('theta', th, turns)
        rows.push({ ...row, x: rr * Math.cos(a), y: rr * Math.sin(a), z: 0 })
      }
    }
    const channels = hideAxes(placedChannels(rest, []), rest, ['x', 'y', 'z'])
    return {
      input: { ...rest, data: rows, ...channels, tooltip: rest.tooltip ?? (by ? [by, ...tooltip] : tooltip), ...(by && rest.detail === undefined ? { detail: by } : {}) },
      grid: null, normals: null, coords, rings, about: `${fields.r.field} by ${fields.theta.field}, a polar plot of ${data.length} rows`, equal: true,
    }
  }

  // a surface: a full grid of its two directions
  const c = CURVED[coords]
  const alongs = distinctNumbers(data.map((row, i) => read(row, i, c.along)))
  const acrosses = distinctNumbers(data.map((row, i) => read(row, i, c.across)))
  const grid = new Map(data.map((row) => [`${row[fields[c.along].field]}|${row[fields[c.across].field]}`, row]))
  const missing = alongs.length * acrosses.length - grid.size
  if (missing > 0) {
    const gap = alongs.flatMap((a) => acrosses.map((b) => [a, b])).find(([a, b]) => !grid.has(`${a}|${b}`)) ?? []
    fail('chart()', `a surface needs a row for every ${fields[c.along].field} and ${fields[c.across].field} pair - ${missing} of ${alongs.length * acrosses.length} are missing (first: ${fields[c.along].field} ${gap[0]}, ${fields[c.across].field} ${gap[1]})`)
  }
  // theta a step short of all the way round: the first column again, at the end, to close it
  const wrapA = c.along === 'theta' && closes(alongs, full), wrapB = c.across === 'theta' && closes(acrosses, full)
  const cols = wrapA ? [...alongs, alongs[0]] : alongs, lines = wrapB ? [...acrosses, acrosses[0]] : acrosses
  const placed = new Map()
  const rowAt = (/** @type {number} */ a, /** @type {number} */ b) => {
    const key = `${a}|${b}`
    if (!placed.has(key)) {
      const row = grid.get(key), v = row[fields[c.value].field]
      if (typeof v !== 'number' || !Number.isFinite(v)) fail('chart()', `the row at ${fields[c.along].field} ${a}, ${fields[c.across].field} ${b} has ${fields[c.value].field} ${describe(v)} - a number in every row`)
      // a radius out from the floor, or a height as given; the angles turned to radians
      const ra = c.along === 'r' ? radius(a) : a, rv = c.value === 'r' ? radius(v) : v
      const p = c.point(radians(c.along, ra, turns), radians(c.across, b, turns), rv)
      placed.set(key, { ...row, x: p[0], y: p[1], z: p[2] })
    }
    return placed.get(key)
  }
  const rows = []
  for (const b of lines) for (const a of cols) rows.push(rowAt(a, b))
  const heightField = c.value === 'y' ? fields.y : c.across === 'y' ? fields.y : null
  const channels = hideAxes(placedChannels(rest, heightField ? ['y'] : []), rest, heightField ? ['x', 'z'] : ['x', 'y', 'z'])
  // the height axis is the y field's, titled with its name - a placed row's y is its height
  if (heightField) {
    const options = { ...(typeof rest.y === 'object' && rest.y ? rest.y : {}) }
    delete options.field
    channels.y = { ...options, field: 'y', title: options.title ?? heightField.field }
  }
  return {
    input: {
      ...rest, data: rows, ...channels, tooltip,
      ...(c.value === 'r' && rest.color === undefined ? { color: fields.r.field } : {}),
    },
    grid: { nx: cols.length, nz: lines.length }, normals: null, coords, rings,
    about: `${fields[c.value].field} by ${fields[c.along].field} and ${fields[c.across].field}, in ${coords} coordinates, ${cols.length} × ${lines.length} rows`, equal: true,
  }
}

/**
 * One of theta, phi, r or y as a field of the data: 'name', or { field, title, scale: { domain } }.
 * @param {string} name @param {any} spec @param {string} coords
 * @returns {{ field: string, domain: [number, number] | null }}
 */
function fieldOf(name, spec, coords) {
  if (spec === undefined) fail('chart()', `in coords: '${coords}' with data, ${name} names a field of the rows - e.g. ${name}: '${name === 'r' ? 'gain' : name === 'y' ? 'height' : name === 'phi' ? 'polar' : 'azimuth'}'`)
  if (Array.isArray(spec)) fail('chart()', `with data, ${name} names a field of the rows, such as ${name}: '${name === 'r' ? 'gain' : 'azimuth'}' - ranges are for fn`)
  const field = typeof spec === 'string' ? spec : spec && typeof spec === 'object' ? spec.field : undefined
  if (typeof field !== 'string') fail('chart()', `${name} is a field of the rows, 'name' or { field, scale }, got ${describe(spec)}`)
  const d = typeof spec === 'object' ? spec.scale?.domain ?? spec.domain : undefined
  return { field, domain: d === undefined ? null : pair(`${name}'s domain`, d) }
}

/** The values, each once, low to high. @param {number[]} values */
const distinctNumbers = (values) => [...new Set(values)].sort((a, b) => a - b)

/** Do evenly spaced angles stop a step short of all the way round, so the last joins the first? @param {number[]} values @param {number} full */
function closes(values, full) {
  if (values.length < 3) return false
  const sorted = [...values].sort((a, b) => a - b), step = sorted[1] - sorted[0]
  return step > 0 && Math.abs(sorted[sorted.length - 1] + step - (sorted[0] + full)) < step * 0.01
}

/** x, y and z of the placed rows, with what was given for each - a range pins that axis. @param {Record<string, any>} spec @param {string[]} skip */
function placedChannels(spec, skip) {
  return Object.fromEntries(['x', 'y', 'z'].filter((n) => !skip.includes(n)).map((name) => {
    const range = axisRange(spec, /** @type {'x' | 'y' | 'z'} */ (name), false)
    return [name, range ? channel(spec, name, range) : { ...object(spec[name], name), field: name }]
  }))
}

/**
 * Axes left out where the rings say it instead - unless the spec gives that channel itself.
 * @param {Record<string, any>} channels @param {Record<string, any>} spec @param {string[]} names
 */
function hideAxes(channels, spec, names) {
  for (const name of names) if (channels[name] && spec[name] === undefined) channels[name] = { ...channels[name], axis: false }
  return channels
}

// where theta 0 can point: right (+x, the default), top, left or bottom - up the page for a polar
// curve, and away from you on the floor, as north on a map seen from above
const ZEROS = { right: 0, top: Math.PI / 2, left: Math.PI, bottom: -Math.PI / 2 }

/**
 * How angles are given: 'radians' (the default), 'degrees', or { units, zero, clockwise } - where
 * theta 0 points and which way theta turns, as an antenna's or a microphone's datasheet draws it.
 * @param {any} spec @returns {Angles}
 */
function anglesOf(spec) {
  const what = "'angles' is 'radians' (the default) or 'degrees', or { units, zero, clockwise }"
  if (spec === undefined || spec === 'radians' || spec === 'degrees') return { deg: spec === 'degrees', zero: 0, sign: 1 }
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return fail('chart()', `${what}, got ${describe(spec)}`)
  for (const key of Object.keys(spec)) {
    if (!['units', 'zero', 'clockwise'].includes(key)) fail('chart()', `angles has no '${key}' - ${what}`)
  }
  const { units = 'radians', zero = 'right', clockwise = false } = spec
  if (units !== 'radians' && units !== 'degrees') fail('chart()', `angles' units are 'radians' (the default) or 'degrees', got ${describe(units)}`)
  if (!(zero in ZEROS)) fail('chart()', `angles' zero is where theta 0 points: 'right' (the default), 'top', 'left' or 'bottom', got ${describe(zero)}`)
  if (typeof clockwise !== 'boolean') fail('chart()', `angles' clockwise is true or false, got ${describe(clockwise)}`)
  return { deg: units === 'degrees', zero: ZEROS[/** @type {keyof typeof ZEROS} */ (zero)], sign: clockwise ? -1 : 1 }
}

/**
 * One of the grid's values in radians, as the points are made: theta from where its zero points,
 * turning the way given; phi in radians; r and y as they are.
 * @param {string} name @param {number} v @param {Angles} turns
 */
function radians(name, v, turns) {
  const k = turns.deg ? Math.PI / 180 : 1
  if (name === 'theta') return turns.zero + turns.sign * v * k
  return name === 'phi' ? v * k : v
}

/**
 * A surface's normal at grid point (a, b), into normals at k: across its tangents across and along
 * the grid, in the order it is laid out - the way its triangles face. Where the grid pinches to a
 * point - a sphere's pole, a radius of zero - the tangent there is nothing, so it is taken a hair
 * inside the grid instead: the limit the faces around the point lean towards.
 * @param {Float32Array} normals @param {number} k
 * @param {(a: number, b: number) => ArrayLike<number>} at where (a, b) lands
 * @param {number} a @param {number} b @param {[number, number]} ar @param {[number, number]} br
 * @param {number} na @param {number} nb @param {ArrayLike<number>} p the point at (a, b)
 */
function surfaceNormal(normals, k, at, a, b, ar, br, na, nb, p) {
  // steps the way the grid runs, well under a sample's spacing
  const ha = (ar[1] - ar[0]) * 1e-4, hb = (br[1] - br[0]) * 1e-4
  let n = normalAt(at, a, b, ha, hb)
  if (!n) {
    // a hair inside the grid, towards its middle: along whichever way doesn't pinch
    const ia = (ar[1] - ar[0]) / Math.max(1, na - 1) * 0.01, ib = (br[1] - br[0]) / Math.max(1, nb - 1) * 0.01
    const inA = (a - ar[0]) / (ar[1] - ar[0]) < 0.5 ? 1 : -1, inB = (b - br[0]) / (br[1] - br[0]) < 0.5 ? 1 : -1
    n = normalAt(at, a, b + inB * ib, ha, hb) ?? normalAt(at, a + inA * ia, b, ha, hb) ?? normalAt(at, a + inA * ia, b + inB * ib, ha, hb)
    // nowhere to lean: out from the origin, or up
    const out = Math.hypot(p[0], p[1], p[2])
    n ??= out > 0 ? [p[0] / out, p[1] / out, p[2] / out] : [0, 1, 0]
  }
  normals[k * 3] = n[0]
  normals[k * 3 + 1] = n[1]
  normals[k * 3 + 2] = n[2]
}

/**
 * The normal at (a, b) by central differences, unit length - or null where the grid pinches.
 * @param {(a: number, b: number) => ArrayLike<number>} at @param {number} a @param {number} b @param {number} ha @param {number} hb
 * @returns {number[] | null}
 */
function normalAt(at, a, b, ha, hb) {
  const a1 = at(a + ha, b), a0 = at(a - ha, b), b1 = at(a, b + hb), b0 = at(a, b - hb)
  const ux = a1[0] - a0[0], uy = a1[1] - a0[1], uz = a1[2] - a0[2]
  const vx = b1[0] - b0[0], vy = b1[1] - b0[1], vz = b1[2] - b0[2]
  // across, then along: (b) x (a)
  const nx = vy * uz - vz * uy, ny = vz * ux - vx * uz, nz = vx * uy - vy * ux
  const l = Math.hypot(nx, ny, nz), scale = Math.max(ux * ux + uy * uy + uz * uz, vx * vx + vy * vy + vz * vz)
  if (!(l > 1e-6 * scale) || !Number.isFinite(l)) return null
  return [nx / l, ny / l, nz / l]
}

// [vx, vy, vz] = fn(x, y, z): an arrow at each point of a grid - over x and z, and y if given
/** @param {Record<string, any>} spec @param {(a: number, b: number, c: number) => any} call @param {any} samples @returns {Sampled} */
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
        const d = point(call(xv, yv, zv), () => `x ${round(xv)}, y ${round(yv)}, z ${round(zv)}`, 'a direction')
        rows.push({ x: xv, y: yv, z: zv, vx: d.x, vy: d.y, vz: d.z, magnitude: Math.hypot(d.x, d.y, d.z) })
      }
    }
  }
  // a field in a plane has no height to mark: no y axis unless asked for
  const yChannel = y ? channel(spec, 'y', y) : { axis: false, ...object(spec.y, 'y'), field: 'y' }
  return {
    input: { ...spec, data: rows, x: channel(spec, 'x', x), y: yChannel, z: channel(spec, 'z', z), color: spec.color ?? 'magnitude' },
    grid: null, normals: null, coords: null, about: `a vector field, ${nx} × ${ny} × ${nz} arrows`, equal: true,
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

/** The function's values make x, y and z - not fields of data. @param {Record<string, any>} spec @param {string} what */
function noAxisRanges(spec, what) {
  for (const name of ['x', 'y', 'z']) {
    const c = spec[name]
    if (typeof c === 'string') fail('chart()', `${what}'s ${name} comes from its function, not a field - leave it out, give the range to show such as ${name}: [-2, 2], or { title, axis }`)
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

/**
 * A point - [x, y, z] or { x, y, z } - from fn. Where it was is said only if it's wrong.
 * @param {any} v @param {() => string} where @param {string} [what]
 */
function point(v, where, what = 'a point') {
  const p = Array.isArray(v) ? { x: v[0], y: v[1], z: v[2] } : v && typeof v === 'object' ? { x: v.x, y: v.y, z: v.z } : null
  if (!p || (Array.isArray(v) && v.length !== 3) || !finite(p.x) || !finite(p.y) || !finite(p.z)) {
    fail('chart()', `fn gave ${describe(v)} at ${where()} - it returns ${what}, [x, y, z] of finite numbers`)
  }
  return /** @type {{ x: number, y: number, z: number }} */ (p)
}

const finite = (/** @type {any} */ n) => typeof n === 'number' && Number.isFinite(n)

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

/**
 * x, y and z made by the function, with what was given for each (title, axis, format) - and a range,
 * x: [-2, 2], pins that axis to it: shapes drawn in turn over the same ranges share one box, each
 * centred as it is in the ranges, rather than each fitted to its own extent.
 * @param {Record<string, any>} spec
 */
function pointChannels(spec) {
  return Object.fromEntries(['x', 'y', 'z'].map((name) => {
    const range = axisRange(spec, /** @type {'x' | 'y' | 'z'} */ (name), false)
    return [name, range ? channel(spec, name, range) : { ...object(spec[name], name), field: name }]
  }))
}
