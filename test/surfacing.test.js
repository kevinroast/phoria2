// Surfacing people expect: cut-outs that cast cut-out shadows, textures sharp at glancing angles,
// and height maps as bumps.
import { describe, expect, it, vi } from 'vitest'
import { DirectionalLight, Material, Mesh, PerspectiveCamera, Scene, Texture, WebGLRenderer, box, plane } from '../src/index.js'
import { fakeCanvas, fakeGL } from './fakes.js'

const pixels = (colorSpace = 'linear') => new Texture({ image: { data: new Uint8Array([255, 255, 255, 128]), width: 1, height: 1 }, colorSpace })
const camera = () => new PerspectiveCamera({ position: [0, 3, 6], target: [0, 0, 0], aspect: 1 })
const ANISO = { TEXTURE_MAX_ANISOTROPY_EXT: 0x84fe, MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84ff }

/** A renderer on a stand-in context that keeps shader sources and float texture parameters, with anisotropic filtering up to 4. */
function recording({ aniso = true } = {}) {
  const { gl } = fakeGL()
  const sources = [], params = []
  const proxy = new Proxy(gl, {
    get(target, key) {
      if (key === 'shaderSource') return (_shader, source) => sources.push(source)
      if (key === 'getExtension') return (name) => (name === 'EXT_texture_filter_anisotropic' ? (aniso ? ANISO : null) : target.getExtension(name))
      if (key === 'getParameter') return (p) => (p === ANISO.MAX_TEXTURE_MAX_ANISOTROPY_EXT ? 4 : 0)
      if (key === 'texParameterf') return (_t, p, v) => params.push([p, v])
      return target[key]
    },
  })
  const renderer = new WebGLRenderer({ canvas: fakeCanvas(proxy) })
  renderer.setSize(10, 10)
  return { renderer, sources, params }
}

describe('cut-out shadows', () => {
  it('cast the shadow of what is left after alphaTest, not of the whole shape', async () => {
    const { renderer, sources } = recording()
    let ready = 0
    renderer.onReady = () => ready++
    const scene = new Scene()
    scene.add(new DirectionalLight({ direction: [0, -1, -0.3], castShadow: true }))
    scene.add(new Mesh({ geometry: box(), castShadow: true }))
    scene.add(new Mesh({ geometry: plane(2), castShadow: true, material: { map: pixels('srgb'), alphaTest: 0.5, doubleSided: true } }))
    renderer.render(scene, camera())
    await vi.waitFor(() => expect(ready).toBeGreaterThan(0))
    renderer.render(scene, camera())
    // the shadow pass's fragment shaders: a plain one for the box, one that discards for the leaf
    const depth = sources.filter((s) => s.includes('fragColor = vec4(1.0)'))
    const cutout = depth.filter((s) => s.includes('#define ALPHA_TEST'))
    expect(cutout).toHaveLength(1)
    expect(cutout[0]).toContain('#define MAP')
    expect(cutout[0]).toContain('if (alpha < uAlphaTest) discard')
    expect(depth.some((s) => !s.includes('#define ALPHA_TEST'))).toBe(true)
  })
})

describe('anisotropic filtering', () => {
  it('is on by default, as far as the GPU goes; off at 1, for nearest filtering, and where there is no extension', () => {
    const { renderer, params } = recording()
    const scene = new Scene()
    const floor = new Texture({ image: { data: new Uint8Array(16), width: 2, height: 2 } })
    expect(floor.anisotropy).toBe(8)
    scene.add(new Mesh({ geometry: plane(4), material: { map: floor } }))
    scene.add(new Mesh({ geometry: plane(4), material: { map: new Texture({ image: { data: new Uint8Array(16), width: 2, height: 2 }, anisotropy: 2 }) } }))
    scene.add(new Mesh({ geometry: plane(4), material: { map: new Texture({ image: { data: new Uint8Array(16), width: 2, height: 2 }, filter: 'nearest' }) } }))
    renderer.render(scene, camera())
    // 8 asked for, 4 allowed; 2 as asked; none for the nearest-filtered one
    expect(params.filter(([p]) => p === ANISO.TEXTURE_MAX_ANISOTROPY_EXT).map(([, v]) => v).sort()).toEqual([2, 4])

    const bare = recording({ aniso: false })
    bare.renderer.render(scene, camera())
    expect(bare.params).toEqual([])
    expect(() => new Texture({ image: { data: new Uint8Array(4), width: 1, height: 1 }, anisotropy: 0.5 })).toThrow('anisotropy')
  })
})

describe('bump maps', () => {
  it('turn heights into bumps, with UVs or projected from three axes', () => {
    const m = new Material({ bumpMap: pixels(), bumpScale: 0.002 })
    expect([m.bumpMap?.colorSpace, m.bumpScale, new Material().bumpScale]).toEqual(['linear', 0.002, 1])
    expect(m.toJSON()).toMatchObject({ bumpScale: 0.002 })

    const { renderer, sources } = recording()
    const scene = new Scene()
    scene.add(new Mesh({ geometry: box(), material: { bumpMap: pixels(), bumpScale: 0.01 } }))
    scene.add(new Mesh({ geometry: box(), position: [2, 0, 0], material: { bumpMap: pixels(), bumpScale: 0.01, triplanar: 20 } }))
    renderer.render(scene, camera())
    const bumped = sources.filter((s) => s.includes('#define BUMP_MAP') && s.includes('bumpNormal'))
    expect(bumped).toHaveLength(2)
    expect(bumped.some((s) => s.includes('#define TRIPLANAR'))).toBe(true)
    expect(bumped[0]).toContain('n = bumpNormal(n)')
  })
})
