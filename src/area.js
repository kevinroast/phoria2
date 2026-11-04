// Picking an area of the canvas: everything whose place on screen falls inside a box or a lasso drawn
// over it - each point, instance and line segment on its own, and a mesh by its middle. Positions
// are tested, not surfaces, so what is hidden behind other things is found too: selecting a region
// of a scatter takes the whole region, front to back.
import * as mat4 from './math/mat4.js'
import { hiddenInstance } from './scene/drawables.js'
import { Vec3 } from './value/Vec3.js'
import { describe, fail } from './validate.js'

/** @import { Hit } from './Raycaster.js' */
/** @import { Node } from './scene/Node.js' */
/** @import { Camera } from './scene/cameras.js' */

/**
 * A box on the canvas, CSS pixels from its top left - width and height may be negative, as a drag
 * up or left makes them - or a lasso: the points of a polygon, [x, y] each.
 * @typedef {{ x: number, y: number, width: number, height: number } | [number, number][]} PickArea
 */

const instanceWorld = new Float32Array(16)

/**
 * The polygon an area is, and its bounding box, for the inside test.
 * @param {PickArea} area
 * @returns {{ points: number[], left: number, top: number, right: number, bottom: number }}
 */
function outline(area) {
  /** @type {number[]} */
  let points
  if (Array.isArray(area)) {
    if (area.length < 3 || !area.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) {
      fail('View', `pickArea() takes a box { x, y, width, height } or a lasso of three or more [x, y] points, got ${describe(area)}`)
    }
    points = area.flat()
  } else {
    const { x, y, width, height } = area ?? /** @type {any} */ ({})
    if (![x, y, width, height].every(Number.isFinite)) {
      fail('View', `pickArea() takes a box { x, y, width, height } or a lasso of three or more [x, y] points, got ${describe(area)}`)
    }
    points = [x, y, x + width, y, x + width, y + height, x, y + height]
  }
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (let i = 0; i < points.length; i += 2) {
    left = Math.min(left, points[i])
    right = Math.max(right, points[i])
    top = Math.min(top, points[i + 1])
    bottom = Math.max(bottom, points[i + 1])
  }
  return { points, left, top, right, bottom }
}

/** Is (x, y) inside the polygon? Even-odd crossings. @param {number[]} p @param {number} x @param {number} y */
function inside(p, x, y) {
  let into = false
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const yi = p[i + 1], yj = p[j + 1]
    if ((yi > y) !== (yj > y) && x < p[i] + (p[j] - p[i]) * (y - yi) / (yj - yi)) into = !into
  }
  return into
}

/**
 * Everything in the scene the camera shows, pickable, whose place falls inside the area - nearest
 * the camera first.
 * @param {Node} scene @param {Camera} camera @param {Float32Array} viewProjection
 * @param {number} width @param {number} height the canvas, CSS pixels
 * @param {PickArea} area
 * @returns {Hit[]}
 */
export function pickArea(scene, camera, viewProjection, width, height, area) {
  const shape = outline(area)
  const eye = camera.worldPosition
  const m = viewProjection
  /** @type {Hit[]} */
  const hits = []
  /** World position (x, y, z) inside the area? @param {number} x @param {number} y @param {number} z */
  const within = (x, y, z) => {
    const w = m[3] * x + m[7] * y + m[11] * z + m[15]
    if (w <= 0) return false
    const nz = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w
    if (nz < -1 || nz > 1) return false
    const sx = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / w * 0.5 + 0.5) * width
    const sy = (0.5 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w * 0.5) * height
    return sx >= shape.left && sx <= shape.right && sy >= shape.top && sy <= shape.bottom && inside(shape.points, sx, sy)
  }
  /** @param {any} node @param {number} x @param {number} y @param {number} z @param {number | null} face @param {number | null} instance */
  const hit = (node, x, y, z, face, instance) => {
    const point = new Vec3(x, y, z)
    hits.push({ node, point, distance: point.distanceTo(eye), normal: null, face, instance, uv: null, datum: node.datumAt(instance ?? face) })
  }
  const p = new Vec3()

  /** @param {Node} node */
  const visit = (node) => {
    if (!node.shownTo(camera) || !node.pickable) return
    const n = /** @type {any} */ (node)
    if (n.isDrawable && n.geometry.vertexCount) {
      const g = n.geometry, world = n.worldMatrix
      if (n.drawMode === 'points') {
        const pos = g.positions
        for (let i = 0; i < g.drawnVertices; i++) {
          p.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(world)
          if (within(p[0], p[1], p[2])) hit(n, p[0], p[1], p[2], i, null)
        }
      } else if (n.drawMode === 'lines') {
        // a segment by its middle
        const pos = g.positions, idx = g.indices
        for (let s = 0; s < Math.floor(g.drawnCount / 2); s++) {
          const a = idx ? idx[s * 2] : s * 2, b = idx ? idx[s * 2 + 1] : s * 2 + 1
          p.set((pos[a * 3] + pos[b * 3]) / 2, (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2, (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2).applyMatrix4(world)
          if (within(p[0], p[1], p[2])) hit(n, p[0], p[1], p[2], s, null)
        }
      } else if (n.instanceMatrices) {
        // each instance by the middle of its copy of the geometry; hidden ones aren't there
        const centre = g.bounds.getCenter()
        for (let i = 0; i < n.count; i++) {
          if (hiddenInstance(n.instanceMatrices, i)) continue
          mat4.multiply(instanceWorld, world, n.instanceMatrices.subarray(i * 16, i * 16 + 16))
          p.copy(centre).applyMatrix4(instanceWorld)
          if (within(p[0], p[1], p[2])) hit(n, p[0], p[1], p[2], null, i)
        }
      } else {
        p.copy(g.bounds.getCenter()).applyMatrix4(world)
        if (within(p[0], p[1], p[2])) hit(n, p[0], p[1], p[2], null, null)
      }
    }
    for (const child of node.children) visit(child)
  }
  visit(scene)
  return hits.sort((a, b) => a.distance - b.distance)
}
