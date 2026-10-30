// GLSL ES 3.00 shaders. One source per kind of drawable; features are switched with #defines so each
// material variant compiles only what it uses. Attribute locations are fixed (see ATTRIBUTES) so
// vertex arrays work with any program.

/** Fixed attribute locations shared by every program. */
export const ATTRIBUTES = {
  position: 0,
  normal: 1,
  uv: 2,
  color: 3,
  instanceMatrix: 4, // 4-7, a mat4 takes four slots
  instanceColor: 8,
  tangent: 9, // brushed metal's direction: along the UVs' u, and which way their v runs
  // lines: per-segment endpoints and colours, and the corner of the quad being drawn
  segmentStart: 0,
  segmentEnd: 1,
  segmentColorStart: 2,
  segmentColorEnd: 3,
  corner: 4,
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
const SAMPLING = /* glsl */ `
#ifdef TRIPLANAR
in vec3 vObjectPosition;
in vec3 vObjectNormal;
in mat3 vObjectToWorld;
uniform float uTriplanar; // repeats per unit of the mesh's own space
uniform vec4 uUvTransform; // the map's repeat xy and offset zw, applied to each projection as to UVs

vec2 projected(vec2 p) {
  return p * uUvTransform.xy + uUvTransform.zw;
}

// how much each axis's projection counts: mostly the one the surface faces, blended at the turns
vec3 triplanarWeights(vec3 n) {
  vec3 w = pow(abs(n), vec3(4.0));
  return w / (w.x + w.y + w.z);
}
// a map seen from the three axes and blended - for meshes with no UVs, scans and CAD models
vec4 triplanar(sampler2D s) {
  vec3 p = vObjectPosition * uTriplanar, w = triplanarWeights(normalize(vObjectNormal));
  return texture(s, projected(p.zy)) * w.x + texture(s, projected(p.xz)) * w.y + texture(s, projected(p.xy)) * w.z;
}
#define SAMPLE(s) triplanar(s)
#else
#define SAMPLE(s) texture(s, vUv)
#endif
`

export const CLIP_ONLY_FRAGMENT = /* glsl */ `
precision highp float;
in vec3 vWorldPosition;
out vec4 fragColor;
#ifdef ALPHA_TEST
// a cut-out casts the shadow of what is left of it - leaves, fences, grilles - not of its rectangle
in vec2 vUv;
uniform float uOpacity;
uniform float uAlphaTest;
#ifdef MAP
uniform sampler2D uMap;
${SAMPLING}
#endif
#endif
${CLIP}
void main() {
  clipAway(vWorldPosition);
#ifdef ALPHA_TEST
  float alpha = uOpacity;
#ifdef MAP
  alpha *= SAMPLE(uMap).a;
#endif
  if (alpha < uAlphaTest) discard;
#endif
  fragColor = vec4(1.0);
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

uniform mat4 uModel;
uniform mat3 uNormalMatrix;
uniform mat4 uViewProjection;
uniform vec4 uUvTransform; // repeat xy, offset zw
uniform int uHighlightIndex; // -2 none, -1 the whole node, otherwise the instance
#ifdef FOG
uniform mat4 uView;
out float vFogDepth;
#endif

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
#ifdef INSTANCED
  vec4 local = instanceMatrix * vec4(position, 1.0);
  // the instance's normal matrix as its cofactor: the inverse transpose up to scale, from three
  // cross products, flipped back for mirroring transforms
  mat3 m = mat3(instanceMatrix);
  mat3 instanceNormal = mat3(cross(m[1], m[2]), cross(m[2], m[0]), cross(m[0], m[1])) * sign(dot(m[0], cross(m[1], m[2])));
  vec3 n = instanceNormal * normal;
  vColor *= instanceColor;
  if (gl_InstanceID == uHighlightIndex) vHighlight = 1.0;
#else
  vec4 local = vec4(position, 1.0);
  vec3 n = normal;
#endif
#ifdef VERTEX_COLORS
  vColor *= srgbToLinear(color);
#endif
  vec4 world = uModel * local;
  vWorldPosition = world.xyz;
  vNormal = uNormalMatrix * n;
  vUv = uv * uUvTransform.xy + uUvTransform.zw;
#ifdef ANISOTROPY
  // a direction along the surface, so it turns as the model does
#ifdef INSTANCED
  vTangent = vec4(mat3(uModel) * (m * tangent.xyz), tangent.w);
#else
  vTangent = vec4(mat3(uModel) * tangent.xyz, tangent.w);
#endif
#endif
#ifdef TRIPLANAR
  vObjectPosition = position;
  vObjectNormal = normal;
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
#ifdef TRANSMISSION
uniform float uTransmission;
#endif
#ifdef CLEARCOAT
uniform float uClearcoat;
uniform float uClearcoatRoughness;
#endif
uniform vec4 uSpecular;      // a non-metal's reflectance face on (from its ior), and at grazing angles
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
vec3 shade(vec3 n, vec3 v, vec3 l, vec3 radiance, vec3 diffuse, vec3 f0, float f90, float a) {
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
  float h = SAMPLE(uBumpMap).r * uBumpScale;
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
  vec3 tx = texture(uNormalMap, projected(p.zy)).xyz * 2.0 - 1.0;
  vec3 ty = texture(uNormalMap, projected(p.xz)).xyz * 2.0 - 1.0;
  vec3 tz = texture(uNormalMap, projected(p.xy)).xyz * 2.0 - 1.0;
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
vec3 perturbNormal(vec3 n, vec3 m) {
  vec3 dp1 = dFdx(vWorldPosition), dp2 = dFdy(vWorldPosition);
  vec2 duv1 = dFdx(vUv), duv2 = dFdy(vUv);
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

// light arriving from all round, on a surface facing n: flat, hemisphere and environment light
vec3 irradianceAt(vec3 n) {
  vec3 e = uAmbient + mix(uHemisphereGround, uHemisphereSky, n.y * 0.5 + 0.5);
#ifdef ENV_MAP
  e += envIrradiance(n) * uEnvIntensity;
#elif defined(STUDIO)
  e += studio(n) * 0.35;
#endif
  return e;
}

// what a surface reflects of its surroundings along r - blurrier the rougher it is
vec3 reflected(vec3 r, vec3 n, float roughness, vec3 irradiance) {
#ifdef ENV_MAP
  // a lower mip, convolved for that roughness
  return textureLod(uEnvMap, equirectUv(r), roughness * uEnvMaxLod).rgb * uEnvIntensity;
#elif defined(STUDIO)
  // leaned towards the surface normal
  return mix(studio(r), studio(n), roughness * roughness);
#else
  return irradiance * 0.5;
#endif
}
#endif

void main() {
  clipAway(vWorldPosition);
  vec4 base = vec4(uColor * vColor, uOpacity);
#ifdef MAP
  base *= SAMPLE(uMap); // sRGB textures are decoded to linear by the hardware
#endif
#ifdef ALPHA_TEST
  if (base.a < uAlphaTest) discard;
  base.a = 1.0;
#endif
  // how much of what is behind it this hides: its opacity - less for glass, which lets light through
  float coverage = base.a;
  vec3 emissive = uEmissive;
#ifdef EMISSIVE_MAP
  emissive *= SAMPLE(uEmissiveMap).rgb;
#endif

#ifdef LIT
#ifdef FLAT_SHADING
  // from the screen-space slope: it faces the camera whichever side of the face is seen
  vec3 n = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
#else
  vec3 n = normalize(vNormal);
#endif
#if defined(DOUBLE_SIDED) && !defined(FLAT_SHADING)
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
  vec3 m = texture(uNormalMap, vUv).xyz * 2.0 - 1.0;
  m.xy *= uNormalScale;
  n = perturbNormal(n, m);
#endif
#endif
#ifdef BUMP_MAP
  n = bumpNormal(n);
#endif
  vec3 v = normalize(uCameraPosition - vWorldPosition);
  float roughness = uRoughness;
  float metalness = uMetalness;
#ifdef ROUGHNESS_MAP
  roughness *= SAMPLE(uRoughnessMap).g;
#endif
#ifdef METALNESS_MAP
  metalness *= SAMPLE(uMetalnessMap).b;
#endif
  roughness = clamp(roughness, 0.04, 1.0);
  float a = roughness * roughness;
  vec3 diffuse = base.rgb * (1.0 - metalness);
  vec3 f0 = mix(uSpecular.rgb, base.rgb, metalness);
  float f90 = mix(uSpecular.a, 1.0, metalness);
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
  vec3 ambientSpecular = reflected(r, n, roughness, irradiance) * brdf;
  vec3 indirect = diffuse * irradiance + ambientSpecular;
#ifdef TRANSLUCENCY
  indirect += through * irradianceAt(-n);
#endif
#ifdef AO_MAP
  indirect *= mix(1.0, SAMPLE(uAoMap).r, uAoMapIntensity);
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
#else
  vec3 color = base.rgb + emissive;
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

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;
uniform float uSize;        // pixels (with the pixel ratio applied), or world units when attenuated
uniform float uScale;       // projection focal term x half the buffer height: world size -> pixels at depth 1
uniform int uHighlightIndex; // -2 none, -1 every point, otherwise the point

out vec3 vColor;
flat out float vHighlight;
#ifdef PICK
flat out uint vPickElement; // which instance, point or segment, for GPU picking
#endif
#ifdef FOG
out float vFogDepth;
#endif

${COMMON}

void main() {
  vec4 viewPosition = uView * (uModel * vec4(position, 1.0));
  gl_Position = uProjection * viewPosition;
#ifdef FOG
  vFogDepth = -viewPosition.z;
#endif
#ifdef SIZE_ATTENUATION
  // perspective shrinks with distance; an orthographic projection (w row 0, 0, 0, 1) doesn't
  float depth = uProjection[3][3] == 1.0 ? 1.0 : max(-viewPosition.z, 1e-4);
  gl_PointSize = uSize * uScale / depth;
#else
  gl_PointSize = uSize;
#endif
  vColor = vec3(1.0);
#ifdef VERTEX_COLORS
  vColor = srgbToLinear(color);
#endif
  vHighlight = uHighlightIndex == -1 || gl_VertexID == uHighlightIndex ? 1.0 : 0.0;
#ifdef PICK
  vPickElement = uint(gl_VertexID);
#endif
}
`

const POINTS_FRAGMENT = /* glsl */ `
precision highp float;
in vec3 vColor;
flat in float vHighlight;
uniform vec4 uHighlight;
uniform vec3 uColor;
uniform float uOpacity;
#ifdef MAP
uniform sampler2D uMap;
#endif
out vec4 fragColor;

${COMMON}
${FOG}

void main() {
  vec4 base = vec4(uColor * vColor, uOpacity);
#ifdef MAP
  base *= texture(uMap, vec2(gl_PointCoord.x, gl_PointCoord.y));
#else
  // round points with a one pixel soft edge
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = dot(p, p);
  float edge = fwidth(r);
  base.a *= 1.0 - smoothstep(1.0 - edge, 1.0, r);
#endif
  if (base.a <= 0.0) discard;
  base.rgb = fogged(mix(base.rgb, uHighlight.rgb, vHighlight * uHighlight.a));
  fragColor = vec4(linearToSrgb(base.rgb) * base.a, base.a);
}
`

export const LINES_VERTEX = /* glsl */ `
layout(location = 0) in vec3 segmentStart;
layout(location = 1) in vec3 segmentEnd;
layout(location = 2) in vec3 segmentColorStart;
layout(location = 3) in vec3 segmentColorEnd;
layout(location = 4) in vec2 corner; // x: 0 at start, 1 at end; y: -1 or 1 across

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;
uniform vec2 uResolution;   // drawing buffer size in pixels
uniform float uWidth;       // pixels, already scaled by the pixel ratio
uniform float uNear;

out vec3 vColor;
#ifdef PICK
flat out uint vPickElement; // which instance, point or segment, for GPU picking
#endif
#ifdef FOG
out float vFogDepth;
#endif

${COMMON}

void main() {
  vec4 a = uView * (uModel * vec4(segmentStart, 1.0));
  vec4 b = uView * (uModel * vec4(segmentEnd, 1.0));
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

  vec4 clip = mix(ca, cb, corner.x);
#ifdef FOG
  vFogDepth = -mix(a.z, b.z, corner.x);
#endif
  // extend past each end by half the width so joins look continuous
  vec2 offset = normal * corner.y * uWidth * 0.5 + dir * (corner.x * 2.0 - 1.0) * uWidth * 0.5;
  clip.xy += offset / (uResolution * 0.5) * clip.w;
  gl_Position = clip;
#ifdef PICK
  vPickElement = uint(gl_InstanceID);
#endif

  vColor = vec3(1.0);
#ifdef VERTEX_COLORS
  vColor = srgbToLinear(mix(segmentColorStart, segmentColorEnd, corner.x));
#endif
}
`

const LINES_FRAGMENT = /* glsl */ `
precision highp float;
in vec3 vColor;
uniform vec3 uColor;
uniform float uOpacity;
out vec4 fragColor;

${COMMON}
${FOG}

void main() {
  vec3 color = fogged(uColor * vColor);
  fragColor = vec4(linearToSrgb(color) * uOpacity, uOpacity);
}
`

/** @typedef {'mesh' | 'points' | 'lines'} ShaderKind */

const SOURCES = {
  mesh: [MESH_VERTEX, MESH_FRAGMENT],
  points: [POINTS_VERTEX, POINTS_FRAGMENT],
  lines: [LINES_VERTEX, LINES_FRAGMENT],
}

/**
 * Vertex and fragment source for a kind of drawable, or a pass's own pair, with a set of feature defines.
 * @param {ShaderKind | [string, string]} kind
 * @param {string[]} defines e.g. ['LIT', 'MAP']
 * @returns {[string, string]}
 */
export function shaderSource(kind, defines) {
  const header = `#version 300 es\n${defines.map((d) => `#define ${d}\n`).join('')}`
  const [vs, fs] = typeof kind === 'string' ? SOURCES[kind] : kind
  return [header + vs, header + fs]
}
