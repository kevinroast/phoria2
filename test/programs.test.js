// Shader programs as the GPU would see them, without one: the fake GL preprocesses each program's
// shaders and reports the uniforms its variant declares, so finding uniforms, making their setters,
// handing out texture units and the limits on them all run in tests - and each draw is logged with
// where it went. Every uniform the code sets by name is one some shader declares.
import { readFileSync, readdirSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Mesh, PerspectiveCamera, Scene, Texture, box } from '../src/index.js'
import { WebGLRenderer } from '../src/webgl/WebGLRenderer.js'
import { Programs, SAMPLER_UNITS } from '../src/webgl/programs.js'
import { FULLSCREEN_VERTEX } from '../src/webgl/shaders.js'
import { declaredUniforms, fakeCanvas, fakeGL, preprocess } from './fakes.js'

afterEach(() => vi.restoreAllMocks())
const camera = () => new PerspectiveCamera({ position: [0, 0, 10], target: [0, 0, 0], aspect: 1 })
const pixels = () => new Texture({ image: { data: new Uint8Array(4), width: 1, height: 1 } })
/** A full-screen program of our own, with the fragment shader given. */
const fragment = (body) => /** @type {[string, string]} */ ([FULLSCREEN_VERTEX, `precision highp float;\nout vec4 c;\n${body}\nvoid main() { c = vec4(1.0); }`])

describe("the fake's preprocessor", () => {
  it('keeps the lines its #if, #ifdef, #elif and #else take, with numbers from #define', () => {
    const { lines } = preprocess(['#define A', '#define N 2', '#ifdef A', 'a', '#ifndef B', 'not b', '#endif', '#endif',
      '#if defined(B) || N > 1', 'b or n', '#elif defined(A)', 'elif', '#else', 'else', '#endif',
      '#if defined(A) && !defined(B)', '#ifdef B', 'never', '#else', 'nested else', '#endif', '#endif'].join('\n'))
    expect(lines).toEqual(['a', 'not b', 'b or n', 'nested else'])
  })

  it('finds the uniforms a variant declares, arrays sized from its defines', () => {
    const u = declaredUniforms(['#define NUM 3\nuniform vec3 uColor[NUM];\n#ifdef FOG\nuniform float uFog;\n#endif\nuniform highp sampler2D uMap;'])
    expect([...u]).toEqual([['uColor', { type: 'vec3', size: 3 }], ['uMap', { type: 'sampler2D', size: 1 }]])
  })
})

describe('a program\'s uniforms', () => {
  it('a drawn mesh\'s program has the uniforms its variant declares, set to what the frame gives', () => {
    const { gl, live } = fakeGL()
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl), exposure: 1.5 })
    renderer.setSize(10, 10)
    const scene = new Scene()
    scene.add(new Mesh({ geometry: box(1), material: { color: '#ff0000' } }))
    renderer.render(scene, camera())
    const lit = [...live].find((o) => o.kind === 'program' && o.uniforms.some((/** @type {any} */ u) => u.name === 'uExposure'))
    expect(lit.uniforms.length).toBeGreaterThan(10)
    expect(lit.values.uExposure).toBe(1.5)
    expect(lit.values.uColor.map((/** @type {number} */ v) => +v.toFixed(3))).toEqual([1, 0, 0])
    // fog isn't on, so its uniforms aren't in this variant
    expect(lit.uniforms.some((/** @type {any} */ u) => u.name === 'uFogColor')).toBe(false)
  })

  it('sets int and uint arrays and vectors, and binds each sampler kind to its own target', () => {
    const { gl, live } = fakeGL()
    const programs = new Programs(gl)
    const p = programs.ready('mixed', [], fragment('uniform int uA[3];\nuniform ivec3 uB;\nuniform uvec2 uC;\nuniform mat2 uD;\nuniform samplerCube uCube;\nuniform sampler2DArray uLayers;'))
    p.set('uA', new Int32Array([1, 2, 3]))
    p.set('uB', [4, 5, 6])
    p.set('uC', new Uint32Array([7, 8]))
    p.set('uD', [1, 0, 0, 1])
    p.set('uCube', {})
    p.set('uLayers', {})
    const program = [...live].find((o) => o.kind === 'program')
    // the samplers: the cube on unit 0, the array on unit 1
    expect(program.values).toEqual({ uA: [1, 2, 3], uB: [4, 5, 6], uC: [7, 8], uD: [1, 0, 0, 1], uCube: 0, uLayers: 1 })
  })

  it('says at once when a uniform has a type nothing sets, or is an array of samplers', () => {
    const programs = new Programs(fakeGL().gl)
    expect(() => programs.ready('odd', [], fragment('uniform dvec2 uOdd;'))).toThrow("has uniform 'uOdd' of a type nothing sets")
    expect(() => programs.ready('maps', [], fragment('uniform sampler2D uMaps[2];'))).toThrow("has an array of samplers ('uMaps')")
  })

  it(`allows ${SAMPLER_UNITS} textures a draw - one of phoria2's own shaders over it is a bug, a material's hooks over it are reported`, () => {
    const programs = new Programs(fakeGL().gl)
    const samplers = (n) => Array.from({ length: n }, (_, i) => `uniform sampler2D uT${i};`).join('\n')
    expect(() => programs.ready('fifteen', [], fragment(samplers(SAMPLER_UNITS)))).not.toThrow()
    expect(() => programs.ready('sixteen', [], fragment(samplers(SAMPLER_UNITS + 1)))).toThrow(`samples 16 textures, more than the ${SAMPLER_UNITS}`)
    // a material's hooks with sixteen textures of their own: reported, drawn without them
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { gl } = fakeGL()
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl) })
    renderer.setSize(10, 10)
    const uniforms = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`uTex${i}`, pixels()]))
    const scene = new Scene()
    scene.add(new Mesh({ geometry: box(1), material: { shader: { fragment: 'base.rgb *= 1.0;', uniforms } } }))
    renderer.render(scene, camera())
    expect(warn.mock.calls.map((c) => c[0]).join('\n')).toContain('give its hooks fewer texture uniforms')
  })
})

describe('the draw log', () => {
  it('shows each draw in its target: with FXAA, the scene into a buffer of its own, FXAA last onto the canvas', async () => {
    const { gl, drawLog } = fakeGL()
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl), fxaa: true, ambientOcclusion: true })
    renderer.setSize(64, 48)
    let ready = 0
    renderer.onReady = () => ready++
    const scene = new Scene()
    scene.add(new Mesh({ geometry: box(1) }))
    renderer.render(scene, camera())
    await vi.waitFor(() => expect(ready).toBeGreaterThan(0))
    renderer.render(scene, camera())
    drawLog.length = 0
    renderer.render(scene, camera())
    const fxaa = drawLog.at(-1)
    expect([fxaa?.framebuffer, fxaa?.viewport]).toEqual([null, [0, 0, 64, 48]])
    // the box: its prepass at half size, then drawn into FXAA's buffer at full size
    const box3 = drawLog.filter((d) => d.call === 'drawElements')
    expect(box3.map((d) => d.viewport)).toEqual([[0, 0, 32, 24], [0, 0, 64, 48]])
    expect(box3[1].framebuffer).not.toBeNull()
    expect(box3[1].framebuffer).not.toBe(box3[0].framebuffer)
  })
})

describe('uniform names', () => {
  it('every uniform the code sets by name is declared in some shader - a misspelt name is set nowhere, without a word', () => {
    const files = readdirSync('src', { recursive: true, encoding: 'utf8' }).filter((p) => p.endsWith('.js')).map((p) => readFileSync(`src/${p}`, 'utf8'))
    const all = files.join('\n')
    const declared = new Set([...all.matchAll(/uniform\s+(?:(?:highp|mediump|lowp)\s+)?\w+\s+(\w+)/g)].map((m) => m[1]))
    // the maps' transforms are declared from a list: \`uniform mat3 \${m}Uv\`
    for (const name of [...declared]) declared.add(`${name}Uv`)
    const set = new Set([...all.matchAll(/\.set\('(u[A-Z]\w*)'/g)].map((m) => m[1]))
    expect(set.size).toBeGreaterThan(50)
    expect([...set].filter((name) => !declared.has(name))).toEqual([])
  })
})
