// GPU copies of geometry, instance data and textures, created on first use and kept in step with the
// CPU objects through their `version` counters. Everything is keyed by object in WeakMaps, so a
// dropped geometry's entry goes with it; dispose() frees the GL objects straight away.
import { ATTRIBUTES } from './shaders.js'

/** @import { Geometry } from '../geometry/Geometry.js' */
/** @import { Texture, DataImage } from '../material/Texture.js' */
/** @import { Scene } from '../scene/Scene.js' */

// uploads bind textures here, out of the way of the units programs sample from
const UPLOAD_UNIT = 15

/**
 * @typedef {object} MeshBuffers
 * @property {WebGLVertexArrayObject} vao
 * @property {WebGLBuffer[]} buffers
 * @property {number} count indices or vertices to draw
 * @property {number} indexType gl.UNSIGNED_SHORT / gl.UNSIGNED_INT, or 0 when not indexed
 * @property {Geometry} geometry the geometry they were made from - an instanced mesh can be given another
 * @property {number} version geometry version they were made from
 * @property {number} instanceVersion instance data version (instanced meshes)
 * @property {WebGLBuffer | null} [matrixBuffer] per-instance matrices, refilled when only they change
 * @property {WebGLBuffer | null} [colorBuffer] per-instance colours, likewise
 * @property {Record<string, WebGLBuffer>} [attributes] the geometry's buffers by attribute
 * @property {string} [layout] the data's shape when made; while it holds, changes refill in place
 */

/**
 * The sizes of everything uploaded - equal layouts can reuse the same buffers.
 * @param {Geometry} g
 * @param {{ instanceMatrices: Float32Array, instanceColors: Float32Array | null } | null} instances
 * @param {boolean} withNormals
 */
function layoutOf(g, instances, withNormals, withTangents) {
  return [g.positions.length, withNormals, g.uvs?.length, g.colors?.length, g.indices?.length,
    instances?.instanceMatrices.length, instances?.instanceColors?.length, withTangents].join()
}

/**
 * Per-vertex tangents along the UVs' u, with the way v runs in w (Lengyel's method): smooth where
 * the normals are. Without UVs, around the mesh's up axis.
 * @param {Geometry} g
 * @returns {Float32Array}
 */
export function tangentsOf(g) {
  const p = g.positions, n = g.normals, uv = g.uvs, count = p.length / 3
  const out = new Float32Array(count * 4)
  const t = new Float32Array(count * 3), b = new Float32Array(count * 3)
  if (uv) {
    const idx = g.indices, triangles = (idx ? idx.length : count) / 3
    for (let k = 0; k < triangles; k++) {
      const i0 = idx ? idx[k * 3] : k * 3, i1 = idx ? idx[k * 3 + 1] : k * 3 + 1, i2 = idx ? idx[k * 3 + 2] : k * 3 + 2
      const e1x = p[i1 * 3] - p[i0 * 3], e1y = p[i1 * 3 + 1] - p[i0 * 3 + 1], e1z = p[i1 * 3 + 2] - p[i0 * 3 + 2]
      const e2x = p[i2 * 3] - p[i0 * 3], e2y = p[i2 * 3 + 1] - p[i0 * 3 + 1], e2z = p[i2 * 3 + 2] - p[i0 * 3 + 2]
      const du1 = uv[i1 * 2] - uv[i0 * 2], dv1 = uv[i1 * 2 + 1] - uv[i0 * 2 + 1]
      const du2 = uv[i2 * 2] - uv[i0 * 2], dv2 = uv[i2 * 2 + 1] - uv[i0 * 2 + 1]
      const det = du1 * dv2 - du2 * dv1
      if (Math.abs(det) < 1e-12) continue
      const r = 1 / det
      const tx = (e1x * dv2 - e2x * dv1) * r, ty = (e1y * dv2 - e2y * dv1) * r, tz = (e1z * dv2 - e2z * dv1) * r
      const bx = (e2x * du1 - e1x * du2) * r, by = (e2y * du1 - e1y * du2) * r, bz = (e2z * du1 - e1z * du2) * r
      for (const i of [i0, i1, i2]) {
        t[i * 3] += tx; t[i * 3 + 1] += ty; t[i * 3 + 2] += tz
        b[i * 3] += bx; b[i * 3 + 1] += by; b[i * 3 + 2] += bz
      }
    }
  }
  for (let i = 0; i < count; i++) {
    const nx = n[i * 3], ny = n[i * 3 + 1], nz = n[i * 3 + 2]
    let tx = t[i * 3], ty = t[i * 3 + 1], tz = t[i * 3 + 2]
    // onto the surface, square to the normal
    const d = nx * tx + ny * ty + nz * tz
    tx -= nx * d; ty -= ny * d; tz -= nz * d
    let len = Math.hypot(tx, ty, tz)
    if (len < 1e-9) {
      // no UVs here: around the up axis, or the x axis for a surface facing up or down
      if (Math.abs(ny) < 0.999) { tx = nz; ty = 0; tz = -nx } else { tx = 1; ty = 0; tz = 0 }
      const e = nx * tx + ny * ty + nz * tz
      tx -= nx * e; ty -= ny * e; tz -= nz * e
      len = Math.hypot(tx, ty, tz) || 1
    }
    out[i * 4] = tx / len; out[i * 4 + 1] = ty / len; out[i * 4 + 2] = tz / len
    // which way v runs against n x t: mirrored UVs turn the other way
    const cx = ny * tz - nz * ty, cy = nz * tx - nx * tz, cz = nx * ty - ny * tx
    out[i * 4 + 3] = cx * b[i * 3] + cy * b[i * 3 + 1] + cz * b[i * 3 + 2] < 0 ? -1 : 1
  }
  return out
}

// a quad as a triangle strip of [along, across] corners, shared by every Lines draw
const LINE_CORNERS = new Float32Array([0, -1, 0, 1, 1, -1, 1, 1])

export class Resources {
  /** @type {WebGL2RenderingContext} */ gl
  // one cache per way of drawing, since one geometry can be drawn as triangles, points and lines
  /** @type {WeakMap<object, MeshBuffers>} */ #triangles = new WeakMap()
  /** @type {WeakMap<object, MeshBuffers>} */ #points = new WeakMap()
  /** @type {WeakMap<object, MeshBuffers>} */ #lines = new WeakMap()
  /** @type {WeakMap<Texture, { texture: WebGLTexture, version: number }>} */ #textures = new WeakMap()
  /** @type {WebGLTexture | null} */ #white = null
  /** @type {WebGLBuffer | null} */ #corners = null
  /** Counts for renderer.info. */
  counts = { geometries: 0, textures: 0 }
  /** The renderer drawing right now - what it touches is marked as used by it. @type {object | null} */
  owner = null
  // which renderers have drawn each geometry, instanced mesh and texture (a shared context frees
  // one only when no renderer still draws it)
  /** @type {WeakMap<object, Set<object>>} */ #usedBy = new WeakMap()

  /** @param {WebGL2RenderingContext} gl */
  constructor(gl) {
    this.gl = gl
  }

  /** @type {{ ext: any, max: number } | null | undefined} */
  #aniso

  /** The anisotropic filtering extension and its limit, or null where there is none. */
  #anisotropic() {
    if (this.#aniso !== undefined) return this.#aniso
    const ext = this.gl.getExtension('EXT_texture_filter_anisotropic')
    this.#aniso = ext ? { ext, max: this.gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1 } : null
    return this.#aniso
  }

  /**
   * Vertex array for a mesh or points: the geometry's attributes, plus per-instance matrices and
   * colours when `instances` is given. Instanced meshes get their own vertex array, keyed by the node.
   * @param {Geometry} geometry
   * @param {{ instanceMatrices: Float32Array, instanceColors: Float32Array | null, version: number } | null} instances
   * @param {boolean} withNormals
   * @param {boolean} [withTangents] add tangents, for brushed metal - kept once added
   * @returns {MeshBuffers}
   */
  mesh(geometry, instances, withNormals, withTangents = false) {
    const key = instances ?? geometry
    this.#mark(key)
    const cache = withNormals ? this.#triangles : this.#points
    let entry = cache.get(key)
    // instanced buffers are kept by the node, so check it still has the same geometry
    const same = entry?.geometry === geometry
    withTangents = withNormals && (withTangents || (same && !!entry?.attributes?.tangent))
    if (entry && same && entry.version === geometry.version && (!instances || entry.instanceVersion === instances.version) &&
      withTangents === !!entry.attributes?.tangent) return entry
    const layout = layoutOf(geometry, instances, withNormals, withTangents)
    if (entry && same && entry.layout === layout) {
      // the data changed but kept its shape (moving vertices, particles, instances): refill in place
      if (entry.version !== geometry.version) {
        const a = /** @type {Record<string, WebGLBuffer>} */ (entry.attributes)
        this.#refill(a.position, geometry.positions)
        if (withNormals) this.#refill(a.normal, geometry.normals)
        if (geometry.uvs) this.#refill(a.uv, geometry.uvs)
        if (geometry.colors) this.#refill(a.color, geometry.colors)
        if (withTangents) this.#refill(a.tangent, tangentsOf(geometry))
        if (geometry.indices) {
          // the element binding belongs to the vertex array, so bind that first
          this.gl.bindVertexArray(entry.vao)
          this.gl.bufferSubData(this.gl.ELEMENT_ARRAY_BUFFER, 0, geometry.indices)
          this.gl.bindVertexArray(null)
        }
        entry.version = geometry.version
      }
      if (instances && entry.instanceVersion !== instances.version) {
        this.#refill(entry.matrixBuffer, instances.instanceMatrices)
        if (instances.instanceColors) this.#refill(entry.colorBuffer, instances.instanceColors)
        entry.instanceVersion = instances.version
      }
      return entry
    }
    if (entry) {
      this.#free(entry)
      // given another geometry: the old one is no longer held here, and the new one is watched
      if (!same) {
        this.counts.geometries--
        this.#watch(geometry, key, cache)
      }
    } else this.#watch(geometry, key, cache)

    const gl = this.gl
    const vao = /** @type {WebGLVertexArrayObject} */ (gl.createVertexArray())
    gl.bindVertexArray(vao)
    /** @type {WebGLBuffer[]} */
    const buffers = []
    const attribute = (location, data, size, divisor = 0) => {
      const buffer = /** @type {WebGLBuffer} */ (gl.createBuffer())
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
      gl.enableVertexAttribArray(location)
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0)
      if (divisor) gl.vertexAttribDivisor(location, divisor)
      buffers.push(buffer)
      return buffer
    }
    /** @type {Record<string, WebGLBuffer>} */
    const attributes = {}
    attributes.position = attribute(ATTRIBUTES.position, geometry.positions, 3)
    if (withNormals) attributes.normal = attribute(ATTRIBUTES.normal, geometry.normals, 3)
    if (geometry.uvs) attributes.uv = attribute(ATTRIBUTES.uv, geometry.uvs, 2)
    else gl.vertexAttrib2f(ATTRIBUTES.uv, 0, 0)
    if (geometry.colors) attributes.color = attribute(ATTRIBUTES.color, geometry.colors, 3)
    else gl.vertexAttrib3f(ATTRIBUTES.color, 1, 1, 1)
    if (withTangents) attributes.tangent = attribute(ATTRIBUTES.tangent, tangentsOf(geometry), 4)

    let matrixBuffer = null, colorBuffer = null
    if (instances) {
      matrixBuffer = /** @type {WebGLBuffer} */ (gl.createBuffer())
      gl.bindBuffer(gl.ARRAY_BUFFER, matrixBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, instances.instanceMatrices, gl.STATIC_DRAW)
      for (let i = 0; i < 4; i++) {
        const location = ATTRIBUTES.instanceMatrix + i
        gl.enableVertexAttribArray(location)
        gl.vertexAttribPointer(location, 4, gl.FLOAT, false, 64, i * 16)
        gl.vertexAttribDivisor(location, 1)
      }
      buffers.push(matrixBuffer)
      if (instances.instanceColors) colorBuffer = attribute(ATTRIBUTES.instanceColor, instances.instanceColors, 3, 1)
      else gl.vertexAttrib3f(ATTRIBUTES.instanceColor, 1, 1, 1)
    }

    let indexType = 0
    if (geometry.indices) {
      const buffer = /** @type {WebGLBuffer} */ (gl.createBuffer())
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.indices, gl.STATIC_DRAW)
      buffers.push(buffer)
      indexType = geometry.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT
    }
    gl.bindVertexArray(null)

    entry = { vao, buffers, count: geometry.elementCount, indexType, geometry, version: geometry.version,
      instanceVersion: instances?.version ?? 0, matrixBuffer, colorBuffer, attributes, layout }
    cache.set(key, entry)
    return entry
  }

  /**
   * Draw a mesh's triangles - instanced or not, indexed or not - with the program in use, as far as
   * its drawn count goes. Every pass that draws meshes draws them this way.
   * @param {Geometry} geometry @param {{ instanceMatrices: Float32Array, instanceColors: Float32Array | null, version: number, count: number } | null} instances
   * @param {boolean} [withTangents] for brushed metal
   * @returns {number} triangles drawn
   */
  drawTriangles(geometry, instances, withTangents = false) {
    const gl = this.gl
    const buffers = this.mesh(geometry, instances, true, withTangents)
    gl.bindVertexArray(buffers.vao)
    const elements = geometry.drawnCount - geometry.drawnCount % 3
    const count = instances ? instances.count : 1
    if (buffers.indexType) {
      if (instances) gl.drawElementsInstanced(gl.TRIANGLES, elements, buffers.indexType, 0, count)
      else gl.drawElements(gl.TRIANGLES, elements, buffers.indexType, 0)
    } else if (instances) gl.drawArraysInstanced(gl.TRIANGLES, 0, elements, count)
    else gl.drawArrays(gl.TRIANGLES, 0, elements)
    return elements / 3 * count
  }

  /** @param {WebGLBuffer | null | undefined} buffer @param {Float32Array} data */
  #refill(buffer, data) {
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, /** @type {WebGLBuffer} */ (buffer))
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data)
  }

  /**
   * Vertex array for Lines: one instance per segment with its two endpoints (and colours),
   * expanded to a screen-space quad in the vertex shader.
   * @param {Geometry} geometry
   * @returns {MeshBuffers}
   */
  lines(geometry) {
    this.#mark(geometry)
    let entry = this.#lines.get(geometry)
    if (entry && entry.version === geometry.version) return entry
    if (entry) this.#free(entry)
    else this.#watch(geometry, geometry, this.#lines)

    const gl = this.gl
    const p = geometry.positions, c = geometry.colors, idx = geometry.indices
    const segments = geometry.elementCount / 2
    const ends = new Float32Array(segments * 6)
    const colors = new Float32Array(segments * 6).fill(1)
    for (let s = 0; s < segments; s++) {
      const i0 = idx ? idx[s * 2] : s * 2, i1 = idx ? idx[s * 2 + 1] : s * 2 + 1
      for (let k = 0; k < 3; k++) {
        ends[s * 6 + k] = p[i0 * 3 + k]
        ends[s * 6 + 3 + k] = p[i1 * 3 + k]
        if (c) {
          colors[s * 6 + k] = c[i0 * 3 + k]
          colors[s * 6 + 3 + k] = c[i1 * 3 + k]
        }
      }
    }

    const vao = /** @type {WebGLVertexArrayObject} */ (gl.createVertexArray())
    gl.bindVertexArray(vao)
    /** @type {WebGLBuffer[]} */
    const buffers = []
    const interleavedPair = (data, first, second) => {
      const buffer = /** @type {WebGLBuffer} */ (gl.createBuffer())
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
      for (const [location, offset] of [[first, 0], [second, 12]]) {
        gl.enableVertexAttribArray(location)
        gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 24, offset)
        gl.vertexAttribDivisor(location, 1)
      }
      buffers.push(buffer)
    }
    interleavedPair(ends, ATTRIBUTES.segmentStart, ATTRIBUTES.segmentEnd)
    interleavedPair(colors, ATTRIBUTES.segmentColorStart, ATTRIBUTES.segmentColorEnd)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#cornerBuffer())
    gl.enableVertexAttribArray(ATTRIBUTES.corner)
    gl.vertexAttribPointer(ATTRIBUTES.corner, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)

    entry = { vao, buffers, count: segments, indexType: 0, geometry, version: geometry.version, instanceVersion: 0 }
    this.#lines.set(geometry, entry)
    return entry
  }

  /**
   * The GL texture for a Texture - a 1x1 white placeholder until its image has loaded.
   * @param {Texture} texture
   * @returns {WebGLTexture}
   */
  texture(texture) {
    if (!texture.image) return this.#whiteTexture()
    this.#mark(texture)
    const gl = this.gl
    let entry = this.#textures.get(texture)
    if (entry && entry.version === texture.version) return entry.texture
    if (!entry) {
      entry = { texture: /** @type {WebGLTexture} */ (gl.createTexture()), version: -1 }
      this.#textures.set(texture, entry)
      this.counts.textures++
      texture.onDispose(() => this.#freeTexture(texture))
    }
    gl.activeTexture(gl.TEXTURE0 + UPLOAD_UNIT)
    gl.bindTexture(gl.TEXTURE_2D, entry.texture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, texture.flipY)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    const image = texture.image
    if ('data' in image) {
      // raw pixels: bytes as usual, floats (HDR) as half floats, which filter everywhere
      const d = /** @type {DataImage} */ (image)
      const float = d.data instanceof Float32Array
      const internal = float ? gl.RGBA16F : texture.colorSpace === 'srgb' ? gl.SRGB8_ALPHA8 : gl.RGBA8
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, d.width, d.height, 0, gl.RGBA, float ? gl.FLOAT : gl.UNSIGNED_BYTE, d.data)
    } else {
      // sRGB textures are stored as sRGB so sampling returns linear values, filtered correctly
      const internal = texture.colorSpace === 'srgb' ? gl.SRGB8_ALPHA8 : gl.RGBA8
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, gl.RGBA, gl.UNSIGNED_BYTE, /** @type {TexImageSource} */ (image))
    }
    const wrap = { repeat: gl.REPEAT, clamp: gl.CLAMP_TO_EDGE, mirror: gl.MIRRORED_REPEAT }[texture.wrap]
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap)
    const nearest = texture.filter === 'nearest'
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearest ? gl.NEAREST : gl.LINEAR)
    if (texture.mipmaps) {
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearest ? gl.NEAREST_MIPMAP_NEAREST : gl.LINEAR_MIPMAP_LINEAR)
      // sharp at glancing angles - as far as the GPU goes
      const aniso = this.#anisotropic()
      if (aniso && !nearest) gl.texParameterf(gl.TEXTURE_2D, aniso.ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(texture.anisotropy, aniso.max))
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearest ? gl.NEAREST : gl.LINEAR)
    }
    entry.version = texture.version
    return entry.texture
  }

  /**
   * A renderer is done with a scene: free the GPU copies of its geometry and textures that no
   * other renderer still draws.
   * @param {object} owner @param {Scene} scene
   */
  release(owner, scene) {
    /** @type {Set<object>} */
    const keys = new Set()
    const env = /** @type {any} */ (scene).environment, bg = /** @type {any} */ (scene).background
    if (env && typeof env === 'object') keys.add(env)
    if (bg && 'version' in bg) keys.add(bg)
    scene.traverse((n) => {
      const d = /** @type {any} */ (n)
      if (!d.isDrawable) return
      keys.add(d.geometry)
      if ('instanceMatrices' in d) keys.add(d)
      for (const [, t] of d.material.textures) keys.add(t)
    })
    for (const key of keys) {
      const users = this.#usedBy.get(key)
      if (!users?.delete(owner) || users.size) continue
      this.#usedBy.delete(key)
      for (const cache of [this.#triangles, this.#points, this.#lines]) {
        const entry = cache.get(key)
        if (!entry) continue
        this.#free(entry)
        cache.delete(key)
        this.counts.geometries--
      }
      this.#freeTexture(/** @type {Texture} */ (key))
    }
  }

  /** @param {object} key */
  #mark(key) {
    if (!this.owner) return
    let users = this.#usedBy.get(key)
    if (!users) this.#usedBy.set(key, users = new Set())
    users.add(this.owner)
  }

  /** @param {Texture} texture */
  #freeTexture(texture) {
    const entry = this.#textures.get(texture)
    if (!entry) return
    this.gl.deleteTexture(entry.texture)
    this.#textures.delete(texture)
    this.counts.textures--
  }

  /** Forget everything - after a lost context, when every GL object is already gone. */
  reset() {
    this.#triangles = new WeakMap()
    this.#points = new WeakMap()
    this.#lines = new WeakMap()
    this.#textures = new WeakMap()
    this.#usedBy = new WeakMap()
    this.#white = null
    this.#corners = null
    // extensions go with a lost context; the next texture asks for this one again
    this.#aniso = undefined
    this.counts = { geometries: 0, textures: 0 }
  }

  // free GL objects for a geometry when it is disposed
  /** @param {Geometry} geometry @param {object} key @param {WeakMap<object, MeshBuffers>} cache */
  #watch(geometry, key, cache) {
    this.counts.geometries++
    geometry.onDispose(() => {
      const entry = cache.get(key)
      // gone, or the node has another geometry now
      if (!entry || entry.geometry !== geometry) return
      this.#free(entry)
      cache.delete(key)
      this.counts.geometries--
    })
  }

  /** @param {MeshBuffers} entry */
  #free(entry) {
    const gl = this.gl
    gl.deleteVertexArray(entry.vao)
    for (const b of entry.buffers) gl.deleteBuffer(b)
  }

  #whiteTexture() {
    if (this.#white) return this.#white
    const gl = this.gl
    this.#white = /** @type {WebGLTexture} */ (gl.createTexture())
    gl.activeTexture(gl.TEXTURE0 + UPLOAD_UNIT)
    gl.bindTexture(gl.TEXTURE_2D, this.#white)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]))
    return this.#white
  }

  #cornerBuffer() {
    if (this.#corners) return this.#corners
    const gl = this.gl
    this.#corners = /** @type {WebGLBuffer} */ (gl.createBuffer())
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#corners)
    gl.bufferData(gl.ARRAY_BUFFER, LINE_CORNERS, gl.STATIC_DRAW)
    return this.#corners
  }
}
