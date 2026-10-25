import * as mat3 from '../math/mat3.js'
import { collect } from '../frame.js'
import { checkOneOf, checkOptions, fail, warnOnce } from '../validate.js'
import { Programs } from './programs.js'
import { Resources } from './resources.js'
import { MAX_DIRECTIONAL, MAX_PUNCTUAL } from './shaders.js'

/** @import { FrameDescription, DrawItem, FrameLight } from '../frame.js' */
/** @import { Scene } from '../scene/Scene.js' */
/** @import { Camera } from '../scene/cameras.js' */
/** @import { Material } from '../material/Material.js' */

/** @typedef {'aces' | 'neutral' | 'none'} ToneMapping */

/**
 * @typedef {object} WebGLRendererOptions
 * @property {HTMLCanvasElement | OffscreenCanvas} canvas
 * @property {boolean} [antialias] multisampling (default true)
 * @property {ToneMapping} [toneMapping] how lit colours are mapped to the screen: 'neutral' keeps colours
 *   true (Khronos PBR Neutral, the default), 'aces' is filmic, 'none' clips
 * @property {number} [exposure] (default 1)
 * @property {number} [pixelRatio] drawing buffer pixels per CSS pixel (default 1; View sets it)
 */

const OPTIONS = ['canvas', 'antialias', 'toneMapping', 'exposure', 'pixelRatio']
const TONE_MAPPING = { none: 0, aces: 1, neutral: 2 }
// maps the WebGL 2 MVP doesn't draw yet - warned about once rather than silently ignored
const LATER_MAPS = ['roughnessMap', 'metalnessMap', 'normalMap', 'aoMap', 'emissiveMap']

/**
 * Draws a scene with WebGL 2. The View creates one; use it directly to drive your own loop:
 *
 *     const renderer = new WebGLRenderer({ canvas })
 *     renderer.setSize(canvas.clientWidth, canvas.clientHeight, devicePixelRatio)
 *     scene.update(dt, t)
 *     renderer.render(scene, camera)
 */
export class WebGLRenderer {
  /** @type {HTMLCanvasElement | OffscreenCanvas} */ canvas
  /** @type {WebGL2RenderingContext} */ gl
  /** @type {ToneMapping} */ toneMapping = 'neutral'
  exposure = 1
  pixelRatio = 1
  /** Counts from the last frame and the GPU caches. */
  info = { drawCalls: 0, triangles: 0, programs: 0, geometries: 0, textures: 0 }

  #programs
  #resources
  #frameNumber = 0
  #lost = false
  /** @type {Float32Array} */ #normalMatrix = new Float32Array(9)
  /** @type {Record<string, any>} */ #lights = {}
  /** @type {() => void} */ #removeListeners

  /** @param {WebGLRendererOptions} options */
  constructor(options) {
    checkOptions('WebGLRenderer', options, OPTIONS, { alpha: 'the canvas is always transparent where the scene has no background' })
    if (!options?.canvas) fail('WebGLRenderer', "'canvas' is required")
    this.canvas = options.canvas
    if (options.toneMapping !== undefined) this.toneMapping = checkOneOf('WebGLRenderer', 'toneMapping', options.toneMapping, ['aces', 'neutral', 'none'])
    if (options.exposure !== undefined) this.exposure = options.exposure
    if (options.pixelRatio !== undefined) this.pixelRatio = options.pixelRatio

    const gl = this.canvas.getContext('webgl2', {
      antialias: options.antialias ?? true,
      alpha: true,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
    })
    if (!gl) fail('WebGLRenderer', 'WebGL 2 is not available in this browser or on this device')
    this.gl = /** @type {WebGL2RenderingContext} */ (gl)
    this.#programs = new Programs(this.gl)
    this.#resources = new Resources(this.gl)

    // a lost context (GPU reset, too many contexts) is restored by the browser; every GPU object
    // is then recreated from the CPU-side data on the next frame
    const lost = (e) => {
      e.preventDefault()
      this.#lost = true
    }
    const restored = () => {
      this.#lost = false
      this.#programs.reset()
      this.#resources.reset()
    }
    this.canvas.addEventListener('webglcontextlost', lost)
    this.canvas.addEventListener('webglcontextrestored', restored)
    this.#removeListeners = () => {
      this.canvas.removeEventListener('webglcontextlost', lost)
      this.canvas.removeEventListener('webglcontextrestored', restored)
    }
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

  /** @param {FrameDescription} frame @returns {FrameDescription} */
  renderFrame(frame) {
    if (this.#lost) return frame
    const gl = this.gl
    this.#frameNumber++
    this.info.drawCalls = 0
    this.info.triangles = 0

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
    const bg = frame.background
    if (bg && 'getHex' in bg) {
      const [r, g, b] = bg.toSRGB()
      gl.clearColor(r, g, b, 1)
    } else {
      if (bg) warnOnce(frame.camera.camera, 'texture backgrounds come with environment lighting (slice 4) - drawing a transparent background for now')
      gl.clearColor(0, 0, 0, 0)
    }
    gl.depthMask(true)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
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

    this.info.programs = this.#programs.count
    this.info.geometries = this.#resources.counts.geometries
    this.info.textures = this.#resources.counts.textures
    return frame
  }

  /** Free every GPU resource this renderer made, and stop listening for context loss. */
  dispose() {
    this.#programs.dispose()
    this.#resources.reset()
    this.#removeListeners()
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }

  /** @param {FrameDescription} frame */
  #gatherLights(frame) {
    const ambient = [0, 0, 0], sky = [0, 0, 0], ground = [0, 0, 0]
    const dirDirection = new Float32Array(MAX_DIRECTIONAL * 3), dirColor = new Float32Array(MAX_DIRECTIONAL * 3)
    const pos = new Float32Array(MAX_PUNCTUAL * 3), color = new Float32Array(MAX_PUNCTUAL * 3)
    const range = new Float32Array(MAX_PUNCTUAL), direction = new Float32Array(MAX_PUNCTUAL * 3)
    const cone = new Float32Array(MAX_PUNCTUAL * 2)
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
    this.#lights = {
      uAmbient: ambient, uHemisphereSky: sky, uHemisphereGround: ground,
      uDirectionalCount: dirCount, uDirectionalDirection: dirDirection, uDirectionalColor: dirColor,
      uPunctualCount: punctualCount, uPunctualPosition: pos, uPunctualColor: color, uPunctualRange: range,
      uPunctualDirection: direction, uPunctualCone: cone,
      uEnvironment: frame.environment === 'studio' ? 1 : 0,
    }
  }

  /** @param {DrawItem} item @param {FrameDescription} frame @param {boolean} transparent */
  #draw(item, frame, transparent) {
    const gl = this.gl
    const { node, geometry, material, worldMatrix, instances } = item
    const mode = /** @type {any} */ (node).drawMode
    const kind = mode === 'points' ? 'points' : mode === 'lines' ? 'lines' : 'mesh'
    for (const slot of LATER_MAPS) {
      if (material[slot]) warnOnce(material, `${slot} isn't drawn yet - it comes with product-viewer materials (slice 4)`)
    }

    const defines = this.#defines(kind, material, geometry.colors !== null, !!instances)
    const program = this.#programs.get(kind, defines)
    gl.useProgram(program.program)

    // per-frame values, once per program per frame
    if (program.frame !== this.#frameNumber) {
      program.frame = this.#frameNumber
      program.set('uView', frame.camera.view)
      program.set('uProjection', frame.camera.projection)
      program.set('uCameraPosition', frame.camera.position)
      program.set('uExposure', this.exposure)
      program.set('uToneMapping', TONE_MAPPING[this.toneMapping])
      program.set('uResolution', [gl.drawingBufferWidth, gl.drawingBufferHeight])
      program.set('uNear', frame.camera.near)
      program.set('uScale', frame.camera.projection[5] * gl.drawingBufferHeight / 2)
      if (kind === 'mesh' && !material.unlit) {
        for (const [name, value] of Object.entries(this.#lights)) program.set(name, value)
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
    const e = material.emissive, k = material.emissiveIntensity
    program.set('uEmissive', [e[0] * k, e[1] * k, e[2] * k])
    program.set('uRoughness', material.roughness)
    program.set('uMetalness', material.metalness)
    const map = material.map
    if (map) {
      program.set('uMap', this.#resources.texture(map))
      program.set('uUvTransform', [map.repeat[0], map.repeat[1], map.offset[0], map.offset[1]])
    } else {
      program.set('uUvTransform', [1, 1, 0, 0])
    }

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
      const buffers = this.#resources.lines(geometry)
      gl.bindVertexArray(buffers.vao)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Math.min(buffers.count, Math.floor(geometry.drawnCount / 2)))
      this.info.drawCalls++
      return
    }

    if (kind === 'points') {
      gl.disable(gl.CULL_FACE)
      program.set('uSize', material.sizeAttenuation ? material.size : material.size * this.pixelRatio)
      const buffers = this.#resources.mesh(geometry, null, false)
      gl.bindVertexArray(buffers.vao)
      gl.drawArrays(gl.POINTS, 0, geometry.drawnCount)
      this.info.drawCalls++
      return
    }

    // triangles
    if (!mat3.normalFromMat4(this.#normalMatrix, worldMatrix)) mat3.identity(this.#normalMatrix)
    program.set('uNormalMatrix', this.#normalMatrix)
    if (material.doubleSided) {
      gl.disable(gl.CULL_FACE)
    } else {
      gl.enable(gl.CULL_FACE)
      gl.cullFace(gl.BACK)
      // a mirroring transform (negative scale) reverses the winding
      gl.frontFace(determinant3(worldMatrix) < 0 ? gl.CW : gl.CCW)
    }
    const buffers = this.#resources.mesh(geometry, instances, true)
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
   * @param {boolean} hasColors @param {boolean} instanced
   * @returns {string[]}
   */
  #defines(kind, material, hasColors, instanced) {
    const d = []
    if (material.vertexColors && hasColors) d.push('VERTEX_COLORS')
    if (kind === 'mesh') {
      if (!material.unlit) d.push('LIT')
      if (material.map) d.push('MAP')
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
