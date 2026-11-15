// Refining a still view: while nothing changes, the view draws the scene again and again, each
// time a little differently, and shows the average - antialiased far past what multisampling does,
// with soft shadows exact rather than estimated. What differs from one sample to the next:
//   - where in its pixel the camera looks: the projection shifted by under a pixel, spread by a tent
//     filter (a picture's resolve, not a box's hard edge), and
//   - where on each casting light its shadow is drawn from (frame.js sampleLight) - a sun's or a
//     rect light's; a spot or point light keeps its soft shadow, and
//   - where soft shadows read their blue noise, so their grain averages away.
// Each comes from its own Halton sequence (2 and 3 the pixel, 5 and 7 the light, 11 and 13 the noise), so
// they never fall into step: one sequence shared between them would draw the same lattice every time,
// and averaging never removes a lattice.

/** @import { FrameDescription } from './frame.js' */

/** Samples the average holds before it is shown in place of the plain frame: fewer are a few hard shadows overlaid. */
export const REVEAL = 16

/**
 * The default number of samples: on a touch screen, where the GPU is a phone's, an eighth.
 * @returns {number}
 */
export function defaultSamples() {
  return globalThis.matchMedia?.('(pointer: coarse)').matches ? 32 : 256
}

/**
 * The nth number of the Halton sequence in a base: n's digits mirrored about the point - evenly
 * spread over 0 - 1 however far it is taken.
 * @param {number} n from 1 @param {number} base a prime
 */
export function halton(n, base) {
  let f = 1, r = 0
  while (n > 0) {
    f /= base
    r += f * (n % base)
    n = Math.floor(n / base)
  }
  return r
}

/** An even 0 - 1 mapped to -1 - 1 by a tent: most samples near the middle, none past a pixel. @param {number} u */
export function tent(u) {
  const t = 2 * u
  return t < 1 ? Math.sqrt(t) - 1 : 1 - Math.sqrt(2 - t)
}

/**
 * Sample n's light sample: a point in the unit square.
 * @param {number} n from 0
 * @returns {[number, number]}
 */
export function lightSample(n) {
  return [halton(n + 1, 5), halton(n + 1, 7)]
}

/**
 * Sample n's shift of soft shadows' 64 x 64 blue-noise tile, in texels: from Halton (11, 13), its own
 * sequences again.
 * @param {number} n from 0
 * @returns {[number, number]}
 */
export function noiseShift(n) {
  return [Math.floor(halton(n + 1, 11) * 64), Math.floor(halton(n + 1, 13) * 64)]
}

/**
 * Sample n's sub-pixel shift, in pixels, each way under one.
 * @param {number} n from 0
 * @returns {[number, number]}
 */
export function pixelShift(n) {
  return [tent(halton(n + 1, 2)), tent(halton(n + 1, 3))]
}

/**
 * Shift what a frame is drawn through by sample n's part of a pixel: its projection - and its view
 * projection with it - moved across the screen, after the perspective divide, so near and far move
 * alike. The frame's own camera is replaced, not changed: the camera's matrices are left alone.
 * @param {FrameDescription} frame @param {number} n from 0
 * @param {number} width @param {number} height the picture, in pixels
 */
export function jitterFrame(frame, n, width, height) {
  const [dx, dy] = pixelShift(n)
  const tx = (2 * dx) / width, ty = (2 * dy) / height
  /** @param {import('./value/Mat4.js').Mat4} m */
  const shift = (m) => {
    const out = m.clone()
    for (let c = 0; c < 4; c++) {
      out[c * 4] += tx * m[c * 4 + 3]
      out[c * 4 + 1] += ty * m[c * 4 + 3]
    }
    return out
  }
  frame.camera = { ...frame.camera, projection: shift(frame.camera.projection), viewProjection: shift(frame.camera.viewProjection) }
}
