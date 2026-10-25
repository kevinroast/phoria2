import { vec3, vec3FromXYZ, vec3ToXYZ } from '../math.js'
import { BaseEntity } from './BaseEntity.js'
import { Positional } from './Positional.js'

/** @import { BaseEntityDescription, RGB, XYZ } from '../types.js' */
/** @typedef {BaseEntityDescription & { color?: RGB, intensity?: number }} LightDescription */
/** @typedef {'none' | 'linear' | 'squared'} AttenuationFactor */

/** Base for lights. Light colour components are 0-1, unlike material colours. */
export class BaseLight extends BaseEntity {
  /** [r, g, b] 0-1 @type {RGB} */
  color = [1.0, 1.0, 1.0]
  /** Typically 0-1. */
  intensity = 1.0

  /** @param {LightDescription} desc @param {BaseLight} [e] @returns {BaseLight} */
  static create(desc, e = new this()) {
    super.create(desc, e)
    if (desc.color) e.color = desc.color
    if (desc.intensity !== undefined) e.intensity = desc.intensity
    return e
  }
}

/** An infinitely distant light with no position, only the direction its light travels in. */
export class DistantLight extends BaseLight {
  /** Normalised direction the light travels in. @type {XYZ} */
  direction = { x: 0, y: 0, z: 1 }
  /** Points back towards the light, as used by the lighting calculations. @type {Float32Array | null} */
  worlddirection = null

  constructor() {
    super()
    this.onScene(this.transformToScene)
  }

  /** @param {LightDescription & { direction?: XYZ }} desc @param {DistantLight} [e] @returns {DistantLight} */
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

/**
 * A light at a position that shines equally in all directions, falling off with distance:
 * attenuationFactor 'none' (constant), 'linear' (distance) or 'squared' (distance squared).
 */
export class PointLight extends Positional(BaseLight) {
  position = { x: 0, y: 0, z: -1 }
  attenuation = 0.1
  /** @type {AttenuationFactor} */
  attenuationFactor = 'linear'

  constructor() {
    super()
    this.onScene(this.transformToScene)
  }

  /**
   * @param {LightDescription & { position?: XYZ, attenuation?: number, attenuationFactor?: AttenuationFactor }} desc
   * @param {PointLight} [e]
   * @returns {PointLight}
   */
  static create(desc, e = new this()) {
    super.create(desc, e)
    if (desc.position) e.position = desc.position
    if (desc.attenuation) e.attenuation = desc.attenuation
    if (desc.attenuationFactor) e.attenuationFactor = desc.attenuationFactor
    return e
  }

  /** @type {import('../types.js').SceneHandler} */
  transformToScene(scene, matLocal) {
    this.updatePosition(matLocal)
  }
}
