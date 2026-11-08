// Bloom: the bright parts of the picture glow, light spilling round them as it does through a lens.
// A step of the picture's post chain: it reads the scene's picture, picks out its bright parts and
// halves them in size again and again, blurring as they go, adds them back up the chain, and draws
// the picture with its glow wherever the chain says - the canvas, or the next step's target. Loaded
// the first time a view asks for bloom.
import { COMMON, FULLSCREEN_VERTEX } from './shaders.js'

/** @import { Programs } from './programs.js' */
/** @import { TargetPool } from './targets.js' */

/**
 * @typedef {object} BloomSettings
 * @property {number} strength how much glow is added
 * @property {number} radius 0 - 1: how far it spreads (how much the wider, blurrier levels count)
 * @property {number} threshold 0 - 1: how bright a colour has to be to glow
 */

// halve the picture, sampling a 4 x 4 block round each texel - the first time picking out what is
// bright enough to glow, with a soft knee so it doesn't switch on at a hard edge. The picture is
// sRGB, or with LINEAR_INPUT already in linear light
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
#ifdef LINEAR_INPUT
  return c;
#else
  return uThreshold < 0.0 ? c : srgbToLinear(c);
#endif
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

// the picture with its glow added, in linear light - back out as premultiplied sRGB, or with
// LINEAR_INPUT left linear for the chain to encode at its end
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
  // where the canvas is see-through, the glow brings its own cover
  float a = clamp(scene.a + max(glow.r, max(glow.g, glow.b)), 0.0, 1.0);
#ifdef LINEAR_INPUT
  fragColor = vec4(scene.rgb + glow, a);
#else
  fragColor = vec4(linearToSrgb(srgbToLinear(scene.rgb) + glow), a);
#endif
}
`

const DOWN = /** @type {[string, string]} */ ([FULLSCREEN_VERTEX, DOWN_FRAGMENT])
const UP = /** @type {[string, string]} */ ([FULLSCREEN_VERTEX, UP_FRAGMENT])
const COMPOSITE = /** @type {[string, string]} */ ([FULLSCREEN_VERTEX, COMPOSITE_FRAGMENT])
// levels down the chain: the last is 1/64 of the picture across, or as small as is still 8 pixels
const LEVELS = 6

export class Bloom {
  #float = false

  /** @param {WebGL2RenderingContext} gl @param {Programs} programs @param {TargetPool} targets */
  constructor(gl, programs, targets) {
    this.gl = gl
    this.programs = programs
    this.targets = targets
    this.reset()
  }

  /** After a lost context: what it can render to, asked again. */
  reset() {
    // half floats keep the glow smooth as the levels are added up; 8 bits if they can't be drawn to
    this.#float = !!this.gl.getExtension('EXT_color_buffer_float')
  }

  /**
   * The picture with its glow, drawn into `output`.
   * @param {WebGLTexture} picture the scene, as drawn
   * @param {WebGLFramebuffer | null} output null: the canvas
   * @param {number} width @param {number} height
   * @param {BloomSettings} settings
   * @param {boolean} linear the picture is in linear light, and the glow stays so
   */
  apply(picture, output, width, height, settings, linear) {
    const gl = this.gl
    const defines = linear ? ['LINEAR_INPUT'] : []
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.disable(gl.BLEND)
    gl.depthMask(false)

    // the levels: each half the one before, as long as it is still 8 pixels
    const levels = []
    let w = width, h = height
    for (let i = 0; i < LEVELS; i++) {
      w = Math.max(1, w >> 1)
      h = Math.max(1, h >> 1)
      if (i > 1 && Math.min(w, h) < 8) break
      levels.push(this.targets.get(`bloom-${i}`, { width: w, height: h, color: this.#float ? gl.RGBA16F : gl.RGBA8 }))
    }

    // down: each level half the one before, the first keeping only what is bright
    const down = this.programs.ready('bloom-down', defines, DOWN)
    gl.useProgram(down.program)
    let source = picture, sw = width, sh = height
    levels.forEach((level, i) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, level.framebuffer)
      gl.viewport(0, 0, level.width, level.height)
      down.set('uSource', source)
      down.set('uTexel', [1 / sw, 1 / sh])
      down.set('uThreshold', i === 0 ? Math.max(0, settings.threshold) : -1)
      this.programs.drawFullscreen()
      source = /** @type {WebGLTexture} */ (level.texture)
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
      this.programs.drawFullscreen()
    }
    gl.disable(gl.BLEND)

    // the picture with its glow
    gl.bindFramebuffer(gl.FRAMEBUFFER, output)
    gl.viewport(0, 0, width, height)
    const composite = this.programs.ready('bloom-composite', defines, COMPOSITE)
    gl.useProgram(composite.program)
    composite.set('uScene', picture)
    composite.set('uBloom', levels[0].texture)
    composite.set('uStrength', Math.max(0, settings.strength))
    this.programs.drawFullscreen()

    gl.depthMask(true)
    gl.enable(gl.DEPTH_TEST)
    gl.bindVertexArray(null)
  }
}
