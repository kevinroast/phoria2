import * as mat3 from './math/mat3.js'
import * as mat4 from './math/mat4.js'
import { Ray } from './value/Ray.js'
import { Vec3 } from './value/Vec3.js'

/** @import { Camera } from './scene/cameras.js' */
/** @import { Node } from './scene/Node.js' */
/** @import { InstancedMesh, Lines, Mesh, Points } from './scene/drawables.js' */

// Nodes are told apart by markers (drawMode, instanceMatrices) rather than instanceof, so picking
// doesn't pull every node class into an app's bundle.

/**
 * A pick result.
 * @typedef {object} Hit
 * @property {Node} node what was hit
 * @property {Vec3} point world position of the hit
 * @property {number} distance from the ray origin, world units
 * @property {Vec3 | null} normal world space face normal (meshes)
 * @property {number | null} face triangle index (meshes), vertex index (points), segment index (lines)
 * @property {number | null} instance instance index (InstancedMesh)
 * @property {[number, number] | null} uv texture coordinate at the hit (meshes with uvs)
 * @property {any} datum the node's data for what was hit: its row for an instance or point, or the
 *   node's own data (null when it has none)
 */

const inverse = new Float32Array(16)
const instanceWorld = new Float32Array(16)
const a = new Vec3(), b = new Vec3(), c = new Vec3()

/**
 * Finds what a ray hits, on the CPU - no GPU read-back, so it also works in tests. Meshes are
 * tested against their triangles after a bounding sphere check; points and lines within a
 * tolerance in world units.
 */
export class Raycaster {
  ray = new Ray()
  near = 0
  far = Infinity
  /** How close (world units) a ray must pass to a point or line to hit it. */
  threshold = 0.1

  /**
   * Aim the ray through a position on screen.
   * @param {ArrayLike<number>} ndc [x, y] in normalised device coordinates, -1 to 1 (y up)
   * @param {Camera} camera
   * @returns {this}
   */
  setFromCamera(ndc, camera) {
    camera.updateWorld()
    const inv = mat4.invert(new Float32Array(16), mat4.multiply(new Float32Array(16), camera.projectionMatrix, camera.viewMatrix))
    if (!inv) return this
    const near = new Vec3(ndc[0], ndc[1], -1).applyMatrix4(inv)
    const far = new Vec3(ndc[0], ndc[1], 1).applyMatrix4(inv)
    if (/** @type {any} */ (camera.constructor).type === 'orthographic-camera') this.ray.origin.copy(near)
    else this.ray.origin.copy(camera.worldPosition)
    this.ray.direction.copy(far).sub(near).normalize()
    return this
  }

  /**
   * Everything the ray hits, nearest first. Invisible and unpickable nodes (and their children)
   * are skipped. World matrices are brought up to date first.
   * @param {Node | Node[]} targets
   * @returns {Hit[]}
   */
  intersect(targets) {
    /** @type {Hit[]} */
    const hits = []
    for (const target of [targets].flat()) {
      target.updateWorld()
      this.#visit(target, hits)
    }
    return hits.filter((h) => h.distance >= this.near && h.distance <= this.far).sort((x, y) => x.distance - y.distance)
  }

  /**
   * Where the ray meets one instance, point or segment of a drawable - the CPU half of GPU picking,
   * which finds what is under the pointer and leaves the exact point, face and uv to this.
   * @param {Node} node a Mesh, InstancedMesh, Points or Lines
   * @param {number} element the instance, point or segment (ignored for a plain Mesh)
   * @returns {Hit | null}
   */
  intersectElement(node, element) {
    node.updateWorld()
    const n = /** @type {any} */ (node)
    /** @type {Hit[]} */
    const hits = []
    if (n.drawMode === 'triangles' && n.instanceMatrices) {
      if (element >= n.count) return null
      mat4.multiply(instanceWorld, n.worldMatrix, n.instanceMatrices.subarray(element * 16, element * 16 + 16))
      this.#mesh(n, instanceWorld, element, hits)
    } else if (n.drawMode === 'triangles') {
      this.#mesh(n, n.worldMatrix, null, hits)
    } else if (n.drawMode === 'points') {
      const p = n.geometry.positions
      if (element >= n.geometry.drawnCount) return null
      const point = new Vec3(p[element * 3], p[element * 3 + 1], p[element * 3 + 2]).applyMatrix4(n.worldMatrix)
      hits.push({ node: n, point, distance: point.distanceTo(this.ray.origin), normal: null, face: element, instance: null, uv: null, datum: n.datumAt(element) })
    } else if (n.drawMode === 'lines') {
      const g = n.geometry, p = g.positions, idx = g.indices
      const i0 = idx ? idx[element * 2] : element * 2, i1 = idx ? idx[element * 2 + 1] : element * 2 + 1
      if (i1 >= g.vertexCount) return null
      a.set(p[i0 * 3], p[i0 * 3 + 1], p[i0 * 3 + 2]).applyMatrix4(n.worldMatrix)
      b.set(p[i1 * 3], p[i1 * 3 + 1], p[i1 * 3 + 2]).applyMatrix4(n.worldMatrix)
      const { t } = this.ray.distanceSqToSegment(a, b)
      hits.push({ node: n, point: this.ray.at(t), distance: t, normal: null, face: element, instance: null, uv: null, datum: n.datumAt(element) })
    }
    return hits[0] ?? null
  }

  /** @param {Node} node @param {Hit[]} hits */
  #visit(node, hits) {
    if (!node.visible || !node.pickable) return
    const n = /** @type {any} */ (node)
    if (n.drawMode === 'triangles' && n.instanceMatrices) {
      for (let i = 0; i < n.count; i++) {
        mat4.multiply(instanceWorld, n.worldMatrix, n.instanceMatrices.subarray(i * 16, i * 16 + 16))
        this.#mesh(n, instanceWorld, i, hits)
      }
    } else if (n.drawMode === 'triangles') {
      this.#mesh(n, n.worldMatrix, null, hits)
    } else if (n.drawMode === 'points') {
      this.#points(n, hits)
    } else if (n.drawMode === 'lines') {
      this.#lines(n, hits)
    }
    for (const child of node.children) this.#visit(child, hits)
  }

  /** @param {Mesh} mesh @param {Float32Array} world @param {number | null} instance @param {Hit[]} hits */
  #mesh(mesh, world, instance, hits) {
    const g = mesh.geometry
    if (!g.vertexCount) return
    // cheap rejection first
    const box = g.bounds
    const center = box.getCenter().applyMatrix4(world)
    const scale = Math.max(Math.hypot(world[0], world[1], world[2]), Math.hypot(world[4], world[5], world[6]), Math.hypot(world[8], world[9], world[10]))
    if (this.ray.intersectSphere(center, box.getRadius() * scale) === null) return
    if (!mat4.invert(inverse, world)) return

    // test in the mesh's own space, then report in world space
    const local = this.ray.clone().applyMatrix4(inverse)
    const p = g.positions, idx = g.indices
    const cullBack = !mesh.material.doubleSided
    let best = null, bestT = Infinity, bestFace = -1
    for (let f = 0, n = Math.floor(g.drawnCount / 3); f < n; f++) {
      const i0 = idx ? idx[f * 3] : f * 3, i1 = idx ? idx[f * 3 + 1] : f * 3 + 1, i2 = idx ? idx[f * 3 + 2] : f * 3 + 2
      a.set(p[i0 * 3], p[i0 * 3 + 1], p[i0 * 3 + 2])
      b.set(p[i1 * 3], p[i1 * 3 + 1], p[i1 * 3 + 2])
      c.set(p[i2 * 3], p[i2 * 3 + 1], p[i2 * 3 + 2])
      const hit = local.intersectTriangle(a, b, c, cullBack)
      if (hit && hit.t < bestT) {
        best = { ...hit, i0, i1, i2 }
        bestT = hit.t
        bestFace = f
      }
    }
    if (!best) return

    const point = local.at(best.t).applyMatrix4(world)
    // face normal from the local triangle, into world space with the normal matrix
    a.set(p[best.i0 * 3], p[best.i0 * 3 + 1], p[best.i0 * 3 + 2])
    b.set(p[best.i1 * 3], p[best.i1 * 3 + 1], p[best.i1 * 3 + 2]).sub(a)
    c.set(p[best.i2 * 3], p[best.i2 * 3 + 1], p[best.i2 * 3 + 2]).sub(a)
    const n = b.clone().cross(c)
    const normalMatrix = mat3.normalFromMat4(new Float32Array(9), world)
    const normal = normalMatrix ? new Vec3(
      normalMatrix[0] * n[0] + normalMatrix[3] * n[1] + normalMatrix[6] * n[2],
      normalMatrix[1] * n[0] + normalMatrix[4] * n[1] + normalMatrix[7] * n[2],
      normalMatrix[2] * n[0] + normalMatrix[5] * n[1] + normalMatrix[8] * n[2]).normalize() : null

    /** @type {[number, number] | null} */
    let uv = null
    if (g.uvs) {
      const w = 1 - best.u - best.v, t = g.uvs
      uv = [
        w * t[best.i0 * 2] + best.u * t[best.i1 * 2] + best.v * t[best.i2 * 2],
        w * t[best.i0 * 2 + 1] + best.u * t[best.i1 * 2 + 1] + best.v * t[best.i2 * 2 + 1],
      ]
    }
    // a row per vertex (a surface): the row of the hit triangle's nearest corner
    let datum = mesh.datumAt(instance)
    if (instance === null && Array.isArray(mesh.data) && mesh.data.length === g.vertexCount) {
      const w0 = 1 - best.u - best.v
      datum = mesh.data[w0 >= best.u && w0 >= best.v ? best.i0 : best.u >= best.v ? best.i1 : best.i2] ?? null
    }
    hits.push({ node: mesh, point, distance: point.distanceTo(this.ray.origin), normal, face: bestFace, instance, uv, datum })
  }

  /** @param {Points} node @param {Hit[]} hits */
  #points(node, hits) {
    const p = node.geometry.positions, w = node.worldMatrix
    const limit = this.threshold * this.threshold
    let best = null
    for (let i = 0, n = node.geometry.drawnCount; i < n; i++) {
      a.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]).applyMatrix4(w)
      const { distanceSq } = this.ray.distanceSqToPoint(a)
      if (distanceSq > limit) continue
      const distance = a.distanceTo(this.ray.origin)
      if (!best || distance < best.distance) best = { node, point: a.clone(), distance, normal: null, face: i, instance: null, uv: null, datum: node.datumAt(i) }
    }
    if (best) hits.push(best)
  }

  /** @param {Lines} node @param {Hit[]} hits */
  #lines(node, hits) {
    const g = node.geometry, p = g.positions, idx = g.indices, w = node.worldMatrix
    const limit = this.threshold * this.threshold
    let best = null
    for (let s = 0, n = Math.floor(g.drawnCount / 2); s < n; s++) {
      const i0 = idx ? idx[s * 2] : s * 2, i1 = idx ? idx[s * 2 + 1] : s * 2 + 1
      a.set(p[i0 * 3], p[i0 * 3 + 1], p[i0 * 3 + 2]).applyMatrix4(w)
      b.set(p[i1 * 3], p[i1 * 3 + 1], p[i1 * 3 + 2]).applyMatrix4(w)
      const { distanceSq, t } = this.ray.distanceSqToSegment(a, b)
      if (distanceSq > limit) continue
      if (!best || t < best.distance) best = { node, point: this.ray.at(t), distance: t, normal: null, face: s, instance: null, uv: null, datum: node.datumAt(s) }
    }
    if (best) hits.push(best)
  }
}
