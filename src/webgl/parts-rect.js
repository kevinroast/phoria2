// The GLSL of rect-area lights - their uniforms, the LTC integral, and their light on a surface -
// registered with the lookup tables they read (Ltc): a frame has no rect lights until those are in,
// so NUM_RECT is 0 and these parts' #if leaves them out (see parts.js). Each part fills the
// `#pragma part` line of its name in shaders.js.
import { throughLight } from './shaders.js'

/** Each part's GLSL, by the name its `#pragma part` line gives. */
export const RECT_PARTS = {
  'rect-uniforms': /* glsl */ `
uniform vec3 uRectPosition[NUM_RECT];    // its middle
uniform vec3 uRectColor[NUM_RECT];       // what its face gives off: colour x intensity x PI / area
uniform vec3 uRectHalfWidth[NUM_RECT];   // half its width, along it
uniform vec3 uRectHalfHeight[NUM_RECT];  // half its height, along it - width x height points against the way it shines
uniform sampler2D uLtcMatrix;            // the lobe's transform (inverted), by roughness and view angle
uniform sampler2D uLtcAmplitude;         // the highlight's size, and its Fresnel part
#ifdef SPOT_SHADOWS
uniform float uRectShadow[NUM_RECT];     // which spot shadow tile is its, or -1
#endif

// one edge's part of the polygon's vector form factor - a fit to theta / sin(theta) (Hill and Heitz)
vec3 ltcEdge(vec3 a, vec3 b) {
  float x = dot(a, b);
  float y = abs(x);
  float t = (0.8543985 + (0.4965155 + 0.0145206 * y) * y) / (3.4175940 + (4.1616724 + y) * y);
  float thetaOverSin = x > 0.0 ? t : 0.5 * inversesqrt(max(1.0 - x * x, 1e-7)) - t;
  return cross(a, b) * thetaOverSin;
}

// the rectangle seen through a cosine lobe transformed by mInv: its corners into the lobe's space
// round the normal, onto the sphere, and the form factor of the part above the horizon
float ltcIntegral(vec3 n, vec3 v, mat3 mInv, vec3 corners[4]) {
  vec3 t = v - n * dot(v, n);
  // looking straight down the normal: any way across it will do
  t = dot(t, t) > 1e-8 ? normalize(t) : normalize(cross(n, abs(n.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
  mat3 m = mInv * transpose(mat3(t, -cross(n, t), n));
  vec3 c0 = normalize(m * (corners[0] - vWorldPosition));
  vec3 c1 = normalize(m * (corners[1] - vWorldPosition));
  vec3 c2 = normalize(m * (corners[2] - vWorldPosition));
  vec3 c3 = normalize(m * (corners[3] - vWorldPosition));
  vec3 f = ltcEdge(c0, c1) + ltcEdge(c1, c2) + ltcEdge(c2, c3) + ltcEdge(c3, c0);
  // clipped to the horizon: a sphere's form factor as an approximation (Hill and Heitz)
  float l = length(f);
  return max((l * l + f.z) / (l + 1.0), 0.0);
}
`,
  'rect-lights': /* glsl */ `
  {
    // the lobe for this roughness and view angle - tables of 64 x 64, read at their texels' middles
    vec2 ltcUv = vec2(roughness, sqrt(1.0 - clamp(dot(n, v), 0.0, 1.0))) * (63.0 / 64.0) + 0.5 / 64.0;
    vec4 t1 = texture(uLtcMatrix, ltcUv);
    vec2 t2 = texture(uLtcAmplitude, ltcUv).xy;
    mat3 glossLobe = mat3(vec3(t1.x, 0.0, t1.y), vec3(0.0, 1.0, 0.0), vec3(t1.z, 0.0, t1.w));
    // the highlight's Fresnel, over the lobe (Hill)
    vec3 rectF = f0 * t2.x + (f90 - f0) * t2.y;
#ifdef CLEARCOAT
    vec2 coatUv = vec2(coatRoughness, sqrt(1.0 - clamp(dot(surfaceNormal, v), 0.0, 1.0))) * (63.0 / 64.0) + 0.5 / 64.0;
    vec4 c1 = texture(uLtcMatrix, coatUv);
    vec2 c2 = texture(uLtcAmplitude, coatUv).xy;
    mat3 coatLobe = mat3(vec3(c1.x, 0.0, c1.y), vec3(0.0, 1.0, 0.0), vec3(c1.z, 0.0, c1.w));
    float coatF = 0.04 * c2.x + 0.96 * c2.y;
#endif
    for (int i = 0; i < NUM_RECT; i++) {
      vec3 hw = uRectHalfWidth[i], hh = uRectHalfHeight[i];
      vec3 toLight = uRectPosition[i] - vWorldPosition;
      vec3 facing = normalize(cross(hh, hw));
      vec3 corners[4];
      corners[0] = uRectPosition[i] + hw - hh;
      corners[1] = uRectPosition[i] - hw - hh;
      corners[2] = uRectPosition[i] - hw + hh;
      corners[3] = uRectPosition[i] + hw + hh;
      float d = length(toLight);
      vec3 l = toLight / max(d, 1e-4);
      // it shines from its front face only - chosen, not branched round, so the shadow lookup below
      // stays in uniform control flow (a branch there makes D3D's compiler flatten it, slowly)
      vec3 emitted = dot(toLight, facing) < 0.0 ? uRectColor[i] : vec3(0.0);
      vec3 radiance = emitted;
#ifdef SPOT_SHADOWS
      float tile = uRectShadow[i];
      if (tile >= 0.0) radiance *= spotShadow(int(tile), surfaceNormal, d);
#endif
      // as a point light at its middle: its whole face's light, falling off with the square of the distance
      float asPoint = 4.0 * length(hw) * length(hh) / PI * max(dot(-l, facing), 0.0) / max(d * d, 1e-4);
#ifdef TOON
      color += shade(n, v, l, radiance * asPoint, diffuse, f0, f90, a);
#else
      color += radiance * (diffuse * (1.0 - rectF) * ltcIntegral(n, v, mat3(1.0), corners) + rectF * ltcIntegral(n, v, glossLobe, corners));
#endif
#ifdef CLEARCOAT
      coat += radiance * coatF * ltcIntegral(surfaceNormal, v, coatLobe, corners);
#endif
#ifdef SHEEN
      sheen += sheenShade(n, v, l, radiance * asPoint, sheenRoughness * sheenRoughness);
#endif
${throughLight(`vec3 light = emitted * asPoint;
#ifdef SPOT_SHADOWS
      if (tile >= 0.0) light *= spotShadow(int(tile), -surfaceNormal, d);
#endif`)}
    }
  }
`,
}
