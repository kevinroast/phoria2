import { Geometry, Points, Texture } from 'phoria2'

// Small pieces several demos share: sprite textures drawn on a 2D canvas (white, so points' colours
// tint them), a starfield, seeded random numbers, a legend and file downloads.

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

/** Seeded random numbers (mulberry32), so a demo's made-up data is the same every time. */
export function random(seed = 1) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A legend in the bottom left: a swatch and name per item. With onToggle, clicking an item turns it
 * off and on.
 * @param {{ label: string, color: string }[]} items
 * @param {{ title?: string, onToggle?: (index: number, on: boolean) => void }} [options]
 */
export function legend(items, { title, onToggle } = {}) {
  const el = document.createElement('div')
  el.className = 'demo-legend'
  if (title) {
    const h = document.createElement('div')
    h.className = 'demo-legend-title'
    h.textContent = title
    el.append(h)
  }
  items.forEach(({ label, color }, i) => {
    const item = document.createElement(onToggle ? 'button' : 'div')
    item.className = 'demo-legend-item'
    item.innerHTML = `<span class="demo-legend-swatch" style="background:${color}"></span>`
    item.append(label)
    if (onToggle) {
      item.addEventListener('click', () => onToggle(i, !item.classList.toggle('off')))
    }
    el.append(item)
  })
  document.body.append(el)
  return el
}

/** Save a Blob as a file. @param {Blob} blob @param {string} name */
export function download(blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
