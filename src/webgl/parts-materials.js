// The GLSL of the less common surface features - a thin film's iridescence, brushed metal's
// stretched highlights, toon tones, cloth's sheen, a clear coat, and glass bending what is behind it -
// loaded the first time a material has one (see parts.js). Until then that material waits, as one
// whose program is still compiling does. Each part fills the `#pragma part` line of its name in
// shaders.js, inside the same #ifdef it was written in.
/** Each part's GLSL, by the name its `#pragma part` line gives - registered by parts.js when loaded. */
export const MATERIAL_PARTS = {
  'iridescence': /* glsl */ `
// A thin film's interference (Belcour and Barla 2017, as KHR_materials_iridescence and three.js
// have it): the film's reflectance at an angle, over a base of reflectance f0 - the colours of soap
// bubbles and oil on water. Thicknesses in nanometres.
const mat3 XYZ_TO_REC709 = mat3(
   3.2404542, -0.9692660,  0.0556434,
  -1.5371385,  1.8760108, -0.2040259,
  -0.4985314,  0.0415560,  1.0572252);

float filmSchlick(float f0, float c) {
  return f0 + (1.0 - f0) * pow(1.0 - c, 5.0);
}

// the eye's response to a path difference, as an RGB colour: a fit to the CIE colour matching functions
vec3 filmSensitivity(float opd, vec3 shift) {
  float phase = 2.0 * PI * opd * 1.0e-9;
  vec3 val = vec3(5.4856e-13, 4.4201e-13, 5.2481e-13);
  vec3 pos = vec3(1.6810e+06, 1.7953e+06, 2.2084e+06);
  vec3 spread = vec3(4.3278e+09, 9.3046e+09, 6.6121e+09);
  vec3 xyz = val * sqrt(2.0 * PI * spread) * cos(pos * phase + shift) * exp(-phase * phase * spread);
  xyz.x += 9.7470e-14 * sqrt(2.0 * PI * 4.5282e+09) * cos(2.2399e+06 * phase + shift.x) * exp(-4.5282e+09 * phase * phase);
  return XYZ_TO_REC709 * (xyz / 1.0685e-7);
}

vec3 filmFresnel(float filmIor, float cosTheta1, float thickness, vec3 baseF0) {
  // a film too thin to see fades to none
  float eta = mix(1.0, filmIor, smoothstep(0.0, 0.03, thickness));
  float sin2 = (1.0 - cosTheta1 * cosTheta1) / (eta * eta);
  float cos2Sq = 1.0 - sin2;
  if (cos2Sq < 0.0) return vec3(1.0);
  float cosTheta2 = sqrt(cos2Sq);
  // air to film
  float r12 = filmSchlick(pow((eta - 1.0) / (eta + 1.0), 2.0), cosTheta1);
  float t121 = 1.0 - r12;
  float phi12 = eta < 1.0 ? PI : 0.0;
  float phi21 = PI - phi12;
  // film to base: the base's index from its reflectance
  vec3 s = sqrt(clamp(baseF0, 0.0, 0.9999));
  vec3 baseIor = (1.0 + s) / (1.0 - s);
  vec3 r1 = pow((baseIor - eta) / (baseIor + eta), vec3(2.0));
  vec3 r23 = r1 + (1.0 - r1) * pow(1.0 - cosTheta2, 5.0);
  vec3 phi23 = vec3(baseIor.x < eta ? PI : 0.0, baseIor.y < eta ? PI : 0.0, baseIor.z < eta ? PI : 0.0);
  float opd = 2.0 * eta * thickness * cosTheta2;
  vec3 phi = vec3(phi21) + phi23;
  vec3 r123 = clamp(r12 * r23, 1e-5, 0.9999);
  vec3 sr123 = sqrt(r123);
  vec3 rs = t121 * t121 * r23 / (1.0 - r123);
  vec3 result = r12 + rs;
  vec3 cm = rs - t121;
  for (int m = 1; m <= 2; m++) {
    cm *= sr123;
    result += cm * 2.0 * filmSensitivity(float(m) * opd, float(m) * phi);
  }
  return max(result, vec3(0.0));
}

// the reflectance face on that Schlick's curve would need to give f at this angle - so the film's
// colours ride through the lights and the environment as f0 does
vec3 filmF0(vec3 f, float f90, float c) {
  float x = clamp(1.0 - c, 0.0, 1.0);
  float x5 = clamp(x * x * x * x * x, 0.0, 0.9999);
  return clamp((f - f90 * x5) / (1.0 - x5), 0.0, 1.0);
}
`,
  'anisotropy': /* glsl */ `
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
`,
  'toon': /* glsl */ `
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
`,
  'sheen': /* glsl */ `
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
`,
  'clearcoat': /* glsl */ `
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
`,
  'refraction': /* glsl */ `
// what is behind, as glass bends it: the view's ray turned at the surface by the ior and carried
// through the glass's thickness, then looked up where it comes out - at a blurrier level the rougher
// the glass (as glTF's reference renderer and three.js do: by roughness, scaled by how much the ior
// bends). A thin shell (thickness 0) doesn't bend it, but still blurs it. In the picture's own
// encoding, premultiplied
// how far light goes in glass, along a ray turned by an ior: a solid piece's thickness (as glTF has it),
// or across a thin wall that thick - further the more slanting, up to four times. A thickness map
// scales it: a vase's walls thin, its foot thick
float glassPath(vec3 r, vec3 n) {
  float t = uRefraction.y * vThicknessScale;
#ifdef THICKNESS_MAP
  t *= uThicknessMapTexel.g;
#endif
  return uRefraction.w > 0.0 ? t / max(abs(dot(r, n)), 0.25) : t;
}
vec2 bentTo(vec3 n, vec3 v, float ior) {
  // where the ray comes out: off the line it came in on by as much as the glass bends it - through a
  // thin wall, the sideways shift of a pane, out parallel to how it went in
  vec3 r = refract(-v, n, 1.0 / ior);
  vec4 clip = uViewProjection * vec4(vWorldPosition + r * glassPath(r, n), 1.0);
  return clamp(clip.xy / clip.w * 0.5 + 0.5, 0.0, 1.0);
}
vec4 behindGlass(vec3 n, vec3 v, float roughness) {
  float lod = log2(float(textureSize(uBehind, 0).x)) * roughness * clamp(uRefraction.x * 2.0 - 2.0, 0.0, 1.0);
  vec4 behind = textureLod(uBehind, bentTo(n, v, uRefraction.x), lod);
  // dispersion: each colour bent by an ior of its own, red least and blue most - fringes of colour
  // where what is behind changes. Refined, each sample spreads them a different amount, and the
  // three fringes average into a rainbow
  float spread = uRefraction.z * uSpectrum;
  if (spread > 0.0) {
    behind.r = textureLod(uBehind, bentTo(n, v, uRefraction.x - spread), lod).r;
    behind.b = textureLod(uBehind, bentTo(n, v, uRefraction.x + spread), lod).b;
  }
  return behind;
}
// what glass's body leaves of light on its way through - Beer-Lambert, over the path the light
// takes in it (glassPath): attenuationColor is what is left after attenuationDistance, and more glass
// tints deeper - a thin wall seen edge-on, as a bottle's sides are, the deepest
vec3 bodyTint(vec3 n, vec3 v) {
  if (uAttenuation.w <= 0.0) return vec3(1.0);
  return pow(max(uAttenuation.rgb, 1e-4), vec3(glassPath(refract(-v, n, 1.0 / uRefraction.x), n) / uAttenuation.w));
}
// what comes through glass, tinted by its colour as coloured glass tints light, in the picture's
// encoding - so laid over the glass as blending would lay what is behind
vec3 throughGlass(vec4 behind, vec3 tint) {
  if (behind.a <= 0.0) return vec3(0.0);
#ifdef LINEAR_OUTPUT
  return behind.rgb * tint;
#else
  return linearToSrgb(srgbToLinear(behind.rgb / behind.a) * tint) * behind.a;
#endif
}
`,
}
