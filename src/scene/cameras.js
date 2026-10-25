import * as mat3 from '../math/mat3.js'
import * as mat4 from '../math/mat4.js'
import * as quat from '../math/quat.js'
import { Mat4 } from '../value/Mat4.js'
import { Vec3 } from '../value/Vec3.js'
import { checkNumber, fail } from '../validate.js'
import { NODE_OPTIONS, Node } from './Node.js'

/** @import { NodeOptions } from './Node.js' */
/** @import { Vec3Input } from '../types.js' */

const UP = new Float32Array([0, 1, 0])
const tmp = new Float32Array(16)
const tmp3 = new Float32Array(9)

/**
 * Turn a node to face a target given in its parent's space (the same space as its position).
 * @param {Node} node @param {Vec3} target
 */
export function aimAt(node, target) {
  if (node.position.equals(target, 1e-9)) return
  const dir = target.clone().sub(node.position).normalize()
  const up = Math.abs(dir[1]) > 0.9999 ? [0, 0, -1] : UP
  mat4.targetTo(tmp, node.position, target, up)
  const q = quat.normalize(new Float32Array(4), quat.fromMat3(new Float32Array(4), mat3.fromMat4(tmp3, tmp)))
  node.quaternion.copy(q)
}

/**
 * @typedef {NodeOptions & { near?: number, far?: number, target?: Vec3Input }} CameraOptions
 */

const CAMERA_OPTIONS = [...NODE_OPTIONS, 'near', 'far', 'target', 'aspect']
const CAMERA_HINTS = {
  lookAt: "use target: [x, y, z], or call camera.lookAt(...) after creating it",
  zoom: "move the camera, or change 'fov' (perspective) or 'height' (orthographic)",
}

/** Base for cameras. Cameras look down their local -Z axis. */
export class Camera extends Node {
  static OPTIONS = CAMERA_OPTIONS
  static HINTS = CAMERA_HINTS

  near = 0.1
  far = 1000
  /** Width / height - set by the View to match the canvas. */
  aspect = 1
  /**
   * When set, the camera turns to face it every frame. In the same space as `position` (world
   * space for a camera that isn't parented). Orbit controls use it as their pivot.
   * @type {Vec3 | null}
   */
  target = null

  /** @param {CameraOptions & { aspect?: number }} [options] */
  constructor(options = {}) {
    super(options)
    const owner = this.constructor.name
    if (options.near !== undefined) this.near = checkNumber(owner, 'near', options.near)
    if (options.far !== undefined) this.far = checkNumber(owner, 'far', options.far)
    if (options.aspect !== undefined) this.aspect = checkNumber(owner, 'aspect', options.aspect)
    if (!(this.near > 0) || !(this.far > this.near)) fail(owner, `needs 0 < near < far, got near ${this.near} and far ${this.far}`)
    if (options.target !== undefined) this.target = Vec3.fromInput(options.target, owner)
  }

  updateMatrix() {
    if (this.target) aimAt(this, this.target)
    return super.updateMatrix()
  }

  /** The projection matrix for the current settings. @returns {Mat4} */
  get projectionMatrix() {
    return new Mat4()
  }

  /** The inverse of the world matrix, as of the last update. @returns {Mat4} */
  get viewMatrix() {
    return this.worldMatrix.clone().invert()
  }

  /** @returns {Record<string, unknown>} */
  cloneOptions() {
    return { ...super.cloneOptions(), near: this.near, far: this.far, aspect: this.aspect, ...(this.target ? { target: this.target.toArray() } : {}) }
  }

  /** @returns {Record<string, unknown>} */
  jsonOptions() {
    /** @type {Record<string, unknown>} */
    const json = {}
    if (this.near !== 0.1) json.near = this.near
    if (this.far !== 1000) json.far = this.far
    if (this.target) json.target = this.target.toArray()
    return json
  }
}

/** A camera with perspective: things further away look smaller. */
export class PerspectiveCamera extends Camera {
  static type = 'perspective-camera'
  static get OPTIONS() { return [...CAMERA_OPTIONS, 'fov'] }

  /** Vertical field of view in degrees. */
  fov = 50

  /** @param {CameraOptions & { fov?: number }} [options] */
  constructor(options = {}) {
    super(options)
    if (options.fov !== undefined) {
      this.fov = checkNumber('PerspectiveCamera', 'fov', options.fov)
      if (this.fov <= 0 || this.fov >= 180) fail('PerspectiveCamera', `'fov' is the vertical angle in degrees, 0-180 exclusive, got ${this.fov}`)
    }
  }

  get projectionMatrix() {
    return mat4.perspective(new Mat4(), this.fov * Math.PI / 180, this.aspect, this.near, this.far)
  }

  /** @returns {Record<string, unknown>} */
  cloneOptions() {
    return { ...super.cloneOptions(), fov: this.fov }
  }

  /** @returns {Record<string, unknown>} */
  jsonOptions() {
    return { ...super.jsonOptions(), ...(this.fov !== 50 ? { fov: this.fov } : {}) }
  }
}

/** A camera without perspective: sizes don't change with distance. Isometric views, 2D-ish data viz. */
export class OrthographicCamera extends Camera {
  static type = 'orthographic-camera'
  static get OPTIONS() { return [...CAMERA_OPTIONS, 'height'] }

  /** Height of the view in world units; the width follows the aspect. */
  height = 10

  /** @param {CameraOptions & { height?: number }} [options] */
  constructor(options = {}) {
    super(options)
    if (options.height !== undefined) this.height = checkNumber('OrthographicCamera', 'height', options.height)
  }

  get projectionMatrix() {
    const h = this.height / 2, w = h * this.aspect
    return mat4.ortho(new Mat4(), -w, w, -h, h, this.near, this.far)
  }

  /** @returns {Record<string, unknown>} */
  cloneOptions() {
    return { ...super.cloneOptions(), height: this.height }
  }

  /** @returns {Record<string, unknown>} */
  jsonOptions() {
    return { ...super.jsonOptions(), ...(this.height !== 10 ? { height: this.height } : {}) }
  }
}
