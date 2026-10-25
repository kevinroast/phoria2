import { describe, expect, it } from 'vitest'
import { parseWavefront } from '../src/loaders.js'

const OBJ = `# a unit quad, offset from the origin
v 1 1 0
v 3 1 0
v 3 3 0\r
  v 1 3 0
vt 0 0
vt 1 0
vt 1 1
vt 0 1
f 1/1 2/2 3/3 4/4
f 1//1 2//1 3//1
f 4 3 2
`

describe('parseWavefront', () => {
  it('reads vertices, faces and texture coordinates', () => {
    const { points, polygons } = parseWavefront(OBJ)
    expect(points).toHaveLength(4)
    expect(points[3]).toEqual({ x: 1, y: 3, z: 0 })
    expect(polygons[0]).toEqual({ vertices: [0, 1, 2, 3], uvs: [0, 0, 1, 0, 1, 1, 0, 1] })
    // v//vn has no texture coordinate
    expect(polygons[1]).toEqual({ vertices: [0, 1, 2] })
    expect(polygons[2]).toEqual({ vertices: [3, 2, 1] })
  })

  it('reorders vertices', () => {
    const { polygons } = parseWavefront(OBJ, { reorder: true })
    expect(polygons[2].vertices).toEqual([1, 2, 3])
  })

  it('centres on the bounding box, not the origin', () => {
    const { points } = parseWavefront(OBJ, { center: true })
    expect(points[0]).toEqual({ x: -1, y: -1, z: 0 })
    expect(points[2]).toEqual({ x: 1, y: 1, z: 0 })
  })

  it('scales the largest dimension to scaleTo', () => {
    const { points } = parseWavefront(OBJ, { center: true, scaleTo: 1 })
    expect(points[2]).toEqual({ x: 0.5, y: 0.5, z: 0 })
  })
})
