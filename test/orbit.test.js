// Orbiting in motion: dragging, panning, zooming and gliding, and the limits holding throughout.
import { afterAll, describe, expect, it } from 'vitest'
import { OrbitControl, OrthographicCamera, PerspectiveCamera } from '../src/index.js'
import { fakePage } from './fakes.js'

const page = fakePage()
afterAll(() => page.restore())

const round = (v) => Math.round(v * 1e4) / 1e4
/** A camera 10 in front of the origin, and a control on a 300 x 150 canvas. */
const orbit = (options = {}, camera = new PerspectiveCamera({ position: [0, 0, 10], target: [0, 0, 0] })) => {
  const element = page.canvas()
  return { control: new OrbitControl(camera, /** @type {any} */ (element), options), element, camera }
}
/** Drag from one point to another with a button (0 left, 2 right), in one move. */
const drag = (element, from, to, button = 0) => {
  element.dispatch('pointerdown', { pointerId: 1, button, pointerType: 'mouse', clientX: from[0], clientY: from[1] })
  element.dispatch('pointermove', { pointerId: 1, clientX: to[0], clientY: to[1] })
  element.dispatch('pointerup', { pointerId: 1, clientX: to[0], clientY: to[1] })
}

describe('orbit limits', () => {
  it('turns no further than minPitch and maxPitch', () => {
    const { control } = orbit({ minPitch: -0.2, maxPitch: 0.5 })
    control.rotate(0, 2)
    expect(round(control.spherical.pitch)).toBe(0.5)
    control.rotate(0, -3)
    expect(round(control.spherical.pitch)).toBe(-0.2)
  })

  it('zooms no closer than minDistance and no further than maxDistance, keeping the direction', () => {
    const { control, camera } = orbit({ minDistance: 4, maxDistance: 20 })
    control.zoomBy(0.1)
    expect(round(control.spherical.distance)).toBe(4)
    control.zoomBy(100)
    expect(round(control.spherical.distance)).toBe(20)
    expect(camera.position.toArray().map(round)).toEqual([0, 0, 20])
  })

  it('zooms an orthographic camera by its view height', () => {
    const { control, camera } = orbit({}, new OrthographicCamera({ position: [0, 0, 10], target: [0, 0, 0], height: 8 }))
    control.zoomBy(0.5)
    expect(camera.height).toBe(4)
    expect(camera.position.z).toBe(10)
  })

  it('pans the camera and its target together, a pixel at a time at the target\'s distance', () => {
    const { control, camera } = orbit()
    control.panBy(30, 0)
    // dragging right moves the scene right: the camera goes left, as much as 30 pixels covers 10 away
    const perPixel = 2 * 10 * Math.tan(Math.PI * 50 / 360) / 150
    expect(round(camera.position.x)).toBe(round(-30 * perPixel))
    expect(round(control.target.x)).toBe(round(camera.position.x))
    expect(round(control.spherical.distance)).toBe(10)
  })
})

describe('orbit by pointer', () => {
  it('turns with a left drag, pans with a right drag, and pans with every drag as a map', () => {
    const { control, element } = orbit()
    drag(element, [100, 75], [150, 75])
    expect(round(control.spherical.yaw)).toBe(round(-50 * 0.005))
    expect(control.target.toArray()).toEqual([0, 0, 0])

    const panned = orbit()
    drag(panned.element, [100, 75], [150, 75], 2)
    expect(panned.control.target.x).toBeLessThan(0)
    expect(round(panned.control.spherical.yaw)).toBe(0)

    const map = orbit({ mode: 'map' })
    drag(map.element, [100, 75], [150, 75])
    expect(map.control.target.x).toBeLessThan(0)
    expect(round(map.control.spherical.yaw)).toBe(0)
  })

  it("leaves the camera alone when disabled, or when pan: false and the drag would pan", () => {
    const off = orbit({ enabled: false })
    drag(off.element, [100, 75], [150, 75])
    expect(off.camera.position.toArray()).toEqual([0, 0, 10])
    const noPan = orbit({ pan: false })
    drag(noPan.element, [100, 75], [150, 75], 2)
    expect(noPan.camera.position.toArray()).toEqual([0, 0, 10])
  })

  it('zooms with the wheel, by zoomSpeed a notch, unless zoom: false', () => {
    const { control, element } = orbit({ zoomSpeed: 0.2, zoomToCursor: false })
    element.dispatch('wheel', { deltaY: 100, clientX: 150, clientY: 75 })
    expect(round(control.spherical.distance)).toBe(12)
    element.dispatch('wheel', { deltaY: -100, clientX: 150, clientY: 75 })
    expect(round(control.spherical.distance)).toBe(9.6)
    const fixed = orbit({ zoom: false })
    fixed.element.dispatch('wheel', { deltaY: 100, clientX: 150, clientY: 75 })
    expect(round(fixed.control.spherical.distance)).toBe(10)
  })

  it('zooms toward the pointer, keeping the point under it still', () => {
    const { control, element } = orbit()
    // at the middle of the canvas: straight in, like zoomBy
    element.dispatch('wheel', { deltaY: -100, clientX: 150, clientY: 75 })
    expect(round(control.spherical.distance)).toBe(9)
    expect(control.target.toArray().map(round)).toEqual([0, 0, 0])
    // off to the side: the target slides toward the pointer
    element.dispatch('wheel', { deltaY: -100, clientX: 250, clientY: 75 })
    expect(control.target.x).toBeGreaterThan(0)
  })

  it("doesn't let a drag count as a click", () => {
    const { element } = orbit()
    drag(element, [100, 75], [150, 75])
    let stopped = false
    element.dispatch('click', { stopImmediatePropagation: () => { stopped = true } })
    expect(stopped).toBe(true)
    // a click without a drag goes through
    element.dispatch('pointerdown', { pointerId: 2, button: 0, pointerType: 'mouse', clientX: 10, clientY: 10 })
    element.dispatch('pointerup', { pointerId: 2, clientX: 10, clientY: 10 })
    stopped = false
    element.dispatch('click', { stopImmediatePropagation: () => { stopped = true } })
    expect(stopped).toBe(false)
  })
})

describe('orbit over time', () => {
  it('turns by itself with autoRotate - half a radian a second, or the speed given - but not mid-drag', () => {
    const { control } = orbit({ autoRotate: true })
    control.update(1)
    expect(round(control.spherical.yaw)).toBe(-0.5)
    const fast = orbit({ autoRotate: 0.2 })
    fast.control.update(2)
    expect(round(fast.control.spherical.yaw)).toBe(-0.4)
    // a finger down holds it
    fast.element.dispatch('pointerdown', { pointerId: 1, button: 0, pointerType: 'touch', clientX: 10, clientY: 10 })
    fast.control.update(1)
    expect(round(fast.control.spherical.yaw)).toBe(-0.4)
  })

  it('glides on after a quick drag, slowing by inertia - and stops at once with inertia 0', () => {
    const { control, element } = orbit({ inertia: 0.9 })
    drag(element, [100, 75], [140, 75])
    const after = control.spherical.yaw
    control.update(1 / 60)
    const first = control.spherical.yaw - after
    control.update(1 / 60)
    const second = control.spherical.yaw - after - first
    expect(first).toBeLessThan(0)
    // each step a tenth slower
    expect(round(second / first)).toBe(0.9)

    const still = orbit({ inertia: 0 })
    drag(still.element, [100, 75], [140, 75])
    const yaw = still.control.spherical.yaw
    still.control.update(1 / 60)
    expect(still.control.spherical.yaw).toBe(yaw)
  })

  it('does nothing over time when disabled', () => {
    const { control } = orbit({ autoRotate: true, enabled: false })
    control.update(1)
    expect(round(control.spherical.yaw)).toBe(0)
  })
})
