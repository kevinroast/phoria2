import { vec3 } from 'gl-matrix'
import { vec3FromXYZ, vec3ToXYZ } from '../math.js'
import { BaseEntity } from './BaseEntity.js'
import { Positional } from './Positional.js'

// Base for lights. Note light colour components are 0.0-1.0, unlike material colours.
export class BaseLight extends BaseEntity {
  // [r,g,b] 0-1
  color = [1.0, 1.0, 1.0]
  // typically 0-1
  intensity = 1.0

  static create(desc, e = new this()) {
    super.create(desc, e)
    if (desc.color) e.color = desc.color
    if (desc.intensity !== undefined) e.intensity = desc.intensity
    return e
  }
}

// An infinitely distant light with no position, only a direction the light travels in.
export class DistantLight extends BaseLight {
  // normalised {x,y,z}
  direction = { x: 0, y: 0, z: 1 }
  // vec3 pointing back towards the light, as used by the lighting calculations
  worlddirection = null

  constructor() {
    super()
    this.onScene(this.transformToScene)
  }

  // { color, intensity, direction } plus BaseEntity options
  static create(desc, e = new this()) {
    super.create(desc, e)
    if (desc.direction) {
      const d = vec3FromXYZ(desc.direction)
      e.direction = vec3ToXYZ(vec3.normalize(d, d))
    }
    return e
  }

  transformToScene() {
    this.worlddirection = vec3.fromValues(-this.direction.x, -this.direction.y, -this.direction.z)
  }
}

// A light at a position that shines equally in all directions, falling off with distance:
// attenuationFactor 'none' (constant), 'linear' (distance) or 'squared' (distance squared).
export class PointLight extends Positional(BaseLight) {
  position = { x: 0, y: 0, z: -1 }
  attenuation = 0.1
  attenuationFactor = 'linear'

  constructor() {
    super()
    this.onScene(this.transformToScene)
  }

  // { position, color, intensity, attenuation, attenuationFactor } plus BaseEntity options
  static create(desc, e = new this()) {
    super.create(desc, e)
    if (desc.position) e.position = desc.position
    if (desc.attenuation) e.attenuation = desc.attenuation
    if (desc.attenuationFactor) e.attenuationFactor = desc.attenuationFactor
    return e
  }

  transformToScene(scene, matLocal) {
    this.updatePosition(matLocal)
  }
}
