// Stand-ins for the browser, so code that needs a WebGL context or a page can run in tests.

// A stand-in WebGL 2 context that does nothing but count the GPU objects made and freed, and the
// draws, so leaks show without a GPU. Constants are stable made-up numbers; every other call is a
// no-op. With `parallel`, it offers background shader compiling, finished when compiled.done is set.
export function fakeGL({ parallel = false } = {}) {
  const compiled = { done: false }
  // draws made, and how many vertices each drawArrays drew
  const draws = { count: 0, /** @type {number[]} */ sizes: [] }
  const live = new Set()
  const lost = { count: 0, now: false, restores: 0 }
  const consts = new Map()
  const constant = (name) => {
    if (!consts.has(name)) consts.set(name, 1000 + consts.size)
    return consts.get(name)
  }
  const make = (kind) => () => {
    const o = { kind }
    live.add(o)
    return o
  }
  const free = (o) => live.delete(o)
  const gl = {
    createBuffer: make('buffer'), createTexture: make('texture'), createVertexArray: make('vertex array'),
    createFramebuffer: make('framebuffer'), createRenderbuffer: make('renderbuffer'), createProgram: make('program'),
    createShader: () => ({}),
    deleteBuffer: free, deleteTexture: free, deleteVertexArray: free, deleteFramebuffer: free, deleteRenderbuffer: free,
    deleteProgram: free, deleteShader() {},
    getShaderParameter: () => true,
    // 0x91b1 is COMPLETION_STATUS_KHR: is a program compiled yet?
    getProgramParameter: (_p, name) => (name === constant('ACTIVE_UNIFORMS') ? 0 : name === 0x91b1 ? compiled.done : true),
    getExtension: (name) => (name === 'WEBGL_lose_context' ? { loseContext: () => { lost.count++; lost.now = true; live.clear() }, restoreContext: () => { lost.restores++; lost.now = false } }
      : name === 'KHR_parallel_shader_compile' && parallel ? {} : null),
    drawElements: () => draws.count++,
    drawArrays: (_mode, _first, n) => {
      draws.count++
      draws.sizes.push(n)
    },
    isContextLost: () => lost.now,
  }
  const proxy = new Proxy(gl, {
    get: (target, key) => (key in target ? target[key] : typeof key === 'string' && /^[A-Z0-9_]+$/.test(key) ? constant(key) : () => {}),
  })
  const count = (kind) => [...live].filter((o) => o.kind === kind).length
  return { gl: proxy, live, lost, count, compiled, draws }
}

export const fakeCanvas = (gl) => ({
  width: 0, height: 0,
  getContext: (type) => (type === 'webgl2' ? gl : type === '2d' ? { drawImage() {}, globalCompositeOperation: '' } : null),
  addEventListener() {}, removeEventListener() {},
})

/**
 * An element that takes whatever a View, its labels or tooltip do to it: style and attributes
 * are kept, methods it doesn't know are no-ops.
 * @param {string} tag
 * @returns {any}
 */
export function fakeElement(tag = 'div') {
  const base = {
    tagName: tag.toUpperCase(), style: {}, dataset: {}, children: [], className: '', textContent: '',
    offsetWidth: 60, offsetHeight: 16, clientWidth: 0, clientHeight: 0, offsetLeft: 0, offsetTop: 0, clientLeft: 0, clientTop: 0,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    append(...els) { base.children.push(...els) },
    prepend(...els) { base.children.unshift(...els) },
  }
  return new Proxy(base, { get: (t, key) => (key in t ? t[key] : typeof key === 'string' ? () => fakeElement() : undefined) })
}

/**
 * Put a page in place - document, a canvas class, observers, animation frames - for code that
 * builds a View. Returns a canvas to give it (300 x 150, with a stand-in WebGL context), frame(now)
 * to run the animation frames asked for since the last one, and restore(), which takes the page
 * away again. The canvas keeps its listeners: canvas.dispatch(type, event) calls them.
 */
export function fakePage() {
  const saved = ['document', 'HTMLCanvasElement', 'ResizeObserver', 'IntersectionObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'devicePixelRatio']
    .map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)])
  class HTMLCanvasElement {
    width = 300
    height = 150
    clientWidth = 300
    clientHeight = 150
    style = {}
    constructor() {
      this.gl = fakeGL().gl
    }
    getContext(type) { return type === 'webgl2' ? this.gl : type === '2d' ? { drawImage() {}, globalCompositeOperation: '' } : null }
    getBoundingClientRect() { return { left: 0, top: 0, right: 300, bottom: 150, width: 300, height: 150 } }
    /** @type {Map<string, Set<Function>>} */ listeners = new Map()
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set())
      this.listeners.get(type)?.add(fn)
    }
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn) }
    /** @param {string} type @param {Record<string, any>} [event] */
    dispatch(type, event = {}) {
      for (const fn of this.listeners.get(type) ?? []) fn({ type, clientX: 0, clientY: 0, buttons: 0, preventDefault() {}, stopImmediatePropagation() {}, ...event })
    }
    after() {}
  }
  const observer = class { observe() {} disconnect() {} unobserve() {} }
  // animation frames run when the test says, with the time it gives
  /** @type {Map<number, (now: number) => void>} */
  const frames = new Map()
  let nextFrame = 1
  Object.assign(globalThis, {
    HTMLCanvasElement,
    document: {
      createElement: (tag) => (tag === 'canvas' ? new HTMLCanvasElement() : fakeElement(tag)), createElementNS: (_ns, tag) => fakeElement(tag),
      body: fakeElement('body'), head: fakeElement('head'), querySelector: () => null, getElementById: () => null,
    },
    ResizeObserver: observer, IntersectionObserver: observer,
    requestAnimationFrame: (fn) => {
      frames.set(nextFrame, fn)
      return nextFrame++
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    getComputedStyle: () => ({ position: 'static', color: 'rgb(255, 255, 255)' }),
    devicePixelRatio: 1,
  })
  return {
    canvas: () => new HTMLCanvasElement(),
    /** Run the frames asked for so far, at this time in milliseconds. @param {number} now @returns {number} how many ran */
    frame(now) {
      const due = [...frames.values()]
      frames.clear()
      for (const fn of due) fn(now)
      return due.length
    },
    /** Frames asked for and not yet run. */
    get pending() { return frames.size },
    restore() {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else delete globalThis[key]
      }
    },
  }
}
