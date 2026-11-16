// Refining a still view: the samples' sub-pixel shifts and light samples, a frame's lights moved
// across their size, and the View drawing samples while nothing changes - shown once enough are in,
// resting at its budget, starting again on any change.
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { DirectionalLight, Mesh, PerspectiveCamera, RectAreaLight, Scene, SpotLight, View, box, plane } from '../src/index.js'
import { collect } from '../src/frame.js'
import { REVEAL, halton, jitterFrame, lensFrame, lensSample, lightSample, noiseShift, pixelShift, tent } from '../src/refine.js'
import { fakePage } from './fakes.js'

describe('refine samples', () => {
  it('spread by Halton sequences, none past the pixel', () => {
    expect([1, 2, 3, 4].map((n) => halton(n, 2))).toEqual([0.5, 0.25, 0.75, 0.125])
    expect(halton(1, 3)).toBeCloseTo(1 / 3)
    expect(pixelShift(0)[0]).toBe(0)
    for (let n = 0; n < 256; n++) {
      for (const d of pixelShift(n)) expect(Math.abs(d)).toBeLessThan(1)
      for (const u of lightSample(n)) expect(u >= 0 && u < 1).toBe(true)
    }
    // a tent: most near the middle
    const near = Array.from({ length: 1000 }, (_, i) => tent((i + 0.5) / 1000)).filter((d) => Math.abs(d) < 0.5).length
    expect(near).toBe(750)
  })

  it('shift the projection by part of a pixel - the camera itself left alone', () => {
    const camera = new PerspectiveCamera({ position: [0, 0, 5], target: [0, 0, 0], aspect: 2 })
    const frame = collect(new Scene(), camera)
    const before = frame.camera.projection.slice()
    jitterFrame(frame, 1, 200, 100)
    const [dx, dy] = pixelShift(1)
    // a point straight ahead lands dx pixels across, dy up
    const p = frame.camera.projection
    const w = -p[11] + p[15], x = (-p[8] + p[12]) / w, y = (-p[9] + p[13]) / w
    expect(x * 100).toBeCloseTo(dx)
    expect(y * 50).toBeCloseTo(dy)
    expect([...camera.projectionMatrix]).toEqual([...before])
  })
})

describe('depth of field', () => {
  /** Where a world point lands on the screen, in normalised device coordinates. @param {any} m @param {number[]} p */
  const onScreen = (m, [x, y, z]) => {
    const w = m[3] * x + m[7] * y + m[11] * z + m[15]
    return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w]
  }
  const frameAt = () => {
    const camera = new PerspectiveCamera({ position: [0, 0, 10], target: [0, 0, 0], aspect: 1 })
    return { camera, frame: collect(new Scene(), camera) }
  }

  it('looks from a point on the lens: the focal plane where it was, nearer and further moved apart', () => {
    const { frame } = frameAt()
    const before = frame.camera.viewProjection.slice()
    // a sample off the lens's middle
    const n = [...Array(16).keys()].find((i) => Math.hypot(...lensSample(i)) > 0.5) ?? 1
    lensFrame(frame, n, 0.2, 10)
    const after = frame.camera.viewProjection
    // on the focal plane (10 ahead: the origin's plane), every point stays put
    for (const p of [[0, 0, 0], [1.5, -2, 0], [-3, 1, 0]]) {
      const [a, b] = [onScreen(before, p), onScreen(after, p)]
      expect(a[0]).toBeCloseTo(b[0], 5)
      expect(a[1]).toBeCloseTo(b[1], 5)
    }
    // off it, points move - the nearer, the more, and opposite ways either side
    const near = onScreen(after, [0, 0, 5])[0] - onScreen(before, [0, 0, 5])[0]
    const far = onScreen(after, [0, 0, -10])[0] - onScreen(before, [0, 0, -10])[0]
    expect(Math.abs(near)).toBeGreaterThan(1e-3)
    expect(Math.sign(near)).toBe(-Math.sign(far))
    // the eye moved across the lens with it
    expect(frame.camera.position.distanceTo(new (/** @type {any} */ (frame.camera.position).constructor)(0, 0, 10))).toBeCloseTo(0.2 * Math.hypot(...lensSample(n)), 5)
  })

  it('does nothing without an aperture, or through an orthographic camera; focuses on the target unless told', () => {
    const { frame } = frameAt()
    const before = frame.camera
    lensFrame(frame, 3, 0, 10)
    expect(frame.camera).toBe(before)
    const { camera } = frameAt()
    expect(camera.focus).toBeCloseTo(10)
    camera.focusDistance = 4
    expect(camera.focus).toBe(4)
    expect(new PerspectiveCamera({ aperture: 0.1, focusDistance: 3 }).toJSON()).toMatchObject({ aperture: 0.1, focusDistance: 3 })
  })
})

describe('a refine sample of a frame', () => {
  const scene = () => {
    const s = new Scene()
    s.add(new Mesh({ geometry: plane(10), receiveShadow: true }))
    s.add(new Mesh({ geometry: box(1), position: [0, 0.5, 0], castShadow: true }))
    s.updateWorldTree()
    return s
  }
  const camera = new PerspectiveCamera({ position: [0, 4, 8], target: [0, 0, 0] })

  it('draws a rect light\'s shadow sharp, from a point on it - lit, as ever, from all of it', () => {
    const s = scene()
    const light = s.add(new RectAreaLight({ position: [0, 4, 0], width: 2, height: 1, direction: [0, -1, 0], castShadow: true }))
    s.updateWorldTree()
    const plain = collect(s, camera).lights[0]
    const sampled = collect(s, camera, { lightSample: [1, 0] }).lights[0]
    expect(plain.shadowFrom).toBeUndefined()
    expect(sampled.hardShadow).toBe(true)
    expect([...sampled.position]).toEqual([...plain.position])
    // a corner: half the width one way, half the height the other
    expect(sampled.shadowFrom?.distanceTo(light.worldPosition)).toBeCloseTo(Math.hypot(1, 0.5))
  })

  it("tilts a soft sun across the angle its softness gives it, sharp from there - and leaves a spot's soft shadow be", () => {
    const s = scene()
    s.add(new DirectionalLight({ direction: [0, -1, 0], castShadow: true, shadowSoftness: 0.5 }))
    s.add(new SpotLight({ position: [0, 5, 0], direction: [0, -1, 0], castShadow: true, shadowSoftness: 1 }))
    s.add(new SpotLight({ position: [3, 5, 0], direction: [0, -1, 0], castShadow: true }))
    s.updateWorldTree()
    const [sun, soft, sharp] = collect(s, camera, { lightSample: [1, 0.5] }).lights
    // the disc's edge: tilted by the spread, 0.2 at softness 1
    expect(Math.atan2(Math.hypot(/** @type {any} */ (sun.direction)[0], sun.direction?.[2] ?? 0), -(/** @type {any} */ (sun.direction)[1]))).toBeCloseTo(Math.atan(0.1))
    expect(sun.shadowSoftness).toBe(0)
    // a spot's edge spreads with the gap whatever the distance - no one size of light does that, so it
    // keeps its soft shadow, the samples averaging its grain away
    expect([...(/** @type {any} */ (soft.position))]).toEqual([0, 5, 0])
    expect(soft.shadowSoftness).toBe(1)
    expect([...(/** @type {any} */ (sharp.position))]).toEqual([3, 5, 0])
    // and each sample reads the blue noise somewhere else
    expect(new Set(Array.from({ length: 16 }, (_, n) => noiseShift(n).join())).size).toBe(16)
  })
})

describe('View refine', () => {
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
  let clock = 0
  const frame = () => page.frame((clock += 16))
  /** A view that can refine (its stand-in context has no float targets, so it is told it can). */
  const viewOf = (/** @type {any} */ options = {}) => {
    const view = new View({ canvas: page.canvas(), camera: { position: [0, 0, 10], target: [0, 0, 0] }, ...options })
    Object.defineProperty(view.renderer, 'canRefine', { get: () => true })
    view.scene.add(new Mesh({ geometry: box(1) }))
    made.push(view)
    return view
  }
  /** What each frame drew: 'live', or a sample's index and whether it was shown. */
  const watch = (/** @type {View} */ view) => {
    /** @type {(string | [number, boolean])[]} */
    const log = []
    const draw = view.renderer.renderFrame.bind(view.renderer)
    vi.spyOn(view.renderer, 'renderFrame').mockImplementation((f, o = {}) => {
      log.push(o.accumulate ? [o.accumulate.index, o.accumulate.show] : 'live')
      return draw(f, o)
    })
    return log
  }

  it('is off unless asked; true is 256 samples, or as many as given', () => {
    expect(viewOf().refine).toBe(null)
    expect(viewOf({ refine: true }).refine).toEqual({ samples: 256 })
    expect(viewOf({ refine: { samples: 40 } }).refine).toEqual({ samples: 40 })
    expect(() => viewOf({ refine: { count: 8 } })).toThrow("use 'samples'")
    expect(() => viewOf({ refine: { samples: 0 } })).toThrow('samples')
  })

  it('draws samples while nothing changes - shown once enough are in - rests at its budget, and starts again on a change', () => {
    const view = viewOf({ refine: { samples: 20 } })
    frame()
    const log = watch(view)
    for (let i = 0; i < 25; i++) frame()
    expect(log.length).toBe(20)
    expect(log[0]).toEqual([0, false])
    expect(log[REVEAL - 2]).toEqual([REVEAL - 2, false])
    expect(log[REVEAL - 1]).toEqual([REVEAL - 1, true])
    expect(log[19]).toEqual([19, true])
    // a change: a plain frame, and the average starts again
    view.scene.children[0].position.x = 1
    frame()
    frame()
    expect(log.slice(20)).toEqual(['live', [0, false]])
  })

  it('shows its last sample when its budget is under the reveal', () => {
    const view = viewOf({ refine: { samples: 4 } })
    frame()
    const log = watch(view)
    for (let i = 0; i < 6; i++) frame()
    expect(log).toEqual([[0, false], [1, false], [2, false], [3, true]])
  })

  it("doesn't refine while drawing every frame, while debugging, or without float targets", () => {
    const always = viewOf({ refine: true, renderMode: 'always' })
    frame()
    const log = watch(always)
    frame()
    frame()
    expect(log).toEqual(['live', 'live'])
    const plain = new View({ canvas: page.canvas(), refine: true })
    made.push(plain)
    plain.scene.add(new Mesh({ geometry: box(1) }))
    frame()
    const none = watch(plain)
    frame()
    frame()
    expect(none).toEqual([])
  })
})
