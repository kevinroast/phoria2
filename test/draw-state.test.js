// The scene's draws send GL only what changed: render state (glstate.js), uniforms and texture binds
// (programs.js), and a program found once per material variant a frame (WebGLRenderer #memoFor).
import { describe, expect, it } from 'vitest'
import { Material, Mesh, PerspectiveCamera, Scene, Texture, WebGLRenderer, box } from '../src/index.js'
import { GLState } from '../src/webgl/glstate.js'
import { collect } from '../src/frame.js'
import { fakeCanvas, fakeGL } from './fakes.js'

/** A fake GL that also lists every call made, by name and arguments. */
function counting() {
  const { gl } = fakeGL()
  /** @type {any[][]} */
  const calls = []
  const proxy = new Proxy(gl, {
    get: (target, key) => {
      const value = target[key]
      return typeof value === 'function' ? (...args) => {
        calls.push([key, ...args])
        return value.apply(target, args)
      } : value
    },
  })
  return { gl: /** @type {any} */ (proxy), calls }
}

const camera = () => new PerspectiveCamera({ position: [0, 6, 12], target: [0, 0, 0], aspect: 1 })

/** A renderer and a row of meshes, all of one material; the calls of each frame drawn. */
function row(n, material) {
  const { gl, calls } = counting()
  const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl) })
  renderer.setSize(100, 100)
  const scene = new Scene()
  for (let i = 0; i < n; i++) scene.add(new Mesh({ geometry: box(), material, position: [i * 1.5 - n * 0.75, 0, 0] }))
  const frame = () => {
    calls.length = 0
    renderer.render(scene, camera())
    return calls
  }
  return { gl, frame }
}

/** The calls setting a uniform by its name. @param {any[][]} calls @param {string} name */
const sends = (calls, name) => calls.filter(([call, loc]) => String(call).startsWith('uniform') && loc?.name === name)

describe('the scene draws', () => {
  it('send a run of one material its program, render state and material uniforms once', () => {
    const material = new Material({ color: 'teal', roughness: 0.4 })
    const { frame } = row(10, material)
    frame()
    const calls = frame()
    const count = (name) => calls.filter(([call]) => call === name).length
    const drawn = count('drawElements')
    expect(drawn).toBeGreaterThan(5)
    expect([count('useProgram'), count('cullFace'), count('frontFace'), count('polygonOffset')]).toEqual([1, 1, 1, 1])
    // each mesh is placed on its own; the material's numbers are where the last frame left them
    expect(sends(calls, 'uModel')).toHaveLength(drawn)
    expect(sends(calls, 'uRoughness')).toHaveLength(0)
    // a change is sent, once
    material.roughness = 0.8
    expect(sends(frame(), 'uRoughness').map(([, , v]) => v)).toEqual([0.8])
  })

  it('leave polygon offset off after the draws, as everything else expects', () => {
    const { gl, frame } = row(3, new Material())
    frame()
    const toggles = frame().filter(([call, cap]) => (call === 'enable' || call === 'disable') && cap === gl.POLYGON_OFFSET_FILL)
    // on for the first mesh, then off once the opaque run is done - and again after the (empty)
    // see-through run, which starts not knowing
    expect(toggles.map(([call]) => call)).toEqual(['enable', 'disable', 'disable'])
  })

  it("bind a texture only where its unit doesn't already hold it", () => {
    const map = new Texture({ image: { width: 1, height: 1, data: new Uint8Array(4) } })
    const { frame } = row(4, new Material({ map }))
    const binds = (calls) => calls.filter(([call]) => call === 'activeTexture' || call === 'bindTexture')
    // the first frame uploads the map and binds it to its sampler's unit, once for all four draws
    expect(binds(frame()).length).toBeGreaterThan(0)
    // the next frame finds it where the last left it: nothing to bind
    expect(binds(frame())).toEqual([])
  })
})

// Materials shared by many meshes: each one's draws kept together (frame.js), so its maps are bound
// and its uniforms set once a run, not at every switch - and a draw after one of the same material
// on the same program sets none of them (WebGLRenderer #draw).
describe('draws sharing materials', () => {
  /** n meshes along the view, materials taking turns: [scene, camera, materials]. */
  const alternating = (/** @type {Material[]} */ materials, n) => {
    const scene = new Scene()
    for (let i = 0; i < n; i++) scene.add(new Mesh({ geometry: box(), material: materials[i % materials.length], position: [0, 0, -i * 2] }))
    return { scene, camera: new PerspectiveCamera({ position: [0, 0, 8], target: [0, 0, -100], aspect: 1, far: 500 }) }
  }
  const mapped = () => new Material({ map: new Texture({ image: { width: 1, height: 1, data: new Uint8Array(4) } }) })

  it('are kept together, each group placed by its nearest draw and front to back within it', () => {
    const a = new Material({ color: 'red' }), b = new Material({ color: 'blue' })
    const scene = new Scene()
    // a at depths 1 and 5, b at 3: a's group first - its nearest is nearer
    for (const [material, z] of [[a, -1], [b, -3], [a, -5]]) scene.add(new Mesh({ geometry: box(0.5), material, position: [0, 0, z] }))
    const camera = new PerspectiveCamera({ position: [0, 0, 0.001], target: [0, 0, -10], aspect: 1 })
    scene.updateWorldTree()
    const order = collect(scene, camera).opaque.map((item) => [item.material === a ? 'a' : 'b', -item.node.position.z])
    expect(order).toEqual([['a', 1], ['a', 5], ['b', 3]])

    // a material each: front to back, as ever
    const own = new Scene()
    for (const z of [-4, -1, -3, -2]) own.add(new Mesh({ geometry: box(0.5), material: new Material(), position: [0, 0, z] }))
    own.updateWorldTree()
    expect(collect(own, camera).opaque.map((item) => -item.node.position.z)).toEqual([1, 2, 3, 4])
  })

  it("bind their maps once a group, and every draw has its own material's map bound", () => {
    const { gl } = fakeGL()
    /** @type {any[][]} */
    const calls = []
    const proxy = new Proxy(gl, {
      get: (target, key) => {
        const value = target[key]
        return typeof value === 'function' ? (...args) => { calls.push([key, ...args]); return value.apply(target, args) } : value
      },
    })
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(/** @type {any} */ (proxy)) })
    renderer.setSize(100, 100)
    const materials = [mapped(), mapped(), mapped()]
    const { scene, camera } = alternating(materials, 30)
    renderer.render(scene, camera)
    renderer.render(scene, camera)
    // follow the units: which texture each holds, and the colour map's unit, at every draw
    const units = new Map()
    let active = 0, mapUnit = -1
    /** @type {any[]} */
    const atDraws = []
    let frames = 0, binds = 0
    for (const [call, ...args] of calls) {
      if (call === 'activeTexture') active = args[0] - gl.TEXTURE0
      else if (call === 'bindTexture' && args[0] === gl.TEXTURE_2D) {
        units.set(active, args[1])
        if (frames === 1) binds++
      } else if (call === 'uniform1i' && args[0]?.name === 'uMap') mapUnit = args[1]
      else if (call === 'clear') frames++
      else if (call === 'drawElements' && frames === 2) atDraws.push(units.get(mapUnit))
    }
    expect(atDraws).toHaveLength(30)
    // three groups of ten, each with its own map - the binding changes only between groups
    const changes = atDraws.filter((t, i) => i > 0 && t !== atDraws[i - 1]).length
    expect(new Set(atDraws).size).toBe(3)
    expect(changes).toBe(2)
    // the first frame binds a map at each group, not at each draw
    expect(binds).toBeLessThan(10)
  })
})

describe('GLState', () => {
  it('sends a setting only when it changes, and everything again after reset()', () => {
    const { gl, calls } = counting()
    const s = new GLState(gl)
    s.set(gl.CULL_FACE, true)
    s.set(gl.CULL_FACE, true)
    s.depthMask(false)
    s.depthMask(false)
    s.blendFunc(gl.ONE, gl.ONE)
    s.blendFunc(gl.ONE, gl.ONE)
    s.blendFunc(gl.ONE, gl.ZERO)
    expect(calls.map(([call]) => call)).toEqual(['enable', 'depthMask', 'blendFunc', 'blendFunc'])
    calls.length = 0
    s.reset()
    s.set(gl.CULL_FACE, true)
    s.depthMask(false)
    expect(calls.map(([call]) => call)).toEqual(['enable', 'depthMask'])
  })
})
