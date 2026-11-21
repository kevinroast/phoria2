// GLSL loaded the first time it's wanted. The lit shader in shaders.js is written whole, but its
// bigger optional blocks - reading shadow maps, rect-area lights, the less common material features,
// the functions shader hooks call - live in modules of their own and fill its `#pragma part NAME`
// lines when a program is built. Apps that never use them don't carry them.
//
// Each group arrives with what needs it, so a program never asks for a part that isn't here:
// - 'shadows' with the passes that draw shadow maps (a frame has no shadow to receive without them)
// - 'rect' with rect-area lights' lookup tables (NUM_RECT is 0 until then)
// - 'materials' and 'hooks' on their own, the first time a material has one of their features: until
//   then the renderer leaves that material out, as one whose program is still compiling, and draws
//   it when they arrive.
// An unfilled part's line is a #pragma GLSL ignores, inside an #if that is off.
import { lazy } from '../lazy.js'

/** @typedef {'shadows' | 'rect' | 'materials' | 'hooks'} PartGroup */

/** Each part's GLSL, by name. @type {Map<string, string>} */
const text = new Map()
/** The groups registered. @type {Set<PartGroup>} */
const loaded = new Set()
/** Told when a group loaded on its own arrives - each GPU context, to draw again. @type {Set<() => void>} */
const listeners = new Set()

// the groups that load on their own, each registered as it arrives; the rest come with another
// module (passes.js, ltc.js), which registers them as it loads
const loaders = () => ({
  materials: lazy('clearcoat, sheen, iridescence, brushed metal, toon and glass materials',
    () => import('./parts-materials.js').then((m) => addParts('materials', m.MATERIAL_PARTS))),
  hooks: lazy('shader hooks', () => import('./parts-hooks.js').then((m) => addParts('hooks', m.HOOK_PARTS))),
})
let LOADERS = loaders()

/** @internal For the tests: as if no group had loaded yet - the parts, and their loaders, forgotten. */
export function forgetParts() {
  text.clear()
  loaded.clear()
  LOADERS = loaders()
}

/**
 * A group's parts, from its module.
 * @param {PartGroup} group @param {Record<string, string>} parts
 */
export function addParts(group, parts) {
  for (const name in parts) text.set(name, parts[name])
  loaded.add(group)
}

/**
 * Whether a group's parts are here - and when they aren't, and the group loads on its own, start
 * loading them (once); every listener is told when they arrive.
 * @param {PartGroup} group
 */
export function hasParts(group) {
  if (loaded.has(group)) return true
  const load = LOADERS[/** @type {'materials' | 'hooks'} */ (group)]
  load?.(() => { for (const listener of listeners) listener() })
  return false
}

/** A part's GLSL, or '' while its group isn't here. @param {string} name */
export const partText = (name) => text.get(name) ?? ''

/**
 * Hear when a group loaded on its own arrives. @param {() => void} listener
 * @returns {() => void} stops listening
 */
export function onParts(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const PART = /^#pragma part ([\w-]+)$/gm

/** A shader source with its `#pragma part` lines filled. @param {string} source */
export const withParts = (source) => (source.includes('#pragma part') ? source.replace(PART, (_, name) => partText(name)) : source)
