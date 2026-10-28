import * as mat3 from '../math/mat3.js'
import { collect } from '../frame.js'
import { checkNumber, checkOneOf, checkOptions, checkRange, describe, fail, warnOnce } from '../validate.js'
import { GLContext } from './context.js'
import { SHADOW_MAP_SIZE } from '../shadow.js'

/** @import { FrameDescription, DrawItem, FrameLight } from '../frame.js' */
/** @import { Scene } from '../scene/Scene.js' */
/** @import { Camera } from '../scene/cameras.js' */
/** @import { Material } from '../material/Material.js' */
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
const MAP_DEFINES = { roughnessMap: 'ROUGHNESS_MAP', metalnessMap: 'METALNESS_MAP', normalMap: 'NORMAL_MAP', aoMap: 'AO_MAP' }
const MAP_UNIFORMS = { map: 'uMap', roughnessMap: 'uRoughnessMap', metalnessMap: 'uMetalnessMap', normalMap: 'uNormalMap', aoMap: 'uAoMap', emissiveMap: 'uEmissiveMap' }

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
  /** This frame's shadow map, when something casts. @type {{ texture: WebGLTexture, matrix: Float32Array, texel: number, bias: number } | null} */ #shadow = null
  /** @type {Float32Array} */ #normalMatrix = new Float32Array(9)
  /** @type {Record<string, any>} */ #lights = {}
  /** This frame waits for shaders to compile rather than leaving things out. */
  #wait = false
  /** This frame's light counts and environment, compiled into the lit programs. @type {string[]} */ #lightDefines = []
  #studio = false

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
    const passes = gpu.loadPasses(!!frame.shadow || (typeof env === 'object' && !!env.image) || (!!bg && !('getHex' in bg) && !!bg.image))
    this.#environment = passes && typeof env === 'object' ? passes.environment(env) : null
    if (passes && typeof env === 'object' && env.image && !this.#environment) {
      warnOnce(env, env.isHDR ? "this device can't render to float textures, which HDR environments need - lighting without it"
        : "'environment' needs an HDR image (a .hdr file) - lighting without it")
    }
    // the light's view first, into its own depth texture
    const shadow = passes ? frame.shadow : null
    if (shadow && passes) {
      const map = passes.shadowMap(shadow)
      this.#shadow = { ...map, texel: 1 / SHADOW_MAP_SIZE, bias: shadow.texelSize * 1.5 }
    } else {
      this.#shadow = null
    }

    // with bloom, the scene is drawn into a buffer of its own first (drawn plainly while its code loads)
    const bloom = this.#bloom ? gpu.loadBloom() : null
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
    gl.enable(gl.BLEND)
    for (const item of frame.transparent) this.#draw(item, frame, true)
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
    const range = new Float32Array(punctual), direction = new Float32Array(punctual * 3)
    const cone = new Float32Array(punctual * 2)
    let dirCount = 0, punctualCount = 0
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
        if (l.kind === 'spot') {
          direction.set(/** @type {ArrayLike<number>} */ (l.direction), i * 3)
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
      uPunctualDirection: direction, uPunctualCone: cone,
    }
  }

  /** @param {DrawItem} item @param {FrameDescription} frame @param {boolean} transparent */
  #draw(item, frame, transparent) {
    const gl = this.gl
    const { node, geometry, material, worldMatrix, instances } = item
    const mode = /** @type {any} */ (node).drawMode
    const kind = mode === 'points' ? 'points' : mode === 'lines' ? 'lines' : 'mesh'
    const shadowed = kind === 'mesh' && !!this.#shadow && node.receiveShadow && !material.unlit

    const clip = kind === 'mesh' ? item.clip : null
    const defines = this.#defines(kind, material, geometry.colors !== null, !!instances, shadowed)
    if (clip) {
      defines.push('CLIP')
      if (clip.cap) defines.push('CAP')
    }
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
          program.set('uEnvMap', env.prefiltered)
          program.set('uEnvMaxLod', env.maxLod)
          program.set('uEnvSH', env.sh)
          program.set('uEnvIntensity', frame.environmentIntensity)
        }
        if (shadowed && this.#shadow) {
          program.set('uShadowMap', this.#shadow.texture)
          program.set('uShadowMatrix', this.#shadow.matrix)
          program.set('uShadowTexel', this.#shadow.texel)
          program.set('uShadowBias', this.#shadow.bias)
        }
      }
    }

    program.set('uModel', worldMatrix)
    const hl = frame.highlight
    if (hl && hl.node === node) {
      program.set('uHighlightIndex', hl.index ?? -1)
      program.set('uHighlight', [hl.color[0], hl.color[1], hl.color[2], hl.amount])
    } else {
      program.set('uHighlightIndex', -2)
    }
    program.set('uColor', material.color)
    program.set('uOpacity', material.opacity)
    if (clip) {
      program.set('uClipPlane', clip.plane)
      if (clip.cap) program.set('uCapColor', clip.cap)
    }
    const e = material.emissive, k = material.emissiveIntensity
    program.set('uEmissive', [e[0] * k, e[1] * k, e[2] * k])
    program.set('uRoughness', material.roughness)
    program.set('uMetalness', material.metalness)
    program.set('uNormalScale', material.normalScale)
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
      // output is premultiplied, so 'normal' is ONE / ONE_MINUS_SRC_ALPHA
      if (material.blending === 'additive') gl.blendFunc(gl.ONE, gl.ONE)
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
    // the back, for double-sided materials and caps
    gl.frontFace(determinant3(worldMatrix) < 0 ? gl.CW : gl.CCW)
    if (material.doubleSided || clip?.cap) {
      // a cap is the back faces seen through the cut
      gl.disable(gl.CULL_FACE)
    } else {
      gl.enable(gl.CULL_FACE)
      gl.cullFace(gl.BACK)
    }
    const buffers = this.#gpu.resources.mesh(geometry, instances, true)
    gl.bindVertexArray(buffers.vao)
    const count = instances ? instances.count : 1
    const elements = geometry.drawnCount - geometry.drawnCount % 3
    if (buffers.indexType) {
      if (instances) gl.drawElementsInstanced(gl.TRIANGLES, elements, buffers.indexType, 0, count)
      else gl.drawElements(gl.TRIANGLES, elements, buffers.indexType, 0)
    } else {
      if (instances) gl.drawArraysInstanced(gl.TRIANGLES, 0, elements, count)
      else gl.drawArrays(gl.TRIANGLES, 0, elements)
    }
    this.info.drawCalls++
    this.info.triangles += elements / 3 * count
  }

  /**
   * @param {'mesh' | 'points' | 'lines'} kind @param {Material} material
   * @param {boolean} hasColors @param {boolean} instanced @param {boolean} shadowed
   * @returns {string[]}
   */
  #defines(kind, material, hasColors, instanced, shadowed) {
    const d = []
    if (material.vertexColors && hasColors) d.push('VERTEX_COLORS')
    if (kind === 'mesh') {
      if (!material.unlit) {
        d.push('LIT')
        for (const [slot, define] of Object.entries(MAP_DEFINES)) if (material[slot]) d.push(define)
        d.push(...this.#lightDefines)
        if (this.#environment) d.push('ENV_MAP')
        else if (this.#studio) d.push('STUDIO')
        if (shadowed) d.push('SHADOW')
      }
      if (material.map) d.push('MAP')
      if (material.emissiveMap) d.push('EMISSIVE_MAP')
      if (material.alphaTest > 0) d.push('ALPHA_TEST')
      if (material.flatShading) d.push('FLAT_SHADING')
      if (material.doubleSided) d.push('DOUBLE_SIDED')
      if (instanced) d.push('INSTANCED')
    } else if (kind === 'points') {
      if (material.map) d.push('MAP')
      if (material.sizeAttenuation) d.push('SIZE_ATTENUATION')
    }
    return d
  }
}

/** @param {ArrayLike<number>} m 4x4 */
function determinant3(m) {
  return m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5])
}
