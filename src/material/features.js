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
 * @property {boolean} [geometric] when() also asks the geometry (given one) - checked again for its defines
 * @property {string} [slot] a map's feature: the material slot it reads (none apply to a material with no maps)
 * @property {'materials'} [part] its GLSL loads the first time a material has it (webgl/parts.js)
 * @property {(m: Material, geometry?: Geometry | null) => boolean} when
 * @property {(m: Material, sink: UniformSink) => void} [uniforms]
 */

const MESH = /** @type {const} */ (['mesh'])
// a draw's worked-out uniforms, reused rather than made for every draw (what is sent is copied)
const EMISSIVE = new Float32Array(3), SPECULAR = new Float32Array(4)
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
  { slot: 'iridescenceThicknessMap', uniform: 'uIridescenceThicknessMap', define: 'IRIDESCENCE_THICKNESS_MAP', lit: true },
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
      EMISSIVE[0] = e[0] * k
      EMISSIVE[1] = e[1] * k
      EMISSIVE[2] = e[2] * k
      set('uEmissive', EMISSIVE)
      set('uRoughness', m.roughness)
      set('uMetalness', m.metalness)
      set('uNormalScale', m.normalScale)
      set('uAoMapIntensity', m.aoMapIntensity)
      set('uEnvStrength', m.environmentIntensity)
      // a non-metal's reflectance face on, from its ior and specular settings, and at grazing angles
      const ior = (m.ior - 1) / (m.ior + 1), sc = m.specularColor, si = m.specularIntensity
      SPECULAR[0] = Math.min(ior * ior * sc[0], 1) * si
      SPECULAR[1] = Math.min(ior * ior * sc[1], 1) * si
      SPECULAR[2] = Math.min(ior * ior * sc[2], 1) * si
      SPECULAR[3] = si
      set('uSpecular', SPECULAR)
    },
  },
  // each map: its sampler, and - read through UVs - its own repeat, rotation and offset
  ...MAPS.map(({ slot, uniform, define, lit }) => /** @type {Feature} */ ({
    name: slot, define, kinds: MESH, lit, slot, when: (m) => !!m[slot],
    uniforms: (m, { map }) => map(uniform, /** @type {Texture} */ (m[slot]), slot !== 'matcap'),
  })),
  { name: null, define: null, kinds: MESH, when: (m) => !!m.bumpMap, uniforms: (m, { set }) => set('uBumpScale', m.bumpScale) },
  { name: null, define: null, kinds: MESH, when: (m) => !!m.lightMap, uniforms: (m, { set }) => set('uLightMapIntensity', m.lightMapIntensity) },
  { name: 'cutout', define: 'ALPHA_TEST', kinds: MESH, when: (m) => m.alphaTest > 0 },
  { name: 'glass', define: 'TRANSMISSION', kinds: MESH, lit: true, part: 'materials', when: (m) => m.transmission > 0, uniforms: (m, { set }) => {
    set('uTransmission', m.transmission)
    // what bends what is behind it (read where the picture behind is there to bend - REFRACTION): its
    // ior, its thickness, and dispersion's half spread of the ior across the colours, as
    // KHR_materials_dispersion has it - red bent by the ior less that, blue by it more
    set('uRefraction', [m.ior, m.thickness, (m.ior - 1) * 0.025 * m.dispersion, m.thinWalled ? 1 : 0])
    // its body's tint over a distance - 0 for a body that doesn't tint (no Infinity in a uniform)
    const a = m.attenuationColor
    set('uAttenuation', [a[0], a[1], a[2], Number.isFinite(m.attenuationDistance) ? m.attenuationDistance : 0])
  } },
  {
    name: 'clearcoat', part: 'materials', define: 'CLEARCOAT', kinds: MESH, lit: true, when: (m) => m.clearcoat > 0,
    uniforms: (m, { set }) => {
      set('uClearcoat', m.clearcoat)
      set('uClearcoatRoughness', m.clearcoatRoughness)
    },
  },
  {
    name: 'sheen', part: 'materials', define: 'SHEEN', kinds: MESH, lit: true, when: (m) => m.sheen > 0,
    uniforms: (m, { set }) => {
      const c = m.sheenColor, k = m.sheen
      set('uSheenColor', [c[0] * k, c[1] * k, c[2] * k])
      set('uSheenRoughness', m.sheenRoughness)
    },
  },
  {
    name: 'iridescent', part: 'materials', define: 'IRIDESCENCE', kinds: MESH, lit: true, when: (m) => m.iridescence > 0,
    uniforms: (m, { set }) => set('uIridescence', [m.iridescence, m.iridescenceIor, m.iridescenceThicknessMin, m.iridescenceThickness]),
  },
  {
    name: 'brushed', part: 'materials', define: 'ANISOTROPY', kinds: MESH, lit: true, when: (m) => m.anisotropy > 0,
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
  { name: 'toon', define: 'TOON', kinds: MESH, lit: true, part: 'materials', when: (m) => m.toon > 0, uniforms: (m, { set }) => set('uToon', Math.max(2, Math.round(m.toon))) },
  { name: 'flat', define: 'FLAT_SHADING', kinds: MESH, when: (m) => m.flatShading },
  { name: 'double', define: 'DOUBLE_SIDED', kinds: MESH, when: (m) => m.doubleSided },
  // projected maps, for meshes with no UVs - only worth their varyings when there is a map
  {
    name: 'triplanar', define: 'TRIPLANAR', kinds: MESH, when: (m) => m.triplanar > 0 && UV_MAPS.some((slot) => m[slot]),
    uniforms: (m, { set }) => set('uTriplanar', m.triplanar),
  },
  { name: 'vcolor', define: 'VERTEX_COLORS', kinds: ALL, geometric: true, when: (m, g) => m.vertexColors && (!g || g.colors !== null) },
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

// each kind's features, in the table's order, and each feature's place in the table - for walking
// only a kind's own, and for a short key of which apply
const BY_KIND = Object.fromEntries(['mesh', 'points', 'lines'].map((kind) => [kind, FEATURES.filter((f) => f.kinds.includes(/** @type {any} */ (kind)))]))
const INDEX = new Map(FEATURES.map((f, i) => [f, i]))
// Each feature's bit, as a power of two: a material's features are one number, their bits added up
// - more than 32 of them, so as plain numbers (exact to 2^53), not 32-bit operators. Materials with
// the same features share what is worked out from them (featuresOf, variantOf), made once.
const BITS = Object.fromEntries(Object.entries(BY_KIND).map(([kind, list]) => [kind, list.map((f) => 2 ** /** @type {number} */ (INDEX.get(f)))]))
/** @param {number} mask @param {number} bit */
const has = (mask, bit) => Math.floor(mask / bit) % 2 === 1

/**
 * Glass: a material that lets light through, lit - it bends what is behind it, and colours the light
 * it casts a shadow with. @param {Material} m
 */
export const isGlass = (m) => m.transmission > 0 && !m.unlit

/**
 * What of a light glass lets through, as its coloured shadow: all of it where it isn't there (1 -
 * opacity), and where it is, its transmission's share, tinted by its colour and by its body over its
 * thickness (scaled as the mesh is).
 * @param {Material} m @param {ArrayLike<number>} worldMatrix
 * @returns {number[]} linear rgb
 */
export function glassFilter(m, worldMatrix) {
  const scale = Math.hypot(worldMatrix[0], worldMatrix[1], worldMatrix[2])
  const path = Number.isFinite(m.attenuationDistance) && m.attenuationDistance > 0 ? m.thickness * scale / m.attenuationDistance : 0
  const a = m.opacity, c = m.color, body = m.attenuationColor
  return [0, 1, 2].map((i) => 1 - a + a * m.transmission * c[i] * Math.max(body[i], 1e-4) ** path)
}

/**
 * A material's features for a kind of drawable, found in one walk of the table - for the renderer to
 * keep while it draws a frame, and read for the program's defines and the uniforms of every draw
 * with the material. A feature that asks the geometry is in when the material asks for it. `key`
 * says which apply, one character each - materials with the same key switch on the same code.
 * `part` names the group of GLSL one of them loads on first use, or is null.
 * @typedef {{ all: Feature[], uniforms: Feature[], key: string, part: 'materials' | null }} MaterialFeatures
 * @param {Material} m @param {'mesh' | 'points' | 'lines'} kind
 * @returns {MaterialFeatures}
 */
export function featuresOf(m, kind) {
  return featuresOfMask(featureMask(m, kind), kind)
}

/**
 * The features a mask (featureMask) says apply - shared by every material with them.
 * @param {number} mask @param {'mesh' | 'points' | 'lines'} kind
 * @returns {MaterialFeatures}
 */
export function featuresOfMask(mask, kind) {
  let features = SHARED[kind].get(mask)
  if (!features) {
    const all = /** @type {Feature[]} */ ([]), uniforms = /** @type {Feature[]} */ ([])
    let part = /** @type {'materials' | null} */ (null)
    let key = kind[0]
    BY_KIND[kind].forEach((f, i) => {
      if (!has(mask, BITS[kind][i])) return
      all.push(f)
      if (f.uniforms) uniforms.push(f)
      if (f.part) part = f.part
      key += String.fromCharCode(48 + /** @type {number} */ (INDEX.get(f)))
    })
    SHARED[kind].set(mask, features = Object.freeze({ all, uniforms, key, part }))
  }
  return features
}

/**
 * Which of a kind's features apply to a material, as one number: their bits added up. One walk of
 * the table, nothing made - most materials have no maps, and their ten are passed over without
 * asking each slot.
 * @param {Material} m @param {'mesh' | 'points' | 'lines'} kind
 */
export function featureMask(m, kind) {
  const list = BY_KIND[kind], bits = BITS[kind], maps = m.mapEntries.length > 0
  let mask = 0
  for (let i = 0; i < list.length; i++) {
    const f = list[i]
    if ((f.slot && !maps) || (f.lit && m.unlit) || !f.when(m)) continue
    mask += bits[i]
  }
  return mask
}
/** Each kind's features by mask, shared by every material with them. @type {Record<string, Map<number, MaterialFeatures>>} */
const SHARED = { mesh: new Map(), points: new Map(), lines: new Map() }

/**
 * The defines a material's features switch on, given the geometry drawn.
 * @param {MaterialFeatures} features @param {Material} m @param {Geometry} geometry
 * @returns {string[]}
 */
export function definesOf(features, m, geometry) {
  const defines = /** @type {string[]} */ ([])
  for (const f of features.all) if (f.define && (!f.geometric || f.when(m, geometry))) defines.push(f.define)
  return defines
}

/**
 * Set the uniforms a material's features read.
 * @param {MaterialFeatures} features @param {Material} m @param {UniformSink} sink
 */
export function setUniformsOf(features, m, sink) {
  for (const f of features.uniforms) /** @type {NonNullable<Feature['uniforms']>} */ (f.uniforms)(m, sink)
}

/**
 * A material's variant key for a kind of drawable: its features' names, joined. Materials with
 * the same key compile to the same program (geometry and the frame aside).
 * @param {Material} m @param {'mesh' | 'points' | 'lines'} kind
 * @returns {string}
 */
export function variantOf(m, kind) {
  return variantOfMask(featureMask(m, kind), kind, !!m.shader)
}

/**
 * The variant key of a material whose features are `mask` (featureMask), with hooks or not.
 * @param {number} mask @param {'mesh' | 'points' | 'lines'} kind @param {boolean} hooks
 * @returns {string}
 */
export function variantOfMask(mask, kind, hooks) {
  let names = NAMES[kind].get(mask)
  if (names === undefined) {
    names = BY_KIND[kind].filter((f, i) => f.name && has(mask, BITS[kind][i])).map((f) => f.name).join('+')
    NAMES[kind].set(mask, names)
  }
  return hooks ? (names ? `${names}+hooks` : 'hooks') : names
}
/** Each kind's variant names by mask. @type {Record<string, Map<number, string>>} */
const NAMES = { mesh: new Map(), points: new Map(), lines: new Map() }

/**
 * The defines a material switches on, for a kind of drawable and its geometry.
 * @param {Material} m @param {'mesh' | 'points' | 'lines'} kind @param {Geometry} geometry
 * @returns {string[]}
 */
export function featureDefines(m, kind, geometry) {
  return definesOf(featuresOf(m, kind), m, geometry)
}

/**
 * Set the uniforms a material's features read, for a kind of drawable.
 * @param {Material} m @param {'mesh' | 'points' | 'lines'} kind @param {UniformSink} sink
 */
export function setFeatureUniforms(m, kind, sink) {
  setUniformsOf(featuresOf(m, kind), m, sink)
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
