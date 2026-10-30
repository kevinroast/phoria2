// Section planes: a node's `clip` cuts away everything in its subtree on one side of a plane, for
// cutaways - an engine with its block opened up, a building with a wall off. The plane lives in the
// node's own space, so it moves and turns with the node. Drawing, shadows, picking and the
// raycaster all leave out what is cut away; a cap colour fills the cut faces of closed shapes - a
// surface lying on the plane itself, so parts that touch join cleanly and what's inside stays hidden.
import { Color } from './value/Color.js'
import { Vec3 } from './value/Vec3.js'
import { checkNumber, checkOptions, describe, fail } from './validate.js'

/** @import { ColorInput, Vec3Input } from './types.js' */
/** @import { Node } from './scene/Node.js' */

/**
 * @typedef {object} ClipOptions
 * @property {Vec3Input} [normal] the side of the plane that is cut away, in the node's own space
 *   (default [0, 0, 1]: the front, towards a camera that hasn't moved)
 * @property {number} [offset] how far along the normal from the node's origin the plane lies (default 0)
 * @property {ColorInput | null} [cap] fill colour for the cut faces of closed shapes, lit as a flat
 *   face on the plane; null leaves them open, showing the inside (default null). Caps need closed
 *   solids: an open surface (a plane, an open tube) under a capped clip would fill in wrongly
 */

export const CLIP_OPTIONS = ['normal', 'offset', 'cap']
export const CLIP_HINTS = {
  constant: "use 'offset' for how far along the normal the plane is",
  distance: "use 'offset' for how far along the normal the plane is",
  plane: "give the plane as 'normal' and 'offset'",
  color: "use 'cap' for the colour of the cut faces",
  capColor: "use 'cap' for the colour of the cut faces",
}

/** A section plane, as a node's `clip`: change its numbers in place to move the cut. */
export class Clip {
  /** Which side is cut away, in the node's space; any length. @type {Vec3} */ normal = new Vec3(0, 0, 1)
  /** How far along the normal from the node's origin the plane is. */ offset = 0
  /** Fill colour for cut faces of closed shapes, or null for none. @type {Color | null} */ cap = null

  /** @param {ClipOptions} [options] */
  constructor(options = {}) {
    checkOptions('clip', options, CLIP_OPTIONS, CLIP_HINTS)
    if (options.normal !== undefined) this.normal.copy(options.normal, 'clip')
    if (!(Math.hypot(this.normal[0], this.normal[1], this.normal[2]) > 0)) fail('clip', "'normal' can't be [0, 0, 0] - it says which side is cut away")
    if (options.offset !== undefined) this.offset = checkNumber('clip', 'offset', options.offset)
    if (options.cap != null) this.cap = Color.fromInput(options.cap, 'clip')
  }

  /** @internal
   * A Clip from a Clip (returned as is) or options.
   * @param {Clip | ClipOptions} input @param {string} [owner]
   * @returns {Clip}
   */
  static fromInput(input, owner = 'clip') {
    if (input instanceof Clip) return input
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      fail(owner, `'clip' must be { normal, offset, cap } or null, got ${describe(input)}`)
    }
    return new Clip(input)
  }

  /** @returns {ClipOptions} */
  toJSON() {
    /** @type {ClipOptions} */
    const json = { normal: this.normal.toArray(), offset: this.offset }
    if (this.cap) json.cap = this.cap.getStyle()
    return json
  }
}

/**
 * The plane of a node's clip in world space, as [nx, ny, nz, d] with a unit normal: a point p is
 * cut away where n.p + d > 0. Uses the node's world matrix as it stands.
 * @param {Node} node a node with a clip
 * @param {Float32Array} [out]
 * @returns {Float32Array}
 */
export function worldPlane(node, out = new Float32Array(4)) {
  const clip = /** @type {Clip} */ (node.clip), m = node.worldMatrix
  const [x, y, z] = clip.normal, l = Math.hypot(x, y, z)
  const nx = x / l, ny = y / l, nz = z / l
  // a point on the plane, and the normal through the inverse transpose - as a plane, [n, d] times
  // the inverse world matrix, which for the normal is its cofactors
  const px = nx * clip.offset, py = ny * clip.offset, pz = nz * clip.offset
  const wx = m[0] * px + m[4] * py + m[8] * pz + m[12], wy = m[1] * px + m[5] * py + m[9] * pz + m[13], wz = m[2] * px + m[6] * py + m[10] * pz + m[14]
  const c0 = [m[5] * m[10] - m[6] * m[9], m[6] * m[8] - m[4] * m[10], m[4] * m[9] - m[5] * m[8]]
  const c1 = [m[2] * m[9] - m[1] * m[10], m[0] * m[10] - m[2] * m[8], m[1] * m[8] - m[0] * m[9]]
  const c2 = [m[1] * m[6] - m[2] * m[5], m[2] * m[4] - m[0] * m[6], m[0] * m[5] - m[1] * m[4]]
  let ox = c0[0] * nx + c1[0] * ny + c2[0] * nz, oy = c0[1] * nx + c1[1] * ny + c2[1] * nz, oz = c0[2] * nx + c1[2] * ny + c2[2] * nz
  // a mirroring transform flips the cofactors' sign; keep the normal on the cut-away side
  const det = m[0] * c0[0] + m[4] * c1[0] + m[8] * c2[0]
  const s = (det < 0 ? -1 : 1) / (Math.hypot(ox, oy, oz) || 1)
  ox *= s
  oy *= s
  oz *= s
  out[0] = ox
  out[1] = oy
  out[2] = oz
  out[3] = -(ox * wx + oy * wy + oz * wz)
  return out
}

/** The nearest node at or above this one with a clip - the one that cuts it - or null. @param {Node | null} node */
export function clipOwner(node) {
  for (let n = node; n; n = n.parent) if (n.clip) return n
  return null
}
