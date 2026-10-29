// HTML labels over the canvas: one absolutely positioned element per label, moved each frame to its
// projected position. Crisp at any pixel ratio, styleable with CSS, and selectable/accessible like
// any text on the page. Overlapping labels give way by priority (see labelLayout.js).
import { alignColumns, layoutLabels, leaderEnd, placeBox, stackColumns } from './labelLayout.js'

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

/** @typedef {{ el: HTMLDivElement, text: string, className: string, width: number, height: number, showing: boolean, leader: SVGGElement | null, color: string, rule: number, label: FrameLabel | null, interactive: boolean }} Entry */

/**
 * What the layer asks of its view: whether a label answers the pointer, and what to do when it does.
 * @typedef {object} LabelPointer
 * @property {(label: FrameLabel) => boolean} interactive
 * @property {(type: 'click' | 'over' | 'out', label: FrameLabel, event: MouseEvent | null) => void} on
 */

/**
 * A leader line as drawn, in CSS pixels over the canvas - for image export.
 * @typedef {{ from: [number, number], to: [number, number], color: string, opacity: number }} Leader
 */

const SVG = 'http://www.w3.org/2000/svg'

// how faint a covered label is drawn, with overlap: 'dim'
const DIM_OPACITY = '0.4'

export class LabelLayer {
  /** @type {HTMLDivElement | null} */ #root = null
  /** @type {Map<any, Entry>} */ #elements = new Map()
  /** Elements shown in the last frame, for image export. @type {HTMLDivElement[]} */
  shown = []
  /** Leader lines drawn in the last frame, for image export. @type {Leader[]} */
  leaders = []
  /** The lines from labels' points to callouts, under the labels. @type {SVGSVGElement | null} */ #lines = null
  /** Node overlays mounted in the layer. @type {Set<HTMLElement>} */ #overlays = new Set()
  /** @type {WeakMap<Element, Entry>} */ #byElement = new WeakMap()
  /** The label under the pointer, when it answers the pointer. @type {Entry | null} */ #over = null

  /** @param {HTMLCanvasElement} canvas @param {LabelPointer} [pointer] */
  constructor(canvas, pointer) {
    this.canvas = canvas
    this.pointer = pointer
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
    this.leaders = []
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
      this.#leave(entry)
      entry.el.remove()
      entry.leader?.remove()
      this.#elements.delete(key)
    }
    // 2. measure new or changed labels (one layout pass for all of them)
    for (const { entry } of active) if (entry.width < 0) entry.el.style.display = ''
    for (const { entry } of active) {
      if (entry.width >= 0) continue
      // its own width, not the column's it was given
      entry.el.style.minWidth = ''
      entry.width = entry.el.offsetWidth
      entry.height = entry.el.offsetHeight
    }
    // 3. place, resolve overlaps, and write positions
    const boxes = active.map(({ label, entry }) => {
      const x = (label.ndc[0] * 0.5 + 0.5) * rect.width
      const y = (0.5 - label.ndc[1] * 0.5) * rect.height
      const [left, top] = placeBox(x, y, entry.width, entry.height, label.style.place, label.style.offset, label.style.edge, rect.width)
      // a label showing last frame holds its place more firmly, so labels don't flicker as the view moves
      return { left, top, width: entry.width, height: entry.height, priority: label.style.priority, overlap: label.style.overlap,
        depth: label.depth, sticky: entry.showing, covered: !!label.occluded, x, y, edge: label.style.edge }
    })
    // callouts in a column at an edge are lined up, and spaced out in order, never on top of each other
    alignColumns(boxes)
    stackColumns(boxes, rect.height)
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
      // a label of something with click or hover handlers is part of it: it takes the pointer
      entry.label = label
      const interactive = !!this.pointer?.interactive(label)
      if (interactive !== entry.interactive) {
        entry.interactive = interactive
        entry.el.style.pointerEvents = interactive ? 'auto' : ''
        if (interactive) entry.el.dataset.interactive = ''
        else {
          delete entry.el.dataset.interactive
          this.#leave(entry)
        }
      }
      if (state === 'dim') stats.dimmed++
      else stats.shown++
      this.shown.push(entry.el)
      const el = entry.el, box = boxes[i]
      el.style.display = ''
      el.style.opacity = state === 'dim' ? DIM_OPACITY : ''
      // whole pixels keep text crisp - and the box is rounded too, so a leader meets the label where it is drawn
      box.left = Math.round(box.left)
      box.top = Math.round(box.top)
      el.style.transform = `translate(${box.left}px, ${box.top}px)`
      // a column's labels share its width; the right column's text keeps to the edge
      const edge = label.style.edge
      const minWidth = edge && entry.width !== box.width ? `${box.width}px` : '', textAlign = edge === 'right' ? 'right' : ''
      if (el.style.minWidth !== minWidth || el.style.textAlign !== textAlign) Object.assign(el.style, { minWidth, textAlign, boxSizing: minWidth ? 'border-box' : '' })
      // nearer labels stack above further ones, and every dimmed label sits under every shown one
      const near = Math.max(0, Math.round(100000 - label.depth * 100))
      el.style.zIndex = String(state === 'dim' ? Math.min(near, 99999) : 100000 + near)
      if (label.style.leader) this.#leader(entry, box, state === 'dim' ? +DIM_OPACITY : 1)
      else if (entry.leader) {
        entry.leader.remove()
        entry.leader = null
      }
    })
    for (const entry of hidden) {
      this.#leave(entry)
      entry.el.style.display = 'none'
      if (entry.leader) entry.leader.style.display = 'none'
    }
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

  /**
   * Draw a label's leader: from its point to the nearest point of its box, with a dot on the point.
   * @param {Entry} entry
   * @param {{ left: number, top: number, width: number, height: number, x: number, y: number, edge?: 'left' | 'right' | null }} box
   * @param {number} opacity
   */
  #leader(entry, box, opacity) {
    const { x, y } = box
    // the label's own text colour and underline (read once per look), unless CSS on .phoria-leader says otherwise
    if (!entry.color) {
      const cs = getComputedStyle(entry.el)
      entry.color = cs.color
      entry.rule = cs.borderBottomStyle === 'none' ? 0 : parseFloat(cs.borderBottomWidth) || 0
    }
    const end = leaderEnd(x, y, box, box.edge, entry.rule)
    let g = entry.leader
    if (!g) {
      g = /** @type {SVGGElement} */ (document.createElementNS(SVG, 'g'))
      g.append(document.createElementNS(SVG, 'line'), document.createElementNS(SVG, 'circle'))
      this.#ensureLines().append(g)
      entry.leader = g
    }
    const color = entry.color
    g.setAttribute('class', `phoria-leader${entry.className.slice('phoria-label'.length)}`)
    g.setAttribute('stroke', color)
    g.setAttribute('fill', color)
    g.style.display = ''
    g.style.opacity = String(opacity)
    const [line, dot] = /** @type {[SVGLineElement, SVGCircleElement]} */ (/** @type {unknown} */ ([...g.children]))
    // a point inside its own label needs no line
    line.style.display = end ? '' : 'none'
    if (end) {
      line.setAttribute('x1', String(x))
      line.setAttribute('y1', String(y))
      line.setAttribute('x2', String(end[0]))
      line.setAttribute('y2', String(end[1]))
      line.setAttribute('stroke-width', '1')
    }
    dot.setAttribute('cx', String(x))
    dot.setAttribute('cy', String(y))
    dot.setAttribute('r', '2.5')
    dot.setAttribute('stroke', 'none')
    if (end) this.leaders.push({ from: [x, y], to: end, color, opacity })
  }

  /** The SVG the leader lines go in, under every label. @returns {SVGSVGElement} */
  #ensureLines() {
    if (this.#lines) return this.#lines
    const svg = /** @type {SVGSVGElement} */ (document.createElementNS(SVG, 'svg'))
    svg.setAttribute('class', 'phoria-leaders')
    Object.assign(svg.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', overflow: 'visible', zIndex: '0' })
    this.#ensureRoot().prepend(svg)
    this.#lines = svg
    return svg
  }

  /** The pointer is no longer on this label - it went, or stopped answering. @param {Entry} entry */
  #leave(entry) {
    if (this.#over !== entry) return
    this.#over = null
    if (entry.label) this.pointer?.on('out', entry.label, null)
  }

  dispose() {
    this.#over = null
    for (const el of this.#overlays) el.remove()
    this.#overlays.clear()
    this.#root?.remove()
    this.#root = null
    this.#lines = null
    this.#elements.clear()
    this.shown = []
    this.leaders = []
  }

  /** @param {FrameLabel} label @param {HTMLDivElement} root @returns {Entry} */
  #entry(label, root) {
    let entry = this.#elements.get(label.key)
    if (!entry) {
      const el = document.createElement('div')
      // opacity eases, so dimming and brightening don't flash
      Object.assign(el.style, { position: 'absolute', left: '0', top: '0', willChange: 'transform', transition: 'opacity 0.15s' })
      root.append(el)
      entry = { el, text: '', className: '', width: -1, height: -1, showing: false, leader: null, color: '', rule: 0, label: null, interactive: false }
      this.#elements.set(label.key, entry)
      this.#byElement.set(el, entry)
    }
    const className = `phoria-label${label.style.className ? ` ${label.style.className}` : ''}`
    if (entry.text !== label.text || entry.className !== className) {
      entry.el.textContent = entry.text = label.text
      entry.el.className = entry.className = className
      entry.width = entry.height = -1
      entry.color = ''
    }
    return entry
  }

  #ensureRoot() {
    if (this.#root) return this.#root
    // labels keep to one line unless the page's CSS says otherwise: a rule that any other wins over,
    // where an inline style would win over every rule
    if (!document.getElementById('phoria-labels-style')) {
      const style = document.createElement('style')
      style.id = 'phoria-labels-style'
      style.textContent = ':where(.phoria-label) { white-space: nowrap } :where(.phoria-label[data-interactive]) { cursor: pointer }'
      document.head.prepend(style)
    }
    const root = document.createElement('div')
    root.className = 'phoria-labels'
    // its own stacking context, so labels' depth ordering stays below the page's floating UI
    Object.assign(root.style, { position: 'absolute', pointerEvents: 'none', overflow: 'hidden', zIndex: '0', isolation: 'isolate' })
    // beside the canvas, in the same container: when that scrolls or moves, the labels go with it,
    // even while the view is idle and not redrawing
    this.canvas.after(root)
    this.#root = root
    this.#listen(root)
    this.#place(root)
    return root
  }

  /** Pass clicks and hovers on labels that answer the pointer to the view. @param {HTMLDivElement} root */
  #listen(root) {
    /** @param {Event} e */
    const entryOf = (e) => {
      const entry = this.#byElement.get(/** @type {Element} */ (e.target))
      return entry?.interactive && entry.label ? entry : null
    }
    root.addEventListener('click', (e) => {
      const entry = entryOf(e)
      if (entry?.label) this.pointer?.on('click', entry.label, e)
    })
    root.addEventListener('pointerover', (e) => {
      const entry = entryOf(e)
      if (!entry?.label || entry === this.#over) return
      this.#over = entry
      this.pointer?.on('over', entry.label, e)
    })
    root.addEventListener('pointerout', (e) => {
      const entry = entryOf(e)
      if (entry && entry === this.#over) this.#leave(entry)
    })
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
