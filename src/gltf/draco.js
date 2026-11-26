// Draco-compressed geometry (KHR_draco_mesh_compression): a primitive's attributes and triangles
// decoded by Google's Draco glTF decoder, fetched the first time a model needs it (decoders.js).
// Decoded in workers - a few, the primitives shared out among them - so a big model doesn't hold up
// the page, and on the page itself where workers can't run (no Worker, or a content security policy
// that forbids them). Loaded the first time a model has a Draco primitive.
import { fetchDecoder, loadDecoder } from '../decoders.js'

const SCRIPT = 'draco_wasm_wrapper_gltf.js', WASM = 'draco_decoder_gltf.wasm'

/**
 * A primitive decoded with a ready Draco module: each attribute asked for, in its accessor's component
 * type, and the triangles' indices. Self-contained - it runs as text in the workers too.
 * @param {any} draco @param {Uint8Array} bytes
 * @param {Record<string, { id: number, componentType: number }>} attributes
 * @returns {{ attributes: Record<string, Int8Array | Uint8Array | Int16Array | Uint16Array | Uint32Array | Float32Array>, indices: Uint32Array }}
 */
function decodeWith(draco, bytes, attributes) {
  // each glTF component type: Draco's name for it, and the array it decodes into
  /** @type {Record<number, [string, any]>} */
  const types = {
    5120: ['DT_INT8', Int8Array], 5121: ['DT_UINT8', Uint8Array], 5122: ['DT_INT16', Int16Array],
    5123: ['DT_UINT16', Uint16Array], 5125: ['DT_UINT32', Uint32Array], 5126: ['DT_FLOAT32', Float32Array],
  }
  const decoder = new draco.Decoder()
  const mesh = new draco.Mesh()
  try {
    const array = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (decoder.GetEncodedGeometryType(array) !== draco.TRIANGULAR_MESH) throw new Error('Draco point clouds aren\'t supported - only meshes')
    const status = decoder.DecodeArrayToMesh(array, array.byteLength, mesh)
    if (!status.ok() || mesh.ptr === 0) throw new Error(`Draco couldn't decode a mesh - ${status.error_msg()}`)
    /** @type {Record<string, any>} */
    const out = {}
    for (const [name, { id, componentType }] of Object.entries(attributes)) {
      const attribute = decoder.GetAttributeByUniqueId(mesh, id)
      const [type, Type] = types[componentType] ?? types[5126]
      const count = mesh.num_points() * attribute.num_components()
      const byteLength = count * Type.BYTES_PER_ELEMENT
      const at = draco._malloc(byteLength)
      decoder.GetAttributeDataArrayForAllPoints(mesh, attribute, draco[type], byteLength, at)
      out[name] = new Type(draco.HEAPF32.buffer, at, count).slice()
      draco._free(at)
    }
    const count = mesh.num_faces() * 3, byteLength = count * 4
    const at = draco._malloc(byteLength)
    decoder.GetTrianglesUInt32Array(mesh, byteLength, at)
    const indices = new Uint32Array(draco.HEAPF32.buffer, at, count).slice()
    draco._free(at)
    return { attributes: out, indices }
  } finally {
    draco.destroy(mesh)
    draco.destroy(decoder)
  }
}

/**
 * A worker's script: Draco's own, then the decoding above. Its first message is the WebAssembly; each
 * one after a primitive to decode, answered with its arrays (handed over, not copied) or an error.
 * @param {string} code Draco's script
 */
const workerScript = (code) => `${code}
const decode = ${decodeWith.toString()}
let draco = null, waiting = []
const run = ({ id, bytes, attributes }) => {
  try {
    const out = decode(draco, bytes, attributes)
    self.postMessage({ id, out }, [...Object.values(out.attributes).map((a) => a.buffer), out.indices.buffer])
  } catch (e) {
    self.postMessage({ id, error: String((e && e.message) || e) })
  }
}
self.onmessage = (e) => {
  if (e.data.wasm) {
    DracoDecoderModule({ wasmBinary: e.data.wasm, onModuleLoaded: (m) => { draco = m; waiting.forEach(run); waiting = [] } })
  } else if (draco) run(e.data)
  else waiting.push(e.data)
}
`

/** A worker's errors from decoding, as opposed to its failing to run at all. */
class DecodeError extends Error {}

/**
 * A worker, as decode() calls answered in turn: a decoding error rejects that call; the worker
 * failing (its script blocked, say) rejects every call waiting on it.
 * @param {Worker} worker
 */
function decoderFor(worker) {
  /** @type {Map<number, { resolve: (out: any) => void, reject: (e: Error) => void }>} */
  const pending = new Map()
  let id = 0
  worker.onmessage = (e) => {
    const call = pending.get(e.data.id)
    pending.delete(e.data.id)
    if (e.data.error) call?.reject(new DecodeError(e.data.error))
    else call?.resolve(e.data.out)
  }
  worker.onerror = (e) => {
    e.preventDefault?.()
    for (const call of pending.values()) call.reject(new Error(`a Draco worker failed - ${e.message ?? 'blocked'}`))
    pending.clear()
  }
  return {
    /** @param {Uint8Array} bytes @param {Record<string, { id: number, componentType: number }>} attributes */
    decode(bytes, attributes) {
      const copy = bytes.slice()
      return new Promise((resolve, reject) => {
        pending.set(++id, { resolve, reject })
        worker.postMessage({ id, bytes: copy, attributes }, [copy.buffer])
      })
    },
  }
}

/** The workers, once made - or null where none can run. @type {Promise<ReturnType<typeof decoderFor>[] | null> | null} */
let pool = null
let next = 0

function workers() {
  pool ??= (async () => {
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL.createObjectURL !== 'function') return null
    const { code, binary } = await fetchDecoder('draco', SCRIPT, WASM)
    // a few: one fewer than the processor's cores, at most four
    const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2
    const count = Math.min(4, Math.max(1, cores - 1))
    try {
      // the script's address is kept: a worker reads it after it starts
      const url = URL.createObjectURL(new Blob([workerScript(code)], { type: 'text/javascript' }))
      return Array.from({ length: count }, () => {
        const worker = new Worker(url)
        worker.postMessage({ wasm: binary })
        return decoderFor(worker)
      })
    } catch {
      return null
    }
  })()
  return pool
}

/**
 * A primitive's Draco data decoded: each attribute asked for, as its accessor's component type has
 * it, and the triangles' indices - in a worker where one can run, else here.
 * @param {Uint8Array} bytes the compressed data (the extension's bufferView)
 * @param {Record<string, { id: number, componentType: number }>} attributes each attribute's Draco id
 *   and its accessor's component type
 * @returns {Promise<{ attributes: Record<string, ArrayLike<number>>, indices: Uint32Array }>}
 */
export async function decodeDraco(bytes, attributes) {
  const decoders = await workers()
  if (decoders) {
    try {
      return await decoders[next++ % decoders.length].decode(bytes, attributes)
    } catch (e) {
      // the data's fault: so it would be here too
      if (e instanceof DecodeError) throw e
      // the workers can't run (a policy forbids them): here, from now on
      pool = Promise.resolve(null)
    }
  }
  const draco = await loadDecoder('draco', SCRIPT, WASM, 'DracoDecoderModule')
  return decodeWith(draco, bytes, attributes)
}
