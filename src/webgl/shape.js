// The passes that draw only a mesh's shape - shadow maps, the depth prepass, GPU picking, outline
// masks - draw it as the picture does: instanced, cut by its clip, with a cut-out's holes, moved by
// its shader hooks. One place says how, so a new kind of shape reaches every pass at once.
import { hookFor, passDefines } from './hooks.js'
import { uvMatrix } from './resources.js'
import { glassFilterParts, secondUvDefines } from '../material/features.js'

/** @import { DrawItem } from '../frame.js' */
/** @import { Hook } from './hooks.js' */
/** @import { Texture } from '../material/Texture.js' */

/**
 * How an item is placed and cut - every pass that draws it, the picture's own included: its
 * instances, and the clip that cuts it.
 * @param {DrawItem} item
 * @returns {string[]}
 */
export function placementDefines(item) {
  const defines = item.instances ? ['INSTANCED'] : []
  if (item.clip) defines.push('CLIP')
  return defines
}

/**
 * The defines for drawing an item's shape, its hooks, and whether it is a cut-out.
 * @param {DrawItem} item
 * @param {boolean} fragmentHook the pass runs the fragment hook too, for the holes it cuts
 * @returns {{ defines: string[], hook: Hook | null, cutout: boolean }}
 */
export function shapeDefines(item, fragmentHook) {
  const { material, geometry } = item
  const defines = placementDefines(item)
  // a cut-out's holes: the map's alpha against the material's threshold, the map read as the
  // picture reads it - projected, for a triplanar one; from the second UV set, if it is on that
  const cutout = material.alphaTest > 0
  if (cutout) {
    defines.push('ALPHA_TEST')
    if (material.map) {
      defines.push('MAP')
      if (material.triplanar > 0) defines.push('TRIPLANAR')
      defines.push(...secondUvDefines(material, geometry, ['map']))
    }
  }
  const hook = hookFor(material)
  if (hook) defines.push(...passDefines(hook, fragmentHook))
  return { defines, hook, cutout }
}

/**
 * The uniforms those defines read: the clip's plane, and a cut-out's opacity, threshold and map.
 * @param {{ set: (name: string, value: any) => void }} program
 * @param {DrawItem} item @param {boolean} cutout
 * @param {(t: Texture) => WebGLTexture} texture the GL texture for a map
 */
export function setShapeUniforms(program, item, cutout, texture) {
  if (item.clip) program.set('uClipPlane', item.clip.plane)
  if (!cutout) return
  const material = item.material
  program.set('uOpacity', material.opacity)
  program.set('uAlphaTest', material.alphaTest)
  const map = material.map
  if (!map) return
  program.set('uMapUv', uvMatrix(map))
  program.set('uMap', texture(map))
  if (material.triplanar > 0) program.set('uTriplanar', material.triplanar)
}

/**
 * Glass's maps in the passes that see glass from a light - its coloured shadow and caustics: its
 * thickness map, and its colour map (stained glass colours the light through it), read as the
 * picture reads them - the defines, added to shapeDefines' own.
 * @param {DrawItem} item @param {string[]} defines
 */
export function glassMapDefines(item, defines) {
  const { material, geometry } = item
  if (!material.thicknessMap && !material.map) return
  /** @param {string} d */
  const add = (d) => { if (!defines.includes(d)) defines.push(d) }
  if (material.thicknessMap) add('THICKNESS_MAP')
  if (material.map) add('GLASS_MAP')
  if (material.triplanar > 0) add('TRIPLANAR')
  const slots = /** @type {('thicknessMap' | 'map')[]} */ ([material.thicknessMap && 'thicknessMap', material.map && 'map'].filter(Boolean))
  for (const d of secondUvDefines(material, geometry, slots)) add(d)
}

/**
 * What of the light a glass caster lets through, in parts (glassFilterParts), for the passes that
 * work it out at each pixel - its coloured shadow, and caustics.
 * @param {{ set: (name: string, value: any) => void }} program @param {DrawItem} item
 */
export function setGlassUniforms(program, item) {
  const { through, body } = glassFilterParts(item.material, item.worldMatrix)
  program.set('uGlassThrough', through)
  program.set('uGlassBody', body)
}

/**
 * The uniforms glassMapDefines' code reads: the maps, where each is read.
 * @param {{ set: (name: string, value: any) => void }} program
 * @param {DrawItem} item @param {(t: Texture) => WebGLTexture} texture the GL texture for a map
 */
export function setGlassMapUniforms(program, item, texture) {
  const material = item.material, thickness = material.thicknessMap, map = material.map
  if (thickness) {
    program.set('uThicknessMap', texture(thickness))
    program.set('uThicknessMapUv', uvMatrix(thickness))
  }
  if (map) {
    program.set('uMap', texture(map))
    program.set('uMapUv', uvMatrix(map))
  }
  if ((thickness || map) && material.triplanar > 0) program.set('uTriplanar', material.triplanar)
}
