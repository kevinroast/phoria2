// What each material setting does to its shader, in one table: the feature it is (a part of the
// material's variant key - the renderer draws materials of one variant together), the #define that
// switches its code on, and the uniforms it sets. A new material feature is one entry here - its
// define, its uniforms and its place in the variant can't drift apart.
//
// Kinds of drawable each feature applies to: 'mesh', 'points', 'lines'; `lit` features only when
// the material is lit (not unlit). The geometry is given where a feature depends on it (vertex
// colours, a second UV set); for the variant key it is left out.

/** @import { Material } from './Material.js' */
/** @import { Texture } from './Texture.js' */
/** @import { Geometry } from '../geometry/Geometry.js' */

/**
 * How a feature sets its uniforms: by name, and a map with its repeat, rotation and offset.
 * @typedef {object} UniformSink
 * @property {(name: string, value: any) => void} set
 * @property {(uniform: string, texture: Texture, transform: boolean) => void} map the map's sampler,
 *   and (with transform) its \`Uv\` matrix
 */

/**
 * @typedef {object} Feature
 * @property {string | null} name its part of the variant key; null for what every material of a kind has
 * @property {string | null} define the #define that switches its code on
 * @property {readonly ('mesh' | 'points' | 'lines')[]} kinds
 * @property {boolean} [lit] only for lit materials
 * @property {(m: Material, geometry?: Geometry | null) => boolean} when
 * @property {(m: Material, sink: UniformSink) => void} [uniforms]
 */

const MESH = /** @type {const} */ (['mesh'])
const ALL = /** @type {const} */ (['mesh', 'points', 'lines'])

/**
 * The maps a mesh reads - their material slot, sampler, define, and whether only lit materials read
 * them. The matcap last: it takes no UVs.
 */
export const MAPS = /** @type {const} */ ([
  { slot: 'map', uniform: 'uMap', define: 'MAP', lit: false },
  { slot: 'roughnessMap', uniform: 'uRoughnessMap', define: 'ROUGHNESS_MAP', lit: true },
  { slot: 'metalnessMap', uniform: 'uMetalnessMap', define: 'METALNESS_MAP', lit: true },
  { slot: 'normalMap', uniform: 'uNormalMap', define: 'NORMAL_MAP', lit: true },
  { slot: 'bumpMap', uniform: 'uBumpMap', define: 'BUMP_MAP', lit: true },
  { slot: 'aoMap', uniform: 'uAoMap', define: 'AO_MAP', lit: true },
  { slot: 'emissiveMap', uniform: 'uEmissiveMap', define: 'EMISSIVE_MAP', lit: false },
  { slot: 'lightMap', uniform: 'uLightMap', define: 'LIGHT_MAP', lit: true },
  { slot: 'matcap', uniform: 'uMatcap', define: 'MATCAP', lit: true },
])
/** A map slot's sampler. */
export const MAP_UNIFORMS = Object.fromEntries(MAPS.map((m) => [m.slot, m.uniform]))
// the maps read through UVs - or projected, for triplanar
const UV_MAPS = MAPS.filter((m) => m.slot !== 'matcap').map((m) => m.slot)

/** @type {Feature[]} */
export const FEATURES = [
  { name: 'lit', define: 'LIT', kinds: MESH, when: (m) => !m.unlit },
  { name: 'unlit', define: null, kinds: MESH, when: (m) => m.unlit },
  // what every material sets: its colour and opacity; a mesh its surface's numbers too
  {
    name: null, define: null, kinds: ALL, when: () => true,
    uniforms: (m, { set }) => {
      set('uColor', m.color)
      set('uOpacity', m.opacity)
      set('uAlphaTest', m.alphaTest)
    },
  },
  {
    name: null, define: null, kinds: MESH, when: () => true,
    uniforms: (m, { set }) => {
      const e = m.emissive, k = m.emissiveIntensity
      set('uEmissive', [e[0] * k, e[1] * k, e[2] * k])
      set('uRoughness', m.roughness)
      set('uMetalness', m.metalness)
      set('uNormalScale', m.normalScale)
      set('uAoMapIntensity', m.aoMapIntensity)
      set('uEnvStrength', m.environmentIntensity)
      // a non-metal's reflectance face on, from its ior and specular settings, and at grazing angles
      const ior = (m.ior - 1) / (m.ior + 1), sc = m.specularColor, si = m.specularIntensity
      set('uSpecular', [Math.min(ior * ior * sc[0], 1) * si, Math.min(ior * ior * sc[1], 1) * si, Math.min(ior * ior * sc[2], 1) * si, si])
    },
  },
  // each map: its sampler, and - read through UVs - its own repeat, rotation and offset
  ...MAPS.map(({ slot, uniform, define, lit }) => /** @type {Feature} */ ({
    name: slot, define, kinds: MESH, lit, when: (m) => !!m[slot],
    uniforms: (m, { map }) => map(uniform, /** @type {Texture} */ (m[slot]), slot !== 'matcap'),
  })),
  { name: null, define: null, kinds: MESH, when: (m) => !!m.bumpMap, uniforms: (m, { set }) => set('uBumpScale', m.bumpScale) },
  { name: null, define: null, kinds: MESH, when: (m) => !!m.lightMap, uniforms: (m, { set }) => set('uLightMapIntensity', m.lightMapIntensity) },
  { name: 'cutout', define: 'ALPHA_TEST', kinds: MESH, when: (m) => m.alphaTest > 0 },
  { name: 'glass', define: 'TRANSMISSION', kinds: MESH, lit: true, when: (m) => m.transmission > 0, uniforms: (m, { set }) => set('uTransmission', m.transmission) },
  {
    name: 'clearcoat', define: 'CLEARCOAT', kinds: MESH, lit: true, when: (m) => m.clearcoat > 0,
    uniforms: (m, { set }) => {
      set('uClearcoat', m.clearcoat)
      set('uClearcoatRoughness', m.clearcoatRoughness)
    },
  },
  {
    name: 'sheen', define: 'SHEEN', kinds: MESH, lit: true, when: (m) => m.sheen > 0,
    uniforms: (m, { set }) => {
      const c = m.sheenColor, k = m.sheen
      set('uSheenColor', [c[0] * k, c[1] * k, c[2] * k])
      set('uSheenRoughness', m.sheenRoughness)
    },
  },
  {
    name: 'brushed', define: 'ANISOTROPY', kinds: MESH, lit: true, when: (m) => m.anisotropy > 0,
    uniforms: (m, { set }) => {
      set('uAnisotropy', m.anisotropy)
      set('uAnisotropyDirection', [Math.cos(m.anisotropyRotation), Math.sin(m.anisotropyRotation)])
    },
  },
  {
    name: 'translucent', define: 'TRANSLUCENCY', kinds: MESH, lit: true, when: (m) => m.translucency > 0,
    uniforms: (m, { set }) => {
      const c = m.translucencyColor, k = m.translucency
      set('uTranslucency', [c[0] * k, c[1] * k, c[2] * k, k])
    },
  },
  { name: 'toon', define: 'TOON', kinds: MESH, lit: true, when: (m) => m.toon > 0, uniforms: (m, { set }) => set('uToon', Math.max(2, Math.round(m.toon))) },
  { name: 'flat', define: 'FLAT_SHADING', kinds: MESH, when: (m) => m.flatShading },
  { name: 'double', define: 'DOUBLE_SIDED', kinds: MESH, when: (m) => m.doubleSided },
  // projected maps, for meshes with no UVs - only worth their varyings when there is a map
  {
    name: 'triplanar', define: 'TRIPLANAR', kinds: MESH, when: (m) => m.triplanar > 0 && UV_MAPS.some((slot) => m[slot]),
    uniforms: (m, { set }) => set('uTriplanar', m.triplanar),
  },
  { name: 'vcolor', define: 'VERTEX_COLORS', kinds: ALL, when: (m, g) => m.vertexColors && (!g || g.colors !== null) },
  // points
  { name: 'map', define: 'MAP', kinds: ['points'], when: (m) => !!m.map, uniforms: (m, { map }) => map('uMap', /** @type {Texture} */ (m.map), true) },
  { name: 'sized', define: 'SIZE_ATTENUATION', kinds: ['points'], when: (m) => m.sizeAttenuation },
  // lines
  {
    name: 'dashed', define: 'DASHED', kinds: ['lines'], when: (m) => m.dash > 0,
    uniforms: (m, { set }) => {
      set('uDash', m.dash)
      set('uGap', m.gap || m.dash)
      set('uDashOffset', m.dashOffset)
    },
  },
  // how it blends changes how fog fades it (FOG_ADD, FOG_MULTIPLY) - a variant of its own
  { name: 'additive', define: null, kinds: ALL, when: (m) => m.blending === 'additive' },
  { name: 'multiply', define: null, kinds: ALL, when: (m) => m.blending === 'multiply' },
]

/** Is a feature the material's, for this kind of drawable? @param {Feature} f @param {Material} m @param {string} kind @param {Geometry | null} [geometry] */
const applies = (f, m, kind, geometry) => f.kinds.includes(/** @type {any} */ (kind)) && (!f.lit || !m.unlit) && f.when(m, geometry)

/**
 * A material's variant key for a kind of drawable: its features' names, joined. Materials with
 * the same key compile to the same program (geometry and the frame aside).
 * @param {Material} m @param {'mesh' | 'points' | 'lines'} kind
 * @returns {string}
 */
export function variantOf(m, kind) {
  const parts = /** @type {string[]} */ ([])
  for (const f of FEATURES) if (f.name && applies(f, m, kind)) parts.push(f.name)
  if (m.shader) parts.push('hooks')
  return parts.join('+')
}

/**
 * The defines a material switches on, for a kind of drawable and its geometry.
 * @param {Material} m @param {'mesh' | 'points' | 'lines'} kind @param {Geometry} geometry
 * @returns {string[]}
 */
export function featureDefines(m, kind, geometry) {
  const defines = /** @type {string[]} */ ([])
  for (const f of FEATURES) if (f.define && applies(f, m, kind, geometry)) defines.push(f.define)
  return defines
}

/**
 * Set the uniforms a material's features read, for a kind of drawable.
 * @param {Material} m @param {'mesh' | 'points' | 'lines'} kind @param {UniformSink} sink
 */
export function setFeatureUniforms(m, kind, sink) {
  for (const f of FEATURES) if (f.uniforms && applies(f, m, kind)) f.uniforms(m, sink)
}

/**
 * Maps read from the second UV set, where the geometry has one: UV2, and for each its sampler's set.
 * @param {Material} m @param {Geometry} geometry @param {readonly string[]} slots the maps the pass reads
 * @returns {string[]}
 */
export function secondUvDefines(m, geometry, slots) {
  if (!geometry.uvs2) return []
  const second = slots.filter((slot) => slot !== 'matcap' && /** @type {Texture | null} */ (m[slot])?.uvSet === 1)
  return second.length ? ['UV2', ...second.map((slot) => `${MAP_UNIFORMS[slot]}Set vUv2`)] : []
}
