// Bloom: the bright parts of the picture glow, light spilling round them as it does through a lens.
// A step of the picture's post chain: it reads the scene's picture, picks out its bright parts and
// halves them in size again and again, blurring as they go, adds them back up the chain, and draws
// the picture with its glow wherever the chain says - the canvas, or the next step's target. Loaded
// the first time a view asks for bloom.
import { COMMON, FULLSCREEN_VERTEX, TONE_MAP } from './shaders.js'

/** @import { Programs } from './programs.js' */
/** @import { TargetPool } from './targets.js' */

/**
 * @typedef {object} BloomSettings
 * @property {number} strength how much glow is added
 * @property {number} radius 0 - 1: how far it spreads (how much the wider, blurrier levels count)
 * @property {number} threshold how bright the light behind a colour has to be to glow (1: a white surface in full light)
 */

// Bloom works in light: from each colour as the surfaces' tone map left it, it works out the light
// behind it again - the tone map run backwards - so what is brighter glows more, past white: an
// emissive panel at 8 glows more than one at 2, though both show near white. The picture is sRGB (a
// float target where it can be drawn to, blended just as the canvas would be) or, with LINEAR_INPUT,
// linear light. The tone maps never quite reach white, so a colour at white or past it wasn't mapped
// - unlit colours, additive points piling up - and counts as it is: a pure red label is 1, not a
// light. What maps nearer white than BLOOM_PEAK counts as BLOOM_PEAK (half floats can't tell it
// apart); without float targets, nearer than 8 bits can.
const UNTONE = /* glsl */ `
${TONE_MAP}
const float BLOOM_PEAK = 16.0;
// the light a surface's tone map turned into this colour (scaled by the exposure). Only its brightness
// is run backwards - its brightest channel - and the colour scaled to it, keeping the hue it shows:
// undoing the maps' hue shifts too (Neutral's desaturation, ACES a channel at a time) pulls channels
// near white apart - a pale window's soft edge would glow pure red
vec3 untone(vec3 c) {
  c = max(c, 0.0);
  float top = max(c.r, max(c.g, c.b));
  if (top <= 0.0) return c;
  if (uToneMapping == 1) {
    // ACES (Narkowicz) runs to 1.033: white exactly, or past that, wasn't mapped
    if (abs(top - 1.0) < 1e-3 || top >= 1.0329) return c;
    // its rational curve solved for the light
    float a = min(2.43 * top - 2.51, -1e-4), b = 0.59 * top - 0.03, k = 0.14 * top;
    return c * (min((-b - sqrt(max(b * b - 4.0 * a * k, 0.0))) / (2.0 * a), BLOOM_PEAK) / top);
  } else if (uToneMapping == 2) {
    // Khronos PBR Neutral, backwards: its highlight compression, then its toe
    if (top >= 0.999) return c;
    if (top > 0.8) c *= min(0.6 + 0.04 / (1.0 - top), BLOOM_PEAK) / top;
    float y = min(c.r, min(c.g, c.b));
    return c + (y < 0.04 ? 0.4 * sqrt(y) - y : 0.04);
  }
  return c;
}
`

// halve the picture, sampling a 4 x 4 block round each texel - the first time picking out what is
// bright enough to glow, with a soft knee so it doesn't switch on at a hard edge
const DOWN_FRAGMENT = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform sampler2D uSource;
uniform vec2 uTexel;        // one source texel
uniform float uThreshold;   // < 0: no threshold (every level after the first)
uniform float uRange;       // how far past the threshold the glow keeps growing before it levels off
out vec4 fragColor;
${COMMON}
${UNTONE}
// a colour of the picture, in linear light, not premultiplied
vec3 shownAt(vec4 c) {
  if (c.a <= 0.0) return vec3(0.0);
#ifdef LINEAR_INPUT
  return c.rgb / c.a;
#else
  return srgbToLinear(c.rgb / c.a);
#endif
}
// one of the picture's own pixels, as light - premultiplied: the light of the colour itself, faded
// again by its cover
vec3 lightAt(ivec2 p, ivec2 size) {
  vec4 c = texelFetch(uSource, clamp(p, ivec2(0), size - 1), 0);
  return untone(shownAt(c)) * c.a;
}
void main() {
  vec3 c;
  if (uThreshold >= 0.0) {
    // the first level: the same 4 x 4 block, a pixel at a time - each turned to light before they are
    // averaged. Filtering first would blend a white window into the night round it to 0.99, which
    // the tone map, run backwards, reads as five times white
    ivec2 size = textureSize(uSource, 0), at = ivec2(gl_FragCoord.xy) * 2 - 1;
    c = vec3(0.0);
    for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) c += lightAt(at + ivec2(x, y), size);
    c /= 16.0;
  } else {
    // light already: four filtered taps, each the mean of a 2 x 2
    c = (texture(uSource, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture(uSource, vUv + uTexel * vec2(1.0, -1.0)).rgb +
         texture(uSource, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture(uSource, vUv + uTexel * vec2(1.0, 1.0)).rgb) * 0.25;
  }
  if (uThreshold >= 0.0) {
    float bright = max(c.r, max(c.g, c.b));
    float knee = uThreshold * 0.5 + 1e-4;
    float soft = clamp(bright - uThreshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee);
    // what is past the threshold, with diminishing returns: brighter still glows more, but a polished
    // surface mirroring the key light (16 or more) can't swamp the picture
    float past = max(soft, bright - uThreshold);
    c *= past / (1.0 + past / uRange) / max(bright, 1e-4);
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

// the picture with its glow. The glow is light: added to the light behind each colour and the sum
// tone mapped, so it rolls off into white as a lens's does, and a pixel it doesn't reach is exactly
// as it was - bloom at strength 0 is no bloom. Out as premultiplied sRGB, or with LINEAR_INPUT left
// linear for the chain to encode at its end
const COMPOSITE_FRAGMENT = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uStrength;
out vec4 fragColor;
${COMMON}
${UNTONE}
vec3 shownAt(vec4 c) {
  if (c.a <= 0.0) return vec3(0.0);
#ifdef LINEAR_INPUT
  return c.rgb / c.a;
#else
  return srgbToLinear(c.rgb / c.a);
#endif
}
void main() {
  vec4 scene = texture(uScene, vUv);
  vec3 glow = texture(uBloom, vUv).rgb * uStrength;
  vec3 light = untone(shownAt(scene));
  glow = max(toneCurve(light + glow) - toneCurve(light), 0.0);
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
// the glow's growth past the threshold levels off towards this much light: a mirror-like crown
// catching the key light (16 past it) glows about 3, a softbox at 8 (6.5 past) about 2.5
const BLOOM_RANGE = 4

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
   * @param {{ exposure: number, toneMapping: number, linear: boolean }} tone the surfaces' tone map, run
   *   backwards to find the light behind the picture; linear: the picture is in linear light, and the
   *   glow stays so (otherwise sRGB)
   */
  apply(picture, output, width, height, settings, tone) {
    const gl = this.gl
    const defines = tone.linear ? ['LINEAR_INPUT'] : []
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
      if (i === 0) {
        down.set('uRange', BLOOM_RANGE)
        down.set('uExposure', tone.exposure)
        down.set('uToneMapping', tone.toneMapping)
      }
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
    composite.set('uExposure', tone.exposure)
    composite.set('uToneMapping', tone.toneMapping)
    this.programs.drawFullscreen()

    gl.depthMask(true)
    gl.enable(gl.DEPTH_TEST)
    gl.bindVertexArray(null)
  }
}
