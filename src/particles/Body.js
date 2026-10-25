// Simple physics as a behaviour rather than a base class: any node moves with velocity, gravity
// and drag once its body's update is attached - node.onUpdate(body.update).
import { Vec3 } from '../value/Vec3.js'
import { checkNumber, checkOptions } from '../validate.js'

/** @import { Node } from '../scene/Node.js' */
/** @import { Vec3Input } from '../types.js' */

/**
 * @typedef {object} BodyOptions
 * @property {Vec3Input} [velocity] units per second (default [0, 0, 0])
 * @property {Vec3Input} [gravity] acceleration, e.g. [0, -9.8, 0] (default none)
 * @property {number} [drag] share of velocity lost per second (default 0)
 */

/**
 * Velocity, gravity and drag for a node.
 *
 *     const body = new Body({ velocity: [0, 20, 0], gravity: [0, -9.8, 0] })
 *     rocket.onUpdate(body.update)
 */
export class Body {
  velocity = new Vec3()
  gravity = new Vec3()
  drag = 0

  /** @param {BodyOptions} [options] */
  constructor(options = {}) {
    checkOptions('Body', options, ['velocity', 'gravity', 'drag'], {
      impulse: 'call body.impulse([x, y, z]) after creating it',
      mass: 'a Body has no mass - impulse() changes velocity directly',
    })
    if (options.velocity !== undefined) this.velocity.copy(options.velocity, 'Body')
    if (options.gravity !== undefined) this.gravity.copy(options.gravity, 'Body')
    if (options.drag !== undefined) this.drag = Math.max(0, checkNumber('Body', 'drag', options.drag))
  }

  /** Add to the velocity at once - a kick. @param {Vec3Input} v @returns {this} */
  impulse(v) {
    this.velocity.add(Vec3.fromInput(v, 'Body'))
    return this
  }

  /**
   * Move a node one step. Bound, so it can be handed straight to node.onUpdate().
   * @param {Node} node
   * @param {number} dt seconds
   */
  update = (node, dt) => {
    const v = this.velocity, keep = Math.exp(-this.drag * dt)
    for (let k = 0; k < 3; k++) {
      v[k] = (v[k] + this.gravity[k] * dt) * keep
      node.position[k] += v[k] * dt
    }
  }
}
