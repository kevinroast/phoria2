// Bloom: the bright parts of the picture glow, light spilling round them as it does through a lens.
// The scene is drawn into a buffer of its own (multisampled, as the canvas is), its bright parts
// picked out and halved in size again and again, blurring as they go, then added back up the chain
// and laid over the picture on the canvas. Loaded the first time a view asks for bloom.
import { COMMON, FULLSCREEN_VERTEX } from './shaders.js'

/** @import { Programs } from './programs.js' */

/**
 * @typedef {object} BloomSettings
 * @property {number} strength how much glow is added
 * @property {number} radius 0 - 1: how far it spreads (how much the wider, blurrier levels count)
 * @property {number} threshold 0 - 1: how bright a colour has to be to glow
 */

// halve the picture, sampling a 4 x 4 block round each texel - the first time picking out what is
// bright enough to glow, with a soft knee so it doesn't switch on at a hard edge
const DOWN_FRAGMENT = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform sampler2D uSource;
uniform vec2 uTexel;        // one source texel
uniform float uThreshold;   // < 0: no threshold (every level after the first)
out vec4 fragColor;
${COMMON}
vec3 tap(vec2 uv) {
  vec3 c = texture(uSource, uv).rgb;
  return uThreshold < 0.0 ? c : srgbToLinear(c);
}
void main() {
  vec3 c = (tap(vUv + uTexel * vec2(-1.0, -1.0)) + tap(vUv + uTexel * vec2(1.0, -1.0)) +
            tap(vUv + uTexel * vec2(-1.0, 1.0)) + tap(vUv + uTexel * vec2(1.0, 1.0))) * 0.25;
  if (uThreshold >= 0.0) {
    float bright = max(c.r, max(c.g, c.b));
    float knee = uThreshold * 0.5 + 1e-4;
    float soft = clamp(bright - uThreshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee);
    c *= max(soft, bright - uThreshold) / max(bright, 1e-4);
  }
  fragColor = vec4(c, 1.0);
}
`

// double it again with a tent filter, to be added onto the level above
const UP_FRAGMENT = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uWeight;
out vec4 fragColor;
void main() {
  vec3 c = texture(uSource, vUv).rgb * 4.0;
  c += (texture(uSource, vUv + uTexel * vec2(-1.0, 0.0)).rgb + texture(uSource, vUv + uTexel * vec2(1.0, 0.0)).rgb +
        texture(uSource, vUv + uTexel * vec2(0.0, -1.0)).rgb + texture(uSource, vUv + uTexel * vec2(0.0, 1.0)).rgb) * 2.0;
  c += texture(uSource, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture(uSource, vUv + uTexel * vec2(1.0, -1.0)).rgb +
       texture(uSource, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture(uSource, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  fragColor = vec4(c / 16.0 * uWeight, 1.0);
}
`

// the picture with its glow added, in linear light, back out as premultiplied sRGB
const COMPOSITE_FRAGMENT = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uStrength;
out vec4 fragColor;
${COMMON}
void main() {
  vec4 scene = texture(uScene, vUv);
  vec3 glow = texture(uBloom, vUv).rgb * uStrength;
  vec3 c = srgbToLinear(scene.rgb) + glow;
  // where the canvas is see-through, the glow brings its own cover
  float a = clamp(scene.a + max(glow.r, max(glow.g, glow.b)), 0.0, 1.0);
  fragColor = vec4(linearToSrgb(c), a);
}
`

const DOWN = /** @type {[string, string]} */ ([FULLSCREEN_VERTEX, DOWN_FRAGMENT])
const UP = /** @type {[string, string]} */ ([FULLSCREEN_VERTEX, UP_FRAGMENT])
const COMPOSITE = /** @type {[string, string]} */ ([FULLSCREEN_VERTEX, COMPOSITE_FRAGMENT])
// levels down the chain: the last is 1/64 of the picture across, or as small as is still 8 pixels
const LEVELS = 6

/**
 * @typedef {object} Target
 * @property {number} width
 * @property {number} height
 * @property {WebGLFramebuffer} multisampled drawn into
 * @property {WebGLRenderbuffer[]} buffers its colour and depth
 * @property {WebGLFramebuffer} resolved the picture, as a texture
 * @property {WebGLTexture} picture
 * @property {{ texture: WebGLTexture, framebuffer: WebGLFramebuffer, width: number, height: number }[]} levels
 */

export class Bloom {
  /** @type {Target | null} */ #target = null
  /** @type {WebGLVertexArrayObject | null} */ #empty = null
  #float = false

  /** @param {WebGL2RenderingContext} gl @param {Programs} programs */
  constructor(gl, programs) {
    this.gl = gl
    this.programs = programs
    this.reset()
  }

  /** Forget every GL object - after a lost context, when they are already gone. */
  reset() {
    this.#target = null
    this.#empty = null
    // half floats keep the glow smooth as the levels are added up; 8 bits if they can't be drawn to
    this.#float = !!this.gl.getExtension('EXT_color_buffer_float')
  }

  /** Free the buffers, as a view stops using bloom. */
  dispose() {
    this.#free()
    this.#target = null
  }

  /**
   * Start a frame: the scene is drawn into the bloom buffer instead of the canvas.
   * @param {number} width @param {number} height drawing buffer pixels
   */
  begin(width, height) {
    const gl = this.gl
    const target = this.#targetFor(width, height)
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.multisampled)
    gl.viewport(0, 0, width, height)
  }

  /**
   * Finish a frame: blur the bright parts and draw the picture with its glow onto the canvas.
   * @param {BloomSettings} settings
   */
  end(settings) {
    const gl = this.gl
    const target = /** @type {Target} */ (this.#target)
    const { width, height, levels } = target
    // the multisampled picture into a texture
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.multisampled)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.resolved)
    gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)

    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.disable(gl.BLEND)
    gl.depthMask(false)
    gl.bindVertexArray(this.#emptyArray())

    // down: each level half the one before, the first keeping only what is bright
    const down = this.programs.ready('bloom-down', [], DOWN)
    gl.useProgram(down.program)
    let source = target.picture, sw = width, sh = height
    levels.forEach((level, i) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, level.framebuffer)
      gl.viewport(0, 0, level.width, level.height)
      down.set('uSource', source)
      down.set('uTexel', [1 / sw, 1 / sh])
      down.set('uThreshold', i === 0 ? Math.max(0, settings.threshold) : -1)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      source = level.texture
      sw = level.width
      sh = level.height
    })

    // up: each level blurred back onto the one above, the wider ones counting for less at a small radius
    const up = this.programs.ready('bloom-up', [], UP)
    gl.useProgram(up.program)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE)
    const weight = Math.min(1, Math.max(0, settings.radius))
    for (let i = levels.length - 1; i > 0; i--) {
      const from = levels[i], to = levels[i - 1]
      gl.bindFramebuffer(gl.FRAMEBUFFER, to.framebuffer)
      gl.viewport(0, 0, to.width, to.height)
      up.set('uSource', from.texture)
      up.set('uTexel', [1 / from.width, 1 / from.height])
      up.set('uWeight', weight)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    gl.disable(gl.BLEND)

    // onto the canvas
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, width, height)
    const composite = this.programs.ready('bloom-composite', [], COMPOSITE)
    gl.useProgram(composite.program)
    composite.set('uScene', target.picture)
    composite.set('uBloom', levels[0].texture)
    composite.set('uStrength', Math.max(0, settings.strength))
    gl.drawArrays(gl.TRIANGLES, 0, 3)

    gl.depthMask(true)
    gl.enable(gl.DEPTH_TEST)
    gl.bindVertexArray(null)
  }

  /** The buffers for this size, made again when it changes. @param {number} width @param {number} height */
  #targetFor(width, height) {
    if (this.#target && this.#target.width === width && this.#target.height === height) return this.#target
    this.#free()
    const gl = this.gl
    const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES))
    const multisampled = /** @type {WebGLFramebuffer} */ (gl.createFramebuffer())
    gl.bindFramebuffer(gl.FRAMEBUFFER, multisampled)
    const color = /** @type {WebGLRenderbuffer} */ (gl.createRenderbuffer())
    gl.bindRenderbuffer(gl.RENDERBUFFER, color)
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, width, height)
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color)
    const depth = /** @type {WebGLRenderbuffer} */ (gl.createRenderbuffer())
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth)
    gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, width, height)
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth)

    const texture = (w, h, format) => {
      const t = /** @type {WebGLTexture} */ (gl.createTexture())
      gl.activeTexture(gl.TEXTURE15)
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texStorage2D(gl.TEXTURE_2D, 1, format, w, h)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      const framebuffer = /** @type {WebGLFramebuffer} */ (gl.createFramebuffer())
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0)
      return { texture: t, framebuffer, width: w, height: h }
    }
    const picture = texture(width, height, gl.RGBA8)
    const levels = []
    let w = width, h = height
    for (let i = 0; i < LEVELS; i++) {
      w = Math.max(1, w >> 1)
      h = Math.max(1, h >> 1)
      if (i > 1 && Math.min(w, h) < 8) break
      levels.push(texture(w, h, this.#float ? gl.RGBA16F : gl.RGBA8))
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindRenderbuffer(gl.RENDERBUFFER, null)
    this.#target = { width, height, multisampled, buffers: [color, depth], resolved: picture.framebuffer, picture: picture.texture, levels }
    return this.#target
  }

  #free() {
    const target = this.#target
    if (!target) return
    const gl = this.gl
    gl.deleteFramebuffer(target.multisampled)
    for (const b of target.buffers) gl.deleteRenderbuffer(b)
    gl.deleteFramebuffer(target.resolved)
    gl.deleteTexture(target.picture)
    for (const level of target.levels) {
      gl.deleteFramebuffer(level.framebuffer)
      gl.deleteTexture(level.texture)
    }
  }

  // full-screen passes have no attributes, but still want a vertex array of their own
  #emptyArray() {
    if (!this.#empty) this.#empty = this.gl.createVertexArray()
    return this.#empty
  }
}
