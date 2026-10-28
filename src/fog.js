// Fog: what is further away fades into a colour - a misty harbour, a hazy city, depth in a big
// scene. Set a scene's fog and its background to the same colour, and distant things melt into it.
import { Color } from './value/Color.js'
import { checkNumber, checkOptions, describe, fail } from './validate.js'

/** @import { ColorInput } from './types.js' */

/**
 * @typedef {object} FogOptions
 * @property {ColorInput} [color] what distant things fade to - usually the background (default '#808080')
 * @property {number} [density] exponential fog, thickening with distance, as mist does: about how much
 *   it hides per unit of distance (try 0.02 - 0.1). The default, unless near and far are given (0.05)
 * @property {number} [near] linear fog instead: the distance it starts at
 * @property {number} [far] linear fog: the distance where everything is fog colour
 */

export const FOG_OPTIONS = ['color', 'density', 'near', 'far']
export const FOG_HINTS = {
  start: "use 'near' for where linear fog starts",
  end: "use 'far' for where linear fog is complete",
  type: "give 'density' for exponential fog, or 'near' and 'far' for linear",
  exp2: "give 'density' for exponential fog",
  colour: "use 'color'",
}

/** A scene's fog: change its numbers in place to thicken or thin it. */
export class Fog {
  /** What distant things fade to. @type {Color} */ color = new Color(0x808080)
  /** Exponential fog's density, or 0 when the fog is linear. */ density = 0.05
  /** Linear fog: where it starts. */ near = 0
  /** Linear fog: where it is complete. */ far = 100

  /** @param {FogOptions} [options] */
  constructor(options = {}) {
    checkOptions('fog', options, FOG_OPTIONS, FOG_HINTS)
    if (options.color !== undefined) this.color.set(options.color, 'fog')
    const linear = options.near !== undefined || options.far !== undefined
    if (linear && options.density !== undefined) fail('fog', "give 'density' for exponential fog, or 'near' and 'far' for linear - not both")
    if (linear) {
      this.density = 0
      if (options.near !== undefined) this.near = checkNumber('fog', 'near', options.near)
      if (options.far !== undefined) this.far = checkNumber('fog', 'far', options.far)
      if (!(this.near >= 0) || !(this.far > this.near)) fail('fog', `'near' must be 0 or more and 'far' beyond it, got near ${this.near}, far ${this.far}`)
    } else if (options.density !== undefined) {
      this.density = checkNumber('fog', 'density', options.density)
      if (!(this.density > 0)) fail('fog', `'density' must be more than 0, got ${this.density}`)
    }
  }

  /** Linear (near to far) rather than exponential (density)? */
  get linear() {
    return this.density === 0
  }

  /**
   * A Fog from a Fog (returned as is) or options.
   * @param {Fog | FogOptions} input @param {string} [owner]
   * @returns {Fog}
   */
  static fromInput(input, owner = 'fog') {
    if (input instanceof Fog) return input
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail(owner, `'fog' must be { color, density } or { color, near, far }, or null, got ${describe(input)}`)
    return new Fog(input)
  }

  /** @returns {FogOptions} */
  toJSON() {
    const color = this.color.getStyle()
    return this.linear ? { color, near: this.near, far: this.far } : { color, density: this.density }
  }
}
