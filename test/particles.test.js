import { describe, expect, it } from 'vitest'
import { Geometry, Group, OrthographicCamera, Points, Raycaster, Scene, WebGLRenderer } from '../src/index.js'
import { fakeCanvas, fakeGL } from './fakes.js'
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

describe('Emitter seed', () => {
  const run = (/** @type {any} */ options) => {
    const e = new Emitter({ max: 200, rate: 300, originSpread: 0.5, velocitySpread: 1, lifetime: [0.5, 2], size: [1, 2], sizeSpread: 0.3, spin: 2, ...options })
    for (let i = 0; i < 20; i++) e.step(1 / 60)
    return { e, positions: Array.from(e.geometry.positions.slice(0, e.count * 3)) }
  }

  it('makes the same particles every time for the same seed and steps', () => {
    const a = run({ seed: 7 }), b = run({ seed: 7 })
    expect(a.positions.length).toBeGreaterThan(0)
    expect(b.positions).toEqual(a.positions)
    expect(run({ seed: 8 }).positions).not.toEqual(a.positions)
    // without one, Math.random: not the seeded run
    expect(run({}).positions).not.toEqual(a.positions)
  })

  it('plays out again from clear(), and from a new seed', () => {
    const { e, positions } = run({ seed: 3 })
    e.clear()
    for (let i = 0; i < 20; i++) e.step(1 / 60)
    expect(Array.from(e.geometry.positions.slice(0, e.count * 3))).toEqual(positions)
    e.seed = 3
    e.clear()
    expect(e.seed).toBe(3)
    e.seed = null
    expect(e.seed).toBe(null)
  })

  it('is kept by clone() and toJSON(), and checked', () => {
    const e = new Emitter({ seed: 11 })
    expect(e.clone().seed).toBe(11)
    expect(e.toJSON().seed).toBe(11)
    expect(new Emitter().toJSON().seed).toBe(undefined)
    expect(() => new Emitter({ seed: /** @type {any} */ ('x') })).toThrow("'seed' is a number")
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

// A step paints a particle only where its looks change over its life, and sends the GPU only what
// changed - with one colour, its positions alone. These check nothing is lost by that.
describe('Emitter steps send what changed', () => {
  const rgb = (/** @type {Emitter} */ e, i) => Array.from(/** @type {Float32Array} */ (e.geometry.colors).subarray(i * 3, i * 3 + 3)).map((c) => +c.toFixed(3))

  it('paints live particles again when their colour, size or opacity changes', () => {
    const e = new Emitter({ rate: 0, lifetime: 10, color: '#ff0000' })
    e.burst(3)
    e.step(0.1)
    expect(rgb(e, 2)).toEqual([1, 0, 0])
    e.color = '#0000ff'
    e.step(0.1)
    expect(rgb(e, 0)).toEqual([0, 0, 1])
    expect(rgb(e, 2)).toEqual([0, 0, 1])
    e.set({ opacity: [1, 0] })
    e.step(0.1)
    // 0.3 s of a 10 s life
    expect(/** @type {Float32Array} */ (e.geometry.opacities)[1]).toBeCloseTo(0.97)
    e.size = 2
    e.step(0.1)
    expect(/** @type {Float32Array} */ (e.geometry.sizes)[0]).toBeCloseTo(2)
  })

  it('names only its positions changed while no colour did - deaths and births of one colour included', () => {
    const e = new Emitter({ max: 50, rate: 0, lifetime: [0.5, 3], color: '#ffaa55' })
    // the burst paints every slot, and sends it all (a slot never used holds no colour yet - painting
    // it is a change, rightly sent)
    e.burst(50)
    expect(e.geometry.changedOnly).toBeNull()
    e.step(0.1)
    expect(e.geometry.changedOnly).toContain('positions')
    expect(e.geometry.changedOnly).not.toContain('colors')
    // some die, the last live ones moved into their places - all the one colour
    e.step(1)
    expect(e.count).toBeLessThan(50)
    expect(e.geometry.changedOnly).not.toContain('colors')
    e.rate = 100
    e.step(0.1)
    expect(e.geometry.changedOnly).not.toContain('colors')
  })

  it('names its colours changed when they are: a new colour, a burst of another, a fade', () => {
    const e = new Emitter({ max: 50, rate: 0, lifetime: 10, color: '#ffaa55' })
    e.burst(5)
    e.step(0.1)
    e.step(0.1)
    expect(e.geometry.changedOnly).not.toBeNull()
    e.color = '#00ff00'
    e.step(0.1)
    expect(e.geometry.changedOnly).toBeNull()
    e.step(0.1)
    e.burst(2, { color: '#ff0000' })
    expect(e.geometry.changedOnly).toBeNull()

    // a death that moves a particle of another colour into its place
    const mixed = new Emitter({ rate: 0, lifetime: 10, color: '#ffaa55' })
    mixed.burst(2, { lifetime: 0.15 })
    mixed.burst(1, { color: '#0000ff' })
    mixed.step(0.1)
    mixed.step(0.1)
    expect(mixed.geometry.changedOnly).toBeNull()
    expect(rgb(mixed, 0)).toEqual([0, 0, 1])

    const fading = new Emitter({ rate: 0, lifetime: 10, color: ['#ffffff', '#000000'] })
    fading.burst(3)
    fading.step(0.1)
    fading.step(0.1)
    expect(fading.geometry.changedOnly).toBeNull()
  })

  it('a dead particle\'s place goes to the last live one, moved this step like the rest', () => {
    const e = new Emitter({ rate: 0, velocity: [1, 0, 0], lifetime: 10 })
    e.burst(2, { lifetime: 0.15 })
    e.burst(1, { velocity: [0, 1, 0] })
    e.step(0.1)
    e.step(0.1)
    // the two short-lived ones gone; the long-lived one in slot 0, moved both steps
    expect(e.count).toBe(1)
    expect(e.geometry.positions[1]).toBeCloseTo(0.2)
  })
})

describe('Points buffers refill only what changed', () => {
  /** A renderer over a fake GL that lists its bufferSubData calls: [values sent]. */
  function counting() {
    const { gl } = fakeGL()
    /** @type {number[]} */
    const sent = []
    const proxy = new Proxy(gl, {
      get: (target, key) => {
        const value = target[key]
        if (key === 'bufferSubData') return (...args) => { sent.push(args[4] ?? args[2].length); return value.apply(target, args) }
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const renderer = new WebGLRenderer({ canvas: fakeCanvas(/** @type {any} */ (proxy)) })
    renderer.setSize(64, 64)
    return { renderer, sent }
  }

  it('sends the named arrays, and of those only the vertices drawn - and more when more are drawn', () => {
    const { renderer, sent } = counting()
    const positions = new Float32Array(30), colors = new Float32Array(30).fill(1)
    const geometry = new Geometry({ positions, colors })
    geometry.drawCount = 2
    const scene = new Scene()
    scene.add(new Points({ geometry, material: { size: 4, vertexColors: true } }))
    const camera = new OrthographicCamera({ position: [0, 0, 10], height: 4, aspect: 1 })
    renderer.render(scene, camera)
    sent.length = 0

    // positions changed, colours not: two vertices' positions sent
    positions[0] = 0.5
    geometry.needsUpdate()
    geometry.changedOnly = ['positions']
    renderer.render(scene, camera)
    expect(sent).toEqual([6])

    // anything may have changed: both arrays, still only the two drawn
    sent.length = 0
    geometry.needsUpdate()
    renderer.render(scene, camera)
    expect(sent).toEqual([6, 6])

    // drawing more than was sent - nothing marked changed - sends them
    sent.length = 0
    geometry.drawCount = 5
    renderer.render(scene, camera)
    expect(sent).toEqual([15, 15])
    sent.length = 0
    renderer.render(scene, camera)
    expect(sent).toEqual([])
  })
})
