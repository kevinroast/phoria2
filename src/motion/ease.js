// Easing: how progress runs from 0 to 1 - steady, or easing in and out.

/** @typedef {'linear' | 'in' | 'out' | 'inOut'} EaseName */

/** @type {Record<EaseName, (t: number) => number>} */
export const EASES = {
  linear: (t) => t,
  in: (t) => t * t * t,
  out: (t) => 1 - (1 - t) ** 3,
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
}
