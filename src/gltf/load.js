// glTF 2.0 (.gltf and .glb) to phoria2 nodes: meshes, the metallic-roughness material and its maps,
// textures, the node hierarchy, cameras, KHR_lights_punctual and node animations. glTF's
// conventions are phoria2's (+Y up, metres, counter-clockwise front faces, linear colour), so
// little needs converting.
import * as quat from '../math/quat.js'
import { Group } from '../scene/Node.js'
import { Drawable, Mesh, Points, Lines } from '../scene/drawables.js'
import { PerspectiveCamera, OrthographicCamera } from '../scene/cameras.js'
import { DirectionalLight, PointLight, SpotLight } from '../scene/lights.js'
import { Geometry } from '../geometry/Geometry.js'
import { Material } from '../material/Material.js'
import { Texture } from '../material/Texture.js'
import { PhoriaError, warnOnce } from '../validate.js'
import { Animation } from './Animation.js'

/** @import { Node } from '../scene/Node.js' */
/** @import { Camera } from '../scene/cameras.js' */
/** @import { Track } from './Animation.js' */

/**
 * @typedef {object} GLTFOptions
 * @property {string} [baseUrl] where relative uris resolve from (default: the file's own url)
 * @property {boolean} [waitForTextures] resolve once every texture has loaded, so the first frame
 *   is complete (default true)
 */

const SUPPORTED = new Set(['KHR_materials_emissive_strength', 'KHR_texture_transform', 'KHR_lights_punctual',
  'KHR_materials_unlit', 'KHR_mesh_quantization'])
const COMPRESSION = new Set(['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'])

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }
const ARRAYS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }
// normalized integers map to 0-1 (unsigned) or -1-1 (signed)
const NORMALIZE = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535, 5125: 1 }
const WRAP = { 33071: 'clamp', 33648: 'mirror', 10497: 'repeat' }

/** A loaded glTF scene: a Group, plus the file's animations and cameras. */
export class Model extends Group {
  static type = 'model'
  /** @type {Animation[]} */ animations = []
  /** @type {Camera[]} */ cameras = []

  /**
   * Every mesh, point set and line set in the model - to change them together:
   * `for (const m of model.meshes) m.castShadow = true`.
   * @returns {Drawable[]}
   */
  get meshes() {
    return /** @type {Drawable[]} */ (this.findAll((n) => n instanceof Drawable))
  }

  /**
   * Play an animation by name or index (the first when not given).
   * @param {string | number} [which]
   * @returns {Animation | null}
   */
  play(which = 0) {
    const a = typeof which === 'number' ? this.animations[which] : this.animations.find((x) => x.name === which)
    if (!a) {
      const names = this.animations.map((x) => `'${x.name}'`).join(', ')
      warnOnce(this, `no animation ${typeof which === 'number' ? which : `'${which}'`} - this model has ${names || 'none'}`)
      return null
    }
    return a.play()
  }

  /**
   * A plain group of its parts, so create() can build it back without phoria2/gltf - with their
   * vertex data, but not the animations, or textures embedded in a .glb (they have no url).
   * @returns {Record<string, any>}
   */
  toJSON() {
    return { ...super.toJSON(), type: 'group' }
  }
}

/**
 * Load a .gltf or .glb file into a Model (a Group): add it to the scene, frame it, find its parts by
 * name. Resolves once its textures have loaded.
 *
 *     const model = await loadGLTF('chair.glb')
 *     view.scene.add(model)
 *     view.frame(model)
 *     model.find('Cushion').material.color.set('#2a6')
 *
 * @param {string} url
 * @param {GLTFOptions} [options]
 * @returns {Promise<Model>}
 */
export async function loadGLTF(url, options = {}) {
  const response = await fetch(url).catch((e) => { throw new PhoriaError(`loadGLTF: couldn't fetch '${url}' - ${e.message}`) })
  if (!response.ok) throw new PhoriaError(`loadGLTF: couldn't fetch '${url}' (${response.status} ${response.statusText})`)
  const base = options.baseUrl ?? new URL(url, globalThis.location?.href ?? 'file:///').href
  return parseGLTF(await response.arrayBuffer(), { ...options, baseUrl: base })
}

/**
 * Build a Model from a .glb file's bytes, a .gltf file's bytes or text, or its parsed JSON.
 * @param {ArrayBuffer | Uint8Array | string | Record<string, any>} data
 * @param {GLTFOptions} [options]
 * @returns {Promise<Model>}
 */
export async function parseGLTF(data, options = {}) {
  const { json, bin } = unpack(data)
  const version = String(json.asset?.version ?? '')
  if (!version.startsWith('2.')) throw new PhoriaError(`loadGLTF: glTF ${version || '(no version)'} isn't supported - only glTF 2.0`)
  for (const ext of json.extensionsRequired ?? []) {
    if (SUPPORTED.has(ext)) continue
    const hint = COMPRESSION.has(ext) ? ' - export the model without compression for now' : ''
    throw new PhoriaError(`loadGLTF: the model requires '${ext}', which isn't supported${hint}`)
  }
  const model = new Model({ name: json.scenes?.[json.scene ?? 0]?.name ?? 'model' })
  for (const ext of json.extensionsUsed ?? []) {
    if (!SUPPORTED.has(ext)) warnOnce(model, `the model uses '${ext}', which isn't supported - it is ignored`)
  }
  const build = new Builder(json, bin, options.baseUrl ?? '', model)
  await build.buffers()
  build.scene()
  // either way, embedded images' object urls are released once their textures settle
  const textures = build.textures()
  if (options.waitForTextures ?? true) await textures
  return model
}

/** @param {ArrayBuffer | Uint8Array | string | Record<string, any>} data */
function unpack(data) {
  if (typeof data === 'string') return { json: JSON.parse(data), bin: null }
  if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) return { json: data, bin: null }
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // 'glTF' little-endian: a binary container of a JSON chunk and an optional binary chunk
  if (bytes.length >= 12 && view.getUint32(0, true) === 0x46546c67) {
    let json = null, bin = null
    for (let at = 12; at + 8 <= bytes.length;) {
      const length = view.getUint32(at, true), type = view.getUint32(at + 4, true)
      const chunk = bytes.subarray(at + 8, at + 8 + length)
      if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk))
      else if (type === 0x004e4942) bin = chunk
      at += 8 + length
    }
    if (!json) throw new PhoriaError('loadGLTF: the .glb file has no JSON chunk')
    return { json, bin }
  }
  return { json: JSON.parse(new TextDecoder().decode(bytes)), bin: null }
}

class Builder {
  /** @type {Uint8Array[]} */ #buffers = []
  /** @type {Map<string, Texture>} */ #textures = new Map()
  /** @type {Map<number, Material>} */ #materials = new Map()
  /** @type {Map<string, Geometry>} */ #geometries = new Map()
  /** @type {Node[]} */ #nodes = []
  /** @type {string[]} */ #objectUrls = []

  /** @param {Record<string, any>} json @param {Uint8Array | null} bin @param {string} base @param {Model} model */
  constructor(json, bin, base, model) {
    this.json = json
    this.bin = bin
    this.base = base
    this.model = model
  }

  /** @param {string} uri */
  #resolve(uri) {
    try {
      return new URL(uri, this.base || undefined).href
    } catch {
      return uri
    }
  }

  async buffers() {
    this.#buffers = await Promise.all((this.json.buffers ?? []).map(async (b, i) => {
      if (b.uri === undefined) {
        if (i !== 0 || !this.bin) throw new PhoriaError(`loadGLTF: buffer ${i} has no uri and there is no binary chunk`)
        return this.bin
      }
      const url = this.#resolve(b.uri)
      const response = await fetch(url).catch((e) => { throw new PhoriaError(`loadGLTF: couldn't fetch buffer '${b.uri}' - ${e.message}`) })
      if (!response.ok) throw new PhoriaError(`loadGLTF: couldn't fetch buffer '${b.uri}' (${response.status})`)
      return new Uint8Array(await response.arrayBuffer())
    }))
  }

  /** Resolves when every texture has loaded (failures are warned about, not thrown). */
  async textures() {
    await Promise.all([...this.#textures.values()].map((t) => t.ready.catch((e) => warnOnce(this.model, e.message))))
    for (const url of this.#objectUrls) URL.revokeObjectURL(url)
  }

  scene() {
    const json = this.json
    this.#nodes = (json.nodes ?? []).map((_, i) => this.#node(i))
    // parent after every node exists, since children can come before their parents
    ;(json.nodes ?? []).forEach((n, i) => {
      for (const c of n.children ?? []) this.#nodes[i].add(this.#nodes[c])
    })
    const scene = json.scenes?.[json.scene ?? 0]
    const roots = scene ? scene.nodes ?? [] : this.#nodes.map((_, i) => i).filter((i) => !this.#nodes[i].parent)
    for (const i of roots) this.model.add(this.#nodes[i])
    this.model.animations = (json.animations ?? []).map((a, i) => this.#animation(a, i))
    if (this.model.animations.length) {
      const model = this.model
      model.onUpdate((_node, dt) => {
        for (const a of model.animations) a.advance(dt)
      })
    }
  }

  /** @param {number} index @returns {Node} */
  #node(index) {
    const n = this.json.nodes[index]
    const name = n.name ?? `node ${index}`
    if (n.skin !== undefined) warnOnce(this.model, `skinned meshes aren't supported - '${name}' is drawn in its bind pose`)
    if (n.weights || (n.mesh !== undefined && this.json.meshes[n.mesh].weights)) warnOnce(this.model, "morph targets aren't supported - meshes are drawn without them")

    const parts = n.mesh !== undefined ? this.#mesh(n.mesh) : []
    // a node with one primitive is that drawable; with several, a group of them
    /** @type {Node} */
    const node = parts.length === 1 ? parts[0] : new Group()
    for (const part of parts.length > 1 ? parts : []) node.add(part)
    node.name = name
    if (n.matrix) decompose(node, n.matrix)
    else {
      if (n.translation) node.position.set(n.translation[0], n.translation[1], n.translation[2])
      if (n.rotation) node.quaternion.set(n.rotation[0], n.rotation[1], n.rotation[2], n.rotation[3])
      if (n.scale) node.scale.set(n.scale[0], n.scale[1], n.scale[2])
    }
    if (n.camera !== undefined) {
      const camera = this.#camera(n.camera)
      node.add(camera)
      this.model.cameras.push(camera)
    }
    const light = n.extensions?.KHR_lights_punctual?.light
    if (light !== undefined) node.add(this.#light(light))
    if (n.extras && typeof n.extras === 'object') node.userData = { ...n.extras }
    return node
  }

  /** @param {number} index @returns {Node[]} */
  #mesh(index) {
    const m = this.json.meshes[index]
    return m.primitives.map((p, i) => {
      const geometry = this.#geometry(p)
      const material = p.material !== undefined ? this.#material(p.material) : this.#defaultMaterial()
      const mode = p.mode ?? 4
      /** @type {Node} */
      let node
      if (mode === 0) node = new Points({ geometry, material: pointMaterial(material) })
      else if (mode === 1 || mode === 2 || mode === 3) node = new Lines({ geometry: lineList(geometry, mode), material: pointMaterial(material) })
      else node = new Mesh({ geometry: mode === 4 ? geometry : triangleList(geometry, mode), material })
      node.name = m.primitives.length > 1 ? `${m.name ?? `mesh ${index}`} ${i}` : m.name ?? `mesh ${index}`
      return node
    })
  }

  /** @param {Record<string, any>} p */
  #geometry(p) {
    // primitives often share accessors; share their geometry too
    const key = JSON.stringify([p.attributes, p.indices])
    const cached = this.#geometries.get(key)
    if (cached) return cached
    const a = p.attributes
    if (a.POSITION === undefined) throw new PhoriaError('loadGLTF: a mesh primitive has no POSITION')
    /** @type {import('../geometry/Geometry.js').GeometryOptions} */
    const options = { positions: this.#accessor(a.POSITION) }
    if (a.NORMAL !== undefined) options.normals = this.#accessor(a.NORMAL)
    if (a.TEXCOORD_0 !== undefined) options.uvs = this.#accessor(a.TEXCOORD_0)
    if (a.COLOR_0 !== undefined) options.colors = srgbColors(/** @type {Float32Array} */ (this.#accessor(a.COLOR_0)), COMPONENTS[this.json.accessors[a.COLOR_0].type])
    if (p.indices !== undefined) options.indices = this.#accessor(p.indices, true)
    const geometry = new Geometry(options)
    this.#geometries.set(key, geometry)
    return geometry
  }

  /**
   * An accessor's numbers, as floats (normalized integers scaled), or as integers for indices.
   * @param {number} index @param {boolean} [integers]
   * @returns {Float32Array | Uint32Array}
   */
  #accessor(index, integers = false) {
    const acc = this.json.accessors[index]
    const size = COMPONENTS[acc.type]
    const count = acc.count * size
    const out = integers ? new Uint32Array(count) : new Float32Array(count)
    const scale = acc.normalized && !integers ? 1 / NORMALIZE[acc.componentType] : 1
    if (acc.bufferView !== undefined) this.#read(acc.bufferView, acc.byteOffset ?? 0, acc.componentType, size, acc.count, out, scale)
    if (acc.sparse) {
      // a few elements replaced: indices of the elements, then their values
      const s = acc.sparse
      const at = new Uint32Array(s.count)
      this.#read(s.indices.bufferView, s.indices.byteOffset ?? 0, s.indices.componentType, 1, s.count, at, 1)
      const values = integers ? new Uint32Array(s.count * size) : new Float32Array(s.count * size)
      this.#read(s.values.bufferView, s.values.byteOffset ?? 0, acc.componentType, size, s.count, values, scale)
      for (let i = 0; i < s.count; i++) out.set(values.subarray(i * size, i * size + size), at[i] * size)
    }
    if (acc.normalized && !integers && (acc.componentType === 5120 || acc.componentType === 5122)) {
      for (let i = 0; i < out.length; i++) out[i] = Math.max(out[i], -1)
    }
    return out
  }

  /**
   * Copy elements out of a buffer view, honouring its stride.
   * @param {number} viewIndex @param {number} offset @param {number} type component type
   * @param {number} size components per element @param {number} count elements
   * @param {Float32Array | Uint32Array} out @param {number} scale
   */
  #read(viewIndex, offset, type, size, count, out, scale) {
    const bv = this.json.bufferViews[viewIndex]
    const buffer = this.#buffers[bv.buffer]
    const Type = ARRAYS[type]
    if (!Type) throw new PhoriaError(`loadGLTF: unknown component type ${type}`)
    const bytes = Type.BYTES_PER_ELEMENT
    const stride = bv.byteStride || size * bytes
    const start = buffer.byteOffset + (bv.byteOffset ?? 0) + offset
    const view = new DataView(buffer.buffer)
    const get = {
      5120: (/** @type {number} */ o) => view.getInt8(o),
      5121: (/** @type {number} */ o) => view.getUint8(o),
      5122: (/** @type {number} */ o) => view.getInt16(o, true),
      5123: (/** @type {number} */ o) => view.getUint16(o, true),
      5125: (/** @type {number} */ o) => view.getUint32(o, true),
      5126: (/** @type {number} */ o) => view.getFloat32(o, true),
    }[type]
    // the common case - tightly packed and aligned floats - is one copy
    if (type === 5126 && stride === size * 4 && start % 4 === 0 && scale === 1 && out instanceof Float32Array) {
      out.set(new Float32Array(buffer.buffer, start, count * size))
      return
    }
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < size; c++) out[i * size + c] = get(start + i * stride + c * bytes) * scale
    }
  }

  /** @param {number} index @returns {Material} */
  #material(index) {
    const cached = this.#materials.get(index)
    if (cached) return cached
    const m = this.json.materials[index]
    const pbr = m.pbrMetallicRoughness ?? {}
    const material = new Material({ name: m.name ?? `material ${index}` })
    const base = pbr.baseColorFactor ?? [1, 1, 1, 1]
    material.color.setLinear(base[0], base[1], base[2])
    material.metalness = pbr.metallicFactor ?? 1
    material.roughness = pbr.roughnessFactor ?? 1
    if (pbr.baseColorTexture) material.map = this.#texture(pbr.baseColorTexture, 'srgb')
    if (pbr.metallicRoughnessTexture) {
      // one texture: roughness in green, metalness in blue - exactly what the two slots read
      material.roughnessMap = material.metalnessMap = this.#texture(pbr.metallicRoughnessTexture, 'linear')
    }
    if (m.normalTexture) {
      material.normalMap = this.#texture(m.normalTexture, 'linear')
      material.normalScale = m.normalTexture.scale ?? 1
    }
    if (m.occlusionTexture) {
      material.aoMap = this.#texture(m.occlusionTexture, 'linear')
      material.aoMapIntensity = Math.min(Math.max(m.occlusionTexture.strength ?? 1, 0), 1)
    }
    if (m.emissiveFactor) material.emissive.setLinear(m.emissiveFactor[0], m.emissiveFactor[1], m.emissiveFactor[2])
    if (m.emissiveTexture) {
      material.emissiveMap = this.#texture(m.emissiveTexture, 'srgb')
      if (!m.emissiveFactor) material.emissive.setLinear(1, 1, 1)
    }
    material.emissiveIntensity = m.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1
    if (m.extensions?.KHR_materials_unlit) material.unlit = true
    if (m.alphaMode === 'BLEND') {
      material.opacity = base[3]
      material.transparent = true
      material.depthWrite = false
    } else if (m.alphaMode === 'MASK') {
      material.alphaTest = m.alphaCutoff ?? 0.5
    }
    material.doubleSided = !!m.doubleSided
    this.#materials.set(index, material)
    return material
  }

  // glTF's default for primitives without a material
  #defaultMaterial() {
    let material = this.#materials.get(-1)
    if (!material) this.#materials.set(-1, material = new Material({ name: 'default', metalness: 1, roughness: 1 }))
    return material
  }

  /**
   * @param {Record<string, any>} info a textureInfo: index, texCoord, extensions
   * @param {'srgb' | 'linear'} colorSpace what the slot holds
   * @returns {Texture}
   */
  #texture(info, colorSpace) {
    const transform = info.extensions?.KHR_texture_transform
    const texCoord = transform?.texCoord ?? info.texCoord ?? 0
    if (texCoord !== 0) warnOnce(this.model, 'textures on a second UV set (TEXCOORD_1) are drawn with the first')
    if (transform?.rotation) warnOnce(this.model, "rotated texture transforms (KHR_texture_transform rotation) aren't supported - drawn unrotated")
    const key = JSON.stringify([info.index, colorSpace, transform?.offset, transform?.scale])
    const cached = this.#textures.get(key)
    if (cached) return cached

    const t = this.json.textures[info.index]
    const sampler = this.json.samplers?.[t.sampler] ?? {}
    const image = this.json.images[t.source]
    if (t.source === undefined || !image) throw new PhoriaError(`loadGLTF: texture ${info.index} has no image (compressed textures aren't supported)`)
    let url
    if (image.bufferView !== undefined) {
      const bv = this.json.bufferViews[image.bufferView]
      const buffer = this.#buffers[bv.buffer]
      const bytes = buffer.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength)
      url = URL.createObjectURL(new Blob([/** @type {Uint8Array<ArrayBuffer>} */ (bytes)], { type: image.mimeType ?? 'image/png' }))
      this.#objectUrls.push(url)
    } else {
      url = this.#resolve(image.uri)
    }
    const texture = new Texture({
      url,
      colorSpace,
      wrap: WRAP[sampler.wrapS ?? 10497] ?? 'repeat',
      filter: sampler.magFilter === 9728 ? 'nearest' : 'linear',
      // glTF UVs start at the image's top left, as phoria2's do
      flipY: false,
      repeat: transform?.scale ?? [1, 1],
      offset: transform?.offset ?? [0, 0],
    })
    this.#textures.set(key, texture)
    return texture
  }

  /** @param {number} index @returns {Camera} */
  #camera(index) {
    const c = this.json.cameras[index]
    const name = c.name ?? `camera ${index}`
    if (c.type === 'orthographic') {
      const o = c.orthographic
      return new OrthographicCamera({ name, height: o.ymag * 2, near: o.znear, far: o.zfar })
    }
    const p = c.perspective
    return new PerspectiveCamera({ name, fov: (p.yfov * 180) / Math.PI, near: p.znear, far: p.zfar ?? 1e6 })
  }

  /** @param {number} index */
  #light(index) {
    const l = this.json.extensions?.KHR_lights_punctual?.lights?.[index]
    if (!l) throw new PhoriaError(`loadGLTF: KHR_lights_punctual light ${index} doesn't exist`)
    const c = l.color ?? [1, 1, 1]
    // glTF lights shine down their node's -Z; intensities are lux and candela, divided by PI for
    // phoria2's lights (where 1 lights a white surface to white)
    const options = { name: l.name, intensity: (l.intensity ?? 1) / Math.PI }
    let light
    if (l.type === 'directional') light = new DirectionalLight({ ...options, direction: [0, 0, -1] })
    else if (l.type === 'spot') {
      const outer = l.spot?.outerConeAngle ?? Math.PI / 4, inner = l.spot?.innerConeAngle ?? 0
      light = new SpotLight({ ...options, direction: [0, 0, -1], range: l.range ?? 0, angle: outer, penumbra: outer > 0 ? 1 - inner / outer : 0 })
    } else light = new PointLight({ ...options, range: l.range ?? 0 })
    light.color.setLinear(c[0], c[1], c[2])
    return light
  }

  /** @param {Record<string, any>} a @param {number} index @returns {Animation} */
  #animation(a, index) {
    /** @type {Track[]} */
    const tracks = []
    for (const ch of a.channels) {
      const path = { translation: 'position', rotation: 'quaternion', scale: 'scale' }[ch.target.path]
      if (!path) {
        warnOnce(this.model, `'${ch.target.path}' animations aren't supported - only translation, rotation and scale`)
        continue
      }
      const node = this.#nodes[ch.target.node]
      if (!node) continue
      const s = a.samplers[ch.sampler]
      tracks.push({
        node, path,
        times: /** @type {Float32Array} */ (this.#accessor(s.input)),
        values: /** @type {Float32Array} */ (this.#accessor(s.output)),
        interpolation: s.interpolation ?? 'LINEAR',
      })
    }
    return new Animation(a.name ?? `animation ${index}`, tracks)
  }
}

/** Set a node's position, rotation and scale from a column-major matrix. @param {Node} node @param {number[]} m */
function decompose(node, m) {
  let sx = Math.hypot(m[0], m[1], m[2])
  const sy = Math.hypot(m[4], m[5], m[6]), sz = Math.hypot(m[8], m[9], m[10])
  // a mirroring matrix: put the flip in x
  const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5])
  if (det < 0) sx = -sx
  const r = [m[0] / sx, m[1] / sx, m[2] / sx, m[4] / sy, m[5] / sy, m[6] / sy, m[8] / sz, m[9] / sz, m[10] / sz]
  const q = quat.normalize([0, 0, 0, 1], quat.fromMat3([0, 0, 0, 1], r))
  node.position.set(m[12], m[13], m[14])
  node.quaternion.set(q[0], q[1], q[2], q[3])
  node.scale.set(sx, sy, sz)
}

/** glTF vertex colours are linear RGB(A); phoria2's are sRGB RGB. @param {Float32Array} c @param {number} size */
function srgbColors(c, size) {
  const n = c.length / size
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const v = Math.min(Math.max(c[i * size + k], 0), 1)
      out[i * 3 + k] = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055
    }
  }
  return out
}

/** Points and Lines take their colour and size from a lit material's basics. @param {Material} m */
function pointMaterial(m) {
  return new Material({ name: m.name, color: m.color.getStyle(), opacity: m.opacity, map: m.map, vertexColors: true, size: 2, sizeAttenuation: false })
}

/** Triangle strips and fans as a plain triangle list. @param {Geometry} g @param {number} mode */
function triangleList(g, mode) {
  const index = g.indices ?? Uint32Array.from({ length: g.vertexCount }, (_, i) => i)
  const out = []
  for (let i = 2; i < index.length; i++) {
    if (mode === 6) out.push(index[0], index[i - 1], index[i])
    // strips alternate winding, so every other triangle swaps two corners
    else if (i % 2 === 0) out.push(index[i - 2], index[i - 1], index[i])
    else out.push(index[i - 1], index[i - 2], index[i])
  }
  return withIndices(g, out, true)
}

/** Line strips and loops as segment pairs. @param {Geometry} g @param {number} mode */
function lineList(g, mode) {
  if (mode === 1) return g
  const index = g.indices ?? Uint32Array.from({ length: g.vertexCount }, (_, i) => i)
  const out = []
  for (let i = 1; i < index.length; i++) out.push(index[i - 1], index[i])
  if (mode === 2 && index.length > 2) out.push(index[index.length - 1], index[0])
  return withIndices(g, out, false)
}

/** @param {Geometry} g @param {number[]} indices @param {boolean} triangles keep normals (lines have none) */
function withIndices(g, indices, triangles) {
  // only normals the file gave - reading g.normals would work them out from the strip's own indices,
  // taken as a triangle list; the new geometry works them out from its real triangles instead
  return new Geometry({ positions: g.positions, normals: triangles && g.hasNormals ? g.normals : undefined, uvs: g.uvs ?? undefined, colors: g.colors ?? undefined, indices })
}
