// Turns the option objects drawables accept into Geometry and Material. Only objects that need no
// extra code: generator descriptions such as { type: 'box' } go through create(), so an app that
// never uses descriptions doesn't carry every generator.
import { Geometry } from './geometry/Geometry.js'
import { Material } from './material/Material.js'
import { describe, fail } from './validate.js'

/** @import { MaterialOptions } from './material/Material.js' */
/** @import { GeometryOptions } from './geometry/Geometry.js' */

/**
 * @param {Geometry | GeometryOptions} input a Geometry, or its options ({ positions, indices, ... })
 * @param {string} owner
 * @returns {Geometry}
 */
export function resolveGeometry(input, owner) {
  if (input instanceof Geometry) return input
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail(owner, `'geometry' must be a Geometry such as box(2), got ${describe(input)}`)
  }
  if ('type' in input) {
    const type = /** @type {{ type: unknown }} */ (input).type
    fail(owner, `'geometry' { type: '${type}' } is a description - use the generator directly, e.g. ` +
      `${type}(...), or build the whole node with create({ type: '${owner.toLowerCase()}', geometry: { type: '${type}' } })`)
  }
  return new Geometry(/** @type {GeometryOptions} */ (input))
}

/**
 * @param {Material | MaterialOptions | undefined} input
 * @returns {Material}
 */
export function resolveMaterial(input) {
  return input === undefined ? new Material() : Material.fromInput(input)
}
