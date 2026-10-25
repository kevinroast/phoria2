// Converts phoria v1 model data ({x,y,z} points plus n-gon polygons) into a Geometry - the
// migration path for hand-made models.

import { Geometry } from './Geometry.js'
import { checkOptions, describe, fail } from '../validate.js'

const OWNER = 'fromPolygons()'

/**
 * @typedef {object} PolygonData
 * @property {number[]} vertices indices into `points`, 3 or more, counter-clockwise seen from the front
 * @property {number[]} [uvs] a u, v pair per vertex, in the same order
 */

/**
 * @typedef {object} PolygonsOptions
 * @property {Array<{ x: number, y: number, z: number } | number[]>} points
 * @property {PolygonData[]} polygons
 * @property {unknown} [edges] accepted and ignored, so a whole v1 model can be passed; use edges() for wireframes
 * @property {boolean} [smooth] share normals across faces at shared points - curved surfaces look round
 *   rather than faceted (default false; only without uvs, where the points stay shared)
 */

/**
 * Make a Geometry from v1-style data. Each polygon is triangulated as a fan from its first vertex
 * (fine for the convex polygons v1 models use) and given flat normals - the faceted v1 look - unless
 * `smooth` is set.
 * Without UVs the points stay shared; if any polygon has UVs every corner gets its own vertex so
 * UVs can differ per face. Other v1 polygon fields (color, texture...) are ignored.
 * @example fromPolygons({ points: [{ x: 0, y: 0, z: 0 }, ...], polygons: [{ vertices: [0, 1, 2, 3] }] })
 * @param {PolygonsOptions} options
 * @returns {Geometry}
 */
export function fromPolygons(options) {
  checkOptions(OWNER, options, ['points', 'polygons', 'edges', 'smooth'])
  const { points, polygons } = options ?? /** @type {PolygonsOptions} */ ({})
  if (!Array.isArray(points)) fail(OWNER, `'points' must be an array of { x, y, z } or [x, y, z], got ${describe(points)}`)
  if (!Array.isArray(polygons)) fail(OWNER, `'polygons' must be an array of { vertices: [...] }, got ${describe(polygons)}`)

  const xyz = points.map((pt, i) => {
    const c = Array.isArray(pt) ? pt : pt && typeof pt === 'object' ? [pt.x, pt.y, pt.z] : null
    if (!c || c.length !== 3 || !c.every(Number.isFinite)) {
      fail(OWNER, `point ${i} must be { x, y, z } or [x, y, z] numbers, got ${describe(pt)}`)
    }
    return c
  })

  polygons.forEach((polygon, p) => {
    const vs = polygon?.vertices
    if (!Array.isArray(vs) || vs.length < 3) fail(OWNER, `polygon ${p} needs 'vertices' with 3 or more point indices, got ${describe(vs)}`)
    for (const v of vs) {
      if (!Number.isInteger(v) || v < 0 || v >= xyz.length) {
        fail(OWNER, `polygon ${p} refers to point ${describe(v)} but there are only ${xyz.length} points`)
      }
    }
    const uvs = polygon.uvs
    if (uvs !== undefined && (!Array.isArray(uvs) || uvs.length !== vs.length * 2 || !uvs.every(Number.isFinite))) {
      fail(OWNER, `polygon ${p} 'uvs' must be ${vs.length * 2} numbers (a u, v pair per vertex), got ${describe(uvs)}`)
    }
  })

  // fan triangulation: (0, 1, 2), (0, 2, 3)... keeps each polygon's winding
  /** @type {Array<[number, number]>} [polygon, corner] for each triangle corner */
  const corners = []
  polygons.forEach(({ vertices }, p) => {
    for (let k = 1; k + 1 < vertices.length; k++) corners.push([p, 0], [p, k], [p, k + 1])
  })

  let geometry
  const withUvs = polygons.some((p) => p.uvs)
  if (withUvs) {
    const positions = [], uvs = []
    for (const [p, k] of corners) {
      const { vertices, uvs: pu } = polygons[p]
      positions.push(...xyz[vertices[k]])
      uvs.push(pu ? pu[k * 2] : 0, pu ? pu[k * 2 + 1] : 0)
    }
    geometry = new Geometry({ positions, uvs })
  } else {
    geometry = new Geometry({
      positions: xyz.flat(),
      indices: corners.map(([p, k]) => polygons[p].vertices[k]),
    })
  }
  return geometry.computeNormals({ flat: !(options.smooth && !withUvs) })
}
