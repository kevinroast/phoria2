// Stand-ins for the browser, so code that needs a WebGL context or a page can run in tests.

// GLSL type names as WebGL's uniform type constants, for the fake's active uniforms
const UNIFORM_TYPES = {
  float: 'FLOAT', vec2: 'FLOAT_VEC2', vec3: 'FLOAT_VEC3', vec4: 'FLOAT_VEC4',
  int: 'INT', ivec2: 'INT_VEC2', ivec3: 'INT_VEC3', ivec4: 'INT_VEC4',
  uint: 'UNSIGNED_INT', uvec2: 'UNSIGNED_INT_VEC2', uvec3: 'UNSIGNED_INT_VEC3', uvec4: 'UNSIGNED_INT_VEC4',
  bool: 'BOOL', bvec2: 'BOOL_VEC2', bvec3: 'BOOL_VEC3', bvec4: 'BOOL_VEC4',
  mat2: 'FLOAT_MAT2', mat3: 'FLOAT_MAT3', mat4: 'FLOAT_MAT4',
  sampler2D: 'SAMPLER_2D', sampler2DShadow: 'SAMPLER_2D_SHADOW', samplerCube: 'SAMPLER_CUBE', samplerCubeShadow: 'SAMPLER_CUBE_SHADOW',
  sampler3D: 'SAMPLER_3D', sampler2DArray: 'SAMPLER_2D_ARRAY', isampler2D: 'INT_SAMPLER_2D', usampler2D: 'UNSIGNED_INT_SAMPLER_2D',
}

/**
 * A shader's source with its preprocessor run, as far as phoria2's shaders use it: #define,
 * #ifdef / #ifndef / #if / #elif / #else / #endif over defined(), !, &&, || and comparisons of
 * defined numbers. Returns the lines that survive and the defines.
 * @param {string} source
 */
export function preprocess(source) {
  /** @type {Map<string, string>} */
  const defines = new Map()
  const value = (expr) => {
    const js = expr.replace(/defined\s*\(\s*(\w+)\s*\)/g, (_, n) => (defines.has(n) ? '1' : '0'))
      .replace(/\b[A-Za-z_]\w*\b/g, (n) => (defines.has(n) ? (Number(defines.get(n)) || 0).toString() : '0'))
    if (!/^[\d\s()!&|<>=+-]*$/.test(js)) throw new Error(`fake preprocessor: can't evaluate '#if ${expr}'`)
    return !!Function(`return (${js})`)()
  }
  /** each open #if: is its branch taken, has any branch been taken, was the enclosing one live */
  const stack = /** @type {{ on: boolean, done: boolean, outer: boolean }[]} */ ([])
  const live = () => stack.every((b) => b.on)
  const lines = []
  for (const line of source.split('\n')) {
    const d = /^\s*#\s*(\w+)\s*(.*)$/.exec(line)
    if (!d) {
      if (live()) lines.push(line)
      continue
    }
    const [, word, rest] = d
    if (word === 'ifdef' || word === 'ifndef' || word === 'if') {
      const outer = live()
      const on = outer && (word === 'if' ? value(rest) : (word === 'ifdef') === defines.has(rest.trim()))
      stack.push({ on, done: on, outer })
    } else if (word === 'elif' || word === 'else') {
      const b = /** @type {{ on: boolean, done: boolean, outer: boolean }} */ (stack.at(-1))
      b.on = b.outer && !b.done && (word === 'else' || value(rest))
      b.done ||= b.on
    } else if (word === 'endif') {
      stack.pop()
    } else if (live() && word === 'define') {
      const m = /^(\w+)\s*(.*)$/.exec(rest)
      if (m) defines.set(m[1], m[2].trim())
    }
  }
  return { lines, defines }
}

/**
 * The uniforms a linked program has, from its shaders' preprocessed sources: name, GLSL type and
 * array size, each once.
 * @param {string[]} shaderSources
 */
export function declaredUniforms(shaderSources) {
  /** @type {Map<string, { type: string, size: number }>} */
  const uniforms = new Map()
  for (const source of shaderSources) {
    const { lines, defines } = preprocess(source)
    for (const line of lines) {
      const m = /^\s*uniform\s+(?:(?:highp|mediump|lowp)\s+)?(\w+)\s+(\w+)\s*(?:\[\s*(\w+)\s*\])?\s*;/.exec(line)
      if (!m) continue
      const size = m[3] === undefined ? 1 : Number(/^\d+$/.test(m[3]) ? m[3] : defines.get(m[3]))
      uniforms.set(m[2], { type: m[1], size })
    }
  }
  return uniforms
}

// A stand-in WebGL 2 context that counts the GPU objects made and freed, and the draws, so leaks
// show without a GPU. Constants are stable made-up numbers; calls it doesn't model are no-ops. With
// `parallel`, it offers background shader compiling, finished when compiled.done is set.
// - `sources` keeps every shader's source, in the order given;
// - a linked program reports the uniforms its shaders declare once preprocessed - so the code that
//   finds a program's uniforms runs as with a GPU - and keeps the last value each was set to
//   (`program.values`, by name);
// - `drawLog` has each draw: the program, the framebuffer drawn into (null: the canvas) and the viewport.
export function fakeGL({ parallel = false } = {}) {
  const compiled = { done: false }
  // draws made, and how many vertices each drawArrays drew
  const draws = { count: 0, /** @type {number[]} */ sizes: [] }
  const live = new Set()
  const sources = /** @type {string[]} */ ([])
  /** @type {{ call: string, count: number, program: any, framebuffer: any, viewport: number[] }[]} */
  const drawLog = []
  const bound = { program: /** @type {any} */ (null), framebuffer: /** @type {any} */ (null), viewport: [0, 0, 0, 0] }
  const logDraw = (call, count) => drawLog.push({ call, count, program: bound.program, framebuffer: bound.framebuffer, viewport: [...bound.viewport] })
  // a uniform's value, kept on its program
  const setUniform = (loc, v) => { if (loc) loc.program.values[loc.name] = typeof v === 'object' && v !== null && 'length' in v ? Array.from(v) : v }
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
    createFramebuffer: make('framebuffer'), createRenderbuffer: make('renderbuffer'),
    createProgram: () => {
      const p = { kind: 'program', shaders: /** @type {any[]} */ ([]), uniforms: /** @type {{ name: string, type: number, size: number }[]} */ ([]), values: /** @type {Record<string, any>} */ ({}) }
      live.add(p)
      return p
    },
    createShader: () => ({ source: '' }),
    shaderSource: (shader, source) => {
      sources.push(source)
      if (shader) shader.source = source
    },
    attachShader: (program, shader) => program?.shaders.push(shader),
    linkProgram: (program) => {
      if (!program) return
      program.uniforms = [...declaredUniforms(program.shaders.map((sh) => sh.source))]
        .map(([name, u]) => ({ name: u.size > 1 ? `${name}[0]` : name, type: constant(UNIFORM_TYPES[u.type] ?? `UNKNOWN_TYPE_${u.type}`), size: u.size }))
    },
    getActiveUniform: (program, i) => program.uniforms[i],
    getUniformLocation: (program, name) => ({ program, name: name.replace(/\[0\]$/, '') }),
    useProgram: (program) => { bound.program = program },
    bindFramebuffer: (target, framebuffer) => {
      if (target !== constant('READ_FRAMEBUFFER')) bound.framebuffer = framebuffer
    },
    viewport: (x, y, w, h) => { bound.viewport = [x, y, w, h] },
    deleteBuffer: free, deleteTexture: free, deleteVertexArray: free, deleteFramebuffer: free, deleteRenderbuffer: free,
    deleteProgram: free, deleteShader() {},
    getShaderParameter: () => true,
    // 0x91b1 is COMPLETION_STATUS_KHR: is a program compiled yet?
    getProgramParameter: (p, name) => (name === constant('ACTIVE_UNIFORMS') ? p.uniforms.length : name === 0x91b1 ? compiled.done : true),
    getExtension: (name) => (name === 'WEBGL_lose_context' ? { loseContext: () => { lost.count++; lost.now = true; live.clear() }, restoreContext: () => { lost.restores++; lost.now = false } }
      : name === 'KHR_parallel_shader_compile' && parallel ? {} : null),
    drawElements: (_mode, n) => {
      draws.count++
      logDraw('drawElements', n)
    },
    drawArrays: (_mode, _first, n) => {
      draws.count++
      draws.sizes.push(n)
      logDraw('drawArrays', n)
    },
    drawElementsInstanced: (_mode, n) => logDraw('drawElementsInstanced', n),
    drawArraysInstanced: (_mode, _first, n) => logDraw('drawArraysInstanced', n),
    isContextLost: () => lost.now,
    // as a browser's context, multisampled unless asked not to be
    getContextAttributes: () => ({ antialias: true }),
  }
  // every uniform* call keeps its value on the program
  for (const name of ['uniform1f', 'uniform1fv', 'uniform2fv', 'uniform3fv', 'uniform4fv', 'uniform1i', 'uniform1iv', 'uniform2iv', 'uniform3iv', 'uniform4iv',
    'uniform1ui', 'uniform1uiv', 'uniform2uiv', 'uniform3uiv', 'uniform4uiv']) gl[name] = (loc, v) => setUniform(loc, v)
  for (const name of ['uniformMatrix2fv', 'uniformMatrix3fv', 'uniformMatrix4fv']) gl[name] = (loc, _t, v) => setUniform(loc, v)
  const proxy = new Proxy(gl, {
    get: (target, key) => (key in target ? target[key] : typeof key === 'string' && /^[A-Z0-9_]+$/.test(key) ? constant(key) : () => {}),
  })
  const count = (kind) => [...live].filter((o) => o.kind === kind).length
  return { gl: proxy, live, lost, count, compiled, draws, sources, drawLog }
}

export const fakeCanvas = (gl) => ({
  width: 0, height: 0,
  getContext: (type) => (type === 'webgl2' ? gl : type === '2d' ? { drawImage() {}, globalCompositeOperation: '' } : null),
  addEventListener() {}, removeEventListener() {},
})

/**
 * An element that takes whatever a View, its labels or tooltip do to it: style and attributes
 * are kept, methods it doesn't know are no-ops. It keeps its listeners: el.dispatch(type, event)
 * calls them.
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
    /** @type {Map<string, Set<Function>>} */ listeners: new Map(),
    addEventListener(type, fn) {
      if (!base.listeners.has(type)) base.listeners.set(type, new Set())
      base.listeners.get(type)?.add(fn)
    },
    removeEventListener(type, fn) { base.listeners.get(type)?.delete(fn) },
    /** @param {string} type @param {Record<string, any>} [event] */
    dispatch(type, event = {}) {
      for (const fn of base.listeners.get(type) ?? []) fn({ type, clientX: 0, clientY: 0, preventDefault() {}, ...event })
    },
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
    // attributes, as accessibility sets them (role, tabindex, aria-*)
    /** @type {Map<string, string>} */ attributes = new Map()
    setAttribute(name, value) { this.attributes.set(name, String(value)) }
    getAttribute(name) { return this.attributes.get(name) ?? null }
    hasAttribute(name) { return this.attributes.has(name) }
    removeAttribute(name) { this.attributes.delete(name) }
    get tabIndex() { return Number(this.attributes.get('tabindex') ?? -1) }
    set tabIndex(v) { this.attributes.set('tabindex', String(v)) }
    // what was put after it in the page, such as the keyboard's live region
    /** @type {any[]} */ siblings = []
    after(...els) { this.siblings.push(...els) }
    removed = false
    remove() { this.removed = true }
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
