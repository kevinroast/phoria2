import * as mat3 from '../math/mat3.js'
import * as mat4 from '../math/mat4.js'
import { Geometry } from '../geometry/Geometry.js'
import { Material } from '../material/Material.js'
import { CLIP_ONLY_FRAGMENT, ENCODE_FRAGMENT, FULLSCREEN_VERTEX, MESH_VERTEX } from './shaders.js'
import { hookFailed, hookFor, setHookUniforms } from './hooks.js'
import { placementDefines, setShapeUniforms, shapeDefines } from './shape.js'
import { featureDefines, secondUvDefines, setFeatureUniforms } from '../material/features.js'
import { collect, solidItems } from '../frame.js'
import { Box3 } from '../value/Box3.js'
import { checkNumber, checkOneOf, checkOptions, checkRange, describe, fail, warnOnce } from '../validate.js'
import { GLContext } from './context.js'
import { uvMatrix } from './resources.js'
import { blit } from './targets.js'
import { drawKind } from '../scene/kinds.js'

/** @import { FrameDescription, DrawItem, FrameLight, FrameCap } from '../frame.js' */
/** @import { Scene } from '../scene/Scene.js' */
/** @import { Camera } from '../scene/cameras.js' */
/** @import { Texture } from '../material/Texture.js' */
/** @import { Environment } from './passes.js' */
/** @import { GPUHit } from './picking.js' */
/** @import { ShadowMap } from './passes.js' */
/** @import { Occlusion } from './effects.js' */
/** @import { Target } from './targets.js' */
/** @import { RenderTexture } from '../material/RenderTexture.js' */

/**
 * What one frame is drawn with - worked out at its start and passed down, not kept on the renderer,
 * so a frame can be drawn inside another (into a texture) without either overwriting the other.
 * @typedef {object} FrameState
 * @property {boolean} wait complete: wait for shaders rather than leave what is compiling out
 * @property {boolean} linear drawn in linear light into float targets, encoded to sRGB at the end
 * @property {number} width @property {number} height the pixels drawn
 * @property {Environment | null} environment the prefiltered environment, when it is an HDR image
 * @property {ShadowMap[]} shadows directional, spot and point, for the meshes that receive them
 * @property {Record<string, any>} lights the lights' uniforms
 * @property {string[]} lightDefines the light counts and environment, compiled into lit programs
 * @property {boolean} studio lit by the built-in studio environment
 * @property {Occlusion | null} occlusion ambient occlusion, for the lit opaque meshes
 */

/**
 * Where a frame is drawn instead of the canvas: a framebuffer, and its size. An `srgb` target encodes
 * what is written into it itself (SRGB8_ALPHA8), so the frame is drawn in linear light into it.
 * @typedef {{ framebuffer: WebGLFramebuffer, width: number, height: number, srgb?: boolean }} RenderTarget
 */

/**
 * A step of the picture's post chain: it reads the picture so far and draws into `output`.
 * @typedef {{ run: (picture: WebGLTexture, output: WebGLFramebuffer | null) => void, linear: boolean }} PostStep
 *   linear: what it draws is still in linear light (so the target between it and the next is float)
 */

/** @typedef {'aces' | 'neutral' | 'none'} ToneMapping */

/**
 * Glow round the bright parts of the picture - emissive materials, additive points and lines, lit
 * highlights - as light spills round them through a lens.
 * @typedef {object} BloomOptions
 * @property {number} [strength] how much glow is added (default 1)
 * @property {number} [radius] 0 - 1: how far it spreads (default 0.6)
 * @property {number} [threshold] 0 - 1: how bright a colour has to be to glow (default 0.6)
 */

/**
 * @typedef {object} WebGLRendererOptions
 * @property {HTMLCanvasElement | OffscreenCanvas} canvas
 * @property {boolean} [shared] draw with the page's one shared WebGL context and copy the picture to
 *   this canvas, instead of giving the canvas a context of its own - for pages with many views
 *   (browsers allow about 16 live contexts). The View decides this; see its 'context' option.
 * @property {boolean} [antialias] multisampling (default true; a shared context always has it)
 * @property {boolean} [outlineAntialias] soft-edged outlines with round corners (default: as antialias)
 * @property {ToneMapping} [toneMapping] how lit colours are mapped to the screen: 'neutral' keeps colours
 *   true (Khronos PBR Neutral, the default), 'aces' is filmic, 'none' clips
 * @property {number} [exposure] (default 1)
 * @property {number} [pixelRatio] drawing buffer pixels per CSS pixel (default 1; View sets it)
 * @property {boolean | BloomOptions} [bloom] glow round bright parts (default off); loads its code the first time
 * @property {boolean | AmbientOcclusionOptions} [ambientOcclusion] shading in the creases (default off);
 *   loads its code the first time
 * @property {boolean | GroundShadowOptions} [groundShadow] a soft shadow on the ground under the solids
 *   (default off); loads its code the first time
 * @property {boolean} [fxaa] smooth jagged edges with a pass over the finished picture - for edges
 *   multisampling misses (cut-outs, thin lines, shader detail) or when antialias is off (default off)
 */

const OPTIONS = ['canvas', 'shared', 'antialias', 'outlineAntialias', 'toneMapping', 'exposure', 'pixelRatio', 'bloom', 'ambientOcclusion', 'groundShadow', 'fxaa']
const BLOOM = { strength: 1, radius: 0.6, threshold: 0.6 }
/** What bloom: { ... } takes, and hints for names people reach for instead. */
export const BLOOM_OPTIONS = Object.keys(BLOOM)
export const BLOOM_HINTS = { intensity: "use 'strength'", amount: "use 'strength'", size: "use 'radius'", blur: "use 'radius'" }
const HINTS = { alpha: 'the canvas is always transparent where the scene has no background' }

/**
 * Bloom options as settings: true for the defaults, false or null for none.
 * @param {string} owner @param {boolean | BloomOptions | null | undefined} value
 * @returns {Required<BloomOptions> | null}
 */
export function bloomSettings(owner, value) {
  // bloom has always taken any number and clamped it when drawing: out of range is said, not thrown
  return effectSettings(owner, 'bloom', value, BLOOM, BLOOM_HINTS, { strength: [0, Infinity], radius: [0, 1], threshold: [0, 1] }, true)
}
/**
 * Shading in the creases: ambient and environment light dimmed where surfaces close in on each other
 * - corners, gaps, where things meet the ground - worked out from the depth of the picture.
 * Direct light from the lights is left alone, and so are unlit materials, points and lines.
 * @typedef {object} AmbientOcclusionOptions
 * @property {number} [strength] how dark the creases get (default 1)
 * @property {number} [radius] how far round each point to look for what hides it, in world units
 *   (default: about a twentieth of the size of the scene's solids)
 */

/**
 * A soft shadow on the ground under the scene's solids, darkest where they touch it - the product
 * viewer's floor shadow, with no light needed. Every opaque mesh casts it but those that only
 * receive shadows (`receiveShadow` on, `castShadow` off - floors).
 * @typedef {object} GroundShadowOptions
 * @property {number} [opacity] 0 - 1: how dark it is where things touch the ground (default 0.6)
 * @property {number} [softness] 0 - 1: how blurred it is (default 0.5)
 * @property {number} [height] how far above the ground something still casts, in world units
 *   (default: half the size of the solids)
 * @property {number} [y] the ground's height (default: the bottom of the solids)
 * @property {number} [size] how wide the shadow's square is, in world units (default: from the solids)
 */

const AMBIENT_OCCLUSION = { strength: 1, radius: /** @type {number | null} */ (null) }
const GROUND_SHADOW = { opacity: 0.6, softness: 0.5, height: /** @type {number | null} */ (null), y: /** @type {number | null} */ (null), size: /** @type {number | null} */ (null) }
/** What ambientOcclusion: { ... } takes, and hints for names people reach for instead. */
export const AMBIENT_OCCLUSION_OPTIONS = Object.keys(AMBIENT_OCCLUSION)
export const AMBIENT_OCCLUSION_HINTS = { intensity: "use 'strength'", amount: "use 'strength'", distance: "use 'radius'", size: "use 'radius'" }
/** What groundShadow: { ... } takes, and hints for names people reach for instead. */
export const GROUND_SHADOW_OPTIONS = Object.keys(GROUND_SHADOW)
export const GROUND_SHADOW_HINTS = { intensity: "use 'opacity'", strength: "use 'opacity'", darkness: "use 'opacity'", blur: "use 'softness'", far: "use 'height'", distance: "use 'height'", width: "use 'size'" }

/**
 * An effect's options as settings: true for the defaults, false or null for none.
 * @template {Record<string, number | null>} T
 * @param {string} owner @param {string} name @param {unknown} value @param {T} defaults
 * @param {Record<string, string>} hints @param {Record<string, [number, number]>} ranges
 * @param {boolean} [warnOutOfRange] say a number out of its range rather than throw - for settings
 *   that took any number before their ranges were checked
 * @returns {T | null}
 */
function effectSettings(owner, name, value, defaults, hints, ranges, warnOutOfRange = false) {
  if (value === undefined || value === null || value === false) return null
  if (value === true) return { ...defaults }
  const keys = Object.keys(defaults)
  if (typeof value !== 'object' || Array.isArray(value)) fail(owner, `${name} is true, false or { ${keys.join(', ')} }, got ${describe(value)}`)
  checkOptions(`${owner} ${name}`, value, keys, hints)
  const settings = /** @type {Record<string, number | null>} */ ({ ...defaults })
  for (const key of keys) {
    const v = /** @type {Record<string, unknown>} */ (value)[key]
    if (v === undefined || (v === null && defaults[key] === null)) continue
    const [min, max] = ranges[key] ?? [-Infinity, Infinity]
    const n = checkNumber(`${owner} ${name}`, key, v)
    if (warnOutOfRange && (n < min || n > max)) warnOnce(value, `${owner} ${name}: '${key}' is ${max === Infinity ? `${min} or more` : `from ${min} to ${max}`}, got ${n} - drawn as the nearest that is`)
    settings[key] = warnOutOfRange ? n : checkRange(`${owner} ${name}`, key, n, min, max)
  }
  return /** @type {T} */ (settings)
}

/**
 * Ambient occlusion options as settings: true for the defaults, false or null for none.
 * @param {string} owner @param {boolean | AmbientOcclusionOptions | null | undefined} value
 * @returns {typeof AMBIENT_OCCLUSION | null}
 */
export function ambientOcclusionSettings(owner, value) {
  return effectSettings(owner, 'ambientOcclusion', value, AMBIENT_OCCLUSION, AMBIENT_OCCLUSION_HINTS, { strength: [0, Infinity], radius: [0, Infinity] })
}

/**
 * Ground shadow options as settings: true for the defaults, false or null for none.
 * @param {string} owner @param {boolean | GroundShadowOptions | null | undefined} value
 * @returns {typeof GROUND_SHADOW | null}
 */
export function groundShadowSettings(owner, value) {
  return effectSettings(owner, 'groundShadow', value, GROUND_SHADOW, GROUND_SHADOW_HINTS, { opacity: [0, 1], softness: [0, 1], height: [0, Infinity], size: [0, Infinity] })
}

const TONE_MAPPING = { none: 0, aces: 1, neutral: 2 }
/** @type {import('./passes.js').ShadowMap[]} */
const NO_SHADOWS = []
// the step out of linear light, at the end of a linear frame's chain
const ENCODE = /** @type {[string, string]} */ ([FULLSCREEN_VERTEX, ENCODE_FRAGMENT])
// counting a cap's faces into the stencil: the solids' surfaces, colour and depth left alone
const CLIP_MASK = /** @type {[string, string]} */ ([MESH_VERTEX, CLIP_ONLY_FRAGMENT])
// a cap: a square on the plane, two units across, facing +Y until it is placed
const CAP_SQUARE = new Geometry({
  positions: [-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], normals: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
  uvs: [0, 0, 1, 0, 1, 1, 0, 1], indices: [0, 2, 1, 0, 3, 2],
})
// what a cap is drawn as - a plain node, never in a scene
const CAP_NODE = /** @type {any} */ ({ drawMode: 'triangles', receiveShadow: true, castShadow: false, renderOrder: 0 })

/**
 * The world bounds of a frame's solids - what the effects' default sizes come from.
 * @param {FrameDescription} frame
 */
function solidsBox(frame) {
  const box = new Box3()
  for (const [node] of frame.solids) node.expandBounds(box)
  return box
}

/**
 * Draws a scene with WebGL 2. The View creates one; use it directly to drive your own loop:
 *
 *     const renderer = new WebGLRenderer({ canvas })
 *     renderer.setSize(canvas.clientWidth, canvas.clientHeight, devicePixelRatio)
 *     scene.update(dt, t)
 *     renderer.render(scene, camera)
 */
export class WebGLRenderer {
  /** The options it takes, and hints for names people reach for instead. */
  static OPTIONS = OPTIONS
  static HINTS = HINTS
  /** The canvas the picture ends up on. @type {HTMLCanvasElement | OffscreenCanvas} */ canvas
  /** @type {ToneMapping} */ #toneMapping = 'neutral'
  #exposure = 1
  #pixelRatio = 1
  #outlineAntialias = true
  #fxaa = false
  /** @type {Required<BloomOptions> | null} */ #bloom = null
  /** @type {typeof AMBIENT_OCCLUSION | null} */ #ambientOcclusion = null
  /** @type {typeof GROUND_SHADOW | null} */ #groundShadow = null
  /** Counts from the last frame and the GPU caches; renderTextures is how many were drawn for it. */
  info = { drawCalls: 0, triangles: 0, programs: 0, geometries: 0, textures: 0, compiling: 0, renderTextures: 0 }
  /**
   * Called when something the last frame couldn't draw yet is ready - the code for HDR
   * environments, backgrounds and shadows, which loads the first time a scene has one. The View
   * redraws then. @type {(() => void) | null}
   */
  onReady = null

  /** The context drawn with: the canvas's own, or the page's shared one. @type {GLContext} */
  #gpu
  /** With a shared context: the canvas's 2D context, which the picture is copied into. @type {CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null} */
  #copy = null
  /** @type {Float32Array} */ #normalMatrix = new Float32Array(9)
  /** Model-view for sorting points back to front. */
  #modelView = new Float32Array(16)
  /** A cap's material, by colour, so each colour compiles and uploads once. @type {Map<number, Material>} */ #capMaterials = new Map()

  /** @param {WebGLRendererOptions} options */
  constructor(options) {
    checkOptions('WebGLRenderer', options, OPTIONS, HINTS)
    if (!options?.canvas) fail('WebGLRenderer', "'canvas' is required")
    this.canvas = options.canvas
    if (options.toneMapping !== undefined) this.toneMapping = options.toneMapping
    if (options.exposure !== undefined) this.exposure = options.exposure
    if (options.pixelRatio !== undefined) this.pixelRatio = options.pixelRatio
    this.#bloom = bloomSettings('WebGLRenderer', options.bloom)
    this.#ambientOcclusion = ambientOcclusionSettings('WebGLRenderer', options.ambientOcclusion)
    this.#groundShadow = groundShadowSettings('WebGLRenderer', options.groundShadow)
    this.fxaa = !!options.fxaa
    // outlines follow the picture's antialiasing unless told otherwise (a shared context always has it)
    this.outlineAntialias = options.outlineAntialias !== undefined ? !!options.outlineAntialias : options.shared || options.antialias !== false

    if (options.shared) {
      this.#gpu = GLContext.shared()
      const copy = this.canvas.getContext('2d')
      if (!copy) fail('WebGLRenderer', "a shared renderer's canvas needs a 2D context - give it a canvas that has no WebGL context yet")
      this.#copy = /** @type {CanvasRenderingContext2D} */ (copy)
    } else {
      this.#gpu = new GLContext(this.canvas, { antialias: options.antialias })
    }
    this.#gpu.users.add(this)
  }

  /**
   * Glow round the bright parts of the picture: null for none, or its settings. Set true, false or
   * { strength, radius, threshold }; change its numbers in place to tune it.
   * @returns {Required<BloomOptions> | null}
   */
  get bloom() {
    return this.#bloom
  }

  /** @param {boolean | BloomOptions | null} value */
  set bloom(value) {
    this.#bloom = bloomSettings('WebGLRenderer', value)
  }

  /** How lit colours are mapped to the screen: 'neutral' (the default), 'aces' or 'none'. @returns {ToneMapping} */
  get toneMapping() {
    return this.#toneMapping
  }

  /** @param {ToneMapping} value */
  set toneMapping(value) {
    this.#toneMapping = checkOneOf('WebGLRenderer', 'toneMapping', value, ['aces', 'neutral', 'none'])
  }

  /** How bright lit colours are made before they are mapped to the screen (default 1). @returns {number} */
  get exposure() {
    return this.#exposure
  }

  /** @param {number} value */
  set exposure(value) {
    this.#exposure = checkRange('WebGLRenderer', 'exposure', value, 0)
  }

  /** Drawing buffer pixels per CSS pixel - setSize() sets it too. @returns {number} */
  get pixelRatio() {
    return this.#pixelRatio
  }

  /** @param {number} value */
  set pixelRatio(value) {
    this.#pixelRatio = checkRange('WebGLRenderer', 'pixelRatio', value, 0, Infinity, { above: true })
  }

  /** Outlines with soft edges and round corners, or hard pixel steps; takes effect on the next frame. @returns {boolean} */
  get outlineAntialias() {
    return this.#outlineAntialias
  }

  /** @param {boolean} value */
  set outlineAntialias(value) {
    this.#outlineAntialias = !!value
  }

  /** Smoothing jagged edges with a pass over the finished picture; takes effect on the next frame. @returns {boolean} */
  get fxaa() {
    return this.#fxaa
  }

  /** @param {boolean} value */
  set fxaa(value) {
    this.#fxaa = !!value
  }

  /**
   * Shading in the creases: null for none, or its settings. Set true, false or { strength, radius };
   * change its numbers in place to tune it.
   * @returns {typeof AMBIENT_OCCLUSION | null}
   */
  get ambientOcclusion() {
    return this.#ambientOcclusion
  }

  /** @param {boolean | AmbientOcclusionOptions | null} value */
  set ambientOcclusion(value) {
    this.#ambientOcclusion = ambientOcclusionSettings('WebGLRenderer', value)
  }

  /**
   * A soft shadow on the ground under the solids: null for none, or its settings. Set true, false or
   * { opacity, softness, height, y, size }; change its numbers in place to tune it.
   * @returns {typeof GROUND_SHADOW | null}
   */
  get groundShadow() {
    return this.#groundShadow
  }

  /** @param {boolean | GroundShadowOptions | null} value */
  set groundShadow(value) {
    this.#groundShadow = groundShadowSettings('WebGLRenderer', value)
  }

  /** The WebGL 2 context drawn with - shared with other renderers when `shared` is set. @returns {WebGL2RenderingContext} */
  get gl() {
    return this.#gpu.gl
  }

  /** Drawing with the page's shared context? */
  get shared() {
    return this.#gpu.isShared
  }

  /**
   * Size the drawing buffer for a CSS size and pixel ratio. (The canvas's CSS size is left alone.)
   * @param {number} width CSS pixels
   * @param {number} height CSS pixels
   * @param {number} [pixelRatio]
   */
  setSize(width, height, pixelRatio = this.pixelRatio) {
    this.pixelRatio = pixelRatio
    this.canvas.width = Math.max(1, Math.round(width * pixelRatio))
    this.canvas.height = Math.max(1, Math.round(height * pixelRatio))
  }

  /**
   * Bring world matrices up to date, collect what's visible and draw it. Doesn't run update
   * handlers - the loop owner calls scene.update(dt, t) once per frame.
   * @param {Scene} scene
   * @param {Camera} camera
   * @returns {FrameDescription}
   */
  render(scene, camera) {
    scene.updateWorldTree()
    return this.renderFrame(collect(scene, camera))
  }

  /** @internal
   * Draw a frame. Shaders compile in the background where the browser allows, and what is still
   * compiling is left out (info.compiling counts it; onReady fires when it's done) - unless `wait`
   * is set, for a frame that must be complete, such as an image export. Drawn onto the canvas, or
   * into `target`; with `linear`, in linear light into float targets and encoded to sRGB at the end
   * (where float targets can be drawn to) - the same picture, but blending in linear light.
   * @param {FrameDescription} frame
   * @param {{ wait?: boolean, target?: RenderTarget | null, linear?: boolean }} [options]
   * @returns {FrameDescription}
   */
  renderFrame(frame, { wait = false, target = null, linear = false } = {}) {
    const gpu = this.#gpu
    if (gpu.lost) return frame
    // what this frame touches counts as this renderer's, for freeing a shared context's copies
    gpu.resources.owner = this
    this.info.drawCalls = 0
    this.info.triangles = 0
    this.info.compiling = 0
    this.info.renderTextures = 0
    // the render textures the frame shows, each drawn from its own camera first
    this.#renderTextures(frame, wait)
    this.#drawFrame(frame, { wait, target, linear, plain: false })

    if (this.info.compiling) gpu.whenCompiled()
    if (this.#copy && !target) {
      // the picture is the buffer's bottom-left corner; as an image, y runs down from the top
      const copy = this.#copy, source = gpu.canvas, width = this.canvas.width, height = this.canvas.height
      copy.globalCompositeOperation = 'copy'
      copy.drawImage(source, 0, source.height - height, width, height, 0, 0, width, height)
    }
    // targets no frame has used lately go
    gpu.targets.sweep(gpu.users.size)

    this.info.programs = gpu.programs.count
    this.info.geometries = gpu.resources.counts.geometries
    this.info.textures = gpu.resources.counts.textures
    return frame
  }

  /**
   * Draw the render textures a frame shows that are due, each from its camera into its own target:
   * a frame of its own (no labels or overlays, none of the view's effects), leaving out whatever
   * shows the texture, so a monitor never films itself.
   * @param {FrameDescription} frame @param {boolean} wait
   */
  #renderTextures(frame, wait) {
    /** @type {Set<RenderTexture>} */
    const shown = new Set()
    for (const item of frame.opaque) for (const [, t] of item.material.allTextures) if (/** @type {any} */ (t).isRenderTexture) shown.add(/** @type {RenderTexture} */ (t))
    for (const item of frame.transparent) for (const [, t] of item.material.allTextures) if (/** @type {any} */ (t).isRenderTexture) shown.add(/** @type {RenderTexture} */ (t))
    if (!shown.size) return
    const gl = this.gl
    const samples = gl.getContextAttributes()?.antialias ? Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 4) : 0
    for (const rt of shown) {
      // when it is due: each frame, every nth, or once and after each needsUpdate()
      const due = rt.drawn.version < 0 || (rt.update === 'frame' ? true : rt.update === 'manual' ? rt.drawn.version !== rt.version : rt.drawn.frames + 1 >= rt.update)
      rt.drawn.frames++
      if (!due) continue
      const scene = rt.scene ?? frame.scene
      if (rt.scene) scene.updateWorldTree()
      const camera = /** @type {any} */ (rt.camera)
      camera.aspect = rt.width / rt.height
      const sub = collect(scene, rt.camera, { display: false })
      // what shows this texture isn't drawn into it
      const shows = (/** @type {DrawItem} */ item) => item.material.allTextures.some(([, t]) => t === rt)
      sub.opaque = sub.opaque.filter((item) => !shows(item))
      sub.transparent = sub.transparent.filter((item) => !shows(item))
      sub.solids = sub.solids.filter(([node]) => !node.material.allTextures.some(([, t]) => t === rt))
      // the view's own scene lit as the view lights it - its automatic lights, when it has none
      if (scene === frame.scene && !sub.lights.length) sub.lights = frame.lights
      sub.time = frame.time
      const targets = this.#gpu.resources.renderTexture(rt, samples)
      this.#drawFrame(sub, { wait, target: { framebuffer: targets.draw.framebuffer, width: rt.width, height: rt.height, srgb: true }, linear: false, plain: true })
      // resolved into the texture materials sample, its smaller levels made from it
      if (targets.draw !== targets.picture) blit(gl, targets.draw, targets.picture)
      if (targets.levels > 1) {
        gl.activeTexture(gl.TEXTURE15)
        gl.bindTexture(gl.TEXTURE_2D, targets.picture.texture)
        gl.generateMipmap(gl.TEXTURE_2D)
      }
      rt.drawn.frames = 0
      rt.drawn.version = rt.version
      this.info.renderTextures++
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  /**
   * Draw one frame - the view's, or a render texture's - into the canvas or `target`. `plain`: none
   * of the view's effects (a render texture's frame).
   * @param {FrameDescription} frame
   * @param {{ wait: boolean, target: RenderTarget | null, linear: boolean, plain: boolean }} options
   */
  #drawFrame(frame, { wait, target, linear, plain }) {
    const gpu = this.#gpu
    const gl = gpu.gl
    // a frame of its own, for programs' once-a-frame uniforms (each frame has its own camera)
    gpu.frame++
    const width = target ? target.width : this.canvas.width, height = target ? target.height : this.canvas.height
    // a shared context draws into the bottom-left corner of its buffer, then copies that out
    if (!target && gpu.isShared) gpu.fit(width, height)

    const env = frame.environment
    const bg = frame.background
    const occlusion = plain ? null : this.#ambientOcclusion, groundShadow = plain ? null : this.#groundShadow
    const passes = gpu.loadPasses(!!frame.shadow || frame.spotShadows.length > 0 || !!frame.pointShadow || frame.outlines.length > 0 || (typeof env === 'object' && !!env.image) || (!!bg && !('getHex' in bg) && !!bg.image) || !!occlusion || !!groundShadow)
    // ambient occlusion, the ground shadow and FXAA: their code loads the first time one is on (their
    // targets, like every pass's, are freed by the pool once no frame uses them)
    const effects = occlusion || groundShadow || (this.fxaa && !plain) ? gpu.loadEffects() : null
    // shader hooks that read the clock read it in the shadow maps and outlines too
    if (passes) {
      passes.time = frame.time ?? 0
      passes.cameraPosition = frame.camera.position
    }
    /** @type {FrameState} */
    const state = {
      // in linear light: into float targets encoded at the end, or into a target that encodes itself
      wait, linear: (linear && !!gl.getExtension('EXT_color_buffer_float')) || !!target?.srgb, width, height,
      environment: passes && typeof env === 'object' ? passes.environment(env) : null, shadows: [], occlusion: null, ...this.#lightsOf(frame),
    }
    if (passes && typeof env === 'object' && env.image && !state.environment) {
      warnOnce(env, env.isHDR ? "this device can't render to float textures, which HDR environments need - lighting without it"
        : "'environment' needs an HDR image (a .hdr file) - lighting without it")
    }
    // an HDR background is prefiltered here too, before the scene's target is bound: prefiltering
    // draws into targets of its own and leaves the framebuffer and viewport behind it
    if (passes && bg && !('getHex' in bg) && bg.isHDR) passes.environment(bg)
    // the lights' views first, each into its own depth texture
    state.shadows = !passes ? [] : [
      frame.shadow && passes.shadowMap(frame.shadow),
      frame.spotShadows.length > 0 && passes.spotShadowMaps(frame.spotShadows),
      frame.pointShadow && passes.pointShadowMap(frame.pointShadow),
    ].filter((s) => !!s)
    // the solids' size, for the effects' defaults
    const solids = effects && passes && (groundShadow || (occlusion && occlusion.radius === null)) ? solidsBox(frame) : null
    // ambient occlusion and the ground shadow, each drawn into targets of its own before the scene
    state.occlusion = effects && passes && occlusion ? effects.occlusion(frame, passes, occlusion, width, height, solids ? solids.getRadius() * 2 : 1) : null
    const ground = effects && passes && groundShadow && solids ? effects.groundShadow(solidItems(frame), solids, passes, groundShadow) : null
    // outlines' mask, drawn before the scene, so the scene's own target need not be left
    const outline = passes && frame.outlines.length ? passes.outlineMask(frame.outlines, frame, width, height, this.pixelRatio, this.outlineAntialias) : null

    // the post chain, always in this order: bloom (drawn plainly while its code loads), the encode
    // out of linear light, FXAA. With any step, the scene is drawn into a picture of its own first
    const bloom = this.#bloom && !plain ? gpu.loadBloom() : null
    const fxaa = this.fxaa && !plain ? effects : null
    /** @type {PostStep[]} */
    const steps = []
    const bloomSettings = this.#bloom
    if (bloom && bloomSettings) steps.push({ run: (picture, output) => bloom.apply(picture, output, width, height, bloomSettings, state.linear), linear: state.linear })
    // (a target that encodes itself needs no step for it)
    if (state.linear && !target?.srgb) steps.push({ run: (picture, output) => this.#encode(picture, output, width, height), linear: false })
    if (fxaa) steps.push({ run: (picture, output) => fxaa.fxaa(picture, output, width, height), linear: false })
    const output = target ? target.framebuffer : null
    const scene = steps.length ? this.#sceneTargets(width, height, state.linear) : null

    gl.bindFramebuffer(gl.FRAMEBUFFER, scene ? scene.draw.framebuffer : output)
    gl.viewport(0, 0, width, height)
    if (bg && 'getHex' in bg) {
      // in linear light, the background's own linear colour
      const [r, g, b] = state.linear ? bg : bg.toSRGB()
      gl.clearColor(r, g, b, 1)
    } else {
      gl.clearColor(0, 0, 0, 0)
    }
    gl.depthMask(true)
    // clear only this view's corner of a shared buffer
    gl.enable(gl.SCISSOR_TEST)
    gl.scissor(0, 0, width, height)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.disable(gl.SCISSOR_TEST)
    if (passes && bg && !('getHex' in bg) && bg.image) {
      passes.background(frame, /** @type {Texture} */ (bg), { exposure: this.exposure, toneMapping: TONE_MAPPING[this.toneMapping], linear: state.linear })
    }
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)

    gl.disable(gl.BLEND)
    for (const item of frame.opaque) this.#draw(item, frame, false, state)
    // section planes' caps fill the cut faces of the solids just drawn, before anything see-through
    for (const cap of frame.caps) this.#cap(cap, frame, state)
    // the ground shadow over the opaque things - a floor among them - and under anything see-through;
    // not while some are still compiling, or it shows before what casts it
    if (ground && effects && !this.info.compiling) effects.drawGround(ground, frame)
    gl.enable(gl.BLEND)
    for (const item of frame.transparent) this.#draw(item, frame, true, state)
    // outlines over everything
    if (outline && passes) passes.outlineComposite(outline, state.linear)
    gl.depthMask(true)
    gl.disable(gl.BLEND)
    gl.bindVertexArray(null)
    if (scene) this.#post(scene, steps, output, width, height)
  }

  /**
   * The scene's own picture, for a post chain to read: drawn multisampled (as the canvas would be)
   * and resolved into a texture, or - with no multisampling - drawn into the texture itself. Depth
   * and stencil (for section planes' caps) go with what is drawn into.
   * @param {number} width @param {number} height @param {boolean} linear float, for linear light
   * @returns {{ draw: Target, picture: Target }}
   */
  #sceneTargets(width, height, linear) {
    const gl = this.gl, pool = this.#gpu.targets
    const color = linear ? gl.RGBA16F : gl.RGBA8
    const samples = gl.getContextAttributes()?.antialias ? Math.min(4, gl.getParameter(gl.MAX_SAMPLES) || 4) : 0
    const picture = pool.get('scene', { width, height, color, depth: samples ? null : 'stencil' })
    const draw = samples ? pool.get('scene-multisampled', { width, height, color, depth: 'stencil', samples }) : picture
    return { draw, picture }
  }

  /**
   * Run the post chain over the scene's picture: each step reads the last one's picture and draws
   * into a target of its own - float while still in linear light - and the last into `output`.
   * @param {{ draw: Target, picture: Target }} scene @param {PostStep[]} steps
   * @param {WebGLFramebuffer | null} output @param {number} width @param {number} height
   */
  #post(scene, steps, output, width, height) {
    const gl = this.gl, pool = this.#gpu.targets
    if (scene.draw !== scene.picture) blit(gl, scene.draw, scene.picture)
    let picture = /** @type {WebGLTexture} */ (scene.picture.texture)
    steps.forEach((step, i) => {
      if (i === steps.length - 1) return step.run(picture, output)
      // two pictures between steps, taken in turn
      const between = pool.get(`post-${i % 2}`, { width, height, color: step.linear ? gl.RGBA16F : gl.RGBA8 })
      step.run(picture, between.framebuffer)
      picture = /** @type {WebGLTexture} */ (between.texture)
    })
  }

  /**
   * The step out of linear light: the picture encoded as sRGB, into `output`.
   * @param {WebGLTexture} picture @param {WebGLFramebuffer | null} output @param {number} width @param {number} height
   */
  #encode(picture, output, width, height) {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, output)
    gl.viewport(0, 0, width, height)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.BLEND)
    gl.disable(gl.CULL_FACE)
    gl.depthMask(false)
    const program = this.#gpu.programs.ready('encode', [], ENCODE)
    gl.useProgram(program.program)
    program.set('uSource', picture)
    this.#gpu.programs.drawFullscreen()
    gl.depthMask(true)
    gl.enable(gl.DEPTH_TEST)
    gl.bindVertexArray(null)
  }

  /**
   * What is drawn at a pixel of a frame this renderer drew, found on the GPU: the drawable, which
   * instance, point or segment, and where. Undefined while the picking code loads (onReady fires
   * when it has) or while the context is lost - pick on the CPU meanwhile.
   * @param {FrameDescription} frame
   * @param {number} x @param {number} y CSS pixels from the canvas's top left
   * @returns {GPUHit | null | undefined}
   */
  pick(frame, x, y) {
    const gpu = this.#gpu
    if (gpu.lost) return undefined
    const picker = gpu.loadPicker()
    if (!picker) return undefined
    gpu.resources.owner = this
    const r = this.pixelRatio
    return picker.pick(frame, x * r, y * r, this.canvas.width, this.canvas.height, r)
  }

  /** @internal
   * pick() without waiting for the GPU: resolves once it has finished. Undefined while the picking
   * code loads; null while an earlier request is still out.
   * @param {FrameDescription} frame
   * @param {number} x @param {number} y CSS pixels from the canvas's top left
   * @returns {Promise<GPUHit | null> | null | undefined}
   */
  pickAsync(frame, x, y) {
    const gpu = this.#gpu
    if (gpu.lost) return undefined
    const picker = gpu.loadPicker()
    if (!picker) return undefined
    gpu.resources.owner = this
    const r = this.pixelRatio
    return picker.pickAsync(frame, x * r, y * r, this.canvas.width, this.canvas.height, r)
  }

  /**
   * Free the GPU resources this renderer made. With its own context that is everything (the
   * context is released); with the shared one, the copies of what `scene` draws that no other
   * renderer still uses - and everything, once the last renderer goes.
   * @param {Scene} [scene] what it drew
   */
  dispose(scene) {
    this.#gpu.release(this, scene)
  }

  /**
   * The frame's lights as the lit shaders take them: their uniforms, the defines that size their
   * arrays, and whether the built-in studio lights the scene.
   * @param {FrameDescription} frame
   * @returns {{ lights: Record<string, any>, lightDefines: string[], studio: boolean }}
   */
  #lightsOf(frame) {
    const ambient = [0, 0, 0], sky = [0, 0, 0], ground = [0, 0, 0]
    // sized to the lights there are: the programs are compiled for exactly that many
    const directional = frame.lights.filter((l) => l.kind === 'directional').length
    const punctual = frame.lights.filter((l) => l.kind === 'point' || l.kind === 'spot').length
    const dirDirection = new Float32Array(directional * 3), dirColor = new Float32Array(directional * 3)
    const pos = new Float32Array(punctual * 3), color = new Float32Array(punctual * 3)
    const range = new Float32Array(punctual), direction = new Float32Array(punctual * 3), shadowTile = new Float32Array(punctual).fill(-1)
    const cone = new Float32Array(punctual * 2)
    let dirCount = 0, punctualCount = 0, pointShadowIndex = -1
    /** @param {number[] | Float32Array} out @param {number} offset @param {FrameLight} l @param {ArrayLike<number>} [c] */
    const addColor = (out, offset, l, c = l.color) => {
      out[offset] += c[0] * l.intensity
      out[offset + 1] += c[1] * l.intensity
      out[offset + 2] += c[2] * l.intensity
    }
    for (const l of frame.lights) {
      if (l.kind === 'ambient') addColor(ambient, 0, l)
      else if (l.kind === 'hemisphere') {
        addColor(sky, 0, l)
        addColor(ground, 0, l, l.ground)
      } else if (l.kind === 'directional') {
        const d = /** @type {ArrayLike<number>} */ (l.direction)
        // the shader wants the direction towards the light
        dirDirection.set([-d[0], -d[1], -d[2]], dirCount * 3)
        addColor(dirColor, dirCount * 3, l)
        dirCount++
      } else {
        const i = punctualCount++
        pos.set(/** @type {ArrayLike<number>} */ (l.position), i * 3)
        addColor(color, i * 3, l)
        range[i] = l.range ?? 0
        if (l === frame.pointShadow?.light) pointShadowIndex = i
        if (l.kind === 'spot') {
          direction.set(/** @type {ArrayLike<number>} */ (l.direction), i * 3)
          shadowTile[i] = l.shadowTile ?? -1
          const angle = /** @type {number} */ (l.angle)
          cone[i * 2] = Math.cos(angle)
          cone[i * 2 + 1] = Math.cos(angle * (1 - (l.penumbra ?? 0)))
        } else {
          // a cone wider than any angle: smoothstep(-2, -1, cos) is always 1
          cone[i * 2] = -2
          cone[i * 2 + 1] = -1
        }
      }
    }
    const lights = {
      uAmbient: ambient, uHemisphereSky: sky, uHemisphereGround: ground,
      uDirectionalDirection: dirDirection, uDirectionalColor: dirColor,
      uPunctualPosition: pos, uPunctualColor: color, uPunctualRange: range,
      uPunctualDirection: direction, uPunctualCone: cone, uPunctualShadow: shadowTile, uPointShadowIndex: pointShadowIndex,
    }
    return { lights, lightDefines: [`NUM_DIRECTIONAL ${dirCount}`, `NUM_PUNCTUAL ${punctualCount}`], studio: frame.environment === 'studio' }
  }

  /** @param {DrawItem} item @param {FrameDescription} frame @param {boolean} transparent @param {FrameState} state */
  #draw(item, frame, transparent, state) {
    const gl = this.gl
    const { node, geometry, material, worldMatrix, instances } = item
    const kind = drawKind(node)
    const receives = kind === 'mesh' && node.receiveShadow && !material.unlit
    const shadows = receives ? state.shadows : NO_SHADOWS

    const clip = kind === 'mesh' ? item.clip : null
    // placed and cut as every pass draws it, then the material's features and the frame's lights
    const defines = [...placementDefines(item), ...this.#defines(kind, material, geometry, state)]
    if (kind === 'points' && /** @type {any} */ (node).drawsSprites) defines.push('SPRITES')
    for (const shadow of shadows) defines.push(shadow.define)
    const fog = material.fog ? frame.fog : null
    if (fog) {
      defines.push('FOG')
      if (fog.linear) defines.push('FOG_LINEAR')
      if (material.blending === 'additive') defines.push('FOG_ADD')
      else if (material.blending === 'multiply') defines.push('FOG_MULTIPLY')
    }
    // ambient occlusion dims the light from all round on lit solids; see-through things show what is
    // behind them, so the occlusion found there isn't theirs
    const ssao = kind === 'mesh' && !transparent && !material.unlit ? state.occlusion : null
    if (ssao) defines.push('SSAO', ...(ssao.depth ? ['SSAO_DEPTH'] : []))
    // a material's own GLSL, spliced into this program
    const hook = hookFor(material)
    if (hook) defines.push(...hook.defines)
    const programs = this.#gpu.programs
    const program = programs.get(kind, defines, undefined, hook?.source)
    if (!programs.isReady(program)) {
      if (!state.wait) {
        // still compiling: drawn once it's done, rather than holding up everything else
        this.info.compiling++
        return
      }
      programs.ready(kind, defines, undefined, hook?.source)
    }
    if (program.failed) {
      // reported once; drawn without the hooks from the next frame
      hookFailed(material, /** @type {import('./hooks.js').Hook} */ (hook), program.failed)
      // counted as still compiling, so the View draws again - with the material's plain program
      this.info.compiling++
      return
    }
    gl.useProgram(program.program)

    // per-frame values, once per program per frame
    if (program.frame !== this.#gpu.frame) {
      program.frame = this.#gpu.frame
      program.set('uView', frame.camera.view)
      program.set('uProjection', frame.camera.projection)
      program.set('uViewProjection', frame.camera.viewProjection)
      program.set('uCameraPosition', frame.camera.position)
      program.set('uExposure', this.exposure)
      program.set('uToneMapping', TONE_MAPPING[this.toneMapping])
      program.set('uResolution', [state.width, state.height])
      program.set('uNear', frame.camera.near)
      program.set('uScale', frame.camera.projection[5] * state.height / 2)
      if (kind === 'mesh' && !material.unlit) {
        for (const [name, value] of Object.entries(state.lights)) program.set(name, value)
        const env = state.environment
        if (env) {
          program.set('uEnvMaxLod', env.maxLod)
          program.set('uEnvSH', env.sh)
          program.set('uEnvIntensity', frame.environmentIntensity)
        }
        for (const shadow of shadows) for (const [name, value] of Object.entries(shadow.uniforms)) program.set(name, value)
      }
    }
    // the frame's own textures are bound every draw, not once a frame: other programs drawn in
    // between bind their maps to the same texture units, and a shadow sampler left reading an
    // ordinary texture makes the draw fail
    if (kind === 'mesh' && !material.unlit) {
      if (state.environment) program.set('uEnvMap', state.environment.prefiltered)
      for (const shadow of shadows) program.set(shadow.sampler, shadow.texture)
    }
    if (ssao) {
      program.set('uSsao', ssao.texture)
      program.set('uSsaoScale', ssao.scale)
      program.set('uSsaoViewZ', ssao.viewZ)
    }

    program.set('uModel', worldMatrix)
    const hl = frame.highlight
    if (hl && (hl.nodes ? hl.nodes.has(node) : hl.node === node)) {
      program.set('uHighlightIndex', hl.index ?? -1)
      program.set('uHighlight', [hl.color[0], hl.color[1], hl.color[2], hl.amount])
    } else {
      program.set('uHighlightIndex', -2)
    }
    if (hook) setHookUniforms(program, material, frame.time ?? 0, frame.camera.position, (t) => this.#gpu.resources.texture(t))
    if (fog) {
      program.set('uFogColor', fog.color)
      program.set('uFogRange', [fog.near, fog.far])
      program.set('uFogDensity', fog.density)
    }
    if (clip) program.set('uClipPlane', clip.plane)
    // the material's own: each of its features' uniforms - its colour, its surface, its maps (each bound
    // to its sampler, with its repeat, rotation and offset)
    const resources = this.#gpu.resources
    setFeatureUniforms(material, kind, {
      set: (name, value) => program.set(name, value),
      map: (uniform, texture, transform) => {
        program.set(uniform, resources.texture(texture))
        if (transform) program.set(`${uniform}Uv`, uvMatrix(texture))
      },
    })

    // render state
    gl.depthMask(!transparent && material.depthWrite)
    if (material.depthTest) gl.enable(gl.DEPTH_TEST)
    else gl.disable(gl.DEPTH_TEST)
    if (transparent) {
      // output is premultiplied, so 'normal' is ONE / ONE_MINUS_SRC_ALPHA; 'multiply' scales what is
      // behind by the colour, as much as the opacity says: dst * (colour * opacity + 1 - opacity)
      if (material.blending === 'additive') gl.blendFunc(gl.ONE, gl.ONE)
      else if (material.blending === 'multiply') gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA)
      else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    }

    if (kind === 'lines') {
      gl.disable(gl.CULL_FACE)
      program.set('uWidth', material.width * this.pixelRatio)
      const arrows = /** @type {any} */ (node).arrowBits ?? 0
      program.set('uArrows', arrows)
      program.set('uArrowSize', /** @type {any} */ (node).arrowPixels?.(material.width) * this.pixelRatio || 0)
      const buffers = this.#gpu.resources.lines(geometry)
      gl.bindVertexArray(buffers.vao)
      // a quad a segment, and two arrowheads where there are any
      gl.drawArraysInstanced(gl.TRIANGLES, 0, arrows ? 12 : 6, Math.min(buffers.count, Math.floor(geometry.drawnCount / 2)))
      this.info.drawCalls++
      return
    }

    if (kind === 'points') {
      gl.disable(gl.CULL_FACE)
      program.set('uSize', material.sizeAttenuation ? material.size : material.size * this.pixelRatio)
      // round points are solid, but their edges are soft: blended over what is behind even in the
      // opaque pass, or the edge fades to black - a dark ring round every dot
      const round = !transparent && !material.map
      if (round) {
        gl.enable(gl.BLEND)
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      }
      if (/** @type {any} */ (node).drawsSprites) {
        // each point a square, any size and turned - drawn back to front when the points ask, for
        // smoke and other soft things that hide what is behind them
        program.set('uResolution', [state.width, state.height])
        const modelView = /** @type {any} */ (node).sort ? mat4.multiply(this.#modelView, frame.camera.view, worldMatrix) : null
        const buffers = this.#gpu.resources.sprites(geometry, modelView)
        gl.bindVertexArray(buffers.vao)
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, buffers.count)
      } else {
        const buffers = this.#gpu.resources.mesh(geometry, null, false)
        gl.bindVertexArray(buffers.vao)
        gl.drawArrays(gl.POINTS, 0, geometry.drawnVertices)
      }
      if (round) gl.disable(gl.BLEND)
      this.info.drawCalls++
      return
    }

    // triangles
    if (!mat3.normalFromMat4(this.#normalMatrix, worldMatrix)) mat3.identity(this.#normalMatrix)
    program.set('uNormalMatrix', this.#normalMatrix)
    // a mirroring transform (negative scale) reverses the winding - which also says which side is
    // the back, for double-sided materials
    gl.frontFace(mat4.determinant(worldMatrix) < 0 ? gl.CW : gl.CCW)
    if (material.doubleSided) {
      gl.disable(gl.CULL_FACE)
    } else {
      gl.enable(gl.CULL_FACE)
      gl.cullFace(gl.BACK)
    }
    // surfaces sit a hair behind their own depth, so a line lying on one - an edge, a seam, a
    // drawing's outline - shows whole rather than fighting it pixel by pixel
    gl.enable(gl.POLYGON_OFFSET_FILL)
    gl.polygonOffset(1, 2)
    this.info.triangles += this.#gpu.resources.drawTriangles(geometry, instances, material.anisotropy > 0 && !material.unlit)
    gl.disable(gl.POLYGON_OFFSET_FILL)
    this.info.drawCalls++
  }

  /**
   * Fill a section plane's cut through its solids. Each pixel's faces behind the plane are counted
   * into the stencil - in through a front face, out through a back one - so where the count isn't
   * zero, the plane there is inside a solid. A square on the plane, lit like any surface, is then
   * drawn over just those pixels: at the plane's own depth, so faces lying in it can't fight it.
   * @param {FrameCap} cap @param {FrameDescription} frame @param {FrameState} state
   */
  #cap(cap, frame, state) {
    const gl = this.gl
    const programs = this.#gpu.programs
    // each solid's counting program: placed, moved by its hooks and cut out as the picture draws it
    const shapes = cap.items.map((item) => shapeDefines(item, true))
    const masks = shapes.map(({ defines, hook }) => programs.get('clip-mask', defines, CLIP_MASK, hook?.source))
    if (!masks.every((p) => programs.isReady(p))) {
      if (!state.wait) {
        this.info.compiling++
        return
      }
      shapes.forEach(({ defines, hook }) => programs.ready('clip-mask', defines, CLIP_MASK, hook?.source))
    }
    gl.enable(gl.STENCIL_TEST)
    gl.enable(gl.SCISSOR_TEST)
    gl.scissor(0, 0, state.width, state.height)
    gl.clearStencil(0)
    gl.clear(gl.STENCIL_BUFFER_BIT)
    gl.disable(gl.SCISSOR_TEST)
    // count every face, hidden or not, without drawing a thing
    gl.colorMask(false, false, false, false)
    gl.depthMask(false)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.stencilFunc(gl.ALWAYS, 0, 0xff)
    gl.stencilOpSeparate(gl.BACK, gl.KEEP, gl.KEEP, gl.INCR_WRAP)
    gl.stencilOpSeparate(gl.FRONT, gl.KEEP, gl.KEEP, gl.DECR_WRAP)
    cap.items.forEach((item, i) => {
      const program = masks[i], { hook, cutout } = shapes[i]
      if (program.failed) return
      gl.useProgram(program.program)
      program.set('uViewProjection', frame.camera.viewProjection)
      program.set('uModel', item.worldMatrix)
      setShapeUniforms(program, item, cutout, (t) => this.#gpu.resources.texture(t))
      program.set('uClipPlane', cap.plane)
      if (hook) setHookUniforms(program, item.material, frame.time ?? 0, frame.camera.position, (t) => this.#gpu.resources.texture(t))
      gl.frontFace(mat4.determinant(item.worldMatrix) < 0 ? gl.CW : gl.CCW)
      this.#gpu.resources.drawTriangles(item.geometry, item.instances)
      this.info.drawCalls++
    })
    gl.colorMask(true, true, true, true)
    // then the plane, just where the count says
    gl.stencilFunc(gl.NOTEQUAL, 0, 0xff)
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP)
    this.#draw(this.#capItem(cap), frame, false, state)
    gl.disable(gl.STENCIL_TEST)
  }

  /** A cap's square, laid on its plane over the cut and facing out of it. @param {FrameCap} cap @returns {DrawItem} */
  #capItem(cap) {
    const hex = cap.color.getHex()
    let material = this.#capMaterials.get(hex)
    if (!material) this.#capMaterials.set(hex, material = new Material({ color: cap.color.getStyle(), roughness: 0.6 }))
    // axes for the square: y along the plane's normal, x and z across it
    const [nx, ny, nz] = cap.plane
    const across = Math.abs(nx) < 0.9 ? [1, 0, 0] : [0, 1, 0]
    let ax = ny * across[2] - nz * across[1], ay = nz * across[0] - nx * across[2], az = nx * across[1] - ny * across[0]
    const l = Math.hypot(ax, ay, az)
    ax /= l
    ay /= l
    az /= l
    // x cross y gives z, so the square keeps facing +y - out of the cut
    const bx = ay * nz - az * ny, by = az * nx - ax * nz, bz = ax * ny - ay * nx
    const s = cap.radius * 1.05, c = cap.center
    const worldMatrix = /** @type {any} */ (new Float32Array([ax * s, ay * s, az * s, 0, nx, ny, nz, 0, bx * s, by * s, bz * s, 0, c[0], c[1], c[2], 1]))
    return { node: CAP_NODE, geometry: CAP_SQUARE, material, worldMatrix, instances: null, depth: 0, clip: null }
  }

  /**
   * A drawable's defines but its placement: the material's features (features.js), and - for a lit
   * mesh - the frame's lights and environment.
   * @param {'mesh' | 'points' | 'lines'} kind @param {Material} material @param {Geometry} geometry @param {FrameState} state
   * @returns {string[]}
   */
  #defines(kind, material, geometry, state) {
    // drawn in linear light, for a chain that encodes the picture at its end
    const d = state.linear ? ['LINEAR_OUTPUT'] : []
    d.push(...featureDefines(material, kind, geometry))
    if (kind === 'mesh') {
      if (!material.unlit) {
        d.push(...state.lightDefines)
        if (state.environment) d.push('ENV_MAP')
        else if (state.studio) d.push('STUDIO')
      }
      // maps on the second UV set read it - where the geometry has one
      d.push(...secondUvDefines(material, geometry, material.textures.map(([slot]) => slot)))
    }
    // (points drawn as squares add SPRITES - see #draw, which knows the node)
    return d
  }
}

