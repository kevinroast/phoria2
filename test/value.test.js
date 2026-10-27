import { describe, expect, it } from 'vitest'
import { Vec3 } from '../src/value/Vec3.js'
import { Quat } from '../src/value/Quat.js'
import { Euler } from '../src/value/Euler.js'
import { Mat4 } from '../src/value/Mat4.js'
import { Box3 } from '../src/value/Box3.js'
import { Color } from '../src/value/Color.js'
import { CSS_COLORS } from '../src/value/cssColors.js'
import { suggest } from '../src/validate.js'

const close = (a, b, digits = 5) => {
  expect(a.length).toBe(b.length)
  for (let i = 0; i < b.length; i++) expect(a[i]).toBeCloseTo(b[i], digits)
}

describe('Vec3', () => {
  it('works three.js style and as a typed array', () => {
    const v = new Vec3()
    v.set(1, 2, 3)
    v.x += 1
    expect([...v]).toEqual([2, 2, 3])
    v.set([7, 8, 9])
    expect(v.toArray()).toEqual([7, 8, 9])
    expect(v.slice(0, 2)).toBeInstanceOf(Float32Array)
    expect(v.slice(0, 2)).not.toBeInstanceOf(Vec3)
  })

  it('accepts arrays, objects and scalars, and rejects anything else helpfully', () => {
    expect(Vec3.fromInput([1, 2, 3]).toArray()).toEqual([1, 2, 3])
    expect(Vec3.fromInput({ x: 1, y: 2, z: 3 }).toArray()).toEqual([1, 2, 3])
    expect(Vec3.fromInput(2).toArray()).toEqual([2, 2, 2])
    expect(() => Vec3.fromInput([1, 2], 'Node')).toThrow("Node: expected [x, y, z] or { x, y, z }, got an array of 2")
    expect(() => Vec3.fromInput(['a', 2, 3])).toThrow('components must be numbers')
  })

  it('chains vector maths', () => {
    const v = new Vec3(3, 0, 4)
    expect(v.len()).toBe(5)
    expect(v.length).toBe(3)
    expect(v.clone().normalize().toArray()).toEqual([0.6000000238418579, 0, 0.800000011920929])
    expect(new Vec3(1, 0, 0).cross([0, 1, 0]).toArray()).toEqual([0, 0, 1])
    expect(new Vec3(1, 2, 3).add([1, 1, 1]).multiplyScalar(2).toArray()).toEqual([4, 6, 8])
    expect(new Vec3(1, 2, 3).setScalar(2).toArray()).toEqual([2, 2, 2])
    expect(() => new Vec3().setScalar(/** @type {any} */ ('2'))).toThrow('setScalar')
    expect(new Vec3(1, 0, 0).applyQuaternion(new Quat().setFromEuler(0, Math.PI / 2, 0)).equals([0, 0, -1], 1e-6)).toBe(true)
  })
})

describe('Quat and Euler', () => {
  it('round trip XYZ angles', () => {
    const angles = [[0.3, -0.7, 1.1], [0, 0, 0], [-2.5, 0.4, 3], [0.1, 1.2, -0.3]]
    for (const [x, y, z] of angles) {
      const q = new Quat().setFromEuler(x, y, z)
      close(new Euler().setFromQuat(q).toArray(), [x, y, z])
    }
  })

  it('handles gimbal lock without NaN', () => {
    const e = new Euler().setFromQuat(new Quat().setFromEuler(0.5, Math.PI / 2, 0))
    expect(e.y).toBeCloseTo(Math.PI / 2)
    expect(Number.isNaN(e.x + e.z)).toBe(false)
  })

  it('notify on change through setters but not index writes', () => {
    let n = 0
    const q = new Quat()
    q.onChange = () => n++
    q.x = 0.1
    q.set(0, 0, 0, 1)
    q.setFromEuler(0, 1, 0)
    q[0] = 5
    expect(n).toBe(3)
  })
})

describe('Mat4 and Box3', () => {
  it('composes TRS', () => {
    const m = new Mat4().compose([1, 2, 3], new Quat().setFromEuler(0, Math.PI / 2, 0), [2, 2, 2])
    expect(m.getPosition().toArray()).toEqual([1, 2, 3])
    close(m.getScale(), [2, 2, 2])
    expect(new Vec3(1, 0, 0).applyMatrix4(m).equals([1, 2, 1], 1e-5)).toBe(true)
  })

  it('bounds points and transforms', () => {
    const b = new Box3()
    expect(b.isEmpty()).toBe(true)
    b.expandByPositions([-1, -1, -1, 1, 2, 3])
    expect(b.getSize().toArray()).toEqual([2, 3, 4])
    expect(b.getCenter().toArray()).toEqual([0, 0.5, 1])
    const moved = b.clone().applyMatrix4(new Mat4().compose([10, 0, 0], new Quat(), [1, 1, 1]))
    expect(moved.min.toArray()).toEqual([9, -1, -1])
    expect(new Box3().union(b).max.toArray()).toEqual([1, 2, 3])
  })
})

describe('Color', () => {
  it('parses every input form as sRGB and stores linear', () => {
    const forms = ['#ff8800', '#f80', 0xff8800, 'rgb(255 136 0)', 'rgb(255, 136, 0)', 'rgba(100%, 53.333%, 0%, 0.5)', [1, 136 / 255, 0]]
    for (const f of forms) expect(Color.fromInput(f).getStyle()).toBe('#ff8800')
    expect(Color.fromInput('orange').getStyle()).toBe('#ffa500')
    expect(Color.fromInput('hsl(120 100% 25%)').getStyle()).toBe('#008000')
    // linear storage: sRGB 0.5 is about 0.214 linear
    expect(Color.fromInput([0.5, 0.5, 0.5]).r).toBeCloseTo(0.214, 3)
    expect(JSON.stringify(Color.fromInput('#123456'))).toBe('"#123456"')
  })

  it('mixes colours in linear space', () => {
    const c = new Color('#000000').lerp('#ffffff', 0.5)
    expect(c.r).toBeCloseTo(0.5)
    // half way in light is brighter than half way in sRGB numbers
    expect(c.getStyle()).toBe('#bcbcbc')
    expect(new Color('red').lerp(new Color('blue'), 1).getStyle()).toBe('#0000ff')
  })

  it('explains bad colours', () => {
    expect(() => Color.fromInput('blu', 'PointLight')).toThrow("PointLight: 'blu' is not a colour - did you mean 'blue'?")
    expect(() => Color.fromInput([255, 0, 0])).toThrow('components are 0-1, e.g. [1, 0, 0]')
    expect(() => Color.fromInput('#12')).toThrow('not a valid hex colour')
    expect(() => Color.fromInput({})).toThrow('is not a colour')
  })

  it('has all 148 CSS names', () => {
    expect(CSS_COLORS.size).toBe(148)
    expect(CSS_COLORS.get('rebeccapurple')).toBe(0x663399)
    expect(CSS_COLORS.get('cornflowerblue')).toBe(0x6495ed)
  })
})

describe('suggest', () => {
  it('finds near misses only', () => {
    expect(suggest('colour', ['color', 'opacity'])).toBe('color')
    expect(suggest('roughnes', ['roughness', 'metalness'])).toBe('roughness')
    expect(suggest('zzz', ['color', 'opacity'])).toBeUndefined()
  })
})

describe('option checks', () => {
  it('name a nested option in their errors, with what it takes', async () => {
    const { checkOptions } = await import('../src/validate.js')
    expect(() => checkOptions('View', 'both', ['keep', 'aspect'], {}, 'framing'))
      .toThrow("View: 'framing' must be an options object - { keep, aspect }, got 'both'")
    expect(() => checkOptions('View', { keeep: 'both' }, ['keep', 'aspect'], {}, 'framing'))
      .toThrow("View: unknown option 'framing.keeep' - did you mean 'keep'?")
    expect(() => checkOptions('Mesh', 'x', ['geometry'])).toThrow('Mesh: expected an options object')
  })
})
