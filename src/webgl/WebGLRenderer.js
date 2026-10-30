import * as mat3 from '../math/mat3.js'
import * as mat4 from '../math/mat4.js'
import { Geometry } from '../geometry/Geometry.js'
import { Material } from '../material/Material.js'
import { CLIP_ONLY_FRAGMENT, MESH_VERTEX } from './shaders.js'
import { collect } from '../frame.js'
import { checkNumber, checkOneOf, checkOptions, checkRange, describe, fail, warnOnce } from '../validate.js'
import { GLContext } from './context.js'

/** @import { FrameDescription, DrawItem, FrameLight, FrameCap } from '../frame.js' */
/** @import { Scene } from '../scene/Scene.js' */
/** @import { Camera } from '../scene/cameras.js' */
/** @import { Texture } from '../material/Texture.js' */
/** @import { Environment } from './passes.js' */
/** @import { GPUHit } from './picking.js' */

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
 * @property {ToneMapping} [toneMapping] how lit colours are mapped to the screen: 'neutral' keeps colours
 *   true (Khronos PBR Neutral, the default), 'aces' is filmic, 'none' clips
 * @property {number} [exposure] (default 1)
 * @property {number} [pixelRatio] drawing buffer pixels per CSS pixel (default 1; View sets it)
 * @property {boolean | BloomOptions} [bloom] glow round bright parts (default off); loads its code the first time
 */

const OPTIONS = ['canvas', 'shared', 'antialias', 'toneMapping', 'exposure', 'pixelRatio', 'bloom']
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
  if (value === undefined || value === null || value === false) return null
  if (value === true) return { ...BLOOM }
  if (typeof value !== 'object') fail(owner, `bloom is true, false or { strength, radius, threshold }, got ${describe(value)}`)
  checkOptions(`${owner} bloom`, value, BLOOM_OPTIONS, BLOOM_HINTS)
  const settings = { ...BLOOM }
  for (const key of /** @type {(keyof BloomOptions)[]} */ (Object.keys(BLOOM))) {
    if (value[key] !== undefined) settings[key] = checkNumber(`${owner} bloom`, key, value[key])
  }
  return settings
}
const TONE_MAPPING = { none: 0, aces: 1, neutral: 2 }
// material maps and the shader feature each one switches on (all but emissive need lighting)
/** @type {import('./passes.js').ShadowMap[]} */
const NO_SHADOWS = []
const MAP_DEFINES = { roughnessMap: 'ROUGHNESS_MAP', metalnessMap: 'METALNESS_MAP', normalMap: 'NORMAL_MAP', bumpMap: 'BUMP_MAP', aoMap: 'AO_MAP' }
// every map a mesh can sample - triplanar projection is only worth its varyings when there is one
const MAP_SLOTS = ['map', 'emissiveMap', ...Object.keys(MAP_DEFINES)]
const MAP_UNIFORMS = { map: 'uMap', roughnessMap: 'uRoughnessMap', metalnessMap: 'uMetalnessMap', normalMap: 'uNormalMap', bumpMap: 'uBumpMap', aoMap: 'uAoMap', emissiveMap: 'uEmissiveMap' }
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
  /** @type {ToneMapping} */ toneMapping = 'neutral'
  exposure = 1
  pixelRatio = 1
  /** @type {Required<BloomOptions> | null} */ #bloom = null
  /** Counts from the last frame and the GPU caches. */
  info = { drawCalls: 0, triangles: 0, programs: 0, geometries: 0, textures: 0, compiling: 0 }
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
  /** This frame's prefiltered environment, when it is an HDR image. @type {Environment | null} */ #environment = null
  /** This frame's shadows - directional, spot, point - for the meshes that receive them. @type {import('./passes.js').ShadowMap[]} */ #shadows = []
  /** @type {Float32Array} */ #normalMatrix = new Float32Array(9)
  /** @type {Record<string, any>} */ #lights = {}
  /** This frame waits for shaders to compile rather than leaving things out. */
  #wait = false
  /** This frame's light counts and environment, compiled into the lit programs. @type {string[]} */ #lightDefines = []
  #studio = false
  /** A cap's material, by colour, so each colour compiles and uploads once. @type {Map<number, Material>} */ #capMaterials = new Map()

  /** @param {WebGLRendererOptions} options */
  constructor(options) {
    checkOptions('WebGLRenderer', options, OPTIONS, HINTS)
    if (!options?.canvas) fail('WebGLRenderer', "'canvas' is required")
    this.canvas = options.canvas
    if (options.toneMapping !== undefined) this.toneMapping = checkOneOf('WebGLRenderer', 'toneMapping', options.toneMapping, ['aces', 'neutral', 'none'])
    if (options.exposure !== undefined) this.exposure = checkRange('WebGLRenderer', 'exposure', options.exposure, 0)
    if (options.pixelRatio !== undefined) this.pixelRatio = checkRange('WebGLRenderer', 'pixelRatio', options.pixelRatio, 0, Infinity, { above: true })
    this.#bloom = bloomSettings('WebGLRenderer', options.bloom)

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

  /**
   * Draw a frame. Shaders compile in the background where the browser allows, and what is still
   * compiling is left out (info.compiling counts it; onReady fires when it's done) - unless `wait`
   * is set, for a frame that must be complete, such as an image export.
   * @param {FrameDescription} frame
   * @param {{ wait?: boolean }} [options]
   * @returns {FrameDescription}
   */
  renderFrame(frame, { wait = false } = {}) {
    const gpu = this.#gpu
    if (gpu.lost) return frame
    const gl = gpu.gl
    gpu.frame++
    // what this frame touches counts as this renderer's, for freeing a shared context's copies
    gpu.resources.owner = this
    this.#wait = wait
    this.info.drawCalls = 0
    this.info.triangles = 0
    this.info.compiling = 0
    const width = this.canvas.width, height = this.canvas.height
    // a shared context draws into the bottom-left corner of its buffer, then copies that out
    if (gpu.isShared) gpu.fit(width, height)

    const env = frame.environment
    const bg = frame.background
    const passes = gpu.loadPasses(!!frame.shadow || frame.spotShadows.length > 0 || !!frame.pointShadow || frame.outlines.length > 0 || (typeof env === 'object' && !!env.image) || (!!bg && !('getHex' in bg) && !!bg.image))
    this.#environment = passes && typeof env === 'object' ? passes.environment(env) : null
    if (passes && typeof env === 'object' && env.image && !this.#environment) {
      warnOnce(env, env.isHDR ? "this device can't render to float textures, which HDR environments need - lighting without it"
        : "'environment' needs an HDR image (a .hdr file) - lighting without it")
    }
    // an HDR background is prefiltered here too, before the scene's target is bound: prefiltering
    // draws into targets of its own and leaves the framebuffer and viewport behind it
    if (passes && bg && !('getHex' in bg) && bg.isHDR) passes.environment(bg)
    // the lights' views first, each into its own depth texture
    this.#shadows = !passes ? [] : [
      frame.shadow && passes.shadowMap(frame.shadow),
      frame.spotShadows.length > 0 && passes.spotShadowMaps(frame.spotShadows),
      frame.pointShadow && passes.pointShadowMap(frame.pointShadow),
    ].filter((s) => !!s)
    // outlines' mask, drawn before the scene, so the scene's own target need not be left
    const outline = passes && frame.outlines.length ? passes.outlineMask(frame.outlines, frame, width, height, this.pixelRatio) : null

    // with bloom, the scene is drawn into a buffer of its own first (drawn plainly while its code loads)
    const bloom = this.#bloom ? gpu.loadBloom() : null
    // its buffers are big: once no view on this context wants bloom, they go (and come back if one does)
    if (!bloom && gpu.bloom && ![...gpu.users].some((u) => /** @type {any} */ (u).bloom)) gpu.bloom.dispose()
    if (bloom) bloom.begin(width, height)
    else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, width, height)
    }
    if (bg && 'getHex' in bg) {
      const [r, g, b] = bg.toSRGB()
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
      passes.background(frame, /** @type {Texture} */ (bg), { exposure: this.exposure, toneMapping: TONE_MAPPING[this.toneMapping] })
    }
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)

    this.#gatherLights(frame)

    gl.disable(gl.BLEND)
    for (const item of frame.opaque) this.#draw(item, frame, false)
    // section planes' caps fill the cut faces of the solids just drawn, before anything see-through
    for (const cap of frame.caps) this.#cap(cap, frame, width, height)
    gl.enable(gl.BLEND)
    for (const item of frame.transparent) this.#draw(item, frame, true)
    // outlines over everything
    if (outline && passes) passes.outlineComposite(outline, height)
    gl.depthMask(true)
    gl.disable(gl.BLEND)
    gl.bindVertexArray(null)
    if (bloom && this.#bloom) bloom.end(this.#bloom)

    if (this.info.compiling) gpu.whenCompiled()
    if (this.#copy) {
      // the picture is the buffer's bottom-left corner; as an image, y runs down from the top
      const copy = this.#copy, source = gpu.canvas
      copy.globalCompositeOperation = 'copy'
      copy.drawImage(source, 0, source.height - height, width, height, 0, 0, width, height)
    }

    this.info.programs = gpu.programs.count
    this.info.geometries = gpu.resources.counts.geometries
    this.info.textures = gpu.resources.counts.textures
    return frame
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

  /**
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

  /** @param {FrameDescription} frame */
  #gatherLights(frame) {
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
    this.#lightDefines = [`NUM_DIRECTIONAL ${dirCount}`, `NUM_PUNCTUAL ${punctualCount}`]
    this.#studio = frame.environment === 'studio'
    this.#lights = {
      uAmbient: ambient, uHemisphereSky: sky, uHemisphereGround: ground,
      uDirectionalDirection: dirDirection, uDirectionalColor: dirColor,
      uPunctualPosition: pos, uPunctualColor: color, uPunctualRange: range,
      uPunctualDirection: direction, uPunctualCone: cone, uPunctualShadow: shadowTile, uPointShadowIndex: pointShadowIndex,
    }
  }

  /** @param {DrawItem} item @param {FrameDescription} frame @param {boolean} transparent */
  #draw(item, frame, transparent) {
    const gl = this.gl
    const { node, geometry, material, worldMatrix, instances } = item
    const mode = /** @type {any} */ (node).drawMode
    const kind = mode === 'points' ? 'points' : mode === 'lines' ? 'lines' : 'mesh'
    const receives = kind === 'mesh' && node.receiveShadow && !material.unlit
    const shadows = receives ? this.#shadows : NO_SHADOWS

    const clip = kind === 'mesh' ? item.clip : null
    const defines = this.#defines(kind, material, geometry.colors !== null, !!instances)
    for (const shadow of shadows) defines.push(shadow.define)
    const fog = material.fog ? frame.fog : null
    if (fog) {
      defines.push('FOG')
      if (fog.linear) defines.push('FOG_LINEAR')
      if (material.blending === 'additive') defines.push('FOG_ADD')
      else if (material.blending === 'multiply') defines.push('FOG_MULTIPLY')
    }
    if (clip) defines.push('CLIP')
    const programs = this.#gpu.programs
    const program = programs.get(kind, defines)
    if (!programs.isReady(program)) {
      if (!this.#wait) {
        // still compiling: drawn once it's done, rather than holding up everything else
        this.info.compiling++
        return
      }
      programs.ready(kind, defines)
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
      program.set('uResolution', [this.canvas.width, this.canvas.height])
      program.set('uNear', frame.camera.near)
      program.set('uScale', frame.camera.projection[5] * this.canvas.height / 2)
      if (kind === 'mesh' && !material.unlit) {
        for (const [name, value] of Object.entries(this.#lights)) program.set(name, value)
        const env = this.#environment
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
      if (this.#environment) program.set('uEnvMap', this.#environment.prefiltered)
      for (const shadow of shadows) program.set(shadow.sampler, shadow.texture)
    }

    program.set('uModel', worldMatrix)
    const hl = frame.highlight
    if (hl && (hl.nodes ? hl.nodes.has(node) : hl.node === node)) {
      program.set('uHighlightIndex', hl.index ?? -1)
      program.set('uHighlight', [hl.color[0], hl.color[1], hl.color[2], hl.amount])
    } else {
      program.set('uHighlightIndex', -2)
    }
    program.set('uColor', material.color)
    program.set('uOpacity', material.opacity)
    if (fog) {
      program.set('uFogColor', fog.color)
      program.set('uFogRange', [fog.near, fog.far])
      program.set('uFogDensity', fog.density)
    }
    if (clip) program.set('uClipPlane', clip.plane)
    const e = material.emissive, k = material.emissiveIntensity
    program.set('uEmissive', [e[0] * k, e[1] * k, e[2] * k])
    program.set('uRoughness', material.roughness)
    program.set('uMetalness', material.metalness)
    program.set('uNormalScale', material.normalScale)
    if (material.bumpMap) program.set('uBumpScale', material.bumpScale)
    if (material.triplanar > 0) program.set('uTriplanar', material.triplanar)
    program.set('uAoMapIntensity', material.aoMapIntensity)
    program.set('uAlphaTest', material.alphaTest)
    /** @type {[string, Texture][]} */
    const maps = kind === 'mesh' ? material.textures : material.map ? [['map', material.map]] : []
    // GL textures first (uploads use a unit of their own), then bind them to the samplers
    const bound = maps.map(([slot, texture]) => [MAP_UNIFORMS[slot], this.#gpu.resources.texture(texture)])
    for (const [name, texture] of bound) program.set(name, texture)
    // one UV transform for every map: the first map's (glTF models share theirs)
    const first = maps[0]?.[1]
    program.set('uUvTransform', first ? [first.repeat[0], first.repeat[1], first.offset[0], first.offset[1]] : [1, 1, 0, 0])

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
      const buffers = this.#gpu.resources.lines(geometry)
      gl.bindVertexArray(buffers.vao)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Math.min(buffers.count, Math.floor(geometry.drawnCount / 2)))
      this.info.drawCalls++
      return
    }

    if (kind === 'points') {
      gl.disable(gl.CULL_FACE)
      program.set('uSize', material.sizeAttenuation ? material.size : material.size * this.pixelRatio)
      const buffers = this.#gpu.resources.mesh(geometry, null, false)
      gl.bindVertexArray(buffers.vao)
      gl.drawArrays(gl.POINTS, 0, geometry.drawnVertices)
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
    this.info.triangles += this.#gpu.resources.drawTriangles(geometry, instances)
    this.info.drawCalls++
  }

  /**
   * Fill a section plane's cut through its solids. Each pixel's faces behind the plane are counted
   * into the stencil - in through a front face, out through a back one - so where the count isn't
   * zero, the plane there is inside a solid. A square on the plane, lit like any surface, is then
   * drawn over just those pixels: at the plane's own depth, so faces lying in it can't fight it.
   * @param {FrameCap} cap @param {FrameDescription} frame @param {number} width @param {number} height
   */
  #cap(cap, frame, width, height) {
    const gl = this.gl
    const programs = this.#gpu.programs
    // the counting program, for plain and instanced solids
    const masks = [false, true].map((instanced) => programs.get('clip-mask', instanced ? ['INSTANCED', 'CLIP'] : ['CLIP'], CLIP_MASK))
    if (!masks.every((p) => programs.isReady(p))) {
      if (!this.#wait) {
        this.info.compiling++
        return
      }
      for (const instanced of [false, true]) programs.ready('clip-mask', instanced ? ['INSTANCED', 'CLIP'] : ['CLIP'], CLIP_MASK)
    }
    gl.enable(gl.STENCIL_TEST)
    gl.enable(gl.SCISSOR_TEST)
    gl.scissor(0, 0, width, height)
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
    for (const item of cap.items) {
      const program = masks[item.instances ? 1 : 0]
      gl.useProgram(program.program)
      program.set('uViewProjection', frame.camera.viewProjection)
      program.set('uModel', item.worldMatrix)
      program.set('uClipPlane', cap.plane)
      gl.frontFace(mat4.determinant(item.worldMatrix) < 0 ? gl.CW : gl.CCW)
      this.#gpu.resources.drawTriangles(item.geometry, item.instances)
      this.info.drawCalls++
    }
    gl.colorMask(true, true, true, true)
    // then the plane, just where the count says
    gl.stencilFunc(gl.NOTEQUAL, 0, 0xff)
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP)
    this.#draw(this.#capItem(cap), frame, false)
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
   * @param {'mesh' | 'points' | 'lines'} kind @param {Material} material
   * @param {boolean} hasColors @param {boolean} instanced
   * @returns {string[]}
   */
  #defines(kind, material, hasColors, instanced) {
    const d = []
    if (material.vertexColors && hasColors) d.push('VERTEX_COLORS')
    if (kind === 'mesh') {
      if (!material.unlit) {
        d.push('LIT')
        for (const [slot, define] of Object.entries(MAP_DEFINES)) if (material[slot]) d.push(define)
        d.push(...this.#lightDefines)
        if (this.#environment) d.push('ENV_MAP')
        else if (this.#studio) d.push('STUDIO')
      }
      if (material.map) d.push('MAP')
      if (material.emissiveMap) d.push('EMISSIVE_MAP')
      if (material.alphaTest > 0) d.push('ALPHA_TEST')
      if (material.flatShading) d.push('FLAT_SHADING')
      if (material.doubleSided) d.push('DOUBLE_SIDED')
      if (material.triplanar > 0 && MAP_SLOTS.some((slot) => material[slot])) d.push('TRIPLANAR')
      if (instanced) d.push('INSTANCED')
    } else if (kind === 'points') {
      if (material.map) d.push('MAP')
      if (material.sizeAttenuation) d.push('SIZE_ATTENUATION')
    }
    return d
  }
}

