// Where lights' shadow maps look: fitted every frame to what casts shadows, so there is no shadow
// camera to configure. In a directional light's view a shadow only travels along the depth, so the
// casters' extent across the view is all the map has to cover; the depth runs on to the furthest
// receiver. Spot, rect-area and point lights fit their cones and cubes the same way. Also what soft
// shadows are made of, for the renderer and refine alike.
import * as mat4 from './math/mat4.js'
import { Mat4 } from './value/Mat4.js'

/** @import { Box3 } from './value/Box3.js' */

/** Shadow map size in texels. */
export const SHADOW_MAP_SIZE = 2048

/**
 * Soft shadows: at shadowSoftness 1 the edge spreads this much of the gap from caster to surface
 * either way - four tenths across, a large studio light; for a sun, the angle a light that wide
 * spans, which refine tilts its direction across.
 */
export const SOFT_SPREAD = 0.2

/** A light's shadowSoftness, held to 0-1 - set on the light directly it isn't checked. @param {{ shadowSoftness?: number }} light */
export const softnessOf = (light) => Math.min(1, Math.max(0, light.shadowSoftness ?? 0))

/** Soft shadows' blue-noise tile is this many texels square (a power of two: the shader wraps by mask). */
export const BLUE_NOISE_SIZE = 64

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
 * @param {Box3 | null} [area] the light's shadowBounds: the map covers this across, whatever casts
 * @returns {ShadowFit | null}
 */
export function fitShadow(direction, casters, receivers, size = SHADOW_MAP_SIZE, area = null) {
  const boxes = casters.filter((b) => !b.isEmpty())
  if (!boxes.length) return null
  const d = normalized(direction)
  // look along the light from the origin; only the orientation matters, the box comes next
  const up = Math.abs(d[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0]
  const view = mat4.lookAt(mat4.create(), [0, 0, 0], d, up)

  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity
  // a box's reach along each of the view's axes: its middle's, give or take its half-size against the
  // axis - the same as its eight corners', for a third of the work (thousands of casters a frame)
  const ax = Math.abs(view[0]), ay = Math.abs(view[4]), az = Math.abs(view[8])
  const bx = Math.abs(view[1]), by = Math.abs(view[5]), bz = Math.abs(view[9])
  const cx = Math.abs(view[2]), cy = Math.abs(view[6]), cz = Math.abs(view[10])
  const corners = (/** @type {Box3} */ b, /** @type {boolean} */ across) => {
    const mx = (b.min[0] + b.max[0]) / 2, my = (b.min[1] + b.max[1]) / 2, mz = (b.min[2] + b.max[2]) / 2
    const ex = (b.max[0] - b.min[0]) / 2, ey = (b.max[1] - b.min[1]) / 2, ez = (b.max[2] - b.min[2]) / 2
    if (across) {
      const x = view[0] * mx + view[4] * my + view[8] * mz, rx = ax * ex + ay * ey + az * ez
      const y = view[1] * mx + view[5] * my + view[9] * mz, ry = bx * ex + by * ey + bz * ez
      if (x - rx < x0) x0 = x - rx
      if (x + rx > x1) x1 = x + rx
      if (y - ry < y0) y0 = y - ry
      if (y + ry > y1) y1 = y + ry
    }
    const z = view[2] * mx + view[6] * my + view[10] * mz, rz = cx * ex + cy * ey + cz * ez
    if (z - rz < z0) z0 = z - rz
    if (z + rz > z1) z1 = z + rz
  }
  // across the light's view: the area it was given, or else the casters; in depth, everything that
  // casts - so a caster outside the area, between it and the light, still shadows it
  if (area) corners(area, true)
  for (const b of boxes) corners(b, !area)
  // receivers only stretch the depth (view z is negative in front, so the far end is the minimum)
  for (const b of receivers) if (!b.isEmpty()) corners(b, false)

  // a small margin, so the soft edge of the outermost caster's shadow isn't clipped
  const margin = Math.max(x1 - x0, y1 - y0, 1e-3) * 0.02
  x0 -= margin; x1 += margin; y0 -= margin; y1 += margin
  const depthMargin = Math.max(z1 - z0, 1e-3) * 0.01
  z0 -= depthMargin; z1 += depthMargin

  // steady while things move: the map grows and shrinks in small steps rather than with every change
  // in the casters' extent, and its edges sit on the texel grid, so a shadow that isn't moving falls
  // on the same texels every frame, instead of shimmering as the fit slides about under it
  const w = steps(x1 - x0), h = steps(y1 - y0)
  const tx = w / size, ty = h / size
  x0 = Math.floor((x0 + x1 - w) / 2 / tx) * tx
  y0 = Math.floor((y0 + y1 - h) / 2 / ty) * ty
  // the depth range too, which sets what each stored depth means
  const dz = steps(z1 - z0) / 64
  z0 = Math.floor(z0 / dz) * dz
  z1 = Math.ceil(z1 / dz) * dz

  const projection = mat4.ortho(mat4.create(), x0, x0 + w, y0, y0 + h, -z1, -z0)
  const viewProjection = new Mat4()
  mat4.multiply(viewProjection, projection, view)
  return { viewProjection, texelSize: Math.max(w, h) / size }
}

/** A length rounded up to the next of a ladder of sizes, sixteen to each doubling. @param {number} v */
function steps(v) {
  return 2 ** (Math.ceil(Math.log2(Math.max(v, 1e-3)) * 16) / 16)
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
 * @returns {{ viewProjection: Mat4, texelAngle: number, near: number, far: number } | null} texelAngle: a shadow map texel's size at a distance of 1
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
  return { viewProjection, texelAngle: 2 * Math.tan(fov / 2) / (SPOT_ATLAS_SIZE / 2), near, far }
}

/** A point light's shadow: a cube of six square faces, each this many texels across. */
export const POINT_SHADOW_SIZE = 1024

// the cube's faces in GL's order (+X, -X, +Y, -Y, +Z, -Z): which way each looks, and its up -
// upside down, as cube maps are stored
const CUBE_FACES = [
  [[1, 0, 0], [0, -1, 0]], [[-1, 0, 0], [0, -1, 0]],
  [[0, 1, 0], [0, 0, 1]], [[0, -1, 0], [0, 0, -1]],
  [[0, 0, 1], [0, -1, 0]], [[0, 0, -1], [0, -1, 0]],
]

/**
 * A point light's six views for its shadow, a right angle each, from close to the light out to the
 * furthest receiver (or the light's range). Null when nothing casts.
 * @param {ArrayLike<number>} position @param {number} range 0 for unlimited
 * @param {Box3[]} casters @param {Box3[]} receivers
 * @returns {{ viewProjections: Mat4[], near: number, far: number, texelAngle: number } | null} texelAngle: a texel's size at a distance of 1
 */
export function fitPointShadow(position, range, casters, receivers) {
  const boxes = casters.filter((b) => !b.isEmpty())
  if (!boxes.length) return null
  // out to the furthest corner of anything casting or receiving
  let far = 0
  for (const b of [...boxes, ...receivers]) {
    if (b.isEmpty()) continue
    for (let i = 0; i < 8; i++) {
      const dx = (i & 1 ? b.max[0] : b.min[0]) - position[0]
      const dy = (i & 2 ? b.max[1] : b.min[1]) - position[1]
      const dz = (i & 4 ? b.max[2] : b.min[2]) - position[2]
      far = Math.max(far, Math.hypot(dx, dy, dz))
    }
  }
  if (range > 0) far = Math.min(far, range)
  far = Math.max(far * 1.02, 1e-3)
  // a caster can wrap the light - a lantern, a pumpkin - so the near plane can't wait for the
  // nearest caster; a fraction of the far one keeps the depth precise
  const near = far * 2e-3
  const projection = mat4.perspective(mat4.create(), Math.PI / 2, 1, near, far)
  const eye = Float32Array.from(position)
  const viewProjections = CUBE_FACES.map(([d, up]) => {
    const at = Float32Array.from([eye[0] + d[0], eye[1] + d[1], eye[2] + d[2]])
    const view = mat4.lookAt(mat4.create(), eye, at, Float32Array.from(up))
    return /** @type {Mat4} */ (mat4.multiply(new Mat4(), projection, view))
  })
  return { viewProjections, near, far, texelAngle: 2 / POINT_SHADOW_SIZE }
}

/** @param {ArrayLike<number>} v @returns {number[]} */
function normalized(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / len, v[1] / len, v[2] / len]
}
