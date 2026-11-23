// The renderer's extra passes: HDR environments (prefiltered once into a mip chain of blurrier
// reflections, plus spherical harmonics for diffuse light), panorama backgrounds, the shadow maps
// (directional, spot and rect-area tiles, point cubes), outlines and the depth ambient occlusion
// reads. Each keeps its GL objects, and forgets them on reset() after a lost context.
import * as mat3 from '../math/mat3.js'
import * as mat4 from '../math/mat4.js'
import { irradianceSH } from '../irradiance.js'
import { BLUE_NOISE_SIZE, POINT_SHADOW_SIZE, SHADOW_MAP_SIZE, SOFT_SPREAD, softnessOf, SPOT_ATLAS_SIZE } from '../shadow.js'
import { CLIP, CLIP_ONLY_FRAGMENT, COMMON, CUTOUT, EQUIRECT, FULLSCREEN_VERTEX, MESH_VERTEX, TONE_MAP } from './shaders.js'
import { setHookUniforms } from './hooks.js'
import { setGlassUniforms, setShapeUniforms, setThicknessUniforms, shapeDefines, thicknessDefines } from './shape.js'
import { isGlass } from '../material/features.js'
import { blit } from './targets.js'
import { DrawnFrom } from './drawn.js'
import { BLUE_NOISE } from './blue-noise-data.js'
import { SHADOW_PARTS } from './parts-shadows.js'
import { addParts } from './parts.js'

// a rect light's filter is an ellipse this much bigger than its half width and height: an evenly lit
// rectangle and an evenly filled ellipse spread an edge alike when their spreads (second moments)
// match - its half width over root 3, the ellipse's semi-axis over 2
const RECT_TO_ELLIPSE = 2 / Math.sqrt(3)

/**
 * A spot shadow tile's edge: how far it spreads a unit of gap from caster to surface - or, for a
 * rect-area light, minus the longer semi-axis of the ellipse that stands for it (spotShape), the edge
 * then as wide as that light makes it (the gap times the semi-axis, over the distance from the light
 * to the caster).
 * @param {FrameLight} light
 */
function spotSpread(light) {
  // a refine sample's: sharp, from a point on the light (frame.js sampleLight)
  if (light.hardShadow) return 0
  if (light.kind !== 'rect') return softnessOf(light) * SOFT_SPREAD
  const hw = /** @type {Vec3} */ (light.halfWidth), hh = /** @type {Vec3} */ (light.halfHeight)
  return -RECT_TO_ELLIPSE * Math.max(hw.len(), hh.len())
}

/**
 * The shape of a spot shadow tile's soft edge, in the tile's own coordinates: which way the light's
 * width lies there (x, y), and its width and height over the longer of them (z, w) - a rect light's
 * ellipse, wide along its width; a spot light's a circle (1, 0, 1, 1).
 * @param {FrameLight} light @param {Float32Array | number[]} viewProjection the tile's view
 * @returns {number[]}
 */
function spotShape(light, viewProjection) {
  if (light.kind !== 'rect' || light.hardShadow) return [1, 0, 1, 1]
  const hw = /** @type {Vec3} */ (light.halfWidth), hh = /** @type {Vec3} */ (light.halfHeight)
  const w = hw.len(), h = hh.len(), long = Math.max(w, h, 1e-6)
  // a point a unit in front of the light, and one a little way along its width from there, on the map
  const p = /** @type {Vec3} */ (light.position), d = /** @type {Vec3} */ (light.direction), m = viewProjection
  const onMap = (/** @type {number[]} */ q) => {
    const cw = m[3] * q[0] + m[7] * q[1] + m[11] * q[2] + m[15]
    return [(m[0] * q[0] + m[4] * q[1] + m[8] * q[2] + m[12]) / cw, (m[1] * q[0] + m[5] * q[1] + m[9] * q[2] + m[13]) / cw]
  }
  const a = [p[0] + d[0], p[1] + d[1], p[2] + d[2]], s = 0.01 / Math.max(w, 1e-6)
  const [x0, y0] = onMap(a), [x1, y1] = onMap([a[0] + hw[0] * s, a[1] + hw[1] * s, a[2] + hw[2] * s])
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1
  return [dx / len, dy / len, w / long, h / long]
}

/** @import { Programs } from './programs.js' */
/** @import { Target, TargetPool } from './targets.js' */
/** @import { Resources } from './resources.js' */
/** @import { Texture, DataImage } from '../material/Texture.js' */
/** @import { FrameDescription, FrameLight, ShadowFrame, SpotShadowFrame, PointShadowFrame, DrawItem, FrameOutline } from '../frame.js' */
/** @import { Vec3 } from '../value/Vec3.js' */



// a panorama behind everything, seen in the camera's direction
const BACKGROUND_FRAGMENT = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform mat4 uInverseViewProjection;
uniform vec3 uCameraPosition;
uniform sampler2D uBackground;
uniform float uLod;          // blur: a rougher mip of a prefiltered environment
uniform float uIntensity;
uniform int uHdr;            // 1: linear radiance, tone mapped like the scene; 0: an sRGB picture, shown as is
out vec4 fragColor;
${COMMON}
${EQUIRECT}
${TONE_MAP}
void main() {
  vec4 far = uInverseViewProjection * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 d = normalize(far.xyz / far.w - uCameraPosition);
  vec3 c = textureLod(uBackground, equirectUv(d), uLod).rgb * uIntensity;
  if (uHdr == 1) c = toneMap(c);
  fragColor = outputColor(c, 1.0, 1.0);
}
`

// One mip of a prefiltered environment: the radiance a surface of this roughness reflects in
// each direction - GGX importance sampled, reading lower source mips for sparse samples
// (Krivanek and Colbert's filtered importance sampling), so a few hundred samples look smooth.
const PREFILTER_FRAGMENT = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform sampler2D uSource;   // equirectangular, linear radiance, mipmapped
uniform float uRoughness;
uniform float uSourceTexels; // texels in the source's top mip
uniform float uCopyLod;      // roughness 0: the source mip that matches this size
out vec4 fragColor;
${EQUIRECT}
const float PI = 3.14159265359;
const uint SAMPLES = 192u;

vec2 hammersley(uint i) {
  uint bits = i;
  bits = (bits << 16u) | (bits >> 16u);
  bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
  bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
  bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
  bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
  return vec2(float(i) / float(SAMPLES), float(bits) * 2.3283064365386963e-10);
}

void main() {
  vec3 n = equirectDirection(vUv);
  if (uRoughness <= 0.0) {
    fragColor = vec4(textureLod(uSource, vUv, uCopyLod).rgb, 1.0);
    return;
  }
  float a = uRoughness * uRoughness, a2 = a * a;
  vec3 up = abs(n.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 t = normalize(cross(up, n)), b = cross(n, t);
  float texelAngle = 4.0 * PI / uSourceTexels;
  vec3 sum = vec3(0.0);
  float weight = 0.0;
  for (uint i = 0u; i < SAMPLES; i++) {
    vec2 xi = hammersley(i);
    float phi = 2.0 * PI * xi.x;
    float cosTheta = sqrt((1.0 - xi.y) / (1.0 + (a2 - 1.0) * xi.y));
    float sinTheta = sqrt(1.0 - cosTheta * cosTheta);
    vec3 h = t * (cos(phi) * sinTheta) + b * (sin(phi) * sinTheta) + n * cosTheta;
    // view along the normal, so the light is the normal reflected about h
    vec3 l = 2.0 * dot(n, h) * h - n;
    float NoL = dot(n, l);
    if (NoL <= 0.0) continue;
    float f = (cosTheta * a2 - cosTheta) * cosTheta + 1.0;
    float pdf = a2 / (PI * f * f) * 0.25;
    float lod = max(0.5 * log2(1.0 / (float(SAMPLES) * pdf * texelAngle)) + 1.0, 0.0);
    sum += textureLod(uSource, equirectUv(l), lod).rgb * NoL;
    weight += NoL;
  }
  fragColor = vec4(sum / max(weight, 1e-4), 1.0);
}
`


// outlines: a mask of what is outlined - its colour, and the line's width in alpha
const OUTLINE_MASK_FRAGMENT = /* glsl */ `
precision highp float;
in vec3 vWorldPosition;
#ifdef ALPHA_TEST
in vec2 vUv;
#endif
uniform vec4 uMask;
out vec4 fragColor;
${CLIP}
${CUTOUT}
void main() {
  clipAway(vWorldPosition);
  cutOut();
  fragColor = uMask;
}
`
// widest an outline goes, in drawing buffer pixels (its width is stored as a fraction of this)
const OUTLINE_MAX = 16

// widen the mask along one direction: each pixel takes the colour of the nearest masked pixel
// within that pixel's own line width
const WIDEN = /* glsl */ `
uniform sampler2D uSource;
uniform vec2 uStep;
uniform int uRadius;
vec4 widened(vec2 uv) {
  vec4 best = vec4(0.0);
  float nearest = 1e9;
  for (int i = -${OUTLINE_MAX}; i <= ${OUTLINE_MAX}; i++) {
    float d = abs(float(i));
    if (d > float(uRadius)) continue;
    vec4 s = texture(uSource, uv + uStep * float(i));
    if (s.a > 0.0 && d <= s.a * ${OUTLINE_MAX}.0 && d < nearest) {
      best = s;
      nearest = d;
    }
  }
  return best;
}
`
const OUTLINE_WIDEN_FRAGMENT = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${WIDEN}
void main() {
  fragColor = widened(vUv);
}
`
// the last widening, drawn straight over the scene - everywhere but inside the mask itself
const OUTLINE_COMPOSITE_FRAGMENT = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform sampler2D uMask;
out vec4 fragColor;
${COMMON}
${WIDEN}
void main() {
  if (texture(uMask, vUv).a > 0.0) discard;
  vec4 ring = widened(vUv);
  if (ring.a <= 0.0) discard;
  fragColor = outputColor(ring.rgb, 1.0, 1.0);
}
`
// Antialiased outlines. The mask is drawn multisampled, with a second target saying how much of
// each pixel it covers; once resolved, the mask holds colour and width times that coverage. The
// ring is then measured from the shape's edge, not from masked pixels' middles - a pixel's edge is
// its coverage less a half beyond its middle - and in true distance, so corners come out round. Its
// outer edge fades over a pixel, and its inner edge leaves the shape's share of each pixel alone.
const OUTLINE_COVER_FRAGMENT = /* glsl */ `
precision highp float;
in vec3 vWorldPosition;
#ifdef ALPHA_TEST
in vec2 vUv;
#endif
uniform vec4 uMask;
layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragCoverage;
${CLIP}
${CUTOUT}
void main() {
  clipAway(vWorldPosition);
  cutOut();
  fragColor = uMask;
  fragCoverage = vec4(1.0);
}
`
const SMOOTH = /* glsl */ `
uniform sampler2D uMask;
uniform sampler2D uCoverage;
uniform vec2 uTexel;
uniform int uRadius;
// a masked pixel's colour and width, from the resolved mask and its coverage
vec4 masked(vec2 uv, float coverage) {
  vec4 m = texture(uMask, uv) / coverage;
  return vec4(m.rgb, m.a * ${OUTLINE_MAX}.0);
}
`
// across: each pixel notes which masked pixel along its row has the nearest edge, as an offset
const OUTLINE_SMOOTH_WIDEN_FRAGMENT = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;
${SMOOTH}
void main() {
  float nearest = 1e9;
  int at = 0;
  bool found = false;
  for (int i = -${OUTLINE_MAX + 1}; i <= ${OUTLINE_MAX + 1}; i++) {
    if (abs(i) > uRadius + 1) continue;
    vec2 uv = vUv + vec2(float(i) * uTexel.x, 0.0);
    float c = texture(uCoverage, uv).r;
    if (c <= 0.0) continue;
    float d = abs(float(i)) - (c - 0.5);
    if (d < masked(uv, c).a + 0.5 && d < nearest) {
      nearest = d;
      at = i;
      found = true;
    }
  }
  fragColor = found ? vec4(float(at + 32) / 255.0, 0.0, 0.0, 1.0) : vec4(0.0);
}
`
// down, over the scene: the nearest of the rows' nearest, in true distance, faded at both edges
const OUTLINE_SMOOTH_COMPOSITE_FRAGMENT = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform sampler2D uNearest;
out vec4 fragColor;
${COMMON}
${SMOOTH}
void main() {
  float here = texture(uCoverage, vUv).r;
  if (here >= 1.0) discard;
  float nearest = 1e9;
  vec4 ring = vec4(0.0);
  for (int j = -${OUTLINE_MAX + 1}; j <= ${OUTLINE_MAX + 1}; j++) {
    if (abs(j) > uRadius + 1) continue;
    vec2 row = vUv + vec2(0.0, float(j) * uTexel.y);
    vec4 n = texture(uNearest, row);
    if (n.a <= 0.0) continue;
    int i = int(n.r * 255.0 + 0.5) - 32;
    vec2 uv = row + vec2(float(i) * uTexel.x, 0.0);
    float c = texture(uCoverage, uv).r;
    float d = length(vec2(float(i), float(j))) - (c - 0.5);
    if (d < nearest) {
      nearest = d;
      ring = masked(uv, c);
    }
  }
  float alpha = clamp(ring.a - nearest + 0.5, 0.0, 1.0) * (1.0 - here);
  if (alpha <= 0.0) discard;
  fragColor = outputColor(ring.rgb, alpha, alpha);
}
`
const OUTLINE_MASK = /** @type {[string, string]} */ ([MESH_VERTEX, OUTLINE_MASK_FRAGMENT])
const OUTLINE_WIDEN = /** @type {[string, string]} */ ([FULLSCREEN_VERTEX, OUTLINE_WIDEN_FRAGMENT])
const OUTLINE_COMPOSITE = /** @type {[string, string]} */ ([FULLSCREEN_VERTEX, OUTLINE_COMPOSITE_FRAGMENT])
const OUTLINE_COVER = /** @type {[string, string]} */ ([MESH_VERTEX, OUTLINE_COVER_FRAGMENT])
const OUTLINE_SMOOTH_WIDEN = /** @type {[string, string]} */ ([FULLSCREEN_VERTEX, OUTLINE_SMOOTH_WIDEN_FRAGMENT])
const OUTLINE_SMOOTH_COMPOSITE = /** @type {[string, string]} */ ([FULLSCREEN_VERTEX, OUTLINE_SMOOTH_COMPOSITE_FRAGMENT])

// shadow maps only need depth - of what isn't cut away
const DEPTH = /** @type {[string, string]} */ ([MESH_VERTEX, CLIP_ONLY_FRAGMENT])
const BACKGROUND = /** @type {[string, string]} */ ([FULLSCREEN_VERTEX, BACKGROUND_FRAGMENT])
const PREFILTER = /** @type {[string, string]} */ ([FULLSCREEN_VERTEX, PREFILTER_FRAGMENT])

// the prefiltered environment: 512 x 256 at roughness 0, halving to 16 x 8 at roughness 1
const ENV_WIDTH = 512
const ENV_LEVELS = 6

/**
 * @typedef {object} Environment
 * @property {WebGLTexture} source the HDR image, mipmapped
 * @property {WebGLTexture} prefiltered roughness i / (levels - 1) in mip i
 * @property {number} maxLod
 * @property {Float32Array} sh irradiance, nine RGB coefficients
 * @property {number} version
 */

/**
 * A shadow ready for the lit shader, the same shape for every kind: the define that turns its code
 * on, the uniforms it reads once a frame, and the depth texture it samples. A new kind of shadow is
 * a pass that returns one of these.
 * @typedef {{ define: string, uniforms: Record<string, unknown>, sampler: string, texture: WebGLTexture,
 *   soft: { define: string, sampler: string, value: { texture: WebGLTexture, sampler: WebGLSampler }, noise: WebGLTexture } | null,
 *   glass: { define: string, sampler: string, texture: WebGLTexture } | null, kept: boolean,
 *   textures?: Record<string, WebGLTexture | null> }} ShadowMap
 *   soft: for contact-hardening shadows, the define that turns them on and the map read as depths -
 *   its own sampler object, as the texture itself is set up to compare - and the blue noise each
 *   pixel turns its samples by (uBlueNoise)
 *   glass: coloured shadows - the map's glass layer, what glass casters let through (#glassLayers)
 *   textures: more it reads, by sampler (caustics' landing and cover)
 *   kept: the map is as the last frame drew it - nothing in its light or its casters changed
 *   (drawn.js) - so it wasn't drawn again
 */

// a shadow map's glass layer is this much smaller across than its depth: coloured light under glass
// is soft anyway
const GLASS_LAYER_SCALE = 2

/**
 * @typedef {{ width: number, height: number, smooth: boolean, mask: Target, wide: Target, coverage: Target | null,
 *   msaa: Target | null }} OutlineTargets
 * @typedef {{ mask: WebGLTexture, wide: WebGLTexture, coverage: WebGLTexture | null, radius: number, width: number, height: number }} OutlineMask
 */

export class Passes {
  /** The View's clock, for shader hooks that read uTime - set by the renderer each frame. */
  time = 0
  /** The camera's world position, for shader hooks' fresnel and cameraPosition - set each frame too. @type {ArrayLike<number>} */
  cameraPosition = [0, 0, 0]
  /** @type {WeakMap<Texture, Environment>} */ #environments = new WeakMap()
  /** @type {{ texture: WebGLTexture, framebuffer: WebGLFramebuffer } | null} */ #shadow = null
  /** @type {WebGLSampler | null} */ #depthSampler = null
  /** @type {WebGLTexture | null} */ #blueNoise = null
  /** Spot lights' shadows, a tile each. @type {{ texture: WebGLTexture, framebuffer: WebGLFramebuffer } | null} */ #spotShadow = null
  /** A point light's shadow: a depth cube, a framebuffer a face. @type {{ texture: WebGLTexture, framebuffers: WebGLFramebuffer[] } | null} */ #pointShadow = null
  /** What each shadow map was last drawn from: one the same is kept (drawn.js). */
  #drawn = { sun: new DrawnFrom(), spots: new DrawnFrom(), point: new DrawnFrom() }

  /** @param {WebGL2RenderingContext} gl @param {Programs} programs @param {Resources} resources @param {TargetPool} targets */
  constructor(gl, programs, resources, targets) {
    // the GLSL that reads the shadow maps these passes draw, for every lit shader from now on
    // (registered here, not by importing the module for its effect: bundlers may drop that)
    addParts('shadows', SHADOW_PARTS)
    this.gl = gl
    this.programs = programs
    this.resources = resources
    this.targets = targets
    this.reset()
  }

  /** Forget every GL object - after a lost context, when they are already gone. */
  reset() {
    this.#environments = new WeakMap()
    this.#shadow = null
    this.#depthSampler = null
    this.#blueNoise = null
    this.#spotShadow = null
    this.#pointShadow = null
    // the maps went with the context
    for (const drawn of Object.values(this.#drawn)) drawn.forget()
  }

  /**
   * The prefiltered environment for an HDR texture, made on first use (and again when the texture
   * changes); null while it loads, or when the device can't render to float textures.
   * @param {Texture} texture
   * @returns {Environment | null}
   */
  environment(texture) {
    if (!texture.image || !texture.isHDR || !this.targets.float) return null
    let env = this.#environments.get(texture)
    if (env && env.version === texture.version) return env
    const gl = this.gl
    if (env) {
      gl.deleteTexture(env.source)
      gl.deleteTexture(env.prefiltered)
    } else {
      texture.onDispose(() => {
        const e = this.#environments.get(texture)
        if (!e) return
        gl.deleteTexture(e.source)
        gl.deleteTexture(e.prefiltered)
        this.#environments.delete(texture)
      })
    }
    const image = /** @type {DataImage} */ (texture.image)

    // the source: half floats, mipmapped so sparse samples can read a blurrier level
    const source = this.#floatTexture(image.width, image.height, Math.floor(Math.log2(Math.max(image.width, image.height))) + 1)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, image.width, image.height, gl.RGBA, gl.FLOAT, image.data)
    gl.generateMipmap(gl.TEXTURE_2D)

    const prefiltered = this.#floatTexture(ENV_WIDTH, ENV_WIDTH / 2, ENV_LEVELS)
    const program = this.programs.ready('prefilter', [], PREFILTER)
    gl.useProgram(program.program)
    program.set('uSource', source)
    program.set('uSourceTexels', image.width * image.height)
    const framebuffer = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.BLEND)
    gl.disable(gl.CULL_FACE)
    for (let level = 0; level < ENV_LEVELS; level++) {
      const w = ENV_WIDTH >> level
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, prefiltered, level)
      gl.viewport(0, 0, w, w / 2)
      program.set('uRoughness', level / (ENV_LEVELS - 1))
      program.set('uCopyLod', Math.max(0, Math.log2(image.width / w)))
      this.programs.drawFullscreen()
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.deleteFramebuffer(framebuffer)
    gl.enable(gl.DEPTH_TEST)

    env = { source, prefiltered, maxLod: ENV_LEVELS - 1, sh: irradianceSH(image), version: texture.version }
    this.#environments.set(texture, env)
    return env
  }

  /**
   * Draw a panorama background: an HDR image (tone mapped like the scene) or an ordinary picture.
   * @param {FrameDescription} frame @param {Texture} texture
   * @param {{ exposure: number, toneMapping: number, linear?: boolean }} tone linear: written in linear light, for a chain that encodes it later
   */
  background(frame, texture, tone) {
    const gl = this.gl
    const hdr = texture.isHDR
    const env = hdr ? this.environment(texture) : null
    if (hdr && !env) return
    const program = this.programs.ready('background', tone.linear ? ['LINEAR_OUTPUT'] : [], BACKGROUND)
    gl.useProgram(program.program)
    const blur = Math.min(Math.max(frame.backgroundBlur, 0), 1)
    if (env) {
      // a little blur reads the prefiltered chain, which is already smooth at every step
      program.set('uBackground', blur > 0 ? env.prefiltered : env.source)
      program.set('uLod', blur * env.maxLod)
      program.set('uIntensity', frame.environment === texture ? frame.environmentIntensity : 1)
    } else {
      program.set('uBackground', this.resources.texture(texture))
      program.set('uLod', blur * 6)
      program.set('uIntensity', 1)
    }
    program.set('uHdr', hdr ? 1 : 0)
    program.set('uExposure', tone.exposure)
    program.set('uToneMapping', tone.toneMapping)
    program.set('uInverseViewProjection', mat4.invert(mat4.create(), frame.camera.viewProjection))
    program.set('uCameraPosition', frame.camera.position)
    this.programs.fullscreenPasses(() => this.programs.drawFullscreen())
  }

  /**
   * Draw the shadow casters' depth from the light, for the matrix from world space to its texture.
   * @param {ShadowFrame} shadow
   * @returns {ShadowMap}
   */
  shadowMap(shadow) {
    const gl = this.gl
    this.#shadow ??= this.#depthTarget(SHADOW_MAP_SIZE)
    const [solid, glass] = splitGlass(shadow.casters)
    const glassTarget = glass.length ? this.#glassTarget('shadow-glass', SHADOW_MAP_SIZE) : null
    // drawn again only when the light or a caster changed - or the targets are new
    const kept = this.#drawn.sun.begin().object(this.#shadow.texture).object(glassTarget).numbers(shadow.viewProjection)
      .casters(solid).casters(glass, true).same()
    if (!kept) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.#shadow.framebuffer)
      gl.viewport(0, 0, SHADOW_MAP_SIZE, SHADOW_MAP_SIZE)
      this.#beginDepth()
      this.drawDepth(solid, shadow.viewProjection)
      this.#endDepth()
      if (glassTarget) {
        this.#glassLayers(glassTarget, (size) => {
          gl.viewport(0, 0, size, size)
          this.drawDepth(glass, shadow.viewProjection, { filter: true })
        })
      }
    }
    const layer = glassTarget ? /** @type {WebGLTexture} */ (glassTarget.texture) : null
    // clip space to [0, 1] texture coordinates and depth
    const toTexture = new Float32Array([0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 0.5, 0.5, 0.5, 1])
    const softness = softnessOf(shadow.light)
    /** @type {Record<string, unknown>} */
    const uniforms = {
      uShadowMatrix: mat4.multiply(new Float32Array(16), toTexture, shadow.viewProjection),
      uShadowTexel: 1 / SHADOW_MAP_SIZE,
      // pushed out along the normal by a texel and a half
      uShadowBias: shadow.texelSize * 1.5,
    }
    if (softness > 0) {
      // how far the edge spreads a unit of gap; the world units a unit of the map's depth spans -
      // the light's view is orthographic, so its depth is (far - near) times the map's, and the
      // depth row of its matrix is 2 / (far - near) long; and the map's coordinates a world unit
      const vp = shadow.viewProjection
      uniforms.uShadowSoft = [softness * SOFT_SPREAD, 2 / Math.hypot(vp[2], vp[6], vp[10]), 1 / SHADOW_MAP_SIZE / shadow.texelSize]
    }
    return {
      define: 'SHADOW', sampler: 'uShadowMap', texture: this.#shadow.texture, uniforms,
      soft: softness > 0 ? { define: 'SHADOW_SOFT', sampler: 'uShadowDepth', value: { texture: this.#shadow.texture, sampler: this.#depthReader() }, noise: this.#noise() } : null,
      glass: layer ? { define: 'SHADOW_GLASS', sampler: 'uShadowGlass', texture: layer } : null,
      kept,
    }
  }

  /**
   * Draw spot lights' shadow casters' depth, each into its tile of one map. Returns the map, each
   * light's matrix from world space to its tile's coordinates, and each tile's bounds.
   * @param {SpotShadowFrame[]} spots
   * @returns {ShadowMap}
   */
  spotShadowMaps(spots) {
    const gl = this.gl
    this.#spotShadow ??= this.#depthTarget(SPOT_ATLAS_SIZE)
    const glassy = spots.filter((s) => splitGlass(s.casters)[1].length)
    const glassTarget = glassy.length ? this.#glassTarget('spot-shadow-glass', SPOT_ATLAS_SIZE) : null
    // the atlas is drawn again, every tile, when any light or caster changed
    const drawn = this.#drawn.spots.begin().object(this.#spotShadow.texture).object(glassTarget).number(spots.length)
    for (const spot of spots) {
      const [solid, glass] = splitGlass(spot.casters)
      drawn.number(spot.tile).numbers(spot.viewProjection).casters(solid).casters(glass, true)
    }
    const kept = drawn.same()
    if (!kept) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.#spotShadow.framebuffer)
      gl.viewport(0, 0, SPOT_ATLAS_SIZE, SPOT_ATLAS_SIZE)
      this.#beginDepth()
    }
    const matrices = new Float32Array(16 * 4), tiles = new Float32Array(4 * 4), bias = new Float32Array(4), soft = new Float32Array(4 * 4), shape = new Float32Array(4 * 4)
    const half = SPOT_ATLAS_SIZE / 2
    for (const spot of spots) {
      const x = spot.tile % 2, y = Math.floor(spot.tile / 2)
      if (!kept) {
        gl.viewport(x * half, y * half, half, half)
        this.drawDepth(splitGlass(spot.casters)[0], spot.viewProjection)
      }
      // clip space to this tile's part of the map, and depth to [0, 1]
      const toTile = new Float32Array([0.25, 0, 0, 0, 0, 0.25, 0, 0, 0, 0, 0.5, 0, x * 0.5 + 0.25, y * 0.5 + 0.25, 0.5, 1])
      matrices.set(mat4.multiply(new Float32Array(16), toTile, spot.viewProjection), spot.tile * 16)
      tiles.set([x * 0.5, y * 0.5, x * 0.5 + 0.5, y * 0.5 + 0.5], spot.tile * 4)
      bias[spot.tile] = spot.texelAngle * 1.5
      // contact-hardening: how far the edge spreads a unit of gap (0 for the plain edge; spotSpread), the view's
      // near and far planes to turn the map's depths into distances, and the map's coordinates a
      // world unit at a distance of 1
      soft.set([spotSpread(spot.light), spot.near, spot.far, 1 / SPOT_ATLAS_SIZE / spot.texelAngle], spot.tile * 4)
      shape.set(spotShape(spot.light, spot.viewProjection), spot.tile * 4)
    }
    if (!kept) {
      this.#endDepth()
      if (glassTarget) {
        this.#glassLayers(glassTarget, (size) => {
          for (const spot of glassy) {
            gl.viewport((spot.tile % 2) * size / 2, Math.floor(spot.tile / 2) * size / 2, size / 2, size / 2)
            this.drawDepth(splitGlass(spot.casters)[1], spot.viewProjection, { filter: true })
          }
        })
      }
    }
    const layer = glassTarget ? /** @type {WebGLTexture} */ (glassTarget.texture) : null
    const anySoft = spots.some((s) => spotSpread(s.light) !== 0)
    return {
      define: 'SPOT_SHADOWS', sampler: 'uSpotShadowMap', texture: this.#spotShadow.texture,
      uniforms: { uSpotShadowMatrix: matrices, uSpotShadowTile: tiles, uSpotShadowBias: bias, uSpotShadowTexel: 1 / SPOT_ATLAS_SIZE, ...(anySoft ? { uSpotShadowSoft: soft, uSpotShadowShape: shape } : {}) },
      soft: anySoft ? { define: 'SPOT_SHADOWS_SOFT', sampler: 'uSpotShadowDepth', value: { texture: this.#spotShadow.texture, sampler: this.#depthReader() }, noise: this.#noise() } : null,
      glass: layer ? { define: 'SPOT_SHADOWS_GLASS', sampler: 'uSpotShadowGlass', texture: layer } : null,
      kept,
    }
  }

  /**
   * Draw a point light's shadow casters' depth into the six faces of a cube round it.
   * @param {PointShadowFrame} point
   * @returns {ShadowMap}
   */
  pointShadowMap(point) {
    const gl = this.gl
    this.#pointShadow ??= this.#depthCube(POINT_SHADOW_SIZE)
    // the six faces drawn again together, when the light or any caster changed
    const drawn = this.#drawn.point.begin().object(this.#pointShadow.texture).number(point.faces.length)
    for (const face of point.faces) drawn.numbers(face.viewProjection).casters(face.casters)
    const kept = drawn.same()
    if (!kept) {
      point.faces.forEach((face, i) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, /** @type {{ framebuffers: WebGLFramebuffer[] }} */ (this.#pointShadow).framebuffers[i])
        gl.viewport(0, 0, POINT_SHADOW_SIZE, POINT_SHADOW_SIZE)
        this.#beginDepth()
        this.drawDepth(face.casters, face.viewProjection)
      })
      this.#endDepth()
    }
    const softness = softnessOf(point.light)
    return {
      define: 'POINT_SHADOW', sampler: 'uPointShadowMap', texture: this.#pointShadow.texture,
      uniforms: { uPointShadowNearFar: [point.near, point.far], uPointShadowTexel: point.texelAngle, uPointShadowBias: point.texelAngle * 1.5,
        ...(softness > 0 ? { uPointShadowSoft: softness * SOFT_SPREAD } : {}) },
      soft: softness > 0 ? { define: 'POINT_SHADOW_SOFT', sampler: 'uPointShadowDepth', value: { texture: this.#pointShadow.texture, sampler: this.#depthReader() }, noise: this.#noise() } : null,
      // (glass casts a point light's shadow as any caster does)
      glass: null,
      kept,
    }
  }

  /**
   * A shadow map's glass layer: its glass casters drawn from the light, each multiplying in the light
   * it lets through, the nearest one's depth kept beside - so a point behind glass is lit through its
   * colour (coloured shadows), and one in front of it isn't. Starts white and far: no glass.
   * @param {import('./targets.js').Target} target from #glassTarget
   * @param {(size: number) => void} draw draws the glass casters, setting the viewport for each light
   */
  #glassLayers(target, draw) {
    const gl = this.gl
    const size = target.width
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
    gl.viewport(0, 0, size, size)
    gl.clearColor(1, 1, 1, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.disable(gl.DEPTH_TEST)
    gl.depthMask(false)
    // colours multiply; depth keeps the nearest
    gl.enable(gl.BLEND)
    gl.blendEquationSeparate(gl.FUNC_ADD, gl.MIN)
    gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ONE, gl.ONE)
    draw(size)
    gl.blendEquation(gl.FUNC_ADD)
    gl.disable(gl.BLEND)
    gl.depthMask(true)
    gl.enable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  /**
   * A glass layer of glass casters from one view, filling the target: the light they let through,
   * multiplied, and the nearest one's depth (#glassLayers) - for the ground shadow, seen from below.
   * @param {import('./targets.js').Target} target @param {DrawItem[]} casters @param {ArrayLike<number>} viewProjection
   */
  glassLayer(target, casters, viewProjection) {
    this.#glassLayers(target, (size) => {
      this.gl.viewport(0, 0, size, size)
      this.drawDepth(casters, viewProjection, { filter: true })
    })
  }

  /**
   * A shadow map's glass layer's target, from the pool - asked for every frame the map has glass,
   * drawn into or kept, so the pool keeps it.
   * @param {string} name @param {number} mapSize the depth map's size; the layer is smaller
   * @returns {import('./targets.js').Target}
   */
  #glassTarget(name, mapSize) {
    const gl = this.gl
    const size = mapSize / GLASS_LAYER_SCALE
    // depth wants more than 8 bits; where floats can't be drawn to, a step of 8 bits stands in
    return this.targets.get(name, { width: size, height: size, color: this.targets.float ? gl.RGBA16F : gl.RGBA8 })
  }

  #beginDepth() {
    const gl = this.gl
    gl.depthMask(true)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.disable(gl.BLEND)
    gl.clear(gl.DEPTH_BUFFER_BIT)
    // both faces, so thin and open models cast too; a slope-scaled offset keeps lit faces clean
    gl.disable(gl.CULL_FACE)
    gl.enable(gl.POLYGON_OFFSET_FILL)
    gl.polygonOffset(1.5, 2)
  }

  #endDepth() {
    const gl = this.gl
    gl.disable(gl.POLYGON_OFFSET_FILL)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  /**
   * Draw things' depth from a view - shadow casters from a light, or, with `normals`, the solids
   * from the camera for ambient occlusion: each pixel's view-space normal too, culled as the
   * picture culls them so the depths match. With `filter`, glass casters into a glass layer: the
   * light each lets through, by its faces towards the light only - once through solid glass.
   * @param {DrawItem[]} casters @param {ArrayLike<number>} viewProjection
   * @param {{ normals?: ArrayLike<number> | null, filter?: boolean }} [options] normals: the view matrix
   */
  drawDepth(casters, viewProjection, { normals = null, filter = false } = {}) {
    const gl = this.gl
    const normalMatrix = normals || filter ? new Float32Array(9) : null
    // a glass layer's faces reflect away more of the light the more it grazes them: the light's way
    // at each, back through its view
    const lightInverse = filter ? mat4.invert(new Float32Array(16), /** @type {Float32Array} */ (viewProjection)) ?? mat4.create() : null
    for (const item of casters) {
      // the shape as the picture draws it: a cut-out's holes, the shape a hook moves and its
      // fragment hook's holes
      const material = item.material
      const { defines, hook, cutout } = shapeDefines(item, true)
      if (normals) {
        defines.push('NORMALS')
        if (material.flatShading) defines.push('FLAT_SHADING')
        if (material.doubleSided) defines.push('DOUBLE_SIDED')
      }
      if (filter) {
        defines.push('GLASS_FILTER')
        if (material.flatShading) defines.push('FLAT_SHADING')
        thicknessDefines(item, defines)
      }
      const program = this.programs.ready('depth', defines, DEPTH, hook?.source)
      if (program.failed) continue
      gl.useProgram(program.program)
      if (hook) setHookUniforms(program, material, this.time, this.cameraPosition, (t) => this.resources.texture(t))
      program.set('uViewProjection', viewProjection)
      program.set('uModel', item.worldMatrix)
      if (filter) {
        program.set('uLightInverse', lightInverse)
        setGlassUniforms(program, item)
        setThicknessUniforms(program, item, (t) => this.resources.texture(t))
      }
      if (normals) program.set('uView', normals)
      if (normalMatrix) {
        if (!mat3.normalFromMat4(normalMatrix, item.worldMatrix)) mat3.identity(normalMatrix)
        program.set('uNormalMatrix', normalMatrix)
      }
      if (normals || filter) {
        // the picture's culling, so a back face never stands in front of what is drawn - or, for a
        // glass layer, so light is tinted once going through solid glass
        gl.frontFace(mat4.determinant(item.worldMatrix) < 0 ? gl.CW : gl.CCW)
        if (item.material.doubleSided) gl.disable(gl.CULL_FACE)
        else {
          gl.enable(gl.CULL_FACE)
          gl.cullFace(gl.BACK)
        }
      }
      setShapeUniforms(program, item, cutout, (t) => this.resources.texture(t))
      this.resources.drawTriangles(item.geometry, item.instances)
    }
  }

/**
   * The first half of drawing outlines, before the scene: a mask of the outlined subtrees - each
   * pixel they cover in their colour, with the line's width in alpha - then that mask widened
   * sideways. outlineComposite() widens it up and down and draws the ring left round each mask.
   * Smooth outlines draw the mask multisampled, with how much of each pixel it covers, and measure
   * the ring from the shape's edge; otherwise each pixel is in or out.
   * @param {FrameOutline[]} outlines @param {FrameDescription} frame
   * @param {number} width @param {number} height drawing buffer pixels
   * @param {number} pixelRatio
   * @param {boolean} smooth antialiased: soft edges and round corners
   * @returns {OutlineMask}
   */
  outlineMask(outlines, frame, width, height, pixelRatio, smooth) {
    const gl = this.gl
    const targets = this.#outlineTargets(width, height, smooth)
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets.msaa ? targets.msaa.framebuffer : targets.mask.framebuffer)
    if (targets.msaa) gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1])
    gl.viewport(0, 0, width, height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.BLEND)
    gl.disable(gl.CULL_FACE)
    gl.depthMask(false)
    let radius = 1
    for (const outline of outlines) {
      const px = Math.min(OUTLINE_MAX, Math.max(1, Math.round(outline.width * pixelRatio)))
      radius = Math.max(radius, px)
      for (const item of outline.items) {
        // round the shape as drawn: moved by its hooks, with a cut-out's holes
        const { defines, hook, cutout } = shapeDefines(item, false)
        const program = smooth ? this.programs.ready('outline-cover', defines, OUTLINE_COVER, hook?.source) : this.programs.ready('outline-mask', defines, OUTLINE_MASK, hook?.source)
        if (program.failed) continue
        gl.useProgram(program.program)
        if (hook) setHookUniforms(program, item.material, frame.time ?? 0, frame.camera.position, (t) => this.resources.texture(t))
        program.set('uViewProjection', frame.camera.viewProjection)
        program.set('uModel', item.worldMatrix)
        program.set('uMask', [outline.color[0], outline.color[1], outline.color[2], px / OUTLINE_MAX])
        setShapeUniforms(program, item, cutout, (t) => this.resources.texture(t))
        this.resources.drawTriangles(item.geometry, item.instances)
      }
    }
    // the samples resolved: the mask into its texture, the coverage into its own
    if (targets.msaa && targets.coverage) {
      blit(gl, targets.msaa, targets.mask, 0)
      blit(gl, targets.msaa, targets.coverage, 1)
    }
    // widened sideways
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets.wide.framebuffer)
    gl.clear(gl.COLOR_BUFFER_BIT)
    if (targets.coverage) {
      const widen = this.programs.ready('outline-smooth-widen', [], OUTLINE_SMOOTH_WIDEN)
      gl.useProgram(widen.program)
      widen.set('uMask', targets.mask.texture)
      widen.set('uCoverage', targets.coverage.texture)
      widen.set('uTexel', [1 / width, 1 / height])
      widen.set('uRadius', radius)
    } else {
      const widen = this.programs.ready('outline-widen', [], OUTLINE_WIDEN)
      gl.useProgram(widen.program)
      widen.set('uSource', targets.mask.texture)
      widen.set('uStep', [1 / width, 0])
      widen.set('uRadius', radius)
    }
    this.programs.drawFullscreen()
    gl.depthMask(true)
    gl.enable(gl.DEPTH_TEST)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return { mask: targets.mask.texture, wide: targets.wide.texture, coverage: targets.coverage?.texture ?? null, radius, width, height }
  }

  /**
   * Draw the outlines over the finished scene, into whatever is bound: the sideways-widened mask
   * widened up and down too, less the mask itself, so a ring is left round each subtree.
   * @param {OutlineMask} outline @param {boolean} [linear] written in linear light, for a chain that encodes it later
   */
  outlineComposite(outline, linear = false) {
    const gl = this.gl
    const defines = linear ? ['LINEAR_OUTPUT'] : []
    if (outline.coverage) {
      const program = this.programs.ready('outline-smooth-composite', defines, OUTLINE_SMOOTH_COMPOSITE)
      gl.useProgram(program.program)
      program.set('uNearest', outline.wide)
      program.set('uMask', outline.mask)
      program.set('uCoverage', outline.coverage)
      program.set('uTexel', [1 / outline.width, 1 / outline.height])
      program.set('uRadius', outline.radius)
    } else {
      const program = this.programs.ready('outline-composite', defines, OUTLINE_COMPOSITE)
      gl.useProgram(program.program)
      program.set('uSource', outline.wide)
      program.set('uMask', outline.mask)
      program.set('uStep', [0, 1 / outline.height])
      program.set('uRadius', outline.radius)
    }
    this.programs.fullscreenPasses(() => {
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      this.programs.drawFullscreen()
    })
  }

  /**
   * The mask and its widened copy - and, for smooth outlines, the multisampled buffers drawn into
   * and the resolved coverage - made again when the size or the kind changes.
   * @param {number} width @param {number} height @param {boolean} smooth
   * @returns {OutlineTargets}
   */
  #outlineTargets(width, height, smooth) {
    const gl = this.gl
    // read texel for texel: no blending between neighbours
    const flat = /** @type {const} */ ({ width, height, filter: 'nearest' })
    return {
      width, height, smooth,
      mask: this.targets.get('outline-mask', flat),
      wide: this.targets.get('outline-wide', flat),
      coverage: smooth ? this.targets.get('outline-coverage', { ...flat, color: gl.R8 }) : null,
      // two multisampled targets drawn at once: the mask, and its coverage
      msaa: smooth ? this.targets.get('outline-msaa', { width, height, color: [gl.RGBA8, gl.R8], samples: this.targets.samples }) : null,
    }
  }

  /**
   * A sampler object that reads a shadow map's depths as numbers - for the blocker search of soft
   * shadows - though its texture is set up to compare: no comparing, and the nearest texel (depth
   * textures can't be filtered otherwise). One serves the 2D maps and the cube.
   * @returns {WebGLSampler}
   */
  #depthReader() {
    if (this.#depthSampler) return this.#depthSampler
    const gl = this.gl
    const s = /** @type {WebGLSampler} */ (gl.createSampler())
    gl.samplerParameteri(s, gl.TEXTURE_COMPARE_MODE, gl.NONE)
    gl.samplerParameteri(s, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.samplerParameteri(s, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    for (const wrap of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.samplerParameteri(s, wrap, gl.CLAMP_TO_EDGE)
    return (this.#depthSampler = s)
  }

  /**
   * A BLUE_NOISE_SIZE square tile of blue noise (blue-noise-data.js), one byte a texel, for soft shadows: each pixel
   * reads its own texel, tiled across the screen, for the angle it turns its sample discs by.
   * @returns {WebGLTexture}
   */
  #noise() {
    if (this.#blueNoise) return this.#blueNoise
    const gl = this.gl
    const text = atob(BLUE_NOISE)
    const bytes = new Uint8Array(text.length)
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
    const texture = /** @type {WebGLTexture} */ (gl.createTexture())
    gl.activeTexture(gl.TEXTURE15)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, BLUE_NOISE_SIZE, BLUE_NOISE_SIZE, 0, gl.RED, gl.UNSIGNED_BYTE, bytes)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.bindTexture(gl.TEXTURE_2D, null)
    return (this.#blueNoise = texture)
  }

  /** A depth texture to draw shadows into and compare against. @param {number} size */
  #depthTarget(size) {
    const gl = this.gl
    const texture = /** @type {WebGLTexture} */ (gl.createTexture())
    gl.activeTexture(gl.TEXTURE15)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, size, size)
    // compare in the sampler, with linear filtering: four comparisons blended per lookup
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const framebuffer = /** @type {WebGLFramebuffer} */ (gl.createFramebuffer())
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, texture, 0)
    gl.drawBuffers([gl.NONE])
    gl.readBuffer(gl.NONE)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return { texture, framebuffer }
  }

  /** A depth cube to draw a point light's shadow into, a face at a time. @param {number} size */
  #depthCube(size) {
    const gl = this.gl
    const texture = /** @type {WebGLTexture} */ (gl.createTexture())
    gl.activeTexture(gl.TEXTURE15)
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture)
    gl.texStorage2D(gl.TEXTURE_CUBE_MAP, 1, gl.DEPTH_COMPONENT24, size, size)
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE)
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL)
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const framebuffers = [0, 1, 2, 3, 4, 5].map((i) => {
      const framebuffer = /** @type {WebGLFramebuffer} */ (gl.createFramebuffer())
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, texture, 0)
      gl.drawBuffers([gl.NONE])
      gl.readBuffer(gl.NONE)
      return framebuffer
    })
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return { texture, framebuffers }
  }

  /** @param {number} width @param {number} height @param {number} levels */
  #floatTexture(width, height, levels) {
    const gl = this.gl
    const texture = /** @type {WebGLTexture} */ (gl.createTexture())
    gl.activeTexture(gl.TEXTURE15)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA16F, width, height)
    // around the panorama repeats; top to bottom stops at the poles
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    return texture
  }

}

/**
 * Shadow casters split: what casts a plain shadow, and glass, which casts a coloured one.
 * @param {DrawItem[]} casters
 * @returns {[DrawItem[], DrawItem[]]}
 */
function splitGlass(casters) {
  /** @type {DrawItem[]} */ const solid = []
  /** @type {DrawItem[]} */ const glass = []
  for (const c of casters) (isGlass(c.material) && c.node.drawMode === 'triangles' ? glass : solid).push(c)
  return [solid, glass]
}
