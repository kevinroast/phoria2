// HTML labels over the canvas: one absolutely positioned element per label, moved each frame to its
// projected position. Crisp at any pixel ratio, styleable with CSS, and selectable/accessible like
// any text on the page. Overlapping labels give way by priority (see labelLayout.js).
import { layoutLabels, placeBox } from './labelLayout.js'

/** @import { FrameLabel } from './frame.js' */

/**
 * What happened to this frame's labels.
 * @typedef {object} LabelStats
 * @property {number} total
 * @property {number} shown
 * @property {number} overlapped hidden because a higher-priority label was in the way
 * @property {number} occluded hidden because geometry was in front
 * @property {number} offscreen behind the camera or outside the view
 */

/** @typedef {{ el: HTMLDivElement, text: string, className: string, width: number, height: number }} Entry */

export class LabelLayer {
  /** @type {HTMLDivElement | null} */ #root = null
  /** @type {Map<any, Entry>} */ #elements = new Map()
  /** Elements shown in the last frame, for image export. @type {HTMLDivElement[]} */
  shown = []

  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas
  }

  /**
   * Position, create, hide and remove label elements for this frame's labels.
   * @param {(FrameLabel & { occluded?: boolean })[]} labels
   * @returns {LabelStats}
   */
  update(labels) {
    /** @type {LabelStats} */
    const stats = { total: labels.length, shown: 0, overlapped: 0, occluded: 0, offscreen: 0 }
    this.shown = []
    if (!labels.length && !this.#elements.size) return stats
    const root = this.#ensureRoot()
    const rect = this.canvas.getBoundingClientRect()
    // the layer tracks the canvas, wherever it is on the page
    root.style.left = `${rect.left + window.scrollX}px`
    root.style.top = `${rect.top + window.scrollY}px`
    root.style.width = `${rect.width}px`
    root.style.height = `${rect.height}px`

    // 1. elements and text (writes only)
    const seen = new Set()
    /** @type {{ label: FrameLabel, entry: Entry }[]} */
    const active = []
    for (const label of labels) {
      seen.add(label.key)
      if (!label.visible) stats.offscreen++
      else if (label.occluded) stats.occluded++
      else active.push({ label, entry: this.#entry(label, root) })
    }
    for (const [key, entry] of this.#elements) {
      if (seen.has(key)) continue
      entry.el.remove()
      this.#elements.delete(key)
    }
    // 2. measure new or changed labels (one layout pass for all of them)
    for (const { entry } of active) if (entry.width < 0) entry.el.style.display = ''
    for (const { entry } of active) {
      if (entry.width >= 0) continue
      entry.width = entry.el.offsetWidth
      entry.height = entry.el.offsetHeight
    }
    // 3. place, resolve overlaps, and write positions
    const boxes = active.map(({ label, entry }) => {
      const x = (label.ndc[0] * 0.5 + 0.5) * rect.width
      const y = (0.5 - label.ndc[1] * 0.5) * rect.height
      const [left, top] = placeBox(x, y, entry.width, entry.height, label.style.place, label.style.offset)
      return { left, top, width: entry.width, height: entry.height, priority: label.style.priority, overlap: label.style.overlap, depth: label.depth }
    })
    const keep = layoutLabels(boxes)
    const hidden = new Set(this.#elements.values())
    active.forEach(({ label, entry }, i) => {
      if (!keep[i]) {
        stats.overlapped++
        return
      }
      hidden.delete(entry)
      stats.shown++
      this.shown.push(entry.el)
      const el = entry.el, box = boxes[i]
      el.style.display = ''
      // whole pixels keep text crisp
      el.style.transform = `translate(${Math.round(box.left)}px, ${Math.round(box.top)}px)`
      // nearer labels stack above further ones
      el.style.zIndex = String(Math.max(0, Math.round(100000 - label.depth * 100)))
    })
    for (const entry of hidden) entry.el.style.display = 'none'
    return stats
  }

  dispose() {
    this.#root?.remove()
    this.#root = null
    this.#elements.clear()
    this.shown = []
  }

  /** @param {FrameLabel} label @param {HTMLDivElement} root @returns {Entry} */
  #entry(label, root) {
    let entry = this.#elements.get(label.key)
    if (!entry) {
      const el = document.createElement('div')
      Object.assign(el.style, { position: 'absolute', left: '0', top: '0', whiteSpace: 'nowrap', willChange: 'transform' })
      root.append(el)
      entry = { el, text: '', className: '', width: -1, height: -1 }
      this.#elements.set(label.key, entry)
    }
    const className = `phoria-label${label.style.className ? ` ${label.style.className}` : ''}`
    if (entry.text !== label.text || entry.className !== className) {
      entry.el.textContent = entry.text = label.text
      entry.el.className = entry.className = className
      entry.width = entry.height = -1
    }
    return entry
  }

  #ensureRoot() {
    if (this.#root) return this.#root
    const root = document.createElement('div')
    root.className = 'phoria-labels'
    // its own stacking context, so labels' depth ordering stays below the page's floating UI
    Object.assign(root.style, { position: 'absolute', pointerEvents: 'none', overflow: 'hidden', zIndex: '0', isolation: 'isolate' })
    document.body.append(root)
    this.#root = root
    return root
  }
}
