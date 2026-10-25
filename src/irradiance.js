// Diffuse light from an environment image, for the renderer: computed once per environment.

/** @import { DataImage } from './material/Texture.js' */

/**
 * Diffuse light from an equirectangular environment, as nine spherical harmonic coefficients (RGB
 * each, flattened), scaled so the shader evaluates them with plain polynomial terms and gets
 * irradiance divided by PI - the light a white matte surface facing that way reflects.
 * @param {DataImage} image linear RGBA floats
 * @returns {Float32Array} 27 numbers
 */
export function irradianceSH({ data, width, height }) {
  const sh = new Float64Array(27)
  // sample a grid of at most 128 x 64 - plenty for the lowest frequencies
  const sx = Math.max(1, Math.floor(width / 128)), sy = Math.max(1, Math.floor(height / 64))
  const dPhi = (2 * Math.PI * sx) / width, dTheta = (Math.PI * sy) / height
  for (let y = 0; y < height; y += sy) {
    const theta = ((y + 0.5 * sy) / height) * Math.PI
    const sinT = Math.sin(theta), dy = Math.cos(theta)
    const weight = dPhi * dTheta * sinT
    for (let x = 0; x < width; x += sx) {
      const phi = ((x + 0.5 * sx) / width - 0.5) * 2 * Math.PI
      const dx = Math.cos(phi) * sinT, dz = Math.sin(phi) * sinT
      const basis = [1, dy, dz, dx, dx * dy, dy * dz, 3 * dz * dz - 1, dx * dz, dx * dx - dy * dy]
      const i = (y * width + x) * 4
      for (let k = 0; k < 9; k++) {
        const w = basis[k] * weight
        sh[k * 3] += data[i] * w
        sh[k * 3 + 1] += data[i + 1] * w
        sh[k * 3 + 2] += data[i + 2] * w
      }
    }
  }
  // projection uses the normalised basis Y = norm * polynomial, and evaluation multiplies by the
  // cosine lobe's band factors (PI, 2PI/3, PI/4) and norm again; then divide by PI
  const norm = [0.282095, 0.488603, 0.488603, 0.488603, 1.092548, 1.092548, 0.315392, 1.092548, 0.546274]
  const band = [1, 2 / 3, 2 / 3, 2 / 3, 1 / 4, 1 / 4, 1 / 4, 1 / 4, 1 / 4]
  const out = new Float32Array(27)
  for (let k = 0; k < 9; k++) {
    for (let c = 0; c < 3; c++) out[k * 3 + c] = sh[k * 3 + c] * norm[k] * norm[k] * band[k]
  }
  return out
}
