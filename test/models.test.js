import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  Box3, DirectionalLight, Group, InstancedMesh, Mesh, OrthographicCamera, PerspectiveCamera, PointLight, Scene, SpotLight,
  Texture, box, create, plane,
} from '../src/index.js'
import { collect } from '../src/frame.js'
import { parseHDR } from '../src/hdr.js'
import { irradianceSH } from '../src/irradiance.js'
import { fitShadow } from '../src/shadow.js'
import { Animation, Model, parseGLTF } from '../src/gltf/index.js'

const camera = () => new PerspectiveCamera({ position: [0, 0, 10], target: [0, 0, 0], aspect: 1 })

// RGBE for a value: mantissas scaled by 2^(e - 136)
const rgbe = (r, g, b) => {
  const max = Math.max(r, g, b)
  if (max < 1e-32) return [0, 0, 0, 0]
  const e = Math.ceil(Math.log2(max / 255.9999)) + 136
  const f = 2 ** (e - 136)
  return [Math.round(r / f), Math.round(g / f), Math.round(b / f), e]
}
const header = (w, h) => new TextEncoder().encode(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`)
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

describe('HDR images', () => {
  it('decode flat and run-length encoded Radiance files to linear floats', () => {
    // narrow images are stored flat
    const flat = parseHDR(concat(header(2, 1), new Uint8Array([...rgbe(1, 0.5, 0.25), ...rgbe(4, 4, 4)])))
    expect([flat.width, flat.height]).toEqual([2, 1])
    expect(Array.from(flat.data).map((v) => +v.toFixed(2))).toEqual([1, 0.5, 0.25, 1, 4, 4, 4, 1])

    // a scanline of 8: each channel as a run of 8 (128 + 8, value)
    const [r, g, b, e] = rgbe(2, 1, 0.5)
    const line = new Uint8Array([2, 2, 0, 8, 136, r, 136, g, 136, b, 136, e])
    const rle = parseHDR(concat(header(8, 2), line, line))
    expect([rle.width, rle.height]).toEqual([8, 2])
    expect(Array.from(rle.data.subarray(60, 64)).map((v) => +v.toFixed(2))).toEqual([2, 1, 0.5, 1])

    expect(() => parseHDR(new TextEncoder().encode('P6\n'))).toThrow('not a Radiance .hdr file')
    expect(() => parseHDR(new TextEncoder().encode('#?RADIANCE\n\n+Y 1 +X 1\n'))).toThrow('top-to-bottom')
  })

  it('give diffuse light as spherical harmonics: 1 everywhere from a uniform sky, more from above when the top is bright', () => {
    const w = 64, h = 32
    const uniform = { data: new Float32Array(w * h * 4).fill(1), width: w, height: h }
    const sh = irradianceSH(uniform)
    expect(sh[0]).toBeCloseTo(1, 2)
    expect(Math.max(...Array.from(sh.subarray(3)).map(Math.abs))).toBeLessThan(0.02)

    const top = new Float32Array(w * h * 4)
    for (let y = 0; y < h / 2; y++) for (let x = 0; x < w; x++) top.fill(1, (y * w + x) * 4, (y * w + x) * 4 + 4)
    const sky = irradianceSH({ data: top, width: w, height: h })
    // facing up sees all of the bright half; facing down none of it
    const at = (n) => sky[0] + sky[3] * n[1] + sky[6] * n[2] + sky[9] * n[0]
    expect(at([0, 1, 0])).toBeGreaterThan(0.85)
    expect(at([0, -1, 0])).toBeLessThan(0.15)
  })

  it('load as a linear texture from an .hdr url, and the scene takes one as its environment', async () => {
    const bytes = concat(header(2, 1), new Uint8Array([...rgbe(1, 1, 1), ...rgbe(2, 2, 2)]))
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(bytes))
    try {
      const scene = new Scene({ environment: 'studio.hdr', environmentIntensity: 0.5, backgroundBlur: 0.3 })
      const env = /** @type {Texture} */ (scene.environment)
      expect(env).toBeInstanceOf(Texture)
      await env.ready
      expect([env.isHDR, env.colorSpace, env.image?.width]).toEqual([true, 'linear', 2])
      expect(scene.toJSON()).toMatchObject({ environment: { url: 'studio.hdr', colorSpace: 'linear', mipmaps: false }, environmentIntensity: 0.5, backgroundBlur: 0.3 })
      expect(new Scene({ environment: 'studio' }).environment).toBe('studio')
      expect(() => new Scene({ environment: 'sunny' })).toThrow("'environment' must be 'studio', 'none', an .hdr url or a texture")
    } finally {
      fetchMock.mockRestore()
    }
  })
})

describe('shadows', () => {
  it('fit the light to the casters across its view and to the receivers in depth', () => {
    const casters = [new Box3([-1, 0, -1], [1, 2, 1])]
    const fit = /** @type {NonNullable<ReturnType<typeof fitShadow>>} */ (fitShadow([0, -1, 0], casters, [new Box3([-10, -5, -10], [10, 0, 10])]))
    const project = (p) => {
      const m = fit.viewProjection
      return [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r])
    }
    // straight down: the casters' 2 x 2 footprint fills the map (with a small margin)...
    for (const corner of [[-1, 2, -1], [1, 2, 1]]) {
      const [x, y] = project(corner)
      expect(Math.abs(x)).toBeGreaterThan(0.9)
      expect(Math.abs(y)).toBeGreaterThan(0.9)
      expect(Math.abs(x)).toBeLessThanOrEqual(1)
    }
    // ...and the depth runs from the casters' top to the receivers' bottom, near to far
    expect(project([0, 2, 0])[2]).toBeCloseTo(-1, 1)
    expect(project([0, -5, 0])[2]).toBeCloseTo(1, 1)
    expect(fit.texelSize).toBeCloseTo(2.08 / 2048, 4)
    expect(fitShadow([0, -1, 0], [], [])).toBeNull()
  })

  it('go in the frame for the first casting light, which comes first, with casters the camera cannot see', () => {
    const scene = new Scene()
    scene.add(new DirectionalLight({ direction: [1, -1, 0] }))
    const sun = scene.add(new DirectionalLight({ direction: [0, -1, 0], castShadow: true }))
    const seen = scene.add(new Mesh({ geometry: box(1), castShadow: true }))
    const behind = scene.add(new Mesh({ geometry: box(1), position: [0, 0, 50], castShadow: true }))
    scene.add(new Mesh({ geometry: plane(20), receiveShadow: true }))
    const city = scene.add(new InstancedMesh({ geometry: box(1), count: 2, castShadow: true }))
    city.setInstance(0, { position: [3, 0, 0] })
    city.setInstance(1, { position: [-3, 0, 0] })
    scene.updateWorldTree()
    const frame = collect(scene, camera())
    expect(frame.lights[0].node).toBe(sun)
    expect(frame.shadow?.light.node).toBe(sun)
    expect(frame.shadow?.casters.map((c) => c.node)).toEqual([seen, behind, city])
    expect(frame.opaque.map((d) => d.node)).not.toContain(behind)

    sun.castShadow = false
    expect(collect(scene, camera()).shadow).toBeNull()
  })
})

// a small glTF: one textured, coloured triangle in a child node, a camera, a light, an animation
function sampleGLTF() {
  const floats = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, // POSITION
    0, 0, 1, 0, 0, 1, 0, 0, 1, // NORMAL
    0, 0, 1, 0, 0, 1, // TEXCOORD_0
    0, 1, // animation times
    0, 0, 0, 0, 2, 0, // animation translations
  ])
  const bytes = new Uint8Array(floats.buffer.byteLength + 8)
  bytes.set(new Uint8Array(floats.buffer))
  // COLOR_0 as normalized bytes after the floats: red, green, blue (linear), alpha ignored
  const colors = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255])
  const all = new Uint8Array(bytes.length - 8 + colors.length)
  all.set(new Uint8Array(floats.buffer))
  all.set(colors, floats.byteLength)
  const json = {
    asset: { version: '2.0' },
    extensionsUsed: ['KHR_lights_punctual', 'KHR_materials_emissive_strength', 'EXT_unknown_thing'],
    extensions: { KHR_lights_punctual: { lights: [{ type: 'spot', intensity: Math.PI * 2, spot: { outerConeAngle: 0.5, innerConeAngle: 0.25 } }] } },
    scene: 0,
    scenes: [{ name: 'Sample', nodes: [0] }],
    nodes: [
      { name: 'Root', children: [1, 2, 3], translation: [0, 1, 0] },
      { name: 'Triangle', mesh: 0, matrix: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 5, 0, 0, 1] },
      { name: 'Eye', camera: 0, rotation: [0, 0.7071068, 0, 0.7071068] },
      { name: 'Lamp', extensions: { KHR_lights_punctual: { light: 0 } } },
    ],
    meshes: [{ name: 'Tri', primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2, COLOR_0: 5 }, material: 0 }] }],
    materials: [{
      name: 'Paint',
      pbrMetallicRoughness: { baseColorFactor: [0.5, 0.25, 1, 0.5], metallicFactor: 0.2, roughnessFactor: 0.7, baseColorTexture: { index: 0 } },
      emissiveFactor: [1, 0, 0],
      extensions: { KHR_materials_emissive_strength: { emissiveStrength: 4 } },
      alphaMode: 'BLEND',
      doubleSided: true,
    }],
    textures: [{ source: 0, sampler: 0 }],
    samplers: [{ wrapS: 33071, magFilter: 9728 }],
    images: [{ uri: 'paint.png' }],
    cameras: [{ type: 'perspective', perspective: { yfov: Math.PI / 4, znear: 0.1, zfar: 100 } }],
    animations: [{ name: 'Rise', channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }], samplers: [{ input: 3, output: 4 }] }],
    buffers: [{ byteLength: all.length, uri: `data:application/octet-stream;base64,${Buffer.from(all).toString('base64')}` }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: floats.byteLength }, { buffer: 0, byteOffset: floats.byteLength, byteLength: colors.length }],
    accessors: [
      { bufferView: 0, byteOffset: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 0, byteOffset: 36, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 0, byteOffset: 72, componentType: 5126, count: 3, type: 'VEC2' },
      { bufferView: 0, byteOffset: 96, componentType: 5126, count: 2, type: 'SCALAR' },
      { bufferView: 0, byteOffset: 104, componentType: 5126, count: 2, type: 'VEC3' },
      { bufferView: 1, componentType: 5121, normalized: true, count: 3, type: 'VEC4' },
    ],
  }
  return json
}

/** A .glb container around a JSON chunk and a binary chunk. */
function glb(json, bin) {
  const text = new TextEncoder().encode(JSON.stringify(json))
  const pad = (b, fill) => {
    const out = new Uint8Array(Math.ceil(b.length / 4) * 4).fill(fill)
    out.set(b)
    return out
  }
  const j = pad(text, 0x20), b = pad(bin, 0)
  const out = new Uint8Array(12 + 8 + j.length + 8 + b.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, out.length, true)
  view.setUint32(12, j.length, true)
  view.setUint32(16, 0x4e4f534a, true)
  out.set(j, 20)
  view.setUint32(20 + j.length, b.length, true)
  view.setUint32(24 + j.length, 0x004e4942, true)
  out.set(b, 28 + j.length)
  return out
}

describe('phoria2/gltf', () => {
  it('builds nodes, geometry, materials, a camera, a light and an animation from a .gltf', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const model = await parseGLTF(sampleGLTF(), { baseUrl: 'https://example.com/models/', waitForTextures: false })
    expect(model).toBeInstanceOf(Model)
    expect(model).toBeInstanceOf(Group)
    expect(model.name).toBe('Sample')

    const root = /** @type {Group} */ (model.find('Root'))
    expect(root.position.toArray()).toEqual([0, 1, 0])
    const tri = /** @type {Mesh} */ (model.find('Triangle'))
    expect(tri).toBeInstanceOf(Mesh)
    expect(tri.position.toArray()).toEqual([5, 0, 0])
    expect(tri.scale.toArray()).toEqual([2, 2, 2])
    expect(Array.from(tri.geometry.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
    expect(Array.from(tri.geometry.uvs ?? [])).toEqual([0, 0, 1, 0, 0, 1])
    // linear vertex colours become sRGB, alpha dropped
    expect(Array.from(tri.geometry.colors ?? [])).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1])

    const m = tri.material
    expect(m.name).toBe('Paint')
    expect(Array.from(m.color).map((v) => +v.toFixed(3))).toEqual([0.5, 0.25, 1])
    expect([m.metalness, m.roughness, m.opacity, m.transparent, m.doubleSided, m.emissiveIntensity]).toEqual([0.2, 0.7, 0.5, true, true, 4])
    expect(m.map?.url).toBe('https://example.com/models/paint.png')
    expect([m.map?.wrap, m.map?.filter, m.map?.flipY]).toEqual(['clamp', 'nearest', false])

    const eye = /** @type {Group} */ (model.find('Eye'))
    expect(model.cameras).toHaveLength(1)
    expect(model.cameras[0]).toBeInstanceOf(PerspectiveCamera)
    expect(model.cameras[0].parent).toBe(eye)
    expect(/** @type {PerspectiveCamera} */ (model.cameras[0]).fov).toBeCloseTo(45)

    const lamp = /** @type {SpotLight} */ (model.find('Lamp')?.children[0])
    expect(lamp).toBeInstanceOf(SpotLight)
    expect(lamp.intensity).toBeCloseTo(2)
    expect([lamp.angle, lamp.penumbra]).toEqual([0.5, 0.5])
    expect(lamp.direction.toArray()).toEqual([0, 0, -1])

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("'EXT_unknown_thing', which isn't supported"))
    warn.mockRestore()

    // the animation runs on the scene clock once played
    const [rise] = model.animations
    expect(rise).toBeInstanceOf(Animation)
    expect([rise.name, rise.duration]).toEqual(['Rise', 1])
    const scene = new Scene()
    scene.add(model)
    scene.update(0.5, 0.5)
    expect(tri.position.toArray()).toEqual([5, 0, 0])
    expect(model.play('Rise')).toBe(rise)
    scene.update(0.25, 0.75)
    expect(tri.position[1]).toBeCloseTo(0.5)
    rise.loop = false
    scene.update(2, 2.75)
    expect([tri.position[1], rise.playing]).toEqual([2, false])
    rise.stop()
    expect(tri.position[1]).toBe(0)
  })

  it('reads .glb containers and refuses extensions it needs but lacks', async () => {
    const json = sampleGLTF()
    const bin = Buffer.from(json.buffers[0].uri.split(',')[1], 'base64')
    json.buffers = [{ byteLength: bin.length }]
    delete json.materials[0].pbrMetallicRoughness.baseColorTexture
    const model = await parseGLTF(glb(json, new Uint8Array(bin)))
    expect(Array.from(/** @type {Mesh} */ (model.find('Triangle')).geometry.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])

    await expect(parseGLTF({ ...json, extensionsRequired: ['KHR_draco_mesh_compression'] }))
      .rejects.toThrow("requires 'KHR_draco_mesh_compression', which isn't supported - export the model without compression")
    await expect(parseGLTF({ asset: { version: '1.0' } })).rejects.toThrow('only glTF 2.0')
  })

  it('loads the Khronos damaged helmet with its full map set', async () => {
    // Node has no image decoding, so its textures report they can't load
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bytes = readFileSync(new URL('../public/models/DamagedHelmet.glb', import.meta.url))
    const model = await parseGLTF(bytes, { waitForTextures: false })
    const meshes = model.meshes
    expect(meshes).toHaveLength(1)
    const [helmet] = /** @type {Mesh[]} */ (meshes)
    expect(helmet.geometry.vertexCount).toBe(14556)
    const m = helmet.material
    expect(m.textures.map(([slot]) => slot).sort()).toEqual(['aoMap', 'emissiveMap', 'map', 'metalnessMap', 'normalMap', 'roughnessMap'])
    // one texture carries both roughness (green) and metalness (blue), in linear space
    expect(m.roughnessMap).toBe(m.metalnessMap)
    expect([m.map?.colorSpace, m.normalMap?.colorSpace, m.emissiveMap?.colorSpace]).toEqual(['srgb', 'linear', 'srgb'])
    // stood upright by its node's rotation
    const size = model.bounds.getSize()
    expect(size[1]).toBeGreaterThan(1.5)
    await new Promise((r) => setTimeout(r, 10))
    warn.mockRestore()
  })
})

describe('scene lights from models', () => {
  it('keeps glTF light units: point lights in candela, divided by PI', async () => {
    const json = {
      asset: { version: '2.0' },
      extensions: { KHR_lights_punctual: { lights: [{ type: 'point', intensity: Math.PI * 10, range: 5, color: [1, 0, 0] }, { type: 'directional' }] } },
      nodes: [{ extensions: { KHR_lights_punctual: { light: 0 } } }, { extensions: { KHR_lights_punctual: { light: 1 } } }],
      scenes: [{ nodes: [0, 1] }],
    }
    const model = await parseGLTF(json)
    const [point, sun] = model.children.map((n) => n.children[0])
    expect(point).toBeInstanceOf(PointLight)
    expect([/** @type {PointLight} */ (point).intensity, /** @type {PointLight} */ (point).range]).toEqual([10, 5])
    expect(sun).toBeInstanceOf(DirectionalLight)
    expect(new OrthographicCamera()).toBeTruthy()
  })
})

describe('a loaded model as plain data', () => {
  it('describes itself as a group of its parts, which create() builds back without phoria2/gltf', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const model = await parseGLTF(sampleGLTF(), { baseUrl: 'https://example.com/models/', waitForTextures: false })
    const again = create(JSON.parse(JSON.stringify(model.toJSON())))
    expect(again.constructor).toBe(Group)
    const tri = /** @type {Mesh} */ (again.find('Triangle'))
    expect(Array.from(tri.geometry.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
    expect(tri.position.toArray()).toEqual([5, 0, 0])
    warn.mockRestore()
  })
})

describe('glass and clearcoat from glTF', () => {
  it('reads KHR_materials_transmission and KHR_materials_clearcoat by their factors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const json = sampleGLTF()
    json.extensionsUsed = [...(json.extensionsUsed ?? []), 'KHR_materials_transmission', 'KHR_materials_clearcoat']
    json.materials[0].extensions = {
      ...json.materials[0].extensions,
      KHR_materials_transmission: { transmissionFactor: 0.9 },
      KHR_materials_clearcoat: { clearcoatFactor: 1, clearcoatRoughnessFactor: 0.2 },
    }
    const model = await parseGLTF(json, { baseUrl: 'https://example.com/models/', waitForTextures: false })
    const { material } = /** @type {Mesh} */ (model.find('Triangle'))
    expect([material.transmission, material.clearcoat, material.clearcoatRoughness, material.transparent]).toEqual([0.9, 1, 0.2, true])
    // supported now, so not warned about
    expect(warn.mock.calls.some(([m]) => /KHR_materials_(transmission|clearcoat)/.test(String(m)))).toBe(false)
    warn.mockRestore()
  })

  it('reads a second UV set, the textures on it, and rotated texture transforms - without warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const json = sampleGLTF()
    json.extensionsUsed = [...(json.extensionsUsed ?? []), 'KHR_texture_transform']
    // the first set's accessor again, as the second
    json.meshes[0].primitives[0].attributes.TEXCOORD_1 = json.meshes[0].primitives[0].attributes.TEXCOORD_0
    const material = json.materials[0]
    material.occlusionTexture = { index: 0, texCoord: 1 }
    material.pbrMetallicRoughness.baseColorTexture = { index: 0, extensions: { KHR_texture_transform: { rotation: 0.5, scale: [3, 3], offset: [0.1, 0.2] } } }
    const model = await parseGLTF(json, { baseUrl: 'https://example.com/models/', waitForTextures: false })
    const mesh = /** @type {Mesh} */ (model.find('Triangle'))
    expect(Array.from(mesh.geometry.uvs2)).toEqual(Array.from(mesh.geometry.uvs))
    expect(mesh.material.aoMap.uvSet).toBe(1)
    expect([mesh.material.map.uvSet, mesh.material.map.rotation, mesh.material.map.repeat, mesh.material.map.offset]).toEqual([0, 0.5, [3, 3], [0.1, 0.2]])
    // one image, two textures: each with its own set and transform
    expect(mesh.material.map).not.toBe(mesh.material.aoMap)
    expect(warn.mock.calls.some(([w]) => /UV set|rotat/.test(String(w)))).toBe(false)
    warn.mockRestore()
  })

  it('reads sheen, ior, specular, anisotropy and diffuse transmission by their factors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const json = sampleGLTF()
    const names = ['KHR_materials_sheen', 'KHR_materials_ior', 'KHR_materials_specular', 'KHR_materials_anisotropy', 'KHR_materials_diffuse_transmission']
    json.extensionsUsed = [...(json.extensionsUsed ?? []), ...names]
    json.materials[0].extensions = {
      ...json.materials[0].extensions,
      KHR_materials_sheen: { sheenColorFactor: [1, 0, 0], sheenRoughnessFactor: 0.3 },
      KHR_materials_ior: { ior: 2.4 },
      KHR_materials_specular: { specularFactor: 0.5, specularColorFactor: [0, 1, 0] },
      KHR_materials_anisotropy: { anisotropyStrength: 0.7, anisotropyRotation: 1 },
      KHR_materials_diffuse_transmission: { diffuseTransmissionFactor: 0.4, diffuseTransmissionColorFactor: [0, 0, 1] },
    }
    const model = await parseGLTF(json, { baseUrl: 'https://example.com/models/', waitForTextures: false })
    const { material: m } = /** @type {Mesh} */ (model.find('Triangle'))
    expect([m.sheen, m.sheenColor.getHex(), m.sheenRoughness]).toEqual([1, 0xff0000, 0.3])
    expect([m.ior, m.specularIntensity, m.specularColor.getHex()]).toEqual([2.4, 0.5, 0x00ff00])
    expect([m.anisotropy, m.anisotropyRotation]).toEqual([0.7, 1])
    expect([m.translucency, m.translucencyColor.getHex()]).toEqual([0.4, 0x0000ff])
    expect(warn.mock.calls.some(([w]) => names.some((n) => String(w).includes(n)))).toBe(false)
    warn.mockRestore()
  })
})
