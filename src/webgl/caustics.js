// Caustics: the light glass bends on its way through, gathered into bright lines and pools on what
// is behind it, spread thin round them, split into colours by a prism. One light's (the first that
// asks, light.caustics), over its view of the glass - the method of the WebGL water demos, with the
// bent light kept apart from the straight:
//
// 1. what the light lands on - the solids, casting or only receiving - drawn into a depth map from it;
// 2. the glass with thickness drawn from it too, nearest kept: its depth, normal (as its sides and its
//    hooks draw it), thickness, ior, dispersion, what of the light it lets through, and its distance
//    from the light - which tells receivers the straight light there went through it. Thin walls only
//    tint the light, as its shadow's glass layer does, so a tumbler's thin sides don't hide the drink;
// 3. its far side too - the back faces from the light, farthest kept: their depth and normal;
// 4. a grid of rays, one a texel, each bent into the glass by its ior and followed through it to its
//    far side - landing inside it if a surface comes first (a pool's floor) - bent out again there by
//    the far side's own normal (a prism's second face, a lens's back), and on to where it meets the
//    depth map: where each lands, how far from the light, and how strong (a spot's cone where it left
//    the light). Caught inside (total internal reflection), it's lost. A sheet with no far side of its
//    own - water's surface - takes its thickness for the depth, and out of it as a mirror of its
//    front. Rays that miss the glass, or that a solid stops first, don't count - the straight light is
//    the shadow's;
// 5. the grid drawn as triangles at where its rays landed, adding up: each as bright as it shrank -
//    its area before over its area after - so where rays bunch it is bright, where they spread, dim,
//    and light the glass doesn't bend lands as it was, 1 - tinted by the glass it came through. With
//    it, where it landed: its distance from the light, weighted by how much. With dispersion, once a
//    colour of the spectrum (SPECTRUM, red to violet), each bent by an ior of its own - red least -
//    and adding its own red, green and blue: a rainbow, its colours running into each other;
// 6. blurred as the light's size would soften them (a refine sample, from a point on the light, a
//    little only - the samples soften them) - which smooths the grid away too - into what is shown.
//    Drawn every frame (a hook on the glass - water's waves), each frame's is laid half over the
//    last's: lines thinner than a texel snap from texel to texel as they move, and shimmer; steadied
//    over two frames they glide.
//
// Receivers (shaders.js): the caustic light's straight share loses what went through thick glass
// (causticStraight), and gains the bent light that landed at their distance from the light
// (causticBent) - added, so it shows where the straight light doesn't reach: a prism's rainbow on a
// dark floor, a pool's caustics in the shadow of its wall. Like a shadow map it doesn't depend on the
// camera: drawn again only when the light, the glass or what it lands on changes - every frame with a
// shader hook, as the water's waves are. Needs float targets.
import * as mat3 from '../math/mat3.js'
import * as mat4 from '../math/mat4.js'
import { CAUSTIC_SIZE } from '../frame.js'
import { CLIP_ONLY_FRAGMENT, FULLSCREEN_VERTEX, MESH_VERTEX } from './shaders.js'
import { setHookUniforms } from './hooks.js'
import { glassMapDefines, setGlassMapUniforms, setGlassUniforms, setPlacementUniforms, setShapeUniforms, shapeDefines } from './shape.js'
import { DrawnFrom } from './drawn.js'
/** @import { Programs } from './programs.js' */
/** @import { Resources } from './resources.js' */
/** @import { TargetPool } from './targets.js' */
/** @import { Passes, ShadowMap } from './passes.js' */
/** @import { CausticFrame, DrawItem } from '../frame.js' */

/** The grid of rays is this many points across - a ray a caustic texel. */
export const CAUSTIC_GRID = 512
// brightest a caustic gets, where rays bunch to a point: so a fold doesn't blow up
const BRIGHTEST = 32
// drawn every frame, how much of each frame's goes over the last's - a little lag for fine light
// that moves smoothly rather than flickering
const STEADY = 0.35
// the spectrum's colours dispersion draws, red to violet: each one's place in the ior's spread (-1 the
// red end, 1 the violet) and its share of red, green and blue - bumps along the spectrum, scaled so
// each channel's shares add to 1, so white light stays white where the colours land together
const SPECTRUM = (() => {
  const n = 7
  const bump = (/** @type {number} */ t, /** @type {number} */ at, /** @type {number} */ width) => Math.exp(-(((t - at) / width) ** 2))
  const colours = Array.from({ length: n }, (_, k) => {
    const t = k / (n - 1)
    return { shift: t * 2 - 1, rgb: [bump(t, 0.05, 0.3), bump(t, 0.5, 0.25), bump(t, 0.95, 0.3)] }
  })
  const totals = [0, 1, 2].map((c) => colours.reduce((sum, colour) => sum + colour.rgb[c], 0))
  for (const colour of colours) colour.rgb = colour.rgb.map((v, c) => v / totals[c])
  return colours.map((colour) => /** @type {[number, number[]]} */ ([colour.shift, colour.rgb]))
})()

// distance from the light, along its way for the sun - as receivers measure it
const ALONG = /* glsl */ `
float along(vec3 p) {
  return uFrom.w > 0.5 ? length(p - uFrom.xyz) : dot(p, uDirection);
}
`

// where each ray lands: a pass over the grid, a pixel a ray
const LANDING_FRAGMENT = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D uGlassDepth;     // nearest thick glass from the light: its depth
uniform sampler2D uGlassNormal;    // its normal; w 1 where there is glass
uniform sampler2D uGlassInfo;      // thickness (world), ior, dispersion's spread of the ior
uniform sampler2D uBackDepth;      // the glass's far side from the light: its depth (0 where there is none)
uniform sampler2D uBackNormal;     // and its normal
uniform sampler2D uDepth;          // what it lands on, its depth from the light
uniform mat4 uLight;               // world to the light's clip space
uniform mat4 uLightInverse;        // and back
uniform vec4 uFrom;                // where it comes from (w 1: spot, rect) or w 0 (the sun)
uniform vec3 uDirection;           // the sun's way, a spot's or rect's middle
uniform vec2 uCone;                // a spot's cone: cos of its outer and inner angles; (-2, -1) for none
uniform float uReach;              // how far a ray is followed out of the glass, world units
uniform float uShift;              // dispersion: -1 red, 0, 1 blue - times the glass's spread
uniform float uGrid;               // the grid's points across
out vec4 fragColor;
${ALONG}
vec3 project(vec3 p) {
  vec4 c = uLight * vec4(p, 1.0);
  return c.xyz / c.w * 0.5 + 0.5;
}
float surfaceAt(vec2 uv) {
  return texture(uDepth, uv).r;
}
// follow a ray from start up to len along dir until it meets the depth map: true and where, or false
// and where it got to
bool march(vec3 start, vec3 dir, float len, out vec3 hit) {
  const int STEPS = 24;
  vec3 last = start;
  for (int i = 1; i <= STEPS; i++) {
    vec3 p = start + dir * (len * float(i) / float(STEPS));
    vec3 c = project(p);
    if (c.x < 0.0 || c.y < 0.0 || c.x > 1.0 || c.y > 1.0 || c.z > 1.0) {
      hit = p;
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
      hit = b;
      return true;
    }
    last = p;
  }
  hit = last;
  return false;
}
// follow a ray inside the glass to its far side, up to len: 2 and where, with the far side's normal
// there; 1 and where, if a surface comes first (a pool's floor); 0 if neither
int through(vec3 start, vec3 dir, float len, out vec3 hit, out vec3 normal) {
  const int STEPS = 24;
  vec3 last = start;
  for (int i = 1; i <= STEPS; i++) {
    vec3 p = start + dir * (len * float(i) / float(STEPS));
    vec3 c = project(p);
    if (c.x < 0.0 || c.y < 0.0 || c.x > 1.0 || c.y > 1.0 || c.z > 1.0) break;
    if (c.z >= surfaceAt(c.xy)) {
      march(last, dir, length(p - last), hit);
      return 1;
    }
    if (c.z >= texture(uBackDepth, c.xy).r) {
      // closer, between the last step and this
      vec3 a = last, b = p;
      for (int j = 0; j < 6; j++) {
        vec3 m = (a + b) * 0.5;
        vec3 cm = project(m);
        if (cm.z >= texture(uBackDepth, cm.xy).r) b = m;
        else a = m;
      }
      hit = b;
      normal = texture(uBackNormal, project(b).xy).xyz;
      return 2;
    }
    last = p;
  }
  return 0;
}
void main() {
  ivec2 point = ivec2(gl_FragCoord.xy);
  vec2 uv = vec2(point) / (uGrid - 1.0);
  ivec2 size = textureSize(uGlassNormal, 0);
  ivec2 texel = clamp(ivec2(uv * vec2(size)), ivec2(0), size - 1);
  vec4 normal = texelFetch(uGlassNormal, texel, 0);
  // no glass, or a solid between it and the light: no bent light - the straight light is the shadow's
  fragColor = vec4(uv, 0.0, -1.0);
  if (normal.w < 0.5) return;
  // where the glass is, back from its depth
  float depth = texelFetch(uGlassDepth, texel, 0).r;
  vec2 at = (vec2(texel) + 0.5) / vec2(size);
  vec4 w = uLightInverse * vec4(vec3(at, depth) * 2.0 - 1.0, 1.0);
  vec3 p = w.xyz / w.w;
  // how much of the light reaches the glass here, past the solids in its way - weighted over the
  // texels round it, so a shadow's edge across the glass (a pool's wall) fades over two or three. A ray
  // in shadow still lands, with no light: the triangles across the edge fade from lit to dark rather
  // than dropping out whole, which made the edge follow the grid, scalloped; and wide enough that a
  // wave bending the rays at the edge doesn't pop light in and out
  float open = 0.0, weights = 0.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      float g = exp(-float(x * x + y * y) / 4.0);
      vec2 q = at + vec2(x, y) / vec2(size);
      open += depth <= surfaceAt(q) + 1e-4 ? g : 0.0;
      weights += g;
    }
  }
  open /= weights;
  vec3 glass = texelFetch(uGlassInfo, texel, 0).xyz;
  vec3 l = uFrom.w > 0.5 ? normalize(p - uFrom.xyz) : normalize(uDirection);
  // a spot's cone, where the light leaves it for the glass
  float strength = smoothstep(uCone.x, uCone.y, dot(l, normalize(uDirection))) * open;
  vec3 n = normalize(normal.xyz);
  if (dot(n, l) > 0.0) n = -n;
  float ior = max(glass.y + uShift * glass.z, 1.0);
  vec3 t = refract(l, n, 1.0 / ior);
  if (dot(t, t) < 0.5) t = l;
  vec3 hit;
  bool landed = false;
  float back = texelFetch(uBackDepth, texel, 0).r;
  if (back > depth + 1e-5) {
    // a solid piece: through it to its far side - landing in it if a surface comes first - and out
    // by the far side's normal; caught inside, lost
    vec3 far;
    int met = through(p, t, uReach, hit, far);
    if (met == 0) return;
    landed = met == 1;
    if (!landed) {
      far = normalize(far);
      if (dot(far, t) < 0.0) far = -far;
      vec3 o = refract(t, -far, ior);
      if (dot(o, o) < 0.5) return;
      landed = march(hit + o * 1e-4, o, uReach, hit);
    }
  } else {
    // a sheet with no far side of its own: through its thickness - landing in it, if a surface comes
    // first (a pool's floor) - and out as a mirror of its front (a lens), on to where it lands
    landed = march(p, t, glass.x, hit);
    if (!landed) {
      vec3 mirrored = n - 2.0 * dot(n, l) * l;
      vec3 o = refract(t, -mirrored, ior);
      if (dot(o, o) < 0.5) o = t;
      landed = march(p + t * glass.x, o, uReach, hit);
    }
  }
  if (!landed) return;
  fragColor = vec4(project(hit).xy, along(hit), strength);
}
`

// the grid drawn where its rays landed, each triangle as bright as it shrank; a triangle with a
// corner that landed nowhere is left out
const SPLAT_VERTEX = /* glsl */ `
precision highp float;
precision highp sampler2D;
uniform sampler2D uLanded;  // where each of the grid's rays landed, in the caustics' [0, 1], how far from the light, how strong
uniform sampler2D uTint;    // what of the light the glass it went through lets through
uniform int uGrid;
out vec2 vBefore;
out float vAlong;
out vec3 vLight;
void main() {
  int cells = uGrid - 1;
  int cell = gl_VertexID / 6, corner = gl_VertexID - cell * 6;
  ivec2 c = ivec2(cell % cells, cell / cells);
  // this triangle's corners: the first three of the cell's six, or the last three
  ivec2 k0 = corner < 3 ? ivec2(0) : ivec2(0, 1), k1 = ivec2(1, 0), k2 = corner < 3 ? ivec2(0, 1) : ivec2(1);
  ivec2 o = corner == 0 ? ivec2(0) : (corner == 1 || corner == 4) ? ivec2(1, 0) : (corner == 2 || corner == 3) ? ivec2(0, 1) : ivec2(1);
  vec4 here = texelFetch(uLanded, c + o, 0);
  float lowest = min(here.w, min(texelFetch(uLanded, c + k0, 0).w, min(texelFetch(uLanded, c + k1, 0).w, texelFetch(uLanded, c + k2, 0).w)));
  vBefore = vec2(c + o) / float(cells);
  vAlong = here.z;
  vLight = texelFetch(uTint, c + o, 0).rgb * max(here.w, 0.0);
  // off the picture, the whole triangle, if a corner landed nowhere
  gl_Position = lowest < 0.0 ? vec4(2.0, 2.0, 2.0, 1.0) : vec4(here.xy * 2.0 - 1.0, 0.0, 1.0);
}
`
const SPLAT_FRAGMENT = /* glsl */ `
precision highp float;
in vec2 vBefore;
in float vAlong;
in vec3 vLight;
uniform vec3 uChannel;  // which colours this pass adds to
uniform float uTexels;  // the caustics' texels across
layout(location = 0) out vec4 fragLight;
layout(location = 1) out vec4 fragLanding;
void main() {
  // its area before, over its area as drawn - a texel a pixel
  vec2 x = dFdx(vBefore), y = dFdy(vBefore);
  float gathered = min(abs(x.x * y.y - x.y * y.x) * uTexels * uTexels, ${BRIGHTEST.toFixed(1)});
  fragLight = vec4(uChannel * vLight * gathered, 1.0);
  // where it landed, weighted by how much: the receivers' mean
  float amount = gathered * dot(uChannel, vec3(1.0 / 3.0)) * max(max(vLight.r, vLight.g), vLight.b);
  fragLanding = vec4(vAlong * amount, amount, 0.0, 1.0);
}
`

// a gaussian along one axis, as wide as the light's size softens the caustics - the light and where
// it landed, both sums, so blurred their mean stays a mean
const BLUR_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D uSource;
uniform sampler2D uSourceLanding;
uniform ivec2 uStep;
uniform float uRadius;
layout(location = 0) out vec4 fragLight;
layout(location = 1) out vec4 fragLanding;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy), last = textureSize(uSource, 0) - 1;
  int taps = int(ceil(uRadius));
  float sigma = max(uRadius * 0.5, 0.5);
  vec3 light = texelFetch(uSource, p, 0).rgb;
  vec2 landing = texelFetch(uSourceLanding, p, 0).xy;
  float total = 1.0;
  for (int i = 1; i <= taps; i++) {
    float g = exp(-float(i * i) / (2.0 * sigma * sigma));
    ivec2 a = clamp(p + uStep * i, ivec2(0), last), b = clamp(p - uStep * i, ivec2(0), last);
    light += (texelFetch(uSource, a, 0).rgb + texelFetch(uSource, b, 0).rgb) * g;
    landing += (texelFetch(uSourceLanding, a, 0).xy + texelFetch(uSourceLanding, b, 0).xy) * g;
    total += 2.0 * g;
  }
  fragLight = vec4(light / total, 1.0);
  fragLanding = vec4(landing / total, 0.0, 1.0);
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
    const half = gl.RGBA16F
    const depth = this.targets.get('caustic-depth', { width: size, height: size, color: null, depth: 'texture' })
    const glass = this.targets.get('caustic-glass', { width: size, height: size, color: [half, half, half, half], depth: 'texture' })
    const behind = this.targets.get('caustic-glass-back', { width: size, height: size, color: half, depth: 'texture' })
    const landed = this.targets.get('caustic-landed', { width: grid, height: grid, color: gl.RGBA32F, filter: 'nearest' })
    const light = this.targets.get('caustics', { width: size, height: size, color: [half, half] })
    const across = this.targets.get('caustics-blur', { width: size, height: size, color: [half, half] })
    const shown = this.targets.get('caustics-shown', { width: size, height: size, color: [half, half] })
    const unit = new Float32Array(16)
    mat4.multiply(unit, TO_UNIT, caustic.viewProjection)
    const from = caustic.from ? [caustic.from[0], caustic.from[1], caustic.from[2], 1] : [0, 0, 0, 0]
    /** @type {ShadowMap} */
    const result = {
      define: 'CAUSTICS', sampler: 'uCaustics', texture: /** @type {WebGLTexture} */ (shown.textures[0]), soft: null, glass: null, kept: false,
      uniforms: { uCausticMatrix: unit, uCausticTile: caustic.tile, uCausticFrom: from, uCausticDirection: caustic.direction, uCausticTolerance: caustic.tolerance },
      textures: { uCausticLanding: shown.textures[1], uCausticCover: glass.textures[3] },
    }
    const spreads = caustic.glass.some((item) => item.material.dispersion > 0)
    const cone = caustic.light.kind === 'spot' ? [Math.cos(caustic.light.angle ?? 0), Math.cos((caustic.light.angle ?? 0) * (1 - (caustic.light.penumbra ?? 0)))] : [-2, -1]
    const drawn = this.#drawn.begin().object(depth).object(glass).object(behind).object(landed).object(light).object(across).object(shown).numbers(caustic.viewProjection)
      .numbers(from).numbers(caustic.direction).numbers(cone).number(caustic.reach).number(caustic.blur).number(spreads ? spectrum : 1)
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

    // 2. the nearest glass with thickness: how it bends, what it lets through, what it covers
    gl.bindFramebuffer(gl.FRAMEBUFFER, glass.framebuffer)
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3])
    for (let i = 0; i < 4; i++) gl.clearBufferfv(gl.COLOR, i, [0, 0, 0, 0])
    gl.clear(gl.DEPTH_BUFFER_BIT)
    this.#drawGlass(caustic.glass, caustic.viewProjection, from, caustic.direction, time, cameraPosition)

    // 3. its far side: the farthest of it from the light
    gl.bindFramebuffer(gl.FRAMEBUFFER, behind.framebuffer)
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0])
    gl.clearDepth(0)
    gl.clear(gl.DEPTH_BUFFER_BIT)
    gl.depthFunc(gl.GREATER)
    this.#drawGlass(caustic.glass, caustic.viewProjection, from, caustic.direction, time, cameraPosition)
    gl.depthFunc(gl.LEQUAL)
    gl.clearDepth(1)

    // 4. where each ray lands, and 5. the grid drawn there, adding up
    gl.disable(gl.DEPTH_TEST)
    gl.depthMask(false)
    this.#empty ??= gl.createVertexArray()
    const inverse = mat4.invert(new Float32Array(16), caustic.viewProjection) ?? mat4.create()
    const passesOf = spreads ? SPECTRUM : [[0, [1, 1, 1]]]
    gl.bindFramebuffer(gl.FRAMEBUFFER, light.framebuffer)
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1])
    gl.viewport(0, 0, size, size)
    for (let i = 0; i < 2; i++) gl.clearBufferfv(gl.COLOR, i, [0, 0, 0, 0])
    for (const [shift, channel] of passesOf) {
      const landing = this.programs.ready('caustic-landing', [], LANDING)
      gl.useProgram(landing.program)
      gl.bindFramebuffer(gl.FRAMEBUFFER, landed.framebuffer)
      gl.viewport(0, 0, grid, grid)
      gl.disable(gl.BLEND)
      landing.set('uGlassDepth', glass.depthTexture)
      landing.set('uGlassNormal', glass.textures[0])
      landing.set('uGlassInfo', glass.textures[1])
      landing.set('uBackDepth', behind.depthTexture)
      landing.set('uBackNormal', behind.texture)
      landing.set('uDepth', depth.depthTexture)
      landing.set('uLight', caustic.viewProjection)
      landing.set('uLightInverse', inverse)
      landing.set('uFrom', from)
      landing.set('uDirection', caustic.direction)
      landing.set('uCone', cone)
      landing.set('uReach', caustic.reach)
      // refined, each sample's colours nudged across their slice of the spectrum, so the bands run into
      // each other (spectrum 0-2, 1 when not refining)
      landing.set('uShift', /** @type {number} */ (shift) + (spectrum - 1) / (SPECTRUM.length - 1))
      landing.set('uGrid', grid)
      this.programs.drawFullscreen()

      const splat = this.programs.ready('caustic-splat', [], SPLAT)
      gl.useProgram(splat.program)
      gl.bindFramebuffer(gl.FRAMEBUFFER, light.framebuffer)
      gl.viewport(0, 0, size, size)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE)
      splat.set('uLanded', landed.texture)
      splat.set('uTint', glass.textures[2])
      splat.set('uGrid', grid)
      splat.set('uTexels', size)
      splat.set('uChannel', channel)
      gl.bindVertexArray(this.#empty)
      gl.drawArrays(gl.TRIANGLES, 0, (grid - 1) * (grid - 1) * 6)
    }
    gl.disable(gl.BLEND)
    gl.bindVertexArray(null)

    // 6. softened as the light's size would: across into the second target, and back down into what
    // is shown - over the last frame's, when they move every frame
    const blur = this.programs.ready('caustic-blur', [], BLUR)
    gl.useProgram(blur.program)
    blur.set('uRadius', caustic.blur)
    gl.bindFramebuffer(gl.FRAMEBUFFER, across.framebuffer)
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1])
    blur.set('uSource', light.textures[0])
    blur.set('uSourceLanding', light.textures[1])
    blur.set('uStep', [1, 0])
    this.programs.drawFullscreen()
    const steady = this.#drawn.moving && this.#shown === shown
    gl.bindFramebuffer(gl.FRAMEBUFFER, shown.framebuffer)
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1])
    if (steady) {
      gl.enable(gl.BLEND)
      gl.blendColor(0, 0, 0, STEADY)
      gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA)
    }
    blur.set('uSource', across.textures[0])
    blur.set('uSourceLanding', across.textures[1])
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
   * The glass with thickness from the light, nearest kept: its normal, how it bends, what it lets
   * through, and its distance from the light.
   * @param {DrawItem[]} items @param {ArrayLike<number>} viewProjection @param {number[]} from
   * @param {ArrayLike<number>} direction @param {number} time @param {ArrayLike<number>} cameraPosition
   */
  #drawGlass(items, viewProjection, from, direction, time, cameraPosition) {
    const gl = this.gl
    const normalMatrix = new Float32Array(9)
    gl.disable(gl.CULL_FACE)
    for (const item of items) {
      const material = item.material
      const { defines, hook, cutout } = shapeDefines(item, true)
      defines.push('CAUSTIC_GLASS')
      // faceted glass bends by its faces, as it's drawn - a prism, a cut gem
      if (material.flatShading) defines.push('FLAT_SHADING')
      // a thickness map: thin walls bend little, a thick foot much
      glassMapDefines(item, defines)
      const program = this.programs.ready('caustic-glass', defines, GLASS, hook?.source)
      if (program.failed) continue
      gl.useProgram(program.program)
      if (hook) setHookUniforms(program, material, time, cameraPosition, (t) => this.resources.texture(t))
      program.set('uViewProjection', viewProjection)
      program.set('uModel', item.worldMatrix)
      setPlacementUniforms(program, item, this.resources)
      if (!mat3.normalFromMat4(normalMatrix, item.worldMatrix)) mat3.identity(normalMatrix)
      program.set('uNormalMatrix', normalMatrix)
      // thickness in world units, as the mesh is scaled
      const m = item.worldMatrix, scale = Math.hypot(m[0], m[1], m[2])
      program.set('uCausticGlass', [material.thickness * scale, material.ior, (material.ior - 1) * 0.025 * material.dispersion])
      setGlassUniforms(program, item)
      program.set('uCausticFrom', from)
      program.set('uCausticDirection', direction)
      setShapeUniforms(program, item, cutout, (t) => this.resources.texture(t))
      setGlassMapUniforms(program, item, (t) => this.resources.texture(t))
      this.resources.drawTriangles(item.geometry, item.instances)
    }
  }
}
