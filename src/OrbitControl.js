import { Vec3 } from './value/Vec3.js'
import { checkOneOf, checkOptions, checkRange, describe, fail } from './validate.js'

/** @import { Camera } from './scene/cameras.js' */

/** How far (CSS pixels) a press moves before it is a drag rather than a click - the View's rule too. */
export const DRAG_START = 4

/**
 * @typedef {object} OrbitOptions
 * @property {boolean} [enabled] (default true)
 * @property {'orbit' | 'map'} [mode] 'map' makes every drag pan and the view never turn - for plans and maps (default 'orbit')
 * @property {number} [rotateSpeed] radians per pixel of drag (default 0.005)
 * @property {number} [zoomSpeed] fraction of the distance per wheel step (default 0.1)
 * @property {boolean} [zoom] false to leave the wheel scrolling the page (default true)
 * @property {boolean} [zoomToCursor] the wheel zooms towards the point under the pointer (default true)
 * @property {boolean} [pan] right-drag (or two-finger drag) pans (default true)
 * @property {number} [inertia] how much of a fling carries on after release: the fraction of its speed kept
 *   every 1/60 s - 0 stops dead, 0.95 glides a long way (default 0.85)
 * @property {boolean | number} [autoRotate] spin around the target; a number is radians per second (default false)
 * @property {number} [minDistance] (default 0.1)
 * @property {number} [maxDistance] (default Infinity)
 * @property {number} [minPitch] radians below the horizon (default just short of straight down)
 * @property {number} [maxPitch] radians above it (default just short of straight up)
 */

const OPTIONS = ['enabled', 'mode', 'rotateSpeed', 'zoomSpeed', 'zoom', 'zoomToCursor', 'pan', 'inertia', 'autoRotate',
  'minDistance', 'maxDistance', 'minPitch', 'maxPitch']
const HINTS = {
  enableDamping: "use 'inertia' (0 to turn it off)",
  enableRotate: "use mode: 'map' to make dragging pan instead of turning",
  rotate: "use mode: 'map' to make dragging pan instead of turning",
  enableZoom: "use 'zoom'",
  enablePan: "use 'pan'",
  screenSpacePanning: 'panning always follows the screen',
  dampingFactor: "use 'inertia': the fraction of speed kept each 1/60 s (default 0.85)",
  target: 'set camera.target - the control orbits around it',
}
const LIMIT = Math.PI / 2 - 0.001
// fastest fling, radians per second
const MAX_FLING = 4

/** Check the numbers and modes in orbit options. @param {Record<string, any>} o */
function checkSettings(o) {
  const owner = 'OrbitControl'
  if (o.mode !== undefined) checkOneOf(owner, 'mode', o.mode, ['orbit', 'map'])
  if (o.rotateSpeed !== undefined) checkRange(owner, 'rotateSpeed', o.rotateSpeed, 0)
  if (o.zoomSpeed !== undefined) checkRange(owner, 'zoomSpeed', o.zoomSpeed, 0)
  // the share of speed kept each 1/60 s: 1 would never slow down
  if (o.inertia !== undefined) checkRange(owner, 'inertia', o.inertia, 0, 0.99)
  if (o.autoRotate !== undefined && typeof o.autoRotate !== 'boolean' && (typeof o.autoRotate !== 'number' || !Number.isFinite(o.autoRotate))) {
    fail(owner, `'autoRotate' is true, false or a speed in radians per second, got ${describe(o.autoRotate)}`)
  }
  if (o.minDistance !== undefined) checkRange(owner, 'minDistance', o.minDistance, 0)
  if (o.maxDistance !== undefined) checkRange(owner, 'maxDistance', o.maxDistance, 0, Infinity, { above: true })
  if (o.minPitch !== undefined) checkRange(owner, 'minPitch', o.minPitch, -Math.PI / 2, Math.PI / 2)
  if (o.maxPitch !== undefined) checkRange(owner, 'maxPitch', o.maxPitch, -Math.PI / 2, Math.PI / 2)
}

/**
 * Mouse and touch camera control: drag (or one finger) orbits the camera around its target,
 * right-drag (or two fingers) pans, the wheel (or a pinch) zooms, towards the pointer. With
 * `mode: 'map'` it is a map control - every drag pans. A drag never counts as a click, so picking
 * on click keeps working. The View creates one with `orbit: true` and calls update()
 * each frame; standalone, call update(dt) yourself for inertia and auto-rotate.
 */
export class OrbitControl {
  /** The options it takes, and hints for names people reach for instead. */
  static OPTIONS = OPTIONS
  static HINTS = HINTS
  enabled = true
  /** 'map' makes every drag pan. @type {'orbit' | 'map'} */
  mode = 'orbit'
  rotateSpeed = 0.005
  zoomSpeed = 0.1
  zoom = true
  zoomToCursor = true
  pan = true
  inertia = 0.85
  /** @type {boolean | number} */
  autoRotate = false
  minDistance = 0.1
  maxDistance = Infinity
  minPitch = -LIMIT
  maxPitch = LIMIT

  /** @type {Camera} */ camera
  /** @type {HTMLElement} */ element
  /** @type {Map<number, { x: number, y: number }>} */ #pointers = new Map()
  // fling speed in radians per second, measured while dragging
  #velocity = { yaw: 0, pitch: 0 }
  #lastMove = 0
  #panning = false
  #dragged = false
  /** where the press began, to tell a drag from a tap that wobbles @type {{ x: number, y: number }} */
  #pressed = { x: 0, y: 0 }
  #pinchDistance = 0
  /** @type {() => void} */ #removeListeners

  /**
   * @param {Camera} camera its target is the pivot; set to the origin if it has none
   * @param {HTMLElement} element usually the canvas
   * @param {OrbitOptions} [options]
   */
  constructor(camera, element, options = {}) {
    checkOptions('OrbitControl', options, OPTIONS, HINTS)
    if (!camera || !('target' in camera)) fail('OrbitControl', 'expects a camera, e.g. new OrbitControl(view.camera, view.canvas)')
    this.camera = camera
    this.element = element
    checkSettings(options)
    Object.assign(this, options)
    // the limits must still make sense with the defaults they're paired with
    if (this.minDistance > this.maxDistance) fail('OrbitControl', `'minDistance' (${this.minDistance}) is more than 'maxDistance' (${this.maxDistance})`)
    if (this.minPitch > this.maxPitch) fail('OrbitControl', `'minPitch' (${this.minPitch}) is more than 'maxPitch' (${this.maxPitch})`)
    camera.target ??= new Vec3()

    // touch-action: none stops the browser claiming touch drags for scrolling before we see them
    element.style.touchAction = 'none'
    const down = (e) => this.#down(e), move = (e) => this.#move(e), up = (e) => this.#up(e)
    const wheel = (e) => this.#wheel(e)
    const menu = (e) => { if (this.enabled && this.pan) e.preventDefault() }
    // capture phase, so a drag that ends over the element doesn't also count as a click
    const click = (e) => {
      if (this.#dragged) {
        e.stopImmediatePropagation()
        this.#dragged = false
      }
    }
    element.addEventListener('pointerdown', down)
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', up)
    element.addEventListener('pointercancel', up)
    element.addEventListener('wheel', wheel, { passive: false })
    element.addEventListener('contextmenu', menu)
    element.addEventListener('click', click, true)
    this.#removeListeners = () => {
      element.removeEventListener('pointerdown', down)
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', up)
      element.removeEventListener('pointercancel', up)
      element.removeEventListener('wheel', wheel)
      element.removeEventListener('contextmenu', menu)
      element.removeEventListener('click', click, true)
    }
  }

  /** The target (pivot). @returns {Vec3} */
  get target() {
    return /** @type {Vec3} */ (this.camera.target)
  }

  /** Camera position relative to the target. Setting it moves the camera, within the limits. */
  get spherical() {
    const offset = this.camera.position.clone().sub(this.target)
    const distance = offset.len() || this.minDistance
    return { yaw: Math.atan2(offset[0], offset[2]), pitch: Math.asin(Math.max(-1, Math.min(1, offset[1] / distance))), distance }
  }

  set spherical({ yaw, pitch, distance }) {
    pitch = Math.min(this.maxPitch, Math.max(this.minPitch, pitch))
    distance = Math.min(this.maxDistance, Math.max(this.minDistance, distance))
    const t = this.target
    this.camera.position.set(
      t[0] + distance * Math.cos(pitch) * Math.sin(yaw),
      t[1] + distance * Math.sin(pitch),
      t[2] + distance * Math.cos(pitch) * Math.cos(yaw))
  }

  /** Orbit by angles in radians. @param {number} dYaw @param {number} dPitch */
  rotate(dYaw, dPitch) {
    const s = this.spherical
    this.spherical = { yaw: s.yaw + dYaw, pitch: s.pitch + dPitch, distance: s.distance }
  }

  /** Scale the distance to the target (0.9 moves closer). Orthographic cameras zoom their view height. @param {number} factor */
  zoomBy(factor) {
    const cam = /** @type {any} */ (this.camera)
    if (cam.constructor.type === 'orthographic-camera') {
      cam.height = Math.max(1e-4, cam.height * factor)
      return
    }
    const s = this.spherical
    this.spherical = { ...s, distance: s.distance * factor }
  }

  /**
   * Zoom by a factor, keeping the point under the pointer still - where the pointer is, in -1..1
   * across the view (x right, y up). The target moves with it, so orbiting then turns about there.
   * @param {number} factor below 1 zooms in
   * @param {number} x @param {number} y
   */
  zoomAt(factor, x, y) {
    const before = this.#halfHeight()
    this.zoomBy(factor)
    // the zoom actually applied, after the distance limits
    const k = 1 - this.#halfHeight() / before
    if (!k) return
    this.camera.updateWorld()
    const m = this.camera.worldMatrix
    const right = new Vec3(m[0], m[1], m[2]).normalize().multiplyScalar(x * before * this.camera.aspect * k)
    const move = new Vec3(m[4], m[5], m[6]).normalize().multiplyScalar(y * before * k).add(right)
    this.camera.position.add(move)
    this.target.add(move)
  }

  // half the view's height at the target, in world units
  #halfHeight() {
    const cam = /** @type {any} */ (this.camera)
    return cam.constructor.type === 'orthographic-camera' ? cam.height / 2 : this.spherical.distance * Math.tan(cam.fov * Math.PI / 360)
  }

  /** Move the camera and target together by screen pixels; the scene follows the pointer. @param {number} dx @param {number} dy */
  panBy(dx, dy) {
    this.camera.updateWorld()
    const m = this.camera.worldMatrix
    const right = new Vec3(m[0], m[1], m[2]).normalize()
    const up = new Vec3(m[4], m[5], m[6]).normalize()
    const cam = /** @type {any} */ (this.camera)
    const height = this.element.clientHeight || 1
    const worldPerPixel = cam.constructor.type === 'orthographic-camera'
      ? cam.height / height
      : 2 * this.spherical.distance * Math.tan((cam.fov * Math.PI / 180) / 2) / height
    const move = right.multiplyScalar(-dx * worldPerPixel).add(up.multiplyScalar(dy * worldPerPixel))
    this.camera.position.add(move)
    this.target.add(move)
  }

  /** Apply inertia and auto-rotate; the View calls this each frame. @param {number} dt seconds */
  update(dt) {
    if (!this.enabled) return
    if (this.#pointers.size === 0) {
      const v = this.#velocity
      if (Math.abs(v.yaw) > 1e-3 || Math.abs(v.pitch) > 1e-3) {
        this.rotate(v.yaw * dt, v.pitch * dt)
        // the same glide at any frame rate
        const keep = Math.pow(Math.min(0.99, Math.max(0, this.inertia)), dt * 60)
        v.yaw *= keep
        v.pitch *= keep
      }
      if (this.autoRotate) this.rotate(-(this.autoRotate === true ? 0.5 : this.autoRotate) * dt, 0)
    }
  }

  /**
   * Let go of the gesture under way - for an app taking the pointer over, such as to drag
   * something across the scene. The camera stays where it is; the next press orbits as usual.
   */
  cancel() {
    this.#pointers.clear()
    this.#pinchDistance = 0
    this.#velocity = { yaw: 0, pitch: 0 }
    this.#dragged = false
  }

  dispose() {
    this.#removeListeners()
    this.element.style.touchAction = ''
  }

  /** @param {PointerEvent} e */
  #down(e) {
    if (!this.enabled || (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2)) return
    if (e.button === 2 && !this.pan) return
    // capture is best-effort: it throws for pointers the browser doesn't know, such as scripted events
    try { this.element.setPointerCapture(e.pointerId) } catch { /* drags still work inside the element */ }
    this.#pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    this.#pressed = { x: e.clientX, y: e.clientY }
    this.#dragged = false
    this.#velocity = { yaw: 0, pitch: 0 }
    this.#lastMove = performance.now()
    this.#pinchDistance = this.#spread()
    // as a map control, every drag pans
    this.#panning = e.button === 2 || this.mode === 'map'
    if (this.#panning && !this.pan) this.#pointers.delete(e.pointerId)
  }

  /** @param {PointerEvent} e */
  #move(e) {
    const last = this.#pointers.get(e.pointerId)
    if (!last || !this.enabled) return
    const dx = e.clientX - last.x, dy = e.clientY - last.y
    last.x = e.clientX
    last.y = e.clientY
    // a tap that moves a pixel or two is still a click - touch and pens nearly always do
    if (!this.#dragged && Math.hypot(e.clientX - this.#pressed.x, e.clientY - this.#pressed.y) >= DRAG_START) this.#dragged = true

    if (this.#pointers.size >= 2) {
      // two fingers: pinch zooms, moving together pans (applied per finger, so halve it)
      const spread = this.#spread()
      if (this.zoom && this.#pinchDistance > 0 && spread > 0) this.zoomBy(this.#pinchDistance / spread)
      this.#pinchDistance = spread
      if (this.pan) this.panBy(dx / 2, dy / 2)
    } else if (this.#panning) {
      this.panBy(dx, dy)
    } else {
      // grab the scene: dragging right turns it right, dragging down tips its top towards you
      const dYaw = -dx * this.rotateSpeed, dPitch = dy * this.rotateSpeed
      this.rotate(dYaw, dPitch)
      // speed from the time since the last move, capped so one big jump can't fling it round
      const now = performance.now()
      const elapsed = Math.max(1 / 60, (now - this.#lastMove) / 1000)
      const cap = (w) => Math.max(-MAX_FLING, Math.min(MAX_FLING, w / elapsed))
      this.#velocity = { yaw: cap(dYaw), pitch: cap(dPitch) }
      this.#lastMove = now
    }
  }

  /** @param {PointerEvent} e */
  #up(e) {
    this.#pointers.delete(e.pointerId)
    this.#pinchDistance = this.#spread()
    // no fling if the pointer had come to rest before letting go
    if (this.inertia <= 0 || performance.now() - this.#lastMove > 80) this.#velocity = { yaw: 0, pitch: 0 }
  }

  /** @param {WheelEvent} e */
  #wheel(e) {
    if (!this.enabled || !this.zoom) return
    e.preventDefault()
    const factor = 1 + Math.sign(e.deltaY) * this.zoomSpeed
    if (!this.zoomToCursor) return this.zoomBy(factor)
    const r = this.element.getBoundingClientRect()
    this.zoomAt(factor, ((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2)
  }

  #spread() {
    if (this.#pointers.size < 2) return 0
    const [a, b] = [...this.#pointers.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }
}
