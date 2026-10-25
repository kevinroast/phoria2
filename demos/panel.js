// A small floating control panel in the shared kevs3d style. The API mirrors the subset of
// lil-gui the demos use, so a demo reads the same either way:
//
//   const f = panel.addFolder('Light').close()
//   f.add(light, 'intensity', 0, 2, 0.05)          slider (number with min/max)
//   f.add(style, 'drawmode', ['point', 'solid'])   select (array or {label: value})
//   f.add(emitter, 'gravity')                      checkbox (boolean)
//   f.add(actions, 'reset')                        button (function)
//   f.add(scene, 'speed').name('Speed').onChange(fn)
//   panel.updateDisplay()                          re-read every value after changing them in code

const el = (tag, className, text) => {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (text !== undefined) e.textContent = text
  return e
}

// sensible slider step when none is given: a round number about 1/100th of the range
const autoStep = (min, max) => 10 ** Math.floor(Math.log10((max - min) / 100))
const decimals = (step) => step < 0.01 ? 3 : step < 1 ? 2 : 0

class Controller {
  constructor(object, property) {
    this.object = object
    this.property = property
    this.handlers = []
    this.root = el('label', 'control')
    this.nameEl = el('span', '', property)
    this.label = el('span', 'control-label')
    this.label.append(this.nameEl)
    /** the form field, for controllers that have one @type {HTMLInputElement | null} */
    this.input = null
  }

  // refresh any readout beside the field
  show() {}

  name(text) {
    this.nameEl.textContent = text
    return this
  }

  onChange(fn) {
    this.handlers.push(fn)
    return this
  }

  setValue(value) {
    this.object[this.property] = value
    for (const fn of this.handlers) fn.call(this, value)
  }

  // show the property's current value - after code changed it
  updateDisplay() {
    const value = this.object[this.property]
    if (this.input?.type === 'checkbox') this.input.checked = value
    else if (this.input) this.input.value = value
    this.show()
    return this
  }
}

class SliderController extends Controller {
  constructor(object, property, min, max, step = autoStep(min, max)) {
    super(object, property)
    this.readout = el('span', 'control-value')
    this.label.append(this.readout)
    const input = this.input = el('input')
    Object.assign(input, { type: 'range', min, max, step, value: object[property] })
    input.addEventListener('input', () => {
      this.setValue(parseFloat(input.value))
      this.show()
    })
    this.digits = decimals(step)
    this.root.append(this.label, input)
    this.show()
  }

  show() {
    this.readout.textContent = Number(this.object[this.property]).toFixed(this.digits)
  }
}

class NumberController extends Controller {
  constructor(object, property) {
    super(object, property)
    const input = this.input = el('input')
    Object.assign(input, { type: 'number', value: object[property] })
    input.addEventListener('input', () => {
      const v = parseFloat(input.value)
      if (!Number.isNaN(v)) this.setValue(v)
    })
    this.root.append(this.label, input)
  }
}

class SelectController extends Controller {
  constructor(object, property, options) {
    super(object, property)
    const entries = Array.isArray(options) ? options.map((o) => [String(o), o]) : Object.entries(options)
    const select = el('select')
    for (const [label, value] of entries) {
      const option = el('option', '', label)
      option.value = label
      option.selected = value === object[property]
      select.append(option)
    }
    select.addEventListener('change', () => {
      this.setValue(entries.find(([label]) => label === select.value)[1])
    })
    this.root.append(this.label, select)
    this.select = select
    this.entries = entries
  }

  updateDisplay() {
    const match = this.entries.find(([, value]) => value === this.object[this.property])
    if (match) this.select.value = match[0]
    return this
  }
}

class CheckboxController extends Controller {
  constructor(object, property) {
    super(object, property)
    this.root.classList.add('control-inline')
    const input = this.input = el('input')
    Object.assign(input, { type: 'checkbox', checked: object[property] })
    input.addEventListener('change', () => this.setValue(input.checked))
    this.root.append(input, this.label)
  }
}

class ButtonController extends Controller {
  constructor(object, property) {
    super(object, property)
    this.root = el('button', 'panel-button')
    this.root.type = 'button'
    this.root.append(this.nameEl)
    this.root.addEventListener('click', () => object[property].call(object))
  }
}

class Folder {
  constructor(parent, title) {
    this.children = []
    this.root = el('fieldset', 'section')
    if (title) {
      const legend = el('legend')
      this.toggle = el('button', 'section-toggle', title)
      this.toggle.type = 'button'
      this.toggle.addEventListener('click', () => this.root.classList.contains('closed') ? this.open() : this.close())
      legend.append(this.toggle)
      this.root.append(legend)
    }
    this.body = el('div', 'section-body')
    this.root.append(this.body)
    parent.append(this.root)
  }

  add(object, property, ...args) {
    if (!(property in object)) throw new Error(`Panel: '${property}' is not a property of the object`)
    const value = object[property]
    let c
    if (typeof value === 'function') {
      c = new ButtonController(object, property)
    } else if (typeof value === 'boolean') {
      c = new CheckboxController(object, property)
    } else if (args[0] !== undefined && typeof args[0] === 'object') {
      c = new SelectController(object, property, args[0])
    } else if (typeof value === 'number' && args.length >= 2) {
      c = new SliderController(object, property, ...args)
    } else {
      c = new NumberController(object, property)
    }
    this.body.append(c.root)
    this.children.push(c)
    return c
  }

  open() {
    this.root.classList.remove('closed')
    return this
  }

  updateDisplay() {
    for (const c of this.children) c.updateDisplay()
    return this
  }

  close() {
    this.root.classList.add('closed')
    return this
  }
}

// The floating panel: a draggable header with a collapse button over a scrolling body.
export class Panel extends Folder {
  constructor({ title = 'Controls', container = document.body } = {}) {
    const panel = el('div', 'panel')
    const header = el('div', 'panel-header')
    const heading = el('span', 'panel-title', title)
    const collapse = el('button', 'panel-collapse')
    collapse.type = 'button'
    collapse.title = 'Collapse'
    header.append(heading, collapse)
    const scroll = el('div', 'panel-scroll')
    panel.append(header, scroll)
    super(scroll)
    // the top level has no legend or section chrome - just its controls
    this.root.className = 'panel-root'
    this.panel = panel
    this.folders = []

    collapse.addEventListener('click', () => panel.classList.toggle('collapsed'))
    // start collapsed on narrow screens so the scene is visible
    if (window.innerWidth < 600) panel.classList.add('collapsed')
    this.#draggable(header)
    container.append(panel)
  }

  addFolder(title) {
    const folder = new Folder(this.panel.querySelector('.panel-scroll'), title)
    this.folders.push(folder)
    return folder
  }

  updateDisplay() {
    super.updateDisplay()
    for (const folder of this.folders) folder.updateDisplay()
    return this
  }

  get isEmpty() {
    return this.children.length === 0 && this.folders.length === 0
  }

  destroy() {
    this.panel.remove()
  }

  // Drag by the header; the panel is kept inside the window.
  #draggable(handle) {
    const panel = this.panel
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return
      handle.setPointerCapture(e.pointerId)
      const rect = panel.getBoundingClientRect()
      const offsetX = e.clientX - rect.left, offsetY = e.clientY - rect.top
      const onMove = (ev) => {
        const x = Math.min(window.innerWidth - rect.width, Math.max(0, ev.clientX - offsetX))
        const y = Math.min(window.innerHeight - 40, Math.max(0, ev.clientY - offsetY))
        Object.assign(panel.style, { left: `${x}px`, top: `${y}px`, right: 'auto' })
      }
      const onUp = () => {
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onUp)
        handle.removeEventListener('pointercancel', onUp)
      }
      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onUp)
      handle.addEventListener('pointercancel', onUp)
    })
  }
}
