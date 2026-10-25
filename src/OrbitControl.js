import { vec3 } from 'gl-matrix'
import { PIO2, RADIANS } from './math.js'

// Mouse and touch camera control: left-drag (or one-finger drag) orbits the camera around its
// look-at point, right-drag pans, the wheel zooms. Works directly on scene.camera, re-reading it
// at the start of every gesture, so code that also moves the camera (keys, triggers) can coexist.
//
//   const orbit = new OrbitControl(canvas, scene, { minDistance: 2 })
//   orbit.enabled = false   // suspend
//   orbit.dispose()         // remove listeners
export class OrbitControl {
  enabled = true
  // radians per pixel of drag
  rotateSpeed = 0.006
  // fraction of the distance per wheel step
  zoomSpeed = 0.08
  // set false where the wheel should keep scrolling the page
  zoom = true
  pan = true
  minDistance = 0.1
  maxDistance = Infinity
  // stop just short of straight up/down, where yaw becomes meaningless
  minPitch = -PIO2 + 0.01
  maxPitch = PIO2 - 0.01

  #element
  #scene
  #pointerId = null
  #dragged = false
  // replaced while a drag is in progress with one that removes its listeners
  #endDrag = () => {}

  constructor(element, scene, options = {}) {
    this.#element = element
    this.#scene = scene
    Object.assign(this, options)

    // touch-action: none stops the browser claiming touch drags for scrolling before we see them
    element.style.touchAction = 'none'
    element.style.cursor = 'grab'
    element.addEventListener('pointerdown', this.#onPointerDown)
    element.addEventListener('wheel', this.#onWheel, { passive: false })
    element.addEventListener('contextmenu', this.#onContextMenu)
    // capture phase, so a drag that ends over the element doesn't also count as a click (picking etc.)
    element.addEventListener('click', this.#onClick, true)
  }

  dispose() {
    const el = this.#element
    this.#endDrag()
    el.removeEventListener('pointerdown', this.#onPointerDown)
    el.removeEventListener('wheel', this.#onWheel)
    el.removeEventListener('contextmenu', this.#onContextMenu)
    el.removeEventListener('click', this.#onClick, true)
    el.style.cursor = ''
  }

  // Camera position relative to the look-at point as { yaw, pitch, distance }.
  get spherical() {
    const { position: p, lookat: t } = this.#scene.camera
    const x = p.x - t.x, y = p.y - t.y, z = p.z - t.z
    const distance = Math.hypot(x, y, z) || this.minDistance
    return { yaw: Math.atan2(x, z), pitch: Math.asin(y / distance), distance }
  }

  set spherical({ yaw, pitch, distance }) {
    const { position, lookat } = this.#scene.camera
    pitch = Math.min(this.maxPitch, Math.max(this.minPitch, pitch))
    distance = Math.min(this.maxDistance, Math.max(this.minDistance, distance))
    position.x = lookat.x + distance * Math.cos(pitch) * Math.sin(yaw)
    position.y = lookat.y + distance * Math.sin(pitch)
    position.z = lookat.z + distance * Math.cos(pitch) * Math.cos(yaw)
  }

  rotate(dYaw, dPitch) {
    const s = this.spherical
    this.spherical = { yaw: s.yaw + dYaw, pitch: s.pitch + dPitch, distance: s.distance }
  }

  zoomBy(factor) {
    const s = this.spherical
    this.spherical = { ...s, distance: s.distance * factor }
  }

  // Move the camera and its look-at point together, by screen pixels.
  panBy(dx, dy) {
    const { camera, perspective } = this.#scene
    const { position: p, lookat: t } = camera
    const forward = vec3.fromValues(t.x - p.x, t.y - p.y, t.z - p.z)
    const distance = vec3.length(forward)
    vec3.normalize(forward, forward)
    const up = vec3.fromValues(camera.up.x, camera.up.y, camera.up.z)
    // screen right and up as world vectors (phoria's projection keeps +x to the right)
    const right = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), up, forward))
    const screenUp = vec3.cross(vec3.create(), forward, right)
    // world units per pixel at the look-at distance
    const scale = 2 * distance * Math.tan(perspective.fov * RADIANS / 2) / (this.#element.clientHeight || 1)
    // the scene follows the pointer, so the camera moves the other way
    const move = vec3.scale(vec3.create(), right, -dx * scale)
    vec3.scaleAndAdd(move, move, screenUp, dy * scale)
    for (const v of [p, t]) {
      v.x += move[0]
      v.y += move[1]
      v.z += move[2]
    }
  }

  #onPointerDown = (e) => {
    if (!this.enabled || this.#pointerId !== null) return
    if (e.button !== 0 && e.button !== 2) return
    const panning = e.button === 2
    if (panning && !this.pan) return
    e.preventDefault()
    this.#pointerId = e.pointerId
    this.#dragged = false
    this.#element.setPointerCapture(e.pointerId)
    this.#element.style.cursor = 'grabbing'
    let lastX = e.clientX, lastY = e.clientY, travel = 0

    const onMove = (ev) => {
      if (ev.pointerId !== this.#pointerId) return
      const dx = ev.clientX - lastX, dy = ev.clientY - lastY
      lastX = ev.clientX
      lastY = ev.clientY
      travel += Math.abs(dx) + Math.abs(dy)
      if (travel > 4) this.#dragged = true
      if (panning) {
        this.panBy(dx, dy)
      } else {
        this.rotate(dx * this.rotateSpeed, dy * this.rotateSpeed)
      }
    }
    const onUp = (ev) => {
      if (ev.pointerId === this.#pointerId) this.#endDrag()
    }
    this.#endDrag = () => {
      this.#element.removeEventListener('pointermove', onMove)
      this.#element.removeEventListener('pointerup', onUp)
      this.#element.removeEventListener('pointercancel', onUp)
      this.#pointerId = null
      this.#element.style.cursor = 'grab'
    }
    this.#element.addEventListener('pointermove', onMove)
    this.#element.addEventListener('pointerup', onUp)
    // the browser can revoke a touch (system gesture) - without this the drag would stay latched
    this.#element.addEventListener('pointercancel', onUp)
  }

  #onWheel = (e) => {
    if (!this.enabled || !this.zoom) return
    e.preventDefault()
    this.zoomBy(1 + Math.sign(e.deltaY) * this.zoomSpeed)
  }

  #onContextMenu = (e) => {
    if (this.enabled && this.pan) e.preventDefault()
  }

  #onClick = (e) => {
    if (this.#dragged) {
      e.stopImmediatePropagation()
      this.#dragged = false
    }
  }
}
