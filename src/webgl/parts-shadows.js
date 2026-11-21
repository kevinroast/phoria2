// The GLSL that reads shadow maps - the sun's, spot lights' tiles, a point light's cube, their soft
// (contact-hardening) edges, and the texel debug view - registered by the passes that draw the maps
// (Passes), so it is here whenever a frame has a shadow to receive (see parts.js). Each part fills the
// `#pragma part` line of its name in shaders.js, inside the same #if it was written in.
import { BLUE_NOISE_SIZE } from '../shadow.js'

/** Each part's GLSL, by the name its `#pragma part` line gives. */
export const SHADOW_PARTS = {
  'shadow-soft': /* glsl */ `
// Contact-hardening soft shadows (PCSS): look round for what casts the shadow and how far above the
// surface it is, then filter the edge that much wider - sharp where an object meets what it stands
// on, soft further off. Points over a disc (a Vogel spiral). The search uses them as they are, so
// neighbouring pixels agree on how wide the edge is, and counts each less the further out it is - so
// a caster coming into reach eases the estimate along rather than jumping it, which shows as bands
// down a long shadow; the filter turns them by a random angle at each pixel, so its few samples blur
// to an even grain rather than banding.
const int SOFT_SEARCH = 32;
// the filter's taps: more the wider it is, so a wide edge - a big light's - is as smooth as a narrow
// one, up to SOFT_FILTER_MAX; and how wide it may get, in texels
const int SOFT_FILTER_MAX = 64;
const float SOFT_RADIUS_MAX = 160.0;
int softTaps(float texels) {
  return texels > 40.0 ? 64 : texels > 12.0 ? 48 : 32;
}
// how much a search sample counts: 1 at the middle, fading to nothing at the edge
float softWeight(int i) {
  return 1.0 - (float(i) + 0.5) / float(SOFT_SEARCH);
}
vec2 softTap(int i, int count, float spin) {
  float r = sqrt((float(i) + 0.5) / float(count));
  float a = float(i) * 2.39996323 + spin;
  return vec2(cos(a), sin(a)) * r;
}
// Where the search looks: its spiral, turned the pixel's own way, and last the pixel's own spot - so a
// caster thinner than the spiral's spacing (a gnomon, a pole) is never missed right under it. Turned:
// in one fixed pattern each sample would draw a copy of a caster's outline across the edge, as it
// crosses it, sliding as the light moves; turned per pixel the copies blur to a fine grain.
vec2 softSearchTap(int i, float reach, float spin) {
  return i == SOFT_SEARCH ? vec2(0.0) : softTap(i, SOFT_SEARCH, spin) * reach;
}
// The gap to size the edge by: the average of what the spiral found (world units, 0 where it found
// nothing), each sample counting less the further out it was - and then the nearer casters counting
// more: beside where a thing stands the search also finds its far, high parts, and a plain average
// sized the edge by those, widening it at the contact so the shadow started a little away from what
// casts it. The pixel's own spot only says whether
// a caster is there - counted in the average, its depth (read a whole texel at a time) would step the
// edge's width from texel to texel - and gives the gap only when the spiral missed a thin caster
// altogether. 0 when nothing was found.
float softGap(float gaps[SOFT_SEARCH + 1]) {
  float sum = 0.0, weight = 0.0;
  for (int i = 0; i < SOFT_SEARCH; i++) {
    if (gaps[i] > 0.0) {
      float k = softWeight(i);
      sum += gaps[i] * k;
      weight += k;
    }
  }
  if (weight == 0.0) return gaps[SOFT_SEARCH];
  // again, the nearer casters counting more: one over their gap plus a quarter of the plain average.
  // Not one over the gap alone - where a high caster's shadow crosses a low one (slats over a post's
  // foot, a vine over a rock) the few samples on the low one outweighed all the rest a hundred to one,
  // and whether a pixel's turned search caught them made its edge sharp or soft, pixel to pixel
  float soften = 0.25 * sum / weight;
  float near = 0.0, nearWeight = 0.0;
  for (int i = 0; i < SOFT_SEARCH; i++) {
    if (gaps[i] > 0.0) {
      float k = softWeight(i) / (gaps[i] + soften);
      near += gaps[i] * k;
      nearWeight += k;
    }
  }
  return near / nearWeight;
}
// how much of the push along the normal the soft lookups use: they compare each sample along the
// surface's slope, which already keeps it from shadowing itself, and the full push lifts a shadow
// off a contact a few millimetres tall (a gnomon on its dial)
const float SOFT_PUSH = 0.25;
// A pixel's own angle to turn the sample discs by, from a 64 x 64 tile of blue noise repeated across
// the screen: neighbours' angles as different as can be, with no clumps (white noise) and no axis or
// lattice (interleaved gradient noise, R2) - so the samples' error shows as fine, even grain. A refine
// sample shifts the tile (uBlueNoiseShift), so each pixel's angle differs from sample to sample and
// the grain averages away.
uniform sampler2D uBlueNoise;
uniform ivec2 uBlueNoiseShift;
float softSpin() {
  return 6.2831853 * texelFetch(uBlueNoise, (ivec2(gl_FragCoord.xy) + uBlueNoiseShift) & ${BLUE_NOISE_SIZE - 1}, 0).r;
}
// a perspective map's depth (0-1) as a distance from the light
float softDistance(float d, float near, float far) {
  return near * far / (far - d * (far - near));
}
// How the surface's depth in the map changes across the map, so a sample beside this point is
// compared at the surface's depth there, not this point's: without it the wide filter sees a sloped
// or curved surface shadow itself, as fine hatching. From the normal and how world space maps to the
// map's coordinates (a, b) and depth (g) here - no screen derivatives, so it is safe inside the light
// loops - and capped at the steepest slope worth trusting.
vec2 softSlope(vec3 n, vec3 a, vec3 b, vec3 g, float limit) {
  vec3 e1 = normalize(cross(n, abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 e2 = cross(n, e1);
  mat2 j = mat2(dot(a, e1), dot(b, e1), dot(a, e2), dot(b, e2));
  if (abs(determinant(j)) < 1e-14) return vec2(0.0);
  vec2 slope = transpose(inverse(j)) * vec2(dot(g, e1), dot(g, e2));
  float len = length(slope);
  return len > limit ? slope * (limit / len) : slope;
}
`,
  'shadow': /* glsl */ `
// 0 in shadow to 1 lit: nine hardware-filtered comparisons, for a soft edge a few texels wide
float shadowAt(vec3 n, vec3 l) {
  // push the lookup out along the normal, more on surfaces turned away from the light
  vec3 p = vWorldPosition + n * uShadowBias * (1.0 - 0.5 * clamp(dot(n, l), 0.0, 1.0));
  vec4 s = uShadowMatrix * vec4(p, 1.0);
  vec3 c = s.xyz / s.w;
  if (c.x <= 0.0 || c.x >= 1.0 || c.y <= 0.0 || c.y >= 1.0 || c.z >= 1.0) return 1.0;
#ifdef SHADOW_SOFT
  {
  vec3 c = (uShadowMatrix * vec4(mix(vWorldPosition, p, SOFT_PUSH), 1.0)).xyz;
  float spin = softSpin();
  // the map is orthographic: its coordinates and depth change with world position by its matrix's rows
  vec3 a = vec3(uShadowMatrix[0][0], uShadowMatrix[1][0], uShadowMatrix[2][0]);
  vec3 b = vec3(uShadowMatrix[0][1], uShadowMatrix[1][1], uShadowMatrix[2][1]);
  vec3 g = vec3(uShadowMatrix[0][2], uShadowMatrix[1][2], uShadowMatrix[2][2]);
  // no steeper than about 80 degrees: depth units a unit of the map's coordinates
  vec2 slope = softSlope(n, a, b, g, 6.0 / (uShadowSoft.y * uShadowSoft.z));
  // the casters that could shade this point lie within the widest edge it could have
  float reach = clamp(c.z * uShadowSoft.y * uShadowSoft.x * uShadowSoft.z, uShadowTexel * 1.5, uShadowTexel * SOFT_RADIUS_MAX);
  // how far above the surface what it finds is, in world units: under a couple of texels is the
  // surface's own relief, not a caster
  float tiny = 2.5 * uShadowTexel / uShadowSoft.z;
  float gaps[SOFT_SEARCH + 1];
  for (int i = 0; i <= SOFT_SEARCH; i++) {
    vec2 o = softSearchTap(i, reach, spin);
    float z = c.z + dot(slope, o);
    float gi = (z - texture(uShadowDepth, c.xy + o).r) * uShadowSoft.y;
    gaps[i] = gi > tiny ? gi : 0.0;
  }
  // the edge as wide as the nearest casters are far - or, finding none, the plain lookup below
  float gap = softGap(gaps);
  if (gap > 0.0) {
    float radius = clamp(gap * uShadowSoft.x * uShadowSoft.z, uShadowTexel * 1.5, uShadowTexel * SOFT_RADIUS_MAX);
    int taps = softTaps(radius / uShadowTexel);
    float soft = 0.0;
    for (int i = 0; i < SOFT_FILTER_MAX; i++) {
      if (i >= taps) break;
      vec2 o = softTap(i, taps, spin + 1.7) * radius;
      soft += texture(uShadowMap, vec3(c.xy + o, c.z + dot(slope, o)));
    }
    return soft / float(taps);
  }
  }
#endif
  float lit = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) lit += texture(uShadowMap, vec3(c.xy + vec2(x, y) * uShadowTexel * 1.5, c.z));
  }
  return lit / 9.0;
}
`,
  'spot-shadows': /* glsl */ `
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
#ifdef SPOT_SHADOWS_SOFT
  vec4 softness = uSpotShadowSoft[k];
  if (softness.x != 0.0) {
    vec4 s = uSpotShadowMatrix[k] * vec4(mix(vWorldPosition, p, SOFT_PUSH), 1.0);
    vec3 c = s.xyz / s.w;
    float spin = softSpin();
    float here = softDistance(c.z, softness.y, softness.z);
    // a rect light's samples spread as it does: an ellipse along its width and height (a spot's a circle)
    vec4 shape = uSpotShadowShape[k];
    mat2 shaped = mat2(shape.xy * shape.z, vec2(-shape.y, shape.x) * shape.w);
    // a perspective map: how its coordinates and depth change with world position here
    mat4 m = uSpotShadowMatrix[k];
    vec3 r3 = vec3(m[0][3], m[1][3], m[2][3]);
    vec3 a = (vec3(m[0][0], m[1][0], m[2][0]) - c.x * r3) / s.w;
    vec3 b = (vec3(m[0][1], m[1][1], m[2][1]) - c.y * r3) / s.w;
    vec3 g = (vec3(m[0][2], m[1][2], m[2][2]) - c.z * r3) / s.w;
    // no steeper than about 80 degrees: depth a world unit along the light, over coordinates a world unit across it
    float depthPerWorld = softness.y * softness.z / ((softness.z - softness.y) * here * here);
    vec2 slope = softSlope(n, a, b, g, 6.0 * depthPerWorld * here / softness.w);
    // the widest edge it could have: from a caster as near the light as any is (the view's near plane,
    // fitted to them), as far from this point as it can be - a rect light's (softness.x minus its
    // radius) the wider the nearer the caster is to it
    float before = max(here - softness.y, 0.0);
    float reach = clamp((softness.x > 0.0 ? softness.x : -softness.x / softness.y) * before * softness.w / here, uSpotShadowTexel * 1.5, uSpotShadowTexel * SOFT_RADIUS_MAX);
    float tiny = 2.5 * uSpotShadowTexel * here / softness.w;
    float gaps[SOFT_SEARCH + 1];
    for (int i = 0; i <= SOFT_SEARCH; i++) {
      vec2 o = shaped * softSearchTap(i, reach, spin);
      float z = c.z + dot(slope, o);
      float d = texture(uSpotShadowDepth, clamp(c.xy + o, lo, hi)).r;
      float gi = d < z ? softDistance(z, softness.y, softness.z) - softDistance(d, softness.y, softness.z) : 0.0;
      gaps[i] = gi > tiny ? gi : 0.0;
    }
    float gap = softGap(gaps);
    if (gap > 0.0) {
    // a rect light's edge as wide as its size makes it: the gap over the distance from the light to what casts
    float spread = softness.x > 0.0 ? softness.x : -softness.x / max(here - gap, 1e-3);
    float radius = clamp(gap * spread * softness.w / here, uSpotShadowTexel * 1.5, uSpotShadowTexel * SOFT_RADIUS_MAX);
    int taps = softTaps(radius / uSpotShadowTexel);
    float soft = 0.0;
    for (int i = 0; i < SOFT_FILTER_MAX; i++) {
      if (i >= taps) break;
      vec2 o = shaped * (softTap(i, taps, spin + 1.7) * radius);
      soft += texture(uSpotShadowMap, vec3(clamp(c.xy + o, lo, hi), c.z + dot(slope, o)));
    }
    return soft / float(taps);
    }
  }
#endif
  float lit = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) lit += texture(uSpotShadowMap, vec3(clamp(c.xy + vec2(x, y) * uSpotShadowTexel * 1.5, lo, hi), c.z));
  }
  return lit / 9.0;
}
`,
  'point-shadow': /* glsl */ `
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
#ifdef POINT_SHADOW_SOFT
  {
    // across the way from the light, in units of the direction: a world unit at distance z is 1 / z.
    // Each sample is compared at the surface's own distance along its ray - where that ray meets
    // the plane the surface lies in here - so a sloped or curved surface doesn't shadow itself
    vec3 d = vWorldPosition + n * uPointShadowBias * distance * SOFT_PUSH - light;
    vec3 a = abs(d);
    float z = max(a.x, max(a.y, a.z));
    vec3 dir = d / length(d);
    vec3 u = normalize(cross(dir, abs(dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 w = cross(dir, u);
    float spin = softSpin();
    float facing = dot(n, dir);
    // the widest edge it could have, from a caster as near the light as the cube's near plane
    float reach = clamp(uPointShadowSoft * max(z - near, 0.0) / z, uPointShadowTexel * 1.5, uPointShadowTexel * SOFT_RADIUS_MAX);
    float tiny = 2.5 * uPointShadowTexel * z;
    float gaps[SOFT_SEARCH + 1];
    for (int i = 0; i <= SOFT_SEARCH; i++) {
      vec2 t = softSearchTap(i, reach, spin);
      vec3 ray = dir + u * t.x + w * t.y;
      float zt = z * clamp(facing / dot(n, normalize(ray)), 0.5, 2.0);
      float gi = zt - softDistance(texture(uPointShadowDepth, ray).r, near, far);
      gaps[i] = gi > tiny ? gi : 0.0;
    }
    float gap = softGap(gaps);
    if (gap > 0.0) {
    float radius = clamp(gap * uPointShadowSoft / z, uPointShadowTexel * 1.5, uPointShadowTexel * SOFT_RADIUS_MAX);
    int taps = softTaps(radius / uPointShadowTexel);
    float soft = 0.0;
    for (int i = 0; i < SOFT_FILTER_MAX; i++) {
      if (i >= taps) break;
      vec2 t = softTap(i, taps, spin + 1.7) * radius;
      vec3 ray = dir + u * t.x + w * t.y;
      float zt = z * clamp(facing / dot(n, normalize(ray)), 0.5, 2.0);
      soft += texture(uPointShadowMap, vec4(ray, 0.5 * ((far + near) / (far - near) - 2.0 * far * near / ((far - near) * zt)) + 0.5));
    }
    return soft / float(taps);
    }
  }
#endif
  float spread = uPointShadowTexel * 1.5;
  float lit = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) lit += texture(uPointShadowMap, vec4(dir + (u * float(x) + w * float(y)) * spread, depth));
  }
  return lit / 9.0;
}
`,
  'shadow-texels': /* glsl */ `
// view.debug.shadows: 'texels' - the texel of a shadow map this point falls in, as a checkerboard tint:
// the sun's map first, then a spot light's tile, then the point light's cube. Big squares mean the map
// is spread thin, so its edges blur or step.
vec3 shadowTexels(vec3 color) {
  // where it is in the map, in texels
  vec2 at = vec2(0.0);
  bool found = false;
#ifdef SHADOW
  {
    vec4 s = uShadowMatrix * vec4(vWorldPosition, 1.0);
    vec2 c = s.xy / s.w;
    if (c.x > 0.0 && c.x < 1.0 && c.y > 0.0 && c.y < 1.0) {
      at = c / uShadowTexel;
      found = true;
    }
  }
#endif
#ifdef SPOT_SHADOWS
  for (int k = 0; k < 4; k++) {
    if (found) break;
    vec4 s = uSpotShadowMatrix[k] * vec4(vWorldPosition, 1.0);
    if (s.w <= 0.0) continue;
    vec2 c = s.xy / s.w;
    vec4 tile = uSpotShadowTile[k];
    if (c.x > tile.x && c.x < tile.z && c.y > tile.y && c.y < tile.w) {
      at = c / uSpotShadowTexel;
      found = true;
    }
  }
#endif
#ifdef POINT_SHADOW
  for (int i = 0; i < NUM_PUNCTUAL; i++) {
    if (found || float(i) != uPointShadowIndex) continue;
    // the cube face it falls on, and where on that face
    vec3 d = vWorldPosition - uPunctualPosition[i];
    vec3 a = abs(d);
    vec2 uv = a.x >= a.y && a.x >= a.z ? d.yz / a.x : a.y >= a.z ? d.xz / a.y : d.xy / a.z;
    float face = a.x >= a.y && a.x >= a.z ? 0.0 : a.y >= a.z ? 1.0 : 2.0;
    at = (uv * 0.5 + 0.5) * (2.0 / uPointShadowTexel) + face * 4096.0;
    found = true;
  }
#endif
  // texels smaller than three pixels or so would alias into moire or hatching - and are fine anyway:
  // shown only where a texel is big enough to see as a square
  vec2 perPixel = fwidth(at);
  float shown = 1.0 - smoothstep(0.22, 0.36, max(perPixel.x, perPixel.y));
  if (!found || shown <= 0.0) return color;
  vec2 cell = floor(at);
  float odd = mod(cell.x + cell.y, 2.0);
  // the surface repainted in strong blue and orange squares at its own brightness - the orange a
  // little lighter, so they differ in tone as well as hue - with a little light of their own, so they
  // show in the dark and deep in shadow
  vec3 square = mix(vec3(0.1, 0.4, 1.0) * 0.8, vec3(1.0, 0.5, 0.1) * 1.25, odd);
  float tone = dot(color, vec3(0.2126, 0.7152, 0.0722));
  return mix(color, square * (tone * 1.5 + 0.05), 0.8 * shown);
}
`,
}
