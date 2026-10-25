import { describe, expect, it } from 'vitest'
import { Box3, Geometry, InstancedMesh, Lines, Mesh, PerspectiveCamera, Points, Raycaster, Scene, box } from '../src/index.js'

const camera = () => new PerspectiveCamera({ position: [0, 0, 10], target: [0, 0, 0], aspect: 1 })

describe('large data', () => {
  it('bounds instanced meshes exactly, rotated and scaled, without a box per instance', () => {
    const mesh = new InstancedMesh({ geometry: box(1), count: 3, position: [10, 0, 0] })
    mesh.setInstance(0, { position: [0, 0, 0] })
    mesh.setInstance(1, { position: [5, 2, 0], scale: [1, 4, 1] })
    mesh.setInstance(2, { position: [-3, 0, 1], rotation: [0, Math.PI / 4, 0] })
    const scene = new Scene()
    scene.add(mesh)
    const b = scene.bounds
    const r = Math.SQRT2 / 2
    expect(b.min.toArray().map((v) => +v.toFixed(4))).toEqual([+(10 - 3 - r).toFixed(4), -0.5, -0.5])
    expect(b.max.toArray().map((v) => +v.toFixed(4))).toEqual([15.5, 4, +(1 + r).toFixed(4)])
  })

  it('updates instances without allocating, from arrays, numbers or direct writes', () => {
    const mesh = new InstancedMesh({ geometry: box(1), count: 2 })
    const v = mesh.version
    mesh.setInstance(0, { position: [1, 2, 3], scale: 2 })
    expect(Array.from(mesh.instanceMatrices.subarray(0, 16))).toEqual([2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 1, 2, 3, 1])
    // unset parts go back to identity rather than keeping the last call's values
    mesh.setInstance(0, {})
    expect(Array.from(mesh.instanceMatrices.subarray(0, 16))).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
    mesh.instanceMatrices[16 + 13] = 7
    expect(mesh.needsUpdate()).toBe(mesh)
    expect(mesh.version).toBe(v + 3)
    expect(() => mesh.setInstance(0, { colour: 'red' })).toThrow("unknown instance option 'colour'")
  })
})

describe('Raycaster.intersectElement', () => {
  it('makes a GPU pick exact: one instance, point or segment', () => {
    const ray = new Raycaster().setFromCamera([0, 0], camera())
    const mesh = new InstancedMesh({ geometry: box(1), count: 2, data: ['a', 'b'] })
    mesh.setInstance(0, { position: [-3, 0, 0] })
    mesh.setInstance(1, { position: [0, 0, 0] })
    const hit = ray.intersectElement(mesh, 1)
    expect([hit?.instance, hit?.datum, hit?.distance]).toEqual([1, 'b', 9.5])
    expect(hit?.normal?.toArray()).toEqual([0, 0, 1])
    // the ray misses instance 0 entirely
    expect(ray.intersectElement(mesh, 0)).toBeNull()
    expect(ray.intersectElement(mesh, 5)).toBeNull()

    const plain = new Mesh({ geometry: box(2) })
    expect(ray.intersectElement(plain, 0)?.distance).toBeCloseTo(9)

    const points = new Points({ geometry: new Geometry({ positions: [0, 0, 0, 0.1, 0, 2] }), data: ['p', 'q'] })
    const p = ray.intersectElement(points, 1)
    expect([p?.face, p?.datum, p?.point.toArray().map((x) => +x.toFixed(5))]).toEqual([1, 'q', [0.1, 0, 2]])

    const lines = new Lines({ geometry: new Geometry({ positions: [-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0] }) })
    const l = ray.intersectElement(lines, 0)
    expect([l?.face, l?.point.toArray().map((x) => +x.toFixed(5))]).toEqual([0, [0, 0, 0]])
    expect(new Box3()).toBeTruthy()
  })
})
