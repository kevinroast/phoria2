// A texture drawn by a camera: what the camera sees, as a map for any material - a camera feed on a
// monitor, a minimap on a panel, a second view of a product beside it. The view drawing a material
// that shows one draws it first, from its camera, each frame it draws (or every nth, or only when
// asked). It is drawn plainly - lights, shadows, fog and background, but none of the view's effects
// (bloom, ambient occlusion, ground shadow, FXAA) - and whatever shows the texture is left out of it,
// so a monitor never films itself.
import { Texture } from './Texture.js'
import { Camera } from '../scene/cameras.js'
import { Scene } from '../scene/Scene.js'
import { checkOneOf, checkOptions, describe, fail } from '../validate.js'

/**
 * @typedef {object} RenderTextureOptions
 * @property {Camera} camera what it sees from - a camera of its own, placed (or parented) in the scene
 * @property {Scene} [scene] what it draws (default: the scene of the view showing it)
 * @property {number} [width] in pixels (default 512)
 * @property {number} [height] in pixels (default 512) - the camera's aspect follows width / height
 * @property {'frame' | 'manual' | number} [update] when it is drawn: 'frame' - each frame the view
 *   draws (default); a number n - every nth; 'manual' - once, then after each needsUpdate()
 * @property {'repeat' | 'clamp' | 'mirror'} [wrap] (default 'clamp')
 * @property {number[]} [repeat] [u, v] (default [1, 1])
 * @property {number[]} [offset] [u, v] (default [0, 0])
 * @property {number} [rotation] radians, about `center` (default 0)
 * @property {number[]} [center] [u, v] (default [0, 0])
 * @property {0 | 1} [uvSet] which UV set to read (default 0)
 * @property {'linear' | 'nearest'} [filter] (default 'linear')
 * @property {boolean} [mipmaps] mip levels for reading it smaller than it is - a monitor across the
 *   room (default true)
 * @property {number} [anisotropy] samples along a glancing angle, 1 for off (default 8)
 */

const OPTIONS = ['camera', 'scene', 'width', 'height', 'update', 'wrap', 'repeat', 'offset', 'rotation', 'center', 'uvSet', 'filter', 'mipmaps', 'anisotropy']
const HINTS = {
  ...Texture.HINTS,
  size: "use 'width' and 'height', in pixels",
  resolution: "use 'width' and 'height', in pixels",
  refresh: "use update: 'frame', a number n (every nth frame) or 'manual'",
  every: "use update: n - drawn every nth frame",
  url: 'a RenderTexture is drawn by its camera - for an image use Texture',
  image: 'a RenderTexture is drawn by its camera - for an image use Texture',
}
const MAX_SIZE = 4096

/** A texture drawn from a camera, for any material's map. */
export class RenderTexture extends Texture {
  /** The options it takes, and hints for names people reach for instead. */
  static OPTIONS = OPTIONS
  static HINTS = HINTS
  /** @internal Marks it for renderers, which draw it rather than upload it. */
  isRenderTexture = true
  /** What it sees from. @type {Camera} */ camera
  /** What it draws; null for the scene of the view showing it. @type {Scene | null} */ scene = null
  /** When it is drawn: 'frame', every nth frame, or 'manual'. @type {'frame' | 'manual' | number} */ update = 'frame'
  #width = 512
  #height = 512
  /** @internal For renderers: frames seen since it was last drawn, and the version it was drawn at. */
  drawn = { frames: 0, version: -1 }

  /** @param {RenderTextureOptions} options */
  constructor(options) {
    if (!options || typeof options !== 'object') fail('RenderTexture', `needs options with a 'camera', got ${describe(options)}`)
    checkOptions('RenderTexture', options, OPTIONS, HINTS)
    const { camera, scene, width, height, update, ...texture } = options
    // drawn on the GPU, so the image is a stand-in that is never uploaded
    super({ image: { data: new Uint8Array(4), width: 1, height: 1 }, wrap: 'clamp', ...texture })
    if (!(camera instanceof Camera)) fail('RenderTexture', `'camera' must be a camera - a PerspectiveCamera or OrthographicCamera of its own - got ${describe(camera)}`)
    this.camera = camera
    if (scene !== undefined && scene !== null) {
      if (!(scene instanceof Scene)) fail('RenderTexture', `'scene' must be a Scene, got ${describe(scene)}`)
      this.scene = scene
    }
    if (width !== undefined) this.width = width
    if (height !== undefined) this.height = height
    if (update !== undefined) this.update = checkUpdate(update)
  }

  /** In pixels; the camera's aspect follows width / height. @returns {number} */
  get width() { return this.#width }
  /** @param {number} v */
  set width(v) { this.#width = checkSize('width', v) }

  /** In pixels. @returns {number} */
  get height() { return this.#height }
  /** @param {number} v */
  set height(v) { this.#height = checkSize('height', v) }

  /** A render texture can't be written as JSON: its camera is a live object. @returns {null} */
  toJSON() {
    return null
  }
}

/** @param {string} name @param {unknown} v */
function checkSize(name, v) {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > MAX_SIZE) fail('RenderTexture', `'${name}' must be a whole number of pixels, 1 to ${MAX_SIZE}, got ${describe(v)}`)
  return v
}

/** @param {unknown} v @returns {'frame' | 'manual' | number} */
function checkUpdate(v) {
  if (typeof v === 'number') {
    if (!Number.isInteger(v) || v < 1) fail('RenderTexture', `'update' as a number is how many frames apart it is drawn - a whole number, 1 or more, got ${v}`)
    return v
  }
  return /** @type {'frame' | 'manual'} */ (checkOneOf('RenderTexture', 'update', v, ['frame', 'manual']))
}
