// 4D (homogeneous) vectors as Float32Array(4). Signatures follow gl-matrix.

/** @typedef {Float32Array | number[]} Vec4Like */

/** @returns {Float32Array} */
export const create = () => new Float32Array(4)

/** @param {number} x @param {number} y @param {number} z @param {number} w @returns {Float32Array} */
export function fromValues(x, y, z, w) {
  const out = new Float32Array(4)
  out[0] = x
  out[1] = y
  out[2] = z
  out[3] = w
  return out
}

/** @template {Vec4Like} T @param {T} out @param {number} x @param {number} y @param {number} z @param {number} w @returns {T} */
export function set(out, x, y, z, w) {
  out[0] = x
  out[1] = y
  out[2] = z
  out[3] = w
  return out
}

/** out = m * a @template {Vec4Like} T @param {T} out @param {Vec4Like} a @param {Float32Array | number[]} m 4x4 column-major @returns {T} */
export function transformMat4(out, a, m) {
  const x = a[0], y = a[1], z = a[2], w = a[3]
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12] * w
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13] * w
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14] * w
  out[3] = m[3] * x + m[7] * y + m[11] * z + m[15] * w
  return out
}
