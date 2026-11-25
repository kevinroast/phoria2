// Draco-compressed geometry (KHR_draco_mesh_compression): a primitive's attributes and triangles
// decoded by Google's Draco glTF decoder, fetched the first time a model needs it (decoders.js).
// Loaded the first time a model has a Draco primitive.
import { loadDecoder } from '../decoders.js'

// each glTF component type: Draco's name for it, and the array it decodes into
const TYPES = /** @type {Record<number, [string, Int8ArrayConstructor | Uint8ArrayConstructor | Int16ArrayConstructor | Uint16ArrayConstructor | Uint32ArrayConstructor | Float32ArrayConstructor]>} */ ({
  5120: ['DT_INT8', Int8Array], 5121: ['DT_UINT8', Uint8Array], 5122: ['DT_INT16', Int16Array],
  5123: ['DT_UINT16', Uint16Array], 5125: ['DT_UINT32', Uint32Array], 5126: ['DT_FLOAT32', Float32Array],
})

/**
 * A primitive's Draco data decoded: each attribute asked for, as its accessor's component type has
 * it, and the triangles' indices.
 * @param {Uint8Array} bytes the compressed data (the extension's bufferView)
 * @param {Record<string, { id: number, componentType: number }>} attributes each attribute's Draco id
 *   and its accessor's component type
 * @returns {Promise<{ attributes: Record<string, ArrayLike<number>>, indices: Uint32Array }>}
 */
export async function decodeDraco(bytes, attributes) {
  const draco = await loadDecoder('draco', 'draco_wasm_wrapper_gltf.js', 'draco_decoder_gltf.wasm', 'DracoDecoderModule')
  const decoder = new draco.Decoder()
  const mesh = new draco.Mesh()
  try {
    const array = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (decoder.GetEncodedGeometryType(array) !== draco.TRIANGULAR_MESH) throw new Error('Draco point clouds aren\'t supported - only meshes')
    const status = decoder.DecodeArrayToMesh(array, array.byteLength, mesh)
    if (!status.ok() || mesh.ptr === 0) throw new Error(`Draco couldn't decode a mesh - ${status.error_msg()}`)
    /** @type {Record<string, ArrayLike<number>>} */
    const out = {}
    for (const [name, { id, componentType }] of Object.entries(attributes)) {
      const attribute = decoder.GetAttributeByUniqueId(mesh, id)
      const [type, Type] = TYPES[componentType] ?? TYPES[5126]
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
