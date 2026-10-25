// Shared JSDoc types for phoria2. No runtime code - the types appear in the generated .d.ts files
// and are re-exported from the package root (import type { Vec3Input } from 'phoria2').

/** @typedef {Float32Array | number[]} Vec2Like */
/** @typedef {Float32Array | number[]} Vec3Like */
/** @typedef {Float32Array | number[]} Vec4Like */

/** A position or direction as an object literal. @typedef {{ x: number, y: number, z: number }} XYZ */

/** A vector as accepted on input: [x, y, z], { x, y, z } or a Vec3. @typedef {Vec3Like | XYZ} Vec3Input */

/**
 * A colour as accepted on input, in sRGB: '#ff8800', '#f80', 0xff8800, 'rgb(255 136 0)',
 * 'hsl(32 100% 50%)', a CSS colour name, or [r, g, b] with components 0-1.
 * @typedef {string | number | number[] | Float32Array | import('./value/Color.js').Color} ColorInput
 */

export {}
