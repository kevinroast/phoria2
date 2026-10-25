import { mat4, vec3 } from 'gl-matrix'
import { mat4FromYPR } from '../math.js'

// Base for everything in the scene graph: a model matrix with chainable operations, a list of
// child entities that inherit the matrix, and per-frame scene event handlers.
export class BaseEntity {
  // optional unique id - lets trigger handlers find an entity via scene.findEntity()
  id = null
  // model matrix applied during scene processing
  matrix = mat4.create()
  // children are transformed by this entity's matrix (and can have children of their own)
  children = []
  // true to skip this entity and all its children during scene processing
  disabled = false
  // function(scene, time) this = entity - before the matrix is combined with the parent's
  onBeforeSceneHandlers = []
  // function(scene, matLocal, time) this = entity - after the matrix is combined with the parent's
  onSceneHandlers = []

  // Object literal description: { id, matrix, children, onBeforeScene, onScene, disabled }
  static create(desc, e = new this()) {
    if (desc.id) e.id = desc.id
    if (desc.matrix) e.matrix = desc.matrix
    if (desc.children) e.children = desc.children
    if (desc.onBeforeScene) e.onBeforeScene(desc.onBeforeScene)
    if (desc.onScene) e.onScene(desc.onScene)
    if (desc.disabled !== undefined) e.disabled = desc.disabled
    return e
  }

  // Handler registration accepts a function or an array of functions.
  onBeforeScene(fn) {
    this.onBeforeSceneHandlers = this.onBeforeSceneHandlers.concat(fn)
    return this
  }

  onScene(fn) {
    this.onSceneHandlers = this.onSceneHandlers.concat(fn)
    return this
  }

  identity() {
    mat4.identity(this.matrix)
    return this
  }

  invert() {
    mat4.invert(this.matrix, this.matrix)
    return this
  }

  multiply(m) {
    mat4.multiply(this.matrix, this.matrix, m)
    return this
  }

  scale(vec) {
    mat4.scale(this.matrix, this.matrix, vec)
    return this
  }

  scaleN(n) {
    mat4.scale(this.matrix, this.matrix, vec3.fromValues(n, n, n))
    return this
  }

  rotate(rad, axis) {
    mat4.rotate(this.matrix, this.matrix, rad, axis)
    return this
  }

  rotateX(rad) {
    mat4.rotateX(this.matrix, this.matrix, rad)
    return this
  }

  rotateY(rad) {
    mat4.rotateY(this.matrix, this.matrix, rad)
    return this
  }

  rotateZ(rad) {
    mat4.rotateZ(this.matrix, this.matrix, rad)
    return this
  }

  // Rotate by yaw (heading), pitch (elevation) and roll (bank) Euler angles in radians.
  rotateYPR(yaw, pitch, roll) {
    mat4.multiply(this.matrix, this.matrix, mat4FromYPR(yaw, pitch, roll))
    return this
  }

  translate(vec) {
    mat4.translate(this.matrix, this.matrix, vec)
    return this
  }

  translateX(n) {
    mat4.translate(this.matrix, this.matrix, vec3.fromValues(n, 0, 0))
    return this
  }

  translateY(n) {
    mat4.translate(this.matrix, this.matrix, vec3.fromValues(0, n, 0))
    return this
  }

  translateZ(n) {
    mat4.translate(this.matrix, this.matrix, vec3.fromValues(0, 0, n))
    return this
  }

  determinant() {
    return mat4.determinant(this.matrix)
  }

  transpose() {
    mat4.transpose(this.matrix, this.matrix)
    return this
  }
}
