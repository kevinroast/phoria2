// Node types from outside the core: registered, create() builds their descriptions.
import { describe, expect, it } from 'vitest'
import { Group, create, registerType } from '../src/index.js'
import { NODE_OPTIONS } from '../src/scene/Node.js'

class Beacon extends Group {
  static type = 'beacon'
  static get OPTIONS() { return [...super.OPTIONS, 'blink'] }
  blink = 1
  /** @param {Record<string, any>} [options] */
  constructor(options = {}) {
    const { blink, ...rest } = options
    super(rest)
    if (blink !== undefined) this.blink = blink
  }
}

describe('registerType', () => {
  it("lets create() build a type from outside the core, by its static type - nested too", () => {
    expect(() => create({ type: 'beacon' })).toThrow('beacon')
    registerType(Beacon)
    const one = create({ type: 'beacon', name: 'top', blink: 2, position: [0, 3, 0] })
    expect(one).toBeInstanceOf(Beacon)
    expect([one.name, /** @type {Beacon} */ (one).blink, one.position.y]).toEqual(['top', 2, 3])
    const scene = create({ type: 'scene', children: [{ type: 'group', children: [{ type: 'beacon', name: 'deep' }] }] })
    expect(scene.find('deep')).toBeInstanceOf(Beacon)
  })

  it("lets a type extend its parent's options - every node class has its list", () => {
    expect(Group.OPTIONS).toEqual(NODE_OPTIONS)
    expect(Beacon.OPTIONS).toEqual([...NODE_OPTIONS, 'blink'])
    expect(() => new Beacon(/** @type {any} */ ({ blinks: 2 }))).toThrow("unknown option 'blinks'")
  })

  it('has charts register themselves when phoria2/charts is imported', async () => {
    await import('../src/charts/index.js')
    const chart = create({ type: 'chart', mark: 'bar', data: [{ a: 'x', b: 1 }], x: 'a', y: 'b' })
    expect(chart.constructor.name).toBe('Chart')
  })
})
