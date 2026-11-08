// The product viewer's passes, loaded the first time a view turns one on:
// - ambient occlusion: the solids' depth and normals drawn at half size, the shading in their creases
//   worked out from them, blurred, and read by the lit shader - which dims only the light from all
//   round (ambient, hemisphere, environment), never the lights' direct light;
// - a ground shadow: the solids' depth seen from below the ground, darker the nearer they are to it,
//   blurred and laid on the ground as a soft shadow - no light needed;
// - FXAA: the finished picture smoothed where its edges are jagged, as a last pass onto the canvas.
import * as mat4 from '../math/mat4.js'
import { FULLSCREEN_VERTEX } from './shaders.js'

/** @import { Programs } from './programs.js' */
/** @import { Passes } from './passes.js' */
/** @import { FrameDescription, DrawItem } from '../frame.js' */
/** @import { Box3 } from '../value/Box3.js' */

/**
 * @typedef {object} Occlusion what the lit shader reads: the occlusion and how to look it up
 * @property {WebGLTexture} texture r: how much light from all round reaches each pixel; g: its depth (with float targets)
 * @property {boolean} depth the texture carries depth, for an upsample that keeps edges
 * @property {[number, number]} scale gl_FragCoord to its coordinates
 * @property {[number, number, number, number]} viewZ the view matrix's third row
 */

/**
 * @typedef {object} Ground a ground shadow, ready to lay on the ground
 * @property {WebGLTexture} texture how dark each texel is
 * @property {[number, number, number, number]} rect its middle (x, z), half its width, and the ground's height
 * @property {number} opacity
 */

/** @typedef {{ texture: WebGLTexture, framebuffer: WebGLFramebuffer, width: number, height: number }} Target */
/** @typedef {{ width: number, height: number, picture: Target, multisampled: WebGLFramebuffer | null, buffers: WebGLRenderbuffer[] }} FxaaTargets */
/** @typedef {{ width: number, height: number, normals: Target, depth: WebGLTexture, occlusion: Target, blurred: Target }} OcclusionTargets */

// ambient occlusion: samples round each pixel in a spiral (as scalable ambient obscurance, McGuire
// et al.), its start turned from pixel to pixel - an integer hash, as fract(sin()) differs from GPU to
// GPU. Each sample that rises above the surface hides as much of the sky as the cosine of its
// angle up from it, less the further away it is; in units of the radius, so it is the same at any
// scale. At strength 1, an inside corner - a box standing on a floor - is about half in shade
const OCCLUSION_FRAGMENT = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform sampler2D uDepth;
uniform sampler2D uNormals;
uniform mat4 uInverseProjection;
uniform vec2 uSize;          // this target's pixels
uniform float uRadius;       // world units
uniform float uPixels;       // pixels a world unit spans at a distance of one (perspective) or anywhere (orthographic)
uniform float uPerspective;
uniform float uStrength;
out vec4 fragColor;
const int SAMPLES = 16;
vec3 viewAt(vec2 uv, float d) {
  vec4 p = uInverseProjection * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}
uint hash(uint x) {
  x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16;
  return x;
}
void main() {
  float d = texture(uDepth, vUv).r;
  if (d >= 1.0) {
    fragColor = vec4(1.0, 1e6, 0.0, 1.0);
    return;
  }
  vec3 p = viewAt(vUv, d);
  vec3 n = normalize(texture(uNormals, vUv).xyz * 2.0 - 1.0);
  // the radius in pixels here; less than one, nothing to find
  float px = min(uRadius * uPixels / (uPerspective > 0.5 ? -p.z : 1.0), uSize.y * 0.25);
  if (px < 1.0) {
    fragColor = vec4(1.0, -p.z, 0.0, 1.0);
    return;
  }
  // the spiral's turn from where the pixel sits in a 4 x 4 tile - sixteen turns spread evenly over
  // any 4 x 4 block, which the blur then takes out whole - nudged by a hash, so the tile doesn't show
  uvec2 at = uvec2(gl_FragCoord.xy);
  uint cell = (at.x & 3u) * 4u + (at.y & 3u);
  cell = ((cell & 1u) << 3) | ((cell & 2u) << 1) | ((cell & 4u) >> 1) | ((cell & 8u) >> 3);
  float spin = (float(cell) + float(hash(at.x + hash(at.y)) >> 24) / 256.0) * (6.2831853 / 16.0);
  float sum = 0.0;
  for (int i = 0; i < SAMPLES; i++) {
    float a = (float(i) + 0.5) / float(SAMPLES);
    float angle = a * 43.982297 + spin;  // seven turns
    vec2 uv = vUv + a * px * vec2(cos(angle), sin(angle)) / uSize;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) continue;
    float dq = texture(uDepth, uv).r;
    if (dq >= 1.0) continue;
    vec3 v = (viewAt(uv, dq) - p) / uRadius;
    float vv = dot(v, v);
    if (vv >= 1.0 || vv < 1e-6) continue;
    // a little off the cosine, so a curved or faceted surface doesn't shade itself
    sum += max(dot(v, n) * inversesqrt(vv) - 0.1, 0.0) * (1.0 - vv);
  }
  fragColor = vec4(clamp(1.0 - sum * uStrength * 4.0 / float(SAMPLES), 0.0, 1.0), -p.z, 0.0, 1.0);
}
`

// the occlusion blurred along one axis, each texel counting less the further its depth is from the
// middle one's - the spiral's noise smoothed out, edges kept
const OCCLUSION_BLUR_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D uSource;
uniform ivec2 uStep;
out vec4 fragColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy), last = textureSize(uSource, 0) - 1;
  vec2 c = texelFetch(uSource, p, 0).rg;
  float sum = c.r, total = 1.0;
  for (int i = 1; i <= 4; i++) {
    float g = exp(-float(i * i) / 8.0);
    for (int s = -1; s <= 1; s += 2) {
      vec2 t = texelFetch(uSource, clamp(p + uStep * i * s, ivec2(0), last), 0).rg;
#ifdef DEPTH
      float w = g * max(0.0, 1.0 - abs(t.g - c.g) / (c.g * 0.05 + 1e-4));
#else
      float w = g;
#endif
      sum += t.r * w;
      total += w;
    }
  }
  fragColor = vec4(sum / total, c.g, 0.0, 1.0);
}
`

// the ground shadow's darkness from the depth seen from below - darkest where things touch the
// ground, fading to nothing at the shadow's height - at half the depth's size, each texel the mean of
// the four depth texels under it
const GROUND_DARKNESS_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D uDepth;
out vec4 fragColor;
float dark(ivec2 p) {
  float d = texelFetch(uDepth, p, 0).r;
  return d < 1.0 ? 1.0 - d : 0.0;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) * 2;
  float c = (dark(p) + dark(p + ivec2(1, 0)) + dark(p + ivec2(0, 1)) + dark(p + ivec2(1, 1))) * 0.25;
  fragColor = vec4(c, 0.0, 0.0, 1.0);
}
`

// a gaussian along one axis, a tap a texel, as wide as the softness asks
const GROUND_BLUR_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D uSource;
uniform ivec2 uStep;
uniform int uRadius;
out vec4 fragColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy), last = textureSize(uSource, 0) - 1;
  float sigma = max(float(uRadius) * 0.5, 0.5);
  float sum = texelFetch(uSource, p, 0).r, total = 1.0;
  for (int i = 1; i <= uRadius; i++) {
    float g = exp(-float(i * i) / (2.0 * sigma * sigma));
    sum += (texelFetch(uSource, clamp(p + uStep * i, ivec2(0), last), 0).r + texelFetch(uSource, clamp(p - uStep * i, ivec2(0), last), 0).r) * g;
    total += 2.0 * g;
  }
  fragColor = vec4(sum / total, 0.0, 0.0, 1.0);
}
`

// the shadow laid on the ground: a square, faded towards its edges so it never shows as one
const GROUND_VERTEX = /* glsl */ `
uniform mat4 uViewProjection;
uniform vec4 uRect;          // middle x, middle z, half the width, the ground's height
out vec2 vUv;
void main() {
  vec2 p = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vUv = p;
  gl_Position = uViewProjection * vec4(uRect.x + (p.x * 2.0 - 1.0) * uRect.z, uRect.w, uRect.y + (p.y * 2.0 - 1.0) * uRect.z, 1.0);
}
`
const GROUND_FRAGMENT = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform sampler2D uShadow;
uniform float uOpacity;
out vec4 fragColor;
void main() {
  vec2 edge = smoothstep(0.0, 0.1, min(vUv, 1.0 - vUv));
  // premultiplied black, as much as the shadow is dark
  fragColor = vec4(0.0, 0.0, 0.0, texture(uShadow, vUv).r * uOpacity * edge.x * edge.y);
}
`

// FXAA: where the picture's brightness changes sharply, blend along the edge rather than across it
// (Lottes's FXAA, in its small form)
const FXAA_FRAGMENT = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform sampler2D uSource;
uniform vec2 uTexel;
out vec4 fragColor;
float luma(vec4 c) { return dot(c.rgb, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec4 m = texture(uSource, vUv);
  float lm = luma(m);
  float nw = luma(texture(uSource, vUv + vec2(-1.0, -1.0) * uTexel));
  float ne = luma(texture(uSource, vUv + vec2(1.0, -1.0) * uTexel));
  float sw = luma(texture(uSource, vUv + vec2(-1.0, 1.0) * uTexel));
  float se = luma(texture(uSource, vUv + vec2(1.0, 1.0) * uTexel));
  float lo = min(lm, min(min(nw, ne), min(sw, se)));
  float hi = max(lm, max(max(nw, ne), max(sw, se)));
  vec2 dir = vec2(-((nw + ne) - (sw + se)), (nw + sw) - (ne + se));
  float reduce = max((nw + ne + sw + se) * 0.03125, 1.0 / 128.0);
  dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + reduce), -8.0, 8.0) * uTexel;
  vec4 a = 0.5 * (texture(uSource, vUv - dir / 6.0) + texture(uSource, vUv + dir / 6.0));
  vec4 b = 0.5 * a + 0.25 * (texture(uSource, vUv - dir * 0.5) + texture(uSource, vUv + dir * 0.5));
  float lb = luma(b);
  fragColor = lb < lo || lb > hi ? a : b;
}
`

const OCCLUSION = /** @type {[string, string]} */ ([FULLSCREEN_VERTEX, OCCLUSION_FRAGMENT])
const OCCLUSION_BLUR = /** @type {[string, string]} */ ([FULLSCREEN_VERTEX, OCCLUSION_BLUR_FRAGMENT])
const GROUND_DARKNESS = /** @type {[string, string]} */ ([FULLSCREEN_VERTEX, GROUND_DARKNESS_FRAGMENT])
const GROUND_BLUR = /** @type {[string, string]} */ ([FULLSCREEN_VERTEX, GROUND_BLUR_FRAGMENT])
const GROUND = /** @type {[string, string]} */ ([GROUND_VERTEX, GROUND_FRAGMENT])
const FXAA = /** @type {[string, string]} */ ([FULLSCREEN_VERTEX, FXAA_FRAGMENT])
const GROUND_SIZE = 512
// buffers kept for this many picture sizes: views of different sizes sharing a context (a dashboard)
// each find theirs, rather than every view remaking them every frame
const SIZES = 4
// the darkness, and its blur, at half that
const GROUND_BLUR_SIZE = GROUND_SIZE / 2
// the widest blur, in texels of that
const GROUND_BLUR_RADIUS = 32

export class Effects {
  /** Rendering to float textures: occlusion keeps its depth, for an upsample that keeps edges. */
  floatTargets = false
  /** By picture size. @type {Map<string, OcclusionTargets>} */ #occlusion = new Map()
  /** @type {{ depth: { texture: WebGLTexture, framebuffer: WebGLFramebuffer }, a: Target, b: Target } | null} */ #ground = null
  /** By picture size. @type {Map<string, FxaaTargets>} */ #fxaaTargetsBySize = new Map()
  /** This frame's, from beginFxaa(). @type {FxaaTargets | null} */ #fxaa = null
  /** Where the solids were last: the ground shadow keeps its square until they move well out of it. @type {[number, number, number] | null} */ #square = null
  /** @type {WebGLVertexArrayObject | null} */ #empty = null

  /** @param {WebGL2RenderingContext} gl @param {Programs} programs */
  constructor(gl, programs) {
    this.gl = gl
    this.programs = programs
    this.reset()
  }

  /** Forget every GL object - after a lost context, when they are already gone. */
  reset() {
    this.#occlusion = new Map()
    this.#ground = null
    this.#fxaaTargetsBySize = new Map()
    this.#fxaa = null
    this.#empty = null
    this.floatTargets = !!this.gl.getExtension('EXT_color_buffer_float')
  }

  /** Free the buffers, as the last view using these effects stops. */
  dispose() {
    for (const t of this.#occlusion.values()) this.#freeOcclusion(t)
    this.#freeGround()
    for (const t of this.#fxaaTargetsBySize.values()) this.#freeFxaa(t)
    if (this.#empty) this.gl.deleteVertexArray(this.#empty)
    this.reset()
  }

  /**
   * Ambient occlusion for this frame, before the picture is drawn: the solids' depth and normals at
   * half size, the occlusion from them, blurred.
   * @param {FrameDescription} frame @param {Passes} passes
   * @param {{ strength: number, radius: number | null }} settings
   * @param {number} width @param {number} height the picture's pixels
   * @param {number} sceneSize the solids' size, for the default radius
   * @returns {Occlusion}
   */
  occlusion(frame, passes, settings, width, height, sceneSize) {
    const gl = this.gl
    const w = Math.max(1, Math.ceil(width / 2)), h = Math.max(1, Math.ceil(height / 2))
    const t = this.#occlusionTargets(w, h)
    const { view, projection, viewProjection } = frame.camera

    // the solids' depth and view-space normals
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.normals.framebuffer)
    gl.viewport(0, 0, w, h)
    gl.clearColor(0.5, 0.5, 1, 0)
    gl.depthMask(true)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.disable(gl.BLEND)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    const solids = frame.opaque.filter((item) => item.node.drawMode === 'triangles' && item.material.depthWrite)
    passes.drawDepth(solids, viewProjection, { normals: view })
    gl.disable(gl.CULL_FACE)

    // the occlusion from them
    gl.disable(gl.DEPTH_TEST)
    gl.depthMask(false)
    const radius = settings.radius ?? Math.max(sceneSize, 1e-6) / 20
    const occlusion = this.programs.ready('ssao', [], OCCLUSION)
    gl.useProgram(occlusion.program)
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.occlusion.framebuffer)
    occlusion.set('uDepth', t.depth)
    occlusion.set('uNormals', t.normals.texture)
    occlusion.set('uInverseProjection', mat4.invert(new Float32Array(16), projection) ?? mat4.identity(new Float32Array(16)))
    occlusion.set('uSize', [w, h])
    occlusion.set('uRadius', radius)
    occlusion.set('uPixels', (projection[5] * h) / 2)
    occlusion.set('uPerspective', projection[15] === 0 ? 1 : 0)
    occlusion.set('uStrength', settings.strength)
    this.programs.drawFullscreen()

    // blurred across, then down
    const defines = this.floatTargets ? ['DEPTH'] : []
    const blur = this.programs.ready('ssao-blur', defines, OCCLUSION_BLUR)
    gl.useProgram(blur.program)
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.blurred.framebuffer)
    blur.set('uSource', t.occlusion.texture)
    blur.set('uStep', [1, 0])
    this.programs.drawFullscreen()
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.occlusion.framebuffer)
    blur.set('uSource', t.blurred.texture)
    blur.set('uStep', [0, 1])
    this.programs.drawFullscreen()

    gl.depthMask(true)
    gl.enable(gl.DEPTH_TEST)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return {
      texture: t.occlusion.texture, depth: this.floatTargets, scale: [1 / width, 1 / height],
      viewZ: [view[2], view[6], view[10], view[14]],
    }
  }

  /**
   * A ground shadow for this frame, before the picture is drawn: the solids' depth from below the
   * ground, made into darkness and blurred. Null when there is nothing to cast it.
   * @param {DrawItem[]} solids @param {Box3} box their world bounds @param {Passes} passes
   * @param {{ opacity: number, softness: number, height: number | null, y: number | null, size: number | null }} settings
   * @returns {Ground | null}
   */
  groundShadow(solids, box, passes, settings) {
    if (!solids.length || box.isEmpty()) return null
    const gl = this.gl
    const [x0, y0, z0] = box.min, [x1, y1, z1] = box.max
    const extent = Math.max(x1 - x0, y1 - y0, z1 - z0, 1e-6)
    const ground = settings.y ?? y0
    const height = settings.height ?? extent / 2
    const half = this.#squareFor((x0 + x1) / 2, (z0 + z1) / 2, settings.size !== null ? settings.size / 2 : Math.max(x1 - x0, z1 - z0) * 0.5 + height * 0.75)
    const [cx, cz, h] = half
    const t = this.#groundTargets()

    // depth up from the ground: x and z across the square, height up to \`height\`
    const viewProjection = new Float32Array([1 / h, 0, 0, 0, 0, 0, 2 / height, 0, 0, 1 / h, 0, 0, -cx / h, -cz / h, (-2 * ground) / height - 1, 1])
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.depth.framebuffer)
    gl.viewport(0, 0, GROUND_SIZE, GROUND_SIZE)
    gl.depthMask(true)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.disable(gl.BLEND)
    gl.disable(gl.CULL_FACE)
    gl.clear(gl.DEPTH_BUFFER_BIT)
    passes.drawDepth(solids, viewProjection)

    // darkness, then blurred across and down
    gl.disable(gl.DEPTH_TEST)
    gl.depthMask(false)
    gl.viewport(0, 0, GROUND_BLUR_SIZE, GROUND_BLUR_SIZE)
    const darkness = this.programs.ready('ground-darkness', [], GROUND_DARKNESS)
    gl.useProgram(darkness.program)
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.a.framebuffer)
    darkness.set('uDepth', t.depth.texture)
    this.programs.drawFullscreen()
    const blur = this.programs.ready('ground-blur', [], GROUND_BLUR)
    gl.useProgram(blur.program)
    blur.set('uRadius', Math.round(1 + settings.softness * (GROUND_BLUR_RADIUS - 1)))
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.b.framebuffer)
    blur.set('uSource', t.a.texture)
    blur.set('uStep', [1, 0])
    this.programs.drawFullscreen()
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.a.framebuffer)
    blur.set('uSource', t.b.texture)
    blur.set('uStep', [0, 1])
    this.programs.drawFullscreen()
    gl.depthMask(true)
    gl.enable(gl.DEPTH_TEST)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return { texture: t.a.texture, rect: [cx, cz, h, ground], opacity: settings.opacity }
  }

  /**
   * Lay the ground shadow on the ground, over the opaque things drawn so far - hidden by what is in
   * front of it, over a floor at the same height.
   * @param {Ground} ground @param {FrameDescription} frame
   */
  drawGround(ground, frame) {
    const gl = this.gl
    const program = this.programs.ready('ground', [], GROUND)
    gl.useProgram(program.program)
    program.set('uViewProjection', frame.camera.viewProjection)
    program.set('uRect', ground.rect)
    program.set('uShadow', ground.texture)
    program.set('uOpacity', ground.opacity)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.depthMask(false)
    gl.disable(gl.CULL_FACE)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.enable(gl.POLYGON_OFFSET_FILL)
    gl.polygonOffset(-1, -4)
    this.#empty ??= gl.createVertexArray()
    gl.bindVertexArray(this.#empty)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.disable(gl.POLYGON_OFFSET_FILL)
    gl.disable(gl.BLEND)
    gl.depthMask(true)
  }

  /**
   * Where the picture goes before FXAA: bound and returned, to draw the scene into (multisampled,
   * resolved by fxaa()), or - after bloom, which draws its own picture - a plain texture's
   * framebuffer for bloom to put its result in.
   * @param {number} width @param {number} height @param {boolean} multisampled
   * @returns {WebGLFramebuffer}
   */
  beginFxaa(width, height, multisampled) {
    const gl = this.gl
    const t = this.#fxaaTargets(width, height)
    this.#fxaa = t
    if (!multisampled) return t.picture.framebuffer
    const target = t.multisampled ?? this.#multisample(t)
    gl.bindFramebuffer(gl.FRAMEBUFFER, target)
    gl.viewport(0, 0, width, height)
    return target
  }

  /**
   * Smooth the picture onto the canvas.
   * @param {boolean} multisampled the scene was drawn into the multisampled buffer, to resolve first
   */
  fxaa(multisampled) {
    const gl = this.gl
    const t = this.#fxaa
    if (!t) return
    const { width, height } = t
    if (multisampled && t.multisampled) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.multisampled)
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.picture.framebuffer)
      gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST)
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, width, height)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.BLEND)
    gl.disable(gl.CULL_FACE)
    gl.depthMask(false)
    const program = this.programs.ready('fxaa', [], FXAA)
    gl.useProgram(program.program)
    program.set('uSource', t.picture.texture)
    program.set('uTexel', [1 / width, 1 / height])
    this.programs.drawFullscreen()
    gl.depthMask(true)
    gl.enable(gl.DEPTH_TEST)
    gl.bindVertexArray(null)
  }

  /**
   * The ground shadow's square: kept while the solids stay well inside it, so a turning model's
   * shadow doesn't change scale every frame; otherwise snapped to steps, so it changes seldom.
   * @param {number} x @param {number} z @param {number} half
   * @returns {[number, number, number]}
   */
  #squareFor(x, z, half) {
    const s = this.#square
    if (s && half <= s[2] && half > s[2] * 0.7 && Math.abs(x - s[0]) < s[2] * 0.1 && Math.abs(z - s[1]) < s[2] * 0.1) return s
    const h = 2 ** (Math.ceil(Math.log2(half) * 4) / 4)
    const grid = h / 16
    this.#square = [Math.round(x / grid) * grid, Math.round(z / grid) * grid, h]
    return this.#square
  }

  /** A colour texture and its framebuffer. @param {number} width @param {number} height @param {number} format @param {number} filter */
  #target(width, height, format, filter) {
    const gl = this.gl
    const texture = /** @type {WebGLTexture} */ (gl.createTexture())
    gl.activeTexture(gl.TEXTURE15)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const framebuffer = /** @type {WebGLFramebuffer} */ (gl.createFramebuffer())
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    return { texture, framebuffer, width, height }
  }

  /** A depth texture read as a plain value, not compared. @param {number} width @param {number} height */
  #depthTexture(width, height) {
    const gl = this.gl
    const texture = /** @type {WebGLTexture} */ (gl.createTexture())
    gl.activeTexture(gl.TEXTURE15)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, width, height)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return texture
  }

  /**
   * A size's buffers from a cache of the last few sizes, made when missing - the least recently
   * used freed to make room.
   * @template T
   * @param {Map<string, T>} cache @param {number} width @param {number} height
   * @param {() => T} make @param {(t: T) => void} free
   * @returns {T}
   */
  #sized(cache, width, height, make, free) {
    const key = `${width}x${height}`
    let t = cache.get(key)
    if (t) cache.delete(key)
    else t = make()
    cache.set(key, t)
    if (cache.size > SIZES) {
      const [oldest, old] = /** @type {[string, T]} */ (cache.entries().next().value)
      cache.delete(oldest)
      free(old)
    }
    return t
  }

  /** @param {number} w @param {number} h @returns {OcclusionTargets} */
  #occlusionTargets(w, h) {
    return this.#sized(this.#occlusion, w, h, () => this.#makeOcclusion(w, h), (t) => this.#freeOcclusion(t))
  }

  /** @param {number} w @param {number} h @returns {OcclusionTargets} */
  #makeOcclusion(w, h) {
    const gl = this.gl
    const normals = this.#target(w, h, gl.RGBA8, gl.NEAREST)
    const depth = this.#depthTexture(w, h)
    gl.bindFramebuffer(gl.FRAMEBUFFER, normals.framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0)
    const format = this.floatTargets ? gl.RG16F : gl.RGBA8
    const occlusion = this.#target(w, h, format, gl.LINEAR)
    const blurred = this.#target(w, h, format, gl.LINEAR)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return { width: w, height: h, normals, depth, occlusion, blurred }
  }

  #groundTargets() {
    if (this.#ground) return this.#ground
    const gl = this.gl
    const texture = this.#depthTexture(GROUND_SIZE, GROUND_SIZE)
    const framebuffer = /** @type {WebGLFramebuffer} */ (gl.createFramebuffer())
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, texture, 0)
    gl.drawBuffers([gl.NONE])
    gl.readBuffer(gl.NONE)
    const a = this.#target(GROUND_BLUR_SIZE, GROUND_BLUR_SIZE, gl.RGBA8, gl.LINEAR)
    const b = this.#target(GROUND_BLUR_SIZE, GROUND_BLUR_SIZE, gl.RGBA8, gl.LINEAR)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.#ground = { depth: { texture, framebuffer }, a, b }
    return this.#ground
  }

  /** @param {number} width @param {number} height @returns {FxaaTargets} */
  #fxaaTargets(width, height) {
    return this.#sized(this.#fxaaTargetsBySize, width, height, () => {
      const picture = this.#target(width, height, this.gl.RGBA8, this.gl.LINEAR)
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null)
      return { width, height, picture, multisampled: null, buffers: [] }
    }, (t) => this.#freeFxaa(t))
  }

  /**
   * The buffer the scene is drawn into before FXAA, made when first wanted (bloom draws its own):
   * multisampled as the canvas is - or not, when the canvas isn't - with stencil for section planes' caps.
   * @param {FxaaTargets} t
   */
  #multisample(t) {
    const gl = this.gl
    const samples = gl.getContextAttributes()?.antialias ? Math.min(4, gl.getParameter(gl.MAX_SAMPLES)) : 0
    const framebuffer = /** @type {WebGLFramebuffer} */ (gl.createFramebuffer())
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    t.buffers = [[gl.RGBA8, gl.COLOR_ATTACHMENT0], [gl.DEPTH24_STENCIL8, gl.DEPTH_STENCIL_ATTACHMENT]].map(([format, attachment]) => {
      const b = /** @type {WebGLRenderbuffer} */ (gl.createRenderbuffer())
      gl.bindRenderbuffer(gl.RENDERBUFFER, b)
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, format, t.width, t.height)
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, attachment, gl.RENDERBUFFER, b)
      return b
    })
    gl.bindRenderbuffer(gl.RENDERBUFFER, null)
    t.multisampled = framebuffer
    return framebuffer
  }

  /** @param {OcclusionTargets} t */
  #freeOcclusion(t) {
    const gl = this.gl
    for (const target of [t.normals, t.occlusion, t.blurred]) {
      gl.deleteFramebuffer(target.framebuffer)
      gl.deleteTexture(target.texture)
    }
    gl.deleteTexture(t.depth)
  }

  #freeGround() {
    const t = this.#ground
    if (!t) return
    const gl = this.gl
    for (const target of [t.depth, t.a, t.b]) {
      gl.deleteFramebuffer(target.framebuffer)
      gl.deleteTexture(target.texture)
    }
    this.#ground = null
    this.#square = null
  }

  /** @param {FxaaTargets} t */
  #freeFxaa(t) {
    const gl = this.gl
    gl.deleteFramebuffer(t.picture.framebuffer)
    gl.deleteTexture(t.picture.texture)
    if (t.multisampled) gl.deleteFramebuffer(t.multisampled)
    for (const b of t.buffers) gl.deleteRenderbuffer(b)
    if (this.#fxaa === t) this.#fxaa = null
  }
}
