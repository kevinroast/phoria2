import { vec3, vec4 } from './math.js'

/** @import { Edge, Polygon, Vec3Like } from './types.js' */

// Vectors are typed arrays - treated as values and copied whole, never walked as objects
const isVector = (v) => ArrayBuffer.isView(v)
const isObject = (v) => typeof v === 'object' && v !== null && !isVector(v)
const copy = (v) => isVector(v) ? /** @type {Float32Array} */ (v).slice() : v

/**
 * Deep merge into a new object without touching either input; source wins on conflicts. Arrays are
 * merged by index. Used to overlay user config on defaults.
 * @param {any} target
 * @param {any} src
 * @returns {any}
 */
export function merge(target, src) {
  if (Array.isArray(src)) {
    const dst = [...(target ?? [])]
    src.forEach((e, i) => {
      dst[i] = isObject(e) ? merge(target?.[i], e) : copy(e)
    })
    return dst
  }
  const dst = isObject(target) ? { ...target } : {}
  for (const [key, value] of Object.entries(src)) {
    dst[key] = isObject(value) && target?.[key] ? merge(target[key], value) : copy(value)
  }
  return dst
}

/**
 * Deep combine source into target, overwriting target properties in place.
 * @template T
 * @param {T} target
 * @param {any} src
 * @returns {T}
 */
export function combine(target, src) {
  if (Array.isArray(src) && Array.isArray(target)) {
    if (target.length < src.length) target.length = src.length
    src.forEach((e, i) => {
      if (isObject(e)) {
        target[i] ||= {}
        combine(target[i], e)
      } else {
        target[i] = copy(e)
      }
    })
    return target
  }
  for (const [key, value] of Object.entries(src)) {
    if (isObject(value)) {
      target[key] ||= Array.isArray(value) ? [] : {}
      combine(target[key], value)
    } else {
      target[key] = copy(value)
    }
  }
  return target
}

/**
 * One level deep copy, arrays and vectors copied - for simple structures such as entity styles.
 * @template {object} T
 * @param {T} src
 * @returns {T}
 */
export function clone(src) {
  /** @type {any} */
  const dst = {}
  for (const [key, value] of Object.entries(src)) {
    dst[key] = Array.isArray(value) ? [...value] : copy(value)
  }
  return dst
}

/** @param {Float32Array | number[]} m 4x4 @returns {boolean} */
export function isIdentity(m) {
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 0 &&
    m[4] === 0 && m[5] === 1 && m[6] === 0 && m[7] === 0 &&
    m[8] === 0 && m[9] === 0 && m[10] === 1 && m[11] === 0 &&
    m[12] === 0 && m[13] === 0 && m[14] === 0 && m[15] === 1
}

/**
 * Normalised vec4 normal (w=0) from the two edge vectors of a triangle.
 * @param {number} x1 @param {number} y1 @param {number} z1
 * @param {number} x2 @param {number} y2 @param {number} z2
 * @returns {Float32Array}
 */
export function calcNormalVector(x1, y1, z1, x2, y2, z2) {
  const v = vec4.fromValues(
    y1 * z2 - z1 * y2,
    -(z2 * x1 - x2 * z1),
    x1 * y2 - y1 * x2,
    0)
  return vec3.normalize(v, v)
}

/** Angle between two 3D vectors, in radians. @param {Vec3Like} v1 @param {Vec3Like} v2 @returns {number} */
export function thetaTo(v1, v2) {
  return Math.acos(vec3.dot(v1, v2) / (vec3.length(v1) * vec3.length(v2)))
}

/**
 * Average world coordinate of a polygon's vertices.
 * @param {number[]} vertices
 * @param {Float32Array[]} worldcoords
 * @returns {Float32Array}
 */
export function averagePolyVertex(vertices, worldcoords) {
  let x = 0, y = 0, z = 0
  for (let i = 0; i < vertices.length; i++) {
    const c = worldcoords[vertices[i]]
    x += c[0]
    y += c[1]
    z += c[2]
  }
  const n = vertices.length
  return vec3.fromValues(x / n, y / n, z / n)
}

/** Average w of a list of clip space coordinates. @param {Float32Array[]} coords @returns {number} */
export function averageObjectZ(coords) {
  let av = 0
  for (let i = 0; i < coords.length; i++) av += coords[i][3]
  return av / coords.length
}

/**
 * @template T
 * @param {number} len
 * @param {(i: number) => T} fnFactory
 * @returns {T[]}
 */
export const populateBuffer = (len, fnFactory) => Array.from({ length: len }, (_, i) => fnFactory(i))

/**
 * Sort polygons in place by the average Z of their vertices. Triangles and quads (nearly every
 * polygon) get unrolled paths; anything larger is averaged in a loop.
 * @param {Polygon[]} polygons
 * @param {Float32Array[]} worldcoords
 */
export function sortPolygons(polygons, worldcoords) {
  for (let i = 0; i < polygons.length; i++) {
    const verts = polygons[i].vertices
    if (verts.length === 3) {
      polygons[i]._avz = (worldcoords[verts[0]][2] + worldcoords[verts[1]][2] + worldcoords[verts[2]][2]) * 0.333333
    } else if (verts.length === 4) {
      polygons[i]._avz = (worldcoords[verts[0]][2] + worldcoords[verts[1]][2] + worldcoords[verts[2]][2] + worldcoords[verts[3]][2]) * 0.25
    } else {
      let z = 0
      for (let j = 0; j < verts.length; j++) z += worldcoords[verts[j]][2]
      polygons[i]._avz = z / verts.length
    }
  }
  polygons.sort((a, b) => a._avz < b._avz ? -1 : 1)
}

/** Sort edges in place by the average Z of their two vertices. @param {Edge[]} edges @param {Float32Array[]} coords */
export function sortEdges(edges, coords) {
  for (let i = 0; i < edges.length; i++) {
    edges[i]._avz = (coords[edges[i].a][2] + coords[edges[i].b][2]) * 0.5
  }
  edges.sort((a, b) => a._avz < b._avz ? -1 : 1)
}

/**
 * Sort points by Z, swapping worldcoords in lock-step so lighting still reads the matching world
 * position for each screen coordinate - hence a hand-rolled quicksort.
 * @param {Float32Array[]} coords
 * @param {any[]} worldcoords
 */
export function sortPoints(coords, worldcoords) {
  const swap = (i, j) => {
    let t = coords[i]; coords[i] = coords[j]; coords[j] = t
    t = worldcoords[i]; worldcoords[i] = worldcoords[j]; worldcoords[j] = t
  }
  const qsort = (start, end) => {
    if (start >= end) return
    const pivot = (start + end) >> 1
    const pivotValue = coords[pivot][2]
    let store = start
    swap(pivot, end)
    for (let i = start; i < end; i++) {
      if (coords[i][2] > pivotValue) swap(i, store++)
    }
    swap(store, end)
    qsort(start, store - 1)
    qsort(store + 1, end)
  }
  qsort(0, coords.length - 1)
}
