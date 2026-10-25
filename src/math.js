// phoria2's maths: constants, the vector/matrix modules and a few helpers. The vector and matrix
// functions keep gl-matrix's signatures (out, a, b) and column-major Float32Array layout - they
// are the subset phoria uses, adapted from gl-matrix (MIT, (c) Brandon Jones, Colin MacKenzie IV).
import * as mat4 from './math/mat4.js'
import * as quat from './math/quat.js'
import * as vec3 from './math/vec3.js'
import * as vec4 from './math/vec4.js'

/** @import { XYZ } from './types.js' */

export * as vec2 from './math/vec2.js'
export * as mat3 from './math/mat3.js'
export { mat4, quat, vec3, vec4 }

export const RADIANS = Math.PI / 180
export const TWOPI = Math.PI * 2
export const ONEOPI = 1 / Math.PI
export const PIO2 = Math.PI / 2
export const PIO4 = Math.PI / 4
export const EPSILON = 0.000001

/** @param {XYZ} xyz @returns {Float32Array} */
export const vec3FromXYZ = ({ x, y, z }) => vec3.fromValues(x, y, z)
/** @param {Float32Array | number[]} v @returns {XYZ} */
export const vec3ToXYZ = (v) => ({ x: v[0], y: v[1], z: v[2] })
/** @param {XYZ} xyz @param {number} w @returns {Float32Array} */
export const vec4FromXYZ = ({ x, y, z }, w) => vec4.fromValues(x, y, z, w)

/**
 * Rotation matrix from yaw (heading), pitch (elevation) and roll (bank) Euler angles in radians.
 * @param {number} yaw @param {number} pitch @param {number} roll
 * @returns {Float32Array}
 */
export function mat4FromYPR(yaw, pitch, roll) {
  const sr = Math.sin(roll), cr = Math.cos(roll)
  const sp = Math.sin(pitch), cp = Math.cos(pitch)
  const sy = Math.sin(yaw), cy = Math.cos(yaw)
  const out = mat4.create()
  out[0] = cy * cr
  out[4] = -(cy * sr)
  out[8] = sy
  out[1] = sp * sy * cr + cp * sr
  out[5] = cp * cr - sp * sy * sr
  out[9] = -(sp * cy)
  out[2] = sp * sr - cp * sy * cr
  out[6] = sp * cr + cp * sy * sr
  out[10] = cp * cy
  return out
}

/**
 * Quaternion from yaw (heading), pitch (elevation) and roll (bank) Euler angles in radians.
 * @param {number} yaw @param {number} pitch @param {number} roll
 * @returns {Float32Array}
 */
export function quatFromYPR(yaw, pitch, roll) {
  const sr = Math.sin(roll * 0.5), cr = Math.cos(roll * 0.5)
  const sp = Math.sin(pitch * 0.5), cp = Math.cos(pitch * 0.5)
  const sy = Math.sin(yaw * 0.5), cy = Math.cos(yaw * 0.5)
  return quat.fromValues(
    cy * sp * cr + sy * cp * sr,
    sy * cp * cr - cy * sp * sr,
    cy * cp * sr - sy * sp * cr,
    cy * cp * cr + sy * sp * sr)
}
