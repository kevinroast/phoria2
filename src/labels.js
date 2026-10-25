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
 * @property {number} dimmed drawn faint because a higher-priority label or geometry was in front (overlap: 'dim')
 * @property {number} occluded hidden because geometry was in front (overlap: 'hide')
 * @property {number} offscreen behind the camera or outside the view
 */

/** @typedef {{ el: HTMLDivElement, text: string, className: string, width: number, height: number, showing: boolean }} Entry */

// how faint a covered label is drawn, with overlap: 'dim'
const DIM_OPACITY = '0.4'

export class LabelLayer {
  /** @type {HTMLDivElement | null} */ #root = null
  /** @type {Map<any, Entry>} */ #elements = new Map()
  /** Elements shown in the last frame, for image export. @type {HTMLDivElement[]} */
  shown = []
  /** Node overlays mounted in the layer. @type {Set<HTMLElement>} */ #overlays = new Set()

  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas
  }

  /** The layer over the canvas: labels, and overlays such as legends. Made on first use. @returns {HTMLDivElement} */
  get root() {
    return this.#ensureRoot()
  }

  /**
   * Position, create, hide and remove label elements for this frame's labels, and mount the
   * overlays of the nodes drawn.
   * @param {(FrameLabel & { occluded?: boolean })[]} labels
   * @param {HTMLElement[]} [overlays]
   * @returns {LabelStats}
   */
  update(labels, overlays = []) {
    /** @type {LabelStats} */
    const stats = { total: labels.length, shown: 0, overlapped: 0, dimmed: 0, occluded: 0, offscreen: 0 }
    this.shown = []
    if (!labels.length && !this.#elements.size && !overlays.length && !this.#overlays.size && !this.#root) return stats
    const root = this.#ensureRoot()
    this.#mount(root, overlays)
    const rect = this.canvas.getBoundingClientRect()
    this.#place(root)

    // 1. elements and text (writes only)
    const seen = new Set()
    /** @type {{ label: FrameLabel & { occluded?: boolean }, entry: Entry }[]} */
    const active = []
    for (const label of labels) {
      seen.add(label.key)
      if (!label.visible) stats.offscreen++
      else if (label.occluded && label.style.overlap === 'hide') stats.occluded++
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
      // a label showing last frame holds its place more firmly, so labels don't flicker as the view moves
      return { left, top, width: entry.width, height: entry.height, priority: label.style.priority, overlap: label.style.overlap,
        depth: label.depth, sticky: entry.showing, covered: !!label.occluded }
    })
    const states = layoutLabels(boxes)
    // remember what shows this frame, for next frame's stickiness
    for (const entry of this.#elements.values()) entry.showing = false
    const hidden = new Set(this.#elements.values())
    active.forEach(({ label, entry }, i) => {
      const state = states[i]
      entry.showing = state === 'show'
      if (state === 'hide') {
        stats.overlapped++
        return
      }
      hidden.delete(entry)
      if (state === 'dim') stats.dimmed++
      else stats.shown++
      this.shown.push(entry.el)
      const el = entry.el, box = boxes[i]
      el.style.display = ''
      el.style.opacity = state === 'dim' ? DIM_OPACITY : ''
      // whole pixels keep text crisp
      el.style.transform = `translate(${Math.round(box.left)}px, ${Math.round(box.top)}px)`
      // nearer labels stack above further ones, and every dimmed label sits under every shown one
      const near = Math.max(0, Math.round(100000 - label.depth * 100))
      el.style.zIndex = String(state === 'dim' ? Math.min(near, 99999) : 100000 + near)
    })
    for (const entry of hidden) entry.el.style.display = 'none'
    return stats
  }

  /** @param {HTMLDivElement} root @param {HTMLElement[]} overlays */
  #mount(root, overlays) {
    const now = new Set(overlays)
    for (const el of now) {
      if (el.parentElement !== root) root.append(el)
      this.#overlays.add(el)
    }
    // overlays whose node is no longer drawn come off the page
    for (const el of this.#overlays) {
      if (now.has(el)) continue
      el.remove()
      this.#overlays.delete(el)
    }
  }

  dispose() {
    for (const el of this.#overlays) el.remove()
    this.#overlays.clear()
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
      // opacity eases, so dimming and brightening don't flash
      Object.assign(el.style, { position: 'absolute', left: '0', top: '0', whiteSpace: 'nowrap', willChange: 'transform', transition: 'opacity 0.15s' })
      root.append(el)
      entry = { el, text: '', className: '', width: -1, height: -1, showing: false }
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
    // beside the canvas, in the same container: when that scrolls or moves, the labels go with it,
    // even while the view is idle and not redrawing
    this.canvas.after(root)
    this.#root = root
    this.#place(root)
    return root
  }

  // cover the canvas: same offset parent, so the same offsets; fixed if the canvas is
  /** @param {HTMLDivElement} root */
  #place(root) {
    const c = this.canvas
    root.style.position = getComputedStyle(c).position === 'fixed' ? 'fixed' : 'absolute'
    root.style.left = `${c.offsetLeft + c.clientLeft}px`
    root.style.top = `${c.offsetTop + c.clientTop}px`
    root.style.width = `${c.clientWidth}px`
    root.style.height = `${c.clientHeight}px`
  }
}
