import { checkNumber, checkOneOf, checkOptions, describe, fail } from '../validate.js'

/**
 * Raw pixels, RGBA, top row first: bytes for ordinary images, floats for HDR (linear radiance).
 * @typedef {{ data: Uint8Array | Float32Array, width: number, height: number }} DataImage
 */
/** @typedef {HTMLImageElement | HTMLCanvasElement | HTMLVideoElement | ImageBitmap | OffscreenCanvas | DataImage} TextureImage */

/**
 * @typedef {object} TextureOptions
 * @property {TextureImage} [image] the pixels; omit and give a url to load them
 * @property {string} [url] image to load (starts loading immediately in a browser); a .hdr file loads as
 *   linear HDR radiance, for scene.environment; a video (.mp4, .webm, .ogv, .mov, .m4v) plays muted and on a
 *   loop, and texture.image is its <video> to pause, seek or unmute
 * @property {'srgb' | 'linear'} [colorSpace] 'srgb' for colour maps (default), 'linear' for data
 *   maps such as normal and roughness maps
 * @property {'repeat' | 'clamp' | 'mirror'} [wrap] (default 'repeat')
 * @property {number[]} [repeat] [u, v] (default [1, 1])
 * @property {number[]} [offset] [u, v] (default [0, 0])
 * @property {number} [rotation] turns the image on the surface, in radians, about `center` (default 0)
 * @property {number[]} [center] [u, v] the point rotation turns about, in repeated UVs (default [0, 0], the
 *   corner, as glTF has it; [0.5, 0.5] for the middle of an unrepeated image)
 * @property {0 | 1} [uvSet] which UV set to read: 0 the first, 1 the second (Geometry uvs2) - baked occlusion
 *   and light maps usually come on the second (default 0)
 * @property {'linear' | 'nearest'} [filter] (default 'linear')
 * @property {boolean} [mipmaps] (default true; false for a video, which would make them every frame)
 * @property {number} [anisotropy] samples along a surface seen at a glancing angle - floors and roads
 *   stay sharp into the distance. Up to what the GPU allows; 1 is off (default 8)
 * @property {boolean} [flipY] flip on upload; false for glTF-style UVs (default false)
 */

const OPTIONS = ['image', 'url', 'colorSpace', 'wrap', 'repeat', 'offset', 'rotation', 'center', 'uvSet', 'filter', 'mipmaps', 'anisotropy', 'flipY']
const DEFAULTS = { colorSpace: 'srgb', wrap: 'repeat', repeat: [1, 1], offset: [0, 0], rotation: 0, center: [0, 0], uvSet: 0, filter: 'linear',
  mipmaps: true, anisotropy: 8, flipY: false }

const HINTS = {
  src: "use 'url' for the image address",
  encoding: "use colorSpace: 'srgb' | 'linear'",
  wrapS: "use wrap: 'repeat' | 'clamp' | 'mirror' (applies to both directions)",
  maxAnisotropy: "use 'anisotropy' - samples along glancing angles, 1 for off",
  channel: "use 'uvSet' - 0 for the first UV set, 1 for the second",
  texCoord: "use 'uvSet' - 0 for the first UV set, 1 for the second",
  scale: "use 'repeat' - [u, v] times across",
}

/**
 * An image for a material map. A video's frames upload by themselves as it plays; after drawing on
 * a canvas, call `needsUpdate()`.
 */
export class Texture {
  /** The options it takes, and hints for names people reach for instead. */
  static OPTIONS = OPTIONS
  static HINTS = HINTS
  /** @type {TextureImage | null} */
  #image = null
  /** @type {string | null} */
  url = null
  /** @type {'srgb' | 'linear'} */
  #colorSpace = 'srgb'
  /** set by the app, rather than left to its default - a material's data slot leaves it alone then */
  #colorSpaceSet = false
  /** @type {'repeat' | 'clamp' | 'mirror'} */
  wrap = 'repeat'
  repeat = [1, 1]
  offset = [0, 0]
  /** Turns the image on the surface, in radians, about `center`. */
  rotation = 0
  /** [u, v] the point rotation turns about, in repeated UVs. */
  center = [0, 0]
  /** Which UV set it reads: 0 the first, 1 the second (Geometry uvs2). @type {0 | 1} */
  uvSet = 0
  /** @type {'linear' | 'nearest'} */
  filter = 'linear'
  mipmaps = true
  /** Samples along glancing angles, up to the GPU's limit; 1 is off. Call needsUpdate() after changing it. */
  anisotropy = 8
  flipY = false
  /** @internal Bumped by needsUpdate() so renderers re-upload. */
  version = 0
  /** Resolves when the image is available (immediately when one was given). @type {Promise<Texture>} */
  ready

  /** @type {Set<() => void>} */
  #onDispose = new Set()

  /** @param {TextureOptions | string} [options] options, or just a url */
  constructor(options = {}) {
    if (typeof options === 'string') options = { url: options }
    checkOptions('Texture', options, OPTIONS, HINTS)
    const o = { ...DEFAULTS, ...options }
    this.#colorSpace = checkOneOf('Texture', 'colorSpace', o.colorSpace, ['srgb', 'linear'])
    this.#colorSpaceSet = options.colorSpace !== undefined
    this.wrap = checkOneOf('Texture', 'wrap', o.wrap, ['repeat', 'clamp', 'mirror'])
    this.filter = checkOneOf('Texture', 'filter', o.filter, ['linear', 'nearest'])
    this.repeat = pair('repeat', o.repeat)
    this.offset = pair('offset', o.offset)
    this.rotation = checkNumber('Texture', 'rotation', o.rotation)
    this.center = pair('center', o.center)
    if (o.uvSet !== 0 && o.uvSet !== 1) fail('Texture', `'uvSet' is 0 (the first UV set) or 1 (the second), got ${describe(o.uvSet)}`)
    this.uvSet = o.uvSet
    // a video would make mipmaps every frame: off unless asked for
    this.mipmaps = options.mipmaps !== undefined ? !!options.mipmaps : !(isVideo(o.image) || (!o.image && VIDEO.test(o.url ?? '')))
    this.anisotropy = checkNumber('Texture', 'anisotropy', o.anisotropy)
    if (!(this.anisotropy >= 1)) fail('Texture', `'anisotropy' is how many samples along a glancing angle - 1 (off) or more, got ${this.anisotropy}`)
    this.flipY = !!o.flipY
    this.url = o.url ?? null

    if (o.image) {
      this.image = o.image
      this.ready = isVideo(o.image) ? loaded(/** @type {HTMLVideoElement} */ (o.image)).then(() => this) : Promise.resolve(this)
      this.ready.catch(() => {})
    } else if (this.url) {
      this.ready = this.#load(this.url)
      // a failed load is reported by whoever awaits `ready`; don't also raise an unhandled rejection
      this.ready.catch(() => {})
    } else {
      fail('Texture', "needs an 'image' or a 'url'")
    }
  }

  /** Call after redrawing a canvas or advancing a video. @returns {this} */
  /**
   * The pixels: null until loaded. A <video>'s frames upload by themselves while it plays.
   * @returns {TextureImage | null}
   */
  get image() { return this.#image }
  /** @param {TextureImage | null} v */
  set image(v) {
    this.#image = v
    this.needsUpdate()
    if (isVideo(v)) this.#follow(/** @type {HTMLVideoElement} */ (v))
  }

  // Each new frame of a playing video marks the texture changed, so views redraw with it: the
  // browser's own per-frame callback where there is one, otherwise a check every animation frame
  // while it plays. Following stops when the image is replaced.
  /** @param {HTMLVideoElement} video */
  #follow(video) {
    if (typeof video.requestVideoFrameCallback === 'function') {
      const frame = () => {
        if (this.#image !== video) return
        this.needsUpdate()
        video.requestVideoFrameCallback(frame)
      }
      video.requestVideoFrameCallback(frame)
      return
    }
    let last = -1, running = false
    const tick = () => {
      if (this.#image !== video || video.paused || video.ended) {
        running = false
        return
      }
      if (video.currentTime !== last) {
        last = video.currentTime
        this.needsUpdate()
      }
      requestAnimationFrame(tick)
    }
    const start = () => {
      if (running || this.#image !== video) return
      running = true
      requestAnimationFrame(tick)
    }
    video.addEventListener('play', start)
    // a seek while paused shows a new frame too
    video.addEventListener('seeked', () => {
      if (this.#image === video) this.needsUpdate()
    })
    if (!video.paused) start()
  }

  /** 'srgb' for colour (decoded to linear by the GPU), 'linear' for data such as normals and roughness. Call needsUpdate() after changing it. @returns {'srgb' | 'linear'} */
  get colorSpace() { return this.#colorSpace }
  set colorSpace(v) {
    this.#colorSpace = checkOneOf('Texture', 'colorSpace', v, ['srgb', 'linear'])
    this.#colorSpaceSet = true
  }

  /** @internal Whether the app chose the colour space, rather than leaving the default. @returns {boolean} */
  get colorSpaceSet() { return this.#colorSpaceSet }

  needsUpdate() {
    this.version++
    return this
  }

  /** Release the GPU copy. @returns {void} */
  dispose() {
    for (const fn of this.#onDispose) fn()
  }

  /** @internal For renderers. Returns an unsubscribe function. @param {() => void} fn */
  onDispose(fn) {
    this.#onDispose.add(fn)
    return () => this.#onDispose.delete(fn)
  }

  /** A description (url plus options that differ from the defaults), or null for an in-memory image. */
  toJSON() {
    if (!this.url) return null
    /** @type {Record<string, unknown>} */
    const json = { url: this.url }
    for (const [key, value] of Object.entries(DEFAULTS)) {
      const current = this[/** @type {keyof typeof DEFAULTS} */ (key)]
      if (JSON.stringify(current) !== JSON.stringify(value)) json[key] = current
    }
    return json
  }

  /** HDR radiance rather than display colours - floats, tone mapped when drawn. @returns {boolean} */
  get isHDR() {
    return !!this.image && 'data' in this.image && this.image.data instanceof Float32Array
  }

  /** @param {string} url @returns {Promise<Texture>} */
  async #load(url) {
    if (VIDEO.test(url)) {
      if (typeof document === 'undefined') throw new Error(`Texture: can't load '${url}' - no video support in this environment`)
      const video = document.createElement('video')
      // muted, so browsers let it play by itself; inline, so phones don't take it full screen
      Object.assign(video, { crossOrigin: 'anonymous', muted: true, loop: true, playsInline: true, autoplay: true, src: url })
      try {
        await loaded(video)
      } catch {
        throw new Error(`Texture: failed to load '${url}'`)
      }
      // a browser that won't autoplay leaves it paused on its first frame: video.play() on a click starts it
      video.play()?.catch(() => {})
      this.image = video
      return this
    }
    if (/\.hdr($|[?#])/i.test(url)) {
      const [{ parseHDR }, response] = await Promise.all([import('../hdr.js'), fetch(url)])
      if (!response.ok) throw new Error(`Texture: failed to load '${url}' (${response.status})`)
      this.image = parseHDR(await response.arrayBuffer())
      this.colorSpace = 'linear'
      return this
    }
    if (typeof Image === 'undefined') {
      throw new Error(`Texture: can't load '${url}' - no Image support in this environment`)
    }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = url
    try {
      await img.decode()
    } catch {
      throw new Error(`Texture: failed to load '${url}'`)
    }
    this.image = img
    return this
  }
}

const VIDEO = /\.(mp4|webm|ogv|mov|m4v)($|[?#])/i

/** @internal A <video>, whose frames change as it plays. @param {unknown} image @returns {boolean} */
export function isVideo(image) {
  return typeof HTMLVideoElement !== 'undefined' && image instanceof HTMLVideoElement
}

/** Resolves once a video has a frame to show. @param {HTMLVideoElement} video @returns {Promise<void>} */
function loaded(video) {
  if (video.readyState >= 2) return Promise.resolve()
  return new Promise((resolve, reject) => {
    video.addEventListener('loadeddata', () => resolve(), { once: true })
    video.addEventListener('error', () => reject(new Error('Texture: the video failed to load')), { once: true })
  })
}

/**
 * Load an image as a texture; resolves once it has decoded.
 * @param {string} url
 * @param {Omit<TextureOptions, 'url' | 'image'>} [options]
 * @returns {Promise<Texture>}
 */
export function loadTexture(url, options = {}) {
  return new Texture({ ...options, url }).ready
}

/** @param {string} name @param {unknown} v @returns {number[]} */
function pair(name, v) {
  if (!Array.isArray(v) || v.length !== 2 || v.some((n) => typeof n !== 'number')) {
    fail('Texture', `'${name}' must be [u, v], got ${describe(v)}`)
  }
  return [v[0], v[1]]
}
