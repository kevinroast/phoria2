import { mat4, mat4FromYPR, vec3 } from '../math.js'

/** @import { BaseEntityDescription, BeforeSceneHandler, SceneHandler } from '../types.js' */
/** @typedef {Float32Array | number[]} Vec3Like */

/**
 * Base for everything in the scene graph: a model matrix with chainable operations, a list of
 * child entities that inherit the matrix, and per-frame scene event handlers.
 *
 * Matrix operations post-multiply, so a chain applies in the entity's own frame:
 * `e.translateX(3).rotateY(a)` rotates about the entity's (translated) origin.
 */
export class BaseEntity {
  /** Optional unique id - lets trigger handlers find an entity via scene.findEntity(). @type {string | null} */
  id = null
  /** Model matrix applied during scene processing. @type {Float32Array} */
  matrix = mat4.create()
  /** Children are transformed by this entity's matrix, and can have children of their own. @type {BaseEntity[]} */
  children = []
  /** True to skip this entity and all its children during scene processing. */
  disabled = false
  /** @type {BeforeSceneHandler[]} */
  onBeforeSceneHandlers = []
  /** @type {SceneHandler[]} */
  onSceneHandlers = []

  /**
   * Create an entity from an object literal description.
   * @param {BaseEntityDescription} desc
   * @param {BaseEntity} [e] instance to apply the description to - subclasses pass their own
   * @returns {BaseEntity}
   */
  static create(desc, e = new this()) {
    if (desc.id) e.id = desc.id
    if (desc.matrix) e.matrix = desc.matrix
    if (desc.children) e.children = desc.children
    if (desc.onBeforeScene) e.onBeforeScene(desc.onBeforeScene)
    if (desc.onScene) e.onScene(desc.onScene)
    if (desc.disabled !== undefined) e.disabled = desc.disabled
    return e
  }

  /**
   * Called each frame before the matrix is combined with the parent's.
   * @param {BeforeSceneHandler | BeforeSceneHandler[]} fn
   * @returns {this}
   */
  onBeforeScene(fn) {
    this.onBeforeSceneHandlers = this.onBeforeSceneHandlers.concat(fn)
    return this
  }

  /**
   * Called each frame after the matrix is combined with the parent's.
   * @param {SceneHandler | SceneHandler[]} fn
   * @returns {this}
   */
  onScene(fn) {
    this.onSceneHandlers = this.onSceneHandlers.concat(fn)
    return this
  }

  /** @returns {this} */
  identity() {
    mat4.identity(this.matrix)
    return this
  }

  /** @returns {this} */
  invert() {
    mat4.invert(this.matrix, this.matrix)
    return this
  }

  /** @param {Float32Array | number[]} m @returns {this} */
  multiply(m) {
    mat4.multiply(this.matrix, this.matrix, m)
    return this
  }

  /** @param {Vec3Like} vec per-axis scale @returns {this} */
  scale(vec) {
    mat4.scale(this.matrix, this.matrix, vec)
    return this
  }

  /** Uniform scale. @param {number} n @returns {this} */
  scaleN(n) {
    mat4.scale(this.matrix, this.matrix, vec3.fromValues(n, n, n))
    return this
  }

  /** @param {number} rad @param {Vec3Like} axis @returns {this} */
  rotate(rad, axis) {
    mat4.rotate(this.matrix, this.matrix, rad, axis)
    return this
  }

  /** @param {number} rad @returns {this} */
  rotateX(rad) {
    mat4.rotateX(this.matrix, this.matrix, rad)
    return this
  }

  /** @param {number} rad @returns {this} */
  rotateY(rad) {
    mat4.rotateY(this.matrix, this.matrix, rad)
    return this
  }

  /** @param {number} rad @returns {this} */
  rotateZ(rad) {
    mat4.rotateZ(this.matrix, this.matrix, rad)
    return this
  }

  /**
   * Rotate by yaw (heading), pitch (elevation) and roll (bank) Euler angles in radians.
   * @param {number} yaw @param {number} pitch @param {number} roll
   * @returns {this}
   */
  rotateYPR(yaw, pitch, roll) {
    mat4.multiply(this.matrix, this.matrix, mat4FromYPR(yaw, pitch, roll))
    return this
  }

  /** @param {Vec3Like} vec @returns {this} */
  translate(vec) {
    mat4.translate(this.matrix, this.matrix, vec)
    return this
  }

  /** @param {number} n @returns {this} */
  translateX(n) {
    mat4.translate(this.matrix, this.matrix, vec3.fromValues(n, 0, 0))
    return this
  }

  /** @param {number} n @returns {this} */
  translateY(n) {
    mat4.translate(this.matrix, this.matrix, vec3.fromValues(0, n, 0))
    return this
  }

  /** @param {number} n @returns {this} */
  translateZ(n) {
    mat4.translate(this.matrix, this.matrix, vec3.fromValues(0, 0, n))
    return this
  }

  /** @returns {number} */
  determinant() {
    return mat4.determinant(this.matrix)
  }

  /** @returns {this} */
  transpose() {
    mat4.transpose(this.matrix, this.matrix)
    return this
  }
}
