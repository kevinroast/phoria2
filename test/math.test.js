import { describe, expect, it } from 'vitest'
// gl-matrix is a dev dependency only: the reference our own maths is checked against
import * as gl from 'gl-matrix'
import { mat3, mat4, quat, vec2, vec3, vec4 } from '../src/math.js'

// deterministic pseudo-random values so failures are reproducible
let seed = 1
const rnd = () => {
  seed = (seed * 16807) % 2147483647
  return (seed / 2147483647) * 4 - 2
}
const arr = (n) => Float32Array.from({ length: n }, rnd)
// a well conditioned, invertible transform: rotation, scale and translation
const affine = () => {
  const m = gl.mat4.create()
  gl.mat4.translate(m, m, arr(3))
  gl.mat4.rotate(m, m, rnd() * 3, arr(3))
  gl.mat4.scale(m, m, [1 + Math.abs(rnd()), 1 + Math.abs(rnd()), 1 + Math.abs(rnd())])
  return m
}

const same = (ours, ref) => {
  expect(ours.length).toBe(ref.length)
  for (let i = 0; i < ref.length; i++) expect(ours[i]).toBeCloseTo(ref[i], 4)
}

// Each case runs the same call against our module and gl-matrix and compares `out`.
const cases = {
  'vec2.subtract': [vec2.subtract, gl.vec2.subtract, () => [arr(2), arr(2)], 2],
  'vec2.scaleAndAdd': [vec2.scaleAndAdd, gl.vec2.scaleAndAdd, () => [arr(2), arr(2), rnd()], 2],
  'vec3.add': [vec3.add, gl.vec3.add, () => [arr(3), arr(3)], 3],
  'vec3.subtract': [vec3.subtract, gl.vec3.subtract, () => [arr(3), arr(3)], 3],
  'vec3.scale': [vec3.scale, gl.vec3.scale, () => [arr(3), rnd()], 3],
  'vec3.scaleAndAdd': [vec3.scaleAndAdd, gl.vec3.scaleAndAdd, () => [arr(3), arr(3), rnd()], 3],
  'vec3.cross': [vec3.cross, gl.vec3.cross, () => [arr(3), arr(3)], 3],
  'vec3.normalize': [vec3.normalize, gl.vec3.normalize, () => [arr(3)], 3],
  'vec3.transformMat3': [vec3.transformMat3, gl.vec3.transformMat3, () => [arr(3), arr(9)], 3],
  'vec4.transformMat4': [vec4.transformMat4, gl.vec4.transformMat4, () => [arr(4), arr(16)], 4],
  'quat.setAxisAngle': [quat.setAxisAngle, gl.quat.setAxisAngle, () => [gl.vec3.normalize([], arr(3)), rnd()], 4],
  'mat3.normalFromMat4': [mat3.normalFromMat4, gl.mat3.normalFromMat4, () => [affine()], 9],
  'mat4.transpose': [mat4.transpose, gl.mat4.transpose, () => [arr(16)], 16],
  'mat4.invert': [mat4.invert, gl.mat4.invert, () => [affine()], 16],
  'mat4.multiply': [mat4.multiply, gl.mat4.multiply, () => [arr(16), arr(16)], 16],
  'mat4.translate': [mat4.translate, gl.mat4.translate, () => [arr(16), arr(3)], 16],
  'mat4.scale': [mat4.scale, gl.mat4.scale, () => [arr(16), arr(3)], 16],
  'mat4.rotate': [mat4.rotate, gl.mat4.rotate, () => [arr(16), rnd() * 3, arr(3)], 16],
  'mat4.rotateX': [mat4.rotateX, gl.mat4.rotateX, () => [arr(16), rnd() * 3], 16],
  'mat4.rotateY': [mat4.rotateY, gl.mat4.rotateY, () => [arr(16), rnd() * 3], 16],
  'mat4.rotateZ': [mat4.rotateZ, gl.mat4.rotateZ, () => [arr(16), rnd() * 3], 16],
  'mat4.fromQuat': [mat4.fromQuat, gl.mat4.fromQuat, () => [gl.quat.normalize([], arr(4))], 16],
  'mat4.perspective': [mat4.perspective, gl.mat4.perspective, () => [0.3 + Math.abs(rnd()), 0.5 + Math.abs(rnd()), 1, 1000], 16],
  'mat4.lookAt': [mat4.lookAt, gl.mat4.lookAt, () => [arr(3).map((v) => v * 10), arr(3), [0, 1, 0]], 16],
  'mat4.targetTo': [mat4.targetTo, gl.mat4.targetTo, () => [arr(3).map((v) => v * 10), arr(3), [0, 1, 0]], 16],
  'mat4.ortho': [mat4.ortho, gl.mat4.ortho, () => [-1 - Math.abs(rnd()), 1 + Math.abs(rnd()), -2, 2, 0.1, 100], 16],
  'mat4.fromRotationTranslationScale': [mat4.fromRotationTranslationScale, gl.mat4.fromRotationTranslationScale,
    () => [gl.quat.normalize([], arr(4)), arr(3), arr(3)], 16],
  'mat3.fromMat4': [mat3.fromMat4, gl.mat3.fromMat4, () => [arr(16)], 9],
  'vec3.transformMat4': [vec3.transformMat4, gl.vec3.transformMat4, () => [arr(3), affine()], 3],
  'vec3.transformQuat': [vec3.transformQuat, gl.vec3.transformQuat, () => [arr(3), gl.quat.normalize([], arr(4))], 3],
  'vec3.lerp': [vec3.lerp, gl.vec3.lerp, () => [arr(3), arr(3), rnd()], 3],
  'vec3.negate': [vec3.negate, gl.vec3.negate, () => [arr(3)], 3],
  'quat.multiply': [quat.multiply, gl.quat.multiply, () => [arr(4), arr(4)], 4],
  'quat.normalize': [quat.normalize, gl.quat.normalize, () => [arr(4)], 4],
  'quat.invert': [quat.invert, gl.quat.invert, () => [arr(4)], 4],
  'quat.slerp': [quat.slerp, gl.quat.slerp, () => [gl.quat.normalize([], arr(4)), gl.quat.normalize([], arr(4)), Math.abs(rnd()) / 2], 4],
  'quat.fromMat3': [quat.fromMat3, gl.quat.fromMat3, () => [gl.mat3.fromQuat([], gl.quat.normalize([], arr(4)))], 4],
}

describe('math matches gl-matrix', () => {
  for (const [name, [ours, ref, args, size]] of Object.entries(cases)) {
    it(name, () => {
      for (let n = 0; n < 25; n++) {
        const a = args()
        same(ours(new Float32Array(size), ...a), ref(new Float32Array(size), ...a))
      }
    })

    // in-place use (out === first operand) is common in phoria, e.g. mat4.rotateY(m, m, a)
    if (args().length && args()[0].length === size) {
      it(`${name} in place`, () => {
        const a = args()
        const mine = Float32Array.from(a[0])
        const theirs = Float32Array.from(a[0])
        same(ours(mine, mine, ...a.slice(1)), ref(theirs, theirs, ...a.slice(1)))
      })
    }
  }

  it('scalar functions', () => {
    for (let n = 0; n < 25; n++) {
      const a = arr(3), b = arr(3), m = affine()
      expect(vec3.dot(a, b)).toBeCloseTo(gl.vec3.dot(a, b), 5)
      expect(vec3.length(a)).toBeCloseTo(gl.vec3.length(a), 5)
      expect(vec3.distance(a, b)).toBeCloseTo(gl.vec3.distance(a, b), 5)
      expect(mat4.determinant(m)).toBeCloseTo(gl.mat4.determinant(m), 3)
    }
  })

  it('constructors and identities', () => {
    same(mat4.create(), gl.mat4.create())
    same(mat3.create(), gl.mat3.create())
    same(quat.create(), gl.quat.create())
    same(vec4.set(vec4.create(), 1, 2, 3, 4), [1, 2, 3, 4])
    same(mat4.identity(arr(16)), gl.mat4.create())
    same(mat3.identity(arr(9)), gl.mat3.create())
    same(mat4.perspective(new Float32Array(16), 1, 1.5, 1, Infinity), gl.mat4.perspective(new Float32Array(16), 1, 1.5, 1, Infinity))
  })

  it('quat.fromEulerXYZ matches gl-matrix xyz order (which takes degrees)', () => {
    for (let n = 0; n < 25; n++) {
      const [x, y, z] = [rnd() * 3, rnd() * 3, rnd() * 3]
      const deg = 180 / Math.PI
      same(quat.fromEulerXYZ(new Float32Array(4), x, y, z), gl.quat.fromEuler(new Float32Array(4), x * deg, y * deg, z * deg, 'xyz'))
    }
  })

  it('edge cases', () => {
    expect(mat4.invert(mat4.create(), new Float32Array(16))).toBeNull()
    expect(mat3.normalFromMat4(mat3.create(), new Float32Array(16))).toBeNull()
    same(vec3.normalize(vec3.create(), [0, 0, 0]), [0, 0, 0])
    same(mat4.lookAt(arr(16), [1, 2, 3], [1, 2, 3], [0, 1, 0]), gl.mat4.create())
  })
})
