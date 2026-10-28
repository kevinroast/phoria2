// Label placement and overlap resolution, as plain arithmetic on boxes - no DOM, so it is testable
// and the label layer stays a thin writer of styles.

/** @import { LabelPlace } from './scene/drawables.js' */

// gap between a point and a label placed beside it, in CSS pixels
const GAP = 6
// how far labels set at an edge of the view sit in from it, in CSS pixels
const EDGE = 16
// grid cell size for finding neighbours quickly
const CELL = 64
// how far two labels may run into each other before one gives way: a label newly showing
// needs to be mostly clear; one already showing holds on through more, so labels don't flicker
// in and out as the view moves
const NEW_OVERLAP = 0.2
const KEEP_OVERLAP = 0.5

/**
 * Top-left corner of a label box placed relative to its point.
 * @param {number} x @param {number} y the point, in pixels
 * @param {number} width @param {number} height the label's size
 * @param {LabelPlace} place where the label goes relative to the point
 * @param {[number, number]} offset extra shift in pixels
 * @param {'left' | 'right' | null} [edge] set at that edge of the view instead, level with the point
 * @param {number} [viewWidth] the view's width, for edge: 'right'
 * @returns {[number, number]}
 */
export function placeBox(x, y, width, height, place, offset, edge = null, viewWidth = 0) {
  // at an edge of the view, level with the point: offset moves it in from the edge, and up or down
  if (edge) return [edge === 'left' ? EDGE + offset[0] : viewWidth - EDGE - width - offset[0], y - height / 2 + offset[1]]
  let left = x - width / 2, top = y - height / 2
  if (place === 'above') top = y - height - GAP
  else if (place === 'below') top = y + GAP
  else if (place === 'left') left = x - width - GAP
  else if (place === 'right') left = x + GAP
  return [left + offset[0], top + offset[1]]
}

/**
 * Space out the labels in a column at an edge of the view, so callouts never overlap: in each
 * column they keep the order of their points, top to bottom, at least `gap` apart. Labels that would
 * run into each other move as a group, centred where they wanted to be on average - so each stays
 * as near its point as it can - and the group is kept inside the view. Changes each box's top.
 * @param {{ top: number, height: number, edge?: 'left' | 'right' | null }[]} boxes
 * @param {number} height the view's height
 * @param {number} [gap]
 */
export function stackColumns(boxes, height, gap = 4) {
  for (const side of ['left', 'right']) {
    const column = boxes.filter((b) => b.edge === side).sort((a, b) => a.top - b.top)
    /** @type {{ items: typeof column, wants: number[], top: number, height: number }[]} */
    const groups = []
    for (const box of column) {
      let group = { items: [box], wants: [box.top], top: box.top, height: box.height }
      // merge with the group above while they would overlap
      while (groups.length) {
        const above = groups[groups.length - 1]
        if (above.top + above.height + gap <= group.top) break
        groups.pop()
        const items = [...above.items, ...group.items], wants = [...above.wants, ...group.wants]
        let offset = 0, shift = 0
        for (let i = 0; i < items.length; i++) {
          shift += wants[i] - offset
          offset += items[i].height + gap
        }
        const total = offset - gap
        group = { items, wants, top: Math.min(Math.max(shift / items.length, 0), Math.max(0, height - total)), height: total }
      }
      groups.push(group)
    }
    for (const group of groups) {
      let top = group.top
      for (const box of group.items) {
        box.top = top
        top += box.height + gap
      }
    }
  }
}

/**
 * Line up each column of labels at an edge of the view: every label in it as wide as the widest, the
 * right column's moved in to keep its right side at the edge - so their leaders all start from the
 * same line and none runs under a neighbour. Changes each box's width (and left, on the right).
 * @param {{ left: number, width: number, edge?: 'left' | 'right' | null }[]} boxes
 */
export function alignColumns(boxes) {
  for (const side of ['left', 'right']) {
    const column = boxes.filter((b) => b.edge === side)
    const widest = Math.max(0, ...column.map((b) => b.width))
    for (const b of column) {
      if (side === 'right') b.left -= widest - b.width
      b.width = widest
    }
  }
}

/**
 * Where a leader line from a label's point meets its box: the nearest point of the box, or null
 * when the point is in (or touching) the box and needs no line. A callout in a column at an edge is
 * met at the inner end of its bottom edge, where an underline ends - and always gets its line.
 * @param {number} x @param {number} y the point
 * @param {{ left: number, top: number, width: number, height: number }} box
 * @param {'left' | 'right' | null} [edge]
 * @returns {[number, number] | null}
 */
export function leaderEnd(x, y, box, edge = null) {
  if (edge) return [edge === 'left' ? box.left + box.width : box.left, box.top + box.height]
  const tx = Math.min(Math.max(x, box.left), box.left + box.width)
  const ty = Math.min(Math.max(y, box.top), box.top + box.height)
  return Math.hypot(tx - x, ty - y) < 2 ? null : [tx, ty]
}

/**
 * @typedef {object} LabelBox
 * @property {number} left
 * @property {number} top
 * @property {number} width
 * @property {number} height
 * @property {number} priority higher is kept first
 * @property {'hide' | 'dim' | 'show'} overlap what to do when it loses: hide, dim, or never lose
 * @property {number} depth nearer is kept first among equal priorities
 * @property {boolean} [sticky] it was showing last frame, so it holds its place more firmly
 * @property {boolean} [covered] geometry is in front of it, so it loses to every label
 */

/** @typedef {'show' | 'dim' | 'hide'} LabelState */

/**
 * Which labels to show, dim or hide. 'show' labels go first, then higher priorities, then labels
 * already showing, then nearer ones. A label that runs into one already placed by more than it may
 * (20% of its size, or 50% if it was showing last frame) loses: hidden, or dimmed if its
 * overlap is 'dim'. A covered label always loses, unless its overlap is 'show'. Dimmed labels
 * don't block others. Greedy and stable, so the same view always gives the same answer.
 * @param {LabelBox[]} boxes
 * @returns {LabelState[]} by index
 */
export function layoutLabels(boxes) {
  const order = boxes.map((_, i) => i).sort((a, b) => {
    const x = boxes[a], y = boxes[b]
    return (y.overlap === 'show' ? 1 : 0) - (x.overlap === 'show' ? 1 : 0) || y.priority - x.priority ||
      (y.sticky ? 1 : 0) - (x.sticky ? 1 : 0) || x.depth - y.depth || a - b
  })
  /** @type {LabelState[]} */
  const states = new Array(boxes.length).fill('hide')
  /** @type {Map<string, LabelBox[]>} */
  const grid = new Map()
  const cells = (b, fn) => {
    const x0 = Math.floor(b.left / CELL), x1 = Math.floor((b.left + b.width) / CELL)
    const y0 = Math.floor(b.top / CELL), y1 = Math.floor((b.top + b.height) / CELL)
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) fn(`${cx},${cy}`)
  }
  // how far two boxes run into each other, as a share of the smaller size on the axis that parts
  // them soonest - not shared area, which stays small for labels staggered diagonally along an
  // axis even when their text meets
  const shared = (a, b) => {
    const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)
    const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top)
    if (w <= 0 || h <= 0) return 0
    return Math.min(w / Math.max(1, Math.min(a.width, b.width)), h / Math.max(1, Math.min(a.height, b.height)))
  }

  for (const i of order) {
    const box = boxes[i]
    if (box.overlap !== 'show') {
      const allowed = box.sticky ? KEEP_OVERLAP : NEW_OVERLAP
      let blocked = !!box.covered
      cells(box, (key) => { if (!blocked) blocked = (grid.get(key) ?? []).some((other) => shared(box, other) > allowed) })
      if (blocked) {
        states[i] = box.overlap === 'dim' ? 'dim' : 'hide'
        continue
      }
    }
    states[i] = 'show'
    cells(box, (key) => {
      let list = grid.get(key)
      if (!list) grid.set(key, list = [])
      list.push(box)
    })
  }
  return states
}
