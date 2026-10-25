// HTML labels over the canvas: one absolutely positioned element per Label node, moved each frame
// to its projected position. Crisp at any pixel ratio, styleable with CSS, and selectable/accessible
// like any text on the page.

/** @import { FrameLabel } from './frame.js' */
/** @import { Label } from './scene/drawables.js' */

export class LabelLayer {
  /** @type {HTMLDivElement | null} */ #root = null
  /** @type {Map<Label, HTMLDivElement>} */ #elements = new Map()

  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas
  }

  /**
   * Position, create and remove label elements for this frame's labels.
   * @param {FrameLabel[]} labels
   */
  update(labels) {
    if (!labels.length && !this.#elements.size) return
    const root = this.#ensureRoot()
    const rect = this.canvas.getBoundingClientRect()
    // the layer tracks the canvas, wherever it is on the page
    root.style.left = `${rect.left + window.scrollX}px`
    root.style.top = `${rect.top + window.scrollY}px`
    root.style.width = `${rect.width}px`
    root.style.height = `${rect.height}px`

    const seen = new Set()
    for (const { node, ndc, visible, depth } of labels) {
      seen.add(node)
      let el = this.#elements.get(node)
      if (!el) {
        el = document.createElement('div')
        el.style.position = 'absolute'
        el.style.left = '0'
        el.style.top = '0'
        el.style.whiteSpace = 'nowrap'
        el.style.willChange = 'transform'
        root.append(el)
        this.#elements.set(node, el)
      }
      if (el.textContent !== node.text) el.textContent = node.text
      const className = `phoria-label${node.className ? ` ${node.className}` : ''}`
      if (el.className !== className) el.className = className
      el.style.display = visible ? '' : 'none'
      if (!visible) continue
      const x = (ndc[0] * 0.5 + 0.5) * rect.width
      const y = (0.5 - ndc[1] * 0.5) * rect.height
      // centred on the point; nearer labels stack above further ones
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`
      el.style.zIndex = String(Math.max(0, Math.round(100000 - depth * 100)))
    }
    for (const [node, el] of this.#elements) {
      if (!seen.has(node)) {
        el.remove()
        this.#elements.delete(node)
      }
    }
  }

  dispose() {
    this.#root?.remove()
    this.#root = null
    this.#elements.clear()
  }

  #ensureRoot() {
    if (this.#root) return this.#root
    const root = document.createElement('div')
    root.className = 'phoria-labels'
    Object.assign(root.style, { position: 'absolute', pointerEvents: 'none', overflow: 'hidden' })
    document.body.append(root)
    this.#root = root
    return root
  }
}
