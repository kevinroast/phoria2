// Made by scripts/dfg-fit.mjs - don't edit by hand. The environment BRDF's split-sum terms for
// phoria2's GGX and height-correlated Smith, fitted: within 0.033 (scale) and
// 0.038 (bias) of the integral for roughness 0.04 - 1 and NoV 0.02 - 1, 0.0034 and
// 0.0024 on average.

/** GLSL: vec2 envDFG(float roughness, float NoV) - the scale on f0 and the bias on f90. */
export const ENV_DFG = /* glsl */ `
vec2 envDFG(float roughness, float NoV) {
  float nv = max(NoV, 0.02000000);
  vec4 rs = vec4(roughness, roughness * roughness, roughness * roughness * roughness, roughness * roughness * roughness * roughness);
  float s5 = pow(1.0 - nv, 5.0);
  float a0 = 0.5636025 + dot(rs, vec4(9.187616, -37.45804, 51.13772, -22.76864));
  float a1 = 0.9774128 + dot(rs, vec4(-20.94024, 85.81773, -121.6232, 55.26735));
  float a2 = -0.5279158 + dot(rs, vec4(11.45833, -46.13463, 64.98938, -29.63646));
  float a3 = -0.6946747 + dot(rs, vec4(-7.561519, 41.74985, -61.31875, 28.11502));
  float a4 = 2.984214 + dot(rs, vec4(-55.89252, 178.5631, -206.5873, 80.33595));
  float b0 = 0.03651629 + dot(rs, vec4(-3.870119, 18.43356, -27.28380, 12.78031));
  float b1 = -0.07513286 + dot(rs, vec4(9.221263, -43.97966, 65.16304, -30.55959));
  float b2 = 0.03828718 + dot(rs, vec4(-5.432348, 25.94300, -38.47334, 18.06021));
  float b3 = 1.138728 + dot(rs, vec4(0.3014856, -14.54671, 25.92790, -12.88104));
  float b4 = -1.166610 + dot(rs, vec4(40.37988, -156.4034, 207.3543, -90.66280));
  vec2 dfg = vec2(a0 + a1 * nv + a2 * nv * nv + a3 * s5 + a4 * s5 * nv, b0 + b1 * nv + b2 * nv * nv + b3 * s5 + b4 * s5 * nv);
  return clamp(dfg, 0.0, 1.0);
}
`
