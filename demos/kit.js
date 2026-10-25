import { Geometry, Points, Texture } from 'phoria2'

// Small pieces several demos share: sprite textures drawn on a 2D canvas (white, so points' colours
// tint them) and a starfield.

/** A soft round glow: opaque centre fading to nothing at the edge. */
export function glow(size = 64, { core = 0 } = {}) {
  const { canvas, ctx } = square(size)
  const g = ctx.createRadialGradient(size / 2, size / 2, size / 2 * core, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255, 255, 255, 1)')
  g.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return new Texture({ image: canvas })
}

/** A starburst: thin random rays from the centre, for sparkles. */
export function sparkle(size = 64, rays = 48) {
  const { canvas, ctx } = square(size)
  const c = size / 2
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)'
  ctx.beginPath()
  for (let i = 0; i < rays; i++) {
    const a = Math.random() * Math.PI * 2, r = c * (0.4 + Math.random() * 0.6)
    ctx.moveTo(c, c)
    ctx.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r)
  }
  ctx.stroke()
  return new Texture({ image: canvas })
}

/** Stars on a shell around the origin, a fixed number of pixels across at any distance. */
export function starfield(count = 2000, radius = 400) {
  const positions = new Float32Array(count * 3), colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    // an even spread over the sphere, at slightly varying depths
    const y = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = radius * (0.8 + Math.random() * 0.2)
    const ring = Math.sqrt(1 - y * y)
    positions.set([Math.cos(a) * ring * r, y * r, Math.sin(a) * ring * r], i * 3)
    const b = 0.5 + Math.random() * 0.5, tint = Math.random() * 0.15
    colors.set([b - tint, b - tint / 2, b], i * 3)
  }
  return new Points({
    geometry: new Geometry({ positions, colors }),
    material: { size: 2, sizeAttenuation: false, vertexColors: true },
    pickable: false,
  })
}

function square(size) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  return { canvas, ctx: /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d')) }
}
