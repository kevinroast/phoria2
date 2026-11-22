// GLSL ES 3.00 shaders. One source per kind of drawable; features are switched with #defines so each
// material variant compiles only what it uses. Attribute locations are fixed (see ATTRIBUTES) so
// vertex arrays work with any program.
import { warnOnce } from '../validate.js'
import { MAPS } from '../material/features.js'
import { TONE_CONSTANTS } from './tone.js'
import { ENV_DFG } from './dfg.js'
import { withParts } from './parts.js'

/** Fixed attribute locations shared by every program. */
export const ATTRIBUTES = {
  position: 0,
  normal: 1,
  uv: 2,
  color: 3,
  instanceMatrix: 4, // 4-7, a mat4 takes four slots
  instanceColor: 8,
  tangent: 9, // brushed metal's direction: along the UVs' u, and which way their v runs
  uv2: 10, // a second UV set, for baked occlusion and light maps
  // points drawn as squares (sprites): each one's size, opacity and angle, and which point it is
  pointSize: 11,
  pointOpacity: 12,
  pointAngle: 13,
  pointIndex: 14,
  // lines: per-segment endpoints and colours, and the corner of the quad being drawn
  segmentStart: 0,
  segmentEnd: 1,
  segmentColorStart: 2,
  segmentColorEnd: 3,
  corner: 4,
  segmentInfo: 5, // how far along its chain the segment starts, and whether it starts or ends one
}

// a section plane: fragments on its far side are cut away
export const CLIP = /* glsl */ `
#ifdef CLIP
uniform vec4 uClipPlane; // world space, unit normal: cut away where dot(n, p) + d > 0
void clipAway(vec3 p) {
  if (dot(uClipPlane.xyz, p) + uClipPlane.w > 0.0) discard;
}
#else
void clipAway(vec3 p) {}
#endif
`

// distance fog, applied to the final colour so it meets a background of the same colour; additive
// glows fade out rather than towards the fog's colour. Lit surfaces are fogged in light, before their
// tone map (see the mesh shader), towards uFogLight - the light that tone maps to the fog's colour
export const FOG = /* glsl */ `
#ifdef FOG
uniform vec3 uFogColor;   // linear
uniform vec3 uFogLight;   // the light the tone map turns into uFogColor
uniform vec2 uFogRange;   // linear fog: near, far
uniform float uFogDensity; // exponential fog
in float vFogDepth;
// how much of the fog lies between the eye and here, 0 - 1
float fogAmount() {
#ifdef FOG_LINEAR
  return clamp((vFogDepth - uFogRange.x) / max(uFogRange.y - uFogRange.x, 1e-4), 0.0, 1.0);
#else
  float d = uFogDensity * vFogDepth;
  return 1.0 - exp(-d * d);
#endif
}
vec3 fogged(vec3 c) {
  float f = fogAmount();
#ifdef FOG_ADD
  return c * (1.0 - f);
#elif defined(FOG_MULTIPLY)
  // a filter in the fog fades to white, which leaves what is behind it as it was
  return mix(c, vec3(1.0), f);
#else
  return mix(c, uFogColor, f);
#endif
}
#else
vec3 fogged(vec3 c) { return c; }
#endif
`

// depth or stencil only - of what isn't cut away
// How a map is read: by UV, or projected from the mesh's three axes (triplanar) - the same in every pass
// that reads one, so a cut-out's shadow has the holes it is drawn with. Needs vUv declared first.
// the samplers a mesh's maps are read through
const MAP_SAMPLERS = MAPS.filter((m) => m.slot !== 'matcap').map((m) => m.uniform)

const SAMPLING = /* glsl */ `
#ifdef UV2
in vec2 vUv2;
#endif
// each map's own transform - repeat, rotation and offset - and the UV set it reads: the first
// unless the renderer defines its set as vUv2. uMapCoord is where uMap is read and uMapTexel what
// it holds there - spelled out per map, as WebGL's GLSL has no token pasting
${MAP_SAMPLERS.map((m) => `uniform mat3 ${m}Uv;
#ifndef ${m}Set
#define ${m}Set vUv
#endif
#define ${m}Coord (${m}Uv * vec3(${m}Set, 1.0)).xy`).join('\n')}
#ifdef TRIPLANAR
in vec3 vObjectPosition;
in vec3 vObjectNormal;
in mat3 vObjectToWorld;
uniform float uTriplanar; // repeats per unit of the mesh's own space

// a projection's coordinates through the map's transform, as UVs would be
vec2 projected(vec2 p, mat3 t) {
  return (t * vec3(p, 1.0)).xy;
}

// how much each axis's projection counts: mostly the one the surface faces, blended at the turns
vec3 triplanarWeights(vec3 n) {
  vec3 w = pow(abs(n), vec3(4.0));
  return w / (w.x + w.y + w.z);
}
// a map seen from the three axes and blended - for meshes with no UVs, scans and CAD models
vec4 triplanar(sampler2D s, mat3 t) {
  vec3 p = vObjectPosition * uTriplanar, w = triplanarWeights(normalize(vObjectNormal));
  return texture(s, projected(p.zy, t)) * w.x + texture(s, projected(p.xz, t)) * w.y + texture(s, projected(p.xy, t)) * w.z;
}
${MAP_SAMPLERS.map((m) => `#define ${m}Texel triplanar(${m}, ${m}Uv)`).join('\n')}
#else
${MAP_SAMPLERS.map((m) => `#define ${m}Texel texture(${m}, ${m}Coord)`).join('\n')}
#endif
`

/**
 * A cut-out's alpha test - its opacity and its map's alpha against its threshold - for the passes
 * that draw only a mesh's shape (shadows, the depth prepass, picking, outlines), so each has the
 * holes the picture has. cutOut() discards what the picture leaves out. Needs vUv declared first.
 */
export const CUTOUT = /* glsl */ `
#ifdef ALPHA_TEST
uniform float uOpacity;
uniform float uAlphaTest;
#ifdef MAP
uniform sampler2D uMap;
${SAMPLING}
#endif
void cutOut() {
  float alpha = uOpacity;
#ifdef MAP
  alpha *= uMapTexel.a;
#endif
  if (alpha < uAlphaTest) discard;
}
#else
void cutOut() {}
#endif
`

export const CLIP_ONLY_FRAGMENT = /* glsl */ `
precision highp float;
in vec3 vWorldPosition;
layout(location = 0) out vec4 fragColor;
#ifdef CAUSTIC_GLASS
// caustics' glass, seen from the light (where it is comes from the depth): its normal - the sides and
// the hook's bending as drawn (fragColor); how it bends - its thickness in world units, ior and
// dispersion's spread of the ior; what of the light it lets through; and that it is there, with its
// distance from the light - for what it covers, which gets its light bent
layout(location = 1) out vec4 fragGlass;
layout(location = 2) out vec4 fragTint;
layout(location = 3) out vec4 fragCover;
uniform vec3 uCausticGlass;
uniform vec3 uCausticTint;
uniform vec4 uCausticFrom;       // the light's position, w 1 (spot, rect); w 0 for the sun
uniform vec3 uCausticDirection;  // the sun's way
#endif
#if defined(ALPHA_TEST) || defined(HOOK_FRAGMENT)
in vec2 vUv;
#endif
#if defined(HOOK_FRAGMENT) || defined(NORMALS) || defined(CAUSTIC_GLASS)
in vec3 vNormal;
#endif
#ifdef NORMALS
// ambient occlusion's prepass: each pixel's normal in view space, as the picture shades it
uniform mat4 uView;
#endif
#ifdef GLASS_FILTER
uniform vec3 uGlassFilter;
#endif
#ifdef HOOK_FRAGMENT
// a fragment hook's discards cut the shadow too - a dissolving thing casts what is left of it
in vec3 vColor;
//@hook uniforms
#endif
// a cut-out casts the shadow of what is left of it - leaves, fences, grilles - not of its rectangle
${CUTOUT}
${CLIP}
void main() {
  clipAway(vWorldPosition);
#if (defined(NORMALS) || defined(CAUSTIC_GLASS)) && defined(FLAT_SHADING)
  vec3 normal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
#elif defined(HOOK_FRAGMENT) || defined(NORMALS) || defined(CAUSTIC_GLASS)
  vec3 normal = normalize(vNormal);
#if defined(NORMALS) && defined(DOUBLE_SIDED)
  if (!gl_FrontFacing) normal = -normal;
#endif
#endif
#ifdef HOOK_FRAGMENT
  {
    vec4 base = vec4(vColor, 1.0);
    vec3 emissive = vec3(0.0);
//@hook fragment
    if (base.a <= 0.0) discard;
  }
#endif
  cutOut();
#ifdef NORMALS
  fragColor = vec4(normalize(mat3(uView) * normal) * 0.5 + 0.5, 1.0);
#elif defined(GLASS_FILTER)
  // a glass caster in a shadow map's glass layer: the light it lets through - the layer multiplies
  // them - and, kept by the nearest, its depth from the light
  fragColor = vec4(uGlassFilter, gl_FragCoord.z);
#elif defined(CAUSTIC_GLASS)
  fragColor = vec4(normal, 1.0);
  fragGlass = vec4(uCausticGlass, 1.0);
  fragTint = vec4(uCausticTint, 1.0);
  float along = uCausticFrom.w > 0.5 ? length(vWorldPosition - uCausticFrom.xyz) : dot(vWorldPosition, uCausticDirection);
  fragCover = vec4(1.0, along, 0.0, 1.0);
#else
  fragColor = vec4(1.0);
#endif
}
`

export const COMMON = /* glsl */ `
vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
// not clamped to white: what is written is clamped by the target (8 bits, the canvas), and a float
// target keeps what is past white, for bloom
vec3 linearToSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
// what a shader writes: premultiplied - the colour faded by its opacity, and how much of what is
// behind it hides - as sRGB for a picture shown as it is, or with LINEAR_OUTPUT as linear light,
// unclamped, into a float target that a later pass encodes once (ENCODE_FRAGMENT)
vec4 outputColor(vec3 color, float alpha, float coverage) {
#ifdef LINEAR_OUTPUT
  return vec4(color * alpha, coverage);
#else
  return vec4(linearToSrgb(color) * alpha, coverage);
#endif
}
// outputColor's counterpart, for a pass reading a picture: its colour as linear light, taken out of
// its alpha - the picture sRGB, drawn as the canvas would be, or with LINEAR_INPUT linear already
vec3 inputColor(vec4 c) {
  if (c.a <= 0.0) return vec3(0.0);
#ifdef LINEAR_INPUT
  return c.rgb / c.a;
#else
  return srgbToLinear(c.rgb / c.a);
#endif
}
`

// a direction to equirectangular UVs: around from +x towards +z, and down from straight up (the
// image's first row is the top, as glTF and image files have it)
export const EQUIRECT = /* glsl */ `
vec2 equirectUv(vec3 d) {
  return vec2(atan(d.z, d.x) * 0.15915494 + 0.5, acos(clamp(d.y, -1.0, 1.0)) * 0.31830989);
}
vec3 equirectDirection(vec2 uv) {
  float phi = (uv.x - 0.5) * 6.28318531, theta = uv.y * 3.14159265;
  return vec3(cos(phi) * sin(theta), cos(theta), sin(phi) * sin(theta));
}
`

// a picture drawn in linear light (LINEAR_OUTPUT) encoded as the sRGB the screen shows - once, at
// the end of a chain that worked in linear light. Premultiplied in, premultiplied out: the colour is
// taken out of its alpha, encoded, and put back
export const ENCODE_FRAGMENT = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform sampler2D uSource;
out vec4 fragColor;
${COMMON}
void main() {
  vec4 c = texture(uSource, vUv);
  fragColor = c.a > 0.0 ? vec4(linearToSrgb(c.rgb / c.a) * c.a, c.a) : vec4(0.0);
}
`

// a refine sample into the running average, the blend unit weighting it: in linear light, so edges
// and penumbrae average as light does. The sample was drawn as the plain frame is, as sRGB - glass
// and other see-through things blending just as they do on the canvas - unless the frame is linear
// (LINEAR_INPUT); premultiplied in, premultiplied out
export const ACCUMULATE_FRAGMENT = /* glsl */ `
precision highp float;
in vec2 vUv;
uniform sampler2D uSource;
out vec4 fragColor;
${COMMON}
void main() {
  vec4 c = texture(uSource, vUv);
#ifdef LINEAR_INPUT
  fragColor = c;
#else
  fragColor = vec4(inputColor(c) * c.a, c.a);
#endif
}
`

// one triangle that covers the screen, for backgrounds and image passes
export const FULLSCREEN_VERTEX = /* glsl */ `
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`

export const TONE_MAP = /* glsl */ `
uniform float uExposure;
uniform int uToneMapping;    // 0 none, 1 aces, 2 neutral
${TONE_CONSTANTS}
// the curve alone, on light already scaled by the exposure (bloom adds its glow in light and maps
// the sum with it) - as tone.js's toneCurve
vec3 toneCurve(vec3 c) {
  if (uToneMapping == 1) {
    // ACES filmic, Narkowicz's fit - up to ACES_TOP, not clamped to 1, so bloom can tell its
    // highlights from white (sRGB clamps what shows)
    c = max((c * (ACES_A * c + ACES_B)) / (c * (ACES_C * c + ACES_D) + ACES_E), 0.0);
  } else if (uToneMapping == 2) {
    // Khronos PBR Neutral
    float x = min(c.r, min(c.g, c.b));
    float offset = x < 2.0 * NEUTRAL_TOE ? x - x * x / (4.0 * NEUTRAL_TOE) : NEUTRAL_TOE;
    c -= offset;
    float peak = max(c.r, max(c.g, c.b));
    if (peak > NEUTRAL_START) {
      float d = 1.0 - NEUTRAL_START;
      float newPeak = 1.0 - d * d / (peak + d - NEUTRAL_START);
      c *= newPeak / peak;
      float g = 1.0 - 1.0 / (NEUTRAL_DESATURATION * (peak - newPeak) + 1.0);
      c = mix(c, vec3(newPeak), g);
    }
  }
  return c;
}

vec3 toneMap(vec3 c) {
  return toneCurve(c * uExposure);
}
`

export const MESH_VERTEX = /* glsl */ `
layout(location = 0) in vec3 position;
layout(location = 1) in vec3 normal;
layout(location = 2) in vec2 uv;
layout(location = 3) in vec3 color;
#ifdef INSTANCED
layout(location = 4) in mat4 instanceMatrix;
layout(location = 8) in vec3 instanceColor;
#endif
#ifdef ANISOTROPY
layout(location = 9) in vec4 tangent;
out vec4 vTangent;
#endif
#ifdef UV2
layout(location = 10) in vec2 uv2;
out vec2 vUv2;
#endif

uniform mat4 uModel;
uniform mat3 uNormalMatrix;
uniform mat4 uViewProjection;
uniform int uHighlightIndex; // -2 none, -1 the whole node, otherwise the instance
#ifdef FOG
uniform mat4 uView;
out float vFogDepth;
#endif
//@hook uniforms

out vec3 vWorldPosition;
out vec3 vNormal;
out vec2 vUv;
out vec3 vColor;
flat out float vHighlight;
#ifdef TRIPLANAR
// the mesh's own space, so projected maps stay on it as it moves; and how its normals turn into the world
out vec3 vObjectPosition;
out vec3 vObjectNormal;
out mat3 vObjectToWorld;
#endif
#ifdef PICK
flat out uint vPickElement; // which instance, point or segment, for GPU picking
#endif
#ifdef REFRACTION
out float vThicknessScale;  // glass's own units to the world's: how far its thickness reaches
#endif

${COMMON}

// Matrices times vectors only - a matrix times a matrix per vertex is four times the work, and
// with 100,000 instances the vertex stage is most of the frame.
void main() {
  vColor = vec3(1.0);
  vHighlight = uHighlightIndex == -1 ? 1.0 : 0.0;
  // the vertex in the geometry's own space - where a shader hook moves it
  vec3 local = position;
  vec3 n = normal;
#ifdef HOOK_VERTEX
  {
    int index = gl_InstanceID;
//@hook vertex
  }
#endif
#ifdef INSTANCED
  vec4 placed = instanceMatrix * vec4(local, 1.0);
  // the instance's normal matrix as its cofactor: the inverse transpose up to scale, from three
  // cross products, flipped back for mirroring transforms
  mat3 m = mat3(instanceMatrix);
  mat3 instanceNormal = mat3(cross(m[1], m[2]), cross(m[2], m[0]), cross(m[0], m[1])) * sign(dot(m[0], cross(m[1], m[2])));
  vec3 placedNormal = instanceNormal * n;
  vColor *= instanceColor;
  if (gl_InstanceID == uHighlightIndex) vHighlight = 1.0;
#else
  vec4 placed = vec4(local, 1.0);
  vec3 placedNormal = n;
#endif
#ifdef VERTEX_COLORS
  vColor *= srgbToLinear(color);
#endif
  vec4 world = uModel * placed;
  vWorldPosition = world.xyz;
  vNormal = uNormalMatrix * placedNormal;
#ifdef REFRACTION
#ifdef INSTANCED
  vThicknessScale = length(mat3(uModel) * m[0]);
#else
  vThicknessScale = length(uModel[0].xyz);
#endif
#endif
  vUv = uv;
#ifdef UV2
  vUv2 = uv2;
#endif
#ifdef ANISOTROPY
  // a direction along the surface, so it turns as the model does
#ifdef INSTANCED
  vTangent = vec4(mat3(uModel) * (m * tangent.xyz), tangent.w);
#else
  vTangent = vec4(mat3(uModel) * tangent.xyz, tangent.w);
#endif
#endif
#ifdef TRIPLANAR
  vObjectPosition = local;
  vObjectNormal = n;
#ifdef INSTANCED
  vObjectToWorld = uNormalMatrix * instanceNormal;
#else
  vObjectToWorld = uNormalMatrix;
#endif
#endif
  gl_Position = uViewProjection * world;
#ifdef FOG
  vFogDepth = -(uView * world).z;
#endif
#ifdef PICK
  vPickElement = uint(gl_InstanceID);
#endif
}
`

// ---- The lights, a chunk a kind of light: its uniforms, and a loop over its group's array working
// out each light's direction (l) and the light arriving (radiance), which LIGHT_CONTRIBUTION adds to
// the surface (rect-area lights, RECT_LIGHTS, integrate over their shape instead). Light counts are
// compiled in (NUM_DIRECTIONAL, NUM_PUNCTUAL, NUM_RECT), so a simply lit scene
// runs only the loops it needs. A new kind of light is a chunk here, its uniforms packed by the
// renderer (LIGHT_ARRAYS, LIGHT_PACKING in WebGLRenderer.js) and its entry made by its class.

// light from all round - ambient and hemisphere, summed by the renderer - read by irradianceAt()
const ALL_ROUND_UNIFORMS = /* glsl */ `
uniform vec3 uAmbient;
uniform vec3 uHemisphereSky;
uniform vec3 uHemisphereGround;
`
const DIRECTIONAL_UNIFORMS = /* glsl */ `
#if NUM_DIRECTIONAL > 0
uniform vec3 uDirectionalDirection[NUM_DIRECTIONAL]; // towards the light
uniform vec3 uDirectionalColor[NUM_DIRECTIONAL];
#endif
`
const PUNCTUAL_UNIFORMS = /* glsl */ `
#if NUM_PUNCTUAL > 0
uniform vec3 uPunctualPosition[NUM_PUNCTUAL];
uniform vec3 uPunctualColor[NUM_PUNCTUAL];
uniform float uPunctualRange[NUM_PUNCTUAL];
uniform vec3 uPunctualDirection[NUM_PUNCTUAL];      // spot: the way the light travels
uniform vec2 uPunctualCone[NUM_PUNCTUAL];           // spot: cos(outer), cos(inner); point: (-2, -1)
#endif
`

// what one light adds to the surface, arriving from l with radiance: lit directly, on the coat and
// the sheen too
const LIGHT_CONTRIBUTION = /* glsl */ `
    color += shade(n, v, l, radiance, diffuse, f0, f90, a);
#ifdef CLEARCOAT
    coat += coatShade(surfaceNormal, v, l, radiance, coatA);
#endif
#ifdef SHEEN
    sheen += sheenShade(n, v, l, radiance, sheenRoughness * sheenRoughness);
#endif`

/**
 * A translucent surface lit from behind by the same light: `light` is what arrives at the far side,
 * worked out by the code given - shadowed as the far side is, as what lights it comes through.
 * @param {string} light GLSL declaring vec3 light
 */
export const throughLight = (light) => /* glsl */ `
#ifdef TRANSLUCENCY
    float behind = clamp(-dot(n, l), 0.0, 1.0);
    if (behind > 0.0) {
      ${light}
      color += through * light * behind;
    }
#endif`

// directional lights: parallel, from far away; the shadow-casting one always comes first
const DIRECTIONAL_LIGHTS = /* glsl */ `
#if NUM_DIRECTIONAL > 0
  for (int i = 0; i < NUM_DIRECTIONAL; i++) {
    vec3 l = uDirectionalDirection[i];
    vec3 radiance = uDirectionalColor[i];
#ifdef SHADOW
    if (i == 0) radiance *= sunShadow(surfaceNormal, l);
#ifdef CAUSTICS
    if (i == 0 && uCausticTile < 0.0) radiance += uDirectionalColor[i] * causticBent();
#endif
#endif
${LIGHT_CONTRIBUTION}
${throughLight(`vec3 light = uDirectionalColor[i];
#ifdef SHADOW
      if (i == 0) light *= sunShadow(-surfaceNormal, l);
#endif`)}
  }
#endif`

// point and spot lights: from a point, falling off with distance - a spot within its cone
const PUNCTUAL_LIGHTS = /* glsl */ `
#if NUM_PUNCTUAL > 0
  for (int i = 0; i < NUM_PUNCTUAL; i++) {
    vec3 toLight = uPunctualPosition[i] - vWorldPosition;
    float d = length(toLight);
    vec3 l = toLight / max(d, 1e-4);
    // inverse square, faded to zero at range (KHR_lights_punctual)
    float falloff = 1.0 / max(d * d, 1e-4);
    float range = uPunctualRange[i];
    if (range > 0.0) falloff *= pow(clamp(1.0 - pow(d / range, 4.0), 0.0, 1.0), 2.0);
    float cosAngle = dot(-l, uPunctualDirection[i]);
    float cone = smoothstep(uPunctualCone[i].x, uPunctualCone[i].y, cosAngle);
    vec3 radiance = uPunctualColor[i] * falloff * cone;
#ifdef SPOT_SHADOWS
    float tile = uPunctualShadow[i];
    if (tile >= 0.0 && cone > 0.0) radiance *= spotShadow(int(tile), surfaceNormal, d);
#ifdef CAUSTICS
    // bent light, its cone taken where it went through the glass - it lands inside the beam or not
    if (tile >= 0.0 && tile == uCausticTile) radiance += uPunctualColor[i] * falloff * causticBent();
#endif
#endif
#ifdef POINT_SHADOW
    if (float(i) == uPointShadowIndex) radiance *= pointShadowAt(uPunctualPosition[i], surfaceNormal, d);
#endif
${LIGHT_CONTRIBUTION}
${throughLight(`vec3 light = uPunctualColor[i] * falloff * cone;
#ifdef SPOT_SHADOWS
      if (tile >= 0.0 && cone > 0.0) light *= spotShadow(int(tile), -surfaceNormal, d);
#endif
#ifdef POINT_SHADOW
      if (float(i) == uPointShadowIndex) light *= pointShadowAt(uPunctualPosition[i], -surfaceNormal, d);
#endif`)}
  }
#endif`

// rect-area lights: glowing rectangles. Their light, and their reflection, integrated over the
// rectangle with linearly transformed cosines (Heitz, Dupuy, Hill and Neubelt 2016; after three.js's
// code): a cosine lobe, turned by a matrix looked up by roughness and view angle into the shape of
// the surface's highlight, has a form factor over a polygon that is exact - so a rough surface shows
// a soft glow, a polished one the light's own shape. The tables load with the first rect light.
const RECT_UNIFORMS = /* glsl */ `
#if NUM_RECT > 0
#pragma part rect-uniforms
#endif
`

// rect-area lights, after the punctual ones. Toon tones, cloth's sheen and light let through use
// the light as if it were a point light at its middle; the rest integrates over its shape.
const RECT_LIGHTS = /* glsl */ `
#if NUM_RECT > 0
#pragma part rect-lights
#endif`

const MESH_FRAGMENT = /* glsl */ `
precision highp float;
precision highp sampler2DShadow;
precision highp samplerCubeShadow;

in vec3 vWorldPosition;
in vec3 vNormal;
in vec2 vUv;
in vec3 vColor;
flat in float vHighlight;

uniform vec4 uHighlight;     // linear colour, and how far to move towards it
uniform vec3 uColor;         // linear
uniform float uOpacity;
uniform vec3 uEmissive;      // linear, intensity applied
#ifdef MAP
uniform sampler2D uMap;
#endif
#ifdef ALPHA_TEST
uniform float uAlphaTest;
#endif
#ifdef EMISSIVE_MAP
uniform sampler2D uEmissiveMap;
#endif
//@hook uniforms

${SAMPLING}
#ifdef LIT
uniform vec3 uCameraPosition;
uniform float uRoughness;
uniform float uMetalness;
#ifdef ROUGHNESS_MAP
uniform sampler2D uRoughnessMap;
#endif
#ifdef METALNESS_MAP
uniform sampler2D uMetalnessMap;
#endif
#ifdef NORMAL_MAP
uniform sampler2D uNormalMap;
uniform float uNormalScale;
#endif
#ifdef BUMP_MAP
uniform sampler2D uBumpMap;
uniform float uBumpScale;
#endif
#ifdef AO_MAP
uniform sampler2D uAoMap;
uniform float uAoMapIntensity;
#endif
#ifdef SSAO
// ambient occlusion worked out from the picture's depth, at half its size: each pixel's share of
// light from all round that reaches it (r), and - with float targets - the depth it was found at (g)
uniform sampler2D uSsao;
uniform vec2 uSsaoScale;     // gl_FragCoord to the occlusion's coordinates
uniform vec4 uSsaoViewZ;     // the view matrix's third row: a world position's depth in front of the camera
float screenOcclusion() {
  vec2 uv = gl_FragCoord.xy * uSsaoScale;
#ifdef SSAO_DEPTH
  // the four texels round this pixel, each counting less the further its depth is from this
  // pixel's own - so the shading of a surface behind doesn't bleed over an edge in front of it
  vec2 size = vec2(textureSize(uSsao, 0));
  vec2 p = uv * size - 0.5;
  ivec2 i0 = ivec2(floor(p));
  vec2 f = fract(p);
  float z = -dot(uSsaoViewZ, vec4(vWorldPosition, 1.0));
  float sum = 0.0, total = 0.0;
  for (int k = 0; k < 4; k++) {
    ivec2 o = ivec2(k & 1, k >> 1);
    vec2 t = texelFetch(uSsao, clamp(i0 + o, ivec2(0), ivec2(size) - 1), 0).rg;
    float w = (o.x == 1 ? f.x : 1.0 - f.x) * (o.y == 1 ? f.y : 1.0 - f.y) + 1e-3;
    w /= 1e-3 + abs(t.g - z) / max(z, 1e-4);
    sum += t.r * w;
    total += w;
  }
  return sum / total;
#else
  return texture(uSsao, uv).r;
#endif
}
#endif
#ifdef LIGHT_MAP
uniform sampler2D uLightMap;
uniform float uLightMapIntensity;
#endif
uniform float uEnvStrength;  // this material's share of the environment's light and reflections
#ifdef TRANSMISSION
uniform float uTransmission;
#endif
#ifdef REFRACTION
// what is behind see-through things: the picture so far, the opaque things drawn, smaller and
// blurrier down its mip levels - for glass to show bent, and frosted
uniform sampler2D uBehind;
uniform vec4 uRefraction;      // ior, thickness (its own units), dispersion's half spread of the ior, 1 for a thin wall
uniform float uSpectrum;       // how much of that spread this picture bends by: 1, or a refine sample's 0-2
uniform vec4 uAttenuation;     // the body's colour (linear) after a distance (w; 0: no tint)
uniform mat4 uViewProjection;
in float vThicknessScale;
#endif
#ifdef CLEARCOAT
uniform float uClearcoat;
uniform float uClearcoatRoughness;
#endif
#ifdef IRIDESCENCE
uniform vec4 uIridescence;     // amount, the film's ior, its thinnest and thickest in nanometres
#endif
#ifdef IRIDESCENCE_THICKNESS_MAP
uniform sampler2D uIridescenceThicknessMap;
#endif
uniform vec4 uSpecular;      // a non-metal's reflectance face on (from its ior), and at grazing angles
#ifdef MATCAP
uniform sampler2D uMatcap;
uniform mat4 uView;
#endif
#ifdef TOON
uniform float uToon;         // how many tones, 2 or more
#endif
#ifdef SHEEN
uniform vec3 uSheenColor;    // linear, sheen applied
uniform float uSheenRoughness;
#endif
#ifdef ANISOTROPY
uniform float uAnisotropy;
uniform vec2 uAnisotropyDirection; // cos, sin of the brushing's turn from the UVs' u
in vec4 vTangent;
#endif
#ifdef TRANSLUCENCY
uniform vec4 uTranslucency;  // the light let through: linear colour with the amount applied, and the amount
#endif

${ALL_ROUND_UNIFORMS}
#ifdef ENV_MAP
uniform sampler2D uEnvMap;   // equirectangular, prefiltered: each mip a step rougher
uniform float uEnvMaxLod;
uniform vec3 uEnvSH[9];      // irradiance as spherical harmonics, already divided by PI
#endif
#if defined(ENV_MAP) || defined(STUDIO)
uniform float uEnvIntensity; // the scene's environmentIntensity
#endif
${DIRECTIONAL_UNIFORMS}
${PUNCTUAL_UNIFORMS}
${RECT_UNIFORMS}

#ifdef SHADOW
uniform sampler2DShadow uShadowMap; // the first directional light's depth
#ifdef SHADOW_GLASS
uniform sampler2D uShadowGlass;      // what glass between it and a point lets through (rgb), the glass's depth (a)
#endif
uniform mat4 uShadowMatrix;         // world to shadow map [0, 1] coordinates and depth
uniform float uShadowTexel;         // 1 / map size
uniform float uShadowBias;          // world units to push the lookup out along the normal
#ifdef SHADOW_SOFT
uniform highp sampler2D uShadowDepth; // the same map read as depths, for soft shadows' blocker search
uniform vec3 uShadowSoft;          // how far the edge spreads a unit of gap, world units a unit of map depth, map coordinates a world unit
#endif
#endif
#ifdef SPOT_SHADOWS
uniform sampler2DShadow uSpotShadowMap;      // spot lights' depth, a tile each
#ifdef SPOT_SHADOWS_GLASS
uniform sampler2D uSpotShadowGlass;          // their glass layers, tiled the same
#endif
uniform mat4 uSpotShadowMatrix[4];           // world to a tile's coordinates and depth
uniform vec4 uSpotShadowTile[4];             // each tile's bounds in the map: x0, y0, x1, y1
uniform float uSpotShadowBias[4];            // world units a unit of distance, to push the lookup out along the normal
uniform float uSpotShadowTexel;              // 1 / map size
#if NUM_PUNCTUAL > 0
uniform float uPunctualShadow[NUM_PUNCTUAL]; // which tile a point or spot light's shadow is in, or -1
#endif
#ifdef SPOT_SHADOWS_SOFT
uniform highp sampler2D uSpotShadowDepth;    // the same map read as depths
uniform vec4 uSpotShadowSoft[4];             // each tile's edge spread a unit of gap (0 for plain; minus a rect light's longer semi-axis), near, far, map coordinates a world unit at distance 1
uniform vec4 uSpotShadowShape[4];            // its soft edge's shape on the map: the light's width that way (x, y), width and height over the longer (z, w)
#endif
#endif
#ifdef CAUSTICS
uniform sampler2D uCaustics;        // the caustic light bent by glass, gathered where it lands (rgb, unbent light 1)
uniform sampler2D uCausticLanding;  // where it landed: its distance from the light times how much, and how much
uniform sampler2D uCausticCover;    // thick glass from the light: how much is there, and its distance from the light times that
uniform mat4 uCausticMatrix;        // world to the caustics' [0, 1] coordinates
uniform float uCausticTile;         // whose light: -1 the sun's, else the spot shadow tile it shares
uniform vec4 uCausticFrom;          // the light's position, w 1 (spot, rect); w 0 for the sun
uniform vec3 uCausticDirection;     // the sun's way
uniform float uCausticTolerance;    // how near, along the light, bent light must have landed to count here
#endif
#ifdef POINT_SHADOW
uniform samplerCubeShadow uPointShadowMap; // a point light's depth all round it, a cube face each way
uniform float uPointShadowIndex;           // which punctual light it is
uniform vec2 uPointShadowNearFar;          // its faces' near and far planes
uniform float uPointShadowTexel;           // a texel's size at a distance of 1
uniform float uPointShadowBias;            // world units a unit of distance, to push the lookup out along the normal
#ifdef POINT_SHADOW_SOFT
uniform highp samplerCube uPointShadowDepth; // the same cube read as depths
uniform float uPointShadowSoft;            // how far the edge spreads a unit of gap
#endif
#endif
#endif

out vec4 fragColor;

${COMMON}
${CLIP}
${FOG}
${TONE_MAP}

#ifdef LIT
const float PI = 3.14159265359;

float D_GGX(float NoH, float a) {
  float a2 = a * a;
  float f = (NoH * a2 - NoH) * NoH + 1.0;
  return a2 / (PI * f * f);
}

float V_SmithGGXCorrelated(float NoV, float NoL, float a) {
  float a2 = a * a;
  float gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2);
  float gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
  return 0.5 / max(gv + gl, 1e-5);
}

vec3 F_Schlick(float VoH, vec3 f0, float f90) {
  return f0 + (f90 - f0) * pow(1.0 - VoH, 5.0);
}

#ifdef IRIDESCENCE
#pragma part iridescence
#endif

#ifdef ANISOTROPY
#pragma part anisotropy
#endif

// Light intensity 1 on a white surface facing it gives white: the Lambert term isn't divided by
// PI, so the specular term is multiplied by it to keep the balance. (glTF intensities in lux and
// candela are divided by PI when loaded.)
#ifdef TOON
#pragma part toon
#endif

vec3 shade(vec3 n, vec3 v, vec3 l, vec3 radiance, vec3 diffuse, vec3 f0, float f90, float a) {
#ifdef TOON
  return toonShade(n, v, l, radiance, diffuse, a);
#endif
  float NoL = clamp(dot(n, l), 0.0, 1.0);
  if (NoL <= 0.0) return vec3(0.0);
  vec3 h = normalize(l + v);
  float NoV = clamp(abs(dot(n, v)), 1e-4, 1.0);
  float NoH = clamp(dot(n, h), 0.0, 1.0);
  float VoH = clamp(dot(v, h), 0.0, 1.0);
  vec3 F = F_Schlick(VoH, f0, f90);
#ifdef ANISOTROPY
  vec3 specular = anisotropicDV(v, l, h, NoV, NoL, NoH) * F * PI;
#else
  vec3 specular = D_GGX(NoH, a) * V_SmithGGXCorrelated(NoV, NoL, a) * F * PI;
#endif
  return (diffuse * (1.0 - F) + specular) * radiance * NoL;
}

#ifdef SHEEN
#pragma part sheen
#endif

#ifdef CLEARCOAT
#pragma part clearcoat
#endif

// The built-in 'studio' environment: a soft, bright overhead box over a darker floor, as a
// function of direction - no texture needed.
vec3 studio(vec3 d) {
  float up = d.y * 0.5 + 0.5;
  vec3 sky = mix(vec3(0.35, 0.36, 0.38), vec3(1.0), smoothstep(0.55, 0.95, up));
  vec3 floorColor = vec3(0.18, 0.17, 0.16);
  return mix(floorColor, sky, smoothstep(0.35, 0.55, up));
}

// the split-sum environment BRDF: how much of the light from all round a surface reflects once, as
// a scale on f0 and a bias on f90 (fitted to the integral - dfg.js; Karis' approximation fell 10 - 40%
// short at mid roughness and over-read rough surfaces seen head on)
${ENV_DFG}
vec3 envBRDF(vec3 f0, float f90, float roughness, float NoV) {
  vec2 dfg = envDFG(roughness, NoV);
  return f0 * dfg.x + f90 * dfg.y;
}
// What a rough surface reflects more than once: light a microfacet sends into its neighbour, lost
// to a single bounce, comes out after more (Fdez-Aguera, "A Multiple-Scattering Microfacet Model for
// Real-Time Image-based Lighting"). Without it a rough metal is too dark - a quarter at roughness 0.8.
// single: what reflects once (envBRDF); dfg: its two terms. What it adds, for light from all round.
vec3 multiScatter(vec3 single, vec2 dfg, vec3 f0) {
  float lost = 1.0 - dfg.x - dfg.y;
  vec3 average = f0 + (1.0 - f0) * 0.047619;
  return single * average / (1.0 - lost * average) * lost;
}

#ifdef ENV_MAP
${EQUIRECT}
vec3 envIrradiance(vec3 n) {
  return uEnvSH[0]
    + uEnvSH[1] * n.y + uEnvSH[2] * n.z + uEnvSH[3] * n.x
    + uEnvSH[4] * n.x * n.y + uEnvSH[5] * n.y * n.z + uEnvSH[6] * (3.0 * n.z * n.z - 1.0)
    + uEnvSH[7] * n.x * n.z + uEnvSH[8] * (n.x * n.x - n.y * n.y);
}
#endif

#ifdef BUMP_MAP
// A height map as bumps: the normal tilted by how the height changes across the pixel, from
// screen-space derivatives (Mikkelsen) - no tangents, and it works with UVs or triplanar alike
vec3 bumpNormal(vec3 n) {
  float h = uBumpMapTexel.r * uBumpScale;
  vec2 dh = vec2(dFdx(h), dFdy(h));
  vec3 sx = dFdx(vWorldPosition), sy = dFdy(vWorldPosition);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1);
  vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2);
  return normalize(abs(det) * n - grad);
}
#endif

#if defined(NORMAL_MAP) && defined(TRIPLANAR)
// A normal map from the three axes: each projection's bump laid round the surface normal (a
// 'whiteout' blend), blended, then turned into the world - no tangents and no UVs needed
vec3 triplanarNormal(float strength) {
  vec3 n = normalize(vObjectNormal), p = vObjectPosition * uTriplanar, w = triplanarWeights(n);
  vec3 tx = texture(uNormalMap, projected(p.zy, uNormalMapUv)).xyz * 2.0 - 1.0;
  vec3 ty = texture(uNormalMap, projected(p.xz, uNormalMapUv)).xyz * 2.0 - 1.0;
  vec3 tz = texture(uNormalMap, projected(p.xy, uNormalMapUv)).xyz * 2.0 - 1.0;
  tx.xy *= strength; ty.xy *= strength; tz.xy *= strength;
  tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
  ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
  tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
  return normalize(vObjectToWorld * normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z));
}
#endif

#ifdef ANISOTROPY
// The brushing's direction: the vertices' tangents (along the UVs' u), smooth across the mesh,
// laid onto the shading normal and turned by the rotation
vec3 brushDirection(vec3 n) {
  vec3 t = vTangent.xyz - n * dot(n, vTangent.xyz);
  float len = length(t);
  t = len > 1e-6 ? t / len : normalize(cross(abs(n.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), n));
  return t * uAnisotropyDirection.x + cross(n, t) * (vTangent.w < 0.0 ? -1.0 : 1.0) * uAnisotropyDirection.y;
}
#endif

#ifdef NORMAL_MAP
// Tangent space from screen-space derivatives (Schüler's cotangent frame), so geometry needs no
// tangents. UVs run down the image (glTF) while normal maps point +Y up it, hence -b.
vec3 perturbNormal(vec3 n, vec3 m, vec2 uv) {
  vec3 dp1 = dFdx(vWorldPosition), dp2 = dFdy(vWorldPosition);
  vec2 duv1 = dFdx(uv), duv2 = dFdy(uv);
  vec3 dp2perp = cross(dp2, n), dp1perp = cross(n, dp1);
  vec3 t = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 b = dp2perp * duv1.y + dp1perp * duv2.y;
  float scale = inversesqrt(max(max(dot(t, t), dot(b, b)), 1e-20));
  return normalize(mat3(t * scale, -b * scale, n) * m);
}
#endif

#if defined(SHADOW_SOFT) || defined(SPOT_SHADOWS_SOFT) || defined(POINT_SHADOW_SOFT)
#pragma part shadow-soft
#endif

#ifdef SHADOW
#pragma part shadow
#endif
#ifdef SPOT_SHADOWS
#pragma part spot-shadows
#endif
#ifdef POINT_SHADOW
#pragma part point-shadow
#endif

#if defined(SHADOW_GLASS) || defined(SPOT_SHADOWS_GLASS)
// coloured shadows: what a shadow map's glass layer lets through to a point - its colour where the
// glass is nearer the light than the point is, all of it elsewhere. c: the point in the map's
// coordinates and depth; tile: the part of the map that is its light's
vec3 glassLayer(sampler2D layer, vec3 c, vec4 tile) {
  if (c.x <= tile.x || c.x >= tile.z || c.y <= tile.y || c.y >= tile.w || c.z >= 1.0) return vec3(1.0);
  vec4 glass = textureLod(layer, c.xy, 0.0);
  // (a step of the layer's depth over, for an 8-bit one; read at its own level, as this is often
  // reached in a branch)
  return c.z > glass.a + 0.004 ? glass.rgb : vec3(1.0);
}
#endif
#ifdef CAUSTICS
// caustics: the caustic light split in two - what comes straight here without going through thick
// glass, and what glass bends here, wherever it came through. Light that goes through glass leaves
// the straight path (causticStraight), and lands where the glass sends it (causticBent): in a
// lens's shadow, gathered into a bright spot; past a prism, in a rainbow, lit by the light or not
vec2 causticUv() {
  vec4 c = uCausticMatrix * vec4(vWorldPosition, 1.0);
  return c.w > 0.0 ? c.xy / c.w : vec2(-1.0);
}
float causticAlong() {
  return uCausticFrom.w > 0.5 ? length(vWorldPosition - uCausticFrom.xyz) : dot(vWorldPosition, uCausticDirection);
}
bool causticInside(vec2 p) {
  return p.x > 0.0 && p.y > 0.0 && p.x < 1.0 && p.y < 1.0;
}
// the straight light's share: less where thick glass stands between here and the light
float causticStraight() {
  vec2 p = causticUv();
  if (!causticInside(p)) return 1.0;
  vec2 cover = textureLod(uCausticCover, p, 0.0).xy;
  if (cover.x < 1e-3) return 1.0;
  return cover.y / cover.x < causticAlong() - uCausticTolerance * 0.25 ? 1.0 - min(cover.x, 1.0) : 1.0;
}
// the bent light that landed here - at this distance from the light, give or take the tolerance
vec3 causticBent() {
  vec2 p = causticUv();
  if (!causticInside(p)) return vec3(0.0);
  vec2 landed = textureLod(uCausticLanding, p, 0.0).xy;
  if (landed.y < 1e-4) return vec3(0.0);
  float off = abs(landed.x / landed.y - causticAlong());
  return textureLod(uCaustics, p, 0.0).rgb * (1.0 - smoothstep(uCausticTolerance, 2.0 * uCausticTolerance, off));
}
#endif
#ifdef SHADOW
// the shadow-casting directional light's share that reaches here, coloured by any glass it came
// through - for the caustic light, only what didn't go through thick glass (that is bent, and added)
vec3 sunShadow(vec3 n, vec3 l) {
  vec3 lit = vec3(shadowAt(n, l));
#ifdef SHADOW_GLASS
  vec4 s = uShadowMatrix * vec4(vWorldPosition + n * uShadowBias, 1.0);
  lit *= glassLayer(uShadowGlass, s.xyz / s.w, vec4(0.0, 0.0, 1.0, 1.0));
#endif
#ifdef CAUSTICS
  if (uCausticTile < 0.0) lit *= causticStraight();
#endif
  return lit;
}
#endif
#ifdef SPOT_SHADOWS
// a spot or rect light's share that reaches here, coloured by any glass it came through - for the
// caustic light, only what didn't go through thick glass (that is bent, and added)
vec3 spotShadow(int k, vec3 n, float distance) {
  vec3 lit = vec3(spotShadowAt(k, n, distance));
#ifdef SPOT_SHADOWS_GLASS
  vec4 s = uSpotShadowMatrix[k] * vec4(vWorldPosition + n * uSpotShadowBias[k] * distance, 1.0);
  if (s.w > 0.0) lit *= glassLayer(uSpotShadowGlass, s.xyz / s.w, uSpotShadowTile[k]);
#endif
#ifdef CAUSTICS
  if (float(k) == uCausticTile) lit *= causticStraight();
#endif
  return lit;
}
#endif

#ifdef DEBUG_SHADOW_TEXELS
#pragma part shadow-texels
#endif

#ifdef MATCAP
// A matcap - a picture of a lit sphere - looked up by the normal as the camera sees it, turned to
// face along the line of sight so it doesn't stretch towards the edges of the view
vec3 matcapAt(vec3 n, vec3 v) {
  vec3 nv = normalize(mat3(uView) * n), vv = normalize(mat3(uView) * v);
  vec3 x = normalize(vec3(vv.z, 0.0, -vv.x));
  vec3 y = cross(vv, x);
  vec2 uv = vec2(dot(x, nv), dot(y, nv)) * 0.495 + 0.5;
  // the picture's top is up
  return texture(uMatcap, vec2(uv.x, 1.0 - uv.y)).rgb;
}
#endif

// light arriving from all round, on a surface facing n: flat, hemisphere and environment light
vec3 irradianceAt(vec3 n) {
  vec3 e = uAmbient + mix(uHemisphereGround, uHemisphereSky, n.y * 0.5 + 0.5);
#ifdef ENV_MAP
  e += envIrradiance(n) * uEnvIntensity * uEnvStrength;
#elif defined(STUDIO)
  e += studio(n) * 0.35 * uEnvIntensity * uEnvStrength;
#endif
  return e;
}

// what a surface reflects of its surroundings along r - blurrier the rougher it is
vec3 reflected(vec3 r, vec3 n, float roughness, vec3 irradiance) {
#ifdef ENV_MAP
  // a lower mip, convolved for that roughness
  return textureLod(uEnvMap, equirectUv(r), roughness * uEnvMaxLod).rgb * uEnvIntensity * uEnvStrength;
#elif defined(STUDIO)
  // leaned towards the surface normal
  return mix(studio(r), studio(n), roughness * roughness) * uEnvIntensity * uEnvStrength;
#else
  return irradiance * 0.5;
#endif
}
#endif

#ifdef REFRACTION
#pragma part refraction
#endif

void main() {
  clipAway(vWorldPosition);
  vec4 base = vec4(uColor * vColor, uOpacity);
#ifdef MAP
  base *= uMapTexel; // sRGB textures are decoded to linear by the hardware
#endif
  vec3 emissive = uEmissive;
#ifdef EMISSIVE_MAP
  emissive *= uEmissiveMapTexel.rgb;
#endif
#ifdef HOOK_FRAGMENT
  // the shading normal in world space, facing the viewer - a fragment hook can bend it, for relief
  // lit per pixel (bumps from noise) whatever the mesh's resolution
#ifdef FLAT_SHADING
  vec3 normal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
#else
  vec3 normal = normalize(vNormal);
#ifdef DOUBLE_SIDED
  if (!gl_FrontFacing) normal = -normal;
#endif
#endif
  {
//@hook fragment
  }
#endif
#ifdef ALPHA_TEST
  if (base.a < uAlphaTest) discard;
  base.a = 1.0;
#endif
  // how much of what is behind it this hides: its opacity - less for glass, which lets light through
  float coverage = base.a;
#ifdef REFRACTION
  // what glass shows through it, bent - laid over it at the end
  vec4 behind = vec4(0.0);
  vec3 glassTint = vec3(1.0);
#endif

#ifdef LIT
#ifdef HOOK_FRAGMENT
  // the fragment hook's normal, facing the viewer already
  vec3 n = normalize(normal);
#elif defined(FLAT_SHADING)
  // from the screen-space slope: it faces the camera whichever side of the face is seen
  vec3 n = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
#else
  vec3 n = normalize(vNormal);
#endif
#if defined(DOUBLE_SIDED) && !defined(FLAT_SHADING) && !defined(HOOK_FRAGMENT)
  if (!gl_FrontFacing) n = -n;
#endif
  vec3 surfaceNormal = n;
#ifdef NORMAL_MAP
#ifdef TRIPLANAR
  n = triplanarNormal(uNormalScale);
#ifdef DOUBLE_SIDED
  if (!gl_FrontFacing) n = -n;
#endif
#else
  // tangent space from the map's own UVs, so it turns with a rotated map
  vec2 normalUv = uNormalMapCoord;
  vec3 m = texture(uNormalMap, normalUv).xyz * 2.0 - 1.0;
  m.xy *= uNormalScale;
  n = perturbNormal(n, m, normalUv);
#endif
#endif
#ifdef BUMP_MAP
  n = bumpNormal(n);
#endif
  vec3 v = normalize(uCameraPosition - vWorldPosition);
#ifdef MATCAP
  // its look from the picture, by the normal: no lights, and its colours kept as they are, as unlit ones are
  vec3 color = base.rgb * matcapAt(n, v) + emissive;
#else
  float roughness = uRoughness;
  float metalness = uMetalness;
#ifdef ROUGHNESS_MAP
  roughness *= uRoughnessMapTexel.g;
#endif
#ifdef METALNESS_MAP
  metalness *= uMetalnessMapTexel.b;
#endif
  roughness = clamp(roughness, 0.04, 1.0);
  float a = roughness * roughness;
  vec3 diffuse = base.rgb * (1.0 - metalness);
  vec3 f0 = mix(uSpecular.rgb, base.rgb, metalness);
  float f90 = mix(uSpecular.a, 1.0, metalness);
#ifdef TOON
  // a cartoon's metal is its colour too, with a highlight of that colour
  diffuse = base.rgb;
  toonHighlight = mix(vec3(uSpecular.a), base.rgb, metalness) * (1.0 - roughness);
#endif
#ifdef IRIDESCENCE
  {
    // a thin film over the surface: its reflectance at this angle, as an f0 the lights and the
    // environment use as they would the surface's own
    float filmNoV = clamp(abs(dot(n, v)), 1e-4, 1.0);
#ifdef IRIDESCENCE_THICKNESS_MAP
    float thickness = mix(uIridescence.z, uIridescence.w, uIridescenceThicknessMapTexel.g);
#else
    float thickness = uIridescence.w;
#endif
    vec3 film = filmFresnel(uIridescence.y, filmNoV, thickness, f0);
    f0 = mix(f0, filmF0(film, f90, filmNoV), uIridescence.x);
  }
#endif
#ifdef TRANSMISSION
  // glass: what passes through isn't scattered back, so less diffuse colour - and the reflections
  // stay whole, however clear it is
  diffuse *= 1.0 - uTransmission;
#endif
#ifdef CLEARCOAT
  float coatRoughness = clamp(uClearcoatRoughness, 0.04, 1.0);
  float coatA = coatRoughness * coatRoughness;
  vec3 coat = vec3(0.0);
#endif
#ifdef SHEEN
  float sheenRoughness = clamp(uSheenRoughness, 0.07, 1.0);
  vec3 sheen = vec3(0.0);
#endif
#ifdef ANISOTROPY
  brushT = brushDirection(n);
  brushB = cross(n, brushT);
  brushAT = mix(a, 1.0, uAnisotropy * uAnisotropy);
  brushAB = max(a, 0.001);
#endif
#ifdef TRANSLUCENCY
  // thin surfaces: what isn't scattered back comes through, lit from the far side
  vec3 through = diffuse * uTranslucency.rgb;
  diffuse *= 1.0 - uTranslucency.a;
#endif

  vec3 color = vec3(0.0);
${DIRECTIONAL_LIGHTS}
${PUNCTUAL_LIGHTS}
${RECT_LIGHTS}

  // ambient: flat, hemisphere and environment light
  vec3 irradiance = irradianceAt(n);
  float NoV = clamp(abs(dot(n, v)), 1e-4, 1.0);
  vec2 dfg = envDFG(roughness, NoV);
  vec3 brdf = f0 * dfg.x + f90 * dfg.y;
  // the light from all round reflected more than once, and - as a direct light's (1 - F) - what the
  // dielectric layer reflects, taken off what reaches the diffuse under it
  vec3 scattered = multiScatter(brdf, dfg, f0);
  vec3 coated = uSpecular.rgb * dfg.x + uSpecular.a * dfg.y;
  coated += multiScatter(coated, dfg, uSpecular.rgb);
#ifdef ANISOTROPY
  // reflections drawn out along the brushing: off a normal bent across it (KHR_materials_anisotropy)
  vec3 brushNormal = cross(cross(brushB, v), brushB);
  float bend = 1.0 - uAnisotropy * (1.0 - roughness);
  bend *= bend;
  vec3 r = reflect(-v, normalize(mix(brushNormal, n, bend * bend)));
#else
  vec3 r = reflect(-v, n);
#endif
#ifdef TOON
  // a flat fill, so the tones stay flat: the light from all round, averaged over up and down
  vec3 indirect = diffuse * 0.5 * (irradianceAt(vec3(0.0, 1.0, 0.0)) + irradianceAt(vec3(0.0, -1.0, 0.0)));
#else
  vec3 ambientSpecular = reflected(r, n, roughness, irradiance) * brdf + scattered * irradiance;
  vec3 indirect = diffuse * (1.0 - coated) * irradiance + ambientSpecular;
#endif
#ifdef TRANSLUCENCY
  indirect += through * irradianceAt(-n);
#endif
#ifdef LIGHT_MAP
  // light baked into a texture, as more light from all round
  indirect += diffuse * uLightMapTexel.rgb * uLightMapIntensity;
#endif
#ifdef AO_MAP
  indirect *= mix(1.0, uAoMapTexel.r, uAoMapIntensity);
#endif
#ifdef SSAO
  indirect *= screenOcclusion();
#endif
  color += indirect + emissive;
#ifdef SHEEN
  // over the base, which loses a little of its light to it
  sheen += irradiance * uSheenColor * sheenEnvironment(NoV, sheenRoughness);
  color = color * (1.0 - 0.157 * max(uSheenColor.r, max(uSheenColor.g, uSheenColor.b))) + sheen;
#endif
#ifdef CLEARCOAT
  // the coat's reflection, over the base - which loses the light the coat reflects away
  float coatNoV = clamp(abs(dot(surfaceNormal, v)), 1e-4, 1.0);
  coat += reflected(reflect(-v, surfaceNormal), surfaceNormal, coatRoughness, irradiance) * envBRDF(vec3(0.04), 1.0, coatRoughness, coatNoV);
  color = color * (1.0 - uClearcoat * F_Schlick(coatNoV, vec3(0.04), 1.0).x) + coat * uClearcoat;
#endif
#ifdef TRANSMISSION
  // most of what is behind glass shows through face on; towards its edges, where it reflects nearly
  // everything (Fresnel), less and less
  coverage *= mix(1.0, clamp(max(brdf.r, max(brdf.g, brdf.b)), 0.0, 1.0), uTransmission);
#endif
#ifdef REFRACTION
  behind = behindGlass(n, v, roughness);
  glassTint = base.rgb * bodyTint(n, v);
#endif
#ifdef DEBUG_SHADOW_TEXELS
  color = shadowTexels(color);
#endif
#if defined(FOG) && !defined(FOG_ADD) && !defined(FOG_MULTIPLY)
  // fogged in light, before the tone map, as mist dims light: what is bright - a lamp, an emissive
  // panel - shines on through it, and bloom still finds it bright. Far off it meets the fog's colour
  // exactly, uFogLight being what tone maps to it. The colour clear of fog goes on to the lit hook and
  // the highlight; what they change fades into the fog afterwards, as it always has
  float fogF = fogAmount();
  vec3 inFog = toneMap(mix(color, uFogLight, fogF));
  color = toneMap(color);
  vec3 clearOfFog = color;
#define FOG_IN_LIGHT
#else
  color = toneMap(color);
#endif
#endif
#else
  vec3 color = base.rgb + emissive;
#endif
#ifdef HOOK_LIT
  {
    // a fade here fades what it hides too
    float before = max(base.a, 1e-5);
//@hook lit
    coverage *= clamp(base.a / before, 0.0, 1.0);
  }
#endif
  color = mix(color, uHighlight.rgb, vHighlight * uHighlight.a);
  // a highlight shows on glass as on anything else
  coverage = mix(coverage, base.a, vHighlight * uHighlight.a);
#ifdef FOG_IN_LIGHT
  color = inFog + (color - clearOfFog) * (1.0 - fogF);
#else
  color = fogged(color);
#endif

  // premultiplied alpha, so the canvas composites correctly over the page. The colour is the light
  // the surface sends back - faded with its opacity; coverage is how much of what is behind it hides
  fragColor = outputColor(color, base.a, coverage);
#ifdef REFRACTION
  // glass lays what is behind it over itself, as blending would - but bent - and covers what is
  // there: where the picture behind is see-through (no background), the page shows through as before
  float glassShows = 1.0 - coverage;
  fragColor = vec4(fragColor.rgb + throughGlass(behind, glassTint) * glassShows, coverage + behind.a * glassShows);
#endif
}
`

export const POINTS_VERTEX = /* glsl */ `
layout(location = 0) in vec3 position;
layout(location = 3) in vec3 color;
#ifdef SPRITES
// each point a square: one instance a point, drawn as a strip over the corners (along 0-1, across -1-1)
layout(location = 4) in vec2 corner;
layout(location = 11) in float pointSize;
layout(location = 12) in float pointOpacity;
layout(location = 13) in float pointAngle;
layout(location = 14) in float pointIndex;
uniform vec2 uResolution;   // drawing buffer size in pixels
out vec2 vUv;
out float vOpacity;
#endif

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;
uniform float uSize;        // pixels (with the pixel ratio applied), or world units when attenuated
uniform float uScale;       // projection focal term x half the buffer height: world size -> pixels at depth 1
uniform int uHighlightIndex; // -2 none, -1 every point, otherwise the point
//@hook uniforms

out vec3 vColor;
flat out float vHighlight;
#ifdef HOOK_FRAGMENT
flat out float vPointIndex;
#endif
#ifdef PICK
flat out uint vPickElement; // which instance, point or segment, for GPU picking
#endif
#ifdef FOG
out float vFogDepth;
#endif

${COMMON}

void main() {
  // the point in the geometry's own space, and its size as a multiple of the material's - where a
  // shader hook changes them
  vec3 local = position;
#ifdef SPRITES
  int self = int(pointIndex + 0.5);
  float size = pointSize;
#else
  int self = gl_VertexID;
  float size = 1.0;
#endif
#ifdef HOOK_VERTEX
  {
    int index = self;
//@hook vertex
  }
#endif
#ifdef HOOK_FRAGMENT
  vPointIndex = float(self);
#endif
  vec4 viewPosition = uView * (uModel * vec4(local, 1.0));
#ifdef SPRITES
  // the square's corner, turned by the point's angle: the texture turns with it
  vec2 c = vec2(corner.x * 2.0 - 1.0, corner.y);
  float s = sin(pointAngle), k = cos(pointAngle);
  vec2 turned = vec2(c.x * k - c.y * s, c.x * s + c.y * k);
  float across = uSize * size;
#ifdef SIZE_ATTENUATION
  // world units: the square sits in the view, facing the camera
  viewPosition.xy += turned * across * 0.5;
  gl_Position = uProjection * viewPosition;
#else
  // pixels: the square is laid out on the screen
  gl_Position = uProjection * viewPosition;
  gl_Position.xy += turned * across / uResolution * gl_Position.w;
#endif
  // the image upright on the square, its top at the top, as a point's is
  vUv = vec2(c.x * 0.5 + 0.5, 0.5 - c.y * 0.5);
  vOpacity = pointOpacity;
#else
  gl_Position = uProjection * viewPosition;
#endif
#ifdef FOG
  vFogDepth = -viewPosition.z;
#endif
#ifdef SPRITES
#elif defined(SIZE_ATTENUATION)
  // perspective shrinks with distance; an orthographic projection (w row 0, 0, 0, 1) doesn't
  float depth = uProjection[3][3] == 1.0 ? 1.0 : max(-viewPosition.z, 1e-4);
  gl_PointSize = uSize * size * uScale / depth;
#else
  gl_PointSize = uSize * size;
#endif
  vColor = vec3(1.0);
#ifdef VERTEX_COLORS
  vColor = srgbToLinear(color);
#endif
  vHighlight = uHighlightIndex == -1 || self == uHighlightIndex ? 1.0 : 0.0;
#ifdef PICK
  vPickElement = uint(self);
#endif
}
`

const POINTS_FRAGMENT = /* glsl */ `
precision highp float;
in vec3 vColor;
flat in float vHighlight;
#ifdef SPRITES
in vec2 vUv;
in float vOpacity;
#endif
uniform vec4 uHighlight;
uniform vec3 uColor;
uniform float uOpacity;
#ifdef MAP
uniform sampler2D uMap;
#endif
#ifdef HOOK_FRAGMENT
flat in float vPointIndex;
#endif
//@hook uniforms
out vec4 fragColor;

${COMMON}
${FOG}

void main() {
#ifdef SPRITES
  vec2 at = vUv;
  vec4 base = vec4(uColor * vColor, uOpacity * vOpacity);
#else
  vec2 at = gl_PointCoord;
  vec4 base = vec4(uColor * vColor, uOpacity);
#endif
#ifdef MAP
  base *= texture(uMap, at);
#else
  // round points with a one pixel soft edge
  vec2 p = at * 2.0 - 1.0;
  float r = dot(p, p);
  float edge = fwidth(r);
  base.a *= 1.0 - smoothstep(1.0 - edge, 1.0, r);
#endif
#ifdef HOOK_FRAGMENT
  {
    vec2 pointUv = at;
    int index = int(vPointIndex + 0.5);
//@hook fragment
  }
#endif
  if (base.a <= 0.0) discard;
  vec3 color = fogged(mix(base.rgb, uHighlight.rgb, vHighlight * uHighlight.a));
#ifdef HOOK_LIT
  {
//@hook lit
  }
#endif
  fragColor = outputColor(color, base.a, base.a);
}
`

export const LINES_VERTEX = /* glsl */ `
layout(location = 0) in vec3 segmentStart;
layout(location = 1) in vec3 segmentEnd;
layout(location = 2) in vec3 segmentColorStart;
layout(location = 3) in vec3 segmentColorEnd;
// the distance along its chain (segments joined end to start) where it starts, in the model's
// units; 1 if it starts a chain; 1 if it ends one
layout(location = 5) in vec3 segmentInfo;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;
uniform vec2 uResolution;   // drawing buffer size in pixels
uniform float uWidth;       // pixels, already scaled by the pixel ratio
uniform float uNear;
uniform int uArrows;        // arrowheads: 1 at the start of each chain, 2 at its end, 3 at both
uniform float uArrowSize;   // their length in pixels, scaled by the pixel ratio
//@hook uniforms

// six vertices an instance make the segment's quad, as two triangles - x: 0 at its start, 1 at its
// end; y: -1 or 1 across - and six more its two arrowheads, drawn only when asked for
const vec2 QUAD[6] = vec2[6](vec2(0.0, -1.0), vec2(0.0, 1.0), vec2(1.0, -1.0), vec2(1.0, -1.0), vec2(0.0, 1.0), vec2(1.0, 1.0));

out vec3 vColor;
#if defined(DASHED) || defined(HOOK_FRAGMENT)
out float vDistance;        // along the chain, in the model's units
#endif
#ifdef HOOK_FRAGMENT
flat out float vSegment;    // which segment, for a fragment hook's index
#endif
#ifdef DASHED
flat out float vArrow;      // 1 on an arrowhead, which is never dashed
#endif
#ifdef PICK
flat out uint vPickElement; // which instance, point or segment, for GPU picking
#endif
#ifdef FOG
out float vFogDepth;
#endif

${COMMON}

#ifdef HOOK_VERTEX
// a shader hook moves each end of each segment: local is the end, along 0 at the start and 1 at the end
vec3 hookVertex(vec3 local, float along, int index) {
//@hook vertex
  return local;
}
#endif

void main() {
  vec3 start = segmentStart, end = segmentEnd;
#ifdef HOOK_VERTEX
  start = hookVertex(segmentStart, 0.0, gl_InstanceID);
  end = hookVertex(segmentEnd, 1.0, gl_InstanceID);
#endif
  vec4 a = uView * (uModel * vec4(start, 1.0));
  vec4 b = uView * (uModel * vec4(end, 1.0));
  // clip the segment to the near plane so lines passing behind the camera stay correct
  float clipZ = -uNear;
  if (a.z > clipZ && b.z > clipZ) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // wholly behind: off screen
    return;
  }
  if (a.z > clipZ) a = mix(a, b, (clipZ - a.z) / (b.z - a.z));
  if (b.z > clipZ) b = mix(b, a, (clipZ - b.z) / (a.z - b.z));

  vec4 ca = uProjection * a;
  vec4 cb = uProjection * b;
  vec2 sa = ca.xy / ca.w * uResolution * 0.5;
  vec2 sb = cb.xy / cb.w * uResolution * 0.5;
  vec2 dir = sb - sa;
  float len = length(dir);
  dir = len > 0.0 ? dir / len : vec2(1.0, 0.0);
  vec2 normal = vec2(-dir.y, dir.x);

  bool arrowStart = (uArrows & 1) != 0 && segmentInfo.y > 0.5;
  bool arrowEnd = (uArrows & 2) != 0 && segmentInfo.z > 0.5;
  float along, arrow = 0.0;
  vec2 offset;
  if (gl_VertexID < 6) {
    vec2 c = QUAD[gl_VertexID];
    along = c.x;
    // past each end by half the width so joins look continuous - or short of it, under an arrowhead
    float startOut = arrowStart ? -uArrowSize * 0.8 : uWidth * 0.5;
    float endOut = arrowEnd ? -uArrowSize * 0.8 : uWidth * 0.5;
    offset = normal * c.y * uWidth * 0.5 + dir * (along > 0.5 ? endOut : -startOut);
  } else {
    // an arrowhead: its tip on the chain's end, pointing out along the segment
    int which = (gl_VertexID - 6) / 3, k = gl_VertexID - 6 - which * 3;
    if (which == 0 ? !arrowStart : !arrowEnd) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    along = float(which);
    vec2 d = which == 1 ? dir : -dir;
    float wing = uArrowSize * 0.45;
    offset = k == 0 ? vec2(0.0) : -d * uArrowSize + normal * (k == 1 ? wing : -wing);
    arrow = 1.0;
  }

  vec4 clip = mix(ca, cb, along);
#ifdef FOG
  vFogDepth = -mix(a.z, b.z, along);
#endif
  clip.xy += offset / (uResolution * 0.5) * clip.w;
  gl_Position = clip;
#if defined(DASHED) || defined(HOOK_FRAGMENT)
  vDistance = segmentInfo.x + length(end - start) * along;
#endif
#ifdef HOOK_FRAGMENT
  vSegment = float(gl_InstanceID);
#endif
#ifdef DASHED
  vArrow = arrow;
#endif
#ifdef PICK
  vPickElement = uint(gl_InstanceID);
#endif

  vColor = vec3(1.0);
#ifdef VERTEX_COLORS
  vColor = srgbToLinear(mix(segmentColorStart, segmentColorEnd, along));
#endif
}
`

const LINES_FRAGMENT = /* glsl */ `
precision highp float;
in vec3 vColor;
uniform vec3 uColor;
uniform float uOpacity;
#if defined(DASHED) || defined(HOOK_FRAGMENT)
in float vDistance;
#endif
#ifdef HOOK_FRAGMENT
flat in float vSegment;
#endif
//@hook uniforms
#ifdef DASHED
flat in float vArrow;
uniform float uDash;        // dash and gap lengths, in the model's units
uniform float uGap;
uniform float uDashOffset;  // moves the dashes along: animate it for flow
#endif
out vec4 fragColor;

${COMMON}
${FOG}

void main() {
#ifdef DASHED
  if (vArrow < 0.5 && mod(vDistance - uDashOffset, uDash + uGap) >= uDash) discard;
#endif
  vec4 base = vec4(uColor * vColor, uOpacity);
#ifdef HOOK_FRAGMENT
  {
    float distance = vDistance;
    int index = int(vSegment + 0.5);
//@hook fragment
  }
  if (base.a <= 0.0) discard;
#endif
  vec3 color = fogged(base.rgb);
#ifdef HOOK_LIT
  {
//@hook lit
  }
#endif
  fragColor = outputColor(color, base.a, base.a);
}
`

/** @typedef {'mesh' | 'points' | 'lines'} ShaderKind */

const SOURCES = {
  mesh: [MESH_VERTEX, MESH_FRAGMENT],
  points: [POINTS_VERTEX, POINTS_FRAGMENT],
  lines: [LINES_VERTEX, LINES_FRAGMENT],
}

/**
 * GLSL of a material's own, spliced in at the shaders' `//@hook` lines: uniform declarations, and
 * code run on each vertex, before lighting and after it.
 * @typedef {object} HookSource
 * @property {string} uniforms declarations
 * @property {string} [helpers] functions every hook can call - hash, noise, fbm
 * @property {string} vertex
 * @property {string} fragment
 * @property {string} lit
 */

// a hook's own lines are numbered from 1 in a source string of their own, so compile errors point
// at the line of the hook, not of the generated shader
export const HOOK_SOURCE_NUMBERS = { vertex: 101, fragment: 102, lit: 103 }

/**
 * Vertex and fragment source for a kind of drawable, or a pass's own pair, with a set of feature
 * defines - and a material's shader hooks, when it has them. The parts loaded on their own
 * (parts.js) are filled in.
 * @param {ShaderKind | [string, string]} kind
 * @param {string[]} defines e.g. ['LIT', 'MAP']
 * @param {HookSource | null} [hooks]
 * @returns {[string, string]}
 */
export function shaderSource(kind, defines, hooks = null) {
  const header = `#version 300 es\n${defines.map((d) => `#define ${d}\n`).join('')}`
  const [vs, fs] = (typeof kind === 'string' ? SOURCES[kind] : kind).map(withParts)
  if (!hooks) return [header + vs, header + fs]
  if (typeof kind === 'string') checkMarkers(kind, vs, fs, hooks)
  const first = 2 + defines.length
  return [header + splice(vs, hooks, first), header + splice(fs, hooks, first)]
}

/**
 * Says so, once, when a drawable's shaders lack a line a hook needs - without it the hook is left
 * out without a sound (1.4.0 shipped like that: its build stripped the lines as comments). Passes'
 * own pairs aren't checked: they take only some hooks, by design. Exported for the tests.
 * @param {ShaderKind} kind @param {string} vs @param {string} fs @param {HookSource} hooks
 */
export function checkMarkers(kind, vs, fs, hooks) {
  const has = (source, /** @type {string} */ part) => new RegExp(`^\\s*//@hook ${part}$`, 'm').test(source)
  const missing = [
    ...(!has(vs, 'uniforms') || !has(fs, 'uniforms') ? ['uniforms'] : []),
    ...(hooks.vertex && !has(vs, 'vertex') ? ['vertex'] : []),
    ...(hooks.fragment && !has(fs, 'fragment') ? ['fragment'] : []),
    ...(hooks.lit && !has(fs, 'lit') ? ['lit'] : []),
  ]
  if (!missing.length || markersWarned.has(kind)) return
  markersWarned.add(kind)
  warnOnce(SOURCES, `the ${kind} shader has no //@hook line for ${missing.join(', ')}, so shader hooks there are left out - is this build stripping GLSL comments?`)
}
/** The kinds already warned about: once each, whatever parts each material's hooks have. @type {Set<string>} */
const markersWarned = new Set()

/** @param {string} source @param {HookSource} hooks @param {number} first the line number of the source's first line */
function splice(source, hooks, first) {
  return source.split('\n').map((line, i) => {
    const at = /^\s*\/\/@hook (\w+)$/.exec(line)
    if (!at) return line
    const part = /** @type {keyof HookSource} */ (at[1])
    // the shader's own numbering carries on after the hook as if it weren't there
    const resume = `#line ${first + i + 1} 0`
    if (part === 'uniforms') return `${hooks.uniforms}\n${hooks.helpers ?? ''}\n${resume}`
    return `#line 1 ${HOOK_SOURCE_NUMBERS[part]}\n${hooks[part]}\n${resume}`
  }).join('\n')
}
