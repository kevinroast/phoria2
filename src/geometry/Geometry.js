import { Box3 } from '../value/Box3.js'
import { checkOptions, describe, fail } from '../validate.js'

/**
 * @typedef {object} GeometryOptions
 * @property {ArrayLike<number>} positions xyz per vertex
 * @property {ArrayLike<number>} [normals] xyz per vertex; computed (smooth) when missing
 * @property {ArrayLike<number>} [uvs] uv per vertex - glTF convention, (0, 0) is the image's top left
 * @property {ArrayLike<number>} [colors] rgb per vertex, sRGB 0-1 like every colour input
 * @property {ArrayLike<number>} [indices] vertex indices; triangles for meshes, pairs for lines
 */

const OPTIONS = ['positions', 'normals', 'uvs', 'colors', 'indices']

/**
 * Vertex data: flat typed arrays plus an optional index. Generators such as box() and sphere()
 * return one; build your own from arrays. Change the arrays in place and call needsUpdate().
 */
export class Geometry {
  /** The options it takes. */
  static OPTIONS = OPTIONS
  /** @type {Float32Array} */ positions
  /** @type {Float32Array | null} */ uvs = null
  /** @type {Float32Array | null} */ colors = null
  /** @type {Uint16Array | Uint32Array | null} */ indices = null

  /** Bumped by needsUpdate() so renderers know to re-upload. */
  version = 0

  /**
   * Draw only the first `drawCount` vertices (indices, when indexed), or all of them when null -
   * for geometry that fills up over time, such as particles. Picking honours it too.
   * @type {number | null}
   */
  drawCount = null

  /**
   * How this geometry was made, when it came from a generator - lets toJSON() stay small.
   * @type {{ type: string } & Record<string, unknown> | null}
   */
  source = null

  /** @type {Float32Array | null} */
  #normals = null
  /** @type {Box3 | null} */
  #bounds = null
  /** @type {Set<() => void>} */
  #onDispose = new Set()

  /** @param {GeometryOptions} options */
  constructor(options) {
    checkOptions('Geometry', options, OPTIONS)
    if (!options?.positions) fail('Geometry', "'positions' is required - an array of x, y, z per vertex")
    this.positions = toFloat32('positions', options.positions, 3)
    const n = this.vertexCount
    if (options.normals) this.#normals = toFloat32('normals', options.normals, 3, n)
    if (options.uvs) this.uvs = toFloat32('uvs', options.uvs, 2, n)
    if (options.colors) this.colors = toFloat32('colors', options.colors, 3, n)
    if (options.indices) {
      let max = 0
      for (let i = 0; i < options.indices.length; i++) {
        const v = options.indices[i]
        if (!Number.isInteger(v) || v < 0) fail('Geometry', `'indices' must be whole numbers 0 or more, found ${describe(v)} at ${i}`)
        if (v > max) max = v
      }
      if (max >= n) fail('Geometry', `'indices' refers to vertex ${max} but there are only ${n} vertices`)
      this.indices = n > 65535 ? Uint32Array.from(options.indices) : Uint16Array.from(options.indices)
    }
  }

  /**
   * xyz per vertex. Computed (smooth) from the triangles on first read when not supplied, so
   * points and lines - whose geometry has no triangles - never pay for them.
   * @type {Float32Array}
   */
  get normals() {
    if (!this.#normals) this.computeNormals()
    return /** @type {Float32Array} */ (this.#normals)
  }

  set normals(v) {
    this.#normals = v
  }

  /** True once normals exist, supplied or computed. */
  get hasNormals() {
    return this.#normals !== null
  }

  /** @returns {number} */
  get vertexCount() {
    return this.positions.length / 3
  }

  /** Number of indices if indexed, otherwise vertices. @returns {number} */
  get elementCount() {
    return this.indices ? this.indices.length : this.vertexCount
  }

  /** The elements actually drawn: elementCount, limited by drawCount. @returns {number} */
  get drawnCount() {
    return this.drawCount === null ? this.elementCount : Math.max(0, Math.min(this.drawCount, this.elementCount))
  }

  /**
   * The vertices actually drawn as points: vertexCount, limited by drawCount. Points draw each vertex
   * once and ignore the index, so a mesh's indexed geometry can be shown as its vertices too.
   * @returns {number}
   */
  get drawnVertices() {
    return this.drawCount === null ? this.vertexCount : Math.max(0, Math.min(this.drawCount, this.vertexCount))
  }

  /** Local space bounds, cached until needsUpdate(). @returns {Box3} */
  get bounds() {
    return this.#bounds ??= new Box3().expandByPositions(this.positions)
  }

  /** Call after editing the arrays in place. @returns {this} */
  needsUpdate() {
    this.version++
    this.#bounds = null
    return this
  }

  /**
   * Compute vertex normals from the triangles. Smooth normals average the faces sharing each vertex;
   * flat normals give every face its own vertices (a faceted look), so indexed geometry becomes
   * non-indexed. Non-indexed geometry is assumed to already have its own vertices per triangle.
   * @param {{ flat?: boolean }} [options]
   * @returns {this}
   */
  computeNormals({ flat = false } = {}) {
    if (flat && this.indices) this.#unweld()
    const p = this.positions
    const normals = new Float32Array(p.length)
    const triangles = this.elementCount - (this.elementCount % 3)
    for (let t = 0; t < triangles; t += 3) {
      const a = this.#index(t), b = this.#index(t + 1), c = this.#index(t + 2)
      // face normal (b - a) x (c - a), unnormalised so larger faces weigh more
      const abx = p[b * 3] - p[a * 3], aby = p[b * 3 + 1] - p[a * 3 + 1], abz = p[b * 3 + 2] - p[a * 3 + 2]
      const acx = p[c * 3] - p[a * 3], acy = p[c * 3 + 1] - p[a * 3 + 1], acz = p[c * 3 + 2] - p[a * 3 + 2]
      const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx
      for (const v of [a, b, c]) {
        normals[v * 3] += nx
        normals[v * 3 + 1] += ny
        normals[v * 3 + 2] += nz
      }
    }
    for (let i = 0; i < normals.length; i += 3) {
      const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2])
      if (len > 0) {
        normals[i] /= len
        normals[i + 1] /= len
        normals[i + 2] /= len
      }
    }
    this.normals = normals
    return this.needsUpdate()
  }

  /** A copy with its own arrays. @returns {Geometry} */
  clone() {
    const g = new Geometry({
      positions: this.positions,
      normals: this.#normals ?? undefined,
      uvs: this.uvs ?? undefined,
      colors: this.colors ?? undefined,
      indices: this.indices ?? undefined,
    })
    g.source = this.source && { ...this.source }
    g.drawCount = this.drawCount
    return g
  }

  /** Release GPU resources made from this geometry. It can still be used; it is re-uploaded on next render. */
  dispose() {
    for (const fn of this.#onDispose) fn()
  }

  /** For renderers: called when dispose() is. Returns an unsubscribe function. @param {() => void} fn */
  onDispose(fn) {
    this.#onDispose.add(fn)
    return () => this.#onDispose.delete(fn)
  }

  /** A generator description when made by one, otherwise the raw arrays. */
  toJSON() {
    if (this.source) return { ...this.source }
    /** @type {Record<string, number[]>} */
    const json = { positions: Array.from(this.positions) }
    if (this.#normals) json.normals = Array.from(this.#normals)
    if (this.uvs) json.uvs = Array.from(this.uvs)
    if (this.colors) json.colors = Array.from(this.colors)
    if (this.indices) json.indices = Array.from(this.indices)
    return json
  }

  /** @param {number} i */
  #index(i) {
    return this.indices ? this.indices[i] : i
  }

  // Expand indexed vertices so no two triangles share one.
  #unweld() {
    const idx = /** @type {Uint16Array | Uint32Array} */ (this.indices)
    const expand = (src, size) => {
      if (!src) return null
      const out = new Float32Array(idx.length * size)
      for (let i = 0; i < idx.length; i++) {
        for (let k = 0; k < size; k++) out[i * size + k] = src[idx[i] * size + k]
      }
      return out
    }
    this.positions = /** @type {Float32Array} */ (expand(this.positions, 3))
    this.uvs = expand(this.uvs, 2)
    this.colors = expand(this.colors, 3)
    this.indices = null
    this.source = null
  }
}

/**
 * @param {string} name @param {ArrayLike<number>} values @param {number} size per vertex
 * @param {number} [count] expected vertex count
 * @returns {Float32Array}
 */
function toFloat32(name, values, size, count) {
  if (!values || typeof values !== 'object' || typeof values.length !== 'number') {
    fail('Geometry', `'${name}' must be an array of numbers, got ${describe(values)}`)
  }
  if (values.length % size !== 0) fail('Geometry', `'${name}' has ${values.length} numbers - expected ${size} per vertex`)
  if (count !== undefined && values.length !== count * size) {
    fail('Geometry', `'${name}' has ${values.length / size} entries but 'positions' has ${count} vertices`)
  }
  const out = Float32Array.from(values)
  for (let i = 0; i < out.length; i++) {
    if (Number.isNaN(out[i])) fail('Geometry', `'${name}' contains a non-number at index ${i}`)
  }
  return out
}
