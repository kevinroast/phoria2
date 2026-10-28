// The examples in llms-full.txt that run without a page: what agents copy has to work.
import { describe, expect, it } from 'vitest'
import { Group, Lines, Mesh, curve, create, ellipse } from '../src/index.js'
import { Timeline, follow, reveal, face } from '../src/motion/index.js'
import { Emitter, Body } from '../src/particles/index.js'

describe('llms-full.txt examples', () => {
  it('motion: a probe follows a dashed route that draws in, on a looping timeline', () => {
    const route = curve([[0, 0, 0], [2, 3, 0], [6, 2, 1]])
    const trail = new Lines({ geometry: route.line({ dash: [0.3, 0.15] }), material: { color: 'orange', width: 2 } })
    const probe = new Group(), flag = new Group({ visible: false }), labels = []
    const story = new Timeline({ loop: true })
    story.add(4, (t) => { follow(probe, route, t); reveal(trail, t) }, { label: 'Transfer', ease: 'inOut' })
    story.add(2, (t) => { flag.visible = t > 0 }, { label: 'Arrival' })
    story.onStep((index, label) => labels.push(label))
    story.update(5)
    expect(labels).toEqual(['Transfer', 'Arrival'])
    expect(flag.visible).toBe(true)
    expect(probe.position.distanceTo(route.at(1))).toBeLessThan(1e-4)
    story.seekStep('Transfer')
    expect(story.label).toBe('Transfer')
    face(probe, [0, 1, 0], { forward: '+y' })
    expect(route.tube({ radius: 0.1, sides: 6 }).positions.length).toBeGreaterThan(0)
    expect(ellipse({ radiusX: 4, radiusZ: 3, center: [8, 0, 0] }).closed).toBe(true)
  })

  it('particles: an emitter with a colour fade and a burst, and a Body moving a node', () => {
    const sparks = new Emitter({
      rate: 200, velocity: [0, 3, 0], velocitySpread: 1, gravity: [0, -9.8, 0],
      lifetime: [0.8, 1.4], color: ['#ffd27f', '#ff5a1f', '#000'],
    })
    sparks.burst(500, { velocitySpread: 8 })
    expect(sparks.count).toBe(500)
    const rock = new Group(), body = new Body({ velocity: [0, 20, 0], gravity: [0, -9.8, 0] })
    rock.onUpdate(body.update)
    body.impulse([1, 0, 0])
    body.update(rock, 0.1)
    expect(rock.position[0]).toBeGreaterThan(0)
  })

  it('plain data: create() builds a group with a mesh and a label', () => {
    const crate = create({
      type: 'group', children: [
        { type: 'mesh', geometry: { type: 'box', size: 2 }, material: { color: 'orange' }, position: [0, 1, 0] },
        { type: 'label', text: 'Crate', position: [0, 2.4, 0] },
      ],
    })
    expect(crate.children.map((c) => c.constructor.name)).toEqual(['Mesh', 'Label'])
    expect(create(crate.toJSON()).children[0]).toBeInstanceOf(Mesh)
  })
})
