// Named camera setups for the common business views: an isometric diorama, a plan from above, a
// front or side elevation, or a plain perspective. The View fits a preset camera to the scene.
import { OrthographicCamera, PerspectiveCamera } from './scene/cameras.js'
import { Vec3 } from './value/Vec3.js'
import { fail, didYouMean } from './validate.js'

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
