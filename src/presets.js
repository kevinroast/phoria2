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
