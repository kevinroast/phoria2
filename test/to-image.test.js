// view.toImage() at a size other than the canvas's: drawn larger or smaller (scale, width or height),
// read at that size, and the canvas put back as it was.
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { Mesh, View, box } from '../src/index.js'
import { fakePage } from './fakes.js'

const page = fakePage()
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 50))
  page.restore()
})
/** @type {View[]} */
const made = []
afterEach(() => {
  for (const v of made.splice(0)) v.dispose()
  page.frame(0)
})

/** A view of a box, pixel ratio 1, whose canvas records the size it was read at. */
const viewOf = () => {
  const canvas = /** @type {any} */ (page.canvas())
  /** @type {[number, number][]} */
  const read = []
  canvas.toBlob = (/** @type {(b: Blob) => void} */ done) => {
    read.push([canvas.width, canvas.height])
    done(new Blob(['png']))
  }
  const view = new View({ canvas, pixelRatio: 1, camera: { position: [0, 0, 5], target: [0, 0, 0] } })
  view.scene.add(new Mesh({ geometry: box(1) }))
  made.push(view)
  return { view, canvas, read }
}

describe('toImage() at another size', () => {
  it('reads the canvas at its own size by default', async () => {
    const { view, read } = viewOf()
    await view.toImage({ labels: false })
    expect(read).toEqual([[300, 150]])
  })

  it('draws scale times the size, or a width or height with the shape kept - then puts the canvas back', async () => {
    const { view, canvas, read } = viewOf()
    const styled = canvas.style.width
    await view.toImage({ scale: 2, labels: false })
    await view.toImage({ width: 600, labels: false })
    await view.toImage({ height: 75, labels: false })
    await view.toImage({ width: 900, height: 450, labels: false })
    expect(read).toEqual([[600, 300], [600, 300], [150, 75], [900, 450]])
    expect([canvas.width, canvas.height]).toEqual([300, 150])
    // its size on the page is left as it was
    expect(canvas.style.width).toBe(styled)
  })

  it('says what it takes', async () => {
    const { view } = viewOf()
    await expect(view.toImage({ scale: 2, width: 600 })).rejects.toThrow("'scale' or a 'width' / 'height', not both")
    await expect(view.toImage({ width: 600, height: 600 })).rejects.toThrow("draws the canvas's shape (300 x 150)")
    await expect(view.toImage({ scale: 0 })).rejects.toThrow('scale')
  })
})
