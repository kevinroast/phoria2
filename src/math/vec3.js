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

/** Transform a point by a 4x4, dividing by w. @template {Vec3Like} T @param {T} out @param {Vec3Like} a @param {Float32Array | number[]} m @returns {T} */
export function transformMat4(out, a, m) {
  const x = a[0], y = a[1], z = a[2]
  const w = (m[3] * x + m[7] * y + m[11] * z + m[15]) || 1
  out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w
  out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w
  out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w
  return out
}

/** Rotate a vector by a quaternion. @template {Vec3Like} T @param {T} out @param {Vec3Like} a @param {Float32Array | number[]} q @returns {T} */
export function transformQuat(out, a, q) {
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3]
  const x = a[0], y = a[1], z = a[2]
  // v' = v + 2w(q x v) + 2(q x (q x v))
  let uvx = qy * z - qz * y, uvy = qz * x - qx * z, uvz = qx * y - qy * x
  let uuvx = qy * uvz - qz * uvy, uuvy = qz * uvx - qx * uvz, uuvz = qx * uvy - qy * uvx
  const w2 = qw * 2
  uvx *= w2; uvy *= w2; uvz *= w2
  uuvx *= 2; uuvy *= 2; uuvz *= 2
  out[0] = x + uvx + uuvx
  out[1] = y + uvy + uuvy
  out[2] = z + uvz + uuvz
  return out
}

/** @template {Vec3Like} T @param {T} out @param {Vec3Like} a @param {Vec3Like} b @param {number} t @returns {T} */
export function lerp(out, a, b, t) {
  out[0] = a[0] + t * (b[0] - a[0])
  out[1] = a[1] + t * (b[1] - a[1])
  out[2] = a[2] + t * (b[2] - a[2])
  return out
}

/** @template {Vec3Like} T @param {T} out @param {Vec3Like} a @returns {T} */
export function negate(out, a) {
  out[0] = -a[0]
  out[1] = -a[1]
  out[2] = -a[2]
  return out
}
