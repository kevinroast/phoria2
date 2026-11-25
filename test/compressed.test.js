// Compressed glTF: meshopt buffer views decoded by the decoder that comes with phoria2/gltf (a real
// one, on a vector from meshoptimizer's own tests); Draco primitives and KTX2 textures by decoders
// fetched from where useDecoders() says - here stand-ins served by a mocked fetch, which check the
// wiring: what is asked of the decoder and what is made of its answer. And the renderer uploading a
// GPU-compressed image level by level.
import { Buffer } from 'node:buffer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Mesh, PerspectiveCamera, Scene, Texture, WebGLRenderer, box, useDecoders } from '../src/index.js'
import { parseGLTF } from '../src/gltf/index.js'
import { transcodeKTX2 } from '../src/ktx2.js'
import { fakeCanvas, fakeGL } from './fakes.js'

/** @typedef {import('../src/scene/drawables.js').Mesh} MeshNode */

const b64 = (/** @type {Uint8Array} */ bytes) => `data:application/octet-stream;base64,${Buffer.from(bytes).toString('base64')}`

// four vertices of six 16-bit numbers each, meshopt-encoded (meshoptimizer's decodeVertexBuffer test)
const ENCODED = new Uint8Array([
  0xa0, 0x01, 0x3f, 0x00, 0x00, 0x00, 0x58, 0x57, 0x58, 0x01, 0x26, 0x00, 0x00, 0x00, 0x01, 0x0c, 0x00, 0x00, 0x00, 0x58, 0x01, 0x08, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x3f, 0x00, 0x00, 0x00, 0x17, 0x18, 0x17, 0x01, 0x26, 0x00, 0x00, 0x00, 0x01, 0x0c, 0x00, 0x00,
  0x00, 0x17, 0x01, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
])

/** A file of one primitive drawn as points, made of `parts`. @param {Record<string, any>} parts */
const gltf = (parts) => ({
  asset: { version: '2.0' },
  scene: 0, scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: 'Part' }],
  ...parts,
})

/**
 * fetch answering the decoders' files with stand-ins - each script hands over the module the test
 * keeps on globalThis - and everything else as usual. Returns the urls asked for.
 */
function serveDecoders() {
  const real = globalThis.fetch
  /** @type {string[]} */
  const asked = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    asked.push(url)
    if (url.endsWith('draco_wasm_wrapper_gltf.js')) return new Response('var DracoDecoderModule = function (o) { o.onModuleLoaded(globalThis.__draco) }')
    if (url.endsWith('basis_transcoder.js')) return new Response('var BASIS = function () { return Promise.resolve(globalThis.__basis) }')
    if (url.endsWith('.wasm')) return new Response(new ArrayBuffer(8))
    return real(input)
  })
  return asked
}

afterEach(() => {
  vi.restoreAllMocks()
  delete (/** @type {any} */ (globalThis)).__draco
  delete (/** @type {any} */ (globalThis)).__basis
})

describe('meshopt', () => {
  it('decodes compressed buffer views before reading them - a fallback buffer with no data of its own', async () => {
    const model = await parseGLTF(gltf({
      extensionsUsed: ['EXT_meshopt_compression', 'KHR_mesh_quantization'],
      extensionsRequired: ['EXT_meshopt_compression', 'KHR_mesh_quantization'],
      buffers: [{ byteLength: ENCODED.length, uri: b64(ENCODED) }, { byteLength: 48, extensions: { EXT_meshopt_compression: { fallback: true } } }],
      bufferViews: [{ buffer: 1, byteLength: 48, byteStride: 12, extensions: { EXT_meshopt_compression: { buffer: 0, byteLength: ENCODED.length, byteStride: 12, count: 4, mode: 'ATTRIBUTES' } } }],
      // the first three of each vertex's six numbers, as quantized positions
      accessors: [{ bufferView: 0, componentType: 5123, count: 4, type: 'VEC3' }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 0 }] }],
    }))
    const points = /** @type {any} */ (model.find('Part'))
    expect(Array.from(points.geometry.positions)).toEqual([0, 0, 0, 300, 0, 0, 0, 300, 0, 300, 300, 0])
  })
})

describe('Draco', () => {
  /** A stand-in decoder: a triangle, its colours as normalized bytes, its winding turned. */
  function fakeDraco() {
    const heap = new ArrayBuffer(1024)
    let top = 16
    return {
      TRIANGULAR_MESH: 1, DT_FLOAT32: 9, DT_UINT8: 2, HEAPF32: new Float32Array(heap),
      _malloc: (/** @type {number} */ n) => { const at = top; top += Math.ceil(n / 8) * 8; return at },
      _free() {}, destroy() {},
      Mesh: class { ptr = 1; num_points() { return 3 } num_faces() { return 1 } },
      Decoder: class {
        GetEncodedGeometryType() { return 1 }
        DecodeArrayToMesh() { return { ok: () => true, error_msg: () => '' } }
        GetAttributeByUniqueId(/** @type {any} */ _m, /** @type {number} */ id) { return { id, num_components: () => (id === 4 ? 3 : 4) } }
        GetAttributeDataArrayForAllPoints(/** @type {any} */ _m, /** @type {any} */ a, /** @type {number} */ type, /** @type {number} */ _n, /** @type {number} */ at) {
          if (a.id === 4 && type === 9) new Float32Array(heap, at, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0])
          if (a.id === 7 && type === 2) new Uint8Array(heap, at, 12).set([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255])
        }
        GetTrianglesUInt32Array(/** @type {any} */ _m, /** @type {number} */ _n, /** @type {number} */ at) { new Uint32Array(heap, at, 3).set([0, 2, 1]) }
      },
    }
  }

  it("decodes a primitive with the decoder from useDecoders' folder: its attributes by their Draco ids, normalized as their accessors say", async () => {
    ;(/** @type {any} */ (globalThis)).__draco = fakeDraco()
    const asked = serveDecoders()
    useDecoders({ draco: 'https://example.com/draco' })
    const model = await parseGLTF(gltf({
      extensionsUsed: ['KHR_draco_mesh_compression'], extensionsRequired: ['KHR_draco_mesh_compression'],
      buffers: [{ byteLength: 4, uri: b64(new Uint8Array([1, 2, 3, 4])) }],
      bufferViews: [{ buffer: 0, byteLength: 4 }],
      accessors: [
        { componentType: 5126, count: 3, type: 'VEC3' },
        { componentType: 5121, normalized: true, count: 3, type: 'VEC4' },
        { componentType: 5125, count: 3, type: 'SCALAR' },
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 0, COLOR_0: 1 }, indices: 2,
        extensions: { KHR_draco_mesh_compression: { bufferView: 0, attributes: { POSITION: 4, COLOR_0: 7 } } } }] }],
    }))
    expect(asked).toContain('https://example.com/draco/draco_wasm_wrapper_gltf.js')
    expect(asked).toContain('https://example.com/draco/draco_decoder_gltf.wasm')
    const { geometry } = /** @type {MeshNode} */ (model.find('Part'))
    expect(Array.from(geometry.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
    expect(Array.from(/** @type {Uint32Array} */ (geometry.indices))).toEqual([0, 2, 1])
    // bytes of 255 as 1: red, green, blue
    expect(Array.from(/** @type {Float32Array} */ (geometry.colors)).slice(0, 3)).toEqual([1, 0, 0])
  })

  it('names the folders it takes, and nothing else', () => {
    expect(() => useDecoders({ meshopt: '/m/' })).toThrow("meshopt's decoder comes with phoria2/gltf")
    expect(() => useDecoders({ draco: '' })).toThrow("'draco' is the folder its decoder loads from")
  })
})

describe('KTX2', () => {
  /** A stand-in transcoder: an 8x8 file of two levels, with no GPU format to aim for (Node), so RGBA. */
  function fakeBasis() {
    const calls = /** @type {number[]} */ ([])
    return {
      calls,
      KTX2File: class {
        isValid() { return true }
        getFaces() { return 1 }
        getWidth() { return 8 }
        getHeight() { return 8 }
        getLevels() { return 2 }
        getHasAlpha() { return false }
        startTranscoding() { return true }
        getImageTranscodedSizeInBytes() { return 8 * 8 * 4 }
        transcodeImage(/** @type {Uint8Array} */ out, /** @type {number} */ _level, /** @type {number} */ _l, /** @type {number} */ _f, /** @type {number} */ format) {
          calls.push(format)
          out.fill(200)
          return true
        }
        close() {}
        delete() {}
      },
    }
  }

  it('transcodes to RGBA where the GPU has no compressed format to aim for - the top level, mipmapped as any image', async () => {
    const basis = fakeBasis()
    ;(/** @type {any} */ (globalThis)).__basis = basis
    serveDecoders()
    useDecoders({ basis: 'https://example.com/basis/' })
    const image = /** @type {any} */ (await transcodeKTX2(new ArrayBuffer(16)))
    expect([image.width, image.height, image.data.length, image.data[0]]).toEqual([8, 8, 256, 200])
    // basisu's cTFRGBA32
    expect(basis.calls).toEqual([13])
  })

  it('takes a texture from its KHR_texture_basisu source, embedded - transcoded as it loads', async () => {
    ;(/** @type {any} */ (globalThis)).__basis = fakeBasis()
    serveDecoders()
    useDecoders({ basis: 'https://example.com/basis/' })
    const model = await parseGLTF(gltf({
      extensionsUsed: ['KHR_texture_basisu'], extensionsRequired: ['KHR_texture_basisu'],
      buffers: [{ byteLength: 36, uri: b64(new Uint8Array(36)) }],
      bufferViews: [{ buffer: 0, byteLength: 36 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
      images: [{ uri: b64(new Uint8Array([0xab, 0x4b, 0x54, 0x58])).replace('application/octet-stream', 'image/ktx2'), mimeType: 'image/ktx2' }],
      textures: [{ extensions: { KHR_texture_basisu: { source: 0 } } }],
      materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    }))
    const map = /** @type {Texture} */ (/** @type {MeshNode} */ (model.find('Part')).material.map)
    expect(map.url?.endsWith('#.ktx2')).toBe(true)
    const image = /** @type {any} */ (map.image)
    expect([image.width, image.height]).toEqual([8, 8])
  })
})

describe('GPU-compressed images', () => {
  /** The fake GL with BC7, logging the compressed uploads and texture parameters. */
  function bc7GL(has = true) {
    const fake = fakeGL()
    const uploads = /** @type {any[]} */ ([]), parameters = /** @type {any[]} */ ([])
    const gl = new Proxy(fake.gl, {
      get: (t, k) => k === 'getExtension' ? (/** @type {string} */ name) => (name === 'EXT_texture_compression_bptc' && has ? {} : t.getExtension(name))
        : k === 'compressedTexImage2D' ? (/** @type {any[]} */ ...args) => uploads.push(args.slice(1, 5))
          : k === 'texParameteri' ? (/** @type {any[]} */ ...args) => parameters.push(args.slice(1))
            : t[k],
    })
    return { gl, uploads, parameters, fake }
  }
  const scene = (/** @type {Texture} */ map) => {
    const s = new Scene()
    s.add(new Mesh({ geometry: box(1), material: { map } }))
    s.updateWorldTree()
    return s
  }
  const camera = () => new PerspectiveCamera({ position: [0, 0, 4], target: [0, 0, 0], aspect: 1 })

  it('uploads each mip level as it is - in its sRGB form for a colour map - and samples only the levels it has', () => {
    const { gl, uploads, parameters, fake } = bc7GL()
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl) })
    renderer.setSize(32, 32)
    const map = new Texture({ image: { compressed: 'bc7', width: 8, height: 8, levels: [new Uint8Array(64), new Uint8Array(16)] } })
    renderer.render(scene(map), camera())
    // COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT, level by level
    expect(uploads).toEqual([[0, 0x8e8d, 8, 8], [1, 0x8e8d, 4, 4]])
    expect(parameters).toContainEqual([fake.gl.TEXTURE_MAX_LEVEL, 1])
    expect(parameters).toContainEqual([fake.gl.TEXTURE_MIN_FILTER, fake.gl.LINEAR_MIPMAP_LINEAR])
  })

  it('a format this GPU lacks is drawn white, with a word', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { gl, uploads } = bc7GL(false)
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl) })
    renderer.setSize(32, 32)
    renderer.render(scene(new Texture({ image: { compressed: 'bc7', width: 4, height: 4, levels: [new Uint8Array(16)] } })), camera())
    expect(uploads).toEqual([])
    expect(warn.mock.calls.some(([w]) => String(w).includes("compressed texture (bc7) this GPU can't draw"))).toBe(true)
  })
})
