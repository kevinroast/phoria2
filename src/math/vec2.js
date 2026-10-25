// 2D vectors as Float32Array(2). Signatures follow gl-matrix: results are written to `out`,
// which is also returned.

/** @typedef {Float32Array | number[]} Vec2Like */

/** @returns {Float32Array} */
export const create = () => new Float32Array(2)

/** @param {number} x @param {number} y @returns {Float32Array} */
export function fromValues(x, y) {
  const out = new Float32Array(2)
  out[0] = x
  out[1] = y
  return out
}

/** @template {Vec2Like} T @param {T} out @param {Vec2Like} a @param {Vec2Like} b @returns {T} */
export function subtract(out, a, b) {
  out[0] = a[0] - b[0]
  out[1] = a[1] - b[1]
  return out
}

/** out = a + b * scale @template {Vec2Like} T @param {T} out @param {Vec2Like} a @param {Vec2Like} b @param {number} scale @returns {T} */
export function scaleAndAdd(out, a, b, scale) {
  out[0] = a[0] + b[0] * scale
  out[1] = a[1] + b[1] * scale
  return out
}
