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

/**
 * A "show chart spec" switch in the controls, and the panel it opens: the chart() call that makes this
 * chart, as it stands - read from chart.toJSON() twice a second while open, so it follows the
 * controls and live data. Long lists of rows show their first few.
 * @param {any} gui @param {any} chart
 */
export function showSpec(gui, chart) {
  const panel = document.createElement('div')
  panel.className = 'code-panel spec-panel'
  panel.hidden = true
  panel.innerHTML = '<p>The spec</p><pre></pre>'
  const pre = /** @type {HTMLPreElement} */ (panel.querySelector('pre'))
  document.body.append(panel)
  const refresh = () => {
    // a chart's JSON is its spec, with the type create() reads it by
    const spec = chart.toJSON()
    delete spec.type
    const text = `chart(${literal(spec, '')})`
    if (pre.textContent !== text) pre.textContent = text
  }
  let timer = 0
  gui.add({ spec: false }, 'spec').name('show chart spec').onChange((on) => {
    panel.hidden = !on
    clearInterval(timer)
    if (!on) return
    refresh()
    timer = setInterval(refresh, 500)
  })
}

// rows shown of a long list of them
const ROWS = 3

/**
 * A value as JavaScript source: objects on one line when they fit, dates as new Date(...),
 * functions as written, and a long list of rows cut to its first few - a row to a line.
 * @param {unknown} v @param {string} indent @param {boolean} [line] all on one line, however long
 * @returns {string}
 */
function literal(v, indent, line = false) {
  const inner = `${indent}  `
  if (v instanceof Date) return `new Date('${v.toISOString().replace('T00:00:00.000Z', '')}')`
  if (typeof v === 'function') return String(v)
  if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  if (Array.isArray(v)) {
    const rows = v.length > ROWS && v.every((r) => r && typeof r === 'object' && !Array.isArray(r))
    const items = (rows ? v.slice(0, ROWS) : v).map((x) => literal(x, inner, line || rows))
    if (rows) items.push(`// ... ${v.length - ROWS} more rows`)
    const flat = `[${items.join(', ')}]`
    return line || (!rows && flat.length <= 64 && !flat.includes('\n')) ? flat
      : `[\n${items.map((x, i) => `${inner}${x}${i < items.length - 1 && !items[i + 1].startsWith('//') ? ',' : ''}`).join('\n')}\n${indent}]`
  }
  if (v && typeof v === 'object') {
    const items = Object.entries(v).filter(([, x]) => x !== undefined)
      .map(([k, x]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`}: ${literal(x, inner, line)}`)
    const flat = items.length ? `{ ${items.join(', ')} }` : '{}'
    return line || (flat.length <= 64 && !flat.includes('\n')) ? flat : `{\n${items.map((x) => `${inner}${x},`).join('\n')}\n${indent}}`
  }
  return String(v)
}

/** Save a Blob as a file. @param {Blob} blob @param {string} name */
export function download(blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
