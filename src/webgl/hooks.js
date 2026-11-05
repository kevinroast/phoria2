// Shader hooks for the renderer: a material's GLSL turned into what the shaders splice in - uniform
// declarations and the code - and the defines that switch it on, one program per distinct hook. A
// hook that fails to compile is reported once, in terms of its own lines, and the material is drawn
// without it from then on, rather than stopping the frame.
import { Texture } from '../material/Texture.js'
import { warnOnce } from '../validate.js'
import { CLIP_ONLY_FRAGMENT, HOOK_SOURCE_NUMBERS, LINES_VERTEX, MESH_VERTEX, POINTS_VERTEX, shaderSource } from './shaders.js'

/** @import { Material, ShaderUniform } from '../material/Material.js' */
/** @import { HookSource } from './shaders.js' */
/** @import { Program } from './programs.js' */

/**
 * A material's hooks, ready to compile.
 * @typedef {object} Hook
 * @property {string} signature its code and uniform types - one program per signature
 * @property {string[]} defines HOOK_VERTEX, HOOK_FRAGMENT, HOOK_LIT for the parts it has, and its id
 * @property {HookSource} source what the shaders splice in
 * @property {boolean} moves it has a vertex hook
 */

/** @type {Map<string, Hook>} */
const hooks = new Map()
/** Signatures that failed to compile: those materials draw without their hooks. @type {Set<string>} */
const failed = new Set()
/** @type {WeakMap<object, { types: string, hook: Hook | null }>} */
const recent = new WeakMap()

/** The GLSL type of a uniform's value. @param {ShaderUniform} v */
function glslType(v) {
  if (typeof v === 'number') return 'float'
  if (v instanceof Texture) return 'sampler2D'
  return `vec${/** @type {ArrayLike<number>} */ (v).length}`
}

// the uniforms phoria2's shaders declare, which a hook's own can't reuse
let own = /** @type {Set<string> | null} */ (null)
const ownUniforms = () => own ??= new Set([MESH_VERTEX, POINTS_VERTEX, LINES_VERTEX, CLIP_ONLY_FRAGMENT, ...['mesh', 'points', 'lines'].flatMap((k) => shaderSource(/** @type {any} */ (k), []))]
  .flatMap((s) => [...s.matchAll(/uniform\s+\w+\s+(\w+)/g)].map((m) => m[1])))

/**
 * The hooks a material draws with, or null: none, or ones that failed to compile.
 * @param {Material} material
 * @returns {Hook | null}
 */
export function hookFor(material) {
  const s = material.shader
  if (!s) return null
  const types = Object.entries(s.uniforms).map(([k, v]) => `${glslType(v)} ${k}`).join(';')
  const last = recent.get(s)
  if (last && last.types === types) return last.hook
  const signature = JSON.stringify([s.vertex, s.fragment, s.lit, types])
  let hook = failed.has(signature) ? null : hooks.get(signature) ?? null
  if (!hook && !failed.has(signature)) {
    const clash = Object.keys(s.uniforms).find((k) => ownUniforms().has(k))
    if (clash) {
      failed.add(signature)
      warnOnce(material, `shader uniform '${clash}' is one of phoria2's own - give it another name; the material is drawn without its shader hooks`)
    } else {
      hook = {
        signature,
        defines: [...(s.vertex ? ['HOOK_VERTEX'] : []), ...(s.fragment ? ['HOOK_FRAGMENT'] : []), ...(s.lit ? ['HOOK_LIT'] : []), `HOOKS ${hooks.size + 1}`],
        source: {
          uniforms: ['uniform float uTime;', ...types.split(';').filter(Boolean).map((t) => `uniform ${t};`)].join('\n'),
          vertex: s.vertex, fragment: s.fragment, lit: s.lit,
        },
        moves: !!s.vertex,
      }
      hooks.set(signature, hook)
    }
  }
  recent.set(s, { types, hook })
  return hook
}

/**
 * Defines for a pass that isn't the colour pass: the vertex hook always - so a shadow, an outline or
 * a pick is of the moved shape - and the fragment hook only where its discards should cut (meshes'
 * shadows and picks); never the lit hook.
 * @param {Hook} hook @param {boolean} cuts
 */
export function passDefines(hook, cuts) {
  return hook.defines.filter((d) => d !== 'HOOK_LIT' && (cuts || d !== 'HOOK_FRAGMENT'))
}

/**
 * Set the hook's uniforms: the clock, and the material's own values.
 * @param {Program} program @param {Material} material @param {number} time
 * @param {(t: Texture) => WebGLTexture} texture
 */
export function setHookUniforms(program, material, time, texture) {
  program.set('uTime', time)
  const u = /** @type {NonNullable<Material['shader']>} */ (material.shader).uniforms
  for (const name in u) {
    const v = u[name]
    program.set(name, v instanceof Texture ? texture(v) : v)
  }
}

/**
 * A program built with a material's hooks failed: say why, once, in the hook's own terms, and draw
 * the material without them from now on.
 * @param {Material} material @param {Hook} hook @param {string} log the compiler's
 */
export function hookFailed(material, hook, log) {
  failed.add(hook.signature)
  recent.delete(/** @type {object} */ (material.shader))
  const names = Object.fromEntries(Object.entries(HOOK_SOURCE_NUMBERS).map(([part, n]) => [n, part]))
  const lines = log.split('\n').map((line) => /ERROR:\s*(\d+):(\d+):\s*(.*)/.exec(line)).filter((m) => !!m)
  const own = lines.filter((m) => names[m[1]])
  const where = own.length
    ? own.map((m) => `shader.${names[m[1]]} line ${m[2]}: ${m[3]}`).join('; ')
    : `in phoria2's shader around the hook: ${lines[0]?.[3] ?? log.trim().split('\n')[0]}`
  const uniforms = Object.keys(/** @type {NonNullable<Material['shader']>} */ (material.shader).uniforms)
  warnOnce(material, `a shader hook doesn't compile - ${where}. Hooks can use ${HOOK_NAMES}, uTime${uniforms.length ? `, ${uniforms.join(', ')}` : ''}. The material is drawn without its hooks`)
}

const HOOK_NAMES = 'local, n, uv, index, size, along (vertex); base, emissive, vUv, vWorldPosition, vNormal, vColor, pointUv, distance (fragment); color, base (lit)'
