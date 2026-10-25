import { vec3FromXYZ } from '../math.js'
import { Entity } from './Entity.js'
import { Positional } from './Positional.js'

// Very basic physics: a velocity changed by impulse and constant forces and optionally gravity,
// applied to the entity matrix each frame.
export class PhysicsEntity extends Positional(Entity) {
  static GRAVITY = { x: 0, y: -9.8, z: 0 }

  // {x,y,z} current velocity
  velocity = { x: 0, y: 0, z: 0 }
  // true to apply PhysicsEntity.GRAVITY each frame
  gravity = true
  _force = { x: 0, y: 0, z: 0 }
  _acceleration = null

  constructor() {
    super()
    this.onBeforeScene(this.applyPhysics)
    this.onScene(this.transformToScene)
  }

  // Entity options plus { velocity, position, force, gravity }. Position is informational
  // (for scene callbacks etc.) not render data.
  static create(desc, e = new this()) {
    super.create(desc, e)
    if (desc.velocity) e.velocity = desc.velocity
    if (desc.position) e.position = desc.position
    if (desc.force) e._force = desc.force
    if (desc.gravity !== undefined) e.gravity = desc.gravity
    return e
  }

  // One-off force {x,y,z}, applied on the next frame only.
  impulse(f) {
    this._acceleration = f
  }

  // Constant force {x,y,z}, applied every frame.
  force(f) {
    this._force = f
  }

  applyPhysics() {
    // fixed 60fps timestep regardless of real frame rate, to avoid glitches on slow frames
    const time = 1 / 60
    const tt = time * time
    const v = this.velocity
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

  transformToScene(scene, matLocal) {
    this.updatePosition(matLocal)
  }
}
