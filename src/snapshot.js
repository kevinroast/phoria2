// view.toImage(): the canvas as an image file, with the HTML labels painted in so the export
// matches what is on screen.
import { PhoriaError } from './validate.js'

/** @import { Leader } from './labels.js' */

/**
 * @typedef {object} ImageOptions
 * @property {string} [type] 'image/png' (default), 'image/jpeg' or 'image/webp'
 * @property {number} [quality] 0-1 for jpeg and webp
 * @property {boolean} [labels] paint the visible labels into the image (default true)
 */

/**
 * Encode a just-drawn WebGL canvas, painting label elements over it. Call in the same task as the
 * draw: the drawing buffer is only guaranteed until the browser composites.
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLElement[]} labels the label elements on show
 * @param {ImageOptions} options
 * @param {Leader[]} [leaders] callouts' lines, drawn under the labels
 * @returns {Promise<Blob>}
 */
export function snapshot(canvas, labels, { type = 'image/png', quality, labels: withLabels = true } = {}, leaders = []) {
  let out = canvas
  if (withLabels && labels.length) {
    out = document.createElement('canvas')
    out.width = canvas.width
    out.height = canvas.height
    const ctx = /** @type {CanvasRenderingContext2D} */ (out.getContext('2d'))
    ctx.drawImage(canvas, 0, 0)
    const frame = canvas.getBoundingClientRect()
    const scale = canvas.width / (frame.width || 1)
    for (const leader of leaders) paintLeader(ctx, leader, scale)
    for (const el of labels) paintLabel(ctx, el, frame, scale)
  }
  return new Promise((resolve, reject) => out.toBlob((blob) => {
    if (blob) resolve(blob)
    else reject(new PhoriaError(`View: toImage() couldn't encode '${type}'`))
  }, type, quality))
}

/** The text as CSS text-transform shows it. @param {string} text @param {string} transform */
function transformText(text, transform) {
  if (transform === 'uppercase') return text.toUpperCase()
  if (transform === 'lowercase') return text.toLowerCase()
  if (transform === 'capitalize') return text.replace(/\b\p{L}/gu, (c) => c.toUpperCase())
  return text
}

/** @param {CanvasRenderingContext2D} ctx @param {Leader} leader @param {number} scale */
function paintLeader(ctx, { from, to, color, opacity }, scale) {
  ctx.save()
  ctx.globalAlpha = opacity
  ctx.strokeStyle = ctx.fillStyle = color
  ctx.lineWidth = scale
  ctx.beginPath()
  ctx.moveTo(from[0] * scale, from[1] * scale)
  ctx.lineTo(to[0] * scale, to[1] * scale)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(from[0] * scale, from[1] * scale, 2.5 * scale, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** @param {CanvasRenderingContext2D} ctx @param {HTMLElement} el @param {DOMRect} frame @param {number} scale */
function paintLabel(ctx, el, frame, scale) {
  const r = el.getBoundingClientRect(), cs = getComputedStyle(el)
  const x = (r.left - frame.left) * scale, y = (r.top - frame.top) * scale
  const w = r.width * scale, h = r.height * scale
  ctx.save()
  ctx.globalAlpha = parseFloat(el.style.opacity || cs.opacity) || 1
  if (!/rgba\(.*,\s*0\)$|transparent/.test(cs.backgroundColor)) {
    ctx.fillStyle = cs.backgroundColor
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, (parseFloat(cs.borderTopLeftRadius) || 0) * scale)
    ctx.fill()
  }
  ctx.fillStyle = cs.color
  ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${parseFloat(cs.fontSize) * scale}px ${cs.fontFamily}`
  ctx.textBaseline = 'middle'
  ctx.fillText(transformText(el.textContent ?? '', cs.textTransform), x + (parseFloat(cs.paddingLeft) || 0) * scale, y + h / 2)
  ctx.restore()
}
