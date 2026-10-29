import * as mat3 from '../math/mat3.js'
import * as mat4 from '../math/mat4.js'
import * as quat from '../math/quat.js'
import { Box3 } from '../value/Box3.js'
import { Color } from '../value/Color.js'
import { Euler } from '../value/Euler.js'
import { Mat4 } from '../value/Mat4.js'
import { Quat } from '../value/Quat.js'
import { Vec3 } from '../value/Vec3.js'
import { checkOptions, describe, fail } from '../validate.js'
import { Clip } from '../clip.js'

/** @import { ColorInput, Vec3Input } from '../types.js' */
/** @import { Hit } from '../Raycaster.js' */
/** @import { Camera } from './cameras.js' */
/** @import { ClipOptions } from '../clip.js' */
/** @import { Ray } from '../value/Ray.js' */

/**
 * A drag in progress, given to onDrag handlers: 'start' once the pointer has moved off where it
 * was pressed, 'move' as it moves, 'end' when it lets go.
 * @typedef {object} Drag
 * @property {'start' | 'move' | 'end'} phase
 * @property {Hit} hit what was pressed
 * @property {Node} node the node whose handler this is (the hit's, or the nearest above it with one)
 * @property {Ray} ray the pointer's ray now, in world space
 * @property {{ normal: Vec3, point: Vec3 }} plane what it is dragged across - horizontal through the
 *   pressed point unless the handler sets another at 'start'
 * @property {Vec3} start where the drag began on the plane
 * @property {Vec3 | null} point where the pointer is on the plane now (null if it has left the plane, as at the horizon)
 * @property {Vec3} delta point - start (the last good point's, when it has left the plane)
 * @property {PointerEvent} event
 */

/** @typedef {{ color: Color, width: number }} Outline */

/**
 * Per-frame behaviour: `(node, dt, t) => void`, with dt and t in seconds.
 * @typedef {(node: any, dt: number, t: number) => void} UpdateHandler
 */

/**
 * @typedef {object} NodeOptions
 * @property {string} [name]
 * @property {Vec3Input} [position]
 * @property {Vec3Input | Euler} [rotation] Euler angles in radians, XYZ order
 * @property {ArrayLike<number>} [quaternion] [x, y, z, w] - instead of rotation
 * @property {Vec3Input | number} [scale] a number scales uniformly
 * @property {boolean} [visible]
 * @property {boolean} [pickable] include in view.pick() (default true)
 * @property {boolean} [matrixAutoUpdate] recompose the local matrix each frame (default true)
 * @property {Node[]} [children]
 * @property {Record<string, unknown>} [userData] anything of your own
 * @property {UpdateHandler | UpdateHandler[]} [onUpdate]
 * @property {((hit: Hit) => any) | null} [tooltip] tooltip for anything picked in this subtree; nearer nodes win, and
 *   all win over the View's
 * @property {ColorInput | null} [highlight] hover tint for this subtree, over the View's
 * @property {boolean} [highlightWhole] hovering any part of this subtree tints all of it, as one thing - a
 *   piece of furniture, a machine - rather than just the part under the pointer (default false)
 * @property {((hit: Hit | null) => void) | null} [onHover] called as the thing under the pointer in this subtree changes
 *   (null when it leaves the subtree)
 * @property {((hit: Hit) => void) | null} [onClick] called when something in this subtree is clicked
 * @property {((camera: Camera) => boolean) | null} [showFrom] draw this subtree only for cameras this returns true for
 * @property {((drag: Drag) => void) | null} [onDrag] drag this subtree with the pointer: called as a drag starts, moves and ends
 *   (the camera stays still meanwhile); a press without a drag still clicks
 * @property {ColorInput | { color?: ColorInput, width?: number } | null} [outline] draw a line round this subtree's silhouette, on top of
 *   everything - for selection. A colour, or { color, width } with width in pixels (default 2)
 * @property {ClipOptions | Clip | null} [clip] cut away everything in this subtree on one side of a plane in this
 *   node's space - for cutaways. The nearest clip above a mesh is the one that cuts it
 */

export const NODE_OPTIONS = ['name', 'position', 'rotation', 'quaternion', 'scale', 'visible', 'pickable',
  'matrixAutoUpdate', 'children', 'userData', 'onUpdate', 'tooltip', 'highlight', 'highlightWhole', 'onHover', 'onClick', 'showFrom', 'clip', 'onDrag', 'outline']

// three.js habits that would otherwise fail with a plain "unknown option"
export const NODE_HINTS = {
  rotationX: "use rotation: [x, y, z] (radians)",
  scaleX: 'use scale: [x, y, z] or a single number',
  translate: "use position: [x, y, z]",
  parent: 'add the node to its parent instead: parent.add(node)',
  type: "'type' is only used in descriptions passed to create() or add()",
  clippingPlanes: 'use clip: { normal, offset, cap } - one plane, cutting this node and everything under it',
  draggable: 'give the node an onDrag handler: onDrag: (drag) => { ... }',
  onDragStart: "use onDrag - drag.phase is 'start', 'move' or 'end'",
  onDragEnd: "use onDrag - drag.phase is 'start', 'move' or 'end'",
  selected: "outline what's selected: node.outline = '#ffcc00'",
}

const UP = new Float32Array([0, 1, 0])
const tmpMat = new Float32Array(16)
const tmpMat3 = new Float32Array(9)

/** The base of everything in a scene: a transform (position, rotation, scale) and children. */
export class Node {
  /** The description type, used by create() and toJSON(). */
  static type = 'node'
  /**
   * The options it takes, and hints for names people reach for instead. A subclass with options of
   * its own adds to its parent's: static get OPTIONS() { return [...super.OPTIONS, 'blink'] }
   * @type {string[]}
   */
  static OPTIONS = NODE_OPTIONS
  /** @type {Record<string, string>} */
  static HINTS = NODE_HINTS

  name = ''
  /** @type {Vec3} */ position = new Vec3()
  /** @type {Vec3} */ scale = new Vec3(1, 1, 1)
  /** Kept in sync with `rotation`. @type {Quat} */ quaternion = new Quat()
  /** Euler angles in radians, XYZ order; kept in sync with `quaternion`. @type {Euler} */ rotation = new Euler()
  visible = true
  /** Include in picking. */
  pickable = true
  /** Recompose the local matrix from position/rotation/scale each frame. */
  matrixAutoUpdate = true
  /** Local transform. @type {Mat4} */ matrix = new Mat4()
  /** Read only: parent's world matrix x local matrix, as of the last update. @type {Mat4} */
  worldMatrix = new Mat4()
  /** Anything of your own; copied by clone() and kept in toJSON() when it is plain data. */
  userData = {}
  /** Tooltip for anything picked in this subtree (nearest wins, over the View's). @type {((hit: Hit) => any) | null} */
  tooltip = null
  /** Called as the thing under the pointer in this subtree changes; null when it leaves. @type {((hit: Hit | null) => void) | null} */
  onHover = null
  /** Called when something in this subtree is clicked. @type {((hit: Hit) => void) | null} */
  onClick = null
  /** Draw this subtree only for cameras this returns true for - per frame, without changing the scene. @type {((camera: Camera) => boolean) | null} */
  showFrom = null
  /** An HTML element shown over the canvas while this node is drawn (a chart's legend). @type {HTMLElement | null} */
  overlay = null
  /** @type {Clip | null} */
  #clip = null
  /** Called as the pointer drags this subtree: see Drag. @type {((drag: Drag) => void) | null} */
  onDrag = null
  /** @type {Outline | null} */
  #outline = null
  /** @type {Color | null} */
  #highlight = null
  /** Hovering any part of this subtree tints all of it, not just the part under the pointer. */
  highlightWhole = false

  /** @type {Node | null} */
  #parent = null
  /** @type {Node[]} */
  #children = []
  /** @type {UpdateHandler[]} */
  #handlers = []

  /** @param {NodeOptions} [options] */
  constructor(options = {}) {
    const Class = /** @type {typeof Node & { OPTIONS?: string[], HINTS?: Record<string, string> }} */ (new.target)
    checkOptions(Class.name, options, Class.OPTIONS, { ...NODE_HINTS, ...Class.HINTS })
    this.rotation.onChange = () => quat.fromEulerXYZ(this.quaternion, this.rotation.x, this.rotation.y, this.rotation.z)
    this.quaternion.onChange = () => this.rotation.setFromQuat(this.quaternion)

    const owner = Class.name
    if (options.name !== undefined) this.name = String(options.name)
    if (options.position !== undefined) this.position.copy(options.position, owner)
    if (options.rotation !== undefined) this.rotation.copy(/** @type {any} */ (options.rotation), owner)
    if (options.quaternion !== undefined) this.quaternion.copy(options.quaternion, owner).normalize()
    if (options.scale !== undefined) this.scale.copy(options.scale, owner)
    if (options.visible !== undefined) this.visible = !!options.visible
    if (options.pickable !== undefined) this.pickable = !!options.pickable
    if (options.matrixAutoUpdate !== undefined) this.matrixAutoUpdate = !!options.matrixAutoUpdate
    if (options.userData !== undefined) this.userData = options.userData
    if (options.onUpdate) [options.onUpdate].flat().forEach((fn) => this.onUpdate(fn))
    for (const key of ['tooltip', 'onHover', 'onClick', 'showFrom', 'onDrag']) {
      const fn = options[key]
      if (fn === undefined || fn === null) continue
      if (typeof fn !== 'function') fail(owner, `'${key}' must be a function, got ${describe(fn)}`)
      this[key] = fn
    }
    if (options.highlight != null) this.#highlight = Color.fromInput(options.highlight, owner)
    if (options.highlightWhole !== undefined) {
      if (typeof options.highlightWhole !== 'boolean') fail(owner, `'highlightWhole' must be true or false, got ${describe(options.highlightWhole)}`)
      this.highlightWhole = options.highlightWhole
    }
    if (options.clip != null) this.#clip = Clip.fromInput(options.clip, owner)
    if (options.outline != null) this.#setOutline(options.outline)
    if (options.children) for (const child of options.children) this.add(child)
  }

  /** Hover tint for this subtree, over the View's; set any colour, or null. @returns {Color | null} */
  get highlight() {
    return this.#highlight
  }

  /** @param {ColorInput | null} value */
  set highlight(value) {
    this.#highlight = value == null ? null : Color.fromInput(value, this.constructor.name)
  }

  /**
   * The section plane cutting this subtree, or null. Set { normal, offset, cap }, a Clip or null;
   * move the cut by changing its offset or normal in place.
   * @returns {Clip | null}
   */
  get clip() {
    return this.#clip
  }

  /** @param {ClipOptions | Clip | null} value */
  set clip(value) {
    this.#clip = value == null ? null : Clip.fromInput(value, this.constructor.name)
  }

  /**
   * A line round this subtree's silhouette, drawn over everything - for showing what is selected -
   * or null. Set a colour, { color, width } (pixels, default 2) or null.
   * @returns {Outline | null}
   */
  get outline() {
    return this.#outline
  }

  /** @param {ColorInput | { color?: ColorInput, width?: number } | null} value */
  set outline(value) {
    this.#setOutline(value)
  }

  /** @param {ColorInput | { color?: ColorInput, width?: number } | null} value */
  #setOutline(value) {
    const owner = this.constructor.name
    if (value == null) {
      this.#outline = null
      return
    }
    const options = typeof value === 'object' && !Array.isArray(value) && !ArrayBuffer.isView(value) && !(value instanceof Color)
      ? /** @type {{ color?: ColorInput, width?: number }} */ (value) : { color: /** @type {ColorInput} */ (value) }
    checkOptions(owner, options, ['color', 'width'], {}, 'outline')
    const width = options.width ?? 2
    if (typeof width !== 'number' || !(width > 0) || width > 8) fail(owner, `'outline.width' is in pixels, above 0 and up to 8, got ${describe(width)}`)
    this.#outline = { color: Color.fromInput(options.color ?? '#ffcc00', owner), width }
  }

  /** @returns {Node | null} */
  get parent() {
    return this.#parent
  }

  /** Read only - use add() and remove(). @returns {readonly Node[]} */
  get children() {
    return this.#children
  }

  /** The topmost ancestor (the scene, once added to one). @returns {Node} */
  get root() {
    /** @type {Node} */
    let n = this
    while (n.#parent) n = n.#parent
    return n
  }

  /**
   * Add children. Returns the first one, so `const cube = scene.add(new Mesh({...}))` keeps a
   * reference. A list works too: `group.add(...parts)`. For a description, add(create({ type: 'mesh', ... })).
   * @template {Node} T
   * @param {T} [first] (optional only in its type, so a spread list type-checks - add() needs one)
   * @param {...Node} more
   * @returns {T}
   */
  add(first, ...more) {
    if (first === undefined) fail(this.constructor.name, 'add() needs a node to add - add(new Mesh({...})), or add(...nodes) for several')
    const nodes = [first, ...more].map((n) => toNode(n))
    for (const node of nodes) {
      if (node === this) fail(this.constructor.name, "can't add a node to itself")
      for (let p = this.#parent; p; p = p.#parent) {
        if (p === node) fail(this.constructor.name, "can't add an ancestor as a child - that would make a loop")
      }
      if (node.#parent) node.#parent.#detach(node)
      node.#parent = this
      this.#children.push(node)
    }
    return /** @type {T} */ (nodes[0])
  }

  /** Remove children. Safe inside update handlers and traverse(): the walk goes on over the children as they were. @param {...Node} nodes @returns {this} */
  remove(...nodes) {
    for (const node of nodes) {
      if (node.#parent === this) this.#detach(node)
    }
    return this
  }

  /** @returns {this} */
  removeFromParent() {
    this.#parent?.remove(this)
    return this
  }

  /** @param {Node} node */
  #detach(node) {
    this.#children.splice(this.#children.indexOf(node), 1)
    node.#parent = null
  }

  /**
   * Visit this node and every descendant, depth first. The children are copied before they are
   * visited, so fn can remove or move nodes without the walk skipping one.
   * @param {(node: Node) => void} fn
   */
  traverse(fn) {
    fn(this)
    if (this.#children.length) for (const child of [...this.#children]) child.traverse(fn)
  }

  /** The first descendant (or this) with a name. @param {string} name @returns {Node | undefined} */
  find(name) {
    if (this.name === name) return this
    for (const child of this.#children) {
      const found = child.find(name)
      if (found) return found
    }
    return undefined
  }

  /** Every descendant (and this) matching a predicate. @param {(node: Node) => boolean} predicate @returns {Node[]} */
  findAll(predicate) {
    /** @type {Node[]} */
    const found = []
    this.traverse((n) => predicate(n) && found.push(n))
    return found
  }

  /** Per-frame behaviour. Returns a function that removes it. @param {UpdateHandler} fn @returns {() => void} */
  onUpdate(fn) {
    if (typeof fn !== 'function') fail(this.constructor.name, `onUpdate expects a function (node, dt, t) => {}, got ${describe(fn)}`)
    this.#handlers.push(fn)
    return () => {
      const i = this.#handlers.indexOf(fn)
      if (i !== -1) this.#handlers.splice(i, 1)
    }
  }

  /** @internal Run this node's update handlers. @param {number} dt @param {number} t */
  runHandlers(dt, t) {
    for (const fn of this.#handlers) fn(this, dt, t)
  }

  /** @internal @returns {boolean} */
  get hasHandlers() {
    return this.#handlers.length > 0
  }

  // ---- transforms: all chainable, and all in the node's local frame ----

  /** @param {number} x @param {number} y @param {number} z @returns {this} */
  translate(x, y, z) {
    const offset = new Vec3(x, y, z).applyQuaternion(this.quaternion)
    this.position.add(offset)
    return this
  }

  /** @param {number} d @returns {this} */
  translateX(d) { return this.translate(d, 0, 0) }
  /** @param {number} d @returns {this} */
  translateY(d) { return this.translate(0, d, 0) }
  /** @param {number} d @returns {this} */
  translateZ(d) { return this.translate(0, 0, d) }

  /** Rotate about a local axis. @param {Vec3Input} axis @param {number} rad @returns {this} */
  rotate(axis, rad) {
    const a = Vec3.fromInput(axis, this.constructor.name).normalize()
    this.quaternion.multiply(new Quat().setFromAxisAngle(a, rad))
    return this
  }

  /** @param {number} rad @returns {this} */
  rotateX(rad) { return this.rotate([1, 0, 0], rad) }
  /** @param {number} rad @returns {this} */
  rotateY(rad) { return this.rotate([0, 1, 0], rad) }
  /** @param {number} rad @returns {this} */
  rotateZ(rad) { return this.rotate([0, 0, 1], rad) }

  /**
   * Turn so the node's -Z axis points at a world position or node (cameras and lights look down -Z),
   * with its +Y leaning toward up - a world direction, +Y unless given. The roll is undefined when
   * looking straight along up, so for something that turns through every heading in a plane - a
   * craft seen face on, moving in x-y - give an up out of that plane: [0, 0, 1].
   * @param {Vec3Input | Node} target
   * @param {Vec3Input} [up]
   * @returns {this}
   */
  lookAt(target, up) {
    const at = target instanceof Node ? target.updateWorld().worldPosition : Vec3.fromInput(target, this.constructor.name)
    const toward = up === undefined ? UP : Vec3.fromInput(up, `${this.constructor.name}.lookAt() up`).normalize()
    this.updateWorld()
    const eye = this.worldPosition
    if (eye.equals(at, 1e-9)) return this
    // looking straight along up needs a different one
    const dir = at.clone().sub(eye).normalize()
    const along = Math.abs(dir.dot(toward)) > 0.9999
    const lean = along ? (Math.abs(toward[1]) > 0.9 ? [0, 0, -1] : UP) : toward
    mat4.targetTo(tmpMat, eye, at, lean)
    const world = quat.fromMat3(new Float32Array(4), mat3.fromMat4(tmpMat3, tmpMat))
    // into the parent's frame
    if (this.#parent) {
      const parentRot = quat.normalize(new Float32Array(4), quat.fromMat3(new Float32Array(4), normalizedRotation(this.#parent.worldMatrix)))
      quat.multiply(world, quat.invert(parentRot, parentRot), world)
    }
    this.quaternion.copy(quat.normalize(world, world))
    return this
  }

  /** Recompose `matrix` from position, rotation and scale. @returns {this} */
  updateMatrix() {
    this.matrix.compose(this.position, this.quaternion, this.scale)
    return this
  }

  /**
   * Bring world matrices up to date: this node's ancestors, then this node and its descendants.
   * Scenes do this every frame; call it to read world values in between.
   * @returns {this}
   */
  updateWorld() {
    if (this.#parent) this.#parent.#updateAncestors()
    this.updateWorldTree()
    return this
  }

  #updateAncestors() {
    if (this.#parent) this.#parent.#updateAncestors()
    this.#updateSelf()
  }

  #updateSelf() {
    if (this.matrixAutoUpdate) this.updateMatrix()
    if (this.#parent) mat4.multiply(this.worldMatrix, this.#parent.worldMatrix, this.matrix)
    else this.worldMatrix.copy(this.matrix)
  }

  /** @internal Update this node and its descendants from the parent's current world matrix. */
  updateWorldTree() {
    this.#updateSelf()
    for (const child of this.#children) child.updateWorldTree()
  }

  /** World position as of the last update. @returns {Vec3} */
  get worldPosition() {
    return this.worldMatrix.getPosition()
  }

  /** World rotation as of the last update. @returns {Quat} */
  get worldQuaternion() {
    const q = quat.fromMat3(new Float32Array(4), normalizedRotation(this.worldMatrix))
    return new Quat(q[0], q[1], q[2], q[3]).normalize()
  }

  /** World scale as of the last update. @returns {Vec3} */
  get worldScale() {
    return this.worldMatrix.getScale()
  }

  /** World space bounds of this node and its descendants, brought up to date first. @returns {Box3} */
  get bounds() {
    this.updateWorld()
    const box = new Box3()
    this.traverse((n) => n.expandBounds(box))
    return box
  }

  /**
   * The world-space box of what a camera draws of this subtree: like bounds, but leaving out hidden
   * nodes and those whose showFrom turns them away from that camera - a chart's axis labels for
   * the edges it isn't showing, say. Framing fits this, so the picture fills the view.
   * @param {Camera} camera
   * @returns {Box3}
   */
  boundsFrom(camera) {
    this.updateWorld()
    const box = new Box3()
    /** @param {Node} n */
    const visit = (n) => {
      if (!n.visible || (n.showFrom && !n.showFrom(camera))) return
      n.expandBounds(box)
      for (const child of n.#children) visit(child)
    }
    visit(this)
    return box
  }

  /** @internal Grow a world space box by this node's own geometry (none for a plain node). @param {Box3} box */
  expandBounds(box) {
    return box
  }

  /**
   * A copy of this node; with `deep` (the default) its children are cloned too. Geometry and
   * materials are shared, not copied.
   * @param {{ deep?: boolean }} [options]
   * @returns {this}
   */
  clone({ deep = true } = {}) {
    const Class = /** @type {any} */ (this.constructor)
    const copy = new Class(this.cloneOptions())
    copy.userData = structuredClone(this.userData)
    copy.matrixAutoUpdate = this.matrixAutoUpdate
    if (!copy.matrixAutoUpdate) copy.matrix.copy(this.matrix)
    for (const fn of this.#handlers) copy.onUpdate(fn)
    if (deep) for (const child of this.#children) copy.add(child.clone())
    return copy
  }

  /** @internal Constructor options that recreate this node (without children). @returns {Record<string, unknown>} */
  cloneOptions() {
    return {
      name: this.name,
      position: this.position.toArray(),
      quaternion: this.quaternion.toArray(),
      scale: this.scale.toArray(),
      visible: this.visible,
      pickable: this.pickable,
      tooltip: this.tooltip,
      highlight: this.highlight,
      highlightWhole: this.highlightWhole,
      onHover: this.onHover,
      onClick: this.onClick,
      showFrom: this.showFrom,
      clip: this.#clip ? this.#clip.toJSON() : null,
      onDrag: this.onDrag,
      outline: this.#outline ? { color: this.#outline.color.getStyle(), width: this.#outline.width } : null,
    }
  }

  /**
   * This node and its descendants as a plain description that create() rebuilds. Handlers are
   * behaviour, not data, and are left out.
   * @returns {Record<string, unknown>}
   */
  toJSON() {
    /** @type {Record<string, unknown>} */
    const json = { type: /** @type {typeof Node} */ (this.constructor).type }
    if (this.name) json.name = this.name
    if (!this.position.equals([0, 0, 0])) json.position = this.position.toArray()
    if (this.rotation.x || this.rotation.y || this.rotation.z) json.rotation = this.rotation.toArray()
    if (!this.scale.equals([1, 1, 1])) json.scale = this.scale.toArray()
    if (!this.visible) json.visible = false
    if (!this.pickable) json.pickable = false
    if (!this.matrixAutoUpdate) json.matrixAutoUpdate = false
    if (this.highlight) json.highlight = this.highlight.getStyle()
    if (this.highlightWhole) json.highlightWhole = true
    if (this.#clip) json.clip = this.#clip.toJSON()
    if (this.#outline) json.outline = { color: this.#outline.color.getStyle(), width: this.#outline.width }
    if (Object.keys(this.userData).length) json.userData = this.userData
    Object.assign(json, this.jsonOptions())
    if (this.#children.length) json.children = this.#children.map((c) => c.toJSON())
    return json
  }

  /** @internal Subclass-specific description fields. @returns {Record<string, unknown>} */
  jsonOptions() {
    return {}
  }

  /** Release GPU resources used by this subtree (shared resources are released by the renderer only when unused). */
  dispose() {
    this.traverse((n) => n !== this && n.dispose())
  }
}

/** @param {unknown} n @returns {Node} */
function toNode(n) {
  if (n instanceof Node) return n
  if (n && typeof n === 'object' && 'type' in n) {
    return fail('Node', `add() takes nodes - build one from a description with add(create({ type: '${n.type}', ... }))`)
  }
  return fail('Node', `add() expects nodes, got ${describe(n)}`)
}

// The rotation part of a matrix with any scale divided out, as a 3x3.
/** @param {Float32Array} m @returns {Float32Array} */
function normalizedRotation(m) {
  const out = mat3.fromMat4(new Float32Array(9), m)
  for (let c = 0; c < 3; c++) {
    const len = Math.hypot(out[c * 3], out[c * 3 + 1], out[c * 3 + 2]) || 1
    out[c * 3] /= len
    out[c * 3 + 1] /= len
    out[c * 3 + 2] /= len
  }
  return out
}

/** A node for grouping others - nothing more. */
export class Group extends Node {
  static type = 'group'
}
