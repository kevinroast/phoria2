// What a shadow map was last drawn from, so one that would come out the same is kept rather than
// drawn again. A shadow map depends on its light and on what casts into it - never on the camera -
// so orbiting a still scene, a refine sample of a light that doesn't move, or another view of the
// same scene finds it as it was.
//
// The record is numbers, compared one by one: the light's view, then each caster as the depth pass
// draws it - which node, its world matrix, its geometry and how much of it is drawn, its instances,
// its section plane, and what of its material shapes it (a cut-out's threshold, map and the map's
// placement; glass's colour and sides). A caster with shader hooks can move or cut itself with time,
// so a map with one is drawn every frame. Anything that changes a map must be in its record: a test
// for each (test/shadow-cache.test.js).
import { glassFilter } from '../material/features.js'
import { uvMatrix } from './resources.js'

/** @import { DrawItem } from '../frame.js' */

/** @type {WeakMap<object, number>} */
const ids = new WeakMap()
let made = 0

/** A number for an object (a node, a geometry, a texture, a target): the same for the same one. @param {object | null | undefined} o */
export function idOf(o) {
  if (o == null) return 0
  let id = ids.get(o)
  if (id === undefined) ids.set(o, id = ++made)
  return id
}

/**
 * Whether shader hooks can change a shape as a depth pass draws it: a vertex hook moves it; a
 * fragment hook cuts holes where it discards or sets the alpha (base.a, or all of base). One that
 * only colours (base.rgb, emissive, normal) can't.
 * @param {{ vertex: string, fragment: string }} shader
 */
export function changesShape(shader) {
  if (shader.vertex) return true
  return /\bdiscard\b|\bbase\s*(?:[*/+-]?=(?!=)|\.\s*[rgbaxyzwstpq]*[aw][rgbaxyzwstpq]*\b)/.test(shader.fragment)
}

export class DrawnFrom {
  /** @type {number[]} */ #last = []
  /** @type {number[]} */ #next = []
  /** the last record can be compared against */ #held = false
  /** this record can be kept - nothing in it moves by itself */ #keepable = true

  /** Start a new record. @returns {this} */
  begin() {
    this.#next.length = 0
    this.#keepable = true
    return this
  }

  /** @param {number} n @returns {this} */
  number(n) {
    this.#next.push(n)
    return this
  }

  /** @param {ArrayLike<number>} values @returns {this} */
  numbers(values) {
    for (let i = 0; i < values.length; i++) this.#next.push(values[i])
    return this
  }

  /** @param {object | null | undefined} o @returns {this} */
  object(o) {
    this.#next.push(idOf(o))
    return this
  }

  /**
   * Casters as the depth pass draws them. `glass`: drawn into a glass layer, which their colour and
   * sides decide too.
   * @param {DrawItem[]} casters @param {boolean} [glass]
   * @returns {this}
   */
  casters(casters, glass = false) {
    const r = this.#next
    r.push(casters.length)
    for (const item of casters) {
      const { node, geometry, material, worldMatrix, instances, clip } = item
      // shader hooks that move or cut the shape, perhaps with time: the map is drawn every frame. A
      // fragment hook that only colours - a pattern on a floor - leaves a depth map as it was; glass
      // is drawn with what its hooks do to its normal as well (caustics), so any hook there
      if (material.shader && (glass || changesShape(material.shader))) this.#keepable = false
      r.push(idOf(node), idOf(geometry), geometry.version, geometry.drawnCount)
      for (let i = 0; i < 16; i++) r.push(worldMatrix[i])
      if (instances) r.push(instances.version, instances.count)
      else r.push(-1, -1)
      if (clip) r.push(1, clip.plane[0], clip.plane[1], clip.plane[2], clip.plane[3])
      else r.push(0)
      // a cut-out's holes: its threshold, its opacity and its map, where the map is read
      r.push(material.alphaTest)
      const map = material.alphaTest > 0 ? material.map : null
      if (map) {
        r.push(material.opacity, idOf(map), map.version, map.uvSet, material.triplanar)
        const m = uvMatrix(map)
        for (let i = 0; i < m.length; i++) r.push(m[i])
      } else r.push(0)
      if (glass) {
        const [fr, fg, fb] = glassFilter(material, worldMatrix)
        r.push(fr, fg, fb, material.doubleSided ? 1 : 0)
      }
    }
    return this
  }

  /** Whether the last record couldn't be kept - something in it moves by itself (a shader hook). */
  get moving() {
    return !this.#keepable
  }

  /** Never kept: drawn every frame. @returns {this} */
  never() {
    this.#keepable = false
    return this
  }

  /**
   * Whether this record is the last one - the map drawn then is what would be drawn now. The new
   * record becomes the last either way.
   * @returns {boolean}
   */
  same() {
    const a = this.#next, b = this.#last
    let same = this.#held && this.#keepable && a.length === b.length
    for (let i = 0; same && i < a.length; i++) same = a[i] === b[i]
    this.#last = a
    this.#next = b
    this.#held = this.#keepable
    return same
  }

  /** Forget the last record: the next is drawn. */
  forget() {
    this.#held = false
  }
}
