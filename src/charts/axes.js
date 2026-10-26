// A chart's frame: grid walls on the far sides of its box and tick labels on the near edges. Every
// candidate wall and label set is in the scene, and per-camera visibility (showFrom) picks which
// ones a frame draws - so orbiting never moves anything, and two views of one chart are each right.
import { Geometry } from '../geometry/Geometry.js'
import { Group } from '../scene/Node.js'
import { Label, Lines } from '../scene/drawables.js'
import * as mat4 from '../math/mat4.js'

/** @import { Camera } from '../scene/cameras.js' */
/** @import { Scale } from './scales.js' */
/** @import { Channel } from './spec.js' */

// a direction this close to an axis counts as looking along it (that axis collapses on screen)
const ALONG = 0.97
// walls closer than this to edge-on are left out
const EDGE_ON = 0.08

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
  const ticksOf = (a) => (a && a.scale.kind !== 'band' && a.channel?.axis !== false ? a.scale.ticks(5) : [])
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
    const values = a.scale.ticks(a.scale.kind === 'band' ? undefined : 5)
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
  const sign = (n) => (n >= 0 ? 1 : -1)
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

/** Four edges of a rectangle as segments. */
function rect(seg, a, b, c, e) {
  seg(a, b)
  seg(b, c)
  seg(c, e)
  seg(e, a)
}
