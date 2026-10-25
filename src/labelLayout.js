// Label placement and overlap resolution, as plain arithmetic on boxes - no DOM, so it is testable
// and the label layer stays a thin writer of styles.

/** @import { LabelPlace } from './scene/drawables.js' */

// gap between a point and a label placed beside it, in CSS pixels
const GAP = 6
// grid cell size for finding neighbours quickly
const CELL = 64

/**
 * Top-left corner of a label box placed relative to its point.
 * @param {number} x @param {number} y the point, in pixels
 * @param {number} width @param {number} height the label's size
 * @param {LabelPlace} place where the label goes relative to the point
 * @param {[number, number]} offset extra shift in pixels
 * @returns {[number, number]}
 */
export function placeBox(x, y, width, height, place, offset) {
  let left = x - width / 2, top = y - height / 2
  if (place === 'above') top = y - height - GAP
  else if (place === 'below') top = y + GAP
  else if (place === 'left') left = x - width - GAP
  else if (place === 'right') left = x + GAP
  return [left + offset[0], top + offset[1]]
}

/**
 * @typedef {object} LabelBox
 * @property {number} left
 * @property {number} top
 * @property {number} width
 * @property {number} height
 * @property {number} priority higher is kept first
 * @property {'hide' | 'show'} overlap 'show' is always kept
 * @property {number} depth nearer is kept first among equal priorities
 */

/**
 * Which labels to show. 'show' labels go first, then higher priorities, then nearer ones; a 'hide'
 * label that would overlap one already placed is dropped. Greedy and stable, so the same view
 * always shows the same labels.
 * @param {LabelBox[]} boxes
 * @param {number} [padding] pixels kept clear around each label (default 2)
 * @returns {boolean[]} shown, by index
 */
export function layoutLabels(boxes, padding = 2) {
  const order = boxes.map((_, i) => i).sort((a, b) => {
    const x = boxes[a], y = boxes[b]
    return (y.overlap === 'show' ? 1 : 0) - (x.overlap === 'show' ? 1 : 0) || y.priority - x.priority || x.depth - y.depth || a - b
  })
  const shown = new Array(boxes.length).fill(false)
  /** @type {Map<string, LabelBox[]>} */
  const grid = new Map()
  const cells = (b, fn) => {
    const x0 = Math.floor((b.left - padding) / CELL), x1 = Math.floor((b.left + b.width + padding) / CELL)
    const y0 = Math.floor((b.top - padding) / CELL), y1 = Math.floor((b.top + b.height + padding) / CELL)
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) fn(`${cx},${cy}`)
  }
  const overlaps = (a, b) => a.left < b.left + b.width + padding && b.left < a.left + a.width + padding &&
    a.top < b.top + b.height + padding && b.top < a.top + a.height + padding

  for (const i of order) {
    const box = boxes[i]
    if (box.overlap !== 'show') {
      let blocked = false
      cells(box, (key) => { if (!blocked) blocked = (grid.get(key) ?? []).some((other) => overlaps(box, other)) })
      if (blocked) continue
    }
    shown[i] = true
    cells(box, (key) => {
      let list = grid.get(key)
      if (!list) grid.set(key, list = [])
      list.push(box)
    })
  }
  return shown
}
