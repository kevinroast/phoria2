// Where a directional light's shadow map looks: fitted every frame to what casts shadows, so there
// is no shadow camera to configure. In the light's view a shadow only travels along the depth,
// so the casters' extent across the view is all the map has to cover; the depth runs on to the
// furthest receiver.
import * as mat4 from './math/mat4.js'
import { Mat4 } from './value/Mat4.js'

/** @import { Box3 } from './value/Box3.js' */

/** Shadow map size in texels. */
export const SHADOW_MAP_SIZE = 2048

/**
 * @typedef {object} ShadowFit
 * @property {Mat4} viewProjection world to the light's clip space
 * @property {number} texelSize world units per shadow map texel
 */

/**
 * Fit a directional light's shadow view to the world bounds of the casters (and the depth of the
 * receivers). Null when nothing casts.
 * @param {ArrayLike<number>} direction the way the light travels
 * @param {Box3[]} casters world bounds
 * @param {Box3[]} receivers world bounds
 * @param {number} [size] map size in texels
 * @returns {ShadowFit | null}
 */
export function fitShadow(direction, casters, receivers, size = SHADOW_MAP_SIZE) {
  const boxes = casters.filter((b) => !b.isEmpty())
  if (!boxes.length) return null
  const d = normalized(direction)
  // look along the light from the origin; only the orientation matters, the box comes next
  const up = Math.abs(d[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0]
  const view = mat4.lookAt(mat4.create(), [0, 0, 0], d, up)

  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity
  const corners = (/** @type {Box3} */ b, /** @type {boolean} */ across) => {
    for (let i = 0; i < 8; i++) {
      const px = i & 1 ? b.max[0] : b.min[0], py = i & 2 ? b.max[1] : b.min[1], pz = i & 4 ? b.max[2] : b.min[2]
      const x = view[0] * px + view[4] * py + view[8] * pz
      const y = view[1] * px + view[5] * py + view[9] * pz
      const z = view[2] * px + view[6] * py + view[10] * pz
      if (across) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
      if (z < z0) z0 = z
      if (z > z1) z1 = z
    }
  }
  for (const b of boxes) corners(b, true)
  // receivers only stretch the depth (view z is negative in front, so the far end is the minimum)
  for (const b of receivers) if (!b.isEmpty()) corners(b, false)

  // a small margin, so the soft edge of the outermost caster's shadow isn't clipped
  const margin = Math.max(x1 - x0, y1 - y0, 1e-3) * 0.02
  x0 -= margin; x1 += margin; y0 -= margin; y1 += margin
  const depthMargin = Math.max(z1 - z0, 1e-3) * 0.01
  const projection = mat4.ortho(mat4.create(), x0, x1, y0, y1, -z1 - depthMargin, -z0 + depthMargin)
  const viewProjection = new Mat4()
  mat4.multiply(viewProjection, projection, view)
  return { viewProjection, texelSize: Math.max(x1 - x0, y1 - y0) / size }
}

/** Spot shadows' map: four tiles of half its size, one a light. */
export const SPOT_ATLAS_SIZE = 2048
export const SPOT_TILES = 4

/**
 * A spot light's view for its shadow: from the light along its cone, wide enough for the cone,
 * from just short of the nearest caster to the furthest receiver (or the light's range).
 * @param {ArrayLike<number>} position @param {ArrayLike<number>} direction
 * @param {number} angle the cone's half-angle @param {number} range 0 for unlimited
 * @param {Box3[]} casters @param {Box3[]} receivers
 * @returns {{ viewProjection: Mat4, texelAngle: number } | null} texelAngle: a shadow map texel's size at a distance of 1
 */
export function fitSpotShadow(position, direction, angle, range, casters, receivers) {
  const boxes = casters.filter((b) => !b.isEmpty())
  if (!boxes.length) return null
  const d = normalized(direction)
  const up = Math.abs(d[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0]
  const eye = Float32Array.from(position), at = Float32Array.from([position[0] + d[0], position[1] + d[1], position[2] + d[2]])
  const view = mat4.lookAt(mat4.create(), eye, at, Float32Array.from(up))
  let near = Infinity, far = 0
  const depths = (/** @type {Box3} */ b, /** @type {boolean} */ caster) => {
    for (let i = 0; i < 8; i++) {
      const px = i & 1 ? b.max[0] : b.min[0], py = i & 2 ? b.max[1] : b.min[1], pz = i & 4 ? b.max[2] : b.min[2]
      const z = -(view[2] * px + view[6] * py + view[10] * pz + view[14])
      if (caster && z < near) near = z
      if (z > far) far = z
    }
  }
  for (const b of boxes) depths(b, true)
  for (const b of receivers) if (!b.isEmpty()) depths(b, false)
  near = Math.max(0.05, near * 0.9)
  if (range > 0) far = Math.min(far, range)
  far = Math.max(far * 1.02, near * 2)
  // a little wider than the cone, so its soft edge isn't cut off
  const fov = Math.min(2 * angle * 1.1 + 0.05, Math.PI * 0.95)
  const projection = mat4.perspective(mat4.create(), fov, 1, near, far)
  const viewProjection = new Mat4()
  mat4.multiply(viewProjection, projection, view)
  return { viewProjection, texelAngle: 2 * Math.tan(fov / 2) / (SPOT_ATLAS_SIZE / 2) }
}

/** @param {ArrayLike<number>} v @returns {number[]} */
function normalized(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / len, v[1] / len, v[2] / len]
}
