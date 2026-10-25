import { vec4, vec4FromXYZ } from '../math.js'

/** @import { XYZ } from '../types.js' */

/**
 * Mixin for entities that represent a position in the scene without necessarily being rendered
 * (lights, emitters, physics objects). After scene processing `worldposition` holds the position
 * transformed into world space - check it is not null before use.
 * @template {new (...args: any[]) => object} TBase
 * @param {TBase} Base
 */
export const Positional = (Base) => class extends Base {
  /** Position in local space. @type {XYZ} */
  position = { x: 0, y: 0, z: 0 }
  /** World space position [x, y, z, 1], updated each frame. @type {Float32Array | null} */
  worldposition = null

  /** @param {Float32Array | null} matLocal */
  updatePosition(matLocal) {
    const vec = vec4FromXYZ(this.position, 1)
    if (matLocal) vec4.transformMat4(vec, vec, matLocal)
    this.worldposition = vec
  }
}
