// Asset loading helpers - all Promise based.

export async function loadImage(url) {
  const img = new Image()
  img.src = url
  await img.decode()
  return img
}

export const loadImages = (urls) => Promise.all(urls.map(loadImage))

// Parse Wavefront .obj text into { points, polygons }. Polygons carry `uvs` when the file
// has texture coordinates. Options:
//   scale    scaling factor applied while reading vertices (default 1)
//   scaleTo  rescale so the largest dimension is this size
//   center   translate so the bounding box is centred on the origin
//   reorder  reverse polygon vertex order (for files with back-to-front winding)
export function parseWavefront(text, { scale = 1, scaleTo, center = false, reorder = false } = {}) {
  const points = [], polygons = [], uvs = []
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]

  for (const raw of text.split('\n')) {
    const line = raw.trim().split(/\s+/)
    switch (line[0]) {
      case 'v': {
        const v = [parseFloat(line[1]) * scale, parseFloat(line[2]) * scale, parseFloat(line[3]) * scale]
        for (let i = 0; i < 3; i++) {
          if (v[i] < min[i]) min[i] = v[i]
          if (v[i] > max[i]) max[i] = v[i]
        }
        points.push({ x: v[0], y: v[1], z: v[2] })
        break
      }
      case 'vt':
        uvs.push([parseFloat(line[1]), parseFloat(line[2])])
        break
      case 'f': {
        const tokens = line.slice(1)
        if (reorder) tokens.reverse()
        const vertices = [], uvcoords = []
        for (const token of tokens) {
          // OBJ indices are 1-based; tokens are v, v/vt, v/vt/vn or v//vn
          const [v, vt] = token.split('/')
          vertices.push(parseInt(v) - 1)
          if (vt && !token.includes('//')) {
            const uv = uvs[parseInt(vt) - 1]
            if (uv) uvcoords.push(uv[0], uv[1])
          }
        }
        const poly = { vertices }
        if (uvcoords.length !== 0) poly.uvs = uvcoords
        polygons.push(poly)
        break
      }
    }
  }

  if (center && points.length) {
    const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2, cz = (min[2] + max[2]) / 2
    for (const p of points) {
      p.x -= cx
      p.y -= cy
      p.z -= cz
    }
  }
  if (scaleTo && points.length) {
    const factor = scaleTo / Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2])
    for (const p of points) {
      p.x *= factor
      p.y *= factor
      p.z *= factor
    }
  }
  return { points, polygons }
}

// Fetch and parse a Wavefront .obj file - see parseWavefront() for options.
export async function importGeometryWavefront({ url, ...options }) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status} ${res.statusText}`)
  return parseWavefront(await res.text(), options)
}

// Canvas containing a radial gradient - quick sprite images of blurred spheres for particles,
// explosions etc. Returned as a canvas, which drawImage() accepts directly.
export function generateRadialGradientBitmap(size, innerColour, outerColour) {
  const canvas = document.createElement('canvas')
  const width = size << 1
  canvas.width = canvas.height = width
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createRadialGradient(size, size, size >> 1, size, size, size)
  gradient.addColorStop(0, innerColour)
  gradient.addColorStop(1, outerColour)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, width)
  return canvas
}
