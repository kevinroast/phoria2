// Undo and redo for editors: a list of what was done, each with how to undo and redo it.
import { checkOptions, describe, fail } from '../validate.js'

/** @import { Node } from '../scene/Node.js' */

/**
 * Something done, that can be undone and done again.
 * @typedef {object} HistoryEntry
 * @property {string} [label] what it was, for an "Undo move" menu item
 * @property {() => void} undo
 * @property {() => void} redo
 */

/**
 * @typedef {object} HistoryOptions
 * @property {number} [limit] how many steps back it keeps (default 100)
 * @property {((history: History) => void) | null} [onChange] called whenever what can be undone or redone changes
 */

export const HISTORY_OPTIONS = ['limit', 'onChange']
const HINTS = { max: "use 'limit'", size: "use 'limit'", onUpdate: "use 'onChange'" }

/**
 * Undo and redo. Record each change once it has been made, with how to undo and redo it; or let
 * transform() work that out for moves, turns and resizes.
 *
 *     const history = new History()
 *     const done = history.transform([chair])   // before moving it
 *     chair.position.x += 1
 *     done('Move chair')                         // after: recorded, if it moved
 *     history.undo()
 */
export class History {
  /** How many steps back are kept. */
  limit = 100
  /** @type {((history: History) => void) | null} */
  onChange = null
  /** @type {HistoryEntry[]} */ #done = []
  /** @type {HistoryEntry[]} */ #undone = []

  /** @param {HistoryOptions} [options] */
  constructor(options = {}) {
    checkOptions('History', options, HISTORY_OPTIONS, HINTS)
    if (options.limit !== undefined) {
      if (!Number.isInteger(options.limit) || options.limit < 1) fail('History', `'limit' must be a whole number 1 or more, got ${describe(options.limit)}`)
      this.limit = options.limit
    }
    if (options.onChange != null) {
      if (typeof options.onChange !== 'function') fail('History', `'onChange' must be a function, got ${describe(options.onChange)}`)
      this.onChange = options.onChange
    }
  }

  /**
   * Record a change already made. Anything undone before it can no longer be redone.
   * @param {HistoryEntry} entry
   * @returns {this}
   */
  push(entry) {
    if (!entry || typeof entry.undo !== 'function' || typeof entry.redo !== 'function') {
      fail('History', `push() takes { label, undo, redo } with undo and redo functions, got ${describe(entry)}`)
    }
    this.#done.push(entry)
    if (this.#done.length > this.limit) this.#done.shift()
    this.#undone = []
    this.onChange?.(this)
    return this
  }

  /** Undo the last change. @returns {boolean} whether there was one */
  undo() {
    const entry = this.#done.pop()
    if (!entry) return false
    entry.undo()
    this.#undone.push(entry)
    this.onChange?.(this)
    return true
  }

  /** Do again the last change undone. @returns {boolean} whether there was one */
  redo() {
    const entry = this.#undone.pop()
    if (!entry) return false
    entry.redo()
    this.#done.push(entry)
    this.onChange?.(this)
    return true
  }

  get canUndo() { return this.#done.length > 0 }
  get canRedo() { return this.#undone.length > 0 }
  /** What undo() would undo, or null. @returns {string | null} */
  get undoLabel() { return this.#done.at(-1)?.label ?? null }
  /** What redo() would redo, or null. @returns {string | null} */
  get redoLabel() { return this.#undone.at(-1)?.label ?? null }

  /** Forget everything. */
  clear() {
    this.#done = []
    this.#undone = []
    this.onChange?.(this)
  }

  /**
   * Note where some nodes are now - position, rotation and scale - and get a function to call once
   * they have changed, which records undoing back to here. It records nothing if they haven't moved.
   * @param {Node | Node[]} nodes
   * @param {string} [label]
   * @returns {(label?: string) => boolean} records the change; true if there was one
   */
  transform(nodes, label) {
    const list = [nodes].flat()
    const before = list.map(placeOf)
    return (finalLabel = label) => {
      const after = list.map(placeOf)
      if (after.every((p, i) => p.every((v, k) => v === before[i][k]))) return false
      this.push({ label: finalLabel, undo: () => list.forEach((n, i) => place(n, before[i])), redo: () => list.forEach((n, i) => place(n, after[i])) })
      return true
    }
  }
}

/** A node's position, rotation (as a quaternion) and scale, as numbers. @param {Node} n */
const placeOf = (n) => [...n.position, ...n.quaternion, ...n.scale]

/** @param {Node} n @param {number[]} p */
function place(n, p) {
  n.position.set(p[0], p[1], p[2])
  n.quaternion.set(p[3], p[4], p[5], p[6])
  n.scale.set(p[7], p[8], p[9])
}
