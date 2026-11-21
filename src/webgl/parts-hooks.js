// Functions every shader hook can call, loaded the first time a material has hooks (see parts.js) -
// until then that material waits, as one whose program is still compiling does. Hooks are statements,
// so they can't define their own. All of it is built on an integer bit-mix (lowbias32), which GLSL
// ES 3.00 defines exactly, so lattice values and gradients are the same on every GPU -
// fract(sin(x) * 43758.5453) is not. Everything 0-1:
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

/** As a part, by name (hooks.js splices it into each program with hooks). */
export const HOOK_PARTS = { 'hook-helpers': HOOK_HELPERS }
