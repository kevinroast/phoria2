import { collect, toScreen } from './frame.js'
import { LabelLayer } from './labels.js'
import { DRAG_START, OrbitControl } from './OrbitControl.js'
import { cameraPreset, fitPoints, framingScale, presetDirection } from './presets.js'
import { EASES } from './ease.js'
import { Raycaster } from './Raycaster.js'
import { ChangeWatch } from './watch.js'
import { Box3 } from './value/Box3.js'
import { Color } from './value/Color.js'
import { Vec3 } from './value/Vec3.js'
import { Mat4 } from './value/Mat4.js'
import { Scene } from './scene/Scene.js'
import { Camera, PerspectiveCamera } from './scene/cameras.js'
import { DirectionalLight, HemisphereLight } from './scene/lights.js'
import { WebGLRenderer } from './webgl/WebGLRenderer.js'
import { checkOneOf, checkOptions, checkRange, describe, fail, warnOnce } from './validate.js'

/** @import { OrbitOptions } from './OrbitControl.js' */
/** @import { CameraPreset, FramingKeep } from './presets.js' */
/** @import { Hit } from './Raycaster.js' */
/** @import { FrameDescription, FrameHighlight } from './frame.js' */
/** @import { Texture, TextureOptions } from './material/Texture.js' */
/** @import { LabelStats } from './labels.js' */
/** @import { ImageOptions } from './snapshot.js' */
/** @import { Tooltip, TooltipContent } from './tooltip.js' */
/** @import { ToneMapping, BloomOptions } from './webgl/WebGLRenderer.js' */
/** @import { CameraOptions } from './scene/cameras.js' */
/** @import { ColorInput, Vec3Input } from './types.js' */
/** @import { Node } from './scene/Node.js' */

/**
 * @typedef {'auto' | 'always' | 'manual'} RenderMode
 * auto: draw when something visible changed (checked cheaply each frame); always: every frame;
 * manual: only when view.render() or view.invalidate() is called.
 */

/**
 * @typedef {object} ViewOptions
 * @property {HTMLCanvasElement | string} [canvas] element or CSS selector; default: a new canvas filling the window
 * @property {Scene} [scene] default: a new Scene (from a description: create({ type: 'scene', ... }))
 * @property {Camera | CameraPreset | (CameraOptions & { fov?: number })} [camera] a camera, a preset
 *   ('perspective', 'isometric', 'top', 'front', 'side' - fitted to the scene on the first frame), or
 *   PerspectiveCamera options. Default: 'perspective' - a three-quarter view from the front right
 *   and above, fitted to the scene
 * @property {boolean | OrbitOptions} [orbit] mouse/touch camera control (default false)
 * @property {ColorInput | Texture | TextureOptions | null} [background] shortcut for scene.background: a colour or a panorama
 * @property {RenderMode} [renderMode] when to draw (default 'auto': only when something changed)
 * @property {FramingKeep | { keep?: FramingKeep, aspect?: number }} [framing] what stays in view when the canvas
 *   changes shape: 'height' (default - the width varies), 'width', or 'both' (nothing framed is ever cut off); or
 *   { keep, aspect }, where aspect is the width / height the camera was set up for (default: the canvas's shape
 *   when the camera was set or framed)
 * @property {ColorInput | null} [highlight] tint whatever is under the pointer with this colour (default none)
 * @property {(hit: Hit) => TooltipContent} [tooltip] what to show for the thing under the pointer - see tooltip()
 * @property {number} [pixelRatio] default min(devicePixelRatio, 2)
 * @property {boolean} [antialias] (default true)
 * @property {'auto' | 'own' | 'shared'} [context] which WebGL context draws it: 'own' gives the canvas one of
 *   its own; 'shared' draws with the page's one shared context and copies the picture over, so a page can hold
 *   any number of views (browsers allow about 16 live contexts). 'auto' (default): own for the first four
 *   views on a page, shared after that
 * @property {ToneMapping} [toneMapping] 'neutral' keeps colours true (default), 'aces' is filmic, 'none' clips
 * @property {number} [exposure] (default 1)
 * @property {boolean | BloomOptions} [bloom] glow round the bright parts of the picture - emissive materials,
 *   additive points and lines (default off). true for the defaults, or { strength, radius, threshold }
 * @property {boolean} [autoLight] light a scene that has no lights, with one console note (default true)
 * @property {number} [maxDelta] longest frame step in seconds, so a background tab doesn't jump (default 0.1)
 */

/** @typedef {'click' | 'hover'} ViewEvent */
/** @typedef {(hit: Hit | null, event: PointerEvent | MouseEvent | null) => void} ViewHandler */

const OPTIONS = ['canvas', 'scene', 'camera', 'orbit', 'background', 'renderMode', 'framing', 'highlight', 'tooltip', 'pixelRatio',
  'antialias', 'context', 'toneMapping', 'exposure', 'bloom', 'autoLight', 'maxDelta']
const FRAMING_OPTIONS = ['keep', 'aspect']
const HINTS = {
  renderer: 'the View makes its renderer - read it from view.renderer',
  controls: "use orbit: true (or orbit options); the control is then view.controls",
  container: "use canvas: an element or selector (a full-window canvas is made when omitted)",
  onClick: "use view.on('click', (hit) => ...)",
  onHover: "use view.on('hover', (hit) => ...)",
  frameloop: "use renderMode: 'auto' | 'always' | 'manual'",
  keep: "use framing: { keep: 'width' | 'height' | 'both' }",
  fit: "use framing: { keep: 'both' } to keep everything framed in view as the canvas changes shape",
  aspect: "the canvas sets the aspect; framing: { aspect } says which shape the camera was set up for",
}
const EVENT_HINTS = {
  mouseover: 'hover', mouseenter: 'hover', mousemove: 'hover', pointermove: 'hover', pointerover: 'hover', pointerenter: 'hover',
  mouseleave: 'hover', pointerleave: 'hover', tap: 'click', pick: 'click', select: 'click', pointerdown: 'click', mousedown: 'click',
}
// how far the highlight colour is mixed in
const HIGHLIGHT_AMOUNT = 0.45
// views that get a WebGL context of their own before 'auto' starts sharing one
const OWN_CONTEXTS = 4
// above this many things to test (instances, triangles, points, segments), picking goes to the
// GPU; below it, rays on the CPU are quicker than a GPU round trip
const GPU_PICKING = 5000
let ownContexts = 0

/**
 * The one object most apps touch: it owns the canvas, renderer, camera, controls, loop and pointer
 * interaction. It draws only when something changed, so an idle view costs almost nothing.
 *
 *     const view = new View({ canvas: '#c', orbit: true })
 *     const cube = view.scene.add(new Mesh({ geometry: box(2), material: { color: 'orange' } }))
 *     view.on('click', (hit) => console.log(hit?.node))
 *     view.start((dt) => cube.rotateY(0.6 * dt))
 */
export class View {
  /** The options it takes, and hints for names people reach for instead. */
  static OPTIONS = OPTIONS
  static HINTS = HINTS
  /** What framing: { ... } takes. */
  static FRAMING_OPTIONS = FRAMING_OPTIONS
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
  /** When to draw. @type {RenderMode} */
  renderMode = 'auto'
  /** The last frame drawn. @type {FrameDescription | null} */
  lastFrame = null

  /** @type {((dt: number, t: number) => void) | null} */ #onFrame = null
  // time runs from the start, so update handlers (transitions, particles) work without start()
  #running = true
  #disposed = false
  #ownContext = false
  #ownCanvas = false
  #rafId = 0
  #lastTime = 0
  #dirty = true
  #onScreen = true
  #width = 0
  #height = 0
  #pixelRatio = 1
  #explicitPixelRatio = false
  #autoFrame = false
  // where a preset camera started, so fitting it on the first frame never undoes the app's own move
  /** @type {number[] | null} */ #autoFrameFrom = null
  // framing kept as the canvas changes shape: what to keep, the shape it was set for, and the
  // scale applied so far, so further changes stay relative (zooming by hand still works)
  /** @type {FramingKeep} */ #keep = 'height'
  #designed = 0
  #applied = 1
  #watch = new ChangeWatch()
  /** @type {(() => void)[]} */ #cleanup = []
  #labels
  /** @type {LabelStats | null} */ #labelStats = null
  // pointer interaction
  /** @type {{ click: Set<ViewHandler>, hover: Set<ViewHandler> }} */ #handlers = { click: new Set(), hover: new Set() }
  // the tooltip's code loads when first asked for, so apps without one don't carry it
  /** @type {Tooltip | null} */ #tooltip = null
  /** @type {((hit: Hit) => TooltipContent) | null} */ #tooltipContent = null
  #tooltipClass = ''
  #tooltipLoading = false
  /** @type {Color | null} */ #highlight = null
  /** @type {{ x: number, y: number, clientX: number, clientY: number, event: PointerEvent } | null} */ #pointer = null
  #pickPending = false
  // a hover pick is out on the GPU
  #hoverBusy = false
  #dragging = false
  /**
   * A node being dragged: from the press, until the pointer lets go.
   * @type {{ drag: import('./scene/Node.js').Drag, id: number, x: number, y: number, press: import('./value/Ray.js').Ray, started: boolean } | null}
   */
  #drag = null
  /** The orbit's pointer handlers, once it has handed the pointer to the view. @type {ReturnType<OrbitControl['handOverPointer']> | null} */
  #orbitPointer = null
  /** The press in progress, and whether it has moved far enough to be a drag rather than a click. @type {{ id: number, x: number, y: number, moved: boolean } | null} */
  #press = null
  /** @type {Hit | null} */ #hovered = null
  /** The camera on its way to where frame() put it: from and to, and how far along. @type {Flight | null} */
  #flight = null
  /** A label the pointer is on, as a hit on what it labels - the canvas can't see the pointer there. @type {Hit | null} */
  #labelHover = null
  // used for scenes without lights; never added to the scene itself
  #autoSky = new HemisphereLight({ sky: '#ffffff', ground: '#444444', intensity: 0.5 })
  #autoSun = new DirectionalLight({ direction: [-0.5, -1, -0.6], intensity: 1.5 })
  #noted = false

  /** @param {ViewOptions} [options] */
  constructor(options = {}) {
    checkOptions('View', options, OPTIONS, HINTS)
    this.canvas = resolveCanvas(options.canvas)
    // one it made itself goes with it
    this.#ownCanvas = options.canvas === undefined

    if (options.scene === undefined) this.scene = new Scene()
    else if (options.scene instanceof Scene) this.scene = options.scene
    else fail('View', `'scene' must be a Scene${options.scene && typeof options.scene === 'object' && 'type' in options.scene ? " - build one from a description with create({ type: 'scene', ... })" : `, got ${describe(options.scene)}`}`)
    if (options.background !== undefined) this.scene.background = options.background

    if (options.camera instanceof Camera) {
      this.#camera = options.camera
    } else if (typeof options.camera === 'string') {
      this.#camera = cameraPreset(options.camera)
      this.#autoFrame = true
    } else if (options.camera === undefined) {
      // a three-quarter view, fitted to whatever the scene holds on its first frame
      this.#camera = cameraPreset('perspective')
      this.#autoFrame = true
    } else {
      this.#camera = new PerspectiveCamera({ position: [0, 1.5, 6], target: [0, 0, 0], ...options.camera })
    }
    if (this.#autoFrame) this.#autoFrameFrom = cameraPlace(this.#camera)

    const context = options.context === undefined ? 'auto' : checkOneOf('View', 'context', options.context, ['auto', 'own', 'shared'])
    // the renderer checks these too; checked here, the error names the View
    if (options.exposure !== undefined) checkRange('View', 'exposure', options.exposure, 0)
    const shared = context === 'shared' || (context === 'auto' && ownContexts >= OWN_CONTEXTS)
    this.renderer = new WebGLRenderer({ canvas: this.canvas, shared, antialias: options.antialias, toneMapping: options.toneMapping, exposure: options.exposure, bloom: options.bloom })
    if (!shared) {
      this.#ownContext = true
      ownContexts++
    }
    // shadows and HDR environments load their code on first use, then want another frame
    this.renderer.onReady = () => {
      // picking may have just arrived, so look under the pointer again
      this.#pickPending = true
      this.invalidate()
    }
    if (options.autoLight !== undefined) this.autoLight = !!options.autoLight
    if (options.maxDelta !== undefined) this.maxDelta = checkRange('View', 'maxDelta', options.maxDelta, 0, Infinity, { above: true })
    if (options.renderMode !== undefined) this.renderMode = checkOneOf('View', 'renderMode', options.renderMode, ['auto', 'always', 'manual'])
    if (options.pixelRatio !== undefined) {
      this.#pixelRatio = checkRange('View', 'pixelRatio', options.pixelRatio, 0, Infinity, { above: true })
      this.#explicitPixelRatio = true
    }
    if (options.orbit !== undefined && options.orbit !== false && options.orbit !== true &&
      (typeof options.orbit !== 'object' || Array.isArray(options.orbit) || options.orbit === null)) {
      fail('View', `'orbit' must be true, false or orbit options such as { autoRotate: true }, got ${describe(options.orbit)}`)
    }
    if (options.orbit) {
      const orbit = options.orbit === true ? {} : options.orbit
      // a plan view pans like a map unless told otherwise
      const mode = orbit.mode ?? (options.camera === 'top' ? 'map' : undefined)
      this.controls = new OrbitControl(this.camera, this.canvas, mode ? { ...orbit, mode } : orbit)
      // the view owns the pointer and gives the orbit the presses that aren't drags of a node
      this.#orbitPointer = this.controls.handOverPointer()
    }
    if (options.highlight !== undefined) this.#setHighlight(options.highlight)
    if (options.tooltip !== undefined) this.tooltip(options.tooltip)
    this.#labels = new LabelLayer(this.canvas, {
      interactive: (label) => labelHandlers(label, 'click').length > 0 || labelHandlers(label, 'hover').length > 0,
      on: (type, label, e) => this.#labelPointer(type, label, e),
    })

    if (options.framing !== undefined) {
      // 'both' is short for { keep: 'both' }
      const f = typeof options.framing === 'string' ? { keep: options.framing } : options.framing
      checkOptions('View', f, FRAMING_OPTIONS, {}, 'framing')
      if (f.keep !== undefined) this.#keep = checkOneOf('View', 'framing.keep', f.keep, ['height', 'width', 'both'])
      if (f.aspect !== undefined) {
        if (!(f.aspect > 0)) fail('View', `framing.aspect is a width / height above 0, got ${describe(f.aspect)}`)
        this.#designed = f.aspect
      }
    }
    this.resize()
    this.#listen()
    this.#schedule()
  }

  /**
   * The camera drawn from. Set another camera, or a preset name to switch view - the orbit control
   * moves over, and a preset keeps looking at the same point, fitted to the scene.
   * @returns {Camera}
   */
  get camera() { return this.#camera }
  /** @param {Camera | CameraPreset} camera */
  set camera(camera) {
    if (typeof camera === 'string') {
      const old = /** @type {any} */ (this.#camera)
      const target = old.target ?? new Vec3()
      camera = cameraPreset(camera, { target, distance: Math.max(1e-3, old.position.distanceTo(target)) })
      this.#autoFrame = true
    } else {
      // a camera given explicitly stays where it was put, as one given to the constructor does
      this.#autoFrame = false
    }
    if (!(camera instanceof Camera)) fail('View', `'camera' must be a camera or a preset name, got ${describe(camera)}`)
    this.#flight = null
    this.#camera = camera
    if (this.#height) camera.aspect = this.#width / this.#height
    // a new camera is framed for the canvas as it is now
    this.#designed = camera.aspect
    this.#applied = 1
    if (this.controls) {
      // the control orbits the camera's target, so give it one where the old camera was looking
      camera.target ??= this.controls.target.clone()
      this.controls.camera = camera
    }
    if (this.#autoFrame) this.#autoFrameFrom = cameraPlace(camera)
    this.invalidate()
  }

  /**
   * Glow round the bright parts of the picture: null for none, or its settings. Set true, false or
   * { strength, radius, threshold }. (After changing its numbers in place, call invalidate().)
   * @returns {Required<BloomOptions> | null}
   */
  get bloom() { return this.renderer.bloom }
  /** @param {boolean | BloomOptions | null} v */
  set bloom(v) {
    this.renderer.bloom = v
    this.invalidate()
  }

  /** The colour mixed into whatever is under the pointer, or null for none. @returns {Color | null} */
  get highlight() { return this.#highlight }
  /** @param {ColorInput | null} v */
  set highlight(v) { this.#setHighlight(v) }

  /** @param {ColorInput | null} v */
  #setHighlight(v) {
    this.#highlight = v == null ? null : Color.fromInput(v, 'View')
    this.#pickPending = true
    this.invalidate()
  }

  /** Canvas width in CSS pixels. */
  get width() { return this.#width }
  /** Canvas height in CSS pixels. */
  get height() { return this.#height }

  /** Resolves when every texture in the scene has loaded. @returns {Promise<void>} */
  get ready() {
    return this.scene.ready
  }

  /** The thing under the pointer, as of the last pointer move or redraw. @returns {Hit | null} */
  get hovered() {
    return this.#hovered
  }

  /**
   * A layer over the canvas for HTML of your own - a title, a key, buttons. It tracks the canvas and
   * doesn't take pointer events itself; give children `pointer-events: auto` to make them clickable.
   * @returns {HTMLDivElement}
   */
  get overlay() {
    return this.#labels.root
  }

  /**
   * Call fn(dt, t) every frame (seconds), for app-level animation, and resume time if it was
   * stopped. Time - and the scene's update handlers - run from the start anyway; in 'auto' mode a
   * frame is still only drawn when something changed.
   * @param {(dt: number, t: number) => void} [fn]
   * @returns {this}
   */
  start(fn) {
    if (fn) this.#onFrame = fn
    if (!this.#running) {
      this.#running = true
      this.#lastTime = 0
    }
    this.#schedule()
    return this
  }

  /** Freeze time: the frame function and update handlers stop until start(). The view still redraws on changes. @returns {this} */
  stop() {
    this.#running = false
    return this
  }

  /** Is time running (not stopped)? */
  get running() {
    return this.#running
  }

  /**
   * Draw on the next frame even if nothing seems to have changed - after editing data the View
   * can't see, such as geometry arrays without needsUpdate(). Needed in 'manual' mode.
   * @returns {this}
   */
  invalidate() {
    this.#dirty = true
    this.#schedule()
    return this
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
    // the same order as the live loop, so a stepped frame is the frame a user sees
    this.scene.update(dt, this.time)
    this.#updateControls(dt)
    return this.#render(true)
  }

  /**
   * Move the camera by its control: auto-rotation and the glide after a drag. That isn't the app
   * moving the camera, so a camera still waiting to be fitted to the scene stays waiting.
   * @param {number} dt
   */
  #updateControls(dt) {
    if (this.#flight) return this.#fly(dt)
    if (!this.controls) return
    const waiting = this.#autoFrame && samePlace(cameraPlace(this.camera), this.#autoFrameFrom)
    this.controls.update(dt)
    if (waiting) this.#autoFrameFrom = cameraPlace(this.camera)
  }

  /**
   * Draw the current state now, without advancing time. Shaders compile in the background on the
   * first frames, and what is still compiling appears a frame or two later.
   * @returns {FrameDescription}
   */
  render() {
    return this.#render(false)
  }

  /** @param {boolean} wait wait for shaders, for a complete frame (step, toImage) */
  #render(wait) {
    if (this.#autoFrame) {
      // fitted to the canvas as laid out now: a page still being built (a grid of tiles filling up)
      // can change its shape before the browser reports the resize, which comes after this frame
      this.resize()
      const bounds = this.scene.bounds
      // the app moved the camera itself: leave it where it put it
      if (!samePlace(cameraPlace(this.camera), this.#autoFrameFrom)) this.#autoFrame = false
      // what is drawn from the preset's direction, not every candidate label set
      else if (!bounds.isEmpty()) this.frame(this.scene)
    }
    this.scene.updateWorldTree()
    const frame = collect(this.scene, this.camera)
    if (this.autoLight && frame.lights.length === 0) this.#addAutoLights(frame)
    frame.highlight = this.#highlightFor(this.#hovered)
    this.#occlude(frame)
    this.renderer.renderFrame(frame, { wait })
    this.#labelStats = this.#labels.update(frame.labels, frame.overlays)
    // a node with its own tooltip needs the tooltip's code
    if (frame.tooltips && !this.#tooltip) this.#loadTooltip()
    this.lastFrame = frame
    this.#dirty = false
    // remember what was drawn - including what drawing changed, such as fitting the camera - so
    // the next frame compares against it and doesn't draw the same picture again
    if (this.renderMode === 'auto') this.#watch.changed(this.scene, this.camera)
    // things may have moved under a still pointer
    if (this.#pointer && this.#needsHover()) this.#pickPending = true
    return frame
  }

  /** Match the drawing buffer and camera to the canvas's displayed size. Automatic; call after manual changes. */
  resize() {
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight
    // hidden (display: none, a closed tab): keep the size it had, and pick up where it was when shown
    if ((!cw || !ch) && this.#width) return
    // a canvas sized only by its width and height attributes grows with every buffer it is given - at a
    // pixel ratio of 2, without end. Seen growing to exactly the buffer just set, it is held at its size
    if (this.#width && this.#pixelRatio !== 1 && cw === Math.round(this.#width * this.#pixelRatio) && ch === Math.round(this.#height * this.#pixelRatio)) {
      this.canvas.style.width = `${this.#width}px`
      this.canvas.style.height = `${this.#height}px`
      return
    }
    const w = cw || this.canvas.width || 1
    const h = ch || this.canvas.height || 1
    if (!this.#explicitPixelRatio) this.#pixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2)
    this.#width = w
    this.#height = h
    this.renderer.setSize(w, h, this.#pixelRatio)
    this.camera.aspect = w / h
    // keeping the framing can move the camera; that isn't the app placing it, so a camera still
    // waiting to be fitted to the scene stays waiting
    const waiting = this.#autoFrame && samePlace(cameraPlace(this.camera), this.#autoFrameFrom)
    this.#keepFraming()
    if (waiting) this.#autoFrameFrom = cameraPlace(this.camera)
    this.#dirty = true
  }

  /**
   * Move the camera so a node, a box or (with no argument) the whole scene fills the view. The orbit
   * target moves to its centre. It keeps the viewing direction unless given one - a preset's name
   * ('perspective', 'top', 'front'...) or a vector from the target towards the camera - and with a
   * duration it glides there, as a tour or a Reset button wants.
   *
   *     view.frame(rack, { duration: 0.8 })                           // fly to the rack
   *     view.frame(undefined, { direction: 'perspective', duration: 0.6 }) // back to the start
   * @param {Node | Box3} [target] (default the scene)
   * @param {{ padding?: number, direction?: CameraPreset | Vec3Input, duration?: number }} [options] padding is
   *   the margin around it, as a fraction of its size: 0 is a tight fit, 0.2 (the default) leaves a fifth.
   *   duration is in seconds (default 0: straight there); a press or the wheel stops the glide
   * @returns {this}
   */
  frame(target = this.scene, { padding = 0.2, direction: towards, duration = 0 } = {}) {
    if (!(padding >= 0)) fail('View', `frame() padding is the margin around, as a fraction of the size (0.2 = 20%), got ${describe(padding)}`)
    if (padding >= 1) warnOnce(this, `frame() padding ${padding} leaves a margin of ${Math.round(padding * 100)}% - it is a fraction of the size (0.2 = 20%)`)
    checkRange('View', 'frame() duration', duration, 0)
    const cam = /** @type {any} */ (this.camera)
    const from = placeOf(cam)
    this.#flight = null
    const direction = towards === undefined ? cam.position.clone().sub(cam.target ?? new Vec3()).normalize()
      : typeof towards === 'string' ? presetDirection(/** @type {CameraPreset} */ (towards)) : Vec3.fromInput(towards, 'View').normalize()
    if (towards !== undefined && !(direction.len() > 0)) fail('View', `frame() direction is a preset name or a vector from the target towards the camera, got ${describe(towards)}`)
    if (direction.len() === 0) direction.set(0, 0.3, 1).normalize()
    const points = target instanceof Box3 ? corners(target) : this.#drawnPoints(target, direction)
    // an explicit frame replaces the preset camera's fit on the first frame
    this.#autoFrame = false
    if (!points.length) return this
    const ortho = cam.constructor.type === 'orthographic-camera'
    const { center, size } = fitPoints(points, direction, { aspect: cam.aspect, fov: ortho ? undefined : cam.fov, padding })
    const radius = Math.max(1e-3, ...points.map((p) => Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2])))
    if (ortho) {
      cam.height = size
      cam.position.copy(center).add(direction.clone().multiplyScalar(radius * 4))
      cam.far = Math.max(cam.far, radius * 10)
    } else {
      const distance = size
      cam.position.copy(center).add(direction.clone().multiplyScalar(distance))
      // keep the near/far range sensible for the model's size
      cam.near = Math.max(1e-3, distance / 1000)
      cam.far = Math.max(cam.far, distance * 10)
    }
    cam.target = center
    // framed for the canvas as it is now
    this.#designed = cam.aspect
    this.#applied = 1
    if (duration > 0) {
      // the camera starts where it was and glides there, frame by frame
      this.#flight = { from, to: placeOf(cam), time: 0, duration }
      setPlace(cam, from)
    }
    this.invalidate()
    return this
  }

  /**
   * One frame of a glide: round the target as it moves, closing the distance evenly, so the picture
   * turns and zooms rather than cutting through what is in view.
   * @param {number} dt
   */
  #fly(dt) {
    const f = /** @type {Flight} */ (this.#flight)
    f.time = Math.min(f.duration, f.time + dt)
    const e = EASES.inOut(f.time / f.duration)
    const cam = /** @type {any} */ (this.camera)
    const target = f.from.target.clone().lerp(f.to.target, e)
    const d0 = f.from.position.clone().sub(f.from.target), d1 = f.to.position.clone().sub(f.to.target)
    const r0 = d0.len() || 1e-6, r1 = d1.len() || 1e-6
    const way = turnBetween(d0.multiplyScalar(1 / r0), d1.multiplyScalar(1 / r1), e)
    setTarget(cam, target)
    cam.position.copy(target).add(way.multiplyScalar(r0 * (r1 / r0) ** e))
    if (f.to.height !== undefined) cam.height = f.from.height * (f.to.height / f.from.height) ** e
    if (f.time >= f.duration) {
      setPlace(cam, f.to)
      this.#flight = null
    }
    this.invalidate()
  }

  /**
   * The corners of each thing a node draws seen from along a direction - leaving out what a camera
   * there wouldn't show (hidden nodes, showFrom sets turned away), measured from where framing will
   * put the camera. All its bounds' corners when that leaves nothing.
   * @param {Node} node @param {Vec3} direction from the node towards the camera
   * @returns {number[][]}
   */
  #drawnPoints(node, direction) {
    const all = node.bounds
    if (all.isEmpty()) return []
    const cam = this.camera, at = cam.position.clone()
    cam.position.copy(all.getCenter()).add(direction.clone().multiplyScalar(Math.max(all.getRadius(), 1e-3) * 3))
    cam.updateWorld()
    const points = drawnPoints(node, cam)
    cam.position.copy(at)
    cam.updateWorld()
    return points.length ? points : corners(all)
  }

  /**
   * The nearest hit under a canvas position - CSS pixels from the canvas's top left, or a pointer
   * event. Found on the GPU from the last frame drawn (one pass, however many instances), then made
   * exact on the CPU; on the CPU alone until the picking code has loaded.
   * @param {number | MouseEvent} x
   * @param {number} [y]
   * @returns {Hit | null}
   */
  pick(x, y) {
    if (typeof x === 'object') {
      const rect = this.canvas.getBoundingClientRect()
      y = x.clientY - rect.top
      x = x.clientX - rect.left
    }
    const frame = this.#gpuFrame()
    const found = frame ? this.renderer.pick(frame, x, /** @type {number} */ (y)) : undefined
    if (found === undefined) return this.pickAll(x, y)[0] ?? null
    return found && this.#exact(found, frame)
  }

  /**
   * The ray from the camera through a canvas position - CSS pixels from its top left, or a pointer
   * event - in world space: for finding where the pointer is on a floor or any plane.
   *
   *     const ray = view.rayAt(event)
   *     const t = ray.intersectPlane([0, 1, 0], [0, 0, 0])
   *     if (t !== null) chair.position.copy(ray.at(t))
   * @param {number | MouseEvent} x
   * @param {number} [y]
   * @returns {import('./value/Ray.js').Ray}
   */
  rayAt(x, y) {
    if (typeof x === 'object') {
      const rect = this.canvas.getBoundingClientRect()
      y = x.clientY - rect.top
      x = x.clientX - rect.left
    }
    const ndc = [(x / (this.#width || 1)) * 2 - 1, 1 - (/** @type {number} */ (y) / (this.#height || 1)) * 2]
    return new Raycaster().setFromCamera(ndc, this.camera).ray
  }

  /** The last frame, when it is big enough that picking on the GPU pays. */
  #gpuFrame() {
    const frame = this.lastFrame
    if (!frame) return null
    let work = 0
    for (const { node, geometry, instances } of [...frame.opaque, ...frame.transparent]) {
      const mode = /** @type {any} */ (node).drawMode
      work += instances ? instances.count : mode === 'points' ? geometry.drawnVertices : mode === 'lines' ? geometry.drawnCount / 2 : geometry.drawnCount / 3
    }
    return work > GPU_PICKING ? frame : null
  }

  /**
   * A GPU hit made exact: the ray against just that instance, point or segment, for the point,
   * face, normal and uv.
   * @param {import('./webgl/picking.js').GPUHit} found @param {FrameDescription} frame
   * @returns {Hit}
   */
  #exact(found, frame) {
    const node = /** @type {any} */ (found.item.node)
    const raycaster = new Raycaster().setFromCamera(found.ndc, this.camera)
    const hit = raycaster.intersectElement(node, found.element)
    if (hit) return hit
    // the ray grazed an edge the GPU drew: place the hit at the depth the GPU found
    const inverse = new Mat4().copy(frame.camera.viewProjection).invert()
    const point = new Vec3(found.ndc[0], found.ndc[1], found.ndc[2]).applyMatrix4(inverse)
    const instanced = 'instanceMatrices' in node, element = found.element
    const indexed = instanced || node.drawMode !== 'triangles'
    return { node, point, distance: point.distanceTo(raycaster.ray.origin), normal: null, face: indexed && !instanced ? element : null,
      instance: instanced ? element : null, uv: null, datum: node.datumAt(indexed ? element : null) }
  }

  /**
   * Where a world position is on the canvas - CSS pixels from its top left - with its depth (0 at
   * the near plane, 1 at the far) and whether it's in view: for placing HTML of your own over the
   * scene, beside what it's about.
   *
   *     const { x, y } = view.project(cube.worldPosition)
   * @param {Vec3Input} point
   * @returns {{ x: number, y: number, depth: number, visible: boolean }}
   */
  project(point) {
    const { ndc: [x, y, z], visible } = toScreen(Vec3.fromInput(point, 'View'), this.#viewProjection())
    return { x: (x * 0.5 + 0.5) * this.#width, y: (0.5 - y * 0.5) * this.#height, depth: z * 0.5 + 0.5, visible }
  }

  /**
   * The rectangle on the canvas that a node, a box or (with no argument) the whole scene covers - CSS
   * pixels, from the corners of each thing the camera draws of it (as node.boundsFrom counts them).
   * Null when there's nothing there, or part of it is behind the camera.
   *
   *     const { left, top, width } = view.screenBounds(model)   // put a title above it
   * @param {Node | Box3} [target]
   * @returns {{ left: number, top: number, right: number, bottom: number, width: number, height: number } | null}
   */
  screenBounds(target = this.scene) {
    const points = target instanceof Box3 ? corners(target) : drawnPoints(target, this.camera)
    if (!points.length) return null
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
    for (const point of points) {
      const { x, y, depth } = this.project(point)
      if (!(depth >= 0 && depth <= 1)) return null
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
    return { left, top, right, bottom, width: right - left, height: bottom - top }
  }

  /** The camera's world to clip space matrix, up to date. @returns {Mat4} */
  #viewProjection() {
    const camera = this.camera
    camera.updateWorld()
    return new Mat4().multiplyMatrices(camera.projectionMatrix, camera.viewMatrix)
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
    this.scene.updateWorldTree()
    return raycaster.intersect(this.scene)
  }

  /**
   * Listen for clicks on, or hovering over, the scene. Handlers get the hit (with .node, .instance
   * and .datum) or null for empty space. 'hover' fires when the thing under the pointer changes,
   * including to null when it leaves. Returns a function that removes the handler.
   *
   *     view.on('click', (hit) => hit && select(hit.datum))
   * @param {ViewEvent} type
   * @param {ViewHandler} fn
   * @returns {() => void}
   */
  on(type, fn) {
    if (!(type in this.#handlers)) {
      const hint = EVENT_HINTS[type]
      if (hint) fail('View', `on('${type}') - use '${hint}'${hint === 'hover' ? ', which fires as the thing under the pointer changes (null when it leaves)' : ''}`)
      checkOneOf('View', 'event', type, ['click', 'hover'])
    }
    if (typeof fn !== 'function') fail('View', `on('${type}', fn) needs a function, got ${describe(fn)}`)
    const set = this.#handlers[type]
    set.add(fn)
    this.#pickPending = true
    return () => set.delete(fn)
  }

  /**
   * Show a tooltip by the pointer for whatever it is over. The function gets the hit and returns
   * text (new lines kept), an element, or { title, rows } - rows as { name: value } - or null for
   * none. Style it with the .phoria-tooltip class. Pass null to remove it.
   *
   *     view.tooltip((hit) => ({ title: hit.datum.name, rows: { Sales: hit.datum.sales } }))
   * @param {((hit: Hit) => TooltipContent) | null} content
   * @param {{ className?: string }} [options]
   * @returns {this}
   */
  tooltip(content, { className } = {}) {
    if (content !== null && typeof content !== 'function') fail('View', `tooltip() takes a function (hit) => text, or null, got ${describe(content)}`)
    this.#tooltipContent = content
    if (className !== undefined) this.#tooltipClass = className
    if (this.#tooltip) this.#tooltip.el.className = `phoria-tooltip${this.#tooltipClass ? ` ${this.#tooltipClass}` : ''}`
    if (content) this.#loadTooltip()
    this.#pickPending = true
    return this
  }

  // the tooltip's code loads when first needed, so apps without one don't carry it
  #loadTooltip() {
    if (this.#tooltipLoading) return
    this.#tooltipLoading = true
    import('./tooltip.js').then(({ Tooltip }) => {
      if (this.#disposed) return
      this.#tooltip = new Tooltip((hit) => this.#tooltipFor(hit)?.(hit), this.#tooltipClass)
      this.#pickPending = true
      this.#schedule()
    })
  }

  /** The nearest node tooltip above the hit, or the View's. @param {Hit} hit */
  #tooltipFor(hit) {
    for (let n = /** @type {any} */ (hit.node); n; n = n.parent) if (n.tooltip) return n.tooltip
    return this.#tooltipContent
  }

  /**
   * The current picture as an image file (PNG by default), with the visible labels painted in.
   *
   *     const png = await view.toImage()
   * @param {ImageOptions} [options]
   * @returns {Promise<Blob>}
   */
  async toImage(options) {
    const { snapshot } = await import('./snapshot.js')
    // draw - complete, shaders and all - and read back in the same task, while the drawing
    // buffer is still there
    this.#render(true)
    return snapshot(this.canvas, this.#labels.shown, options ?? {}, this.#labels.leaders)
  }

  /**
   * A plain-text report of what the view is drawing - camera, what is drawn and culled, bounds,
   * lights, labels - with warnings for the usual reasons a picture is wrong ("nothing in view").
   * Draws a fresh frame first.
   *
   *     console.log(await view.explain())
   * @returns {Promise<string>}
   */
  async explain() {
    const { explain } = await import('./explain.js')
    const frame = this.render()
    let nodes = 0
    const notes = []
    this.scene.traverse((n) => {
      nodes++
      // nodes that can describe themselves (charts) add a line each
      if (n !== this.scene && typeof (/** @type {any} */ (n)).explain === 'function') notes.push(/** @type {any} */ (n).explain())
    })
    // how much of the view the scene covers: what is drawn, projected - a share of each side
    const drawn = this.scene.boundsFrom(this.camera), onScreen = this.screenBounds(this.scene)
    const fills = onScreen ? { height: onScreen.height / this.#height, width: onScreen.width / this.#width } : null
    return explain({
      notes, fills,
      width: this.#width, height: this.#height, pixelRatio: this.#pixelRatio, renderMode: this.renderMode, running: this.#running,
      sharedContext: this.renderer.shared,
      frame, labels: this.#labelStats, bounds: drawn, nodes, autoLight: this.autoLight,
      contextLost: !!this.renderer.gl?.isContextLost?.(),
      interaction: { hover: this.#handlers.hover.size, click: this.#handlers.click.size, tooltip: !!this.#tooltipContent, highlight: !!this.#highlight },
    })
  }

  /**
   * Stop the loop, remove listeners, labels and the tooltip, and free GPU resources - the context
   * itself when the view has its own, or what only this view drew when it shares one.
   */
  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    this.#running = false
    cancelAnimationFrame(this.#rafId)
    for (const fn of this.#cleanup) fn()
    this.controls?.dispose()
    this.#labels.dispose()
    this.#tooltip?.dispose()
    this.renderer.dispose(this.scene)
    if (this.#ownContext) ownContexts--
    if (this.#ownCanvas) this.canvas.remove()
  }

  // widen or narrow the view so the framing chosen with `framing.keep` survives a change of shape
  #keepFraming() {
    const cam = /** @type {any} */ (this.#camera)
    if (!this.#designed) this.#designed = cam.aspect
    const scale = framingScale(this.#keep, this.#designed, cam.aspect)
    const k = scale / this.#applied
    this.#applied = scale
    if (Math.abs(k - 1) < 1e-9) return
    if (cam.constructor.type === 'orthographic-camera') cam.height *= k
    else if (cam.target) {
      const offset = cam.position.clone().sub(cam.target).multiplyScalar(k)
      cam.position.copy(cam.target).add(offset)
    } else {
      // no target to move away from: widen the field of view instead
      cam.fov = Math.min(170, 2 * Math.atan(Math.tan(cam.fov * Math.PI / 360) * k) * 360 / Math.PI)
    }
  }

  // One requestAnimationFrame per frame at most, and none while the canvas is off screen or (in
  // manual mode) while there is nothing to do.
  #schedule() {
    if (this.#rafId || this.#disposed || !this.#onScreen) return
    if (this.renderMode === 'manual' && !(this.#running && this.#onFrame) && !this.#dirty && !this.#pickPending) return
    this.#rafId = requestAnimationFrame(this.#tick)
  }

  /** @param {number} now */
  #tick = (now) => {
    this.#rafId = 0
    const dt = this.#lastTime ? Math.min(this.maxDelta, (now - this.#lastTime) / 1000) : 0
    this.#lastTime = now
    try {
      if (this.#running) {
        this.time += dt
        this.#onFrame?.(dt, this.time)
        this.scene.update(dt, this.time)
      }
      this.#updateControls(dt)
      if (this.#pickPending) this.#updateHover()
      const draw = this.#dirty || this.renderMode === 'always' ||
        (this.renderMode === 'auto' && this.#watch.changed(this.scene, this.camera))
      if (draw) this.render()
    } finally {
      // the next frame comes even if this one threw - the error still reaches the console, but one
      // bad handler doesn't freeze the view. In manual mode, sleep until something asks for a frame
      if (this.renderMode !== 'manual' || (this.#running && this.#onFrame) || this.#dirty || this.#pickPending) this.#schedule()
    }
  }

  #needsHover() {
    return this.#handlers.hover.size > 0 || !!this.#tooltipContent || !!this.#highlight || this.#handlers.click.size > 0 ||
      !!this.lastFrame?.interactive
  }

  // pick under the pointer and tell everyone when the thing under it changes - on the GPU without
  // waiting for it in big scenes, so hovering never stalls a frame
  #updateHover() {
    this.#pickPending = false
    if (!this.#needsHover()) return
    const p = this.#pointer
    if (this.#labelHover) return this.#setHovered(this.#labelHover)
    if (!p || this.#dragging) return this.#setHovered(null)
    const frame = this.#gpuFrame()
    if (frame && this.#hoverBusy) {
      // look again when the request out now lands
      this.#pickPending = true
      return
    }
    const request = frame ? this.renderer.pickAsync(frame, p.x, p.y) : undefined
    if (!request) return this.#setHovered(this.pick(p.x, p.y))
    this.#hoverBusy = true
    request.then((found) => {
      this.#hoverBusy = false
      if (this.#disposed) return
      // the pointer may have gone, or moved on (then a newer pick is due)
      this.#setHovered(this.#labelHover ?? (found && this.#pointer ? this.#exact(found, frame) : null))
      this.#schedule()
    })
  }

  /** @param {Hit | null} hit */
  #setHovered(hit) {
    const p = this.#pointer
    const before = this.#hovered
    // the same thing under the pointer: the same node, instance and row of data - a line's segments
    // and a surface's rows are told apart by their data, without a plain mesh changing per triangle
    const same = before === hit || (before && hit && before.node === hit.node && before.instance === hit.instance &&
      before.datum === hit.datum && (/** @type {any} */ (hit.node).drawMode !== 'points' || before.face === hit.face))
    this.#hovered = hit
    if (p && hit && this.#tooltip) this.#tooltip.show(hit, p.clientX, p.clientY)
    else this.#tooltip?.hide()
    if (same) return
    if (this.#highlightFor(before) || this.#highlightFor(hit)) this.invalidate()
    if (this.#handlers.click.size || this.lastFrame?.interactive) {
      this.canvas.style.cursor = hit && nearestAbove(hit.node, 'onDrag') ? 'grab' : hit && this.#clickable(hit) ? 'pointer' : ''
    }
    // node handlers: those that lose the pointer hear null, those that gain or keep it hear the hit
    const was = handlersAbove(before?.node, 'hover'), now = handlersAbove(hit?.node, 'hover')
    for (const fn of was) if (!now.includes(fn)) fn(null)
    for (const fn of now) fn(hit)
    for (const fn of this.#handlers.hover) fn(hit, p?.event ?? null)
  }

  /**
   * The pointer on a label that answers it: a click or hover there is one on what the label labels.
   * @param {'click' | 'over' | 'out'} type @param {import('./frame.js').FrameLabel} label @param {MouseEvent | null} e
   */
  #labelPointer(type, label, e) {
    const node = /** @type {any} */ (label.node), index = label.index
    const points = index !== null && node.drawMode === 'points'
    /** @type {Hit} */
    const hit = { node, point: label.position.clone(), distance: label.position.distanceTo(this.camera.worldPosition), normal: null,
      face: points ? index : null, instance: index !== null && !points ? index : null, uv: null, datum: node.datumAt?.(index) ?? null }
    if (type === 'click') {
      for (const fn of handlersAbove(node, 'click')) fn(hit)
      for (const fn of this.#handlers.click) fn(hit, e)
      return
    }
    this.#labelHover = type === 'over' ? hit : null
    if (e) {
      const rect = this.canvas.getBoundingClientRect()
      this.#pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top, clientX: e.clientX, clientY: e.clientY, event: /** @type {PointerEvent} */ (e) }
    }
    if (type === 'out') this.#pointer = null
    this.#pickPending = true
    this.#schedule()
  }

  /** Does clicking this hit do anything? @param {Hit} hit */
  #clickable(hit) {
    return this.#handlers.click.size > 0 || handlersAbove(hit.node, 'click').length > 0
  }

  /** @param {Hit | null} hit @returns {FrameHighlight | null} */
  #highlightFor(hit) {
    if (!hit) return null
    // the nearest colour wins, and the nearest highlightWhole is what is tinted as one
    let color = null, whole = null
    for (let n = /** @type {any} */ (hit.node); n; n = n.parent) {
      color ??= n.highlight
      whole ??= n.highlightWhole ? n : null
    }
    color ??= this.#highlight
    if (!color) return null
    const node = /** @type {any} */ (hit.node)
    if (whole) {
      /** @type {Set<Node>} */
      const nodes = new Set()
      whole.traverse((n) => { nodes.add(n) })
      return { node, index: null, nodes, color, amount: HIGHLIGHT_AMOUNT }
    }
    const index = hit.instance ?? (node.drawMode === 'points' ? hit.face : null)
    return { node, index, color, amount: HIGHLIGHT_AMOUNT }
  }

  // hide labels that asked to be hidden behind geometry, by casting a ray to each
  /** @param {FrameDescription} frame */
  #occlude(frame) {
    const labels = /** @type {(import('./frame.js').FrameLabel & { occluded?: boolean })[]} */ (frame.labels)
    if (!labels.some((l) => l.style.occlude && l.visible)) return
    // what this frame drew hides what is behind it - the same surfaces the picture shows
    const raycaster = new Raycaster()
    const drawn = [...frame.opaque, ...frame.transparent]
    for (const label of labels) {
      if (!label.style.occlude || !label.visible) continue
      raycaster.setFromCamera(label.ndc, this.camera)
      const distance = label.position.distanceTo(raycaster.ray.origin)
      // only solid surfaces hide labels, and not the instance or point being labelled
      const blocker = raycaster.intersectDrawn(drawn).find((h) => !(h.node === label.node && (label.index === null || h.instance === label.index)))
      label.occluded = !!blocker && blocker.distance < distance * 0.995
    }
  }

  #listen() {
    const canvas = this.canvas
    const at = (e) => {
      const rect = canvas.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top, clientX: e.clientX, clientY: e.clientY, event: e }
    }
    const move = (e) => {
      this.#pointer = at(e)
      const press = this.#press
      if (press && press.id === e.pointerId && !press.moved && Math.hypot(this.#pointer.x - press.x, this.#pointer.y - press.y) >= DRAG_START) press.moved = true
      if (this.#drag) this.#moveDrag(e, this.#pointer)
      else this.#orbitPointer?.move(e)
      this.#dragging = e.buttons !== 0
      if (this.#dragging) this.#tooltip?.hide()
      else this.#tooltip?.move(e.clientX, e.clientY)
      if (!this.#needsHover()) return
      this.#pickPending = true
      this.#schedule()
    }
    const leave = () => {
      this.#pointer = null
      this.#pickPending = true
      this.#schedule()
    }
    const up = (e) => {
      if (this.#drag) this.#endDrag(e)
      else this.#orbitPointer?.up(e)
      this.#dragging = false
      this.#pickPending = true
      this.#schedule()
    }
    // every press starts here: on something with onDrag it drags that, anywhere else it orbits - and
    // one that moves far enough, either way, isn't a click
    const down = (e) => {
      // a new press replaces a drag whose letting go never arrived (released outside the window, say)
      if (this.#drag?.id === e.pointerId) return
      // and takes the camera from a glide
      this.#flight = null
      this.#drag = null
      const pressedAt = at(e)
      this.#press = { id: e.pointerId, x: pressedAt.x, y: pressedAt.y, moved: false }
      const hit = this.lastFrame?.draggable && !(e.pointerType === 'mouse' && e.button !== 0) ? this.pick(e) : null
      const node = hit && nearestAbove(hit.node, 'onDrag')
      if (!hit || !node) {
        this.#orbitPointer?.down(e)
        return
      }
      try { canvas.setPointerCapture(e.pointerId) } catch { /* drags still work inside the canvas */ }
      const p = at(e)
      const start = hit.point.clone()
      /** @type {import('./scene/Node.js').Drag} */
      const drag = { phase: 'start', hit, node, ray: this.rayAt(p.x, p.y), plane: { normal: new Vec3(0, 1, 0), point: start.clone() },
        start, point: start.clone(), delta: new Vec3(), event: e }
      this.#drag = { drag, id: e.pointerId, x: p.x, y: p.y, press: drag.ray, started: false }
    }
    const click = (e) => {
      // the end of a drag - of a node or of the orbit - isn't a click
      if (this.#press?.moved) {
        this.#press = null
        return
      }
      if (!this.#handlers.click.size && !this.lastFrame?.interactive) return
      const hit = this.pick(e)
      if (hit) for (const fn of handlersAbove(hit.node, 'click')) fn(hit)
      for (const fn of this.#handlers.click) fn(hit, e)
    }
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerleave', leave)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('pointercancel', up)
    canvas.addEventListener('click', click)
    const wheel = () => { this.#flight = null }
    canvas.addEventListener('wheel', wheel, { passive: true })
    this.#cleanup.push(() => {
      canvas.removeEventListener('wheel', wheel)
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerleave', leave)
      canvas.removeEventListener('pointerup', up)
      canvas.removeEventListener('pointercancel', up)
      canvas.removeEventListener('click', click)
    })

    if (typeof ResizeObserver !== 'undefined') {
      const resize = new ResizeObserver(() => {
        this.resize()
        // draw straight away: a resized canvas is blank until the next draw
        this.render()
      })
      resize.observe(canvas)
      this.#cleanup.push(() => resize.disconnect())
    }
    // an off-screen view (a dashboard tile scrolled away) does no work at all
    if (typeof IntersectionObserver !== 'undefined') {
      const visible = new IntersectionObserver(([entry]) => {
        this.#onScreen = entry.isIntersecting
        if (this.#onScreen) this.invalidate()
      })
      visible.observe(canvas)
      this.#cleanup.push(() => visible.disconnect())
    }
  }

  /**
   * The pointer moved while something is pressed: once it has moved far enough to be a drag, tell
   * the node's handler it started, then where it is on the plane each move.
   * @param {PointerEvent} e @param {{ x: number, y: number }} p
   */
  #moveDrag(e, p) {
    const d = this.#drag
    if (!d || e.pointerId !== d.id) return
    const { drag } = d
    drag.event = e
    drag.ray = this.rayAt(p.x, p.y)
    if (!d.started) {
      if (Math.hypot(p.x - d.x, p.y - d.y) < DRAG_START) return
      d.started = true
      this.canvas.style.cursor = 'grabbing'
      drag.phase = 'start'
      const plane = drag.plane
      drag.node.onDrag?.(drag)
      // a handler that chose another plane drags across that, from where the press meets it
      if (drag.plane !== plane || !drag.plane.point.equals(plane.point) || !drag.plane.normal.equals(plane.normal)) {
        drag.plane = { normal: Vec3.fromInput(drag.plane.normal, 'Drag').normalize(), point: Vec3.fromInput(drag.plane.point, 'Drag') }
        const t = d.press.intersectPlane(drag.plane.normal, drag.plane.point)
        if (t !== null) drag.start.copy(d.press.at(t))
      }
    }
    drag.phase = 'move'
    const t = drag.ray.intersectPlane(drag.plane.normal, drag.plane.point)
    if (t !== null) {
      drag.point = drag.ray.at(t)
      drag.delta.copy(drag.point).sub(drag.start)
    } else drag.point = null
    drag.node.onDrag?.(drag)
    this.invalidate()
  }

  /** The pointer let go: a drag ends, and the click that follows isn't one. @param {PointerEvent} e */
  #endDrag(e) {
    const d = this.#drag
    if (!d || e.pointerId !== d.id) return
    this.#drag = null
    try { this.canvas.releasePointerCapture(e.pointerId) } catch { /* already gone */ }
    if (!d.started) return
    d.drag.phase = 'end'
    d.drag.event = e
    d.drag.node.onDrag?.(d.drag)
    this.canvas.style.cursor = ''
    this.invalidate()
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

/** Where a camera is and looks, to tell whether the app has moved it. @param {any} camera @returns {number[]} */
function cameraPlace(camera) {
  return [...camera.position, ...(camera.target ?? []), camera.fov ?? camera.height]
}
/** @param {number[]} a @param {number[] | null} b */
const samePlace = (a, b) => !!b && a.length === b.length && a.every((v, i) => v === b[i])

/** A box's eight corners - one point when it is a point. @param {Box3} box @returns {number[][]} */
function corners(box) {
  if (box.isEmpty()) return []
  if (box.min.equals(box.max)) return [box.min.toArray()]
  const out = []
  for (let i = 0; i < 8; i++) out.push([i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], i & 4 ? box.max[2] : box.min[2]])
  return out
}

// past this many instances or vertices, a drawable is fitted by the box round it all
const FIT_DETAIL = 4000

/**
 * The points a camera draws of a subtree, to fit a view round: the corners of each thing's box, so
 * the empty space between things doesn't count as filled - and closer still, the corners of each
 * instance and the vertices of lines and points, so a cloud of them isn't fitted by the corners of
 * the cube round it.
 * @param {Node} node @param {Camera} camera @returns {number[][]}
 */
function drawnPoints(node, camera) {
  node.updateWorld()
  /** @type {number[][]} */
  const points = []
  node.eachShownTo(camera, (n) => {
    const d = /** @type {any} */ (n)
    if ('instanceMatrices' in d && d.count <= FIT_DETAIL) {
      d.eachInstanceBox((x0, y0, z0, x1, y1, z1) => { points.push(...corners(new Box3([x0, y0, z0], [x1, y1, z1]))) })
    } else if ((d.drawMode === 'lines' || d.drawMode === 'points') && d.geometry.vertexCount <= FIT_DETAIL) {
      // the vertices drawn - every one, when indices pick them
      const g = d.geometry, p = g.positions, m = d.worldMatrix, count = g.indices ? g.vertexCount : g.drawnVertices
      for (let i = 0; i < count; i++) {
        const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2]
        points.push([m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]])
      }
    } else points.push(...corners(n.expandBounds(new Box3())))
  })
  return points
}

/** The nearest node at or above this one with a handler of this kind. @param {any} node @param {string} key */
function nearestAbove(node, key) {
  for (let n = node; n; n = n.parent) if (n[key]) return n
  return null
}

/** @typedef {{ position: Vec3, target: Vec3, height?: number }} Place */
/** @typedef {{ from: Place, to: Place, time: number, duration: number }} Flight */

/** Where a camera is, and an orthographic one's view height. @param {any} cam @returns {Place} */
function placeOf(cam) {
  return { position: cam.position.clone(), target: (cam.target ?? new Vec3()).clone(), height: cam.height }
}

/** @param {any} cam @param {Place} place */
function setPlace(cam, place) {
  cam.position.copy(place.position)
  setTarget(cam, place.target)
  if (place.height !== undefined) cam.height = place.height
}

/** Move a camera's target, keeping the one it has. @param {any} cam @param {Vec3} target */
function setTarget(cam, target) {
  if (cam.target) cam.target.copy(target)
  else cam.target = target.clone()
}

/**
 * Part way from one unit direction to another, along the great circle - by way of a side, when they
 * are opposite and every way round is as short.
 * @param {Vec3} a @param {Vec3} b @param {number} t
 * @returns {Vec3}
 */
function turnBetween(a, b, t) {
  const cos = Math.max(-1, Math.min(1, a.dot(b)))
  if (cos > 0.9999) return a.clone().lerp(b, t).normalize()
  if (cos < -0.9999) {
    const side = Math.abs(a[1]) < 0.9 ? new Vec3(0, 1, 0) : new Vec3(1, 0, 0)
    const mid = a.clone().cross(side).normalize()
    return t < 0.5 ? turnBetween(a, mid, t * 2) : turnBetween(mid, b, t * 2 - 1)
  }
  const angle = Math.acos(cos), s = Math.sin(angle)
  return a.clone().multiplyScalar(Math.sin((1 - t) * angle) / s).add(b.clone().multiplyScalar(Math.sin(t * angle) / s))
}

/**
 * The handlers a label answers: those of a Label node that has its own, or those of the instance or
 * point it labels.
 * @param {import('./frame.js').FrameLabel} label @param {'hover' | 'click'} event @returns {Function[]}
 */
function labelHandlers(label, event) {
  if (label.index === null && !label.node.handlersFor(event).length) return []
  return handlersAbove(label.node, event)
}

/**
 * A node's hover or click handlers and its ancestors', nearest first: each one's own, then its listeners.
 * @param {any} node @param {'hover' | 'click'} event @returns {Function[]}
 */
function handlersAbove(node, event) {
  const list = []
  for (let n = node; n; n = n.parent) list.push(...n.handlersFor(event))
  return list
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
