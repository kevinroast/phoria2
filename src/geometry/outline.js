// Flat outlines for extrude() and lathe(): plain lists of [x, y] points, counter-clockwise, so they
// can be spread into one another to make a shape - a rod's eyes joined by its sides, a cam's base
// circle and nose. Angles are radians, anticlockwise from +x.
import { checkNumber, checkOptions, describe, fail } from '../validate.js'

/** @typedef {[number, number]} Point2 */

const TAU = Math.PI * 2

/** What each outline takes (a number alone sets the first, where that makes sense). */
export const OUTLINE_OPTIONS = {
  circle: ['radius', 'segments', 'center'],
  rect: ['size', 'width', 'height', 'radius', 'segments', 'center'],
  polygon: ['radius', 'sides', 'angle', 'center'],
  arc: ['radius', 'from', 'to', 'segments', 'center'],
  gear: ['radius', 'teeth', 'depth', 'center'],
}

const HINTS = {
  r: "use 'radius'",
  x: "use center: [x, y]",
  y: "use center: [x, y]",
  centre: "use 'center'",
  startAngle: "use 'from' (radians)",
  endAngle: "use 'to' (radians)",
  cornerRadius: "use 'radius' for the corners' rounding",
  n: "use 'sides' (polygon) or 'segments'",
}

/**
 * @typedef {object} CircleOptions
 * @property {number} [radius] default 1
 * @property {number} [segments] points round it, default 32
 * @property {ArrayLike<number>} [center] [x, y], default [0, 0]
 */

/**
 * A circle's outline - a hole for an axle, a bolt, a bore.
 * @example extrude({ shape: outline.circle(1), holes: [outline.circle(0.4)], depth: 0.2 }) // a washer
 * @param {number | CircleOptions} [options] a number sets the radius
 * @returns {Point2[]}
 */
function circle(options) {
  const owner = 'outline.circle()'
  const o = resolve(owner, options, OUTLINE_OPTIONS.circle, (n) => ({ radius: n }))
  const radius = positive(owner, 'radius', o.radius, 1)
  const segments = whole(owner, 'segments', o.segments, 32, 3)
  const [cx, cy] = point(owner, 'center', o.center)
  return Array.from({ length: segments }, (_, i) => {
    const a = i / segments * TAU
    return /** @type {Point2} */ ([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius])
  })
}

/**
 * @typedef {object} RectOptions
 * @property {number} [size] sets width and height together, default 1
 * @property {number} [width] along x, default size
 * @property {number} [height] along y, default size
 * @property {number} [radius] rounds the corners, default 0 (square)
 * @property {number} [segments] points round each rounded corner, default 8
 * @property {ArrayLike<number>} [center] [x, y], default [0, 0]
 */

/**
 * A rectangle's outline, square-cornered or rounded - a plate, a bracket, a slot.
 * @example outline.rect({ width: 4, height: 1.3, radius: 0.2 })
 * @param {number | RectOptions} [options] a number sets width and height
 * @returns {Point2[]}
 */
function rect(options) {
  const owner = 'outline.rect()'
  const o = resolve(owner, options, OUTLINE_OPTIONS.rect, (n) => ({ size: n }))
  const all = positive(owner, 'size', o.size, 1)
  const width = positive(owner, 'width', o.width, all), height = positive(owner, 'height', o.height, all)
  const radius = o.radius === undefined ? 0 : checkNumber(owner, 'radius', o.radius)
  if (radius < 0 || radius > Math.min(width, height) / 2) fail(owner, `'radius' must be from 0 to half the shorter side (${Math.min(width, height) / 2}), got ${radius}`)
  const segments = whole(owner, 'segments', o.segments, 8, 1)
  const [cx, cy] = point(owner, 'center', o.center)
  const w = width / 2, h = height / 2
  if (radius === 0) return [[cx - w, cy - h], [cx + w, cy - h], [cx + w, cy + h], [cx - w, cy + h]]
  /** @type {Point2[]} */
  const out = []
  // each corner's arc, anticlockwise from the bottom right
  for (const [x, y, start] of [[w - radius, -h + radius, -Math.PI / 2], [w - radius, h - radius, 0], [-w + radius, h - radius, Math.PI / 2], [-w + radius, -h + radius, Math.PI]]) {
    for (let i = 0; i <= segments; i++) {
      const a = start + i / segments * Math.PI / 2
      out.push([cx + x + Math.cos(a) * radius, cy + y + Math.sin(a) * radius])
    }
  }
  return out
}

/**
 * @typedef {object} PolygonOptions
 * @property {number} [radius] to the corners, default 1
 * @property {number} [sides] default 6
 * @property {number} [angle] turns it, radians; default 0, a corner on +x
 * @property {ArrayLike<number>} [center] [x, y], default [0, 0]
 */

/**
 * A regular polygon's outline - a hex nut, a triangle, an octagon.
 * @example extrude({ shape: outline.polygon({ radius: 0.2, sides: 6 }), holes: [outline.circle(0.1)], depth: 0.1 }) // a nut
 * @param {number | PolygonOptions} [options] a number sets the radius
 * @returns {Point2[]}
 */
function polygon(options) {
  const owner = 'outline.polygon()'
  const o = resolve(owner, options, OUTLINE_OPTIONS.polygon, (n) => ({ radius: n }))
  const radius = positive(owner, 'radius', o.radius, 1)
  const sides = whole(owner, 'sides', o.sides, 6, 3)
  const angle = o.angle === undefined ? 0 : checkNumber(owner, 'angle', o.angle)
  const [cx, cy] = point(owner, 'center', o.center)
  return Array.from({ length: sides }, (_, i) => {
    const a = angle + i / sides * TAU
    return /** @type {Point2} */ ([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius])
  })
}

/**
 * @typedef {object} ArcOptions
 * @property {number} [radius] default 1
 * @property {number} [from] start angle, radians anticlockwise from +x; default 0
 * @property {number} [to] end angle; default a whole turn on from `from`. Below `from`, the arc runs clockwise
 * @property {number} [segments] pieces along it, default enough for 32 a turn
 * @property {ArrayLike<number>} [center] [x, y], default [0, 0]
 */

/**
 * Points along an arc, both ends included - to join with others into an outline: a connecting
 * rod's two eyes, a crank web's pin end and counterweight.
 * @example extrude({ shape: [...outline.arc({ radius: 0.3, from: 0, to: Math.PI }), ...outline.arc({ radius: 0.6, from: Math.PI, to: 2 * Math.PI, center: [0, -0.5] })] })
 * @param {ArcOptions} [options]
 * @returns {Point2[]}
 */
function arc(options) {
  const owner = 'outline.arc()'
  const o = resolve(owner, options, OUTLINE_OPTIONS.arc, null)
  const radius = positive(owner, 'radius', o.radius, 1)
  const from = o.from === undefined ? 0 : checkNumber(owner, 'from', o.from)
  const to = o.to === undefined ? from + TAU : checkNumber(owner, 'to', o.to)
  if (to === from) fail(owner, "'from' and 'to' are the same angle - there's no arc between them")
  const segments = whole(owner, 'segments', o.segments, Math.max(1, Math.ceil(Math.abs(to - from) / TAU * 32)), 1)
  const [cx, cy] = point(owner, 'center', o.center)
  return Array.from({ length: segments + 1 }, (_, i) => {
    const a = from + (to - from) * i / segments
    return /** @type {Point2} */ ([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius])
  })
}

/**
 * @typedef {object} GearOptions
 * @property {number} [radius] to the tips of the teeth, default 1
 * @property {number} [teeth] default 24
 * @property {number} [depth] how far the teeth stand out, default a tooth's width
 * @property {ArrayLike<number>} [center] [x, y], default [0, 0]
 */

/**
 * A gear's toothed outline: straight-sided teeth round a root circle - flywheels, sprockets, cogs.
 * @example extrude({ shape: outline.gear({ radius: 1, teeth: 72, depth: 0.05 }), holes: [outline.circle(0.1)], depth: 0.1 })
 * @param {number | GearOptions} [options] a number sets the radius
 * @returns {Point2[]}
 */
function gear(options) {
  const owner = 'outline.gear()'
  const o = resolve(owner, options, OUTLINE_OPTIONS.gear, (n) => ({ radius: n }))
  const radius = positive(owner, 'radius', o.radius, 1)
  const teeth = whole(owner, 'teeth', o.teeth, 24, 3)
  const depth = positive(owner, 'depth', o.depth, Math.min(radius / 2, radius * Math.PI / teeth))
  if (depth >= radius) fail(owner, `'depth' must be less than the radius (${radius}), got ${depth}`)
  const [cx, cy] = point(owner, 'center', o.center)
  const root = radius - depth, step = TAU / teeth
  /** @type {Point2[]} */
  const out = []
  // a tooth: up its leading flank, across the tip, down its trailing flank, then along the root
  for (let i = 0; i < teeth; i++) {
    for (const [f, r] of [[0, root], [0.12, radius], [0.38, radius], [0.5, root]]) {
      const a = (i + f) * step
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
    }
  }
  return out
}

/**
 * Flat outlines for extrude() and lathe(), each a list of [x, y] points. Spread several into one
 * list to build a shape, or pass them as holes.
 */
export const outline = { circle, rect, polygon, arc, gear }

// --- checking

/**
 * @param {string} owner @param {unknown} options @param {string[]} keys
 * @param {((n: number) => object) | null} fromNumber
 * @returns {Record<string, any>}
 */
function resolve(owner, options, keys, fromNumber) {
  const o = /** @type {object} */ (typeof options === 'number' && fromNumber ? fromNumber(options) : options)
  checkOptions(owner, o, keys, HINTS)
  return o ?? {}
}

/** @param {string} owner @param {string} name @param {unknown} value @param {number} fallback */
function positive(owner, name, value, fallback) {
  if (value === undefined) return fallback
  const v = checkNumber(owner, name, value)
  if (!(v > 0) || !Number.isFinite(v)) fail(owner, `'${name}' must be more than 0, got ${v}`)
  return v
}

/** @param {string} owner @param {string} name @param {unknown} value @param {number} fallback @param {number} min */
function whole(owner, name, value, fallback, min) {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || /** @type {number} */ (value) < min) fail(owner, `'${name}' must be a whole number ${min} or more, got ${describe(value)}`)
  return /** @type {number} */ (value)
}

/** @param {string} owner @param {string} name @param {unknown} value @returns {Point2} */
function point(owner, name, value) {
  if (value === undefined) return [0, 0]
  const p = /** @type {any} */ (value)
  if (!p || typeof p !== 'object' || typeof p[0] !== 'number' || typeof p[1] !== 'number' || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
    fail(owner, `'${name}' must be [x, y], got ${describe(value)}`)
  }
  return [p[0], p[1]]
}
