// Material features in one table: each feature's define, uniforms and place in the variant key come
// from the same entry, so they can't drift apart - and every pass places and cuts a drawable the
// same way, the section caps' counting included.
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Group, Material, Mesh, PerspectiveCamera, Scene, Texture, box } from '../src/index.js'
import { FEATURES, featureDefines, setFeatureUniforms, variantOf } from '../src/material/features.js'
import { WebGLRenderer } from '../src/webgl/WebGLRenderer.js'
import { fakeCanvas, fakeGL } from './fakes.js'

const tex = () => new Texture({ image: { data: new Uint8Array(4), width: 1, height: 1 } })

describe('the feature table', () => {
  it('every define it switches on is one the shaders test for', () => {
    const glsl = readdirSync('src/webgl').filter((f) => f.endsWith('.js')).map((f) => readFileSync(`src/webgl/${f}`, 'utf8')).join('\n')
    const defines = FEATURES.map((f) => f.define).filter(Boolean)
    expect(defines.length).toBeGreaterThan(15)
    expect(defines.filter((d) => !new RegExp(`(#ifn?def\\s+${d}\\b|defined\\(${d}\\))`).test(glsl))).toEqual([])
  })

  it("a material's variant key tells apart what its defines tell apart", () => {
    // the sort key used to leave these out, which the defines don't
    const keys = [{}, { doubleSided: true }, { triplanar: 2, map: tex() }, { map: tex() }, { blending: 'additive', transparent: true }]
      .map((o) => variantOf(new Material(o), 'mesh'))
    expect(new Set(keys).size).toBe(keys.length)
    // a material drawn as lines isn't lit, whatever it says
    expect(variantOf(new Material({ dash: 0.5 }), 'lines')).toBe('dashed')
    expect(variantOf(new Material({ dash: 0.5 }), 'mesh')).toBe('lit')
    // settings that change no program change no key
    expect(variantOf(new Material({ roughness: 0.1, ior: 2.4 }), 'mesh')).toBe(variantOf(new Material(), 'mesh'))
  })

  it('lit-only features stay off for unlit materials; a geometry without colours turns vertex colours off', () => {
    const m = new Material({ unlit: true, map: tex(), normalMap: tex(), clearcoat: 1, vertexColors: true })
    const geometry = /** @type {any} */ ({ colors: null, uvs2: null })
    expect(featureDefines(m, 'mesh', geometry)).toEqual(['MAP'])
    expect(featureDefines(m, 'mesh', /** @type {any} */ ({ colors: [1, 0, 0], uvs2: null }))).toEqual(['MAP', 'VERTEX_COLORS'])
  })

  it('sets each feature\'s uniforms, and each map with its transform', () => {
    const set = /** @type {Record<string, any>} */ ({}), maps = /** @type {string[]} */ ([])
    const m = new Material({ clearcoat: 0.5, clearcoatRoughness: 0.2, map: tex(), matcap: tex() })
    setFeatureUniforms(m, 'mesh', { set: (k, v) => { set[k] = v }, map: (u, _t, transform) => maps.push(`${u}${transform ? '+Uv' : ''}`) })
    expect([set.uClearcoat, set.uClearcoatRoughness, set.uOpacity]).toEqual([0.5, 0.2, 1])
    expect(set.uSheenColor).toBeUndefined()
    // the matcap takes no UVs
    expect(maps).toEqual(['uMap+Uv', 'uMatcap'])
  })
})

describe('section caps', () => {
  it('count each solid as the picture draws it - moved by its vertex hook, with a cut-out\'s holes', () => {
    const { gl, sources } = fakeGL()
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl) })
    renderer.setSize(16, 16)
    const scene = new Scene()
    const capped = scene.add(new Group({ clip: { normal: [0, 0, 1], offset: 0, cap: '#ff0000' } }))
    capped.add(new Mesh({ geometry: box(2), material: { shader: { vertex: 'local *= 1.1;', bounds: 0.2 } } }))
    capped.add(new Mesh({ geometry: box(2), position: [3, 0, 0], material: { alphaTest: 0.5, map: tex() } }))
    renderer.render(scene, new PerspectiveCamera({ position: [0, 0, 10], target: [0, 0, 0], aspect: 1 }))
    // the counting programs: the depth-only fragment, clipped
    const masks = sources.filter((s, i) => i % 2 === 1 && s.includes('#define CLIP') && s.includes('cutOut();') && !s.includes('#define NORMALS'))
    const defines = masks.map((s) => [...s.matchAll(/#define (\w+)/g)].map((m) => m[1]))
    expect(defines.some((d) => d.includes('HOOK_VERTEX'))).toBe(true)
    expect(defines.some((d) => d.includes('ALPHA_TEST') && d.includes('MAP'))).toBe(true)
  })
})

// A material's features as one number (featureMask): what follows from them - the feature lists,
// the program key, the variant name - is made once and shared by every material with the same
// features, rather than made again for each material every frame.
describe('materials with the same features', () => {
  it('share what follows from their features - and a material with another feature gets its own', async () => {
    const { featuresOf, featureMask } = await import('../src/material/features.js')
    const a = new Material({ color: 'red', roughness: 0.3 }), b = new Material({ color: 'blue', roughness: 0.8 })
    expect(featureMask(a, 'mesh')).toBe(featureMask(b, 'mesh'))
    expect(featuresOf(a, 'mesh')).toBe(featuresOf(b, 'mesh'))
    const coated = new Material({ color: 'blue', clearcoat: 1 })
    expect(featuresOf(coated, 'mesh')).not.toBe(featuresOf(a, 'mesh'))
    expect(featuresOf(coated, 'mesh').all.map((f) => f.define)).toContain('CLEARCOAT')
    // ... and a change to a material is seen at once: it is asked again, not remembered
    a.clearcoat = 1
    expect(featuresOf(a, 'mesh')).toBe(featuresOf(coated, 'mesh'))
    expect(variantOf(a, 'mesh')).toBe(variantOf(coated, 'mesh'))
  })

  it('name their variants as before - the features joined, and hooks last', () => {
    const plain = new Material()
    expect(variantOf(plain, 'mesh')).toBe('lit')
    expect(variantOf(new Material({ clearcoat: 1, doubleSided: true }), 'mesh')).toBe('lit+clearcoat+double')
    expect(variantOf(new Material({ unlit: true, shader: { fragment: 'diffuse.rgb *= 0.5;' } }), 'mesh')).toBe('unlit+hooks')
  })
})
