// GPU picking draws only what can reach the few pixels round the pointer: a solid mesh whose bounds
// are elsewhere is left out, so hovering over a warehouse of thousands of parts draws a dozen.
// Points, lines and instances reach past their bounds (sprites, widths, copies spread anywhere) and
// are always drawn.
import { describe, expect, it, vi } from 'vitest'
import { Geometry, InstancedMesh, Mesh, PerspectiveCamera, Points, Scene, box } from '../src/index.js'
import { WebGLRenderer } from '../src/webgl/WebGLRenderer.js'
import { fakeCanvas, fakeGL } from './fakes.js'

const camera = () => new PerspectiveCamera({ position: [0, 0, 10], target: [0, 0, 0], aspect: 1 })

/** A renderer with its picking code loaded, and a frame of the scene. @param {Scene} scene */
async function ready(scene) {
  const { gl, drawLog } = fakeGL()
  const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl) })
  renderer.setSize(640, 640)
  let loaded = 0
  renderer.onReady = () => loaded++
  let frame = renderer.render(scene, camera())
  // the first pick loads the picking code; the frame drawn once anything else lazy is in
  renderer.pick(frame, 320, 320)
  await vi.waitFor(() => expect(loaded).toBeGreaterThan(0))
  frame = renderer.render(scene, camera())
  // what one pick at (x, y) drew: the draws into the pick's 33 x 33 target
  const pickDraws = (/** @type {number} */ x, /** @type {number} */ y) => {
    const from = drawLog.length
    renderer.pick(frame, x, y)
    return drawLog.slice(from).filter((d) => d.viewport[2] === 33).length
  }
  return { renderer, frame, pickDraws }
}

/** A 5 x 5 grid of unit boxes across the view, the middle one at the origin. @param {Scene} scene */
const grid = (scene) => {
  const boxes = []
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) boxes.push(scene.add(new Mesh({ geometry: box(1), position: [i * 1.5, j * 1.5, 0] })))
  return boxes
}

describe('the pick pass', () => {
  it('draws only the meshes whose bounds reach the pointer', async () => {
    const scene = new Scene()
    grid(scene)
    const { renderer, frame, pickDraws } = await ready(scene)
    expect(frame.opaque.length).toBe(25)
    // the middle of the canvas: the middle box alone
    expect(pickDraws(320, 320)).toBe(1)
    // halfway to the next box: both their bounding spheres reach it (a unit box's is 0.87 round)
    expect(pickDraws(320 + 0.75 / 9.33 * 640, 320)).toBe(2)
    // off the grid's right edge, past every sphere: nothing to draw, and no draw at all
    expect(pickDraws(630, 320)).toBe(0)
    renderer.dispose(scene)
  })

  it('still draws points, instances, hooks without bounds and what asks not to be culled', async () => {
    const scene = new Scene()
    grid(scene)
    scene.add(new Points({ geometry: new Geometry({ positions: [3, 3, 0] }), material: { size: 40, sizeAttenuation: false } }))
    scene.add(new InstancedMesh({ geometry: box(0.5), instances: [{ position: [3, -3, 0] }] }))
    scene.add(new Mesh({ geometry: box(0.5), position: [-3, 3, 0], frustumCulled: false }))
    scene.add(new Mesh({ geometry: box(0.5), position: [-3, -3, 0], material: { shader: { vertex: 'position.y += 0.0;' } } }))
    // a hook that says how far it moves things is culled by that much more
    scene.add(new Mesh({ geometry: box(0.5), position: [3, 0, 0], material: { shader: { vertex: 'position.y += 0.0;', bounds: 0.1 } } }))
    const { renderer, pickDraws } = await ready(scene)
    // the middle box, the points, the instances, the unculled mesh, the hook without bounds
    expect(pickDraws(320, 320)).toBe(5)
    renderer.dispose(scene)
  })
})
