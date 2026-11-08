// The shader check: every shader variant the renderer can build, compiled on a real GPU. phoria2's
// shaders are assembled from #defines - material features, lights, the frame, the pass - and the
// tests never compile GLSL, so a variant no demo uses compiles for the first time on someone's
// machine; one of phoria2's own that fails stops their frame. This draws small scenes through the
// real renderer, so each program is built exactly as an app's would be:
// - every material feature alone, and every pair, for meshes, points and lines - the features come
//   from the renderer's own table (material/features.js), and one this page can't switch on fails
//   the check, so it can't fall behind;
// - each in three frames: plain; full - every light and shadow, studio light, fog, a clip with its
//   cap, an outline, ambient occlusion, the ground shadow, bloom and FXAA, and a GPU pick; and linear
//   light with an HDR environment;
// - shader hooks, instancing and the second UV set, each in those frames too.
// Every frame waits for its shaders, so each compiles now; a failure is caught, with the driver's
// log, and the check goes on. Run from shaders.html, or headless with `npm run shaders`.
import {
  AmbientLight, DirectionalLight, Fog, Geometry, Group, HemisphereLight, InstancedMesh, Lines, Mesh, PerspectiveCamera,
  PointLight, Points, Scene, SpotLight, Texture, box,
} from '../src/index.js'
import { FEATURES } from '../src/material/features.js'
import { collect } from '../src/frame.js'
import { WebGLRenderer } from '../src/webgl/WebGLRenderer.js'

/** @typedef {{ name: string, ok: boolean, error: string | null }} Result */
/** @type {{ done: boolean, results: Result[], programs: number, error: string | null }} */
const out = { done: false, results: [], programs: 0, error: null }
// @ts-ignore - read by scripts/shaders.mjs
window.__shaders = out
const log = /** @type {HTMLElement} */ (document.getElementById('log'))

const tex = (/** @type {object} */ o = {}) => new Texture({ image: { data: new Uint8Array([200, 180, 160, 255]), width: 1, height: 1 }, ...o })
// an HDR environment: float pixels
const hdr = new Texture({ image: { data: new Float32Array(8 * 4 * 4).fill(1), width: 8, height: 4 } })

// how to switch on each feature in the renderer's table, by its name, for each kind
/** @type {Record<string, Record<string, object>>} */
const ENABLE = {
  mesh: {
    lit: {}, unlit: { unlit: true },
    map: { map: tex() }, roughnessMap: { roughnessMap: tex() }, metalnessMap: { metalnessMap: tex() }, normalMap: { normalMap: tex() },
    bumpMap: { bumpMap: tex() }, aoMap: { aoMap: tex() }, emissiveMap: { emissiveMap: tex() }, lightMap: { lightMap: tex() }, matcap: { matcap: tex() },
    cutout: { alphaTest: 0.5, map: tex() }, glass: { transmission: 0.6 }, clearcoat: { clearcoat: 0.8 }, sheen: { sheen: 0.6 },
    brushed: { anisotropy: 0.6 }, translucent: { translucency: 0.5 }, toon: { toon: 4 }, flat: { flatShading: true }, double: { doubleSided: true },
    triplanar: { triplanar: 2, normalMap: tex() }, vcolor: { vertexColors: true },
    additive: { blending: 'additive', transparent: true, opacity: 0.6 }, multiply: { blending: 'multiply', transparent: true, opacity: 0.6 },
  },
  points: {
    map: { map: tex() }, sized: { sizeAttenuation: true }, vcolor: { vertexColors: true },
    additive: { blending: 'additive', transparent: true }, multiply: { blending: 'multiply', transparent: true },
  },
  lines: {
    dashed: { dash: 0.2 }, vcolor: { vertexColors: true },
    additive: { blending: 'additive', transparent: true }, multiply: { blending: 'multiply', transparent: true },
  },
}
// what each feature needs of the geometry or node beside its material
const EXTRA = /** @type {Record<string, { geometry?: object, node?: object }>} */ ({
  sprites: { geometry: { sizes: [1, 2, 1, 2] } },
  arrows: { node: { arrows: 'both' } },
})
const HOOKS = {
  mesh: { vertex: 'local += n * 0.01 * sin(uTime);', fragment: 'base.rgb *= 0.9 + 0.1 * vnoise(vUv * 4.0); normal = normalize(normal + vec3(0.0, 0.01, 0.0));', lit: 'color *= 0.95;' },
  points: { vertex: 'size *= 1.0 + 0.1 * float(index % 3);', fragment: 'base.a *= 1.0 - length(pointUv - 0.5);', lit: 'color *= 0.95;' },
  lines: { vertex: 'local.y += 0.01 * along;', fragment: 'base.rgb *= 0.5 + 0.5 * step(0.5, fract(distance * 4.0));', lit: 'color *= 0.95;' },
}

/** The features of a kind in the table, each with how to switch it on - throwing for one this page doesn't know. @param {'mesh' | 'points' | 'lines'} kind */
function featuresOf(kind) {
  const names = [...new Set(FEATURES.filter((f) => f.name && f.kinds.includes(kind)).map((f) => /** @type {string} */ (f.name)))]
  const unknown = names.filter((n) => !(n in ENABLE[kind]))
  if (unknown.length) throw new Error(`the shader check doesn't know how to switch on these ${kind} features: ${unknown.join(', ')} - add them to ENABLE in scripts/shaders-page.js`)
  const extras = kind === 'points' ? ['sprites'] : kind === 'lines' ? ['arrows'] : []
  return [...names, ...extras]
}

const positions = [-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]
const geometryFor = (/** @type {string} */ kind, /** @type {object} */ extra = {}) => new Geometry({
  positions, normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], uvs: [0, 0, 1, 0, 1, 1, 0, 1], uvs2: [0, 0, 1, 0, 1, 1, 0, 1],
  colors: [1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1], ...(kind === 'mesh' ? { indices: [0, 1, 2, 0, 2, 3] } : kind === 'lines' ? { indices: [0, 1, 1, 2, 2, 3] } : {}), ...extra,
})

/**
 * A drawable of a kind with the features named, in a group (for a clip), with its node options.
 * @param {'mesh' | 'points' | 'lines'} kind @param {string[]} features @param {{ hooks?: boolean, instanced?: boolean, uv2?: boolean }} axes
 */
function drawable(kind, features, axes) {
  const material = /** @type {Record<string, any>} */ ({})
  let geometry = {}, node = {}
  for (const f of features) {
    if (EXTRA[f]) {
      geometry = { ...geometry, ...EXTRA[f].geometry }
      node = { ...node, ...EXTRA[f].node }
    } else Object.assign(material, ENABLE[kind][f])
  }
  if (axes.hooks) material.shader = { ...HOOKS[kind], uniforms: { uAmp: 0.5, uTex: tex() }, bounds: 0.1 }
  if (axes.uv2) Object.assign(material, { aoMap: tex({ uvSet: 1 }), lightMap: tex({ uvSet: 1 }) })
  const g = kind === 'mesh' && !axes.uv2 && !axes.instanced ? box(1) : geometryFor(kind, geometry)
  if (axes.instanced) {
    const m = new InstancedMesh({ geometry: g, count: 2, material, castShadow: true, receiveShadow: true })
    m.setInstance(1, { position: [0.6, 0, 0] })
    return m
  }
  const Kind = kind === 'mesh' ? Mesh : kind === 'points' ? Points : Lines
  return new /** @type {any} */ (Kind)({ geometry: g, material, castShadow: true, receiveShadow: true, ...node })
}

/** The frames each variant is drawn in. */
const FRAMES = {
  plain: { lights: false, effects: false, linear: false },
  full: { lights: true, effects: true, linear: false },
  linear: { lights: true, effects: false, linear: true },
}

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('gl'))
const renderer = new WebGLRenderer({ canvas })
renderer.setSize(160, 120, 1)
const camera = new PerspectiveCamera({ position: [1.5, 1.5, 3], target: [0, 0, 0], aspect: 160 / 120 })
// a material's own code that fails is reported, not thrown - for this check, a failure all the same
const failedHooks = /** @type {string[]} */ ([])
const warn = console.warn
console.warn = (...a) => {
  const text = a.join(' ')
  if (/didn't compile|failed to compile|nothing sets|more than the/.test(text)) failedHooks.push(text)
  warn(...a)
}

/** @param {Scene} scene @param {'plain' | 'full' | 'linear'} frame */
function dress(scene, frame) {
  const f = FRAMES[frame]
  if (f.lights) {
    scene.add(new AmbientLight({ intensity: 0.2 }), new HemisphereLight({ intensity: 0.3 }))
    scene.add(new DirectionalLight({ direction: [-1, -2, -1], castShadow: true }))
    scene.add(new PointLight({ position: [1, 2, 1], range: 6, castShadow: true }))
    scene.add(new SpotLight({ position: [-1, 3, 1], range: 8, angle: 0.6, castShadow: true, target: [0, 0, 0] }))
    scene.fog = new Fog({ color: '#888888', near: 1, far: 20 })
  }
  scene.environment = frame === 'linear' ? hdr : frame === 'full' ? 'studio' : 'none'
  scene.background = frame === 'linear' ? hdr : null
}

/** Draw one variant in one frame, every pass it has; returns the error, if any. */
async function draw(/** @type {string} */ name, /** @type {() => any} */ make, /** @type {'plain' | 'full' | 'linear'} */ frame) {
  const scene = new Scene()
  dress(scene, frame)
  const f = FRAMES[frame]
  const holder = scene.add(new Group(f.effects ? { clip: { normal: [0, 0, 1], offset: 0.2, cap: '#ff0000' } } : {}))
  const node = holder.add(make())
  if (f.effects) node.outline = '#00ff00'
  renderer.bloom = f.effects
  renderer.fxaa = f.effects
  renderer.ambientOcclusion = f.effects
  renderer.groundShadow = f.effects
  failedHooks.length = 0
  try {
    scene.updateWorldTree()
    const frameDescription = collect(scene, camera)
    renderer.renderFrame(frameDescription, { wait: true, linear: f.linear })
    if (f.effects) renderer.pick(frameDescription, 80, 60)
    if (failedHooks.length) throw new Error(failedHooks.join('\n'))
    return null
  } catch (e) {
    return String(/** @type {any} */ (e)?.message ?? e).slice(0, 2400)
  }
}

/** Load every pass's code first: draw everything once and wait until nothing is still loading. */
async function loadEverything() {
  const scene = new Scene()
  dress(scene, 'full')
  const m = scene.add(new Mesh({ geometry: box(1), outline: '#00ff00', castShadow: true }))
  scene.updateWorldTree()
  Object.assign(renderer, { bloom: true, fxaa: true, ambientOcclusion: true, groundShadow: true })
  for (let i = 0; i < 100; i++) {
    const frame = collect(scene, camera)
    renderer.renderFrame(frame)
    const picked = renderer.pick(frame, 80, 60)
    // passes, bloom, effects and the picker in
    if (picked !== undefined && i > 3) break
    await new Promise((r) => setTimeout(r, 50))
  }
  scene.remove(m)
}

try {
  await loadEverything()
  /** @type {[string, () => any][]} */
  const variants = []
  for (const kind of /** @type {const} */ (['mesh', 'points', 'lines'])) {
    const features = featuresOf(kind)
    variants.push([`${kind}`, () => drawable(kind, [], {})])
    for (let i = 0; i < features.length; i++) {
      variants.push([`${kind} ${features[i]}`, () => drawable(kind, [features[i]], {})])
      for (let j = i + 1; j < features.length; j++) variants.push([`${kind} ${features[i]}+${features[j]}`, () => drawable(kind, [features[i], features[j]], {})])
    }
    // every feature at once, and each axis
    variants.push([`${kind} everything`, () => drawable(kind, features.filter((f) => f !== 'unlit' && f !== 'multiply'), {})])
    variants.push([`${kind} hooks`, () => drawable(kind, [], { hooks: true })])
    variants.push([`${kind} hooks+everything`, () => drawable(kind, features.filter((f) => f !== 'unlit' && f !== 'multiply'), { hooks: true })])
  }
  variants.push(['mesh instanced', () => drawable('mesh', [], { instanced: true })])
  variants.push(['mesh instanced+hooks+cutout', () => drawable('mesh', ['cutout'], { instanced: true, hooks: true })])
  variants.push(['mesh uv2', () => drawable('mesh', ['map'], { uv2: true })])
  variants.push(['mesh uv2+triplanar+cutout', () => drawable('mesh', ['triplanar', 'cutout'], { uv2: true })])

  const total = variants.length * Object.keys(FRAMES).length
  let n = 0
  for (const [name, make] of variants) {
    for (const frame of /** @type {const} */ (['plain', 'full', 'linear'])) {
      const error = await draw(name, make, frame)
      out.results.push({ name: `${name} (${frame})`, ok: !error, error })
      if (++n % 25 === 0) {
        log.textContent = `${n} of ${total}`
        await new Promise((r) => setTimeout(r, 0))
      }
    }
  }
  out.programs = renderer.info.programs
  const failed = out.results.filter((r) => !r.ok)
  log.textContent = `${out.results.length} variants drawn, ${out.programs} programs compiled; ${failed.length} failed\n\n${failed.map((r) => `${r.name}\n${r.error}`).join('\n\n')}`
} catch (e) {
  out.error = String(/** @type {any} */ (e)?.stack ?? e)
  log.textContent = out.error
}
out.done = true
