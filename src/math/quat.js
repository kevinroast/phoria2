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

/** out = a * b (apply b, then a) @template {Float32Array | number[]} T @param {T} out @param {Float32Array | number[]} a @param {Float32Array | number[]} b @returns {T} */
export function multiply(out, a, b) {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3]
  const bx = b[0], by = b[1], bz = b[2], bw = b[3]
  out[0] = ax * bw + aw * bx + ay * bz - az * by
  out[1] = ay * bw + aw * by + az * bx - ax * bz
  out[2] = az * bw + aw * bz + ax * by - ay * bx
  out[3] = aw * bw - ax * bx - ay * by - az * bz
  return out
}

/** @template {Float32Array | number[]} T @param {T} out @param {Float32Array | number[]} a @returns {T} */
export function normalize(out, a) {
  const x = a[0], y = a[1], z = a[2], w = a[3]
  let len = x * x + y * y + z * z + w * w
  if (len > 0) len = 1 / Math.sqrt(len)
  out[0] = x * len
  out[1] = y * len
  out[2] = z * len
  out[3] = w * len
  return out
}

/** @template {Float32Array | number[]} T @param {T} out @param {Float32Array | number[]} a @returns {T} */
export function invert(out, a) {
  const x = a[0], y = a[1], z = a[2], w = a[3]
  const dot = x * x + y * y + z * z + w * w
  const inv = dot ? 1 / dot : 0
  out[0] = -x * inv
  out[1] = -y * inv
  out[2] = -z * inv
  out[3] = w * inv
  return out
}

/** Spherical interpolation, taking the short way round. @template {Float32Array | number[]} T @param {T} out @param {Float32Array | number[]} a @param {Float32Array | number[]} b @param {number} t @returns {T} */
export function slerp(out, a, b, t) {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3]
  let bx = b[0], by = b[1], bz = b[2], bw = b[3]
  let cosom = ax * bx + ay * by + az * bz + aw * bw
  if (cosom < 0) {
    cosom = -cosom
    bx = -bx; by = -by; bz = -bz; bw = -bw
  }
  let s0 = 1 - t, s1 = t
  if (1 - cosom > 0.000001) {
    const omega = Math.acos(cosom), sinom = Math.sin(omega)
    s0 = Math.sin((1 - t) * omega) / sinom
    s1 = Math.sin(t * omega) / sinom
  }
  out[0] = s0 * ax + s1 * bx
  out[1] = s0 * ay + s1 * by
  out[2] = s0 * az + s1 * bz
  out[3] = s0 * aw + s1 * bw
  return out
}

// Ken Shoemake's algorithm, as in gl-matrix. The matrix must be a pure rotation.
/** @template {Float32Array | number[]} T @param {T} out @param {Float32Array | number[]} m 3x3 column-major @returns {T} */
export function fromMat3(out, m) {
  const trace = m[0] + m[4] + m[8]
  if (trace > 0) {
    let root = Math.sqrt(trace + 1)
    out[3] = 0.5 * root
    root = 0.5 / root
    out[0] = (m[5] - m[7]) * root
    out[1] = (m[6] - m[2]) * root
    out[2] = (m[1] - m[3]) * root
  } else {
    let i = 0
    if (m[4] > m[0]) i = 1
    if (m[8] > m[i * 3 + i]) i = 2
    const j = (i + 1) % 3, k = (i + 2) % 3
    let root = Math.sqrt(m[i * 3 + i] - m[j * 3 + j] - m[k * 3 + k] + 1)
    out[i] = 0.5 * root
    root = 0.5 / root
    out[3] = (m[j * 3 + k] - m[k * 3 + j]) * root
    out[j] = (m[j * 3 + i] + m[i * 3 + j]) * root
    out[k] = (m[k * 3 + i] + m[i * 3 + k]) * root
  }
  return out
}

// Euler angles (radians) applied in XYZ order - the same convention as three.js's default.
/** @template {Float32Array | number[]} T @param {T} out @param {number} x @param {number} y @param {number} z @returns {T} */
export function fromEulerXYZ(out, x, y, z) {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2)
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2)
  out[0] = s1 * c2 * c3 + c1 * s2 * s3
  out[1] = c1 * s2 * c3 - s1 * c2 * s3
  out[2] = c1 * c2 * s3 + s1 * s2 * c3
  out[3] = c1 * c2 * c3 - s1 * s2 * s3
  return out
}
