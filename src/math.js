// phoria2's maths: the vector/matrix modules and two constants. The functions keep gl-matrix's
// signatures (out, a, b) and column-major Float32Array layout - they are the subset phoria uses,
// adapted from gl-matrix (MIT, (c) Brandon Jones, Colin MacKenzie IV).
export * as vec2 from './math/vec2.js'
export * as vec3 from './math/vec3.js'
export * as vec4 from './math/vec4.js'
export * as mat3 from './math/mat3.js'
export * as mat4 from './math/mat4.js'
export * as quat from './math/quat.js'

export const RADIANS = Math.PI / 180
export const EPSILON = 0.000001
