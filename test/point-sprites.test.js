// Points each their own size, opacity and angle - drawn as squares, one instance a point, and back to
// front when asked - and the emitter looks (size, opacity, spin over a particle's life) that use them.
import { describe, expect, it } from 'vitest'
import { Geometry, PerspectiveCamera, Points, Scene, WebGLRenderer } from '../src/index.js'
import { Emitter } from '../src/particles/index.js'
import { fakeCanvas, fakeGL } from './fakes.js'

const camera = () => new PerspectiveCamera({ position: [0, 0, 5], target: [0, 0, 0], aspect: 1 })

/** A renderer drawing the points, keeping its draws and the instance data it sends. @param {Points} points */
function recording(points) {
  const { gl } = fakeGL()
  /** @type {{ call: string, args: any[] }[]} */
  const calls = []
  const proxy = new Proxy(gl, {
    get(target, key) {
      if (key === 'drawArrays' || key === 'drawArraysInstanced' || key === 'bufferSubData') {
        return (...args) => {
          calls.push({ call: key, args: key === 'bufferSubData' ? [args[2].slice(args[3], args[3] + args[4])] : args })
          return target[key](...args)
        }
      }
      return target[key]
    },
  })
  const renderer = new WebGLRenderer({ canvas: fakeCanvas(proxy) })
  renderer.setSize(10, 10)
  const scene = new Scene()
  scene.add(points)
  const draw = () => {
    calls.length = 0
    renderer.render(scene, camera())
    return calls.slice()
  }
  return { draw }
}
/** Which point each instance is, from the data sent: the last of ten floats an instance. @param {Float32Array} data */
const order = (data) => Array.from({ length: data.length / 10 }, (_, j) => data[j * 10 + 9])

describe('points drawn as squares', () => {
  it('stay GL points with no sizes, opacities or angles', () => {
    const points = new Points({ geometry: new Geometry({ positions: [0, 0, 0, 1, 0, 0] }) })
    expect(points.drawsSprites).toBe(false)
    const draws = recording(points).draw().filter((c) => c.call.startsWith('draw'))
    expect(draws.map((c) => c.call)).toEqual(['drawArrays'])
  })

  it('draw a square a point, each with its own size, opacity and angle', () => {
    const geometry = new Geometry({ positions: [0, 0, 0, 1, 0, 0], sizes: [2, 3], opacities: [0.5, 1], angles: [0, 1] })
    const points = new Points({ geometry })
    expect(points.drawsSprites).toBe(true)
    const calls = recording(points).draw()
    const draw = calls.find((c) => c.call === 'drawArraysInstanced')
    // a strip of 4 corners, an instance a point
    expect(draw?.args.slice(1)).toEqual([0, 4, 2])
    const data = calls.find((c) => c.call === 'bufferSubData')?.args[0]
    // position, colour (white with no colours), size, opacity, angle, index
    expect(Array.from(data.slice(0, 10))).toEqual([0, 0, 0, 1, 1, 1, 2, 0.5, 0, 0])
    expect(Array.from(data.slice(10, 20))).toEqual([1, 0, 0, 1, 1, 1, 3, 1, 1, 1])
  })

  it('sends the data again only when the geometry changes - unless sorting', () => {
    const geometry = new Geometry({ positions: [0, 0, 0, 1, 0, 0], sizes: [1, 1] })
    const { draw } = recording(new Points({ geometry }))
    draw()
    expect(draw().filter((c) => c.call === 'bufferSubData')).toEqual([])
    geometry.needsUpdate()
    expect(draw().filter((c) => c.call === 'bufferSubData')).toHaveLength(1)
  })

  it('go furthest first when sorted, re-sorting every frame', () => {
    // the camera looks down -z from z = 5: z = -2 is furthest, z = 2 nearest
    const geometry = new Geometry({ positions: [0, 0, 0, 0, 0, -2, 0, 0, 2] })
    const points = new Points({ geometry, sort: true })
    expect(points.drawsSprites).toBe(true)
    const { draw } = recording(points)
    const sent = () => draw().find((c) => c.call === 'bufferSubData')?.args[0]
    expect(order(sent())).toEqual([1, 0, 2])
    // the points turned round: the order follows
    points.rotation.y = Math.PI
    expect(order(sent())).toEqual([2, 0, 1])
  })

  it('keep their sizes, opacities and angles through clone and JSON', () => {
    const geometry = new Geometry({ positions: [0, 0, 0, 1, 0, 0], sizes: [2, 3], opacities: [0.5, 1], angles: [0, 1] })
    for (const copy of [geometry.clone(), new Geometry(JSON.parse(JSON.stringify(geometry.toJSON())))]) {
      expect(Array.from(copy.sizes ?? [])).toEqual([2, 3])
      expect(Array.from(copy.opacities ?? [])).toEqual([0.5, 1])
      expect(Array.from(copy.angles ?? [])).toEqual([0, 1])
    }
    expect(() => new Geometry({ positions: [0, 0, 0], sizes: [1, 2] })).toThrow('sizes')
  })
})

describe('Emitter looks', () => {
  it('leaves plain particles as GL points', () => {
    const e = new Emitter()
    expect(e.drawsSprites).toBe(false)
    expect(e.geometry.sizes).toBe(null)
  })

  it('grows and fades particles through the stops over their lives', () => {
    const e = new Emitter({ rate: 0, lifetime: 2, size: [1, 3], opacity: [0, 1, 0] })
    expect(e.drawsSprites).toBe(true)
    e.burst(1)
    e.step(0.5)
    expect(e.geometry.sizes?.[0]).toBeCloseTo(1.5)
    expect(e.geometry.opacities?.[0]).toBeCloseTo(0.5)
    e.step(0.5)
    expect(e.geometry.sizes?.[0]).toBeCloseTo(2)
    expect(e.geometry.opacities?.[0]).toBeCloseTo(1)
    e.step(0.5)
    expect(e.geometry.opacities?.[0]).toBeCloseTo(0.5)
  })

  it('varies each particle\'s size by up to sizeSpread', () => {
    const e = new Emitter({ rate: 0, size: 2, sizeSpread: 0.25 })
    e.burst(200)
    const sizes = Array.from(e.geometry.sizes ?? []).slice(0, 200)
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(1.5)
    expect(Math.max(...sizes)).toBeLessThanOrEqual(2.5)
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeGreaterThan(0.5)
  })

  it('turns particles at their spin', () => {
    const e = new Emitter({ rate: 0, lifetime: 10, spin: [2, 2] })
    e.burst(1)
    const start = e.geometry.angles?.[0] ?? NaN
    e.step(0.5)
    expect(e.geometry.angles?.[0]).toBeCloseTo(start + 1)
    expect(new Emitter({ spin: 3 }).spin).toEqual([-3, 3])
  })

  it('keeps each particle\'s look when another dies and takes its slot', () => {
    const e = new Emitter({ rate: 0, size: [1, 5], sizeSpread: 0.5, spin: [1, 1] })
    e.burst(1, { lifetime: 0.5 })
    e.burst(1, { lifetime: 10 })
    const angle = e.geometry.angles?.[1] ?? NaN
    // its own size factor, from its size at birth
    const factor = e.geometry.sizes?.[1] ?? NaN
    e.step(0.6)
    expect(e.count).toBe(1)
    // the survivor moved into slot 0, its angle and size factor with it: 6% through its life
    expect(e.geometry.angles?.[0]).toBeCloseTo(angle + 0.6)
    expect(e.geometry.sizes?.[0]).toBeCloseTo(factor * 1.24)
  })

  it('takes the looks later through set() and the properties, and keeps them through clone and JSON', () => {
    const e = new Emitter()
    e.set({ opacity: [1, 0] })
    e.size = [0.5, 2]
    expect(e.drawsSprites).toBe(true)
    const { type, ...json } = /** @type {any} */ (e.toJSON())
    expect(type).toBe('emitter')
    for (const copy of [e.clone(), new Emitter(json)]) {
      expect(copy.size).toEqual([0.5, 2])
      expect(copy.opacity).toEqual([1, 0])
    }
    expect(() => e.set({ size: -1 })).toThrow('size')
    expect(() => new Emitter({ spin: 'fast' })).toThrow('spin')
  })
})
