// Change detection for on-demand rendering. Each frame the View lays out a flat signature of
// everything that affects the picture - transforms, visibility, geometry and instance versions,
// material values, lights, labels, the camera - and draws only when it differs from the last one.
// It costs a few numbers per node, so an idle view does almost no work.

/** @import { Scene } from './scene/Scene.js' */
/** @import { Camera } from './scene/cameras.js' */

// object identity as a number, so swapping a geometry, material or texture counts as a change
/** @type {WeakMap<object, number>} */
const ids = new WeakMap()
let nextId = 1
/** @param {object} o */
const idOf = (o) => {
  let id = ids.get(o)
  if (id === undefined) ids.set(o, id = nextId++)
  return id
}

export class ChangeWatch {
  #values = new Float64Array(256)
  #previous = new Float64Array(256)
  #count = 0
  #previousCount = -1
  /** @type {string[]} */ #strings = []
  /** @type {string[]} */ #previousStrings = []

  /**
   * Has anything that affects the picture changed since the last call? The first call says yes.
   * @param {Scene} scene
   * @param {Camera} camera
   * @returns {boolean}
   */
  changed(scene, camera) {
    this.#count = 0
    this.#strings = []
    this.#camera(camera)
    this.#scene(scene)

    let changed = this.#count !== this.#previousCount || this.#strings.length !== this.#previousStrings.length
    for (let i = 0; !changed && i < this.#count; i++) changed = this.#values[i] !== this.#previous[i]
    for (let i = 0; !changed && i < this.#strings.length; i++) changed = this.#strings[i] !== this.#previousStrings[i]

    // keep this signature as the one to compare against next time
    ;[this.#previous, this.#values] = [this.#values, this.#previous]
    this.#previousCount = this.#count
    this.#previousStrings = this.#strings
    return changed
  }

  /** Forget the last signature, so the next check reports a change. */
  reset() {
    this.#previousCount = -1
  }

  /** @param {number} v */
  #push(v) {
    if (this.#count === this.#values.length) {
      const grown = new Float64Array(this.#values.length * 2)
      grown.set(this.#values)
      this.#values = grown
      const previous = new Float64Array(grown.length)
      previous.set(this.#previous)
      this.#previous = previous
    }
    this.#values[this.#count++] = v
  }

  /** @param {ArrayLike<number>} a */
  #pushAll(a) {
    for (let i = 0; i < a.length; i++) this.#push(a[i])
  }

  /** @param {any} camera */
  #camera(camera) {
    this.#push(idOf(camera))
    this.#pushAll(camera.position)
    this.#pushAll(camera.quaternion)
    if (camera.target) this.#pushAll(camera.target)
    this.#push(camera.fov ?? camera.height)
    this.#push(camera.near)
    this.#push(camera.far)
    this.#push(camera.aspect)
  }

  /** @param {any} scene */
  #scene(scene) {
    const bg = scene.background
    if (!bg) this.#push(-1)
    else if ('getHex' in bg) this.#pushAll(bg)
    else this.#texture(bg)
    const env = scene.environment
    if (typeof env === 'string') this.#strings.push(env)
    else this.#texture(env)
    this.#push(scene.environmentIntensity)
    this.#push(scene.backgroundBlur)
    const fog = scene.fog
    if (fog) {
      this.#pushAll(fog.color)
      this.#push(fog.density)
      this.#push(fog.near)
      this.#push(fog.far)
    } else this.#push(-1)
    this.#node(scene)
  }

  /** @param {any} node */
  #node(node) {
    this.#push(idOf(node))
    this.#push(node.visible ? 1 : 0)
    // hidden subtrees aren't drawn, so their insides don't matter until they show again
    if (!node.visible) return
    this.#push(node.overlay ? idOf(node.overlay) : 0)
    // a section plane moving or changing colour
    const clip = node.clip
    if (clip) {
      this.#pushAll(clip.normal)
      this.#push(clip.offset)
      this.#push(clip.cap ? clip.cap.getHex() : -1)
    } else this.#push(-2)
    this.#pushAll(node.position)
    this.#pushAll(node.quaternion)
    this.#pushAll(node.scale)
    if (node.isDrawable) this.#drawable(node)
    else if (node.isLabel) this.#label(node)
    else if (node.lightKind) this.#light(node)
    for (const child of node.children) this.#node(child)
  }

  /** @param {any} node */
  #drawable(node) {
    const g = node.geometry, m = node.material
    this.#push(idOf(g))
    this.#push(g.version)
    this.#push(g.drawCount ?? -1)
    this.#push(node.renderOrder)
    this.#push((node.castShadow ? 1 : 0) | (node.receiveShadow ? 2 : 0))
    // per-instance labels come from these, so swapping either redraws
    this.#push(node.labels ? idOf(node.labels) : 0)
    this.#push(node.data && typeof node.data === 'object' ? idOf(node.data) : 0)
    if ('instanceMatrices' in node) {
      this.#push(node.count)
      this.#push(node.version)
    }
    this.#push(idOf(m))
    this.#pushAll(m.color)
    this.#pushAll(m.emissive)
    this.#push(m.emissiveIntensity)
    this.#push(m.opacity)
    this.#push(m.roughness)
    this.#push(m.metalness)
    this.#push(m.size)
    this.#push(m.width)
    this.#push(m.alphaTest)
    this.#push(m.normalScale)
    this.#push(m.aoMapIntensity)
    this.#push((m.unlit ? 1 : 0) | (m.flatShading ? 2 : 0) | (m.doubleSided ? 4 : 0) | (m.vertexColors ? 8 : 0) |
      (m.depthWrite ? 16 : 0) | (m.depthTest ? 32 : 0) | (m.sizeAttenuation ? 64 : 0) | (m.blending === 'additive' ? 128 : 0) | (m.transparent ? 256 : 0) | (m.fog ? 512 : 0))
    for (const [, texture] of m.textures) this.#texture(texture)
  }

  /** @param {any} texture */
  #texture(texture) {
    this.#push(idOf(texture))
    this.#push(texture.version)
    this.#pushAll(texture.repeat)
    this.#pushAll(texture.offset)
  }

  /** @param {any} label */
  #label(label) {
    this.#strings.push(label.text, label.className, label.place, label.overlap, label.edge ?? '')
    this.#pushAll(label.offset)
    this.#push(label.priority)
    this.#push(label.occlude ? 1 : 0)
    this.#push(label.leader ? 1 : 0)
  }

  /** @param {any} light */
  #light(light) {
    this.#pushAll(light.color)
    this.#push(light.intensity)
    if (light.ground) this.#pushAll(light.ground)
    if (light.direction) this.#pushAll(light.direction)
    if (light.target) this.#pushAll(light.target)
    if (light.castShadow) this.#push(1)
    if ('range' in light) this.#push(light.range)
    if ('angle' in light) {
      this.#push(light.angle)
      this.#push(light.penumbra)
    }
  }
}
