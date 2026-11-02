// Sending a changed texture to the GPU: into the storage it already has, and - given the region that
// changed - only that, so a big canvas drawn on a little each frame costs little to keep up to date.
import { describe, expect, it } from 'vitest'
import { Mesh, PerspectiveCamera, Scene, Texture, WebGLRenderer, box } from '../src/index.js'
import { fakeCanvas, fakeGL } from './fakes.js'

const camera = () => new PerspectiveCamera({ position: [0, 0, 5], target: [0, 0, 0], aspect: 1 })
/** A width x height image of raw pixels. @param {number} width @param {number} height */
const pixels = (width = 64, height = 32) => ({ data: new Uint8Array(width * height * 4), width, height })

/** A renderer drawing one textured box, keeping the texture uploads and unpack settings it makes. @param {Texture} map */
function recording(map) {
  const { gl } = fakeGL()
  /** @type {{ call: string, args: any[], unpack: Record<string, number> }[]} */
  const uploads = []
  const unpack = { skipPixels: 0, skipRows: 0, rowLength: 0 }
  const names = { [gl.UNPACK_SKIP_PIXELS]: 'skipPixels', [gl.UNPACK_SKIP_ROWS]: 'skipRows', [gl.UNPACK_ROW_LENGTH]: 'rowLength' }
  const proxy = new Proxy(gl, {
    get(target, key) {
      if (key === 'texImage2D' || key === 'texSubImage2D') return (...args) => uploads.push({ call: key, args, unpack: { ...unpack } })
      if (key === 'pixelStorei') return (name, value) => { if (names[name]) unpack[names[name]] = value }
      return target[key]
    },
  })
  const renderer = new WebGLRenderer({ canvas: fakeCanvas(proxy) })
  renderer.setSize(10, 10)
  const scene = new Scene()
  scene.add(new Mesh({ geometry: box(1), material: { unlit: true, map } }))
  const draw = () => {
    uploads.length = 0
    renderer.render(scene, camera())
    return uploads.slice()
  }
  return { draw, unpack, renderer, scene }
}
/** Where a texSubImage2D put its pixels: x, y, width, height. */
const placed = (u) => u.args.slice(2, 6)

describe('updating a texture', () => {
  it('makes its storage once, then fills the same storage again', () => {
    const map = new Texture({ image: pixels() })
    const { draw } = recording(map)
    expect(draw().map((u) => u.call)).toEqual(['texImage2D'])
    expect(draw()).toEqual([])
    map.needsUpdate()
    const [refill] = draw()
    expect(refill.call).toBe('texSubImage2D')
    expect(placed(refill)).toEqual([0, 0, 64, 32])
  })

  it('sends only the region that changed - and each region since the last upload', () => {
    const map = new Texture({ image: pixels() })
    const { draw, unpack } = recording(map)
    draw()
    map.needsUpdate({ x: 10.5, y: 4, width: 6, height: 3.2 })
    const [part] = draw()
    expect(placed(part)).toEqual([10, 4, 7, 4])
    // read from that place in the image, a row of the whole image apart, then put back
    expect(part.unpack).toEqual({ skipPixels: 10, skipRows: 4, rowLength: 64 })
    expect(unpack).toEqual({ skipPixels: 0, skipRows: 0, rowLength: 0 })
    map.needsUpdate({ x: 2, y: 2, width: 2, height: 2 })
    map.needsUpdate({ x: 30, y: 20, width: 4, height: 4 })
    expect(draw().map(placed)).toEqual([[2, 2, 2, 2], [30, 20, 4, 4]])
    // past sixteen, those near each other as one: here in two quarters of the image (16 x 8 cells)
    for (let i = 0; i < 10; i++) map.needsUpdate({ x: i, y: 1, width: 1, height: 1 })
    for (let i = 0; i < 10; i++) map.needsUpdate({ x: 50 + i, y: 25, width: 1, height: 1 })
    expect(draw().map(placed)).toEqual([[0, 1, 10, 1], [50, 25, 10, 1]])
    // and a frame of a few hundred small changes is still told apart, not sent whole
    for (let i = 0; i < 200; i++) map.needsUpdate({ x: 1, y: 1, width: 1, height: 1 })
    expect(draw().map(placed)).toEqual([[1, 1, 1, 1]])
  })

  it('sends it all when an update since gave no region, or the image changed size or is flipped', () => {
    const map = new Texture({ image: pixels() })
    const { draw } = recording(map)
    draw()
    map.needsUpdate({ x: 2, y: 2, width: 2, height: 2 })
    map.needsUpdate()
    expect(placed(draw()[0])).toEqual([0, 0, 64, 32])
    map.image = pixels(128, 32)
    expect(draw().map((u) => u.call)).toEqual(['texImage2D'])
    map.flipY = true
    map.needsUpdate({ x: 2, y: 2, width: 2, height: 2 })
    expect(placed(draw()[0])).toEqual([0, 0, 128, 32])
  })

  it('keeps a region inside the image, and sends nothing for one outside it', () => {
    const map = new Texture({ image: pixels() })
    const { draw } = recording(map)
    draw()
    map.needsUpdate({ x: -5, y: 28, width: 10, height: 10 })
    expect(placed(draw()[0])).toEqual([0, 28, 5, 4])
    map.needsUpdate({ x: 100, y: 0, width: 10, height: 10 })
    expect(draw()).toEqual([])
  })

  it('brings each renderer up to date from wherever it was', () => {
    const map = new Texture({ image: pixels() })
    const a = recording(map), b = recording(map)
    a.draw()
    b.draw()
    map.needsUpdate({ x: 0, y: 0, width: 4, height: 4 })
    a.draw()
    map.needsUpdate({ x: 20, y: 10, width: 4, height: 4 })
    // a missed one update, b both
    expect(a.draw().map(placed)).toEqual([[20, 10, 4, 4]])
    expect(b.draw().map(placed)).toEqual([[0, 0, 4, 4], [20, 10, 4, 4]])
  })

  it('says what needsUpdate() takes', () => {
    const map = new Texture({ image: pixels() })
    expect(() => map.needsUpdate(/** @type {any} */ ({ x: 1, y: 2, width: 'all' }))).toThrow(/x, y, width, height/)
    expect(() => map.needsUpdate({ x: 1, y: 2, width: -3, height: 2 })).toThrow(/needsUpdate/)
    expect(map.needsUpdate({ x: 0, y: 0, width: 0, height: 0 })).toBe(map)
  })
})
