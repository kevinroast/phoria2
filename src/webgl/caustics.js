// Caustics: the light glass bends on its way through, gathered into bright lines and pools on what
// is behind it, and spread thin round them. One light's (the first that asks, light.caustics), in a
// texture of its own over its view of the glass - the method of the WebGL water demos:
//
// 1. what the light lands on - the solids, casting or only receiving - drawn into a depth map from it;
// 2. the glass with thickness drawn from it too: each texel its nearest glass's world position, normal
//    (as its sides and its hooks draw it), thickness, ior and dispersion. Thin walls only tint the
//    light, as its shadow's glass layer does, so a tumbler's thin sides don't hide the drink inside;
// 3. a grid of rays, one a point, each bent into the glass by its ior, followed through its thickness
//    - landing inside it if a surface comes first (a pool's floor) - and out of its far side, taken as
//    a mirror of its front (a lens), on to where it meets the depth map: where each lands;
// 4. the grid drawn as triangles at where its rays landed, adding up: each as bright as it shrank -
//    its area before over its area after - so where rays bunch it is bright, where they spread, dim,
//    and unbent light is exactly 1. With dispersion, three times - red, green and blue each bent by an
//    ior of its own - into their own channels: a prism's rainbow;
// 5. blurred as the light's size would soften them (a refine sample, from a point on the light, a
//    little only - the samples soften them) - which smooths the grid away too - into what is shown.
//    Drawn every frame (a hook on the glass - water's waves), each frame's is laid half over the
//    last's: lines thinner than a texel snap from texel to texel as they move, and shimmer; steadied
//    over two frames they glide.
//
// Receivers multiply the caustic light by it (shaders.js causticAt). Like a shadow map it doesn't
// depend on the camera: drawn again only when the light, the glass or what it lands on changes -
// every frame with a shader hook, as the water's waves are. Needs float targets.
import * as mat3 from '../math/mat3.js'
import * as mat4 from '../math/mat4.js'
import { CAUSTIC_SIZE } from '../frame.js'
import { CLIP_ONLY_FRAGMENT, FULLSCREEN_VERTEX, MESH_VERTEX } from './shaders.js'
import { setHookUniforms } from './hooks.js'
import { setShapeUniforms, shapeDefines } from './shape.js'
import { DrawnFrom } from './drawn.js'
/** @import { Programs } from './programs.js' */
/** @import { Resources } from './resources.js' */
/** @import { TargetPool } from './targets.js' */
/** @import { Passes, ShadowMap } from './passes.js' */
/** @import { CausticFrame, DrawItem } from '../frame.js' */

/** The grid of rays is this many points across - each cell about two caustic texels. */
export const CAUSTIC_GRID = 512
// brightest a caustic gets, where rays bunch to a point: so a fold doesn't blow up
const BRIGHTEST = 32
// drawn every frame, how much of each frame's goes over the last's
const STEADY = 0.5

// where each ray lands: a pass over the grid, a pixel a ray
const LANDING_FRAGMENT = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D uGlassPosition;  // nearest thick glass from the light: world position
uniform sampler2D uGlassNormal;    // its normal; w 1 where there is glass
uniform sampler2D uGlassInfo;      // thickness (world), ior, dispersion's spread of the ior
uniform sampler2D uDepth;          // what it lands on, its depth from the light
uniform mat4 uLight;               // world to the light's clip space
uniform vec4 uFrom;                // where it comes from (w 1: spot, rect) or w 0 (the sun)
uniform vec3 uDirection;           // the sun's way
uniform float uReach;              // how far a ray is followed out of the glass, world units
uniform float uShift;              // dispersion: -1 red, 0, 1 blue - times the glass's spread
uniform float uGrid;               // the grid's points across
out vec4 fragColor;

vec3 project(vec3 p) {
  vec4 c = uLight * vec4(p, 1.0);
  return c.xyz / c.w * 0.5 + 0.5;
}
float surfaceAt(vec2 uv) {
  return texture(uDepth, uv).r;
}
// follow a ray from start up to len along dir until it meets the depth map: true and where, or false
// and where it got to
bool march(vec3 start, vec3 dir, float len, out vec2 hit) {
  const int STEPS = 24;
  vec3 last = start;
  for (int i = 1; i <= STEPS; i++) {
    vec3 p = start + dir * (len * float(i) / float(STEPS));
    vec3 c = project(p);
    if (c.x < 0.0 || c.y < 0.0 || c.x > 1.0 || c.y > 1.0 || c.z > 1.0) {
      hit = c.xy;
      return false;
    }
    if (c.z >= surfaceAt(c.xy)) {
      // closer, between the last step and this
      vec3 a = last, b = p;
      for (int j = 0; j < 6; j++) {
        vec3 m = (a + b) * 0.5;
        vec3 cm = project(m);
        if (cm.z >= surfaceAt(cm.xy)) b = m;
        else a = m;
      }
      hit = project(b).xy;
      return true;
    }
    last = p;
  }
  hit = project(last).xy;
  return false;
}
void main() {
  ivec2 point = ivec2(gl_FragCoord.xy);
  vec2 uv = vec2(point) / (uGrid - 1.0);
  vec2 landed = uv;
  ivec2 size = textureSize(uGlassNormal, 0);
  ivec2 texel = clamp(ivec2(uv * vec2(size)), ivec2(0), size - 1);
  vec4 normal = texelFetch(uGlassNormal, texel, 0);
  if (normal.w > 0.5) {
    vec3 p = texelFetch(uGlassPosition, texel, 0).xyz;
    vec3 glass = texelFetch(uGlassInfo, texel, 0).xyz;
    vec3 at = project(p);
    // glass a solid hides from the light gets none to bend
    if (at.z <= surfaceAt(at.xy) + 1e-4) {
      vec3 l = uFrom.w > 0.5 ? normalize(p - uFrom.xyz) : normalize(uDirection);
      vec3 n = normalize(normal.xyz);
      if (dot(n, l) > 0.0) n = -n;
      float ior = max(glass.y + uShift * glass.z, 1.0);
      vec3 t = refract(l, n, 1.0 / ior);
      if (dot(t, t) < 0.5) t = l;
      vec2 hit;
      // through the glass - landing in it, if a surface comes first (a pool's floor)
      if (march(p, t, glass.x, hit)) landed = hit;
      else {
        // out of its far side, its front mirrored across the ray (a lens), and on to where it lands
        vec3 back = n - 2.0 * dot(n, l) * l;
        vec3 o = refract(t, -back, ior);
        if (dot(o, o) < 0.5) o = t;
        march(p + t * glass.x, o, uReach, hit);
        landed = hit;
      }
    }
  }
  fragColor = vec4(landed, 0.0, 1.0);
}
`

// a gaussian along one axis, as wide as the light's size softens the caustics
const BLUR_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D uSource;
uniform ivec2 uStep;
uniform float uRadius;
out vec4 fragColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy), last = textureSize(uSource, 0) - 1;
  int taps = int(ceil(uRadius));
  float sigma = max(uRadius * 0.5, 0.5);
  vec3 sum = texelFetch(uSource, p, 0).rgb;
  float total = 1.0;
  for (int i = 1; i <= taps; i++) {
    float g = exp(-float(i * i) / (2.0 * sigma * sigma));
    sum += (texelFetch(uSource, clamp(p + uStep * i, ivec2(0), last), 0).rgb + texelFetch(uSource, clamp(p - uStep * i, ivec2(0), last), 0).rgb) * g;
    total += 2.0 * g;
  }
  fragColor = vec4(sum / total, 1.0);
}
`

// the grid drawn where its rays landed, each triangle as bright as it shrank
const SPLAT_VERTEX = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D uLanded;  // where each of the grid's rays landed, in the caustics' [0, 1]
uniform int uGrid;
out vec2 vBefore;
out vec2 vAfter;
void main() {
  int cells = uGrid - 1;
  int cell = gl_VertexID / 6, corner = gl_VertexID - cell * 6;
  ivec2 c = ivec2(cell % cells, cell / cells);
  ivec2 o = corner == 0 ? ivec2(0) : (corner == 1 || corner == 4) ? ivec2(1, 0) : (corner == 2 || corner == 3) ? ivec2(0, 1) : ivec2(1);
  vBefore = vec2(c + o) / float(cells);
  vAfter = texelFetch(uLanded, c + o, 0).xy;
  gl_Position = vec4(vAfter * 2.0 - 1.0, 0.0, 1.0);
}
`
const SPLAT_FRAGMENT = /* glsl */ `
precision highp float;
in vec2 vBefore;
in vec2 vAfter;
uniform vec3 uChannel;  // which colours this pass adds to
uniform float uTexels;  // the caustics' texels across
out vec4 fragColor;
void main() {
  // its area before, over its area as drawn - a texel a pixel
  vec2 x = dFdx(vBefore), y = dFdy(vBefore);
  float gathered = abs(x.x * y.y - x.y * y.x) * uTexels * uTexels;
  fragColor = vec4(uChannel * min(gathered, ${BRIGHTEST.toFixed(1)}), 1.0);
}
`

const GLASS = /** @type {[string, string]} */ ([MESH_VERTEX, CLIP_ONLY_FRAGMENT])
const LANDING = /** @type {[string, string]} */ ([FULLSCREEN_VERTEX, LANDING_FRAGMENT])
const SPLAT = /** @type {[string, string]} */ ([SPLAT_VERTEX, SPLAT_FRAGMENT])
const BLUR = /** @type {[string, string]} */ ([FULLSCREEN_VERTEX, BLUR_FRAGMENT])
// clip space to [0, 1] coordinates and depth
const TO_UNIT = new Float32Array([0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 0.5, 0.5, 0.5, 1])

export class Caustics {
  #drawn = new DrawnFrom()
  /** @type {WebGLVertexArrayObject | null} */ #empty = null
  /** The target last shown, while it holds caustics to lay the next over. @type {object | null} */ #shown = null

  /** @param {WebGL2RenderingContext} gl @param {Programs} programs @param {Resources} resources @param {TargetPool} targets */
  constructor(gl, programs, resources, targets) {
    this.gl = gl
    this.programs = programs
    this.resources = resources
    this.targets = targets
  }

  /** Forget its GL objects - after a lost context, when they are already gone. */
  reset() {
    this.#empty = null
    this.#shown = null
    this.#drawn.forget()
  }

  /**
   * The caustics for this frame, as a shadow map's entry: what the lit programs need to read them.
   * @param {CausticFrame} caustic @param {Passes} passes @param {number} spectrum a refine sample's
   *   share of dispersion's spread (1 when not refining) @param {number} time for shader hooks
   * @param {ArrayLike<number>} cameraPosition for shader hooks
   * @returns {ShadowMap}
   */
  draw(caustic, passes, spectrum, time, cameraPosition) {
    const gl = this.gl
    const size = CAUSTIC_SIZE, grid = CAUSTIC_GRID
    const depth = this.targets.get('caustic-depth', { width: size, height: size, color: null, depth: 'texture' })
    const glass = this.targets.get('caustic-glass', { width: size, height: size, color: [gl.RGBA32F, gl.RGBA16F, gl.RGBA16F], depth: 'buffer', filter: 'nearest' })
    const landed = this.targets.get('caustic-landed', { width: grid, height: grid, color: gl.RGBA32F, filter: 'nearest' })
    const light = this.targets.get('caustics', { width: size, height: size, color: gl.RGBA16F })
    const across = this.targets.get('caustics-blur', { width: size, height: size, color: gl.RGBA16F })
    const shown = this.targets.get('caustics-shown', { width: size, height: size, color: gl.RGBA16F })
    const unit = new Float32Array(16)
    mat4.multiply(unit, TO_UNIT, caustic.viewProjection)
    /** @type {ShadowMap} */
    const result = {
      define: 'CAUSTICS', uniforms: { uCausticMatrix: unit, uCausticTile: caustic.tile }, sampler: 'uCaustics',
      texture: /** @type {WebGLTexture} */ (shown.texture), soft: null, glass: null, kept: false,
    }
    const spreads = caustic.glass.some((item) => item.material.dispersion > 0)
    const drawn = this.#drawn.begin().object(depth).object(glass).object(landed).object(light).object(across).object(shown).numbers(caustic.viewProjection)
      .numbers(caustic.from ?? [0, 0, 0]).numbers(caustic.direction).number(caustic.reach).number(caustic.blur).number(spreads ? spectrum : 1)
      .casters(caustic.surfaces).casters(caustic.glass, true)
    for (const item of caustic.glass) drawn.number(item.material.ior).number(item.material.thickness).number(item.material.dispersion)
    result.kept = drawn.same()
    if (result.kept) return result

    // 1. what the light lands on
    gl.bindFramebuffer(gl.FRAMEBUFFER, depth.framebuffer)
    gl.viewport(0, 0, size, size)
    gl.depthMask(true)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.disable(gl.BLEND)
    gl.disable(gl.CULL_FACE)
    gl.clear(gl.DEPTH_BUFFER_BIT)
    passes.drawDepth(caustic.surfaces, caustic.viewProjection)

    // 2. the nearest glass with thickness, and how it bends
    gl.bindFramebuffer(gl.FRAMEBUFFER, glass.framebuffer)
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2])
    for (let i = 0; i < 3; i++) gl.clearBufferfv(gl.COLOR, i, [0, 0, 0, 0])
    gl.clear(gl.DEPTH_BUFFER_BIT)
    this.#drawGlass(caustic.glass, caustic.viewProjection, time, cameraPosition)

    // 3. where each ray lands, and 4. the grid drawn there, adding up
    gl.disable(gl.DEPTH_TEST)
    gl.depthMask(false)
    this.#empty ??= gl.createVertexArray()
    const passesOf = spreads ? [[-1, [1, 0, 0]], [0, [0, 1, 0]], [1, [0, 0, 1]]] : [[0, [1, 1, 1]]]
    gl.bindFramebuffer(gl.FRAMEBUFFER, light.framebuffer)
    gl.viewport(0, 0, size, size)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    for (const [shift, channel] of passesOf) {
      const landing = this.programs.ready('caustic-landing', [], LANDING)
      gl.useProgram(landing.program)
      gl.bindFramebuffer(gl.FRAMEBUFFER, landed.framebuffer)
      gl.viewport(0, 0, grid, grid)
      gl.disable(gl.BLEND)
      landing.set('uGlassPosition', glass.textures[0])
      landing.set('uGlassNormal', glass.textures[1])
      landing.set('uGlassInfo', glass.textures[2])
      landing.set('uDepth', depth.depthTexture)
      landing.set('uLight', caustic.viewProjection)
      landing.set('uFrom', caustic.from ? [caustic.from[0], caustic.from[1], caustic.from[2], 1] : [0, 0, 0, 0])
      landing.set('uDirection', caustic.direction)
      landing.set('uReach', caustic.reach)
      landing.set('uShift', /** @type {number} */ (shift) * spectrum)
      landing.set('uGrid', grid)
      this.programs.drawFullscreen()

      const splat = this.programs.ready('caustic-splat', [], SPLAT)
      gl.useProgram(splat.program)
      gl.bindFramebuffer(gl.FRAMEBUFFER, light.framebuffer)
      gl.viewport(0, 0, size, size)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE)
      splat.set('uLanded', landed.texture)
      splat.set('uGrid', grid)
      splat.set('uTexels', size)
      splat.set('uChannel', channel)
      gl.bindVertexArray(this.#empty)
      gl.drawArrays(gl.TRIANGLES, 0, (grid - 1) * (grid - 1) * 6)
    }
    gl.disable(gl.BLEND)
    gl.bindVertexArray(null)

    // 5. softened as the light's size would: across into the second target, and back down
    const blur = this.programs.ready('caustic-blur', [], BLUR)
    gl.useProgram(blur.program)
    blur.set('uRadius', caustic.blur)
    gl.bindFramebuffer(gl.FRAMEBUFFER, across.framebuffer)
    blur.set('uSource', light.texture)
    blur.set('uStep', [1, 0])
    this.programs.drawFullscreen()
    // down, into what is shown - over the last frame's, when they move every frame
    const steady = drawn.moving && this.#shown === shown
    gl.bindFramebuffer(gl.FRAMEBUFFER, shown.framebuffer)
    if (steady) {
      gl.enable(gl.BLEND)
      gl.blendColor(0, 0, 0, STEADY)
      gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA)
    }
    blur.set('uSource', across.texture)
    blur.set('uStep', [0, 1])
    this.programs.drawFullscreen()
    gl.disable(gl.BLEND)
    this.#shown = shown

    gl.depthMask(true)
    gl.enable(gl.DEPTH_TEST)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return result
  }

  /**
   * The glass with thickness from the light, nearest kept: where it is, its normal, how it bends.
   * @param {DrawItem[]} items @param {ArrayLike<number>} viewProjection @param {number} time @param {ArrayLike<number>} cameraPosition
   */
  #drawGlass(items, viewProjection, time, cameraPosition) {
    const gl = this.gl
    const normalMatrix = new Float32Array(9)
    gl.disable(gl.CULL_FACE)
    for (const item of items) {
      const material = item.material
      const { defines, hook, cutout } = shapeDefines(item, true)
      defines.push('CAUSTIC_GLASS')
      const program = this.programs.ready('caustic-glass', defines, GLASS, hook?.source)
      if (program.failed) continue
      gl.useProgram(program.program)
      if (hook) setHookUniforms(program, material, time, cameraPosition, (t) => this.resources.texture(t))
      program.set('uViewProjection', viewProjection)
      program.set('uModel', item.worldMatrix)
      if (!mat3.normalFromMat4(normalMatrix, item.worldMatrix)) mat3.identity(normalMatrix)
      program.set('uNormalMatrix', normalMatrix)
      // thickness in world units, as the mesh is scaled
      const m = item.worldMatrix, scale = Math.hypot(m[0], m[1], m[2])
      program.set('uCausticGlass', [material.thickness * scale, material.ior, (material.ior - 1) * 0.025 * material.dispersion])
      setShapeUniforms(program, item, cutout, (t) => this.resources.texture(t))
      this.resources.drawTriangles(item.geometry, item.instances)
    }
  }
}
