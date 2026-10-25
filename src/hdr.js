// Radiance .hdr (RGBE) images: the common format for environment maps. Loaded on demand by
// Texture when a url ends in .hdr, so apps without one don't carry the parser.

/** @import { DataImage } from './material/Texture.js' */

/**
 * Decode a Radiance .hdr file to linear RGBA floats, top row first.
 * @param {ArrayBuffer | Uint8Array} buffer
 * @returns {DataImage}
 */
export function parseHDR(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let pos = 0
  const line = () => {
    let s = ''
    while (pos < bytes.length && bytes[pos] !== 10) s += String.fromCharCode(bytes[pos++])
    pos++
    return s
  }
  const magic = line()
  if (!magic.startsWith('#?')) throw new Error("parseHDR: not a Radiance .hdr file (no '#?' signature)")
  // header lines until a blank one, then the size: -Y height +X width (top to bottom, left to right)
  let format = ''
  for (let l = line(); l !== ''; l = line()) {
    if (pos >= bytes.length) throw new Error('parseHDR: the header never ends')
    if (l.startsWith('FORMAT=')) format = l.slice(7)
  }
  if (format && format !== '32-bit_rle_rgbe') throw new Error(`parseHDR: format '${format}' isn't supported - expected 32-bit_rle_rgbe`)
  const size = line().match(/^-Y (\d+) \+X (\d+)$/)
  if (!size) throw new Error('parseHDR: only top-to-bottom, left-to-right images (-Y h +X w) are supported')
  const height = Number(size[1]), width = Number(size[2])

  const rgbe = new Uint8Array(width * height * 4)
  const scan = new Uint8Array(width * 4)
  for (let y = 0; y < height; y++) {
    const rle = width >= 8 && width < 32768 && bytes[pos] === 2 && bytes[pos + 1] === 2 && !(bytes[pos + 2] & 0x80)
    if (!rle) {
      // flat: the rest of the file is plain RGBE quads
      rgbe.set(bytes.subarray(pos, pos + (height - y) * width * 4), y * width * 4)
      break
    }
    if (((bytes[pos + 2] << 8) | bytes[pos + 3]) !== width) throw new Error('parseHDR: a scanline has the wrong width')
    pos += 4
    // each of the four channels in turn, as runs and literals
    for (let c = 0; c < 4; c++) {
      let x = 0
      while (x < width) {
        let count = bytes[pos++]
        if (count > 128) {
          count -= 128
          const value = bytes[pos++]
          for (let i = 0; i < count; i++) scan[(x++) * 4 + c] = value
        } else {
          for (let i = 0; i < count; i++) scan[(x++) * 4 + c] = bytes[pos++]
        }
      }
    }
    rgbe.set(scan, y * width * 4)
  }

  const data = new Float32Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const e = rgbe[i * 4 + 3]
    const f = e ? 2 ** (e - 136) : 0
    data[i * 4] = rgbe[i * 4] * f
    data[i * 4 + 1] = rgbe[i * 4 + 1] * f
    data[i * 4 + 2] = rgbe[i * 4 + 2] * f
    data[i * 4 + 3] = 1
  }
  return { data, width, height }
}
