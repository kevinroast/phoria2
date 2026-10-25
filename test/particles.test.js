import { describe, expect, it } from 'vitest'
import { Geometry, Group, OrthographicCamera, Points, Raycaster, Scene } from '../src/index.js'
import { Body, Emitter } from '../src/particles/index.js'

describe('Emitter', () => {
  it('births particles at its rate and draws only the live ones', () => {
    const e = new Emitter({ max: 100, rate: 20, lifetime: 5 })
    e.step(0.5)
    expect(e.count).toBe(10)
    expect(e.geometry.drawCount).toBe(10)
    expect(e.geometry.drawnCount).toBe(10)
    e.step(10)
    // each lived 5 s, and the 200 due this step are capped at max
    expect(e.count).toBe(100)
  })

  it('removes particles at the end of their lives', () => {
    const e = new Emitter({ rate: 0, lifetime: 1 })
    e.burst(5)
    e.step(0.5)
    expect(e.count).toBe(5)
    e.step(0.6)
    expect(e.count).toBe(0)
  })

  it('moves particles under velocity, gravity and drag', () => {
    const e = new Emitter({ rate: 0, velocity: [1, 0, 0], gravity: [0, -10, 0], lifetime: 10 })
    e.burst(1)
    e.step(0.1)
    e.step(0.1)
    const [x, y] = e.geometry.positions
    expect(x).toBeCloseTo(0.2)
    // semi-implicit Euler: v = -1 then -2, so y = -0.1 - 0.2
    expect(y).toBeCloseTo(-0.3)

    const slow = new Emitter({ rate: 0, velocity: [10, 0, 0], drag: 1, lifetime: 10 })
    slow.burst(1)
    slow.step(1)
    expect(slow.geometry.positions[0]).toBeCloseTo(10 * Math.exp(-1))
  })

  it('fades through its colours over each life', () => {
    const e = new Emitter({ rate: 0, lifetime: 2, color: ['#ffffff', '#000000'] })
    e.burst(1)
    e.step(1)
    expect(Array.from(e.geometry.colors.subarray(0, 3)).map((c) => +c.toFixed(3))).toEqual([0.5, 0.5, 0.5])
    expect(e.color.flat().map((c) => +c.toFixed(3))).toEqual([1, 1, 1, 0, 0, 0])
  })

  it('lets onParticle move or remove particles', () => {
    const e = new Emitter({ rate: 0, velocity: [1, 0, 0], lifetime: 10, onParticle: (p) => p.position.x < 0.15 })
    e.burst(3)
    e.step(0.1)
    expect(e.count).toBe(3)
    e.step(0.1)
    expect(e.count).toBe(0)
  })

  it('bursts with one-off settings, then goes back to its own', () => {
    const e = new Emitter({ rate: 0, velocity: [0, 1, 0], lifetime: 10 })
    e.burst(1, { origin: [5, 0, 0], velocity: [0, 0, 0] })
    expect(e.geometry.positions[0]).toBe(5)
    expect(e.velocity.toArray()).toEqual([0, 1, 0])
    expect(e.origin.toArray()).toEqual([0, 0, 0])
    expect(() => e.burst(1, { rate: 5 })).toThrow(/burst\(\) doesn't take 'rate'/)
  })

  it("keeps a burst's own colours for the particles' whole lives", () => {
    const e = new Emitter({ rate: 0, lifetime: 10, color: '#ffffff' })
    e.burst(1, { color: '#ff0000' })
    e.burst(1)
    e.step(1)
    expect(Array.from(e.geometry.colors.subarray(0, 6)).map((c) => +c.toFixed(3))).toEqual([1, 0, 0, 1, 1, 1])
    expect(e.color.flat().map((c) => +c.toFixed(3))).toEqual([1, 1, 1])
  })

  it('spawns along a followed node', () => {
    const scene = new Scene()
    const rocket = scene.add(new Group({ position: [4, 0, 0] }))
    const trail = scene.add(new Emitter({ rate: 10, velocity: [0, 0, 0], follow: rocket, lifetime: 10 }))
    scene.updateWorldTree()
    trail.step(0.1)
    expect(trail.count).toBe(1)
    expect(trail.geometry.positions[0]).toBeCloseTo(4)
  })

  it('runs from the scene clock and checks its options', () => {
    const scene = new Scene()
    const e = scene.add(new Emitter({ rate: 10 }))
    scene.update(1, 1)
    expect(e.count).toBe(10)
    expect(() => new Emitter({ geometry: new Geometry({ positions: [0, 0, 0] }) })).toThrow(/makes its own geometry/)
    expect(() => new Emitter({ lifetimeRnd: 1 })).toThrow(/give 'lifetime' a \[min, max\] range/)
    expect(() => new Emitter({ lifetime: [0, 1] })).toThrow(/'lifetime' must be seconds above 0/)
    expect(() => new Emitter({ max: 0 })).toThrow(/'max' must be a whole number/)
    expect(new Emitter({ material: { size: 0.3 } }).material).toMatchObject({ size: 0.3, blending: 'additive', vertexColors: true })
  })
})

describe('Emitter copies', () => {
  it('clone and serialise their settings, not their particles', () => {
    const e = new Emitter({ max: 50, rate: 7, gravity: [0, -2, 0], lifetime: [1, 2], color: ['#ff0000', '#000000'] })
    e.burst(10)
    const copy = /** @type {Emitter} */ (e.clone())
    expect(copy).toBeInstanceOf(Emitter)
    expect(copy.count).toBe(0)
    expect(copy.geometry).not.toBe(e.geometry)
    expect([copy.max, copy.rate, copy.gravity.y]).toEqual([50, 7, -2])
    const json = e.toJSON()
    expect(json).toMatchObject({ type: 'emitter', max: 50, rate: 7, lifetime: [1, 2], color: ['#ff0000', '#000000'] })
    expect(json).not.toHaveProperty('geometry')
  })
})

describe('Body', () => {
  it('moves a node it is attached to', () => {
    const scene = new Scene()
    const ball = scene.add(new Group())
    const body = new Body({ velocity: [0, 10, 0], gravity: [0, -10, 0] })
    ball.onUpdate(body.update)
    scene.update(0.5, 0.5)
    expect(body.velocity.y).toBeCloseTo(5)
    expect(ball.position.y).toBeCloseTo(2.5)
    body.impulse([1, 0, 0])
    expect(body.velocity.x).toBe(1)
    expect(() => new Body({ mass: 2 })).toThrow(/no mass/)
  })
})

describe('Geometry.drawCount', () => {
  it('limits what is drawn and picked', () => {
    const pts = new Points({ geometry: { positions: [0, 0, 0, 1, 0, 0] } })
    const ortho = new OrthographicCamera({ position: [1, 0, 10], height: 4, aspect: 1 })
    const ray = () => new Raycaster().setFromCamera([0, 0], ortho)
    expect(ray().intersect(pts)).toHaveLength(1)
    pts.geometry.drawCount = 1
    expect(pts.geometry.drawnCount).toBe(1)
    expect(ray().intersect(pts)).toHaveLength(0)
    expect(pts.geometry.clone().drawCount).toBe(1)
  })
})
