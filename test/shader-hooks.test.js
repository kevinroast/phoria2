// Shader hooks: a material's own GLSL, spliced into phoria2's shaders at fixed points - checked and
// copied by the material, numbered so errors point at the hook's own lines, run in every pass that
// draws the shape, and reported once, then left out, when it doesn't compile.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Color, DirectionalLight, Geometry, Lines, Material, Mesh, PerspectiveCamera, Points, Scene, Texture, WebGLRenderer, box, plane } from '../src/index.js'
import { collect } from '../src/frame.js'
import { ChangeWatch } from '../src/watch.js'
import { CLIP_ONLY_FRAGMENT, HOOK_HELPERS, MESH_VERTEX, shaderSource } from '../src/webgl/shaders.js'
import { hookFor } from '../src/webgl/hooks.js'
import { fakeCanvas, fakeGL } from './fakes.js'

afterEach(() => vi.restoreAllMocks())

const camera = () => new PerspectiveCamera({ position: [0, 0, 5], target: [0, 0, 0], aspect: 1 })
const wave = { vertex: 'local.y += sin(local.x + uTime) * uAmp;', uniforms: { uAmp: 0.5 } }

describe('material.shader', () => {
  it('keeps the hooks, its uniforms as values the shader can take', () => {
    const noise = new Texture({ image: { data: new Uint8Array(4), width: 1, height: 1 } })
    const m = new Material({ shader: { ...wave, fragment: 'base.rgb *= uTint;', lit: 'color *= 0.5;', uniforms: { uAmp: 0.5, uDir: [1, 0], uTint: '#ff0000', uNoise: noise }, bounds: 0.5 } })
    const s = /** @type {any} */ (m.shader)
    expect([s.vertex, s.fragment, s.lit, s.bounds]).toEqual([wave.vertex, 'base.rgb *= uTint;', 'color *= 0.5;', 0.5])
    expect(s.uniforms.uAmp).toBe(0.5)
    expect(s.uniforms.uDir).toEqual([1, 0])
    // colours as the shader works in them: linear
    expect(s.uniforms.uTint).toBeInstanceOf(Color)
    expect(Array.from(s.uniforms.uTint)).toEqual([1, 0, 0])
    expect(m.allTextures).toEqual([['shader.uNoise', noise]])
    expect(m.variant).toContain('hooks')
    expect(new Material().shader).toBe(null)
  })

  it('goes through clone and JSON', () => {
    const m = new Material({ color: 'teal', shader: { ...wave, uniforms: { uAmp: 0.5, uTint: '#00ff00', uDir: [0, 1, 0] }, bounds: 1 } })
    for (const copy of [m.clone(), new Material(JSON.parse(JSON.stringify(m.toJSON())))]) {
      expect(copy.shader?.vertex).toBe(wave.vertex)
      expect(copy.shader?.uniforms.uAmp).toBe(0.5)
      expect(copy.shader?.uniforms.uDir).toEqual([0, 1, 0])
      expect(/** @type {any} */ (copy.shader)?.uniforms.uTint.getHex()).toBe(0x00ff00)
      expect(copy.shader?.bounds).toBe(1)
    }
    expect(m.toJSON().shader).toEqual({ vertex: wave.vertex, uniforms: { uAmp: 0.5, uTint: '#00ff00', uDir: [0, 1, 0] }, bounds: 1 })
  })

  it('says what it takes when given something else', () => {
    const make = (shader) => () => new Material({ shader })
    expect(make('local.y += 1.0;')).toThrow("'shader' is { vertex, fragment, lit, uniforms, bounds }")
    expect(make({})).toThrow("needs at least one of 'vertex', 'fragment' or 'lit'")
    expect(make({ vertex: 3 })).toThrow('GLSL as a string')
    expect(make({ vertexShader: 'void main() {}' })).toThrow("use 'vertex'")
    expect(make({ vertex: 'x;', uniforms: { '2fast': 1 } })).toThrow("isn't a GLSL name")
    expect(make({ vertex: 'x;', uniforms: { uTime: 1 } })).toThrow("uTime is there already")
    expect(make({ vertex: 'x;', uniforms: { snoise: 1 } })).toThrow('snoise() is a function every hook can call')
    expect(make({ vertex: 'x;', uniforms: { saturate: 1 } })).toThrow('saturate() is a function every hook can call')
    expect(make({ vertex: 'x;', uniforms: { cameraPosition: [0, 0, 0] } })).toThrow("the camera's world position")
    expect(make({ vertex: 'x;', uniforms: { gl_Foo: 1 } })).toThrow('a name phoria2 keeps')
    expect(make({ vertex: 'x;', uniforms: { uBad: [1, 2, 3, 4, 5] } })).toThrow('two to four numbers')
    expect(() => new Material(/** @type {any} */ ({ onBeforeCompile: () => {} }))).toThrow("use 'shader'")
  })
})

describe('splicing hooks into the shaders', () => {
  const source = { uniforms: 'uniform float uTime;\nuniform float uAmp;', vertex: 'local.y += uAmp;', fragment: 'base.rgb *= 0.5;', lit: 'color += 0.1;' }

  it('puts each hook at its mark, numbered as its own source so errors name its lines', () => {
    const [vs, fs] = shaderSource('mesh', ['HOOK_VERTEX', 'HOOK_FRAGMENT', 'HOOK_LIT'], source)
    expect(vs).toContain('#line 1 101\nlocal.y += uAmp;')
    expect(fs).toContain('#line 1 102\nbase.rgb *= 0.5;')
    expect(fs).toContain('#line 1 103\ncolor += 0.1;')
    expect(vs).toContain('uniform float uAmp;')
    expect(fs).toContain('uniform float uAmp;')
    // the shader's own numbering carries on after each hook: the line after it keeps its number
    const lines = vs.split('\n')
    const resume = lines.findIndex((l) => l.startsWith('#line') && l.endsWith(' 0') && lines[lines.indexOf(l) - 1] === 'local.y += uAmp;')
    expect(resume).toBeGreaterThan(0)
  })

  it('gives every hook hash, value and simplex noise, and fbm of either - in the vertex and the fragment shader', () => {
    const [vs, fs] = shaderSource('mesh', ['HOOK_VERTEX', 'HOOK_FRAGMENT'], { ...source, helpers: HOOK_HELPERS })
    for (const s of [vs, fs]) {
      for (const fn of ['float hash(float x)', 'float hash(vec3 p)', 'float vnoise(vec2 p)', 'float vnoise(vec3 p)', 'float snoise(vec2 p)', 'vec4 snoised(vec3 p)',
        'float vfbm(vec2 p, int octaves)', 'float sfbm(vec3 p, int octaves)', 'vec3 sfbmd(vec2 p, int octaves)', 'float sfbm(vec2 p) {',
        'vec3 voronoi(vec2 p)', 'vec3 voronoi(vec3 p)', 'vec3 srgb(vec3 c)', 'vec3 hsv2rgb(vec3 hsv)', 'vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d)', 'float fresnel(vec3 normal, vec3 position, float power)',
        'mat2 rotate2(float a)', 'mat3 rotate3(vec3 axis, float a)', 'float remap(float x, float a, float b, float c, float d)', 'vec4 saturate(vec4 x)']) expect(s).toContain(fn)
    }
    // built from integer bit-mixing, which GLSL ES 3.00 defines exactly - never fract(sin())
    expect(HOOK_HELPERS).not.toContain('fract(sin')
    // the helpers come with a hook's program
    expect(hookFor(new Material({ shader: wave }))?.source.helpers).toBe(HOOK_HELPERS)
  })

  it('leaves the shaders as they are without hooks', () => {
    const [vs] = shaderSource('mesh', [])
    expect(vs).not.toContain('#line')
    expect(vs).toContain('//@hook vertex')
  })

  it("gives a mesh's fragment hook the shading normal to bend - in the colour pass, and in its shadow and pick", () => {
    const [, colour] = shaderSource('mesh', ['HOOK_FRAGMENT', 'LIT'], source)
    // declared before the hook, and the light reads it after
    expect(colour.indexOf('vec3 normal = normalize(vNormal);')).toBeGreaterThan(0)
    expect(colour.indexOf('vec3 normal = normalize(vNormal);')).toBeLessThan(colour.indexOf('#line 1 102'))
    expect(colour).toContain('vec3 n = normalize(normal);')
    // the depth pass runs the same code for its discards: it has a normal to read too
    const [, depth] = shaderSource(/** @type {any} */ ([MESH_VERTEX, CLIP_ONLY_FRAGMENT]), ['HOOK_FRAGMENT'], source)
    expect(depth).toContain('vec3 normal = normalize(vNormal);')
  })

  it('splices a points and a lines hook too - the lines one a function run on each end', () => {
    const [pv, pf] = shaderSource('points', ['HOOK_VERTEX', 'HOOK_FRAGMENT'], source)
    expect(pv).toContain('local.y += uAmp;')
    expect(pf).toContain('base.rgb *= 0.5;')
    const [lv] = shaderSource('lines', ['HOOK_VERTEX'], source)
    expect(lv).toMatch(/vec3 hookVertex\(vec3 local, float along, int index\) \{\n#line 1 101\nlocal\.y \+= uAmp;/)
  })
})

describe('hookFor()', () => {
  it('switches on the parts a material has, one program for the same code and uniform types', () => {
    const a = hookFor(new Material({ shader: wave }))
    const b = hookFor(new Material({ shader: { ...wave, uniforms: { uAmp: 2 } } }))
    expect(a?.defines.slice(0, 1)).toEqual(['HOOK_VERTEX'])
    expect(a?.defines).toEqual(b?.defines)
    expect(a?.source.uniforms).toBe('uniform float uTime;\nuniform vec3 cameraPosition;\nuniform float uAmp;')
    // a uniform of another type is another program
    expect(hookFor(new Material({ shader: { ...wave, uniforms: { uAmp: [1, 2] } } }))?.defines).not.toEqual(a?.defines)
    expect(hookFor(new Material())).toBe(null)
  })

  it("won't take one of phoria2's own uniform names - and says so", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(hookFor(new Material({ shader: { fragment: 'base.rgb = uColor;', uniforms: { uColor: [1, 0, 0] } } }))).toBe(null)
    expect(warn.mock.calls[0][0]).toContain("'uColor' is one of phoria2's own")
  })
})

/** A renderer keeping the shader sources it compiles; compile errors from `failing` sources. @param {(source: string) => string | null} [failing] */
function recording(failing = () => null) {
  const { gl } = fakeGL()
  /** @type {string[]} */
  const sources = []
  /** @type {Map<object, string>} */
  const of = new Map()
  const proxy = new Proxy(gl, {
    get(target, key) {
      if (key === 'shaderSource') return (s, src) => { sources.push(src); of.set(s, src) }
      if (key === 'getShaderParameter') return (s) => !failing(of.get(s) ?? '')
      if (key === 'getShaderInfoLog') return (s) => failing(of.get(s) ?? '') ?? ''
      if (key === 'getProgramParameter') {
        return (p, name) => name === target.LINK_STATUS ? ![...of.keys()].some((s) => p.attached?.includes(s) && failing(of.get(s) ?? '')) : target.getProgramParameter(p, name)
      }
      if (key === 'attachShader') return (p, s) => { (p.attached ??= []).push(s); target.attachShader(p, s) }
      return target[key]
    },
  })
  const renderer = new WebGLRenderer({ canvas: fakeCanvas(proxy) })
  renderer.setSize(10, 10)
  return { renderer, sources }
}

describe('hooks in the renderer', () => {
  it('runs the vertex hook in every pass that draws the shape - the colour pass and the shadow map', async () => {
    const { renderer, sources } = recording()
    const scene = new Scene()
    scene.add(new DirectionalLight({ direction: [0, -1, 0], castShadow: true }))
    scene.add(new Mesh({ geometry: plane(2), material: { shader: wave }, castShadow: true }))
    scene.add(new Mesh({ geometry: box(1), position: [0, -1, 0], receiveShadow: true }))
    renderer.render(scene, camera())
    // the shadow passes' code loads on first use
    await new Promise((r) => setTimeout(r, 50))
    renderer.render(scene, camera())
    const hooked = sources.filter((s) => s.includes(wave.vertex))
    // a vertex shader for the colour pass, and one for the shadow map's depth pass
    expect(hooked.length).toBeGreaterThanOrEqual(2)
    expect(sources.some((s) => s.includes(wave.vertex) && s.includes('#define HOOK_VERTEX'))).toBe(true)
  })

  it('reports a hook that fails once, in its own lines, and draws without it from then on', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { renderer, sources } = recording((s) => (s.includes('wobble') ? "ERROR: 101:2: 'wobble' : undeclared identifier\n" : null))
    const scene = new Scene()
    scene.add(new Mesh({ geometry: box(1), material: { shader: { vertex: 'local.y += 1.0;\nlocal.x += wobble;' } } }))
    renderer.render(scene, camera())
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain("shader.vertex line 2: 'wobble' : undeclared identifier")
    // counted as compiling, so the View draws again - and then without the hook, quietly
    expect(renderer.info.compiling).toBeGreaterThan(0)
    const before = sources.length
    renderer.render(scene, camera())
    expect(warn).toHaveBeenCalledTimes(1)
    expect(sources.slice(before).every((s) => !s.includes('wobble'))).toBe(true)
  })

  it('compiles points and lines with their hooks', () => {
    const { renderer, sources } = recording()
    const scene = new Scene()
    scene.add(new Points({ geometry: new Geometry({ positions: [0, 0, 0, 1, 1, 0] }), material: { shader: { vertex: 'size *= 2.0;', fragment: 'base.a *= pointUv.x;' } } }))
    scene.add(new Lines({ geometry: new Geometry({ positions: [0, 0, 0, 1, 0, 0] }), material: { shader: { vertex: 'local.y += along;', lit: 'color *= 0.5;' } } }))
    renderer.render(scene, camera())
    expect(sources.some((s) => s.includes('size *= 2.0;'))).toBe(true)
    expect(sources.some((s) => s.includes('base.a *= pointUv.x;'))).toBe(true)
    expect(sources.some((s) => s.includes('local.y += along;'))).toBe(true)
    expect(sources.some((s) => s.includes('color *= 0.5;'))).toBe(true)
  })
})

describe('bounds and culling', () => {
  // the camera looks down -z from z = 5; x = 40 is far out of view
  const away = (shader) => {
    const scene = new Scene()
    const mesh = scene.add(new Mesh({ geometry: box(1), position: [40, 0, 0], material: { shader } }))
    scene.updateWorldTree()
    return { frame: collect(scene, camera()), mesh }
  }

  it('culls by padded bounds when given, and not at all when a vertex hook has none', () => {
    expect(away({ fragment: 'base.rgb *= 0.5;' }).frame.opaque).toHaveLength(0)
    expect(away({ vertex: 'local.x -= 40.0;' }).frame.opaque).toHaveLength(1)
    expect(away({ vertex: 'local.x -= 0.1;', bounds: 0.5 }).frame.opaque).toHaveLength(0)
    expect(away({ vertex: 'local.x -= 40.0;', bounds: 40 }).frame.opaque).toHaveLength(1)
  })

  it('pads the bounds framing and shadows use', () => {
    const { mesh } = away({ vertex: 'local.y += 1.0;', bounds: 2 })
    const b = mesh.bounds
    expect(b.max[1]).toBeCloseTo(2.5)
    expect(b.min[0]).toBeCloseTo(37.5)
  })
})

describe('redrawing', () => {
  it('draws again as time runs when a hook reads uTime, and when a uniform changes', () => {
    const scene = new Scene()
    const mesh = scene.add(new Mesh({ geometry: box(1), material: { shader: wave } }))
    scene.updateWorldTree()
    const watch = new ChangeWatch(), cam = camera()
    watch.changed(scene, cam, 1)
    expect(watch.changed(scene, cam, 1)).toBe(false)
    expect(watch.changed(scene, cam, 2)).toBe(true)
    expect(watch.changed(scene, cam, 2)).toBe(false)
    const hooks = /** @type {any} */ (mesh.material.shader)
    hooks.uniforms.uAmp = 0.8
    expect(watch.changed(scene, cam, 2)).toBe(true)
    // without uTime, time alone changes nothing
    mesh.material.shader = { vertex: 'local.y += uAmp;', uniforms: { uAmp: 1 } }
    watch.changed(scene, cam, 2)
    expect(watch.changed(scene, cam, 3)).toBe(false)
  })
})
