// Moving things along curves, and drawing curves in as they're travelled.

import { transformMat4 } from '../math/vec3.js'
import { multiply, setAxisAngle } from '../math/quat.js'
import { Curve } from '../geometry/Curve.js'
import { Vec3 } from '../value/Vec3.js'
import { checkOneOf, checkOptions, describe, fail } from '../validate.js'

/** @import { Node } from '../scene/Node.js' */
/** @import { Lines } from '../scene/drawables.js' */

/** @import { Vec3Input } from '../types.js' */

/**
 * Which of a model's own axes is its nose. Cameras, lights and lookAt use -Z; a model built
 * upright - a rocket along +Y - says '+y'.
 * @typedef {'-z' | '+z' | '-y' | '+y' | '-x' | '+x'} Forward
 */

/**
 * @typedef {object} FaceOptions
 * @property {Forward} [forward] the model's nose axis, default '-z'
 * @property {Vec3Input} [up] which way is up as it turns, in the parent's space, default [0, 1, 0].
 *   Heading straight along it leaves the roll undefined, so a craft that turns through every
 *   heading in the x-y plane (seen face on) needs one out of the plane: [0, 0, 1]
 */

/**
 * @typedef {object} FollowOptions
 * @property {boolean} [orient] turn the node to face along the curve, default true
 * @property {Forward} [forward] the model's nose axis, default '-z'
 * @property {Vec3Input} [up] which way is up as it turns, default [0, 1, 0] - see face()
 */

const FORWARD = ['-z', '+z', '-y', '+y', '-x', '+x']
// the turn that takes each nose axis onto -Z, as [axis, angle]
const TO_MINUS_Z = {
  '-z': null,
  '+z': [[0, 1, 0], Math.PI],
  '-y': [[1, 0, 0], Math.PI / 2],
  '+y': [[1, 0, 0], -Math.PI / 2],
  '-x': [[0, 1, 0], -Math.PI / 2],
  '+x': [[0, 1, 0], Math.PI / 2],
}

/**
 * Turn a node so its nose points along a direction, in its parent's space - for a model built
 * along another axis, say which with forward.
 *
 *     face(lander, [0, 1, 0], { forward: '+y' })   // stand it upright
 * @param {Node} node
 * @param {Vec3Input} direction
 * @param {FaceOptions} [options]
 * @returns {Node}
 */
export function face(node, direction, options = {}) {
  checkOptions('face()', options, ['forward', 'up'], { nose: "use 'forward' - which of the model's axes is its nose" })
  const forward = /** @type {Forward} */ (options.forward === undefined ? '-z' : checkOneOf('face()', 'forward', options.forward, FORWARD))
  const ahead = node.position.clone().add(Vec3.fromInput(direction, 'face()'))
  let up = options.up === undefined ? undefined : Vec3.fromInput(options.up, 'face() up')
  const parent = node.parent
  if (parent) {
    const m = parent.updateWorld().worldMatrix
    if (up) up = transformMat4(up, up.add(node.position), m).sub(transformMat4(new Vec3(), node.position, m))
    transformMat4(ahead, ahead, m)
  }
  node.lookAt(ahead, up)
  const turn = TO_MINUS_Z[forward]
  if (turn) {
    const q = setAxisAngle(new Float32Array(4), turn[0], turn[1])
    node.quaternion.copy(multiply(new Float32Array(4), node.quaternion, q))
  }
  return node
}

/**
 * Put a node t of the way along a curve (0 start, 1 end, by distance), facing the way it runs.
 * The curve is in the node's parent's space - the same space as its position. A model built along
 * another axis than -Z says which is its nose with forward.
 *
 *     story.add(4, (t) => follow(lander, transfer, t))
 *     follow(rocket, ascent, t, { forward: '+y' })   // a rocket modelled upright
 * @param {Node} node
 * @param {Curve} path
 * @param {number} t
 * @param {FollowOptions} [options]
 * @returns {Node}
 */
export function follow(node, path, t, options = {}) {
  if (!(path instanceof Curve)) fail('follow()', `takes (node, curve, t) - make the curve with curve([...points]) or ellipse({...}), got ${describe(path)}`)
  checkOptions('follow()', options, ['orient', 'forward', 'up'], { rotate: "use 'orient'", lookAhead: 'the node faces along the curve - orient: false leaves it as it is', nose: "use 'forward' - which of the model's axes is its nose" })
  node.position.copy(path.at(t))
  if (options.orient !== false) face(node, path.tangentAt(t), { forward: options.forward, up: options.up })
  return node
}

/**
 * Draw only the first part of a line - t of it (0 nothing, 1 all) - so a path draws in as it's
 * travelled. For Lines made from curve.line(): its pieces run in order from the start.
 *
 *     story.add(4, (t) => { follow(lander, transfer, t); reveal(transferLine, t) })
 * @param {Lines} lines
 * @param {number} t
 * @returns {Lines}
 */
export function reveal(lines, t) {
  const g = lines?.geometry
  if (!g || /** @type {any} */ (lines).drawMode !== 'lines') fail('reveal()', `takes a Lines node, got ${describe(lines)}`)
  const pieces = g.vertexCount / 2
  g.drawCount = Math.round(Math.min(1, Math.max(0, t)) * pieces) * 2
  lines.visible = g.drawCount > 0
  return lines
}

