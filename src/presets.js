// Named camera setups for the common business views: an isometric diorama, a plan from above, a
// front or side elevation, or a plain perspective. The View fits a preset camera to the scene.
import { OrthographicCamera, PerspectiveCamera } from './scene/cameras.js'
import { Vec3 } from './value/Vec3.js'
import { fail, didYouMean } from './validate.js'

/** @import { Box3 } from './value/Box3.js' */

/** @typedef {'perspective' | 'isometric' | 'top' | 'front' | 'side'} CameraPreset */

/** Direction from the target to the camera, per preset. */
const DIRECTIONS = {
  perspective: [0.6, 0.45, 1],
  isometric: [1, 1, 1],
  top: [0, 1, 0],
  front: [0, 0, 1],
  side: [1, 0, 0],
}
export const CAMERA_PRESETS = /** @type {CameraPreset[]} */ (Object.keys(DIRECTIONS))

// words people use for these views
const ALIASES = {
  ortho: 'isometric', orthographic: 'isometric', iso: 'isometric', plan: 'top', overhead: 'top', above: 'top',
  map: 'top', elevation: 'front', left: 'side', right: 'side', persp: 'perspective', '3d': 'perspective',
}

/**
 * A camera for a preset, looking at `target` from `distance` away. Every preset but 'perspective'
 * is orthographic, so sizes don't shrink with distance - the norm for diagrams and plans.
 * @param {CameraPreset} name
 * @param {{ target?: ArrayLike<number>, distance?: number }} [from]
 * @returns {PerspectiveCamera | OrthographicCamera}
 */
export function cameraPreset(name, { target = [0, 0, 0], distance = 10 } = {}) {
  if (!(name in DIRECTIONS)) {
    const alias = ALIASES[String(name).toLowerCase()]
    fail('View', `camera '${name}' is not a preset - ${alias ? `use '${alias}'` : `expected one of ${CAMERA_PRESETS.map((p) => `'${p}'`).join(', ')}${didYouMean(String(name), CAMERA_PRESETS)}`}`)
  }
  const direction = new Vec3(...DIRECTIONS[name]).normalize()
  const position = new Vec3(target[0], target[1], target[2]).add(direction.multiplyScalar(distance))
  return name === 'perspective'
    ? new PerspectiveCamera({ fov: 45, position, target: [target[0], target[1], target[2]] })
    : new OrthographicCamera({ height: distance, position, target: [target[0], target[1], target[2]], far: Math.max(1000, distance * 20) })
}

/**
 * How to fit a box in view, looking at its centre from `direction` (centre to camera): the distance
 * for a perspective camera (give `fov`), or the view height for an orthographic one. Every corner
 * of the box, as the camera sees it, lands inside the view with `padding` to spare - so a flat or
 * long box (a floor plan, a network, a timeline) sits as close as it can, where the sphere round it
 * would leave it small.
 * @param {Box3} box
 * @param {ArrayLike<number>} direction a unit vector from the box's centre towards the camera
 * @param {{ aspect: number, fov?: number, padding?: number }} view fov in degrees, vertical; padding
 *   is the margin as a fraction of the size, as for view.frame()
 * @returns {number}
 */
export function fitBox(box, direction, { aspect, fov, padding = 0 }) {
  const scale = 1 + padding, wide = aspect > 0 ? aspect : 1
  const center = box.getCenter()
  // the camera's axes: across, up, and ahead into the view (a straight-down view takes -z as up)
  const ahead = new Vec3(-direction[0], -direction[1], -direction[2])
  const right = ahead.clone().cross(Math.abs(ahead[1]) > 0.9999 ? [0, 0, -1] : [0, 1, 0]).normalize()
  const up = right.clone().cross(ahead)
  const radius = Math.max(box.getRadius(), 1e-3)
  let fit = 0
  for (let i = 0; i < 8; i++) {
    const q = new Vec3(i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], i & 4 ? box.max[2] : box.min[2]).sub(center)
    const x = Math.abs(q.dot(right)) * scale, y = Math.abs(q.dot(up)) * scale, z = q.dot(ahead)
    if (fov === undefined) {
      // half the height: tall enough for this corner, and wide enough at this aspect
      fit = Math.max(fit, y, x / wide)
    } else {
      // back far enough that the corner is inside the view; a nearer corner (z < 0) needs more
      const tanV = Math.tan(fov * Math.PI / 360), tanH = tanV * wide
      fit = Math.max(fit, x / tanH - z, y / tanV - z, radius * 0.05 - z)
    }
  }
  return fov === undefined ? Math.max(fit * 2, 1e-3) : Math.max(fit, 1e-3)
}

// where a perspective picture's middle sits, below the view's middle (in half-heights of the view):
// a little low, so things standing on a floor look grounded rather than hung from the top edge
const LOW = 0.12

/**
 * How to fit a set of points in view from `direction`: where to look (the centre) and the distance
 * for a perspective camera (give `fov`), or the view height for an orthographic one. Every point
 * lands inside the view with `padding` to spare. Fitting the corners of each thing drawn, rather
 * than one box round them all, keeps a picture from sitting small in the box's empty corners. An
 * orthographic picture is centred; a perspective one - whose near side looks bigger - is moved
 * until it sits just below the middle, filling as much of the view as that allows.
 * @param {ArrayLike<number>[]} points world positions, at least one
 * @param {ArrayLike<number>} direction a unit vector from the points towards the camera
 * @param {{ aspect: number, fov?: number, padding?: number }} view as for fitBox
 * @returns {{ center: Vec3, size: number }}
 */
export function fitPoints(points, direction, { aspect, fov, padding = 0 }) {
  const scale = 1 + padding, wide = aspect > 0 ? aspect : 1
  const ahead = new Vec3(-direction[0], -direction[1], -direction[2])
  const right = ahead.clone().cross(Math.abs(ahead[1]) > 0.9999 ? [0, 0, -1] : [0, 1, 0]).normalize()
  const up = right.clone().cross(ahead)
  const axes = [right, up, ahead]
  // the points in the camera's axes, and the middle of their spread
  const local = points.map((p) => axes.map((a) => p[0] * a[0] + p[1] * a[1] + p[2] * a[2]))
  const lo = [0, 1, 2].map((k) => Math.min(...local.map((q) => q[k]))), hi = [0, 1, 2].map((k) => Math.max(...local.map((q) => q[k])))
  const mid = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2)
  const world = (k) => right[k] * mid[0] + up[k] * mid[1] + ahead[k] * mid[2]
  const centerOf = () => new Vec3(world(0), world(1), world(2))
  if (fov === undefined) {
    const half = Math.max((hi[1] - lo[1]) / 2, (hi[0] - lo[0]) / 2 / wide) * scale
    return { center: centerOf(), size: Math.max(half * 2, 1e-3) }
  }
  const tanV = Math.tan(fov * Math.PI / 360), tanH = tanV * wide
  const near = Math.max(...[0, 1, 2].map((k) => hi[k] - lo[k]), 1e-3) * 0.05
  // back far enough that every point, about the centre, is inside the view
  const distance = () => Math.max(1e-3, ...local.map((q) => {
    const x = Math.abs(q[0] - mid[0]) * scale, y = Math.abs(q[1] - mid[1]) * scale, z = q[2] - mid[2]
    return Math.max(x / tanH - z, y / tanV - z, near - z)
  }))
  let d = distance()
  for (let i = 0; i < 8; i++) {
    // where the points land, from -1 to 1 across the view: move the centre until their middle is
    // across the middle of the view, and just below it
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
    for (const q of local) {
      const depth = d + q[2] - mid[2], u = (q[0] - mid[0]) / depth / tanH, v = (q[1] - mid[1]) / depth / tanV
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v)
    }
    const du = (u0 + u1) / 2, dv = (v0 + v1) / 2 + LOW
    if (Math.abs(du) < 1e-4 && Math.abs(dv) < 1e-4) break
    mid[0] += du * tanH * d
    mid[1] += dv * tanV * d
    d = distance()
  }
  return { center: centerOf(), size: d }
}

/** @typedef {'height' | 'width' | 'both'} FramingKeep */

/**
 * How much bigger (or smaller) the view must be to keep a camera's framing when the canvas's shape
 * changes from `designed` (the aspect the framing was set for) to `aspect`. 'height' keeps the
 * framed height (the width varies - the default for any camera); 'width' keeps the framed width;
 * 'both' keeps everything framed in view, widening for narrower canvases and keeping the height for
 * wider ones.
 * @param {FramingKeep} keep @param {number} designed @param {number} aspect
 * @returns {number} the factor for an orthographic camera's height, or a perspective camera's distance
 */
export function framingScale(keep, designed, aspect) {
  if (keep === 'height' || !(aspect > 0) || !(designed > 0)) return 1
  const ratio = designed / aspect
  return keep === 'width' ? ratio : Math.max(1, ratio)
}
