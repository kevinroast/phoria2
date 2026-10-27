import { describe, expect, it } from 'vitest'
import { Group, Lines, Mesh, box, curve, ellipse } from '../src/index.js'
import { Timeline, face, follow, reveal } from '../src/motion/index.js'
import { Vec3 } from '../src/value/Vec3.js'

const close = (a, b, digits = 3) => {
  for (let i = 0; i < b.length; i++) expect(a[i]).toBeCloseTo(b[i], digits)
}

describe('curves', () => {
  it('goes through its points, and by distance along them', () => {
    const line = curve([[0, 0, 0], [10, 0, 0]])
    expect(line.length).toBeCloseTo(10)
    close(line.at(0), [0, 0, 0])
    close(line.at(1), [10, 0, 0])
    close(line.at(0.5), [5, 0, 0])
    close(line.tangentAt(0.3), [1, 0, 0])
    // unevenly spaced points: half way is still half the distance
    const bent = curve([[0, 0, 0], [1, 0, 0], [10, 0, 0]], { tension: 1 })
    close(bent.at(0.5), [5, 0, 0], 1)
    expect(() => curve([[0, 0, 0]])).toThrow('two or more points')
    // points far apart then close together: it turns the corner without looping or a cusp
    const route = curve([[0, 0, 0], [0, 3, 0], [0.3, 3.2, 0], [0.6, 3.3, 0], [6, 3.3, 0]])
    // the tightest turn, as a radius (the plain curve makes a cusp here: 0.002)
    let curvature = 0
    const n = 4000, step = route.length / n
    for (let i = 1; i <= n; i++) curvature = Math.max(curvature, Math.acos(Math.min(1, route.tangentAt((i - 1) / n).dot(route.tangentAt(i / n)))) / step)
    expect(1 / curvature).toBeGreaterThan(0.1)
    expect(() => curve([[0, 0, 0], [1, 0, 0]], /** @type {any} */ ({ loop: true }))).toThrow("use 'closed: true'")
  })

  it('makes orbits that close up', () => {
    const orbit = ellipse({ radiusX: 4, radiusZ: 2, center: [10, 0, 0] })
    expect(orbit.closed).toBe(true)
    close(orbit.at(0), orbit.at(1))
    close(orbit.at(0), [14, 0, 0])
    // about the perimeter of a 4 x 2 ellipse
    expect(orbit.length).toBeCloseTo(19.38, 0)
    expect(() => ellipse(/** @type {any} */ ({ radiusY: 2 }))).toThrow("in 'xz' has 'radiusX' and 'radiusZ'")
  })

  it('lies in the plane asked for, and tilts about its first axis', () => {
    const upright = ellipse({ plane: 'xy', radiusX: 3, radiusY: 2 })
    close(upright.at(0), [3, 0, 0])
    close(upright.at(0.25), [0, 2, 0], 2)
    const side = ellipse({ plane: 'yz', radiusY: 1, radiusZ: 4 })
    close(side.at(0), [0, 1, 0])
    for (const p of side.points(8)) expect(p[0]).toBeCloseTo(0)
    // the default x-z, tilted a quarter turn about x, stands up into x-y
    const tilted = ellipse({ radius: 2, tilt: Math.PI / 2 })
    for (const p of tilted.points(8)) expect(p[2]).toBeCloseTo(0)
    expect(() => ellipse(/** @type {any} */ ({ plane: 'xy', radiusZ: 2 }))).toThrow("in 'xy' has 'radiusX' and 'radiusY'")
    expect(() => ellipse(/** @type {any} */ ({ plane: 'zx' }))).toThrow('plane')
  })

  it('makes solid and dashed lines, in order from the start, and tubes', () => {
    const path = curve([[0, 0, 0], [10, 0, 0]])
    const solid = path.line({ segments: 10 })
    expect(solid.vertexCount).toBe(20)
    close(solid.positions.slice(0, 3), [0, 0, 0])
    // 1 on, 1 off over 10 units: five dashes, each a run of pieces
    const dashed = path.line({ segments: 10, dash: [1, 1] })
    expect(dashed.vertexCount).toBe(10)
    close(dashed.positions.slice(-3), [9, 0, 0])
    expect(() => path.line({ dash: /** @type {any} */ ([1]) })).toThrow("'dash' is [on, off]")
    const tube = path.tube({ radius: 0.5, segments: 4, sides: 6 })
    expect(tube.vertexCount).toBe(5 * 6)
    expect(tube.indices?.length).toBe(4 * 6 * 6)
    // every ring is the radius away from the line
    for (let i = 0; i < tube.vertexCount; i++) expect(Math.hypot(tube.positions[i * 3 + 1], tube.positions[i * 3 + 2])).toBeCloseTo(0.5)
  })
})

describe('motion', () => {
  it('moves a node along a curve, facing the way it runs', () => {
    const path = curve([[0, 0, 0], [0, 0, -10]])
    const parent = new Group({ position: [5, 0, 0] })
    const craft = parent.add(new Mesh({ geometry: box(1) }))
    follow(craft, path, 0.5)
    close(craft.position, [0, 0, -5])
    // facing -z, along the path: no turn
    craft.updateWorld()
    close(craft.quaternion, [0, 0, 0, 1])
    follow(craft, path, 0.2, { orient: false })
    close(craft.position, [0, 0, -2])
  })

  it('turns a model built along another axis to face the way it goes', () => {
    const nose = (node, axis) => new Vec3(...axis).applyQuaternion(node.quaternion)
    const rocket = new Mesh({ geometry: box(1) })
    follow(rocket, curve([[0, 0, 0], [10, 0, 0]]), 0.5, { forward: '+y' })
    close(nose(rocket, [0, 1, 0]), [1, 0, 0])
    for (const [forward, axis] of /** @type {const} */ ([['-z', [0, 0, -1]], ['+z', [0, 0, 1]], ['-y', [0, -1, 0]], ['+x', [1, 0, 0]], ['-x', [-1, 0, 0]]])) {
      face(rocket, [0, 0, 1], { forward })
      close(nose(rocket, axis), [0, 0, 1])
    }
    // the direction is in the parent's space
    const turned = new Group({ rotation: [0, Math.PI / 2, 0] })
    const child = turned.add(new Mesh({ geometry: box(1) }))
    face(child, [1, 0, 0], { forward: '+y' })
    close(nose(child, [0, 1, 0]), [1, 0, 0])
    expect(() => face(rocket, [1, 0, 0], /** @type {any} */ ({ forward: 'up' }))).toThrow('forward')
    expect(() => follow(rocket, curve([[0, 0, 0], [1, 0, 0]]), 0, /** @type {any} */ ({ nose: '+y' }))).toThrow("use 'forward'")
  })

  it('keeps a steady roll through a vertical heading, given an up out of the plane', () => {
    const nose = (node, axis) => new Vec3(...axis).applyQuaternion(node.quaternion)
    const craft = new Mesh({ geometry: box(1) })
    // a heading turning through straight up, in x-y: the roll stays toward the viewer throughout
    for (const dir of [[-1, 1, 0], [-0.01, 1, 0], [0, 1, 0], [0.01, 1, 0], [1, 1, 0]]) {
      face(craft, dir, { forward: '+y', up: [0, 0, 1] })
      close(nose(craft, [0, 0, 1]), [0, 0, 1])
      close(nose(craft, [0, 1, 0]), new Vec3(...dir).normalize())
    }
    expect(() => face(craft, [1, 0, 0], /** @type {any} */ ({ up: 'z' }))).toThrow('up')
  })

  it('draws a line in as it is travelled', () => {
    const lines = new Lines({ geometry: curve([[0, 0, 0], [10, 0, 0]]).line({ segments: 10 }) })
    reveal(lines, 0)
    expect(lines.visible).toBe(false)
    reveal(lines, 0.5)
    expect([lines.visible, lines.geometry.drawCount]).toEqual([true, 10])
    reveal(lines, 1)
    expect(lines.geometry.drawCount).toBe(20)
  })

  it('plays steps in order, each from its own progress', () => {
    const seen = { a: 0, b: 0, c: 0 }
    const changes = []
    const story = new Timeline()
      .add(2, (t) => { seen.a = t }, { label: 'A' })
      .add(2, (t) => { seen.b = t }, { label: 'B' })
      .add(0, (t) => { seen.c = t }, { label: 'C' })
      .onStep((i, label) => changes.push(label))
    expect(story.duration).toBe(4)
    story.update(1)
    expect([seen.a, seen.b, story.label]).toEqual([0.5, 0, 'A'])
    story.update(2)
    expect([seen.a, seen.b, story.label]).toEqual([1, 0.5, 'B'])
    story.update(5)
    // at the end: everything done, and stopped
    expect([seen.a, seen.b, seen.c, story.playing]).toEqual([1, 1, 1, false])
    // told the step playing when it started listening, then each change
    expect(changes).toEqual(['A', 'B', 'C'])
  })

  it('seeks backwards and loops, leaving what a step controls as the latest step to touch it says', () => {
    const craft = { x: 0 }
    const story = new Timeline({ loop: true })
      .add(1, (t) => { craft.x = t * 10 })
      .add(1, (t) => { if (t > 0) craft.x = 10 + t * 10 })
    story.seek(1.5)
    expect(craft.x).toBe(15)
    story.seek(0.5)
    // step two is back at its start, so step one's say is what holds
    expect(craft.x).toBe(5)
    story.seekStep(1)
    expect(story.step).toBe(1)
    story.update(1.25)
    // round the loop
    expect(story.time).toBeCloseTo(0.25)
    expect(craft.x).toBeCloseTo(2.5)
    expect(() => story.seekStep(5)).toThrow('no step 5')
    expect(() => story.add(1, /** @type {any} */ ('not a function'))).toThrow('takes (duration, (t) => { ... })')
  })
})
