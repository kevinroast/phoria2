import { vec3FromXYZ } from '../math.js'
import { Entity } from '../entity/Entity.js'
import { Positional } from '../entity/Positional.js'

/** @import { EntityDescription, XYZ } from '../types.js' */

/**
 * Very basic physics: a velocity changed by impulse and constant forces and optionally gravity,
 * applied to the entity matrix each frame.
 */
export class PhysicsEntity extends Positional(Entity) {
  /** @type {XYZ} */
  static GRAVITY = { x: 0, y: -9.8, z: 0 }

  /** @type {XYZ} */
  velocity = { x: 0, y: 0, z: 0 }
  /** True to apply PhysicsEntity.GRAVITY each frame. */
  gravity = true
  /** Expiry time (as Date.now()) for emitted particles, 0 for none. */
  _gravetime = 0
  /** @type {XYZ | null} */
  _force = { x: 0, y: 0, z: 0 }
  /** @type {XYZ | null} */
  _acceleration = null

  constructor() {
    super()
    this.onBeforeScene(this.applyPhysics)
    this.onScene(this.transformToScene)
  }

  /**
   * Entity options plus velocity, position, force and gravity. Position is informational (for scene
   * callbacks etc.), not render data.
   * @param {EntityDescription & { velocity?: XYZ, position?: XYZ, force?: XYZ, gravity?: boolean }} desc
   * @param {PhysicsEntity} [e]
   * @returns {PhysicsEntity}
   */
  static create(desc, e = new this()) {
    super.create(desc, e)
    if (desc.velocity) e.velocity = desc.velocity
    if (desc.position) e.position = desc.position
    if (desc.force) e._force = desc.force
    if (desc.gravity !== undefined) e.gravity = desc.gravity
    return e
  }

  /** A one-off force, applied on the next frame only. @param {XYZ} f */
  impulse(f) {
    this._acceleration = f
  }

  /** A constant force, applied every frame. @param {XYZ} f */
  force(f) {
    this._force = f
  }

  applyPhysics() {
    // fixed 60fps timestep regardless of real frame rate, to avoid glitches on slow frames
    const time = 1 / 60
    const tt = time * time
    const v = this.velocity
    /** @param {XYZ} f */
    const addForce = (f) => {
      v.x += f.x * tt
      v.y += f.y * tt
      v.z += f.z * tt
    }
    if (this._acceleration) {
      addForce(this._acceleration)
      this._acceleration = null
    }
    if (this._force) addForce(this._force)
    if (this.gravity) addForce(PhysicsEntity.GRAVITY)
    this.translate(vec3FromXYZ(v))
  }

  /** @param {unknown} scene @param {Float32Array} matLocal */
  transformToScene(scene, matLocal) {
    this.updatePosition(matLocal)
  }
}
