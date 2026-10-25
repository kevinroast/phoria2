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
  // lines: per-segment endpoints and colours, and the corner of the quad being drawn
  segmentStart: 0,
  segmentEnd: 1,
  segmentColorStart: 2,
  segmentColorEnd: 3,
  corner: 4,
}

export const MAX_DIRECTIONAL = 2
export const MAX_PUNCTUAL = 4

const COMMON = /* glsl */ `
vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
`

const MESH_VERTEX = /* glsl */ `
layout(location = 0) in vec3 position;
layout(location = 1) in vec3 normal;
layout(location = 2) in vec2 uv;
layout(location = 3) in vec3 color;
#ifdef INSTANCED
layout(location = 4) in mat4 instanceMatrix;
layout(location = 8) in vec3 instanceColor;
#endif

uniform mat4 uModel;
uniform mat3 uNormalMatrix;
uniform mat4 uView;
uniform mat4 uProjection;
uniform vec4 uUvTransform; // repeat xy, offset zw

out vec3 vWorldPosition;
out vec3 vNormal;
out vec2 vUv;
out vec3 vColor;

${COMMON}

void main() {
  mat4 model = uModel;
  mat3 normalMatrix = uNormalMatrix;
  vColor = vec3(1.0);
#ifdef INSTANCED
  model = uModel * instanceMatrix;
  normalMatrix = transpose(inverse(mat3(model)));
  vColor *= instanceColor;
#endif
#ifdef VERTEX_COLORS
  vColor *= srgbToLinear(color);
#endif
  vec4 world = model * vec4(position, 1.0);
  vWorldPosition = world.xyz;
  vNormal = normalMatrix * normal;
  vUv = uv * uUvTransform.xy + uUvTransform.zw;
  gl_Position = uProjection * uView * world;
}
`

const MESH_FRAGMENT = /* glsl */ `
precision highp float;

in vec3 vWorldPosition;
in vec3 vNormal;
in vec2 vUv;
in vec3 vColor;

uniform vec3 uColor;         // linear
uniform float uOpacity;
uniform vec3 uEmissive;      // linear, intensity applied
#ifdef MAP
uniform sampler2D uMap;
#endif

#ifdef LIT
uniform vec3 uCameraPosition;
uniform float uRoughness;
uniform float uMetalness;

uniform vec3 uAmbient;
uniform vec3 uHemisphereSky;
uniform vec3 uHemisphereGround;
uniform int uEnvironment;    // 0 none, 1 studio

uniform int uDirectionalCount;
uniform vec3 uDirectionalDirection[${MAX_DIRECTIONAL}]; // towards the light
uniform vec3 uDirectionalColor[${MAX_DIRECTIONAL}];

uniform int uPunctualCount;
uniform vec3 uPunctualPosition[${MAX_PUNCTUAL}];
uniform vec3 uPunctualColor[${MAX_PUNCTUAL}];
uniform float uPunctualRange[${MAX_PUNCTUAL}];
uniform vec3 uPunctualDirection[${MAX_PUNCTUAL}];      // spot: the way the light travels
uniform vec2 uPunctualCone[${MAX_PUNCTUAL}];           // spot: cos(outer), cos(inner); point: (-2, -1)
#endif

uniform float uExposure;
uniform int uToneMapping;    // 0 none, 1 aces, 2 neutral

out vec4 fragColor;

${COMMON}

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

vec3 F_Schlick(float VoH, vec3 f0) {
  return f0 + (1.0 - f0) * pow(1.0 - VoH, 5.0);
}

// Light intensity 1 on a white surface facing it gives white: the Lambert term isn't divided by
// PI, so the specular term is multiplied by it to keep the balance. (glTF intensities in lux and
// candela are divided by PI when loaded.)
vec3 shade(vec3 n, vec3 v, vec3 l, vec3 radiance, vec3 diffuse, vec3 f0, float a) {
  float NoL = clamp(dot(n, l), 0.0, 1.0);
  if (NoL <= 0.0) return vec3(0.0);
  vec3 h = normalize(l + v);
  float NoV = clamp(abs(dot(n, v)), 1e-4, 1.0);
  float NoH = clamp(dot(n, h), 0.0, 1.0);
  float VoH = clamp(dot(v, h), 0.0, 1.0);
  vec3 F = F_Schlick(VoH, f0);
  vec3 specular = D_GGX(NoH, a) * V_SmithGGXCorrelated(NoV, NoL, a) * F * PI;
  return (diffuse * (1.0 - F) + specular) * radiance * NoL;
}

// The built-in 'studio' environment: a soft, bright overhead box over a darker floor, as a
// function of direction - no texture needed.
vec3 studio(vec3 d) {
  float up = d.y * 0.5 + 0.5;
  vec3 sky = mix(vec3(0.35, 0.36, 0.38), vec3(1.0), smoothstep(0.55, 0.95, up));
  vec3 floorColor = vec3(0.18, 0.17, 0.16);
  return mix(floorColor, sky, smoothstep(0.35, 0.55, up));
}

// Karis' analytic approximation of the split-sum environment BRDF.
vec3 envBRDF(vec3 f0, float roughness, float NoV) {
  vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
  vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
  vec4 r = roughness * c0 + c1;
  float a004 = min(r.x * r.x, exp2(-9.28 * NoV)) * r.x + r.y;
  vec2 ab = vec2(-1.04, 1.04) * a004 + r.zw;
  return f0 * ab.x + ab.y;
}
#endif

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

void main() {
  vec4 base = vec4(uColor * vColor, uOpacity);
#ifdef MAP
  base *= texture(uMap, vUv); // sRGB textures are decoded to linear by the hardware
#endif

#ifdef LIT
#ifdef FLAT_SHADING
  vec3 n = normalize(cross(dFdx(vWorldPosition), dFdy(vWorldPosition)));
#else
  vec3 n = normalize(vNormal);
#endif
#ifdef DOUBLE_SIDED
  if (!gl_FrontFacing) n = -n;
#endif
  vec3 v = normalize(uCameraPosition - vWorldPosition);
  float roughness = clamp(uRoughness, 0.04, 1.0);
  float a = roughness * roughness;
  vec3 diffuse = base.rgb * (1.0 - uMetalness);
  vec3 f0 = mix(vec3(0.04), base.rgb, uMetalness);

  vec3 color = vec3(0.0);
  for (int i = 0; i < ${MAX_DIRECTIONAL}; i++) {
    if (i >= uDirectionalCount) break;
    color += shade(n, v, uDirectionalDirection[i], uDirectionalColor[i], diffuse, f0, a);
  }
  for (int i = 0; i < ${MAX_PUNCTUAL}; i++) {
    if (i >= uPunctualCount) break;
    vec3 toLight = uPunctualPosition[i] - vWorldPosition;
    float d = length(toLight);
    vec3 l = toLight / max(d, 1e-4);
    // inverse square, faded to zero at range (KHR_lights_punctual)
    float falloff = 1.0 / max(d * d, 1e-4);
    float range = uPunctualRange[i];
    if (range > 0.0) falloff *= pow(clamp(1.0 - pow(d / range, 4.0), 0.0, 1.0), 2.0);
    float cosAngle = dot(-l, uPunctualDirection[i]);
    float cone = smoothstep(uPunctualCone[i].x, uPunctualCone[i].y, cosAngle);
    color += shade(n, v, l, uPunctualColor[i] * falloff * cone, diffuse, f0, a);
  }

  // ambient: flat, hemisphere and environment light
  vec3 irradiance = uAmbient + mix(uHemisphereGround, uHemisphereSky, n.y * 0.5 + 0.5);
  float NoV = clamp(abs(dot(n, v)), 1e-4, 1.0);
  vec3 brdf = envBRDF(f0, roughness, NoV);
  vec3 ambientSpecular = vec3(0.0);
  if (uEnvironment == 1) {
    irradiance += studio(n) * 0.35;
    vec3 r = reflect(-v, n);
    // rougher surfaces see a blurrier reflection: lean it towards the surface normal
    ambientSpecular = mix(studio(r), studio(n), roughness * roughness) * brdf;
  } else {
    ambientSpecular = irradiance * brdf * 0.5;
  }
  color += diffuse * irradiance + ambientSpecular;
  color += uEmissive;
  color = toneMap(color);
#else
  vec3 color = base.rgb + uEmissive;
#endif

  // premultiplied alpha, so the canvas composites correctly over the page
  fragColor = vec4(linearToSrgb(color) * base.a, base.a);
}
`

const POINTS_VERTEX = /* glsl */ `
layout(location = 0) in vec3 position;
layout(location = 3) in vec3 color;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;
uniform float uSize;        // pixels (with the pixel ratio applied), or world units when attenuated
uniform float uScale;       // projection focal term x half the buffer height: world size -> pixels at depth 1

out vec3 vColor;

${COMMON}

void main() {
  vec4 viewPosition = uView * uModel * vec4(position, 1.0);
  gl_Position = uProjection * viewPosition;
#ifdef SIZE_ATTENUATION
  gl_PointSize = uSize * uScale / max(-viewPosition.z, 1e-4);
#else
  gl_PointSize = uSize;
#endif
  vColor = vec3(1.0);
#ifdef VERTEX_COLORS
  vColor = srgbToLinear(color);
#endif
}
`

const POINTS_FRAGMENT = /* glsl */ `
precision highp float;
in vec3 vColor;
uniform vec3 uColor;
uniform float uOpacity;
#ifdef MAP
uniform sampler2D uMap;
#endif
out vec4 fragColor;

${COMMON}

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
  fragColor = vec4(linearToSrgb(base.rgb) * base.a, base.a);
}
`

const LINES_VERTEX = /* glsl */ `
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

${COMMON}

void main() {
  vec4 a = uView * uModel * vec4(segmentStart, 1.0);
  vec4 b = uView * uModel * vec4(segmentEnd, 1.0);
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
  // extend past each end by half the width so joins look continuous
  vec2 offset = normal * corner.y * uWidth * 0.5 + dir * (corner.x * 2.0 - 1.0) * uWidth * 0.5;
  clip.xy += offset / (uResolution * 0.5) * clip.w;
  gl_Position = clip;

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

void main() {
  vec3 color = uColor * vColor;
  fragColor = vec4(linearToSrgb(color) * uOpacity, uOpacity);
}
`

const SOURCES = {
  mesh: [MESH_VERTEX, MESH_FRAGMENT],
  points: [POINTS_VERTEX, POINTS_FRAGMENT],
  lines: [LINES_VERTEX, LINES_FRAGMENT],
}

/**
 * Vertex and fragment source for a kind of drawable with a set of feature defines.
 * @param {'mesh' | 'points' | 'lines'} kind
 * @param {string[]} defines e.g. ['LIT', 'MAP']
 * @returns {[string, string]}
 */
export function shaderSource(kind, defines) {
  const header = `#version 300 es\n${defines.map((d) => `#define ${d}\n`).join('')}`
  const [vs, fs] = SOURCES[kind]
  return [header + vs, header + fs]
}
