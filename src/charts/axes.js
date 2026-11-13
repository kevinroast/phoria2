// A chart's frame: grid walls on the far sides of its box and tick labels on the near edges. Every
// candidate wall and label set is in the scene, and per-camera visibility (showFrom) picks which
// ones a frame draws - so orbiting never moves anything, and two views of one chart are each right.
import { Geometry } from '../geometry/Geometry.js'
import { Group } from '../scene/Node.js'
import { Label, Lines } from '../scene/drawables.js'
import * as mat4 from '../math/mat4.js'
import { scaleLinear } from './scales.js'

/** @import { Camera } from '../scene/cameras.js' */
/** @import { Scale } from './scales.js' */
/** @import { Channel } from './spec.js' */

// a direction this close to an axis counts as looking along it (that axis collapses on screen)
const ALONG = 0.97
// walls closer than this to edge-on are left out
const EDGE_ON = 0.08
// a camera this little to one side counts as straight ahead when choosing which edges to label
const LEAN = 0.1

const tmp = new Float32Array(16)

/**
 * The camera's direction from the box centre, in the box's own space.
 * @param {Group} box @param {Camera} camera @param {number} cy the box centre's height
 */
function look(box, camera, cy) {
  const p = camera.worldPosition
  mat4.invert(tmp, box.worldMatrix)
  const x = tmp[0] * p[0] + tmp[4] * p[1] + tmp[8] * p[2] + tmp[12]
  const y = tmp[1] * p[0] + tmp[5] * p[1] + tmp[9] * p[2] + tmp[13] - cy
  const z = tmp[2] * p[0] + tmp[6] * p[1] + tmp[10] * p[2] + tmp[14]
  const len = Math.hypot(x, y, z) || 1
  return [x / len, y / len, z / len]
}

/**
 * @typedef {object} AxisSpec
 * @property {Scale} scale
 * @property {Channel | null} channel
 * @property {string} title
 */

/**
 * Walls, ticks and titles for a chart box spanning x -w/2..w/2, y 0..h, z -d/2..d/2.
 * @param {{ box: [number, number, number], axes: { x?: AxisSpec, y?: AxisSpec, z?: AxisSpec }, theme: 'dark' | 'light', overlap: 'dim' | 'hide' | 'show' }} options
 * @returns {Group}
 */
export function chartFrame({ box, axes, theme, overlap }) {
  const [w, h, d] = box
  const frame = new Group({ name: 'axes', pickable: false })
  const dir = (camera) => look(frame, camera, h / 2)
  const wallColor = theme === 'light' ? '#c3c8d2' : '#3a3d47'
  const ticksOf = (a) => (a && a.scale.kind !== 'band' && a.channel?.axis !== false ? tickValues(a) : [])
  const xt = ticksOf(axes.x), yt = ticksOf(axes.y), zt = ticksOf(axes.z)

  // six walls: grid lines at the ticks of the two axes they span, and a border
  const wall = (axis, side) => {
    const p = []
    const seg = (a, b) => p.push(...a, ...b)
    const at = (v) => (side < 0 ? -v / 2 : v / 2)
    if (axis === 'y') {
      const y = side < 0 ? 0 : h
      for (const t of xt) { const x = axes.x.scale(t); seg([x, y, -d / 2], [x, y, d / 2]) }
      for (const t of zt) { const z = axes.z.scale(t); seg([-w / 2, y, z], [w / 2, y, z]) }
      rect(seg, [-w / 2, y, -d / 2], [w / 2, y, -d / 2], [w / 2, y, d / 2], [-w / 2, y, d / 2])
    } else if (axis === 'x') {
      const x = at(w)
      for (const t of yt) { const y = axes.y.scale(t); seg([x, y, -d / 2], [x, y, d / 2]) }
      for (const t of zt) { const z = axes.z.scale(t); seg([x, 0, z], [x, h, z]) }
      rect(seg, [x, 0, -d / 2], [x, h, -d / 2], [x, h, d / 2], [x, 0, d / 2])
    } else {
      const z = at(d)
      for (const t of yt) { const y = axes.y.scale(t); seg([-w / 2, y, z], [w / 2, y, z]) }
      for (const t of xt) { const x = axes.x.scale(t); seg([x, 0, z], [x, h, z]) }
      rect(seg, [-w / 2, 0, z], [w / 2, 0, z], [w / 2, h, z], [-w / 2, h, z])
    }
    const k = 'xyz'.indexOf(axis)
    // a wall shows when the camera is on its far side
    frame.add(new Lines({
      geometry: new Geometry({ positions: p }), material: { color: wallColor }, pickable: false,
      showFrom: (camera) => -side * dir(camera)[k] > EDGE_ON,
    }))
  }
  for (const axis of ['x', 'y', 'z']) for (const side of [-1, 1]) wall(axis, side)

  // tick label sets: one per candidate edge, shown when it is the edge nearest the viewer
  const margin = Math.max(w, h, d) * 0.04
  const cls = (kind) => `phoria-axis-${kind} phoria-${theme}`
  const labels = (name, edges, place) => {
    const a = axes[name]
    if (!a || a.channel?.axis === false) return
    const k = 'xyz'.indexOf(name)
    const values = tickValues(a)
    for (const edge of edges) {
      const set = frame.add(new Group({
        showFrom: (camera) => {
          const v = dir(camera)
          return Math.abs(v[k]) < ALONG && edge.when(v)
        },
      }))
      for (const t of values) {
        set.add(new Label({ text: a.scale.format(t), position: edge.at(a.scale(t), margin), place, className: cls('tick'), priority: 1, overlap }))
      }
      // an empty title (axis: { title: '' }) leaves the axis untitled
      if (a.title) set.add(new Label({ text: a.title, position: edge.title(margin), place, className: cls('title'), priority: 2, overlap }))
    }
  }
  const bottom = (v) => v[1] >= -EDGE_ON
  // which side the camera is on - leaning to + so a view from straight ahead (or nearly) keeps its
  // labels where a front-on chart has them, however framing nudges the camera off centre
  const sign = (n) => (n >= -LEAN ? 1 : -1)
  // x ticks along the bottom edge nearest the viewer
  labels('x', [-1, 1].flatMap((zs) => [0, h].map((y) => ({
    when: (v) => (y === 0) === bottom(v) && sign(v[2]) === zs,
    at: (x, m) => [x, y, zs * (d / 2 + m)],
    title: (m) => [0, y, zs * (d / 2 + m * 3.5)],
  }))), 'below')
  // z ticks along the bottom edge on the viewer's side in x
  labels('z', [-1, 1].flatMap((xs) => [0, h].map((y) => ({
    when: (v) => (y === 0) === bottom(v) && sign(v[0]) === xs,
    at: (z, m) => [xs * (w / 2 + m), y, z],
    title: (m) => [xs * (w / 2 + m * 4), y, 0],
  }))), 'below')
  // y ticks up the outline edge on the screen's left: the far side in x, the near side in z
  labels('y', [-1, 1].flatMap((xs) => [-1, 1].map((zs) => ({
    when: (v) => sign(v[0]) === -xs && sign(v[2]) === zs,
    at: (y, m) => [xs * (w / 2 + m), y, zs * d / 2],
    title: (m) => [xs * (w / 2 + m), h + m * 2, zs * d / 2],
  }))), 'left')
  return frame
}

/**
 * The values an axis marks: those it lists, or about as many as it asks for (five unless it says).
 * @param {AxisSpec} a
 */
function tickValues(a) {
  const axis = a.channel?.axis, ticks = axis ? axis.ticks : undefined
  if (!Array.isArray(ticks)) return a.scale.kind === 'band' ? a.scale.ticks() : a.scale.ticks(ticks ?? 5)
  const [r0, r1] = a.scale.range, lo = Math.min(r0, r1), hi = Math.max(r0, r1)
  return ticks.filter((t) => a.scale(t) >= lo - 1e-9 && a.scale(t) <= hi + 1e-9)
}

/**
 * Axes as on a blackboard (frame: 'origin'): a line through zero for each, an arrowhead at its
 * positive end and its name there, small ticks across it with their values - where the walls of
 * chartFrame would box the chart in. An axis whose domain doesn't reach zero crosses the others at
 * its start. Ticks at zero are left unlabelled, where the axes meet.
 * @param {{ box: [number, number, number], axes: Partial<Record<'x' | 'y' | 'z', AxisSpec>>, theme: 'dark' | 'light', overlap: 'dim' | 'hide' | 'show' }} options
 * @returns {Group}
 */
export function originFrame({ box, axes, theme, overlap }) {
  const frame = new Group({ name: 'axes', pickable: false })
  const color = theme === 'light' ? '#5a606c' : '#9aa0ad'
  const cls = (kind) => `phoria-axis-${kind} phoria-${theme}`
  const size = Math.max(...box), tick = size * 0.012, margin = size * 0.03, overshoot = size * 0.04
  // where each axis crosses the others: at zero, or its start when zero is out of its range
  const zero = (name) => {
    const a = axes[name]
    if (!a) return 0
    if (a.scale.kind === 'band') return Math.min(...a.scale.range)
    const [d0, d1] = a.scale.domain
    return a.scale(Math.min(Math.max(0, Math.min(d0, d1)), Math.max(d0, d1)))
  }
  const origin = { x: zero('x'), y: zero('y'), z: zero('z') }
  const shown = (/** @type {'x' | 'y' | 'z'} */ name) => axes[name] && axes[name].channel?.axis !== false
  for (const name of /** @type {('x' | 'y' | 'z')[]} */ (['x', 'y', 'z'])) {
    if (!shown(name)) continue
    const a = /** @type {AxisSpec} */ (axes[name]), k = 'xyz'.indexOf(name)
    const at = (/** @type {number} */ v) => {
      const p = [origin.x, origin.y, origin.z]
      p[k] = v
      return p
    }
    const [r0, r1] = a.scale.range
    // +z runs towards the viewer in the scale's range (z: [d / 2, -d / 2]): its arrow at the start of the range
    const lo = Math.min(r0, r1), hi = Math.max(r0, r1), ahead = name === 'z' ? r0 >= r1 ? lo : hi : hi
    const behind = ahead === hi ? lo : hi, sign = ahead === hi ? 1 : -1
    frame.add(new Lines({ geometry: new Geometry({ positions: [...at(behind), ...at(ahead + sign * overshoot)] }), material: { color, width: 1.5 }, arrows: 'end', pickable: false }))
    // ticks: across the axis, in the plane of the next one (x and z ticks stand up, y's run along x)
    const across = name === 'y' ? 0 : 1, p = []
    const values = a.scale.kind === 'band' ? [] : tickValues(a)
    for (const t of values) {
      const c = at(a.scale(t))
      const u = [...c], v = [...c]
      u[across] -= tick
      v[across] += tick
      p.push(...u, ...v)
      if (Math.abs(t) < 1e-12) continue
      const label = [...c]
      if (name === 'y') label[0] -= margin
      else label[1] -= margin
      frame.add(new Label({ text: a.scale.format(t), position: label, place: name === 'y' ? 'left' : 'below', className: cls('tick'), priority: 1, overlap }))
    }
    if (p.length) frame.add(new Lines({ geometry: new Geometry({ positions: p }), material: { color, width: 1.5 }, pickable: false }))
    const end = at(ahead + sign * (overshoot + margin))
    frame.add(new Label({ text: a.title || name, position: end, place: name === 'y' ? 'above' : 'right', className: cls('title'), priority: 2, overlap }))
  }
  return frame
}

/**
 * Rings around the origin for curved coordinates (with frame: 'origin'), as polar graph paper - faint,
 * under the axes. A polar curve's rings stand upright with it, with spokes every 30°; a polar
 * surface's lie on the floor, with spokes; a cylinder's lie under it, its outermost repeated at its
 * top; a sphere's lie round its equator, with two upright circles through its poles at the outermost.
 * The rings are at round radii out to how far the shape reaches. Labelled - a polar plot, or data -
 * each ring says its radius, from the value at the centre (a dB floor, say), and the angles are
 * marked round the outermost every 30°, with spokes out to them - from where theta 0 points, turning
 * the way theta does (angles: { zero, clockwise }).
 * @param {{ coords: string, upright: boolean, rows: any[], scales: { x?: Scale, y?: Scale, z?: Scale },
 *   theme: 'dark' | 'light', overlap?: 'dim' | 'hide' | 'show', rings?: import('./functions.js').Rings | null }} options
 * @returns {Group | null}
 */
export function curvedGuides({ coords, upright, rows, scales, theme, overlap = 'dim', rings = null }) {
  const { x, y, z } = scales
  if (!x || !y || !z) return null
  // the origin - or, for an axis that doesn't reach it, that axis's nearest end
  const zero = (/** @type {Scale} */ s) => {
    const [d0, d1] = s.domain
    return Math.min(Math.max(0, Math.min(d0, d1)), Math.max(d0, d1))
  }
  const o = [zero(x), zero(y), zero(z)]
  // how far the shape reaches from the axis the rings turn about (from the origin, for a sphere) -
  // or as far as r's domain pins it
  let reach = 0, low = Infinity, high = -Infinity
  for (const r of rows) {
    reach = Math.max(reach, coords === 'spherical' ? Math.hypot(r.x, r.y, r.z) : upright ? Math.hypot(r.x, r.y) : Math.hypot(r.x, r.z))
    low = Math.min(low, r.y)
    high = Math.max(high, r.y)
  }
  if (rings?.reach) reach = rings.reach
  if (!(reach > 0)) return null
  // round values out from the one at the centre, each ring at its distance from there
  const offset = rings?.offset ?? 0
  const values = scaleLinear({ domain: [offset, offset + reach] })
  const ticks = values.ticks(4).filter((t) => t - offset > reach * 1e-6)
  const radii = ticks.map((t) => t - offset)
  const outer = /** @type {number} */ (radii.at(-1) ?? reach)
  const labelled = !!rings?.labelled
  // where theta 0 points, and which way theta turns - where each angle's label goes
  const zeroAt = rings?.zero ?? 0, sign = rings?.sign ?? 1
  const angleAt = (/** @type {number} */ a) => zeroAt + sign * a
  const positions = /** @type {number[]} */ ([])
  const put = (/** @type {number[]} */ p) => positions.push(x(p[0]), y(p[1]), z(p[2]))
  const SIDES = 96
  /** A circle, from the point at each angle round it. @param {(a: number) => number[]} at */
  const circle = (at) => {
    for (let i = 0; i < SIDES; i++) {
      put(at(i / SIDES * 2 * Math.PI))
      put(at((i + 1) / SIDES * 2 * Math.PI))
    }
  }
  // on the floor at a height: theta turning from +x towards +z, as the surfaces are sampled
  const flat = (/** @type {number} */ r, /** @type {number} */ h) => (/** @type {number} */ a) => [o[0] + r * Math.cos(a), h, o[2] + r * Math.sin(a)]
  const standing = (/** @type {number} */ r) => (/** @type {number} */ a) => [o[0] + r * Math.cos(a), o[1] + r * Math.sin(a), o[2]]
  // the plane the rings are read in: upright for a polar curve, else on the floor - under a
  // cylinder, through a sphere's middle
  const base = upright ? standing : (/** @type {number} */ r) => flat(r, coords === 'cylindrical' ? low : o[1])
  // from the centre out to the outermost ring, every 30°
  const spokes = () => {
    const centre = base(0)(0)
    for (let i = 0; i < 12; i++) {
      put(centre)
      put(base(outer)(i * Math.PI / 6))
    }
  }
  for (const r of radii) circle(base(r))
  if (upright || coords === 'polar' || labelled) spokes()
  if (coords === 'cylindrical') circle(flat(outer, high))
  if (coords === 'spherical') {
    circle((a) => [o[0] + outer * Math.cos(a), o[1] + outer * Math.sin(a), o[2]])
    circle((a) => [o[0], o[1] + outer * Math.sin(a), o[2] + outer * Math.cos(a)])
  }
  const color = theme === 'light' ? '#5a606c' : '#9aa0ad'
  const group = new Group({ name: 'guides', pickable: false })
  group.add(new Lines({ geometry: new Geometry({ positions }), material: { color, opacity: 0.3, width: 1 }, pickable: false }))
  if (!labelled) return group
  const world = (/** @type {number[]} */ p) => /** @type {[number, number, number]} */ ([x(p[0]), y(p[1]), z(p[2])])
  const cls = (/** @type {string} */ kind) => `phoria-axis-${kind} phoria-${theme}`
  // each ring's value, between the spokes at 0° and 30° - clear of both
  ticks.forEach((t, i) => {
    group.add(new Label({ text: values.format(t), position: world(base(radii[i])(angleAt(Math.PI / 12))), className: cls('tick'), priority: 1, overlap }))
  })
  // the angles round the outside
  for (let i = 0; i < 12; i++) {
    group.add(new Label({ text: `${i * 30}°`, position: world(base(outer * 1.12)(angleAt(i * Math.PI / 6))), className: cls('tick'), priority: 1, overlap }))
  }
  return group
}

/** Four edges of a rectangle as segments. */
function rect(seg, a, b, c, e) {
  seg(a, b)
  seg(b, c)
  seg(c, e)
  seg(e, a)
}
