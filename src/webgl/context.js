// A WebGL 2 context and everything made on it - programs, buffers, textures, the extra passes -
// used by one renderer (its canvas's own context) or by many (one context shared by views that
// draw into it and copy the picture to their own canvas, so a dashboard of 30 tiles stays well
// under the browser's limit of about 16 live contexts).
import { fail } from '../validate.js'
import { Programs } from './programs.js'
import { Resources } from './resources.js'

/** @import { Passes } from './passes.js' */
/** @import { Picker } from './picking.js' */
/** @import { Bloom } from './bloom.js' */
/** @import { Scene } from '../scene/Scene.js' */

/** @typedef {{ onReady: (() => void) | null }} ContextUser */

/** @type {GLContext | null} */
let shared = null

export class GLContext {
  /** @type {HTMLCanvasElement | OffscreenCanvas} */ canvas
  /** @type {WebGL2RenderingContext} */ gl
  programs
  resources
  /** HDR environments, panorama backgrounds and shadows - loaded the first time a frame has one. @type {Passes | null} */
  passes = null
  /** GPU picking - loaded the first time something is picked. @type {Picker | null} */
  picker = null
  /** Bloom - loaded the first time a renderer asks for it. @type {Bloom | null} */
  bloom = null
  lost = false
  /** Counts frames across every renderer, so programs know when their per-frame uniforms are stale. */
  frame = 0
  /** @type {Set<ContextUser>} */ users = new Set()
  /** Shared by several renderers, each copying its picture out. */
  isShared
  #passesLoading = false
  #watchingCompiles = false
  #pickerLoading = false
  #bloomLoading = false
  /** @type {() => void} */ #removeListeners

  /**
   * @param {HTMLCanvasElement | OffscreenCanvas} canvas
   * @param {{ antialias?: boolean, shared?: boolean }} [options]
   */
  constructor(canvas, { antialias = true, shared: isShared = false } = {}) {
    this.canvas = canvas
    this.isShared = isShared
    // a canvas let go of moments ago keeps its context, rather than losing it
    const before = released.get(canvas)
    if (before) {
      clearTimeout(before.timer)
      released.delete(canvas)
    }
    const gl = canvas.getContext('webgl2', { antialias, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' })
    if (!gl) fail('WebGLRenderer', 'WebGL 2 is not available in this browser or on this device')
    this.gl = /** @type {WebGL2RenderingContext} */ (gl)
    this.programs = new Programs(this.gl)
    this.resources = new Resources(this.gl)

    // a lost context (GPU reset, too many contexts) is restored by the browser; every GPU object
    // is then recreated from the CPU-side data, and every renderer drawn again
    const lost = (/** @type {Event} */ e) => {
      e.preventDefault()
      this.lost = true
    }
    const restored = () => {
      this.lost = false
      this.programs.reset()
      this.resources.reset()
      this.passes?.reset()
      this.picker?.reset()
      this.bloom?.reset()
      for (const user of this.users) user.onReady?.()
    }
    canvas.addEventListener('webglcontextlost', lost)
    canvas.addEventListener('webglcontextrestored', restored)
    this.#removeListeners = () => {
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('webglcontextrestored', restored)
    }
    // ...or, let go of long enough ago that it was lost, asks for it back: drawing waits until the
    // browser restores it, then goes ahead as after any lost context
    if (before && gl.isContextLost()) {
      this.lost = true
      before.lose?.restoreContext()
    }
  }

  /** The page's shared context, made on first use. @returns {GLContext} */
  static shared() {
    if (!shared) {
      const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(1, 1)
      shared = new GLContext(canvas, { shared: true })
    }
    return shared
  }

  /**
   * Make the drawing buffer at least this big (a shared context draws each view into its corner).
   * It only grows, so views of different sizes don't reallocate it every frame.
   * @param {number} width @param {number} height
   */
  fit(width, height) {
    const c = this.canvas
    if (c.width >= width && c.height >= height) return
    // round up, so a canvas growing a pixel at a time doesn't reallocate each time
    c.width = Math.max(c.width, Math.ceil(width / 256) * 256)
    c.height = Math.max(c.height, Math.ceil(height / 256) * 256)
  }

  /**
   * The extra passes, once loaded; the first call that needs them starts loading them, and every
   * renderer on this context is told when they arrive.
   * @param {boolean} needed
   * @returns {Passes | null}
   */
  loadPasses(needed) {
    if (this.passes || !needed || this.#passesLoading) return this.passes
    this.#passesLoading = true
    import('./passes.js').then(({ Passes }) => {
      this.passes = new Passes(this.gl, this.programs, this.resources)
      for (const user of this.users) user.onReady?.()
    })
    return null
  }

  /**
   * Programs are compiling in the background: tell every renderer on this context when they are
   * all done, so it draws again with them.
   */
  whenCompiled() {
    if (this.#watchingCompiles) return
    this.#watchingCompiles = true
    const check = () => {
      if (this.lost || !this.users.size) {
        this.#watchingCompiles = false
        return
      }
      if (this.programs.compiling) {
        setTimeout(check, 4)
        return
      }
      this.#watchingCompiles = false
      for (const user of this.users) user.onReady?.()
    }
    setTimeout(check, 4)
  }

  /**
   * GPU picking, once loaded; the first call starts loading it, and every renderer on this context
   * is told when it arrives.
   * @returns {Picker | null}
   */
  loadPicker() {
    if (this.picker || this.#pickerLoading) return this.picker
    this.#pickerLoading = true
    import('./picking.js').then(({ Picker }) => {
      this.picker = new Picker(this.gl, this.programs, this.resources)
      for (const user of this.users) user.onReady?.()
    })
    return null
  }

  /**
   * Bloom, once loaded; the first call starts loading it, and every renderer on this context is
   * told when it arrives.
   * @returns {Bloom | null}
   */
  loadBloom() {
    if (this.bloom || this.#bloomLoading) return this.bloom
    this.#bloomLoading = true
    import('./bloom.js').then(({ Bloom }) => {
      this.bloom = new Bloom(this.gl, this.programs)
      for (const user of this.users) user.onReady?.()
    })
    return null
  }

  /**
   * A renderer is done with this context. Its scene's GPU copies are freed unless another renderer
   * still draws them; the last user frees everything, losing the context on purpose so the
   * browser reclaims it. A canvas's own context is lost a moment later rather than at once: a new
   * renderer on the same canvas before then - React's StrictMode mounts, disposes and mounts again
   * in one go - keeps the live context, as a canvas only ever has the one.
   * @param {ContextUser} user
   * @param {Scene} [scene] what the renderer drew
   */
  release(user, scene) {
    this.users.delete(user)
    if (scene) this.resources.release(user, scene)
    if (this.users.size) return
    this.programs.dispose()
    this.resources.reset()
    this.passes?.reset()
    this.bloom?.dispose()
    this.#removeListeners()
    const lose = this.gl.getExtension('WEBGL_lose_context')
    if (this === shared) {
      lose?.loseContext()
      shared = null
      return
    }
    released.set(this.canvas, { lose, timer: setTimeout(() => lose?.loseContext()) })
  }
}

/**
 * Canvases whose last renderer let go of them, with the timer that will lose the context and the
 * extension that does it (kept, as a lost context gives out no extensions to restore it with).
 * @type {WeakMap<object, { lose: any, timer: ReturnType<typeof setTimeout> }>}
 */
const released = new WeakMap()
