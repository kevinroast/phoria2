import { collect } from './frame.js'
import { LabelLayer } from './labels.js'
import { OrbitControl } from './OrbitControl.js'
import { cameraPreset, framingScale } from './presets.js'
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
import { checkOneOf, checkOptions, describe, fail } from './validate.js'

/** @import { OrbitOptions } from './OrbitControl.js' */
/** @import { CameraPreset, FramingKeep } from './presets.js' */
/** @import { Hit } from './Raycaster.js' */
/** @import { FrameDescription, FrameHighlight } from './frame.js' */
/** @import { LabelStats } from './labels.js' */
/** @import { ImageOptions } from './snapshot.js' */
/** @import { Tooltip, TooltipContent } from './tooltip.js' */
/** @import { ToneMapping } from './webgl/WebGLRenderer.js' */
/** @import { CameraOptions } from './scene/cameras.js' */
/** @import { ColorInput } from './types.js' */
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
 *   PerspectiveCamera options
 * @property {boolean | OrbitOptions} [orbit] mouse/touch camera control (default false)
 * @property {ColorInput | null} [background] shortcut for scene.background
 * @property {RenderMode} [renderMode] when to draw (default 'auto': only when something changed)
 * @property {{ keep?: FramingKeep, aspect?: number }} [framing] what stays in view when the canvas changes shape:
 *   keep 'height' (default - the width varies), 'width', or 'both' (nothing framed is ever cut off). aspect is
 *   the width / height the camera was set up for (default: the canvas's shape when the camera was set or framed)
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
 * @property {boolean} [autoLight] light a scene that has no lights, with one console note (default true)
 * @property {number} [maxDelta] longest frame step in seconds, so a background tab doesn't jump (default 0.1)
 */

/** @typedef {'click' | 'hover'} ViewEvent */
/** @typedef {(hit: Hit | null, event: PointerEvent | MouseEvent | null) => void} ViewHandler */

const OPTIONS = ['canvas', 'scene', 'camera', 'orbit', 'background', 'renderMode', 'framing', 'highlight', 'tooltip', 'pixelRatio',
  'antialias', 'context', 'toneMapping', 'exposure', 'autoLight', 'maxDelta']
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
  #rafId = 0
  #lastTime = 0
  #dirty = true
  #onScreen = true
  #width = 0
  #height = 0
  #pixelRatio = 1
  #explicitPixelRatio = false
  #autoFrame = false
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
  /** @type {Hit | null} */ #hovered = null
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

    if (options.camera instanceof Camera) {
      this.#camera = options.camera
    } else if (typeof options.camera === 'string') {
      this.#camera = cameraPreset(options.camera)
      this.#autoFrame = true
    } else {
      this.#camera = new PerspectiveCamera({ position: [0, 1.5, 6], target: [0, 0, 0], ...options.camera })
    }

    const context = options.context === undefined ? 'auto' : checkOneOf('View', 'context', options.context, ['auto', 'own', 'shared'])
    const shared = context === 'shared' || (context === 'auto' && ownContexts >= OWN_CONTEXTS)
    this.renderer = new WebGLRenderer({ canvas: this.canvas, shared, antialias: options.antialias, toneMapping: options.toneMapping, exposure: options.exposure })
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
    if (options.maxDelta !== undefined) this.maxDelta = options.maxDelta
    if (options.renderMode !== undefined) this.renderMode = checkOneOf('View', 'renderMode', options.renderMode, ['auto', 'always', 'manual'])
    if (options.pixelRatio !== undefined) {
      this.#pixelRatio = options.pixelRatio
      this.#explicitPixelRatio = true
    }
    if (options.orbit) {
      const orbit = options.orbit === true ? {} : options.orbit
      // a plan view pans like a map unless told otherwise
      const mode = orbit.mode ?? (options.camera === 'top' ? 'map' : undefined)
      this.controls = new OrbitControl(this.camera, this.canvas, mode ? { ...orbit, mode } : orbit)
    }
    if (options.highlight !== undefined) this.#setHighlight(options.highlight)
    if (options.tooltip !== undefined) this.tooltip(options.tooltip)
    this.#labels = new LabelLayer(this.canvas)

    if (options.framing !== undefined) {
      const f = options.framing
      checkOptions('View', f, ['keep', 'aspect'])
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
    }
    if (!(camera instanceof Camera)) fail('View', `'camera' must be a camera or a preset name, got ${describe(camera)}`)
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
    this.controls?.update(dt)
    this.scene.update(dt, this.time)
    return this.render()
  }

  /** Draw the current state now, without advancing time. @returns {FrameDescription} */
  render() {
    if (this.#autoFrame) {
      const bounds = this.scene.bounds
      if (!bounds.isEmpty()) {
        this.#autoFrame = false
        this.frame(bounds)
      }
    }
    this.scene.updateWorldTree()
    const frame = collect(this.scene, this.camera)
    if (this.autoLight && frame.lights.length === 0) this.#addAutoLights(frame)
    frame.highlight = this.#highlightFor(this.#hovered)
    this.#occlude(frame)
    this.renderer.renderFrame(frame)
    this.#labelStats = this.#labels.update(frame.labels, frame.overlays)
    // a node with its own tooltip needs the tooltip's code
    if (frame.tooltips && !this.#tooltip) this.#loadTooltip()
    this.lastFrame = frame
    this.#dirty = false
    // things may have moved under a still pointer
    if (this.#pointer && this.#needsHover()) this.#pickPending = true
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
    this.#keepFraming()
    this.#dirty = true
  }

  /**
   * Move the camera so a node, a box or (with no argument) the whole scene fills the view,
   * keeping the viewing direction. The orbit target moves to its centre.
   * @param {Node | Box3} [target] (default the scene)
   * @param {{ padding?: number }} [options] 1 is a tight fit (default 1.2)
   * @returns {this}
   */
  frame(target = this.scene, { padding = 1.2 } = {}) {
    const box = target instanceof Box3 ? target : target.bounds
    if (box.isEmpty()) return this
    const center = box.getCenter()
    const radius = Math.max(box.getRadius(), 1e-3)
    const cam = /** @type {any} */ (this.camera)
    const direction = cam.position.clone().sub(cam.target ?? new Vec3()).normalize()
    if (direction.len() === 0) direction.set(0, 0.3, 1).normalize()
    if (cam.constructor.type === 'orthographic-camera') {
      // fit the box's sphere to the narrower of the view's height and width
      cam.height = radius * 2 * padding * Math.max(1, 1 / (cam.aspect || 1))
      cam.position.copy(center).add(direction.clone().multiplyScalar(radius * 4))
      cam.far = Math.max(cam.far, radius * 10)
    } else {
      const fit = Math.min(cam.fov, cam.fov * cam.aspect) * Math.PI / 360
      const distance = radius / Math.sin(fit) * padding
      cam.position.copy(center).add(direction.clone().multiplyScalar(distance))
      // keep the near/far range sensible for the model's size
      cam.near = Math.max(1e-3, distance / 1000)
      cam.far = Math.max(cam.far, distance * 10)
    }
    cam.target = center
    // framed for the canvas as it is now
    this.#designed = cam.aspect
    this.#applied = 1
    this.invalidate()
    return this
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

  /** The last frame, when it is big enough that picking on the GPU pays. */
  #gpuFrame() {
    const frame = this.lastFrame
    if (!frame) return null
    let work = 0
    for (const { node, geometry, instances } of [...frame.opaque, ...frame.transparent]) {
      const mode = /** @type {any} */ (node).drawMode
      work += instances ? instances.count : mode === 'points' ? geometry.drawnCount : mode === 'lines' ? geometry.drawnCount / 2 : geometry.drawnCount / 3
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
    // draw and read back in the same task, while the drawing buffer is still there
    this.render()
    return snapshot(this.canvas, this.#labels.shown, options ?? {})
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
    return explain({
      notes,
      width: this.#width, height: this.#height, pixelRatio: this.#pixelRatio, renderMode: this.renderMode, running: this.#running,
      sharedContext: this.renderer.shared,
      frame, labels: this.#labelStats, bounds: this.scene.bounds, nodes, autoLight: this.autoLight,
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
    if (this.#running) {
      this.time += dt
      this.#onFrame?.(dt, this.time)
      this.scene.update(dt, this.time)
    }
    this.controls?.update(dt)
    if (this.#pickPending) this.#updateHover()
    const draw = this.#dirty || this.renderMode === 'always' ||
      (this.renderMode === 'auto' && this.#watch.changed(this.scene, this.camera))
    if (draw) this.render()
    // in manual mode, sleep until something asks for a frame
    if (this.renderMode !== 'manual' || (this.#running && this.#onFrame) || this.#dirty || this.#pickPending) this.#schedule()
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
      this.#setHovered(found && this.#pointer ? this.#exact(found, frame) : null)
      this.#schedule()
    })
  }

  /** @param {Hit | null} hit */
  #setHovered(hit) {
    const p = this.#pointer
    const before = this.#hovered
    const same = before === hit || (before && hit && before.node === hit.node && before.instance === hit.instance &&
      (/** @type {any} */ (hit.node).drawMode !== 'points' || before.face === hit.face))
    this.#hovered = hit
    if (p && hit && this.#tooltip) this.#tooltip.show(hit, p.clientX, p.clientY)
    else this.#tooltip?.hide()
    if (same) return
    if (this.#highlightFor(before) || this.#highlightFor(hit)) this.invalidate()
    if (this.#handlers.click.size || this.lastFrame?.interactive) this.canvas.style.cursor = hit && this.#clickable(hit) ? 'pointer' : ''
    // node handlers: those that lose the pointer hear null, those that gain or keep it hear the hit
    const was = handlersAbove(before?.node, 'onHover'), now = handlersAbove(hit?.node, 'onHover')
    for (const fn of was) if (!now.includes(fn)) fn(null)
    for (const fn of now) fn(hit)
    for (const fn of this.#handlers.hover) fn(hit, p?.event ?? null)
  }

  /** Does clicking this hit do anything? @param {Hit} hit */
  #clickable(hit) {
    return this.#handlers.click.size > 0 || handlersAbove(hit.node, 'onClick').length > 0
  }

  /** @param {Hit | null} hit @returns {FrameHighlight | null} */
  #highlightFor(hit) {
    if (!hit) return null
    let color = this.#highlight
    for (let n = /** @type {any} */ (hit.node); n; n = n.parent) {
      if (n.highlight) {
        color = n.highlight
        break
      }
    }
    if (!color) return null
    const node = /** @type {any} */ (hit.node)
    const index = hit.instance ?? (node.drawMode === 'points' ? hit.face : null)
    return { node, index, color, amount: HIGHLIGHT_AMOUNT }
  }

  // hide labels that asked to be hidden behind geometry, by casting a ray to each
  /** @param {FrameDescription} frame */
  #occlude(frame) {
    const labels = /** @type {(import('./frame.js').FrameLabel & { occluded?: boolean })[]} */ (frame.labels)
    if (!labels.some((l) => l.style.occlude && l.visible)) return
    const raycaster = new Raycaster()
    for (const label of labels) {
      if (!label.style.occlude || !label.visible) continue
      raycaster.setFromCamera(label.ndc, this.camera)
      const distance = label.position.distanceTo(raycaster.ray.origin)
      // only solid surfaces hide labels, and not the instance or point being labelled
      const blocker = raycaster.intersect(this.scene).find((h) => /** @type {any} */ (h.node).drawMode === 'triangles' &&
        !(h.node === label.node && (label.index === null || h.instance === label.index)))
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
    const up = () => {
      this.#dragging = false
      this.#pickPending = true
      this.#schedule()
    }
    const click = (e) => {
      if (!this.#handlers.click.size && !this.lastFrame?.interactive) return
      const hit = this.pick(e)
      if (hit) for (const fn of handlersAbove(hit.node, 'onClick')) fn(hit)
      for (const fn of this.#handlers.click) fn(hit, e)
    }
    canvas.addEventListener('pointermove', move)
    canvas.addEventListener('pointerleave', leave)
    canvas.addEventListener('pointerup', up)
    canvas.addEventListener('click', click)
    this.#cleanup.push(() => {
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerleave', leave)
      canvas.removeEventListener('pointerup', up)
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

/**
 * A node's handlers of one kind and its ancestors', nearest first.
 * @param {any} node @param {'onHover' | 'onClick'} key @returns {Function[]}
 */
function handlersAbove(node, key) {
  const list = []
  for (let n = node; n; n = n.parent) if (n[key]) list.push(n[key])
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
