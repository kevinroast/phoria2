// Maps projected from a mesh's three axes, for scans and CAD models that come without UVs.
import { describe, expect, it } from 'vitest'
import { InstancedMesh, Material, Mesh, PerspectiveCamera, Scene, Texture, WebGLRenderer, box } from '../src/index.js'
import { fakeCanvas, fakeGL } from './fakes.js'

const pixels = () => new Texture({ image: { data: new Uint8Array([128, 128, 255, 255]), width: 1, height: 1 }, colorSpace: 'linear' })
const camera = () => new PerspectiveCamera({ position: [0, 2, 6], target: [0, 0, 0], aspect: 1 })

/** A renderer on a stand-in context that keeps the shader sources it is given. */
function recording() {
  const { gl } = fakeGL()
  const sources = []
  const proxy = new Proxy(gl, {
    get(target, key) {
      if (key === 'shaderSource') return (_shader, source) => sources.push(source)
      return target[key]
    },
  })
  const renderer = new WebGLRenderer({ canvas: fakeCanvas(proxy) })
  renderer.setSize(10, 10)
  const take = () => sources.splice(0)
  return { renderer, take }
}

describe('triplanar', () => {
  it('is a number of repeats, off by default, kept by clone and toJSON', () => {
    expect(new Material().triplanar).toBe(0)
    const m = new Material({ normalMap: pixels(), triplanar: 40 })
    expect(m.clone().triplanar).toBe(40)
    expect(m.toJSON()).toMatchObject({ triplanar: 40 })
    expect(() => new Material({ triplanar: -1 })).toThrow('triplanar')
  })

  it('compiles the projection only for a material with maps, instanced or not', () => {
    const { renderer, take } = recording()
    const scene = new Scene()
    scene.add(new Mesh({ geometry: box(), material: { triplanar: 10 } }))
    renderer.render(scene, camera())
    // no maps: nothing to project
    expect(take().some((s) => s.includes('#define TRIPLANAR'))).toBe(false)

    scene.add(new Mesh({ geometry: box(), material: { normalMap: pixels(), roughnessMap: pixels(), triplanar: 10 } }))
    scene.add(new InstancedMesh({ geometry: box(), count: 2, material: { map: pixels(), triplanar: 5 } }))
    renderer.render(scene, camera())
    const sources = take().filter((s) => s.includes('#define TRIPLANAR'))
    // two programs, each a vertex and a fragment shader
    expect(sources).toHaveLength(4)
    const fragment = sources.find((s) => s.includes('triplanarNormal'))
    expect(fragment).toContain('n = triplanarNormal(uNormalScale)')
    expect(fragment).toContain('roughness *= SAMPLE(uRoughnessMap).g')
    expect(sources.some((s) => s.includes('vObjectToWorld = uNormalMatrix * instanceNormal'))).toBe(true)
  })
})
