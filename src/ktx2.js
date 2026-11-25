// KTX2 textures (Basis Universal, as glTF's KHR_texture_basisu has them): one file transcoded, as it
// loads, to a compressed format this GPU draws from directly - ASTC on phones, BC7 or BC1/BC3 on
// desktops, ETC2 where that is all there is - each mip level as the file has it. A GPU with none of
// them (or none in sRGB, for a colour map) gets plain RGBA. The transcoder is Basis Universal's own,
// fetched the first time (decoders.js). Loaded the first time a texture is a .ktx2.
import { loadDecoder } from './decoders.js'

/** @import { CompressedImage, DataImage } from './material/Texture.js' */

// the transcoder's target formats (basisu_transcoder.h's transcoder_texture_format)
const TF = { etc1: 0, etc2: 1, bc1: 2, bc3: 3, bc7: 6, astc: 10, rgba32: 13 }

/** What this GPU can draw from, found once with a small context of its own. @type {Record<string, boolean> | null} */
let CAN = null

/** @returns {Record<string, boolean>} */
function formats() {
  if (CAN) return CAN
  /** @type {WebGL2RenderingContext | null} */
  let gl = null
  try {
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas')
    gl = /** @type {WebGL2RenderingContext | null} */ (canvas.getContext('webgl2'))
  } catch {
    gl = null
  }
  const has = (/** @type {string} */ name) => !!gl?.getExtension(name)
  // each needs its sRGB form too, for colour maps: S3TC has it in an extension of its own
  CAN = {
    astc: has('WEBGL_compressed_texture_astc'),
    bc7: has('EXT_texture_compression_bptc'),
    s3tc: has('WEBGL_compressed_texture_s3tc') && has('WEBGL_compressed_texture_s3tc_srgb'),
    etc: has('WEBGL_compressed_texture_etc'),
  }
  gl?.getExtension('WEBGL_lose_context')?.loseContext()
  return CAN
}

/**
 * The format to transcode to: the best this GPU draws from, for an image this size, with alpha or
 * not. Block formats need sizes in whole 4x4 blocks; an odd size goes as RGBA.
 * @param {number} width @param {number} height @param {boolean} alpha
 * @returns {CompressedImage['compressed'] | 'rgba'}
 */
export function targetFormat(width, height, alpha) {
  if (width % 4 || height % 4) return 'rgba'
  const can = formats()
  if (can.astc) return 'astc'
  if (can.bc7) return 'bc7'
  if (can.s3tc) return alpha ? 'bc3' : 'bc1'
  if (can.etc) return alpha ? 'etc2' : 'etc2-rgb'
  return 'rgba'
}

const TRANSCODE_TO = { astc: TF.astc, bc7: TF.bc7, bc3: TF.bc3, bc1: TF.bc1, etc2: TF.etc2, 'etc2-rgb': TF.etc1, rgba: TF.rgba32 }

/**
 * A .ktx2 file's image, transcoded for this GPU: its mip levels compressed, or RGBA.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<CompressedImage | DataImage>}
 */
export async function transcodeKTX2(buffer) {
  const basis = await loadDecoder('basis', 'basis_transcoder.js', 'basis_transcoder.wasm', 'BASIS')
  const file = new basis.KTX2File(new Uint8Array(buffer))
  try {
    if (!file.isValid()) throw new Error('not a valid KTX2 file')
    if ((file.getFaces() || 1) > 1) throw new Error('cube maps in KTX2 aren\'t supported')
    const width = file.getWidth(), height = file.getHeight(), levels = Math.max(1, file.getLevels())
    const format = targetFormat(width, height, !!file.getHasAlpha())
    const to = TRANSCODE_TO[format]
    if (!file.startTranscoding()) throw new Error('transcoding couldn\'t start')
    const transcode = (/** @type {number} */ level) => {
      const out = new Uint8Array(file.getImageTranscodedSizeInBytes(level, 0, 0, to))
      if (!file.transcodeImage(out, level, 0, 0, to, 0, -1, -1)) throw new Error(`level ${level} couldn't be transcoded`)
      return out
    }
    // plain RGBA: the top level, mipmapped as any image is
    if (format === 'rgba') return { data: transcode(0), width, height }
    const mips = []
    for (let level = 0; level < levels; level++) mips.push(transcode(level))
    return { compressed: format, width, height, levels: mips }
  } finally {
    file.close()
    file.delete()
  }
}
