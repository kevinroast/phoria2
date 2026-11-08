// The passes that draw only a mesh's shape - shadow maps, the depth prepass, GPU picking, outline
// masks - draw it as the picture does: instanced, cut by its clip, with a cut-out's holes, moved by
// its shader hooks. One place says how, so a new kind of shape reaches every pass at once.
import { hookFor, passDefines } from './hooks.js'
import { uvMatrix } from './resources.js'
import { secondUvDefines } from '../material/features.js'

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
