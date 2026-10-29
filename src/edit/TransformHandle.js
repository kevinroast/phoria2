// A move and turn handle for editors: arrows to slide what is selected along an axis, a disc to
// slide it freely across the floor, and a ring round it to turn it - drawn over everything, the
// same size on screen however far away, snapping to a grid and to angles, and recording undo.
import { Group } from '../scene/Node.js'
import { Mesh } from '../scene/drawables.js'
import { Quat } from '../value/Quat.js'
import { Vec3 } from '../value/Vec3.js'
import { cylinder, torus } from '../geometry/generators.js'
import { checkNumber, checkOneOf, checkOptions, describe, fail } from '../validate.js'

/** @import { Node, Drag } from '../scene/Node.js' */
/** @import { History } from './History.js' */
/** @import { View } from '../View.js' */

/**
 * A move or turn the handle proposes, for constrain() to check: where the target would be, and
 * its turn about the vertical.
 * @typedef {{ position: Vec3, rotation: number }} Placement
 */

/**
 * @typedef {object} TransformHandleOptions
 * @property {View} view the view it is used in - it adds itself to the view's scene
 * @property {Node | null} [target] what it moves; change it later with handle.target
 * @property {'xz' | 'xyz' | false} [move] which ways it moves things: across the floor (default), up and down too, or not at all
 * @property {boolean} [turn] a ring to turn things about the vertical (default true)
 * @property {{ move?: number, turn?: number } | null} [snap] snap positions to a grid of this spacing, and turns to steps of
 *   this many radians (default none)
 * @property {number} [size] how big it is on screen, in pixels across its ring (default 120); it grows to go round a big target
 * @property {boolean} [dragTarget] drag the target itself across the floor too, as well as by the handle (default true)
 * @property {History | null} [history] record each move and turn here, for undo (default none)
 * @property {((placement: Placement, target: Node) => Placement | null | void) | null} [constrain] check a move or turn before it
 *   happens: return a changed placement (kept inside a room, out of other things), null to refuse it, or nothing to allow it
 * @property {((target: Node, phase: 'start' | 'move' | 'end') => void) | null} [onChange] told as the target is moved or turned
 */

export const HANDLE_OPTIONS = ['view', 'target', 'move', 'turn', 'snap', 'size', 'dragTarget', 'history', 'constrain', 'onChange']
export const HANDLE_HINTS = {
  object: "use 'target'",
  mode: "use 'move' ('xz', 'xyz' or false) and 'turn' (true or false)",
  rotate: "use 'turn' - a ring for turning about the vertical",
  translate: "use 'move': 'xz', 'xyz' or false",
  translationSnap: "use snap: { move, turn }",
  rotationSnap: "use snap: { move, turn }",
  onDrag: "use 'onChange': (target, phase) => ...",
}

const COLOURS = { x: '#ff5a52', y: '#5ad07a', z: '#4f8cff', ring: '#ffcc33', disc: '#f2f2f2' }
// drawn after everything, over it
const ON_TOP = 100000

export class TransformHandle {
  /** The handle's own nodes, in the view's scene. */
  node = new Group({ name: 'transform-handle', highlight: '#ffffff' })
  /** @type {'xz' | 'xyz' | false} */ move = 'xz'
  turn = true
  /** @type {{ move: number, turn: number } | null} */ snap = null
  size = 120
  dragTarget = true
  /** @type {History | null} */ history = null
  /** @type {((placement: Placement, target: Node) => Placement | null | void) | null} */ constrain = null
  /** @type {((target: Node, phase: 'start' | 'move' | 'end') => void) | null} */ onChange = null

  /** @type {View} */ #view
  /** @type {Node | null} */ #target = null
  /** The node whose onDrag the handle took over, and that onDrag, to give back. @type {{ node: Node, onDrag: ((drag: Drag) => void) | null } | null} */ #taken = null
  /** @type {Record<string, Mesh>} */ #parts = {}
  /** Where the target was as a drag began, and the undo it will record. @type {{ position: Vec3, rotation: number, quaternion: Quat, angle: number, done: ((label?: string) => boolean) | null } | null} */ #from = null

  /** @param {TransformHandleOptions} options */
  constructor(options) {
    checkOptions('TransformHandle', options, HANDLE_OPTIONS, HANDLE_HINTS)
    if (!options?.view?.scene) fail('TransformHandle', "'view' is required - the View it is used in")
    this.#view = options.view
    if (options.move !== undefined) this.move = options.move === false ? false : /** @type {'xz' | 'xyz'} */ (checkOneOf('TransformHandle', 'move', options.move, ['xz', 'xyz']))
    if (options.turn !== undefined) this.turn = bool('turn', options.turn)
    if (options.dragTarget !== undefined) this.dragTarget = bool('dragTarget', options.dragTarget)
    if (options.size !== undefined) {
      this.size = checkNumber('TransformHandle', 'size', options.size)
      if (!(this.size > 0)) fail('TransformHandle', `'size' is in pixels, above 0, got ${this.size}`)
    }
    if (options.snap != null) {
      checkOptions('TransformHandle', options.snap, ['move', 'turn'], {}, 'snap')
      const step = (k) => {
        const v = options.snap?.[k]
        if (v === undefined) return 0
        if (typeof v !== 'number' || !(v >= 0)) fail('TransformHandle', `'snap.${k}' must be a step of 0 or more, got ${describe(v)}`)
        return v
      }
      this.snap = { move: step('move'), turn: step('turn') }
    }
    for (const key of ['constrain', 'onChange']) {
      const fn = options[key]
      if (fn == null) continue
      if (typeof fn !== 'function') fail('TransformHandle', `'${key}' must be a function, got ${describe(fn)}`)
      this[key] = fn
    }
    if (options.history != null) {
      if (typeof options.history.transform !== 'function') fail('TransformHandle', `'history' must be a History, got ${describe(options.history)}`)
      this.history = options.history
    }
    this.#build()
    this.node.visible = false
    this.node.onUpdate(() => this.#follow())
    this.#view.scene.add(this.node)
    if (options.target != null) this.target = options.target
  }

  /** What the handle moves, or null to hide it. @returns {Node | null} */
  get target() { return this.#target }
  /** @param {Node | null} node */
  set target(node) {
    if (node === this.#target) return
    // give back the old target's own drag - whatever dragTarget says now
    if (this.#taken) this.#taken.node.onDrag = this.#taken.onDrag
    this.#taken = null
    this.#target = node ?? null
    this.node.visible = !!node
    if (node && this.dragTarget) {
      this.#taken = { node, onDrag: node.onDrag }
      node.onDrag = (drag) => this.#drag('free', drag)
    }
    if (node) this.#follow()
    this.#view.invalidate()
  }

  /** Take the handle out of the scene, giving the target back its own drag. */
  dispose() {
    this.target = null
    this.node.removeFromParent()
  }

  #build() {
    const material = (color) => ({ color, unlit: true, depthTest: false, depthWrite: false, opacity: 0.95 })
    /** @param {string} name @param {any} geometry @param {string} color @param {number[]} [position] @param {any} [part] */
    const add = (name, geometry, color, position = [0, 0, 0], part = name) => {
      const mesh = this.node.add(new Mesh({ name, geometry, material: material(color), position, renderOrder: ON_TOP, castShadow: false }))
      mesh.onDrag = (drag) => this.#drag(part, drag)
      this.#parts[name] = mesh
      return mesh
    }
    // the ring round it, for turning
    add('ring', torus({ radius: 1, tube: 0.035, segments: 72, tubeSegments: 8 }), COLOURS.ring)
    // arrows out beyond the ring along each way it moves, and a disc in the middle to move it freely
    const arrow = (axis, color) => {
      const along = (d) => /** @type {number[]} */ (axis === 'x' ? [d, 0, 0] : axis === 'y' ? [0, d, 0] : [0, 0, d])
      add(`${axis}-shaft`, cylinder({ radius: 0.035, height: 0.4, segments: 10, axis }), color, along(1.3), axis)
      add(`${axis}-tip`, cylinder({ radius: 0.1, radiusTop: 0, height: 0.22, segments: 16, axis }), color, along(1.6), axis)
    }
    arrow('x', COLOURS.x)
    arrow('z', COLOURS.z)
    arrow('y', COLOURS.y)
    add('disc', cylinder({ radius: 0.16, height: 0.02, segments: 32 }), COLOURS.disc, [0, 0, 0], 'free')
  }

  // sit on the target, the same size on screen at any distance - but always round it
  #follow() {
    const target = this.#target
    if (!target) return
    for (const [name, mesh] of Object.entries(this.#parts)) {
      const axis = name[0]
      mesh.visible = name === 'ring' ? this.turn : name === 'disc' ? !!this.move : !!this.move && (axis !== 'y' || this.move === 'xyz')
    }
    target.updateWorld()
    const at = target.worldPosition
    this.node.position.copy(at)
    const view = this.#view, cam = /** @type {any} */ (view.camera)
    const height = view.canvas.clientHeight || 1
    const perPixel = cam.constructor.type === 'orthographic-camera' ? cam.height / height
      : 2 * cam.position.distanceTo(at) * Math.tan(cam.fov * Math.PI / 360) / height
    // round the target's footprint, at least
    const box = target.bounds, size = box.isEmpty() ? 0 : Math.hypot(box.max[0] - box.min[0], box.max[2] - box.min[2]) / 2
    const r = Math.max(this.size / 2 * perPixel, size * 1.1)
    this.node.scale.set(r, r, r)
  }

  /** @param {'x' | 'y' | 'z' | 'free' | 'ring'} part @param {Drag} drag */
  #drag(part, drag) {
    const target = this.#target
    if (!target) return
    if (drag.phase === 'start') {
      const center = target.worldPosition
      // up and down: across an upright plane facing the camera
      if (part === 'y') {
        const eye = this.#view.camera.position
        const facing = new Vec3(eye[0] - center[0], 0, eye[2] - center[2])
        drag.plane = { normal: facing.len() > 1e-6 ? facing.normalize() : new Vec3(0, 0, 1), point: center.clone() }
      } else {
        // the rest across the floor the target stands on
        drag.plane = { normal: new Vec3(0, 1, 0), point: center.clone() }
      }
      const start = drag.ray.intersectPlane(drag.plane.normal, drag.plane.point)
      const p = start !== null ? drag.ray.at(start) : center
      this.#from = {
        position: target.position.clone(), rotation: yawOf(target.quaternion), quaternion: target.quaternion.clone(),
        angle: Math.atan2(p[2] - center[2], p[0] - center[0]),
        done: this.history ? this.history.transform(target) : null,
      }
      this.onChange?.(target, 'start')
      return
    }
    const from = this.#from
    if (!from) return
    if (drag.phase === 'end') {
      from.done?.(part === 'ring' ? 'Turn' : 'Move')
      this.#from = null
      this.onChange?.(target, 'end')
      return
    }
    if (!drag.point) return
    const proposal = { position: from.position.clone(), rotation: from.rotation }
    if (part === 'ring') {
      const center = this.node.position
      const angle = Math.atan2(drag.point[2] - center[2], drag.point[0] - center[0])
      // turning anticlockwise seen from above is a positive turn about y, which runs the other way to the angle in x, z
      let turn = from.rotation - (angle - from.angle)
      if (this.snap?.turn) turn = Math.round(turn / this.snap.turn) * this.snap.turn
      proposal.rotation = turn
    } else {
      const d = drag.delta
      const move = part === 'x' ? [d[0], 0, 0] : part === 'z' ? [0, 0, d[2]] : part === 'y' ? [0, d[1], 0] : [d[0], 0, d[2]]
      proposal.position.add(move)
      const step = this.snap?.move
      if (step) {
        // snap only the axes this drag moves, so the others stay where they were
        for (let k = 0; k < 3; k++) if (move[k] !== 0) proposal.position[k] = Math.round(proposal.position[k] / step) * step
      }
    }
    const result = this.constrain ? this.constrain(proposal, target) : proposal
    if (result === null) return
    const placed = /** @type {Placement} */ (result ?? proposal)
    target.position.copy(placed.position)
    // the turn about the vertical since the drag began, before the rotation it began with - so a
    // yaw past 90 degrees, or a tilt, comes through as it was
    const turned = new Quat().setFromAxisAngle([0, 1, 0], placed.rotation - from.rotation)
    target.quaternion.copy(turned.multiply(from.quaternion))
    this.#follow()
    this.onChange?.(target, 'move')
  }
}

/**
 * Which way a rotation faces about the vertical, in radians: where it turns the x axis. Euler y
 * can't say - a quaternion read back as Euler angles gives y between -90 and 90 degrees, with x and z
 * flipped to make up the rest.
 * @param {Quat} q
 * @returns {number}
 */
function yawOf(q) {
  const [x, y, z, w] = q
  // the rotated x axis, (1 - 2(y² + z²), 2(xy + zw), 2(xz - yw)), seen from above
  return Math.atan2(-2 * (x * z - y * w), 1 - 2 * (y * y + z * z))
}

/** @param {string} name @param {unknown} v */
function bool(name, v) {
  if (typeof v !== 'boolean') fail('TransformHandle', `'${name}' must be true or false, got ${describe(v)}`)
  return v
}
