import { describe, expect, it } from 'vitest'
import { OrbitControl } from '../src/OrbitControl.js'
import { Scene } from '../src/scene.js'

// minimal stand-in for a canvas - the control only needs listeners, style and a height
const element = () => ({
  style: {},
  clientHeight: 500,
  addEventListener() {},
  removeEventListener() {},
})

function setup(position = { x: 0, y: 0, z: -10 }) {
  const scene = new Scene()
  scene.camera.position = position
  return { scene, orbit: new OrbitControl(element(), scene) }
}

describe('OrbitControl', () => {
  it('reads the camera as yaw, pitch and distance around the look-at point', () => {
    const { orbit } = setup({ x: 0, y: 10, z: 0.0001 })
    const s = orbit.spherical
    expect(s.distance).toBeCloseTo(10)
    expect(s.pitch).toBeCloseTo(Math.PI / 2)
  })

  it('orbits at a constant distance', () => {
    const { scene, orbit } = setup()
    orbit.rotate(Math.PI / 2, 0)
    const { x, y, z } = scene.camera.position
    expect(Math.hypot(x, y, z)).toBeCloseTo(10)
    expect(x).toBeCloseTo(-10)
    expect(z).toBeCloseTo(0)
  })

  it('clamps pitch short of the poles and distance to its limits', () => {
    const { orbit } = setup()
    orbit.minDistance = 5
    orbit.rotate(0, 10)
    expect(orbit.spherical.pitch).toBeCloseTo(orbit.maxPitch)
    orbit.zoomBy(0.01)
    expect(orbit.spherical.distance).toBeCloseTo(5)
  })

  it('pans the camera and look-at point together', () => {
    const { scene, orbit } = setup()
    orbit.panBy(100, 0)
    const { position: p, lookat: t } = scene.camera
    // dragging right moves the camera left (-x on screen is -x in world for this view)
    expect(t.x).toBeLessThan(0)
    expect(p.x).toBeCloseTo(t.x)
    expect(p.z - t.z).toBeCloseTo(-10)
  })
})
