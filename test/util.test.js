import { describe, expect, it } from 'vitest'
import { vec4 } from 'gl-matrix'
import { clone, combine, merge, sortEdges, sortPoints, sortPolygons } from '../src/util.js'

describe('merge', () => {
  it('deep merges into a new object, source winning, inputs untouched', () => {
    const target = { a: 1, nested: { x: 1, y: 2 }, list: [1, 2, 3] }
    const src = { b: 2, nested: { y: 5 }, list: [9] }
    const out = merge(target, src)
    expect(out).toEqual({ a: 1, b: 2, nested: { x: 1, y: 5 }, list: [9, 2, 3] })
    expect(target).toEqual({ a: 1, nested: { x: 1, y: 2 }, list: [1, 2, 3] })
  })
})

describe('combine', () => {
  it('deep combines into the target in place', () => {
    const style = { color: [128, 128, 128], drawmode: 'solid' }
    combine(style, { color: [255, 0], drawmode: 'wireframe', extra: { a: 1 } })
    expect(style).toEqual({ color: [255, 0, 128], drawmode: 'wireframe', extra: { a: 1 } })
  })
})

describe('clone', () => {
  it('copies one level deep, including arrays', () => {
    const src = { color: [1, 2, 3], n: 1 }
    const out = clone(src)
    out.color[0] = 9
    expect(src.color[0]).toBe(1)
    expect(out.n).toBe(1)
  })
})

describe('sorting', () => {
  const coords = (...zs) => zs.map((z) => vec4.fromValues(0, 0, z, 1))

  it('sorts polygons of any size by average Z, nearest last', () => {
    const c = coords(5, 5, 5, 1, 1, 1, 9, 9, 9, 9, 9)
    const polys = [
      { id: 'mid', vertices: [0, 1, 2] },
      { id: 'near', vertices: [3, 4, 5] },
      { id: 'far', vertices: [6, 7, 8, 9, 10] },
    ]
    sortPolygons(polys, c)
    expect(polys.map((p) => p.id)).toEqual(['near', 'mid', 'far'])
  })

  it('sorts edges by average Z', () => {
    const c = coords(1, 2, 8, 9)
    const edges = [{ a: 2, b: 3 }, { a: 0, b: 1 }]
    sortEdges(edges, c)
    expect(edges[0]).toEqual(expect.objectContaining({ a: 0, b: 1 }))
  })

  it('sorts points far to near, keeping world coords in lock-step', () => {
    const screen = coords(3, 1, 4, 1.5, 9, 2.6)
    const world = screen.map((v) => ({ z: v[2] }))
    sortPoints(screen, world)
    const zs = screen.map((v) => v[2])
    expect(zs).toEqual([...zs].sort((a, b) => b - a))
    screen.forEach((v, i) => expect(world[i].z).toBeCloseTo(v[2]))
  })
})

describe('typed array vectors', () => {
  it('are copied whole by combine, merge and clone', () => {
    const normal = vec4.fromValues(0, 1, 0, 0)
    const combined = combine({}, { normal })
    const merged = merge({}, { normal })
    const cloned = clone({ normal })
    for (const out of [combined, merged, cloned]) {
      expect(out.normal).toBeInstanceOf(Float32Array)
      expect(out.normal).not.toBe(normal)
      expect([...out.normal]).toEqual([0, 1, 0, 0])
    }
  })
})
