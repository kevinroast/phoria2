// The hover tooltip: one element that follows the pointer and shows what the app says about the
// thing under it. Its default look is in a :where() rule, which has no specificity, so any CSS for
// .phoria-tooltip overrides it.
import { describe, fail } from './validate.js'

/** @import { Hit } from './Raycaster.js' */

/**
 * What a tooltip function returns: text (new lines kept), an element, or a title with rows of
 * name/value pairs. null (or '') shows nothing.
 * @typedef {string | number | Node | { title?: string, rows?: Record<string, unknown> | Array<[string, unknown]> } | null | undefined | false} TooltipContent
 */

const STYLE = `
:where(.phoria-tooltip) { position: fixed; left: 0; top: 0; z-index: 1000; pointer-events: none; max-width: 320px;
  padding: 6px 10px; border-radius: 6px; background: rgba(20, 20, 24, 0.92); color: #fff;
  font: 12px/1.45 system-ui, sans-serif; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3); white-space: pre-line; }
:where(.phoria-tooltip-title) { font-weight: 600; }
:where(.phoria-tooltip-rows) { display: grid; grid-template-columns: auto auto; column-gap: 12px; }
:where(.phoria-tooltip-rows > :nth-child(odd)) { opacity: 0.7; }
:where(.phoria-tooltip-rows > :nth-child(even)) { text-align: right; font-variant-numeric: tabular-nums; }
`
// space between the pointer and the tooltip, in CSS pixels
const GAP = 14

export class Tooltip {
  /** @type {HTMLDivElement} */ el
  /** @type {(hit: Hit) => TooltipContent} */ content

  /** @param {(hit: Hit) => TooltipContent} content @param {string} [className] */
  constructor(content, className = '') {
    if (typeof content !== 'function') fail('View', `tooltip() takes a function (hit) => text, got ${describe(content)}`)
    this.content = content
    if (!document.getElementById('phoria-tooltip-style')) {
      const style = document.createElement('style')
      style.id = 'phoria-tooltip-style'
      style.textContent = STYLE
      document.head.prepend(style)
    }
    this.el = document.createElement('div')
    this.el.className = `phoria-tooltip${className ? ` ${className}` : ''}`
    this.el.setAttribute('role', 'tooltip')
    this.el.hidden = true
    document.body.append(this.el)
  }

  /** Show what the content function says about a hit, near the pointer. @param {Hit} hit @param {number} x @param {number} y */
  show(hit, x, y) {
    const content = this.content(hit)
    if (content === null || content === undefined || content === false || content === '') return this.hide()
    this.el.replaceChildren(render(content))
    this.el.hidden = false
    this.move(x, y)
  }

  /** Follow the pointer, staying inside the window. @param {number} x @param {number} y client pixels */
  move(x, y) {
    if (this.el.hidden) return
    const w = this.el.offsetWidth, h = this.el.offsetHeight
    const left = x + GAP + w > window.innerWidth ? x - GAP - w : x + GAP
    const top = y + GAP + h > window.innerHeight ? y - GAP - h : y + GAP
    this.el.style.transform = `translate(${Math.round(Math.max(0, left))}px, ${Math.round(Math.max(0, top))}px)`
  }

  hide() {
    this.el.hidden = true
  }

  dispose() {
    this.el.remove()
  }
}

/** @param {TooltipContent} content @returns {Node} */
function render(content) {
  if (typeof content === 'string' || typeof content === 'number') return document.createTextNode(String(content))
  if (content instanceof Node) return content
  if (typeof content === 'object' && content && ('title' in content || 'rows' in content)) {
    const box = document.createDocumentFragment()
    if (content.title !== undefined) {
      const title = document.createElement('div')
      title.className = 'phoria-tooltip-title'
      title.textContent = String(content.title)
      box.append(title)
    }
    if (content.rows) {
      const rows = document.createElement('div')
      rows.className = 'phoria-tooltip-rows'
      const entries = Array.isArray(content.rows) ? content.rows : Object.entries(content.rows)
      for (const [name, value] of entries) {
        const n = document.createElement('span'), v = document.createElement('span')
        n.textContent = String(name)
        v.textContent = typeof value === 'number' ? value.toLocaleString() : String(value)
        rows.append(n, v)
      }
      box.append(rows)
    }
    return box
  }
  return fail('View', `a tooltip function returns text, an element or { title, rows }, got ${describe(content)}`)
}
