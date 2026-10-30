// The renderer's extra passes: HDR environments (prefiltered once into a mip chain of blurrier
// reflections, plus spherical harmonics for diffuse light), panorama backgrounds, and the
// directional shadow map. Each keeps its GL objects and frees them on reset() after a lost context.
import * as mat4 from '../math/mat4.js'
import { irradianceSH } from '../irradiance.js'
import { POINT_SHADOW_SIZE, SHADOW_MAP_SIZE, SPOT_ATLAS_SIZE } from '../shadow.js'
import { CLIP, CLIP_ONLY_FRAGMENT, COMMON, EQUIRECT, FULLSCREEN_VERTEX, MESH_VERTEX, TONE_MAP } from './shaders.js'
import { uvMatrix } from './resources.js'

/** @import { Programs } from './programs.js' */
/** @import { Resources } from './resources.js' */
/** @import { Texture, DataImage } from '../material/Texture.js' */
/** @import { FrameDescription, ShadowFrame, SpotShadowFrame, PointShadowFrame, DrawItem, FrameOutline } from '../frame.js' */



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
  fragColor = vec4(linearToSrgb(c), 1.0);
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
uniform vec4 uMask;
out vec4 fragColor;
${CLIP}
void main() {
  clipAway(vWorldPosition);
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
  fragColor = vec4(linearToSrgb(ring.rgb), 1.0);
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
uniform vec4 uMask;
layout(location = 0) out vec4 fragColor;
layout(location = 1) out vec4 fragCoverage;
${CLIP}
void main() {
  clipAway(vWorldPosition);
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
  fragColor = vec4(linearToSrgb(ring.rgb) * alpha, alpha);
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
 * @typedef {{ define: string, uniforms: Record<string, unknown>, sampler: string, texture: WebGLTexture }} ShadowMap
 */

/**
 * @typedef {{ texture: WebGLTexture, framebuffer: WebGLFramebuffer }} Target
 * @typedef {{ width: number, height: number, smooth: boolean, mask: Target, wide: Target, coverage: Target | null,
 *   msaa: { framebuffer: WebGLFramebuffer, renderbuffers: WebGLRenderbuffer[] } | null }} OutlineTargets
 * @typedef {{ mask: WebGLTexture, wide: WebGLTexture, coverage: WebGLTexture | null, radius: number, width: number, height: number }} OutlineMask
 */

export class Passes {
  /** @type {WeakMap<Texture, Environment>} */ #environments = new WeakMap()
  /** @type {{ texture: WebGLTexture, framebuffer: WebGLFramebuffer } | null} */ #shadow = null
  /** Spot lights' shadows, a tile each. @type {{ texture: WebGLTexture, framebuffer: WebGLFramebuffer } | null} */ #spotShadow = null
  /** A point light's shadow: a depth cube, a framebuffer a face. @type {{ texture: WebGLTexture, framebuffers: WebGLFramebuffer[] } | null} */ #pointShadow = null
  /** Outlines' mask and its widened copy. @type {OutlineTargets | null} */ #outline = null
  /** Rendering to float textures, which environments need. */
  floatTargets = false

  /** @param {WebGL2RenderingContext} gl @param {Programs} programs @param {Resources} resources */
  constructor(gl, programs, resources) {
    this.gl = gl
    this.programs = programs
    this.resources = resources
    this.reset()
  }

  /** Forget every GL object - after a lost context, when they are already gone. */
  reset() {
    this.#environments = new WeakMap()
    this.#shadow = null
    this.#spotShadow = null
    this.#pointShadow = null
    this.#outline = null
    this.floatTargets = !!this.gl.getExtension('EXT_color_buffer_float')
  }

  /**
   * The prefiltered environment for an HDR texture, made on first use (and again when the texture
   * changes); null while it loads, or when the device can't render to float textures.
   * @param {Texture} texture
   * @returns {Environment | null}
   */
  environment(texture) {
    if (!texture.image || !texture.isHDR || !this.floatTargets) return null
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
   * @param {{ exposure: number, toneMapping: number }} tone
   */
  background(frame, texture, tone) {
    const gl = this.gl
    const hdr = texture.isHDR
    const env = hdr ? this.environment(texture) : null
    if (hdr && !env) return
    const program = this.programs.ready('background', [], BACKGROUND)
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
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.BLEND)
    gl.disable(gl.CULL_FACE)
    gl.depthMask(false)
    this.programs.drawFullscreen()
    gl.depthMask(true)
    gl.enable(gl.DEPTH_TEST)
  }

  /**
   * Draw the shadow casters' depth from the light, for the matrix from world space to its texture.
   * @param {ShadowFrame} shadow
   * @returns {ShadowMap}
   */
  shadowMap(shadow) {
    const gl = this.gl
    this.#shadow ??= this.#depthTarget(SHADOW_MAP_SIZE)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#shadow.framebuffer)
    gl.viewport(0, 0, SHADOW_MAP_SIZE, SHADOW_MAP_SIZE)
    this.#beginDepth()
    this.#drawDepth(shadow.casters, shadow.viewProjection)
    this.#endDepth()
    // clip space to [0, 1] texture coordinates and depth
    const toTexture = new Float32Array([0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 0.5, 0.5, 0.5, 1])
    return {
      define: 'SHADOW', sampler: 'uShadowMap', texture: this.#shadow.texture,
      uniforms: {
        uShadowMatrix: mat4.multiply(new Float32Array(16), toTexture, shadow.viewProjection),
        uShadowTexel: 1 / SHADOW_MAP_SIZE,
        // pushed out along the normal by a texel and a half
        uShadowBias: shadow.texelSize * 1.5,
      },
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
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#spotShadow.framebuffer)
    gl.viewport(0, 0, SPOT_ATLAS_SIZE, SPOT_ATLAS_SIZE)
    this.#beginDepth()
    const matrices = new Float32Array(16 * 4), tiles = new Float32Array(4 * 4), bias = new Float32Array(4)
    const half = SPOT_ATLAS_SIZE / 2
    for (const spot of spots) {
      const x = spot.tile % 2, y = Math.floor(spot.tile / 2)
      gl.viewport(x * half, y * half, half, half)
      this.#drawDepth(spot.casters, spot.viewProjection)
      // clip space to this tile's part of the map, and depth to [0, 1]
      const toTile = new Float32Array([0.25, 0, 0, 0, 0, 0.25, 0, 0, 0, 0, 0.5, 0, x * 0.5 + 0.25, y * 0.5 + 0.25, 0.5, 1])
      matrices.set(mat4.multiply(new Float32Array(16), toTile, spot.viewProjection), spot.tile * 16)
      tiles.set([x * 0.5, y * 0.5, x * 0.5 + 0.5, y * 0.5 + 0.5], spot.tile * 4)
      bias[spot.tile] = spot.texelAngle * 1.5
    }
    this.#endDepth()
    return {
      define: 'SPOT_SHADOWS', sampler: 'uSpotShadowMap', texture: this.#spotShadow.texture,
      uniforms: { uSpotShadowMatrix: matrices, uSpotShadowTile: tiles, uSpotShadowBias: bias, uSpotShadowTexel: 1 / SPOT_ATLAS_SIZE },
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
    point.faces.forEach((face, i) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, /** @type {{ framebuffers: WebGLFramebuffer[] }} */ (this.#pointShadow).framebuffers[i])
      gl.viewport(0, 0, POINT_SHADOW_SIZE, POINT_SHADOW_SIZE)
      this.#beginDepth()
      this.#drawDepth(face.casters, face.viewProjection)
    })
    this.#endDepth()
    return {
      define: 'POINT_SHADOW', sampler: 'uPointShadowMap', texture: this.#pointShadow.texture,
      uniforms: { uPointShadowNearFar: [point.near, point.far], uPointShadowTexel: point.texelAngle, uPointShadowBias: point.texelAngle * 1.5 },
    }
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

  /** @param {DrawItem[]} casters @param {ArrayLike<number>} viewProjection */
  #drawDepth(casters, viewProjection) {
    const gl = this.gl
    for (const item of casters) {
      const instances = item.instances
      const defines = instances ? ['INSTANCED'] : []
      if (item.clip) defines.push('CLIP')
      // a cut-out's shadow has its holes: the map's alpha against the material's threshold
      const material = item.material, cutout = material.alphaTest > 0
      // read the map as the drawn surface reads it - projected, for a triplanar one
      const triplanar = cutout && !!material.map && material.triplanar > 0
      if (cutout) defines.push('ALPHA_TEST', ...(material.map ? ['MAP'] : []), ...(triplanar ? ['TRIPLANAR'] : []))
      // a map on the second UV set reads it here too
      if (cutout && material.map?.uvSet === 1 && item.geometry.uvs2) defines.push('UV2', 'uMapSet vUv2')
      const program = this.programs.ready('depth', defines, DEPTH)
      gl.useProgram(program.program)
      program.set('uViewProjection', viewProjection)
      program.set('uModel', item.worldMatrix)
      if (item.clip) program.set('uClipPlane', item.clip.plane)
      if (cutout) {
        program.set('uOpacity', material.opacity)
        program.set('uAlphaTest', material.alphaTest)
        const map = material.map
        if (map) {
          program.set('uMapUv', uvMatrix(map))
          program.set('uMap', this.resources.texture(map))
        }
        if (triplanar) program.set('uTriplanar', material.triplanar)
      }
      this.resources.drawTriangles(item.geometry, instances)
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
        const defines = item.instances ? ['INSTANCED'] : []
        if (item.clip) defines.push('CLIP')
        const program = smooth ? this.programs.ready('outline-cover', defines, OUTLINE_COVER) : this.programs.ready('outline-mask', defines, OUTLINE_MASK)
        gl.useProgram(program.program)
        program.set('uViewProjection', frame.camera.viewProjection)
        program.set('uModel', item.worldMatrix)
        program.set('uMask', [outline.color[0], outline.color[1], outline.color[2], px / OUTLINE_MAX])
        if (item.clip) program.set('uClipPlane', item.clip.plane)
        this.resources.drawTriangles(item.geometry, item.instances)
      }
    }
    // the samples resolved: the mask into its texture, the coverage into its own
    if (targets.msaa && targets.coverage) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, targets.msaa.framebuffer)
      for (const [attachment, target] of /** @type {[number, Target][]} */ ([[gl.COLOR_ATTACHMENT0, targets.mask], [gl.COLOR_ATTACHMENT1, targets.coverage]])) {
        gl.readBuffer(attachment)
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.framebuffer)
        gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST)
      }
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
   * @param {OutlineMask} outline
   */
  outlineComposite(outline) {
    const gl = this.gl
    if (outline.coverage) {
      const program = this.programs.ready('outline-smooth-composite', [], OUTLINE_SMOOTH_COMPOSITE)
      gl.useProgram(program.program)
      program.set('uNearest', outline.wide)
      program.set('uMask', outline.mask)
      program.set('uCoverage', outline.coverage)
      program.set('uTexel', [1 / outline.width, 1 / outline.height])
      program.set('uRadius', outline.radius)
    } else {
      const program = this.programs.ready('outline-composite', [], OUTLINE_COMPOSITE)
      gl.useProgram(program.program)
      program.set('uSource', outline.wide)
      program.set('uMask', outline.mask)
      program.set('uStep', [0, 1 / outline.height])
      program.set('uRadius', outline.radius)
    }
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.depthMask(false)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    this.programs.drawFullscreen()
    gl.depthMask(true)
    gl.enable(gl.DEPTH_TEST)
  }

  /**
   * The mask and its widened copy - and, for smooth outlines, the multisampled buffers drawn into
   * and the resolved coverage - made again when the size or the kind changes.
   * @param {number} width @param {number} height @param {boolean} smooth
   * @returns {OutlineTargets}
   */
  #outlineTargets(width, height, smooth) {
    const t = this.#outline
    if (t && t.width === width && t.height === height && t.smooth === smooth) return t
    const gl = this.gl
    if (t) {
      for (const target of [t.mask, t.wide, t.coverage]) {
        if (!target) continue
        gl.deleteTexture(target.texture)
        gl.deleteFramebuffer(target.framebuffer)
      }
      if (t.msaa) {
        gl.deleteFramebuffer(t.msaa.framebuffer)
        for (const buffer of t.msaa.renderbuffers) gl.deleteRenderbuffer(buffer)
      }
    }
    const make = (/** @type {number} */ format = gl.RGBA8) => {
      const texture = /** @type {WebGLTexture} */ (gl.createTexture())
      gl.activeTexture(gl.TEXTURE15)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height)
      // read texel for texel: no blending between neighbours
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      const framebuffer = /** @type {WebGLFramebuffer} */ (gl.createFramebuffer())
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
      return { texture, framebuffer }
    }
    /** @type {OutlineTargets['msaa']} */
    let msaa = null
    if (smooth) {
      // two multisampled targets drawn at once: the mask, and its coverage
      const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES))
      const framebuffer = /** @type {WebGLFramebuffer} */ (gl.createFramebuffer())
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      const renderbuffers = [gl.RGBA8, gl.R8].map((format, i) => {
        const buffer = /** @type {WebGLRenderbuffer} */ (gl.createRenderbuffer())
        gl.bindRenderbuffer(gl.RENDERBUFFER, buffer)
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, format, width, height)
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.RENDERBUFFER, buffer)
        return buffer
      })
      msaa = { framebuffer, renderbuffers }
    }
    this.#outline = { width, height, smooth, mask: make(), wide: make(), coverage: smooth ? make(gl.R8) : null, msaa }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return this.#outline
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
