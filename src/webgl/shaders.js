// GLSL ES 3.00 shaders. One source per kind of drawable; features are switched with #defines so each
// material variant compiles only what it uses. Attribute locations are fixed (see ATTRIBUTES) so
// vertex arrays work with any program.
import { warnOnce } from '../validate.js'

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
// glows fade out rather than towards the fog's colour
export const FOG = /* glsl */ `
#ifdef FOG
uniform vec3 uFogColor;   // linear
uniform vec2 uFogRange;   // linear fog: near, far
uniform float uFogDensity; // exponential fog
in float vFogDepth;
vec3 fogged(vec3 c) {
#ifdef FOG_LINEAR
  float f = clamp((vFogDepth - uFogRange.x) / max(uFogRange.y - uFogRange.x, 1e-4), 0.0, 1.0);
#else
  float d = uFogDensity * vFogDepth;
  float f = 1.0 - exp(-d * d);
#endif
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
const MAP_SAMPLERS = ['uMap', 'uRoughnessMap', 'uMetalnessMap', 'uNormalMap', 'uBumpMap', 'uAoMap', 'uEmissiveMap', 'uLightMap']

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
out vec4 fragColor;
#if defined(ALPHA_TEST) || defined(HOOK_FRAGMENT)
in vec2 vUv;
#endif
#if defined(HOOK_FRAGMENT) || defined(NORMALS)
in vec3 vNormal;
#endif
#ifdef NORMALS
// ambient occlusion's prepass: each pixel's normal in view space, as the picture shades it
uniform mat4 uView;
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
#if defined(NORMALS) && defined(FLAT_SHADING)
  vec3 normal = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
#elif defined(HOOK_FRAGMENT) || defined(NORMALS)
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
#else
  fragColor = vec4(1.0);
#endif
}
`

export const COMMON = /* glsl */ `
vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
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

vec3 toneMap(vec3 c) {
  c *= uExposure;
  if (uToneMapping == 1) {
    // ACES filmic, Narkowicz's fit
    c = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
  } else if (uToneMapping == 2) {
    // Khronos PBR Neutral
    float x = min(c.r, min(c.g, c.b));
    float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
    c -= offset;
    float peak = max(c.r, max(c.g, c.b));
    if (peak > 0.8) {
      float d = 0.2;
      float newPeak = 1.0 - d * d / (peak + d - 0.8);
      c *= newPeak / peak;
      float g = 1.0 - 1.0 / (0.15 * (peak - newPeak) + 1.0);
      c = mix(c, vec3(newPeak), g);
    }
  }
  return c;
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
#ifdef CLEARCOAT
uniform float uClearcoat;
uniform float uClearcoatRoughness;
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

uniform vec3 uAmbient;
uniform vec3 uHemisphereSky;
uniform vec3 uHemisphereGround;
#ifdef ENV_MAP
uniform sampler2D uEnvMap;   // equirectangular, prefiltered: each mip a step rougher
uniform float uEnvMaxLod;
uniform vec3 uEnvSH[9];      // irradiance as spherical harmonics, already divided by PI
uniform float uEnvIntensity;
#endif

// light counts are compiled in (NUM_DIRECTIONAL, NUM_PUNCTUAL), so a simply lit scene runs only
// the loops it needs - no slots for lights that aren't there
#if NUM_DIRECTIONAL > 0
uniform vec3 uDirectionalDirection[NUM_DIRECTIONAL]; // towards the light
uniform vec3 uDirectionalColor[NUM_DIRECTIONAL];
#endif
#if NUM_PUNCTUAL > 0
uniform vec3 uPunctualPosition[NUM_PUNCTUAL];
uniform vec3 uPunctualColor[NUM_PUNCTUAL];
uniform float uPunctualRange[NUM_PUNCTUAL];
uniform vec3 uPunctualDirection[NUM_PUNCTUAL];      // spot: the way the light travels
uniform vec2 uPunctualCone[NUM_PUNCTUAL];           // spot: cos(outer), cos(inner); point: (-2, -1)
#endif

#ifdef SHADOW
uniform sampler2DShadow uShadowMap; // the first directional light's depth
uniform mat4 uShadowMatrix;         // world to shadow map [0, 1] coordinates and depth
uniform float uShadowTexel;         // 1 / map size
uniform float uShadowBias;          // world units to push the lookup out along the normal
#endif
#ifdef SPOT_SHADOWS
uniform sampler2DShadow uSpotShadowMap;      // spot lights' depth, a tile each
uniform mat4 uSpotShadowMatrix[4];           // world to a tile's coordinates and depth
uniform vec4 uSpotShadowTile[4];             // each tile's bounds in the map: x0, y0, x1, y1
uniform float uSpotShadowBias[4];            // world units a unit of distance, to push the lookup out along the normal
uniform float uSpotShadowTexel;              // 1 / map size
uniform float uPunctualShadow[NUM_PUNCTUAL]; // which tile a point or spot light's shadow is in, or -1
#endif
#ifdef POINT_SHADOW
uniform samplerCubeShadow uPointShadowMap; // a point light's depth all round it, a cube face each way
uniform float uPointShadowIndex;           // which punctual light it is
uniform vec2 uPointShadowNearFar;          // its faces' near and far planes
uniform float uPointShadowTexel;           // a texel's size at a distance of 1
uniform float uPointShadowBias;            // world units a unit of distance, to push the lookup out along the normal
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

#ifdef ANISOTROPY
// brushed metal: the brushing's direction, the way across it, and roughness along and across it
vec3 brushT, brushB;
float brushAT, brushAB;

// GGX stretched along the brushing (KHR_materials_anisotropy): distribution and visibility together
float anisotropicDV(vec3 v, vec3 l, vec3 h, float NoV, float NoL, float NoH) {
  float a2 = brushAT * brushAB;
  vec3 f = vec3(brushAB * dot(brushT, h), brushAT * dot(brushB, h), a2 * NoH);
  float w2 = a2 / dot(f, f);
  float gv = NoL * length(vec3(brushAT * dot(brushT, v), brushAB * dot(brushB, v), NoV));
  float gl = NoV * length(vec3(brushAT * dot(brushT, l), brushAB * dot(brushB, l), NoL));
  return a2 * w2 * w2 / PI * 0.5 / max(gv + gl, 1e-5);
}
#endif

// Light intensity 1 on a white surface facing it gives white: the Lambert term isn't divided by
// PI, so the specular term is multiplied by it to keep the balance. (glTF intensities in lux and
// candela are divided by PI when loaded.)
#ifdef TOON
// the highlight's colour: white on a non-metal, the surface's colour on a metal, fading as it roughens
vec3 toonHighlight;

// light in flat tones, antialiased where they meet: a step up a little before each tone's middle,
// so more of a surface is lit than dark
float toonTone(float x) {
  float steps = uToon - 1.0;
  float b = x * steps + 0.6;
  float w = fwidth(b);
  return min(floor(b) + smoothstep(1.0 - w, 1.0, fract(b)), steps) / steps;
}

// a cartoon's shading: flat tones of the colour, and one hard-edged highlight where GGX's is over
// half its peak
vec3 toonShade(vec3 n, vec3 v, vec3 l, vec3 radiance, vec3 diffuse, float a) {
  float lit = toonTone(clamp(dot(n, l), 0.0, 1.0));
  float s = D_GGX(clamp(dot(n, normalize(l + v)), 0.0, 1.0), a) * PI * a * a;
  float w = fwidth(s);
  float spot = smoothstep(0.5 - w, 0.5 + w, s) * step(0.001, lit);
  return (diffuse * lit + toonHighlight * spot) * radiance;
}
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
// cloth's sheen: the Charlie distribution (Estevez and Kulla) with Neubelt's visibility
vec3 sheenShade(vec3 n, vec3 v, vec3 l, vec3 radiance, float a) {
  float NoL = clamp(dot(n, l), 0.0, 1.0);
  if (NoL <= 0.0) return vec3(0.0);
  vec3 h = normalize(l + v);
  float NoV = clamp(abs(dot(n, v)), 1e-4, 1.0);
  float NoH = clamp(dot(n, h), 0.0, 1.0);
  float invA = 1.0 / a;
  float sin2h = max(1.0 - NoH * NoH, 0.0078125);
  float D = (2.0 + invA) * pow(sin2h, invA * 0.5) / (2.0 * PI);
  float V = clamp(1.0 / (4.0 * (NoL + NoV - NoL * NoV)), 0.0, 1.0);
  return uSheenColor * D * V * PI * radiance * NoL;
}

// how much of the surroundings' light the sheen sends back: a fit to its integral (from three.js)
float sheenEnvironment(float NoV, float r) {
  float r2 = r * r;
  float a = r < 0.25 ? -339.2 * r2 + 161.4 * r - 25.9 : -8.48 * r2 + 14.3 * r - 9.95;
  float b = r < 0.25 ? 44.0 * r2 - 23.7 * r + 3.26 : 1.97 * r2 - 3.27 * r + 0.72;
  return min(exp(a * NoV + b) + (r < 0.25 ? 0.0 : 0.1 * (r - 0.25)), PI);
}
#endif

#ifdef CLEARCOAT
// a clear coat's highlight: a glossy dielectric layer (f0 0.04) on the surface's own normal, so
// normal and bump maps show beneath it, under a smooth coat
vec3 coatShade(vec3 n, vec3 v, vec3 l, vec3 radiance, float a) {
  float NoL = clamp(dot(n, l), 0.0, 1.0);
  if (NoL <= 0.0) return vec3(0.0);
  vec3 h = normalize(l + v);
  float NoV = clamp(abs(dot(n, v)), 1e-4, 1.0);
  float NoH = clamp(dot(n, h), 0.0, 1.0);
  float VoH = clamp(dot(v, h), 0.0, 1.0);
  return D_GGX(NoH, a) * V_SmithGGXCorrelated(NoV, NoL, a) * F_Schlick(VoH, vec3(0.04), 1.0) * PI * radiance * NoL;
}
#endif

// The built-in 'studio' environment: a soft, bright overhead box over a darker floor, as a
// function of direction - no texture needed.
vec3 studio(vec3 d) {
  float up = d.y * 0.5 + 0.5;
  vec3 sky = mix(vec3(0.35, 0.36, 0.38), vec3(1.0), smoothstep(0.55, 0.95, up));
  vec3 floorColor = vec3(0.18, 0.17, 0.16);
  return mix(floorColor, sky, smoothstep(0.35, 0.55, up));
}

// Karis' analytic approximation of the split-sum environment BRDF.
vec3 envBRDF(vec3 f0, float f90, float roughness, float NoV) {
  vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
  vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
  vec4 r = roughness * c0 + c1;
  float a004 = min(r.x * r.x, exp2(-9.28 * NoV)) * r.x + r.y;
  vec2 ab = vec2(-1.04, 1.04) * a004 + r.zw;
  return f0 * ab.x + ab.y * f90;
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

#ifdef SHADOW
// 0 in shadow to 1 lit: nine hardware-filtered comparisons, for a soft edge a few texels wide
float shadowAt(vec3 n, vec3 l) {
  // push the lookup out along the normal, more on surfaces turned away from the light
  vec3 p = vWorldPosition + n * uShadowBias * (1.0 - 0.5 * clamp(dot(n, l), 0.0, 1.0));
  vec4 s = uShadowMatrix * vec4(p, 1.0);
  vec3 c = s.xyz / s.w;
  if (c.x <= 0.0 || c.x >= 1.0 || c.y <= 0.0 || c.y >= 1.0 || c.z >= 1.0) return 1.0;
  float lit = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) lit += texture(uShadowMap, vec3(c.xy + vec2(x, y) * uShadowTexel * 1.5, c.z));
  }
  return lit / 9.0;
}
#endif
#ifdef SPOT_SHADOWS
// up to four spot lights' shadows share one depth map, a tile each
float spotShadowAt(int k, vec3 n, float distance) {
  // push the lookup out along the normal, more for surfaces further from the light
  vec3 p = vWorldPosition + n * uSpotShadowBias[k] * distance;
  vec4 s = uSpotShadowMatrix[k] * vec4(p, 1.0);
  if (s.w <= 0.0) return 1.0;
  vec3 c = s.xyz / s.w;
  vec4 tile = uSpotShadowTile[k];
  if (c.x <= tile.x || c.x >= tile.z || c.y <= tile.y || c.y >= tile.w || c.z >= 1.0) return 1.0;
  // nine filtered comparisons, kept inside the tile so a neighbour's shadow doesn't bleed in
  vec2 lo = tile.xy + uSpotShadowTexel, hi = tile.zw - uSpotShadowTexel;
  float lit = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) lit += texture(uSpotShadowMap, vec3(clamp(c.xy + vec2(x, y) * uSpotShadowTexel * 1.5, lo, hi), c.z));
  }
  return lit / 9.0;
}
#endif
#ifdef POINT_SHADOW
// a point light's shadow: the depth cube looked up along the way from the light, compared with
// this point's depth in whichever face it falls in
float pointShadowAt(vec3 light, vec3 n, float distance) {
  // push the lookup out along the normal, more for surfaces further from the light
  vec3 d = vWorldPosition + n * uPointShadowBias * distance - light;
  vec3 a = abs(d);
  float z = max(a.x, max(a.y, a.z));
  float near = uPointShadowNearFar.x, far = uPointShadowNearFar.y;
  if (z >= far) return 1.0;
  float depth = 0.5 * ((far + near) / (far - near) - 2.0 * far * near / ((far - near) * z)) + 0.5;
  // nine filtered comparisons, spread across the direction a texel and a half apart
  vec3 dir = d / length(d);
  vec3 u = normalize(cross(dir, abs(dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 w = cross(dir, u);
  float spread = uPointShadowTexel * 1.5;
  float lit = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) lit += texture(uPointShadowMap, vec4(dir + (u * float(x) + w * float(y)) * spread, depth));
  }
  return lit / 9.0;
}
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
  e += studio(n) * 0.35 * uEnvStrength;
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
  return mix(studio(r), studio(n), roughness * roughness) * uEnvStrength;
#else
  return irradiance * 0.5;
#endif
}
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
#if NUM_DIRECTIONAL > 0
  for (int i = 0; i < NUM_DIRECTIONAL; i++) {
    vec3 radiance = uDirectionalColor[i];
#ifdef SHADOW
    // the shadow-casting light always comes first
    if (i == 0) radiance *= shadowAt(surfaceNormal, uDirectionalDirection[0]);
#endif
    color += shade(n, v, uDirectionalDirection[i], radiance, diffuse, f0, f90, a);
#ifdef CLEARCOAT
    coat += coatShade(surfaceNormal, v, uDirectionalDirection[i], radiance, coatA);
#endif
#ifdef SHEEN
    sheen += sheenShade(n, v, uDirectionalDirection[i], radiance, sheenRoughness * sheenRoughness);
#endif
#ifdef TRANSLUCENCY
    float behind = clamp(-dot(n, uDirectionalDirection[i]), 0.0, 1.0);
    if (behind > 0.0) {
      vec3 light = uDirectionalColor[i];
#ifdef SHADOW
      // shadowed as the far side is: what lights it comes through
      if (i == 0) light *= shadowAt(-surfaceNormal, uDirectionalDirection[0]);
#endif
      color += through * light * behind;
    }
#endif
  }
#endif
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
    if (tile >= 0.0 && cone > 0.0) radiance *= spotShadowAt(int(tile), surfaceNormal, d);
#endif
#ifdef POINT_SHADOW
    if (float(i) == uPointShadowIndex) radiance *= pointShadowAt(uPunctualPosition[i], surfaceNormal, d);
#endif
    color += shade(n, v, l, radiance, diffuse, f0, f90, a);
#ifdef CLEARCOAT
    coat += coatShade(surfaceNormal, v, l, radiance, coatA);
#endif
#ifdef SHEEN
    sheen += sheenShade(n, v, l, radiance, sheenRoughness * sheenRoughness);
#endif
#ifdef TRANSLUCENCY
    float behind = clamp(-dot(n, l), 0.0, 1.0);
    if (behind > 0.0) {
      vec3 light = uPunctualColor[i] * falloff * cone;
#ifdef SPOT_SHADOWS
      if (tile >= 0.0 && cone > 0.0) light *= spotShadowAt(int(tile), -surfaceNormal, d);
#endif
#ifdef POINT_SHADOW
      if (float(i) == uPointShadowIndex) light *= pointShadowAt(uPunctualPosition[i], -surfaceNormal, d);
#endif
      color += through * light * behind;
    }
#endif
  }
#endif

  // ambient: flat, hemisphere and environment light
  vec3 irradiance = irradianceAt(n);
  float NoV = clamp(abs(dot(n, v)), 1e-4, 1.0);
  vec3 brdf = envBRDF(f0, f90, roughness, NoV);
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
  vec3 ambientSpecular = reflected(r, n, roughness, irradiance) * brdf;
  vec3 indirect = diffuse * irradiance + ambientSpecular;
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
  color = toneMap(color);
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
  color = fogged(color);

  // premultiplied alpha, so the canvas composites correctly over the page. The colour is the light
  // the surface sends back - faded with its opacity; coverage is how much of what is behind it hides
  fragColor = vec4(linearToSrgb(color) * base.a, coverage);
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
  fragColor = vec4(linearToSrgb(color) * base.a, base.a);
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
  fragColor = vec4(linearToSrgb(color) * base.a, base.a);
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

// Functions every shader hook can call - hooks are statements, so they can't define their own. All of
// it is built on an integer bit-mix (lowbias32), which GLSL ES 3.00 defines exactly, so lattice
// values and gradients are the same on every GPU - fract(sin(x) * 43758.5453) is not. Everything 0-1:
// - hash(x): a float or vector's exact bits, mixed
// - vnoise(p): value noise - random values at whole-number points, eased between (quintic); cheap,
//   blocky-looking at low frequencies
// - snoise(p): simplex noise - gradients on a simplex grid; smoother, less grid-bound, the better
//   default; snoised(p) also gives its gradient, for normals
// - vfbm / sfbm (p[, octaves]): octaves of either added up, each turned and scaled by 2.03 so their
//   grids never line up; sfbmd adds the gradient. Five octaves unless told; 1-12
// - voronoi(p): cellular (Worley) noise - a random point in every unit cell; returns the distance to
//   the nearest (F1) and the second nearest (F2), in cells, and a random 0-1 for the nearest's cell
// And the everyday ones people (and agents) reach for: srgb() to turn a colour as picked into the
// linear one hooks work in, hsv2rgb() and palette() (Quilez's cosine palette) - both giving linear
// colour - fresnel() for rim light, rotate2() / rotate3() matrices, remap() and saturate().
// Every int highp: a fragment shader's ints are mediump unless they say so.
export const HOOK_HELPERS = /* glsl */ `
highp uint phoriaMix(highp uint h) {
  h ^= h >> 16u; h *= 0x7feb352du; h ^= h >> 15u; h *= 0x846ca68bu; h ^= h >> 16u;
  return h;
}
float phoriaUnit(highp uint h) { return float(h >> 8u) * (1.0 / 16777216.0); }
float hash(float x) { return phoriaUnit(phoriaMix(floatBitsToUint(x))); }
float hash(vec2 p) { highp uvec2 u = floatBitsToUint(p); return phoriaUnit(phoriaMix(u.x ^ phoriaMix(u.y + 0x9e3779b9u))); }
float hash(vec3 p) { highp uvec3 u = floatBitsToUint(p); return phoriaUnit(phoriaMix(u.x ^ phoriaMix(u.y ^ phoriaMix(u.z + 0x9e3779b9u)))); }
// a lattice point's bits: each coordinate times its own large odd number, mixed once
highp uint phoriaCell(highp ivec3 c) {
  highp uvec3 u = uvec3(c) * uvec3(0x8da6b343u, 0xd8163841u, 0xcb1ab31fu);
  return phoriaMix(u.x ^ u.y ^ u.z);
}

float vnoise(vec3 p) {
  vec3 i = floor(p), f = p - i;
  vec3 s = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  highp ivec3 c = ivec3(i);
  float a = mix(phoriaUnit(phoriaCell(c)), phoriaUnit(phoriaCell(c + ivec3(1, 0, 0))), s.x);
  float b = mix(phoriaUnit(phoriaCell(c + ivec3(0, 1, 0))), phoriaUnit(phoriaCell(c + ivec3(1, 1, 0))), s.x);
  float d = mix(phoriaUnit(phoriaCell(c + ivec3(0, 0, 1))), phoriaUnit(phoriaCell(c + ivec3(1, 0, 1))), s.x);
  float e = mix(phoriaUnit(phoriaCell(c + ivec3(0, 1, 1))), phoriaUnit(phoriaCell(c + ivec3(1, 1, 1))), s.x);
  return mix(mix(a, b, s.y), mix(d, e, s.y), s.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = p - i;
  vec2 s = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  highp ivec3 c = ivec3(ivec2(i), 0);
  return mix(mix(phoriaUnit(phoriaCell(c)), phoriaUnit(phoriaCell(c + ivec3(1, 0, 0))), s.x),
    mix(phoriaUnit(phoriaCell(c + ivec3(0, 1, 0))), phoriaUnit(phoriaCell(c + ivec3(1, 1, 0))), s.x), s.y);
}

// simplex: a corner's share of the value and the gradient - t^4 times the gradient's ramp, falling
// to nothing at the corner's reach
vec2 phoriaGrad2(highp ivec2 c) {
  float a = phoriaUnit(phoriaCell(ivec3(c, 7))) * 6.28318530718;
  return vec2(cos(a), sin(a));
}
void phoriaCorner2(vec2 x, highp ivec2 c, inout float n, inout vec2 d) {
  float t = 0.5 - dot(x, x);
  if (t <= 0.0) return;
  vec2 g = phoriaGrad2(c);
  float t2 = t * t, gx = dot(g, x);
  n += t2 * t2 * gx;
  d += t2 * t2 * g - 8.0 * t2 * t * gx * x;
}
vec3 snoised(vec2 p) {
  const float F = 0.366025403784, G = 0.211324865405;
  vec2 i = floor(p + (p.x + p.y) * F);
  vec2 x0 = p - i + (i.x + i.y) * G;
  vec2 o = x0.x > x0.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  highp ivec2 c = ivec2(i);
  float n = 0.0;
  vec2 d = vec2(0.0);
  phoriaCorner2(x0, c, n, d);
  phoriaCorner2(x0 - o + G, c + ivec2(o), n, d);
  phoriaCorner2(x0 - 1.0 + 2.0 * G, c + 1, n, d);
  // unit gradients peak near 1/70: scaled to -1-1, then to 0-1
  return vec3(0.5 + 35.0 * n, 35.0 * d);
}
float snoise(vec2 p) { return snoised(p).x; }

const vec3 PHORIA_EDGES[12] = vec3[12](vec3(1, 1, 0), vec3(-1, 1, 0), vec3(1, -1, 0), vec3(-1, -1, 0),
  vec3(1, 0, 1), vec3(-1, 0, 1), vec3(1, 0, -1), vec3(-1, 0, -1), vec3(0, 1, 1), vec3(0, -1, 1), vec3(0, 1, -1), vec3(0, -1, -1));
void phoriaCorner3(vec3 x, highp ivec3 c, inout float n, inout vec3 d) {
  float t = 0.6 - dot(x, x);
  if (t <= 0.0) return;
  vec3 g = PHORIA_EDGES[phoriaCell(c) % 12u];
  float t2 = t * t, gx = dot(g, x);
  n += t2 * t2 * gx;
  d += t2 * t2 * g - 8.0 * t2 * t * gx * x;
}
vec4 snoised(vec3 p) {
  const float F = 1.0 / 3.0, G = 1.0 / 6.0;
  vec3 i = floor(p + dot(p, vec3(F)));
  vec3 x0 = p - i + dot(i, vec3(G));
  vec3 g = step(x0.yzx, x0.xyz), l = 1.0 - g;
  vec3 i1 = min(g, l.zxy), i2 = max(g, l.zxy);
  highp ivec3 c = ivec3(i);
  float n = 0.0;
  vec3 d = vec3(0.0);
  phoriaCorner3(x0, c, n, d);
  phoriaCorner3(x0 - i1 + G, c + ivec3(i1), n, d);
  phoriaCorner3(x0 - i2 + 2.0 * G, c + ivec3(i2), n, d);
  phoriaCorner3(x0 - 1.0 + 3.0 * G, c + 1, n, d);
  // edge gradients peak near 1/32: scaled to -1-1, then to 0-1
  return vec4(0.5 + 16.0 * n, 16.0 * d);
}
float snoise(vec3 p) { return snoised(p).x; }

// fbm: each octave turned (so grids don't line up into a visible lattice), scaled by 2.03 and moved
// on, its amplitude halved; the sum divided by the amplitudes, so 0-1 like the noise
const mat2 PHORIA_TURN2 = mat2(0.8, 0.6, -0.6, 0.8);
const mat3 PHORIA_TURN3 = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);
float vfbm(vec2 p, int octaves) {
  float v = 0.0, a = 0.5, sum = 0.0;
  for (int i = 0; i < clamp(octaves, 1, 12); i++) { v += a * vnoise(p); sum += a; p = PHORIA_TURN2 * p * 2.03 + 17.0; a *= 0.5; }
  return v / sum;
}
float vfbm(vec3 p, int octaves) {
  float v = 0.0, a = 0.5, sum = 0.0;
  for (int i = 0; i < clamp(octaves, 1, 12); i++) { v += a * vnoise(p); sum += a; p = PHORIA_TURN3 * p * 2.03 + 17.0; a *= 0.5; }
  return v / sum;
}
float sfbm(vec2 p, int octaves) {
  float v = 0.0, a = 0.5, sum = 0.0;
  for (int i = 0; i < clamp(octaves, 1, 12); i++) { v += a * snoise(p); sum += a; p = PHORIA_TURN2 * p * 2.03 + 17.0; a *= 0.5; }
  return v / sum;
}
float sfbm(vec3 p, int octaves) {
  float v = 0.0, a = 0.5, sum = 0.0;
  for (int i = 0; i < clamp(octaves, 1, 12); i++) { v += a * snoise(p); sum += a; p = PHORIA_TURN3 * p * 2.03 + 17.0; a *= 0.5; }
  return v / sum;
}
// with the gradient: each octave's, carried back through the turns and scalings so far
vec3 sfbmd(vec2 p, int octaves) {
  float v = 0.0, a = 0.5, sum = 0.0;
  vec2 d = vec2(0.0);
  mat2 m = mat2(1.0);
  for (int i = 0; i < clamp(octaves, 1, 12); i++) {
    vec3 n = snoised(p);
    v += a * n.x;
    d += a * (transpose(m) * n.yz);
    sum += a;
    p = PHORIA_TURN2 * p * 2.03 + 17.0;
    m = PHORIA_TURN2 * m * 2.03;
    a *= 0.5;
  }
  return vec3(v, d) / sum;
}
vec4 sfbmd(vec3 p, int octaves) {
  float v = 0.0, a = 0.5, sum = 0.0;
  vec3 d = vec3(0.0);
  mat3 m = mat3(1.0);
  for (int i = 0; i < clamp(octaves, 1, 12); i++) {
    vec4 n = snoised(p);
    v += a * n.x;
    d += a * (transpose(m) * n.yzw);
    sum += a;
    p = PHORIA_TURN3 * p * 2.03 + 17.0;
    m = PHORIA_TURN3 * m * 2.03;
    a *= 0.5;
  }
  return vec4(v, d) / sum;
}
float vfbm(vec2 p) { return vfbm(p, 5); }
float vfbm(vec3 p) { return vfbm(p, 5); }
float sfbm(vec2 p) { return sfbm(p, 5); }
float sfbm(vec3 p) { return sfbm(p, 5); }
vec3 sfbmd(vec2 p) { return sfbmd(p, 5); }
vec4 sfbmd(vec3 p) { return sfbmd(p, 5); }

// cellular noise: each unit cell's own point, from its hash; the nearest and second nearest of the
// 3 x 3 (or 3 x 3 x 3) cells round p - F1, F2 - and the nearest cell's own random number
vec3 voronoi(vec2 p) {
  vec2 i = floor(p), f = p - i;
  highp ivec2 c = ivec2(i);
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      highp uint h = phoriaCell(ivec3(c + ivec2(x, y), 11));
      vec2 o = vec2(float(x), float(y)) + vec2(phoriaUnit(h), phoriaUnit(phoriaMix(h ^ 0x68e31da4u))) - f;
      float d = dot(o, o);
      if (d < f1) { f2 = f1; f1 = d; id = phoriaUnit(phoriaMix(h + 0x1b56c4e9u)); }
      else if (d < f2) f2 = d;
    }
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}
vec3 voronoi(vec3 p) {
  vec3 i = floor(p), f = p - i;
  highp ivec3 c = ivec3(i);
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for (int z = -1; z <= 1; z++) {
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        highp uint h = phoriaCell(c + ivec3(x, y, z)) ^ 0x2545f491u;
        h = phoriaMix(h);
        vec3 o = vec3(float(x), float(y), float(z)) - f
          + vec3(phoriaUnit(h), phoriaUnit(phoriaMix(h ^ 0x68e31da4u)), phoriaUnit(phoriaMix(h ^ 0xb5297a4du)));
        float d = dot(o, o);
        if (d < f1) { f2 = f1; f1 = d; id = phoriaUnit(phoriaMix(h + 0x1b56c4e9u)); }
        else if (d < f2) f2 = d;
      }
    }
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}

// a colour as picked (sRGB) to the linear colour hooks work in
vec3 srgb(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
// hue, saturation and value 0-1 to a linear colour - the colour a colour picker shows
vec3 hsv2rgb(vec3 hsv) {
  vec3 k = clamp(abs(mod(hsv.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return srgb(hsv.z * mix(vec3(1.0), k, hsv.y));
}
vec3 hsv2rgb(float h, float s, float v) { return hsv2rgb(vec3(h, s, v)); }
// a cosine palette (Quilez): a + b cos(2 pi (c t + d)), its four vectors as picked; a linear colour
vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d) { return srgb(clamp(a + b * cos(6.28318530718 * (c * t + d)), 0.0, 1.0)); }
// how edge-on a surface is seen: 0 facing the camera, 1 side on, sharpened by the power - rim light
float fresnel(vec3 normal, vec3 position, float power) {
  vec3 v = normalize(cameraPosition - position);
  return pow(1.0 - clamp(abs(dot(normalize(normal), v)), 0.0, 1.0), power);
}
// turning: rotate2(a) * v anticlockwise by a radians; rotate3(axis, a) * v about an axis
mat2 rotate2(float a) { float s = sin(a), c = cos(a); return mat2(c, s, -s, c); }
mat3 rotate3(vec3 axis, float a) {
  vec3 u = normalize(axis);
  float s = sin(a), c = cos(a), t = 1.0 - c;
  return mat3(t * u.x * u.x + c, t * u.x * u.y + s * u.z, t * u.x * u.z - s * u.y,
    t * u.x * u.y - s * u.z, t * u.y * u.y + c, t * u.y * u.z + s * u.x,
    t * u.x * u.z + s * u.y, t * u.y * u.z - s * u.x, t * u.z * u.z + c);
}
// x from one range to another, not clamped
float remap(float x, float a, float b, float c, float d) { return c + (x - a) * (d - c) / (b - a); }
vec2 remap(vec2 x, float a, float b, float c, float d) { return c + (x - a) * (d - c) / (b - a); }
vec3 remap(vec3 x, float a, float b, float c, float d) { return c + (x - a) * (d - c) / (b - a); }
// clamped to 0-1, as HLSL has it
float saturate(float x) { return clamp(x, 0.0, 1.0); }
vec2 saturate(vec2 x) { return clamp(x, 0.0, 1.0); }
vec3 saturate(vec3 x) { return clamp(x, 0.0, 1.0); }
vec4 saturate(vec4 x) { return clamp(x, 0.0, 1.0); }
`

// a hook's own lines are numbered from 1 in a source string of their own, so compile errors point
// at the line of the hook, not of the generated shader
export const HOOK_SOURCE_NUMBERS = { vertex: 101, fragment: 102, lit: 103 }

/**
 * Vertex and fragment source for a kind of drawable, or a pass's own pair, with a set of feature
 * defines - and a material's shader hooks, when it has them.
 * @param {ShaderKind | [string, string]} kind
 * @param {string[]} defines e.g. ['LIT', 'MAP']
 * @param {HookSource | null} [hooks]
 * @returns {[string, string]}
 */
export function shaderSource(kind, defines, hooks = null) {
  const header = `#version 300 es\n${defines.map((d) => `#define ${d}\n`).join('')}`
  const [vs, fs] = typeof kind === 'string' ? SOURCES[kind] : kind
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
