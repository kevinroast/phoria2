// Quaternions as Float32Array(4) [x, y, z, w]. Signatures follow gl-matrix.

/** @returns {Float32Array} identity quaternion */
export function create() {
  const out = new Float32Array(4)
  out[3] = 1
  return out
}

/** @param {number} x @param {number} y @param {number} z @param {number} w @returns {Float32Array} */
export function fromValues(x, y, z, w) {
  const out = new Float32Array(4)
  out[0] = x
  out[1] = y
  out[2] = z
  out[3] = w
  return out
}

/** Rotation of `rad` radians about a normalised axis. @template {Float32Array | number[]} T @param {T} out @param {Float32Array | number[]} axis @param {number} rad @returns {T} */
export function setAxisAngle(out, axis, rad) {
  const s = Math.sin(rad * 0.5)
  out[0] = s * axis[0]
  out[1] = s * axis[1]
  out[2] = s * axis[2]
  out[3] = Math.cos(rad * 0.5)
  return out
}
