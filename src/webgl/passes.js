// The renderer's extra passes: HDR environments (prefiltered once into a mip chain of blurrier
// reflections, plus spherical harmonics for diffuse light), panorama backgrounds, and the
// directional shadow map. Each keeps its GL objects and frees them on reset() after a lost context.
import * as mat4 from '../math/mat4.js'
import { irradianceSH } from '../irradiance.js'
import { SHADOW_MAP_SIZE, SPOT_ATLAS_SIZE } from '../shadow.js'
import { CLIP_ONLY_FRAGMENT, COMMON, EQUIRECT, FULLSCREEN_VERTEX, MESH_VERTEX, TONE_MAP } from './shaders.js'

/** @import { Programs } from './programs.js' */
/** @import { Resources } from './resources.js' */
/** @import { Texture, DataImage } from '../material/Texture.js' */
/** @import { FrameDescription, ShadowFrame, SpotShadowFrame, DrawItem } from '../frame.js' */



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

export class Passes {
  /** @type {WeakMap<Texture, Environment>} */ #environments = new WeakMap()
  /** @type {{ texture: WebGLTexture, framebuffer: WebGLFramebuffer } | null} */ #shadow = null
  /** Spot lights' shadows, a tile each. @type {{ texture: WebGLTexture, framebuffer: WebGLFramebuffer } | null} */ #spotShadow = null
  /** @type {WebGLVertexArrayObject | null} */ #empty = null
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
    this.#empty = null
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
    gl.bindVertexArray(this.#emptyArray())
    for (let level = 0; level < ENV_LEVELS; level++) {
      const w = ENV_WIDTH >> level
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, prefiltered, level)
      gl.viewport(0, 0, w, w / 2)
      program.set('uRoughness', level / (ENV_LEVELS - 1))
      program.set('uCopyLod', Math.max(0, Math.log2(image.width / w)))
      gl.drawArrays(gl.TRIANGLES, 0, 3)
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
    gl.bindVertexArray(this.#emptyArray())
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.depthMask(true)
    gl.enable(gl.DEPTH_TEST)
  }

  /**
   * Draw the shadow casters' depth from the light. Returns the texture and the matrix from world
   * space to its coordinates.
   * @param {ShadowFrame} shadow
   * @returns {{ texture: WebGLTexture, matrix: Float32Array }}
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
    return { texture: this.#shadow.texture, matrix: mat4.multiply(new Float32Array(16), toTexture, shadow.viewProjection) }
  }

  /**
   * Draw spot lights' shadow casters' depth, each into its tile of one map. Returns the map, each
   * light's matrix from world space to its tile's coordinates, and each tile's bounds.
   * @param {SpotShadowFrame[]} spots
   * @returns {{ texture: WebGLTexture, matrices: Float32Array, tiles: Float32Array, bias: Float32Array, texel: number }}
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
    return { texture: this.#spotShadow.texture, matrices, tiles, bias, texel: 1 / SPOT_ATLAS_SIZE }
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
      const program = this.programs.ready('depth', defines, DEPTH)
      gl.useProgram(program.program)
      program.set('uViewProjection', viewProjection)
      program.set('uModel', item.worldMatrix)
      if (item.clip) program.set('uClipPlane', item.clip.plane)
      const buffers = this.resources.mesh(item.geometry, instances, true)
      gl.bindVertexArray(buffers.vao)
      const elements = item.geometry.drawnCount - item.geometry.drawnCount % 3
      const count = instances ? instances.count : 1
      if (buffers.indexType) gl.drawElementsInstanced(gl.TRIANGLES, elements, buffers.indexType, 0, count)
      else gl.drawArraysInstanced(gl.TRIANGLES, 0, elements, count)
    }
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

  // full-screen passes have no attributes, but still want a vertex array of their own
  #emptyArray() {
    if (!this.#empty) this.#empty = this.gl.createVertexArray()
    return this.#empty
  }
}
