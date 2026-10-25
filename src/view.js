import { collect } from './frame.js'
import { LabelLayer } from './labels.js'
import { OrbitControl } from './OrbitControl.js'
import { Raycaster } from './Raycaster.js'
import { Box3 } from './value/Box3.js'
import { Vec3 } from './value/Vec3.js'
import { Scene } from './scene/Scene.js'
import { Camera, PerspectiveCamera } from './scene/cameras.js'
import { DirectionalLight, HemisphereLight } from './scene/lights.js'
import { WebGLRenderer } from './webgl/WebGLRenderer.js'
import { checkOptions, describe, fail } from './validate.js'

/** @import { OrbitOptions } from './OrbitControl.js' */
/** @import { Hit } from './Raycaster.js' */
/** @import { FrameDescription } from './frame.js' */
/** @import { ToneMapping } from './webgl/WebGLRenderer.js' */
/** @import { CameraOptions } from './scene/cameras.js' */
/** @import { ColorInput } from './types.js' */
/** @import { Node } from './scene/Node.js' */

/**
 * @typedef {object} ViewOptions
 * @property {HTMLCanvasElement | string} [canvas] element or CSS selector; default: a new canvas filling the window
 * @property {Scene} [scene] default: a new Scene (from a description: create({ type: 'scene', ... }))
 * @property {Camera | (CameraOptions & { fov?: number })} [camera] a camera, or PerspectiveCamera options
 * @property {boolean | OrbitOptions} [orbit] mouse/touch camera control (default false)
 * @property {ColorInput | null} [background] shortcut for scene.background
 * @property {number} [pixelRatio] default min(devicePixelRatio, 2)
 * @property {boolean} [antialias] (default true)
 * @property {ToneMapping} [toneMapping] 'neutral' keeps colours true (default), 'aces' is filmic, 'none' clips
 * @property {number} [exposure] (default 1)
 * @property {boolean} [autoLight] light a scene that has no lights, with one console note (default true)
 * @property {number} [maxDelta] longest frame step in seconds, so a background tab doesn't jump (default 0.1)
 */

const OPTIONS = ['canvas', 'scene', 'camera', 'orbit', 'background', 'pixelRatio', 'antialias', 'toneMapping',
  'exposure', 'autoLight', 'maxDelta']
const HINTS = {
  renderer: 'the View makes its renderer - read it from view.renderer',
  controls: "use orbit: true (or orbit options); the control is then view.controls",
  container: "use canvas: an element or selector (a full-window canvas is made when omitted)",
}

/**
 * The one object most apps touch: it owns the canvas, renderer, camera, controls and loop.
 *
 *     const view = new View({ canvas: '#c', orbit: true })
 *     const cube = view.scene.add(new Mesh({ geometry: box(2), material: { color: 'orange' } }))
 *     view.start((dt) => cube.rotateY(0.6 * dt))
 */
export class View {
  /** @type {HTMLCanvasElement} */ canvas
  /** @type {Scene} */ scene
  /** @type {Camera} */ #camera
  /** @type {WebGLRenderer} */ renderer
  /** @type {OrbitControl | null} */ controls = null
  /** Seconds the loop has run. */
  time = 0
  /** Light the scene when it has none. */
  autoLight = true
  maxDelta = 0.1
  /** The last frame drawn. @type {FrameDescription | null} */
  lastFrame = null

  /** @type {((dt: number, t: number) => void) | null} */ #onFrame = null
  #running = false
  #rafId = 0
  #lastTime = 0
  #width = 0
  #height = 0
  #pixelRatio = 1
  #explicitPixelRatio = false
  /** @type {ResizeObserver | null} */ #resizeObserver = null
  #labels
  // used for scenes without lights; never added to the scene itself
  #autoSky = new HemisphereLight({ sky: '#ffffff', ground: '#444444', intensity: 0.5 })
  #autoSun = new DirectionalLight({ direction: [-0.5, -1, -0.6], intensity: 1.5 })
  #noted = false

  /** @param {ViewOptions} [options] */
  constructor(options = {}) {
    checkOptions('View', options, OPTIONS, HINTS)
    this.canvas = resolveCanvas(options.canvas)

    if (options.scene === undefined) this.scene = new Scene()
    else if (options.scene instanceof Scene) this.scene = options.scene
    else fail('View', `'scene' must be a Scene${options.scene && typeof options.scene === 'object' && 'type' in options.scene ? " - build one from a description with create({ type: 'scene', ... })" : `, got ${describe(options.scene)}`}`)
    if (options.background !== undefined) this.scene.background = options.background

    if (options.camera instanceof Camera) this.#camera = options.camera
    else this.#camera = new PerspectiveCamera({ position: [0, 1.5, 6], target: [0, 0, 0], ...options.camera })

    this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: options.antialias, toneMapping: options.toneMapping, exposure: options.exposure })
    if (options.autoLight !== undefined) this.autoLight = !!options.autoLight
    if (options.maxDelta !== undefined) this.maxDelta = options.maxDelta
    if (options.pixelRatio !== undefined) {
      this.#pixelRatio = options.pixelRatio
      this.#explicitPixelRatio = true
    }
    if (options.orbit) this.controls = new OrbitControl(this.camera, this.canvas, options.orbit === true ? {} : options.orbit)
    this.#labels = new LabelLayer(this.canvas)

    this.resize()
    if (typeof ResizeObserver !== 'undefined') {
      this.#resizeObserver = new ResizeObserver(() => {
        this.resize()
        // keep showing the scene while the window is dragged, even when the loop isn't running
        if (!this.#running) this.render()
      })
      this.#resizeObserver.observe(this.canvas)
    }
  }

  /** The camera drawn from. Setting another keeps the aspect, and the orbit control moves over to it. @returns {Camera} */
  get camera() { return this.#camera }
  set camera(camera) {
    if (!(camera instanceof Camera)) fail('View', `'camera' must be a camera, got ${describe(camera)}`)
    this.#camera = camera
    if (this.#height) camera.aspect = this.#width / this.#height
    if (this.controls) {
      // the control orbits the camera's target, so give it one where the old camera was looking
      camera.target ??= this.controls.target.clone()
      this.controls.camera = camera
    }
  }

  /** Canvas width in CSS pixels. */
  get width() { return this.#width }
  /** Canvas height in CSS pixels. */
  get height() { return this.#height }

  /** Resolves when every texture in the scene has loaded. @returns {Promise<void>} */
  get ready() {
    return this.scene.ready
  }

  /**
   * Run the loop: fn(dt, t) is called each frame (seconds), then the scene updates and draws.
   * @param {(dt: number, t: number) => void} [fn]
   * @returns {this}
   */
  start(fn) {
    if (fn) this.#onFrame = fn
    if (this.#running) return this
    this.#running = true
    this.#lastTime = 0
    const tick = (now) => {
      if (!this.#running) return
      const dt = this.#lastTime ? Math.min(this.maxDelta, (now - this.#lastTime) / 1000) : 0
      this.#lastTime = now
      this.step(dt)
      this.#rafId = requestAnimationFrame(tick)
    }
    this.#rafId = requestAnimationFrame(tick)
    return this
  }

  /** @returns {this} */
  stop() {
    this.#running = false
    cancelAnimationFrame(this.#rafId)
    return this
  }

  /** Is the loop running? */
  get running() {
    return this.#running
  }

  /**
   * Advance exactly one frame by dt seconds and draw it. Deterministic - for tests, screenshots
   * and stepping a paused scene.
   * @param {number} dt
   * @returns {FrameDescription}
   */
  step(dt) {
    this.time += dt
    this.#onFrame?.(dt, this.time)
    this.controls?.update(dt)
    this.scene.update(dt, this.time)
    return this.render()
  }

  /** Draw the current state without advancing time. @returns {FrameDescription} */
  render() {
    this.scene.updateWorldTree()
    const frame = collect(this.scene, this.camera)
    if (this.autoLight && frame.lights.length === 0) this.#addAutoLights(frame)
    this.renderer.renderFrame(frame)
    this.#labels.update(frame.labels)
    this.lastFrame = frame
    return frame
  }

  /** Match the drawing buffer and camera to the canvas's displayed size. Automatic; call after manual changes. */
  resize() {
    const w = this.canvas.clientWidth || this.canvas.width || 1
    const h = this.canvas.clientHeight || this.canvas.height || 1
    if (!this.#explicitPixelRatio) this.#pixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2)
    this.#width = w
    this.#height = h
    this.renderer.setSize(w, h, this.#pixelRatio)
    this.camera.aspect = w / h
  }

  /**
   * Move the camera so a node (or box) fills the view, keeping the viewing direction. The orbit
   * target moves to its centre.
   * @param {Node | Box3} target
   * @param {{ padding?: number }} [options] 1 is a tight fit (default 1.2)
   * @returns {this}
   */
  frame(target, { padding = 1.2 } = {}) {
    const box = target instanceof Box3 ? target : target.bounds
    if (box.isEmpty()) return this
    const center = box.getCenter()
    const radius = Math.max(box.getRadius(), 1e-3)
    const cam = /** @type {any} */ (this.camera)
    const direction = cam.position.clone().sub(cam.target ?? new Vec3()).normalize()
    if (direction.len() === 0) direction.set(0, 0.3, 1).normalize()
    if (cam.constructor.type === 'orthographic-camera') {
      cam.height = radius * 2 * padding
      cam.position.copy(center).add(direction.clone().multiplyScalar(radius * 4))
    } else {
      const fit = Math.min(cam.fov, cam.fov * cam.aspect) * Math.PI / 360
      const distance = radius / Math.sin(fit) * padding
      cam.position.copy(center).add(direction.clone().multiplyScalar(distance))
      // keep the near/far range sensible for the model's size
      cam.near = Math.max(1e-3, distance / 1000)
      cam.far = Math.max(cam.far, distance * 10)
    }
    cam.target = center
    return this
  }

  /**
   * The nearest hit under a canvas position - CSS pixels from the canvas's top left, or a pointer event.
   * @param {number | MouseEvent} x
   * @param {number} [y]
   * @returns {Hit | null}
   */
  pick(x, y) {
    return this.pickAll(x, y)[0] ?? null
  }

  /** Every hit under a canvas position, nearest first. @param {number | MouseEvent} x @param {number} [y] @returns {Hit[]} */
  pickAll(x, y) {
    if (typeof x === 'object') {
      const rect = this.canvas.getBoundingClientRect()
      y = x.clientY - rect.top
      x = x.clientX - rect.left
    }
    const ndc = [(x / this.#width) * 2 - 1, 1 - (/** @type {number} */ (y) / this.#height) * 2]
    const raycaster = new Raycaster().setFromCamera(ndc, this.camera)
    // a few pixels' tolerance for points and lines, as world units at the target's distance
    const cam = /** @type {any} */ (this.camera)
    const distance = cam.position.distanceTo(cam.target ?? [0, 0, 0])
    const worldPerPixel = cam.constructor.type === 'orthographic-camera'
      ? cam.height / this.#height
      : 2 * distance * Math.tan(cam.fov * Math.PI / 360) / this.#height
    raycaster.threshold = 4 * worldPerPixel
    return raycaster.intersect(this.scene)
  }

  /** Stop the loop, remove listeners and labels, and free GPU resources. */
  dispose() {
    this.stop()
    this.#resizeObserver?.disconnect()
    this.controls?.dispose()
    this.#labels.dispose()
    this.renderer.dispose()
  }

  /** @param {FrameDescription} frame */
  #addAutoLights(frame) {
    if (!this.#noted) {
      this.#noted = true
      console.info('phoria2: the scene has no lights, so the View is lighting it (autoLight: false turns this off)')
    }
    const hemi = this.#autoSky, sun = this.#autoSun
    frame.lights.push(
      { kind: 'hemisphere', node: hemi, color: hemi.sky, ground: hemi.ground, intensity: hemi.intensity },
      { kind: 'directional', node: sun, color: sun.color, intensity: sun.intensity, direction: sun.worldDirection })
  }
}

/** @param {HTMLCanvasElement | string | undefined} canvas @returns {HTMLCanvasElement} */
function resolveCanvas(canvas) {
  if (canvas === undefined) {
    const c = document.createElement('canvas')
    Object.assign(c.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', display: 'block' })
    document.body.append(c)
    return c
  }
  if (typeof canvas === 'string') {
    const el = document.querySelector(canvas)
    if (!el) fail('View', `canvas '${canvas}' not found`)
    if (!(el instanceof HTMLCanvasElement)) fail('View', `'${canvas}' is a <${el.tagName.toLowerCase()}>, not a <canvas>`)
    return el
  }
  if (!(canvas instanceof HTMLCanvasElement)) fail('View', `'canvas' must be a <canvas> element or a selector, got ${describe(canvas)}`)
  return canvas
}
