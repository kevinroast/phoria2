// Keyboard use of a View, for people who can't use a pointer and for screen readers: the canvas
// becomes a stop in the page's tab order, and the arrow keys step through what you can act on - each
// instance, point or node with a tooltip, a handler or data - as hovering would: the hover tint, the
// tooltip and hover handlers, with Enter or Space as a click. A live region says what each one is.
// Loaded when a View is given keyboard: true, so apps without it don't carry it.
import { hiddenInstance } from './scene/drawables.js'
import { Vec3 } from './value/Vec3.js'

/** @import { Hit } from './Raycaster.js' */
/** @import { TooltipContent } from './tooltip.js' */
/** @import { Node } from './scene/Node.js' */
/** @import { View } from './View.js' */

/**
 * @typedef {object} KeyboardOptions
 * @property {(hit: Hit) => string} [label] what a screen reader says for each thing stepped to (default: the
 *   tooltip's text, then its data, then the node's name)
 */

/**
 * What the View lends the keyboard: the hover it shows, the click it runs, and what it says about a hit.
 * @typedef {object} KeyboardHooks
 * @property {(hit: Hit | null) => void} focus show this as hovered, or nothing
 * @property {(hit: Hit) => void} press click it
 * @property {(hit: Hit) => TooltipContent} tooltip the tooltip's content for it, if there is a tooltip
 * @property {() => boolean} viewWide does the View itself answer hovers or clicks (a tooltip, handlers)?
 */

/** @typedef {{ node: Node, index: number | null, whole: Node | null }} Item */

const STYLE = `:where(.phoria-sr-only) { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
  clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0; }`
// how far PageUp and PageDown jump
const PAGE = 10
let ids = 0

export class Keyboard {
  /** @type {View} */ #view
  /** @type {KeyboardHooks} */ #hooks
  /** @type {KeyboardOptions} */ #options
  /** The item stepped to, or null. @type {Item | null} */ #at = null
  /** @type {HTMLDivElement} */ #say
  /** @type {HTMLDivElement} */ #help
  /** Attributes the canvas had before, put back on dispose. @type {[string, string | null][]} */ #before
  #description = ''
  #auto = true
  /** @type {(() => void)[]} */ #cleanup = []

  /** @param {View} view @param {KeyboardHooks} hooks @param {KeyboardOptions} options */
  constructor(view, hooks, options) {
    this.#view = view
    this.#hooks = hooks
    this.#options = options
    if (!document.getElementById('phoria-sr-style')) {
      const style = document.createElement('style')
      style.id = 'phoria-sr-style'
      style.textContent = STYLE
      document.head.prepend(style)
    }
    const canvas = view.canvas, id = `phoria-keys-${++ids}`
    // what a screen reader says as you step: politely, after what it's saying already
    this.#say = document.createElement('div')
    this.#say.className = 'phoria-sr-only'
    this.#say.setAttribute('aria-live', 'polite')
    this.#say.setAttribute('aria-atomic', 'true')
    // how to use it, read once the canvas has focus
    this.#help = document.createElement('div')
    this.#help.className = 'phoria-sr-only'
    this.#help.id = id
    canvas.after(this.#say, this.#help)
    this.#before = ['tabindex', 'role', 'aria-roledescription', 'aria-label', 'aria-describedby'].map((a) => [a, canvas.getAttribute(a)])
    if (!canvas.hasAttribute('tabindex')) canvas.tabIndex = 0
    canvas.setAttribute('role', 'application')
    canvas.setAttribute('aria-roledescription', '3D view')
    canvas.setAttribute('aria-describedby', id)

    const keydown = (/** @type {KeyboardEvent} */ e) => this.#key(e)
    const blur = () => this.clear()
    const focus = () => this.#describe()
    canvas.addEventListener('keydown', keydown)
    canvas.addEventListener('blur', blur)
    canvas.addEventListener('focus', focus)
    this.#cleanup.push(() => {
      canvas.removeEventListener('keydown', keydown)
      canvas.removeEventListener('blur', blur)
      canvas.removeEventListener('focus', focus)
    })
    this.#describe()
  }

  /**
   * The canvas's label for screen readers: the View's description, or - when it has none - one made
   * from the scene: what its charts show, and how many things there are to step through.
   * @param {string | null} text
   */
  setDescription(text) {
    this.#auto = text === null
    this.#description = text ?? ''
    this.#describe()
  }

  #describe() {
    const count = this.#items().length
    const label = this.#auto ? autoDescription(this.#view.scene, count) : this.#description
    this.#view.canvas.setAttribute('aria-label', label)
    this.#help.textContent = count
      ? `Use the arrow keys to move between ${count === 1 ? 'the one item' : `${count} items`}, Enter to select, Escape to leave.`
      : 'Nothing here can be selected.'
  }

  /** Step off whatever was stepped to: the pointer has taken over, or focus has gone. */
  clear() {
    if (!this.#at) return
    this.#at = null
    this.#hooks.focus(null)
  }

  /** @param {KeyboardEvent} e */
  #key(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const items = this.#items()
    let i = this.#at ? items.findIndex((it) => same(it, /** @type {Item} */ (this.#at))) : -1
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': i = i < 0 ? 0 : Math.min(items.length - 1, i + 1); break
      case 'ArrowLeft': case 'ArrowUp': i = i < 0 ? items.length - 1 : Math.max(0, i - 1); break
      case 'PageDown': i = Math.min(items.length - 1, Math.max(0, i) + PAGE); break
      case 'PageUp': i = Math.max(0, i - PAGE); break
      case 'Home': i = 0; break
      case 'End': i = items.length - 1; break
      case 'Enter': case ' ':
        if (!this.#at || i < 0) return
        e.preventDefault()
        this.#hooks.press(hitOf(items[i]))
        return
      case 'Escape':
        if (!this.#at) return
        e.preventDefault()
        this.clear()
        this.#say.textContent = ''
        return
      default: return
    }
    // the arrows and paging keys are the view's while it has focus, not the page's to scroll
    e.preventDefault()
    if (!items.length) {
      this.#say.textContent = 'Nothing here can be selected.'
      return
    }
    this.#at = items[i]
    const hit = hitOf(items[i])
    this.#hooks.focus(hit)
    this.#say.textContent = `${this.#options.label?.(hit) ?? this.#textOf(hit)}. ${i + 1} of ${items.length}`
  }

  /** What to say about a hit: the tooltip's text, its data, or its node's name. @param {Hit} hit @returns {string} */
  #textOf(hit) {
    const tip = textOfContent(this.#hooks.tooltip(hit))
    if (tip) return tip
    const datum = hit.datum
    if (datum !== null && datum !== undefined) {
      if (typeof datum !== 'object') return String(datum)
      const parts = Object.entries(datum).filter(([, v]) => v === null || typeof v !== 'object').slice(0, 4).map(([k, v]) => `${k}: ${format(v)}`)
      if (parts.length) return parts.join(', ')
    }
    for (let n = /** @type {Node | null} */ (hit.node); n; n = n.parent) if (n.name) return n.name
    return 'Item'
  }

  /**
   * What can be stepped to, in scene order and each mesh's instances in order: everything visible and
   * pickable in a subtree with its own tooltip, handlers, drag or tint - and, when the View answers
   * hovers or clicks itself, each thing with data or a name. A highlightWhole subtree is one item, and
   * a surface - a mesh with a row of data per vertex - is a stop per vertex, as picking gives its rows.
   * Lines with a row per segment - a network's links - are a stop per segment, after everything else:
   * the things first, then what joins them. Something with no row and no name of its own is a stop
   * only when it has a handler or tooltip itself, not one it shares with the subtree it's in.
   * @returns {Item[]}
   */
  #items() {
    /** @type {Item[]} */
    const items = [], links = []
    const viewWide = this.#hooks.viewWide()
    /** @type {Set<Node>} */
    const wholes = new Set()
    /** @param {any} n @param {boolean} own @param {Node | null} whole */
    const walk = (n, own, whole) => {
      if (!n.visible || n.pickable === false) return
      const direct = !!(n.tooltip || n.onDrag || n.highlight || n.handlersFor('click').length || n.handlersFor('hover').length)
      own ||= direct
      whole = n.highlightWhole ? n : whole
      if (n.isDrawable) {
        if (whole) {
          if ((own || viewWide) && !wholes.has(whole)) {
            wholes.add(whole)
            items.push({ node: n, index: null, whole })
          }
        } else if ('instanceMatrices' in n) {
          for (let i = 0; i < n.count; i++) {
            if (!hiddenInstance(n.instanceMatrices, i) && (own || (viewWide && n.datumAt(i) !== null))) items.push({ node: n, index: i, whole: null })
          }
        } else if ((n.drawMode === 'points' && Array.isArray(n.data)) || perVertex(n)) {
          for (let i = 0; i < n.data.length; i++) if (own || viewWide) items.push({ node: n, index: i, whole: null })
        } else if (n.drawMode === 'lines' && Array.isArray(n.data)) {
          for (let i = 0; i < n.data.length; i++) if (own || viewWide) links.push({ node: n, index: i, whole: null })
        } else if (direct || ((own || viewWide) && (n.name || n.datumAt(null) !== null))) items.push({ node: n, index: null, whole: null })
      }
      for (const c of n.children) walk(c, own, whole)
    }
    walk(this.#view.scene, false, null)
    return items.concat(links)
  }

  dispose() {
    for (const fn of this.#cleanup) fn()
    const canvas = this.#view.canvas
    for (const [name, value] of this.#before) {
      if (value === null) canvas.removeAttribute(name)
      else canvas.setAttribute(name, value)
    }
    this.#say.remove()
    this.#help.remove()
  }
}

/** @param {Item} a @param {Item} b */
const same = (a, b) => a.node === b.node && a.index === b.index

/** A surface: a mesh of triangles with a row of data for each vertex. @param {any} n */
const perVertex = (n) => n.drawMode === 'triangles' && !('instanceMatrices' in n) && Array.isArray(n.data) && n.data.length === n.geometry.vertexCount

/**
 * A hit on an item, as the pointer would make over its middle.
 * @param {Item} item @returns {Hit}
 */
function hitOf({ node, index, whole }) {
  const d = /** @type {any} */ (node)
  const points = index !== null && d.drawMode === 'points', vertex = index !== null && perVertex(d)
  const segment = index !== null && d.drawMode === 'lines'
  /** @type {Vec3} */
  let point
  if (whole) point = whole.bounds.getCenter()
  else if (index !== null && 'instanceMatrices' in d) {
    // the middle of the geometry, through the instance's matrix and then the mesh's
    node.updateWorld()
    const local = d.geometry.bounds.getCenter()
    point = through(d.worldMatrix, through(d.instanceMatrices.subarray(index * 16, index * 16 + 16), local))
  } else if (points || vertex) {
    const p = d.geometry.positions
    node.updateWorld()
    point = through(d.worldMatrix, new Vec3(p[index * 3], p[index * 3 + 1], p[index * 3 + 2]))
  } else if (segment) {
    // the middle of the segment: its two ends, by index when the lines have them
    const p = d.geometry.positions, idx = d.geometry.indices
    const a = idx ? idx[index * 2] : index * 2, b = idx ? idx[index * 2 + 1] : index * 2 + 1
    node.updateWorld()
    point = through(d.worldMatrix, new Vec3((p[a * 3] + p[b * 3]) / 2, (p[a * 3 + 1] + p[b * 3 + 1]) / 2, (p[a * 3 + 2] + p[b * 3 + 2]) / 2))
  } else point = node.bounds.getCenter()
  // a surface's vertex is no face or instance - its row is the datum, as a pointer over it finds
  return { node, point, distance: 0, normal: null, face: points || segment ? index : null, instance: index !== null && !points && !vertex && !segment ? index : null,
    uv: null, datum: vertex ? d.data[index] ?? null : d.datumAt?.(index) ?? null }
}

/** A point through a 4x4 matrix (column-major). @param {ArrayLike<number>} m @param {Vec3} p @returns {Vec3} */
function through(m, p) {
  const [x, y, z] = p
  return new Vec3(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14])
}

/** The text of a tooltip's content, for a screen reader. @param {TooltipContent} content @returns {string} */
function textOfContent(content) {
  if (content === null || content === undefined || content === false || content === '') return ''
  if (typeof content === 'string' || typeof content === 'number') return String(content).replace(/\s*\n\s*/g, ', ')
  if (typeof globalThis.Node !== 'undefined' && content instanceof globalThis.Node) return (content.textContent ?? '').trim()
  if (typeof content === 'object') {
    const c = /** @type {{ title?: string, rows?: Record<string, unknown> | Array<[string, unknown]> }} */ (content)
    const rows = c.rows ? (Array.isArray(c.rows) ? c.rows : Object.entries(c.rows)).map(([k, v]) => `${k}: ${format(v)}`) : []
    return [c.title, ...rows].filter((s) => s !== undefined && s !== '').join(', ')
  }
  return ''
}

/** @param {unknown} v */
const format = (v) => (typeof v === 'number' ? v.toLocaleString() : String(v))

/**
 * A label for the canvas made from the scene: each chart's summary, or how many things there are.
 * @param {Node} scene @param {number} count @returns {string}
 */
function autoDescription(scene, count) {
  /** @type {string[]} */
  const parts = []
  scene.traverse((n) => {
    const summary = /** @type {any} */ (n).summary
    if (n !== scene && n.visible && typeof summary === 'function') parts.push(summary.call(n))
  })
  if (!parts.length) parts.push(count ? `3D view of ${count === 1 ? 'one item' : `${count} items`}` : '3D view')
  return parts.join('. ')
}
