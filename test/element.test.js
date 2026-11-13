// phoria2/element: <phoria-view> on a stand-in page - attributes as View options, the content it
// loads (inline descriptions, scene URLs, glTF models, charts), changes after it is in the page,
// and what it says when something is wrong.
import { Buffer } from 'node:buffer'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Mesh, Scene } from '../src/index.js'
import { fakePage } from './fakes.js'

const page = fakePage()

/** Just enough of an HTML element for the tag: attributes, children, events, connection. */
class FakeHTMLElement {
  /** @type {Map<string, string>} */ attrs = new Map()
  /** @type {any[]} */ children = []
  /** @type {Map<string, Set<Function>>} */ listeners = new Map()
  isConnected = false
  id = ''
  /** @param {string} n */
  getAttribute(n) { return this.attrs.has(n) ? /** @type {string} */ (this.attrs.get(n)) : null }
  /** @param {string} n @param {any} v */
  setAttribute(n, v) {
    const before = this.getAttribute(n)
    this.attrs.set(n, String(v))
    const self = /** @type {any} */ (this)
    self.attributeChangedCallback?.(n, before, String(v))
  }
  /** @param {string} n */
  removeAttribute(n) {
    const before = this.getAttribute(n)
    this.attrs.delete(n)
    const self = /** @type {any} */ (this)
    self.attributeChangedCallback?.(n, before, null)
  }
  append(...els) { this.children.push(...els) }
  /** @param {string} type @param {Function} fn */
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)?.add(fn)
  }
  /** @param {Event} e */
  dispatchEvent(e) {
    for (const fn of this.listeners.get(e.type) ?? []) fn(e)
    return true
  }
}

/** @type {Record<string, any>} */
const defined = {}
/** @type {any} */
let PhoriaView, viewOptions
beforeAll(async () => {
  Object.assign(globalThis, { HTMLElement: FakeHTMLElement, customElements: { get: (n) => defined[n], define: (n, c) => { defined[n] = c } } })
  ;({ PhoriaView, viewOptions } = await import('../src/element/index.js'))
})
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 50))
  delete globalThis.HTMLElement
  delete globalThis.customElements
  page.restore()
})
/** @type {any[]} */
const made = []
afterEach(() => {
  for (const el of made.splice(0)) el.view?.dispose()
  vi.restoreAllMocks()
  page.frame(0)
})

/** A tag with these attributes and children, not yet in the page. @param {Record<string, string>} [attrs] @param {any[]} [children] */
const tag = (attrs = {}, children = []) => {
  const el = new PhoriaView()
  for (const [k, v] of Object.entries(attrs)) el.attrs.set(k, v)
  el.children.push(...children)
  made.push(el)
  return el
}
/** @param {any} el */
const connect = (el) => {
  el.isConnected = true
  el.connectedCallback()
  return el
}
/** An inline <script type="application/json">. @param {any} json */
const script = (json) => ({ tagName: 'SCRIPT', type: 'application/json', textContent: typeof json === 'string' ? json : JSON.stringify(json) })
/** Attribute values as a tag would have them. @param {Record<string, string>} attrs */
const options = (attrs) => viewOptions({ getAttribute: (n) => attrs[n] ?? null })
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('attributes as View options', () => {
  it('defines the tag on import', () => {
    expect(defined['phoria-view']).toBe(PhoriaView)
  })

  it('takes switches on, off or as JSON options', () => {
    expect(options({ bloom: '', fxaa: 'true', 'ambient-occlusion': 'false', 'ground-shadow': '{ "opacity": 0.6 }' }))
      .toEqual({ bloom: true, fxaa: true, ambientOcclusion: false, groundShadow: { opacity: 0.6 } })
    expect(() => options({ bloom: 'lots' })).toThrow(`'bloom' is there to turn it on, "false" to turn it off`)
    expect(() => options({ 'ground-shadow': '{ opacity: 1 }' })).toThrow("'ground-shadow' isn't valid JSON")
  })

  it('reads numbers and text, and names the attribute when one is wrong', () => {
    expect(options({ exposure: '1.5', 'pixel-ratio': '2', background: '#123', 'tone-mapping': 'aces', description: 'A chair' }))
      .toEqual({ exposure: 1.5, pixelRatio: 2, background: '#123', toneMapping: 'aces', description: 'A chair' })
    expect(() => options({ exposure: 'bright' })).toThrow("'exposure' is a number, got 'bright'")
    expect(options({ 'reduced-motion': 'auto' })).toEqual({ reducedMotion: 'auto' })
  })

  it('makes the camera from a preset, or from a place to look from', () => {
    expect(options({ camera: 'isometric' })).toEqual({ camera: 'isometric' })
    expect(options({ 'camera-position': '4 2 6', 'camera-target': '0, 1, 0', fov: '40' })).toEqual({ camera: { position: [4, 2, 6], target: [0, 1, 0], fov: 40 } })
    expect(() => options({ 'camera-position': '4 2' })).toThrow(`'camera-position' is three numbers such as "4 2 6", got '4 2'`)
    expect(() => options({ camera: 'top', 'camera-position': '0 5 0' })).toThrow("'camera' is a preset")
  })

  it('turns orbiting on, as a map, or auto-rotating', () => {
    expect(options({ orbit: '' })).toEqual({ orbit: true })
    expect(options({ orbit: 'map' })).toEqual({ orbit: { mode: 'map' } })
    expect(options({ 'auto-rotate': '' })).toEqual({ orbit: { autoRotate: true } })
    expect(options({ orbit: '', 'auto-rotate': '0.3' })).toEqual({ orbit: { autoRotate: 0.3 } })
    expect(options({ orbit: 'false' })).toEqual({ orbit: false })
    expect(options({ orbit: '{ "pan": false }', 'auto-rotate': '' })).toEqual({ orbit: { pan: false, autoRotate: true } })
    expect(() => options({ orbit: 'spin' })).toThrow("'orbit' is there to turn it on")
  })
})

describe('in the page', () => {
  it('draws on a canvas of its own, with the view its attributes ask for', () => {
    const el = connect(tag({ background: '#203040', bloom: '', environment: 'studio', 'environment-intensity': '0.5' }))
    expect(el.children[0]).toBeInstanceOf(globalThis.HTMLCanvasElement)
    expect(el.view.canvas).toBe(el.children[0])
    expect(el.view.bloom).not.toBeNull()
    expect(el.scene.environment).toBe('studio')
    expect(el.scene.environmentIntensity).toBe(0.5)
  })

  it('shows an inline description, and says when it has loaded', async () => {
    const el = tag({}, [script({ type: 'mesh', name: 'cube', geometry: { type: 'box', size: 2 } })])
    const loaded = vi.fn()
    el.addEventListener('load', loaded)
    connect(el)
    await el.ready
    expect(el.scene.find('cube')).toBeInstanceOf(Mesh)
    expect(loaded).toHaveBeenCalledOnce()
    expect(loaded.mock.calls[0][0].detail.view).toBe(el.view)
  })

  it('takes a list of nodes, or a whole scene - keeping its own scene settings', async () => {
    const list = connect(tag({}, [script([{ type: 'mesh', name: 'a', geometry: { type: 'box' } }, { type: 'group', name: 'b' }])]))
    await list.ready
    expect(list.scene.find('a')).toBeTruthy()
    expect(list.scene.find('b')).toBeTruthy()
    const whole = connect(tag({ environment: 'studio' }, [script({ type: 'scene', background: '#111111', children: [{ type: 'group', name: 'inside' }] })]))
    await whole.ready
    expect(whole.scene).toBeInstanceOf(Scene)
    expect(whole.scene.find('inside')).toBeTruthy()
    expect(whole.scene.environment).toBe('studio')
  })

  it('loads phoria2/charts for a chart', async () => {
    const el = connect(tag({}, [script({ type: 'chart', name: 'sales', mark: 'bar', data: [{ m: 'Jan', v: 3 }, { m: 'Feb', v: 5 }], x: 'm', y: 'v' })]))
    await el.ready
    expect(el.scene.find('sales')?.constructor.name).toBe('Chart')
  })

  it('fetches a scene from a URL', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ type: 'group', name: 'fetched' })))
    const el = connect(tag({ scene: 'scenes/one.json' }))
    await el.ready
    expect(globalThis.fetch).toHaveBeenCalledWith('scenes/one.json')
    expect(el.scene.find('fetched')).toBeTruthy()
  })

  it('loads a glTF model from src, and swaps it when src changes', async () => {
    const gltf = (name) => new Response(JSON.stringify({ asset: { version: '2.0' }, scenes: [{ nodes: [0] }], scene: 0, nodes: [{ name }] }))
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(gltf('first')).mockResolvedValueOnce(gltf('second'))
    const el = connect(tag({ src: 'one.gltf' }))
    await el.ready
    expect(el.model?.find('first')).toBeTruthy()
    el.setAttribute('src', 'two.gltf')
    await el.ready
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(el.scene.find('first')).toBeUndefined()
    expect(el.model?.find('second')).toBeTruthy()
  })

  it('shows the material variant it names, and changes it live', async () => {
    // a triangle, red in one variant and blue in the other
    const positions = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer).toString('base64')
    const model = {
      asset: { version: '2.0' }, scenes: [{ nodes: [0] }], scene: 0, nodes: [{ name: 'tri', mesh: 0 }],
      extensionsUsed: ['KHR_materials_variants'], extensions: { KHR_materials_variants: { variants: [{ name: 'Red' }, { name: 'Blue' }] } },
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0,
        extensions: { KHR_materials_variants: { mappings: [{ material: 1, variants: [0] }, { material: 2, variants: [1] }] } } }] }],
      materials: [{ name: 'grey' }, { name: 'red' }, { name: 'blue' }],
      buffers: [{ byteLength: 36, uri: `data:application/octet-stream;base64,${positions}` }],
      bufferViews: [{ buffer: 0, byteLength: 36 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
    }
    const real = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => (String(url).startsWith('data:') ? real(url) : Promise.resolve(new Response(JSON.stringify(model)))))
    const el = connect(tag({ src: 'tri.gltf', variant: 'Blue' }))
    await el.ready
    const tri = el.model.find('tri')
    expect([el.model.variant, tri.material.name]).toEqual(['Blue', 'blue'])
    el.setAttribute('variant', 'Red')
    expect(tri.material.name).toBe('red')
    el.removeAttribute('variant')
    expect([el.model.variant, tri.material.name]).toEqual([null, 'grey'])
  })

  it('changes a live setting in place, and remakes the view for one that needs it', async () => {
    const el = connect(tag())
    const first = el.view
    el.setAttribute('bloom', '')
    el.setAttribute('background', '#ff0000')
    expect(el.view).toBe(first)
    expect(el.view.bloom).not.toBeNull()
    el.removeAttribute('bloom')
    expect(el.view.bloom).toBeNull()
    el.setAttribute('pixel-ratio', '1.5')
    el.setAttribute('antialias', 'false')
    await tick()
    expect(el.view).not.toBe(first)
    expect(first.canvas.removed).toBe(true)
    expect(el.children.filter((c) => !c.removed)).toHaveLength(1)
  })

  it('keeps its view when moved within the page, and lets it go when taken out', async () => {
    const el = connect(tag())
    const view = el.view
    el.isConnected = false
    el.disconnectedCallback()
    connect(el)
    await tick()
    expect(el.view).toBe(view)
    el.isConnected = false
    el.disconnectedCallback()
    await tick()
    expect(el.view).toBeNull()
  })

  it('says what is wrong in the console and as an error event', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const el = tag({ id: 'chair', exposure: 'bright' })
    el.id = 'chair'
    const heard = vi.fn()
    el.addEventListener('error', heard)
    connect(el)
    expect(el.view).toBeNull()
    expect(error.mock.calls[0].join(' ')).toContain("<phoria-view #chair>: phoria-view: 'exposure' is a number, got 'bright'")
    expect(heard).toHaveBeenCalledOnce()

    const broken = connect(tag({}, [script('{ "type": "mesh", ')]))
    await broken.ready.catch(() => {})
    await tick()
    expect(error.mock.calls.at(-1)?.join(' ')).toContain("isn't valid JSON")
  })
})
