// A Label's content: an element of the page's own - an equation KaTeX has typeset, an icon, a badge -
// shown in place of its text, given way to and answering the pointer as text does, with its text
// standing in where an element can't go (an exported image, the scene's JSON).
import { afterAll, describe, expect, it, vi } from 'vitest'
import { Label, PerspectiveCamera, Scene, View } from '../src/index.js'
import { ChangeWatch } from '../src/watch.js'
import { fakeElement, fakePage } from './fakes.js'

const page = fakePage()
// the page's elements are fakes here: a Label takes any of them as content
class FakeElement {}
globalThis.Element ??= /** @type {any} */ (FakeElement)
/** An element for content: a fake one that counts as an Element. */
const element = (tag = 'span') => Object.setPrototypeOf(fakeElement(tag), globalThis.Element.prototype)
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 50))
  page.restore()
})

const viewOf = () => new View({ canvas: page.canvas(), camera: { position: [0, 0, 10], target: [0, 0, 0] } })

describe('labels over a canvas the page moves', () => {
  it('follow it while the view is idle - after a change elsewhere on the page, not their own', () => {
    /** @type {(records: any[]) => void} */
    let changed = () => {}
    const saved = { MutationObserver: globalThis.MutationObserver, documentElement: document.documentElement }
    globalThis.MutationObserver = /** @type {any} */ (class {
      constructor(fn) { changed = fn }
      observe() {}
      disconnect() {}
    })
    Object.assign(document, { documentElement: fakeElement('html') })
    try {
      const view = viewOf()
      Object.assign(view.canvas, { offsetLeft: 10, offsetTop: 20, clientLeft: 0, clientTop: 0 })
      view.scene.add(new Label({ text: 'a label' }))
      view.render()
      const root = /** @type {any} */ (view.canvas).siblings.find((el) => el.className === 'phoria-labels')
      expect(root.style.top).toBe('20px')
      // a card above it opens: the canvas moves down the page, and its view doesn't draw
      Object.assign(view.canvas, { offsetTop: 260 })
      const at = (closest) => ({ target: Object.assign(Object.create(globalThis.Element.prototype), { closest: () => closest }) })
      // a label of its own moving is no reason to look
      const asked = page.pending
      changed([at(root)])
      expect(page.pending).toBe(asked)
      changed([at(null)])
      page.frame(0)
      expect([root.style.left, root.style.top]).toEqual(['10px', '260px'])
      view.dispose()
    } finally {
      globalThis.MutationObserver = saved.MutationObserver
      Object.assign(document, { documentElement: saved.documentElement })
    }
  })
})

describe('Label content', () => {
  it('takes an element in place of text, or as well as it', () => {
    const formula = element()
    expect(new Label({ content: formula }).content).toBe(formula)
    const both = new Label({ text: 'y = sin x', content: formula })
    expect([both.text, both.content]).toEqual(['y = sin x', formula])
    expect(() => new Label({})).toThrow("'text' is required - or 'content', an element of your own")
    expect(() => new Label({ content: '<b>x</b>' })).toThrow("'content' is an element")
    expect(() => new Label({ text: {} })).toThrow("'text' is a string or a number")
    const label = new Label({ text: 'plain' })
    label.content = formula
    label.content = null
    expect(label.content).toBeNull()
  })

  it('shows the element in the label, keeping its text for an exported image', () => {
    const view = viewOf()
    const formula = element()
    view.scene.add(new Label({ text: 'y = sin x', content: formula }))
    view.scene.add(new Label({ text: 'Plain' }))
    view.render()
    const root = /** @type {any} */ (view.overlay)
    const rich = root.children.find((el) => el.children[0] === formula)
    expect(rich).toBeTruthy()
    expect(rich.dataset.text).toBe('y = sin x')
    const plain = root.children.find((el) => el.textContent === 'Plain')
    expect(plain.dataset.text).toBeUndefined()
    view.dispose()
  })

  it('answers the pointer anywhere inside its content', () => {
    const view = viewOf()
    const clicks = []
    const formula = element(), part = element()
    formula.replaceChildren(part)
    const label = view.scene.add(new Label({ content: formula, onClick: (hit) => clicks.push(hit.node) }))
    view.render()
    const root = /** @type {any} */ (view.overlay)
    // a click on a part of the typeset formula is a click on the label
    root.dispatch('click', { target: part })
    expect(clicks).toEqual([label])
    view.dispose()
  })

  it('draws again when its content shows a new element', () => {
    const scene = new Scene(), camera = new PerspectiveCamera()
    const label = scene.add(new Label({ content: element() }))
    const watch = new ChangeWatch()
    watch.changed(scene, camera)
    expect(watch.changed(scene, camera)).toBe(false)
    // a new element is a change, so a View in 'auto' mode draws the next frame
    label.content = element()
    expect(watch.changed(scene, camera)).toBe(true)
    // and the layer shows it
    const view = viewOf()
    view.scene.add(label)
    view.render()
    const root = /** @type {any} */ (view.overlay)
    expect(root.children[0].children[0]).toBe(label.content)
    view.dispose()
  })

  it('keeps its text in the JSON, and says so when there is none', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const withText = new Label({ text: 'y = sin x', content: element() }).toJSON()
    expect(withText).toMatchObject({ type: 'label', text: 'y = sin x' })
    expect('content' in withText).toBe(false)
    expect(warn).not.toHaveBeenCalled()
    new Label({ content: element() }).toJSON()
    expect(warn.mock.calls[0][0]).toContain("toJSON() can't keep 'content'")
    warn.mockRestore()
  })

  it('gives a clone a copy of its element - an element can only be in one place', () => {
    const formula = element()
    formula.cloneNode = () => element()
    const copy = /** @type {Label} */ (new Label({ text: 't', content: formula }).clone())
    expect(copy.content).toBeTruthy()
    expect(copy.content).not.toBe(formula)
  })
})
