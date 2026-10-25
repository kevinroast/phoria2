// 3D vectors as Float32Array(3). Signatures follow gl-matrix: results are written to `out`,
// which is also returned. Functions only read and write the first three components, so a vec4
// can be passed where a vec3 is expected (its w is left alone).

/** @typedef {Float32Array | number[]} Vec3Like */

/** @returns {Float32Array} */
export const create = () => new Float32Array(3)

/** @param {number} x @param {number} y @param {number} z @returns {Float32Array} */
export function fromValues(x, y, z) {
  const out = new Float32Array(3)
  out[0] = x
  out[1] = y
  out[2] = z
  return out
}

/** @template {Vec3Like} T @param {T} out @param {Vec3Like} a @param {Vec3Like} b @returns {T} */
export function add(out, a, b) {
  out[0] = a[0] + b[0]
  out[1] = a[1] + b[1]
  out[2] = a[2] + b[2]
  return out
}

/** @template {Vec3Like} T @param {T} out @param {Vec3Like} a @param {Vec3Like} b @returns {T} */
export function subtract(out, a, b) {
  out[0] = a[0] - b[0]
  out[1] = a[1] - b[1]
  out[2] = a[2] - b[2]
  return out
}

/** @template {Vec3Like} T @param {T} out @param {Vec3Like} a @param {number} s @returns {T} */
export function scale(out, a, s) {
  out[0] = a[0] * s
  out[1] = a[1] * s
  out[2] = a[2] * s
  return out
}

/** out = a + b * s @template {Vec3Like} T @param {T} out @param {Vec3Like} a @param {Vec3Like} b @param {number} s @returns {T} */
export function scaleAndAdd(out, a, b, s) {
  out[0] = a[0] + b[0] * s
  out[1] = a[1] + b[1] * s
  out[2] = a[2] + b[2] * s
  return out
}

/** @param {Vec3Like} a @param {Vec3Like} b @returns {number} */
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** @template {Vec3Like} T @param {T} out @param {Vec3Like} a @param {Vec3Like} b @returns {T} */
export function cross(out, a, b) {
  const ax = a[0], ay = a[1], az = a[2]
  const bx = b[0], by = b[1], bz = b[2]
  out[0] = ay * bz - az * by
  out[1] = az * bx - ax * bz
  out[2] = ax * by - ay * bx
  return out
}

/** @param {Vec3Like} a @returns {number} */
export const length = (a) => Math.hypot(a[0], a[1], a[2])

/** @param {Vec3Like} a @param {Vec3Like} b @returns {number} */
export const distance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])

// A zero vector normalises to zero rather than NaN.
/** @template {Vec3Like} T @param {T} out @param {Vec3Like} a @returns {T} */
export function normalize(out, a) {
  const x = a[0], y = a[1], z = a[2]
  let len = x * x + y * y + z * z
  if (len > 0) len = 1 / Math.sqrt(len)
  out[0] = x * len
  out[1] = y * len
  out[2] = z * len
  return out
}

/** @template {Vec3Like} T @param {T} out @param {Vec3Like} a @param {Float32Array | number[]} m 3x3 column-major @returns {T} */
export function transformMat3(out, a, m) {
  const x = a[0], y = a[1], z = a[2]
  out[0] = x * m[0] + y * m[3] + z * m[6]
  out[1] = x * m[1] + y * m[4] + z * m[7]
  out[2] = x * m[2] + y * m[5] + z * m[8]
  return out
}
