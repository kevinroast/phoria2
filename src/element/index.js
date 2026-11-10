// phoria2/element - <phoria-view>: phoria2 as an HTML tag, for pages that want a model, a chart or a
// scene without writing a render loop. Importing it defines the tag:
//
//     <script type="module" src="https://cdn.jsdelivr.net/npm/phoria2/dist/element.js"></script>
//     <phoria-view src="chair.glb" environment="studio" orbit auto-rotate ground-shadow></phoria-view>
//
// Attributes are View options, kebab-cased; the content is a glTF model (src), a scene description
// (scene, a URL - or a <script type="application/json"> inside the tag), or both. el.view is the
// View, for anything the attributes don't cover. The canvas goes inside the tag, not a shadow root,
// so the page's CSS styles labels, tooltips and legends as it would anywhere else. glTF and charts
// load only when the content needs them.
import { View } from '../View.js'
import { create } from '../describe.js'
import { fail } from '../validate.js'

/** @import { Node } from '../scene/Node.js' */
/** @import { Scene } from '../scene/Scene.js' */
/** @import { Hit } from '../Raycaster.js' */
/** @import { Model } from '../gltf/load.js' */

const TAG = 'phoria-view'

/**
 * An attribute that is there, empty or "true", is on; "false" is off; a JSON object is options -
 * ground-shadow='{ "opacity": 0.6 }'.
 * @param {string} name @param {string} v
 */
function flag(name, v) {
  const s = v.trim()
  if (s === '' || s === 'true') return true
  if (s === 'false') return false
  if (s.startsWith('{')) return json(name, s)
  return fail(TAG, `'${name}' is there to turn it on, "false" to turn it off, or JSON options such as '{ "strength": 0.5 }' - got '${v}'`)
}

/** @param {string} name @param {string} v */
function json(name, v) {
  try {
    return JSON.parse(v)
  } catch (e) {
    return fail(TAG, `'${name}' isn't valid JSON - ${/** @type {Error} */ (e).message}`)
  }
}

/** @param {string} name @param {string} v */
function number(name, v) {
  const n = Number(v)
  if (v.trim() === '' || !Number.isFinite(n)) fail(TAG, `'${name}' is a number, got '${v}'`)
  return n
}

/** Three numbers, by spaces or commas: camera-position="4 2 6". @param {string} name @param {string} v */
function vec3(name, v) {
  const parts = v.trim().split(/[\s,]+/).map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) fail(TAG, `'${name}' is three numbers such as "4 2 6", got '${v}'`)
  return parts
}

const text = (/** @type {string} */ _name, /** @type {string} */ v) => v

/**
 * How each attribute reaches the view. `option`: the View option it sets when the view is made.
 * `live`: how a change reaches the view already made - without one, a change remakes the view.
 * `scene`: set on the scene (each one the tag loads, too). Content attributes - src, scene,
 * autoplay - are handled by the element.
 * @type {Record<string, { parse: (name: string, v: string) => any, option?: string, live?: (view: View, v: any) => void, scene?: (scene: Scene, v: any) => void }>}
 */
const ATTRIBUTES = {
  background: { parse: text, option: 'background', live: (view, v) => { view.scene.background = v ?? null } },
  environment: { parse: text, scene: (scene, v) => { scene.environment = v ?? 'none' } },
  'environment-intensity': { parse: number, scene: (scene, v) => { scene.environmentIntensity = v ?? 1 } },
  camera: { parse: text },
  'camera-position': { parse: vec3 },
  'camera-target': { parse: vec3 },
  fov: { parse: number },
  orbit: { parse: text },
  'auto-rotate': { parse: text },
  bloom: { parse: flag, option: 'bloom', live: (view, v) => { view.bloom = v ?? false } },
  'ambient-occlusion': { parse: flag, option: 'ambientOcclusion', live: (view, v) => { view.ambientOcclusion = v ?? false } },
  'ground-shadow': { parse: flag, option: 'groundShadow', live: (view, v) => { view.groundShadow = v ?? false } },
  fxaa: { parse: flag, option: 'fxaa', live: (view, v) => { view.fxaa = v ?? false } },
  'tone-mapping': { parse: text, option: 'toneMapping', live: (view, v) => { view.toneMapping = v ?? 'neutral' } },
  exposure: { parse: number, option: 'exposure', live: (view, v) => { view.exposure = v ?? 1 } },
  highlight: { parse: text, option: 'highlight', live: (view, v) => { view.highlight = v ?? null } },
  description: { parse: text, option: 'description', live: (view, v) => { view.description = v ?? null } },
  debug: { parse: flag, option: 'debug', live: (view, v) => { view.debug = v ?? false } },
  keyboard: { parse: flag, option: 'keyboard' },
  'render-mode': { parse: text, option: 'renderMode' },
  'pixel-ratio': { parse: number, option: 'pixelRatio' },
  antialias: { parse: flag, option: 'antialias' },
  context: { parse: text, option: 'context' },
  'auto-light': { parse: flag, option: 'autoLight' },
  'reduced-motion': { parse: (name, v) => (v.trim() === 'auto' ? 'auto' : flag(name, v)), option: 'reducedMotion' },
}
// what the tag loads
const CONTENT = ['src', 'scene', 'autoplay']

/**
 * The View options a tag's attributes ask for - every value checked on the way, so a mistake names
 * the attribute. Exported for the tests.
 * @param {{ getAttribute(name: string): string | null }} el
 * @returns {Record<string, any>}
 */
export function viewOptions(el) {
  /** @type {Record<string, any>} */
  const options = {}
  /** @param {string} name */
  const read = (name) => {
    const v = el.getAttribute(name)
    return v === null ? undefined : ATTRIBUTES[name].parse(name, v)
  }
  for (const [name, a] of Object.entries(ATTRIBUTES)) {
    if (!a.option) continue
    const v = read(name)
    if (v !== undefined) options[a.option] = v
  }
  // the camera: a preset fitted to what is shown, or a place to look from
  const preset = read('camera'), position = read('camera-position'), target = read('camera-target'), fov = read('fov')
  if (position || target || fov !== undefined) {
    if (preset !== undefined) fail(TAG, `'camera' is a preset (perspective, isometric, top, front, side), fitted to the scene - leave it out with camera-position, camera-target or fov`)
    options.camera = { ...(position && { position }), ...(target && { target }), ...(fov !== undefined && { fov }) }
  } else if (preset !== undefined) {
    options.camera = preset
  }
  // orbit="" (or just orbit) turns it on, orbit="map" pans like a map, and JSON is orbit options -
  // orbit='{ "pan": false }'; auto-rotate turns it on too, with a speed in radians a second if given
  const orbit = read('orbit'), spin = read('auto-rotate')
  if (orbit !== undefined || spin !== undefined) {
    const o = orbit?.trim() ?? ''
    if (o === 'false' && spin === undefined) options.orbit = false
    else {
      if (o !== '' && o !== 'true' && o !== 'map' && o !== 'false' && !o.startsWith('{')) {
        fail(TAG, `'orbit' is there to turn it on, "map" to pan like a map, or JSON orbit options such as '{ "pan": false }' - got '${orbit}'`)
      }
      /** @type {Record<string, any>} */
      const control = o === 'map' ? { mode: 'map' } : o.startsWith('{') ? json('orbit', o) : {}
      if (spin !== undefined) control.autoRotate = spin.trim() === '' || spin.trim() === 'true' ? true : number('auto-rotate', spin)
      options.orbit = Object.keys(control).length ? control : true
    }
  }
  return options
}

/**
 * The tag's own description, from a <script type="application/json"> inside it. @param {Element} el
 * @returns {any}
 */
function inlineDescription(el) {
  const script = [...el.children].find((c) => c.tagName === 'SCRIPT' && /** @type {HTMLScriptElement} */ (c).type === 'application/json')
  if (!script) return null
  return json('<script type="application/json">', script.textContent ?? '')
}

/** Does a description hold a chart anywhere? Then phoria2/charts is loaded first. @param {any} d @returns {boolean} */
function hasChart(d) {
  if (Array.isArray(d)) return d.some(hasChart)
  return !!d && typeof d === 'object' && (d.type === 'chart' || (Array.isArray(d.children) && d.children.some(hasChart)))
}

// the tag is a block a page can size; until it does, a sensible height. In :where(), so any rule of
// the page's wins
const STYLE = ':where(phoria-view) { display: block; position: relative; height: 300px } ' +
  ':where(phoria-view > canvas) { position: absolute; inset: 0; width: 100%; height: 100%; display: block }'

function addStyle() {
  if (typeof document === 'undefined' || document.getElementById('phoria-view-style')) return
  const style = document.createElement('style')
  style.id = 'phoria-view-style'
  style.textContent = STYLE
  document.head.prepend(style)
}

// a base class to extend where there is no DOM (a server, the tests' page), so importing never throws
const Base = /** @type {typeof HTMLElement} */ (globalThis.HTMLElement ?? class {})

/**
 * <phoria-view>: a View, its content and its settings, as an HTML tag.
 *
 * Events: 'load' when the content has loaded (detail { view, model }), 'error' when it can't be
 * shown (detail { error }), 'pick' on a click (detail { hit, event } - hit null for empty space),
 * 'hover' as the thing under the pointer changes (detail { hit, event }).
 */
export class PhoriaView extends Base {
  static get observedAttributes() { return [...Object.keys(ATTRIBUTES), ...CONTENT] }

  /** @type {View | null} */ #view = null
  /** @type {Model | null} */ #model = null
  /** What the last load added to the scene, taken away by the next. @type {Node[]} */ #added = []
  /** @type {HTMLCanvasElement | null} */ #canvas = null
  // each load's ticket: a load overtaken by another (a new src) stops at its next step
  #loading = 0
  /** @type {Promise<void>} */ #ready = Promise.resolve()
  #hovering = false
  #remake = false

  /** The View drawing the tag - null until it is in the page, or when it couldn't be made. */
  get view() { return this.#view }
  /** The model src loaded, once it has. @returns {Model | null} */
  get model() { return this.#model }
  /** The scene drawn. @returns {Scene | null} */
  get scene() { return this.#view?.scene ?? null }
  /** Resolves when the content - model, scene and their textures - has loaded; rejects if it can't. */
  get ready() { return this.#ready }

  connectedCallback() {
    // moved within the page: disconnected and connected at once, so the view is kept
    if (!this.#view) this.#build()
  }

  disconnectedCallback() {
    queueMicrotask(() => {
      if (!this.isConnected) this.#teardown()
    })
  }

  /** @param {string} name @param {string | null} before @param {string | null} value */
  attributeChangedCallback(name, before, value) {
    const view = this.#view
    if (!view || before === value) return
    try {
      if (CONTENT.includes(name)) {
        if (name === 'autoplay') this.#autoplay()
        else this.#load()
        return
      }
      const a = ATTRIBUTES[name]
      const v = value === null ? null : a.parse(name, value)
      if (a.live) a.live(view, v)
      else if (a.scene) a.scene(view.scene, v)
      else this.#remakeSoon()
    } catch (error) {
      this.#failed(error)
    }
  }

  /**
   * Listening for 'hover' starts the hover picking it needs - not done for a tag nobody asks.
   * @param {string} type @param {any} listener @param {any} [options]
   */
  addEventListener(type, listener, options) {
    super.addEventListener(type, listener, options)
    if (type === 'hover' && !this.#hovering) {
      this.#hovering = true
      this.#view?.on('hover', (hit, event) => this.#send('hover', { hit, event }))
    }
  }

  /** Load the content again - after changing the inline description, say. @returns {Promise<void>} */
  reload() {
    if (this.#view) this.#load()
    return this.#ready
  }

  // a change only a new view can take - several in a row make one
  #remakeSoon() {
    if (this.#remake) return
    this.#remake = true
    queueMicrotask(() => {
      this.#remake = false
      if (!this.isConnected) return
      this.#teardown()
      this.#build()
    })
  }

  #build() {
    addStyle()
    try {
      const canvas = this.#canvas = document.createElement('canvas')
      this.append(canvas)
      const view = this.#view = new View({ canvas, ...viewOptions(this) })
      this.#applyScene(view.scene)
      view.on('click', (hit, event) => this.#send('pick', { hit, event }))
      if (this.#hovering) view.on('hover', (hit, event) => this.#send('hover', { hit, event }))
      this.#load()
    } catch (error) {
      this.#teardown()
      this.#failed(error)
    }
  }

  #teardown() {
    this.#loading++
    this.#view?.dispose()
    this.#canvas?.remove()
    this.#view = this.#canvas = this.#model = null
    this.#added = []
  }

  /** The tag's scene settings, on a scene it shows. @param {Scene} scene */
  #applyScene(scene) {
    for (const [name, a] of Object.entries(ATTRIBUTES)) {
      const v = this.getAttribute(name)
      if (a.scene && v !== null) a.scene(scene, a.parse(name, v))
    }
  }

  // the content: a scene description (inline or scene=), then the model, each added as it arrives
  #load() {
    const ticket = ++this.#loading
    const view = /** @type {View} */ (this.#view)
    const current = () => ticket === this.#loading
    this.#ready = (async () => {
      // what an earlier load added goes
      for (const node of this.#added) node.removeFromParent()
      this.#added = []
      this.#model = null
      const url = this.getAttribute('scene')
      const description = url ? await (await fetchOk(url, 'scene')).json() : inlineDescription(this)
      if (!current()) return
      if (description) {
        if (hasChart(description)) await import('../charts/index.js')
        if (!current()) return
        this.#show(view, description)
      }
      const src = this.getAttribute('src')
      if (src) {
        const { loadGLTF } = await import('../gltf/index.js')
        const model = await loadGLTF(src)
        if (!current()) return
        this.#model = view.scene.add(model)
        this.#added.push(model)
        this.#autoplay()
      }
      await view.ready
      if (current()) this.#send('load', { view, model: this.#model })
    })()
    this.#ready.catch((error) => {
      if (current()) this.#failed(error)
    })
  }

  /** A description shown: a whole scene replaces the view's; a node, or a list of them, is added. @param {View} view @param {any} d */
  #show(view, d) {
    if (d && typeof d === 'object' && !Array.isArray(d) && d.type === 'scene') {
      const scene = /** @type {Scene} */ (create(d))
      this.#applyScene(scene)
      view.scene = scene
      return
    }
    for (const item of Array.isArray(d) ? d : [d]) this.#added.push(view.scene.add(/** @type {Node} */ (create(item))))
  }

  // autoplay plays the model's first animation, or the one it names
  #autoplay() {
    const model = this.#model
    if (!model) return
    const which = this.getAttribute('autoplay')
    if (which === null) for (const a of model.animations) a.stop()
    else model.play(which.trim() === '' ? 0 : which)
  }

  /** @param {string} type @param {Record<string, any>} detail */
  #send(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }))
  }

  /** Said in the console, naming the tag, and as an 'error' event. @param {unknown} error */
  #failed(error) {
    const id = this.id ? `#${this.id}` : this.getAttribute('src') ?? this.getAttribute('scene') ?? ''
    console.error(`<${TAG}${id ? ` ${id}` : ''}>:`, /** @type {Error} */ (error)?.message ?? error)
    this.#send('error', { error })
  }
}

/** @param {string} url @param {string} what */
async function fetchOk(url, what) {
  const response = await fetch(url).catch((e) => fail(TAG, `couldn't fetch the ${what} '${url}' - ${e.message}`))
  if (!response.ok) fail(TAG, `couldn't fetch the ${what} '${url}' (${response.status} ${response.statusText})`)
  return response
}

if (globalThis.customElements && !globalThis.customElements.get(TAG)) globalThis.customElements.define(TAG, PhoriaView)
