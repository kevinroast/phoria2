// 4x4 matrices as column-major Float32Array(16), the layout WebGL expects. Signatures follow
// gl-matrix: results are written to `out`, which is also returned. Operations such as
// translate(out, a, v) post-multiply - out = a * T(v) - so chained calls apply in object space.

/** @typedef {Float32Array | number[]} Mat4Like */
/** @typedef {Float32Array | number[]} Vec3Like */

const EPSILON = 0.000001

/** @returns {Float32Array} identity */
export function create() {
  return identity(new Float32Array(16))
}

/** @template {Mat4Like} T @param {T} out @returns {T} */
export function identity(out) {
  out.fill(0)
  out[0] = out[5] = out[10] = out[15] = 1
  return out
}

/** @template {Mat4Like} T @param {T} out @param {Mat4Like} a @returns {T} */
export function transpose(out, a) {
  if (out === a) {
    const a01 = a[1], a02 = a[2], a03 = a[3], a12 = a[6], a13 = a[7], a23 = a[11]
    out[1] = a[4]; out[2] = a[8]; out[3] = a[12]
    out[4] = a01; out[6] = a[9]; out[7] = a[13]
    out[8] = a02; out[9] = a12; out[11] = a[14]
    out[12] = a03; out[13] = a13; out[14] = a23
    return out
  }
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) out[c * 4 + r] = a[r * 4 + c]
  }
  return out
}

/** @template {Mat4Like} T @param {T} out @param {Mat4Like} a @returns {T | null} null if not invertible */
export function invert(out, a) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3]
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7]
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11]
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15]

  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10
  const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31
  const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
  if (!det) return null
  det = 1 / det

  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det
  return out
}

/** @param {Mat4Like} a @returns {number} */
export function determinant(a) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3]
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7]
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11]
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15]
  const b0 = a00 * a11 - a01 * a10, b1 = a00 * a12 - a02 * a10
  const b2 = a01 * a12 - a02 * a11, b3 = a20 * a31 - a21 * a30
  const b4 = a20 * a32 - a22 * a30, b5 = a21 * a32 - a22 * a31
  const b6 = a00 * b5 - a01 * b4 + a02 * b3
  const b7 = a10 * b5 - a11 * b4 + a12 * b3
  const b8 = a20 * b2 - a21 * b1 + a22 * b0
  const b9 = a30 * b2 - a31 * b1 + a32 * b0
  return a13 * b6 - a03 * b7 + a33 * b8 - a23 * b9
}

/** out = a * b @template {Mat4Like} T @param {T} out @param {Mat4Like} a @param {Mat4Like} b @returns {T} */
export function multiply(out, a, b) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3]
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7]
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11]
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15]
  // one column of b at a time, so out may alias a or b
  for (let c = 0; c < 16; c += 4) {
    const b0 = b[c], b1 = b[c + 1], b2 = b[c + 2], b3 = b[c + 3]
    out[c] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30
    out[c + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31
    out[c + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32
    out[c + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33
  }
  return out
}

export const mul = multiply

/** out = a * T(v) @template {Mat4Like} T @param {T} out @param {Mat4Like} a @param {Vec3Like} v @returns {T} */
export function translate(out, a, v) {
  const x = v[0], y = v[1], z = v[2]
  if (out !== a) for (let i = 0; i < 12; i++) out[i] = a[i]
  out[12] = a[0] * x + a[4] * y + a[8] * z + a[12]
  out[13] = a[1] * x + a[5] * y + a[9] * z + a[13]
  out[14] = a[2] * x + a[6] * y + a[10] * z + a[14]
  out[15] = a[3] * x + a[7] * y + a[11] * z + a[15]
  return out
}

/** out = a * S(v) @template {Mat4Like} T @param {T} out @param {Mat4Like} a @param {Vec3Like} v @returns {T} */
export function scale(out, a, v) {
  for (let i = 0; i < 4; i++) {
    out[i] = a[i] * v[0]
    out[i + 4] = a[i + 4] * v[1]
    out[i + 8] = a[i + 8] * v[2]
    out[i + 12] = a[i + 12]
  }
  return out
}

/** out = a * R(axis, rad); returns null for a zero-length axis @template {Mat4Like} T @param {T} out @param {Mat4Like} a @param {number} rad @param {Vec3Like} axis @returns {T | null} */
export function rotate(out, a, rad, axis) {
  let x = axis[0], y = axis[1], z = axis[2]
  let len = Math.hypot(x, y, z)
  if (len < EPSILON) return null
  len = 1 / len
  x *= len
  y *= len
  z *= len
  const s = Math.sin(rad), c = Math.cos(rad), t = 1 - c

  // rotation matrix
  const b00 = x * x * t + c, b01 = y * x * t + z * s, b02 = z * x * t - y * s
  const b10 = x * y * t - z * s, b11 = y * y * t + c, b12 = z * y * t + x * s
  const b20 = x * z * t + y * s, b21 = y * z * t - x * s, b22 = z * z * t + c

  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3]
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7]
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11]
  out[0] = a00 * b00 + a10 * b01 + a20 * b02
  out[1] = a01 * b00 + a11 * b01 + a21 * b02
  out[2] = a02 * b00 + a12 * b01 + a22 * b02
  out[3] = a03 * b00 + a13 * b01 + a23 * b02
  out[4] = a00 * b10 + a10 * b11 + a20 * b12
  out[5] = a01 * b10 + a11 * b11 + a21 * b12
  out[6] = a02 * b10 + a12 * b11 + a22 * b12
  out[7] = a03 * b10 + a13 * b11 + a23 * b12
  out[8] = a00 * b20 + a10 * b21 + a20 * b22
  out[9] = a01 * b20 + a11 * b21 + a21 * b22
  out[10] = a02 * b20 + a12 * b21 + a22 * b22
  out[11] = a03 * b20 + a13 * b21 + a23 * b22
  if (out !== a) for (let i = 12; i < 16; i++) out[i] = a[i]
  return out
}

// Rotating about a principal axis mixes two columns of `a`: col i and col j.
function rotateColumns(out, a, rad, i, j, sign) {
  const s = Math.sin(rad) * sign, c = Math.cos(rad)
  if (out !== a) for (let k = 0; k < 16; k++) out[k] = a[k]
  for (let k = 0; k < 4; k++) {
    const ai = a[i + k], aj = a[j + k]
    out[i + k] = ai * c + aj * s
    out[j + k] = aj * c - ai * s
  }
  return out
}

/** out = a * Rx(rad) @template {Mat4Like} T @param {T} out @param {Mat4Like} a @param {number} rad @returns {T} */
export const rotateX = (out, a, rad) => rotateColumns(out, a, rad, 4, 8, 1)
/** out = a * Ry(rad) @template {Mat4Like} T @param {T} out @param {Mat4Like} a @param {number} rad @returns {T} */
export const rotateY = (out, a, rad) => rotateColumns(out, a, rad, 0, 8, -1)
/** out = a * Rz(rad) @template {Mat4Like} T @param {T} out @param {Mat4Like} a @param {number} rad @returns {T} */
export const rotateZ = (out, a, rad) => rotateColumns(out, a, rad, 0, 4, 1)

/** Rotation matrix from a quaternion [x, y, z, w]. @template {Mat4Like} T @param {T} out @param {Float32Array | number[]} q @returns {T} */
export function fromQuat(out, q) {
  const x = q[0], y = q[1], z = q[2], w = q[3]
  const x2 = x + x, y2 = y + y, z2 = z + z
  const xx = x * x2, yx = y * x2, yy = y * y2
  const zx = z * x2, zy = z * y2, zz = z * z2
  const wx = w * x2, wy = w * y2, wz = w * z2
  out[0] = 1 - yy - zz; out[1] = yx + wz; out[2] = zx - wy; out[3] = 0
  out[4] = yx - wz; out[5] = 1 - xx - zz; out[6] = zy + wx; out[7] = 0
  out[8] = zx + wy; out[9] = zy - wx; out[10] = 1 - xx - yy; out[11] = 0
  out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1
  return out
}

// Perspective projection with a -1..1 clip-space depth range (OpenGL/WebGL). `far` may be
// Infinity. A negative fovy flips the image vertically.
/** @template {Mat4Like} T @param {T} out @param {number} fovy radians @param {number} aspect @param {number} near @param {number} far @returns {T} */
export function perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2)
  out.fill(0)
  out[0] = f / aspect
  out[5] = f
  out[11] = -1
  if (far != null && far !== Infinity) {
    const nf = 1 / (near - far)
    out[10] = (far + near) * nf
    out[14] = 2 * far * near * nf
  } else {
    out[10] = -1
    out[14] = -2 * near
  }
  return out
}

// View matrix for an eye looking at a centre point. Returns identity when eye and centre match.
/** @template {Mat4Like} T @param {T} out @param {Vec3Like} eye @param {Vec3Like} center @param {Vec3Like} up @returns {T} */
export function lookAt(out, eye, center, up) {
  const ex = eye[0], ey = eye[1], ez = eye[2]
  if (Math.abs(ex - center[0]) < EPSILON && Math.abs(ey - center[1]) < EPSILON && Math.abs(ez - center[2]) < EPSILON) {
    return identity(out)
  }
  // z axis points from the centre back to the eye
  let z0 = ex - center[0], z1 = ey - center[1], z2 = ez - center[2]
  let len = 1 / Math.hypot(z0, z1, z2)
  z0 *= len; z1 *= len; z2 *= len

  let x0 = up[1] * z2 - up[2] * z1
  let x1 = up[2] * z0 - up[0] * z2
  let x2 = up[0] * z1 - up[1] * z0
  len = Math.hypot(x0, x1, x2)
  if (!len) {
    x0 = x1 = x2 = 0
  } else {
    len = 1 / len
    x0 *= len; x1 *= len; x2 *= len
  }

  let y0 = z1 * x2 - z2 * x1
  let y1 = z2 * x0 - z0 * x2
  let y2 = z0 * x1 - z1 * x0
  len = Math.hypot(y0, y1, y2)
  if (!len) {
    y0 = y1 = y2 = 0
  } else {
    len = 1 / len
    y0 *= len; y1 *= len; y2 *= len
  }

  out[0] = x0; out[1] = y0; out[2] = z0; out[3] = 0
  out[4] = x1; out[5] = y1; out[6] = z1; out[7] = 0
  out[8] = x2; out[9] = y2; out[10] = z2; out[11] = 0
  out[12] = -(x0 * ex + x1 * ey + x2 * ez)
  out[13] = -(y0 * ex + y1 * ey + y2 * ez)
  out[14] = -(z0 * ex + z1 * ey + z2 * ez)
  out[15] = 1
  return out
}
