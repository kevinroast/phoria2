// Refining a still view: while nothing changes, the view draws the scene again and again, each
// time a little differently, and shows the average - antialiased far past what multisampling does,
// with soft shadows exact rather than estimated. What differs from one sample to the next:
//   - where in its pixel the camera looks: the projection shifted by under a pixel, spread by a tent
//     filter (a picture's resolve, not a box's hard edge), and
//   - where on each casting light its shadow is drawn from (sampleLight) - a sun's or a
//     rect light's; a spot or point light keeps its soft shadow, and
//   - where soft shadows read their blue noise, so their grain averages away, and
//   - how far glass's dispersion spreads the colours, so its fringes average into a rainbow, and
//   - with a camera's aperture, where on its lens it looks from: a thin lens, the eye moved across it
//     and the picture sheared to keep the focal plane where it was - sharp there, blurred before and
//     behind it, as a camera's depth of field.
// Each comes from its own Halton sequence (2 and 3 the pixel, 5 and 7 the light, 11 and 13 the noise,
// 17 and 19 the lens, 23 the dispersion), so they never fall into step: one sequence shared between
// them would draw the same lattice every time, and averaging never removes a lattice.
import { BLUE_NOISE_SIZE, SOFT_SPREAD, softnessOf } from './shadow.js'
import { Mat4 } from './value/Mat4.js'
import { across, Vec3 } from './value/Vec3.js'

/** @import { FrameDescription, FrameLight } from './frame.js' */
/** @import { Camera } from './scene/cameras.js' */

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

/**
 * A point on a unit disc, spread evenly over its area, from a point in the unit square (Shirley-Chiu:
 * squares to rings, so a sequence even over the square stays even over the disc).
 * @param {number} u @param {number} v
 * @returns {[number, number]}
 */
export function onDisc(u, v) {
  const a = 2 * u - 1, b = 2 * v - 1
  if (a === 0 && b === 0) return [0, 0]
  const [r, t] = Math.abs(a) > Math.abs(b) ? [a, (Math.PI / 4) * (b / a)] : [b, Math.PI / 2 - (Math.PI / 4) * (a / b)]
  return [r * Math.cos(t), r * Math.sin(t)]
}

/**
 * Sample n's point on the lens: on a unit disc.
 * @param {number} n from 0
 * @returns {[number, number]}
 */
export function lensSample(n) {
  return onDisc(halton(n + 1, 17), halton(n + 1, 19))
}

/**
 * Look at a frame through sample n's point on a thin lens: the eye moved there, across the view, and
 * the projection sheared so that the plane `focus` ahead lands on the screen just where it did. That
 * plane stays sharp as the samples average; nearer and further, each sample sees things a little
 * apart, and they blur - a camera's depth of field. A plane, not a sphere round the eye, as a real
 * lens focuses: the frame's edges stay as sharp as its middle. Perspective only. The frame's own
 * camera is replaced, as jitterFrame's is.
 * @param {FrameDescription} frame @param {number} n from 0
 * @param {number} aperture the lens's radius, world units @param {number} focus how far ahead the sharp plane is
 */
export function lensFrame(frame, n, aperture, focus) {
  const p = frame.camera.projection
  // an orthographic projection: nothing to focus
  if (!(aperture > 0) || !(focus > 0) || p[11] === 0) return
  const [x, y] = lensSample(n), dx = x * aperture, dy = y * aperture
  // the eye, moved across the view: its right and up are the view's first two rows
  const view = frame.camera.view.clone()
  const position = frame.camera.position.clone()
    .add(new Vec3(view[0], view[4], view[8]).multiplyScalar(dx)).add(new Vec3(view[1], view[5], view[9]).multiplyScalar(dy))
  view[12] -= dx
  view[13] -= dy
  // ...and the picture moved back by as much at the focal plane: there, w is `focus`
  const projection = shear(p, (p[0] * dx) / focus, (p[5] * dy) / focus)
  frame.camera = { ...frame.camera, view, projection, viewProjection: new Mat4().multiplyMatrices(projection, view), position }
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
 * Sample n's shift of soft shadows' blue-noise tile, in texels: from Halton (11, 13), its own
 * sequences again.
 * @param {number} n from 0
 * @returns {[number, number]}
 */
export function noiseShift(n) {
  return [Math.floor(halton(n + 1, 11) * BLUE_NOISE_SIZE), Math.floor(halton(n + 1, 13) * BLUE_NOISE_SIZE)]
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
  frame.camera = { ...frame.camera, projection: shear(frame.camera.projection, tx, ty), viewProjection: shear(frame.camera.viewProjection, tx, ty) }
}

/**
 * A projection that moves what it draws across the screen by (tx, ty) after the perspective divide -
 * x and y gaining tx and ty times w - as a new matrix.
 * @param {Mat4} m @param {number} tx @param {number} ty
 */
function shear(m, tx, ty) {
  const out = m.clone()
  for (let c = 0; c < 4; c++) {
    out[c * 4] += tx * m[c * 4 + 3]
    out[c * 4 + 1] += ty * m[c * 4 + 3]
  }
  return out
}

/**
 * Make a collected frame refine sample n: its pixel shift, its blue-noise shift, its share of glass's
 * dispersion and - with a camera
 * that has an aperture - its point on the lens. (Its lights are moved as it is collected:
 * collect's lightSample, with lightSample(n).)
 * @param {FrameDescription} frame @param {number} n from 0 @param {Camera} camera
 * @param {number} width @param {number} height the picture, in pixels
 */
export function sampleFrame(frame, n, camera, width, height) {
  frame.noiseShift = noiseShift(n)
  // from none of the spread to twice it, evenly: on average, the spread itself
  frame.spectrum = 2 * halton(n + 1, 23)
  const lens = /** @type {{ aperture?: number, focus?: number }} */ (camera)
  if (lens.aperture && lens.aperture > 0) lensFrame(frame, n, lens.aperture, /** @type {number} */ (lens.focus))
  jitterFrame(frame, n, width, height)
}

/**
 * A refine sample's view of a casting light: moved to a point across its size, its shadow sharp
 * from there. Averaged over the samples, the shadows make the penumbra a light that size casts -
 * exactly, where soft shadows estimate it. A rect light's own size; a sun's from its shadowSoftness,
 * an angle (none: it stays sharp), its direction tilted with it. A spot or point light keeps its soft
 * shadow: its edge spreads with the gap whatever the distance to what casts - no one size of light
 * does that (sized for the garden, a lantern's own bars, a hand's width from the flame, blurred
 * away) - and the samples average its grain away instead (sampleFrame shifts the blue noise).
 * @param {FrameLight} light changed in place - a frame's own copy
 * @param {[number, number]} sample in the unit square
 */
export function sampleLight(light, [u, v]) {
  if (light.kind === 'rect') {
    const hw = /** @type {Vec3} */ (light.halfWidth), hh = /** @type {Vec3} */ (light.halfHeight)
    light.shadowFrom = /** @type {Vec3} */ (light.position).clone().add(hw.clone().multiplyScalar(2 * u - 1)).add(hh.clone().multiplyScalar(2 * v - 1))
    light.hardShadow = true
    return
  }
  const softness = softnessOf(light)
  if (light.kind !== 'directional' || !(softness > 0)) return
  light.shadowSoftness = 0
  const [x, y] = onDisc(u, v)
  const d = /** @type {Vec3} */ (light.direction), [a, b] = across(d), r = SOFT_SPREAD * softness
  light.direction = d.clone().add(a.multiplyScalar(x * r)).add(b.multiplyScalar(y * r)).normalize()
}
