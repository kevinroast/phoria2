// Meshes that move their own vertices: skinned - a skeleton of joints, each vertex following a few
// of them by weight - and morphed - blend shapes, offsets for every vertex mixed by weight. Both come
// from glTF models. The GPU poses them for drawing (MESH_VERTEX in webgl/shaders.js); this is the
// CPU's side: the joints' matrices the GPU reads, bounds that follow the pose - for culling, framing
// and shadows, cheap enough for every frame - and the posed vertices themselves, for rays.
import * as mat4 from '../math/mat4.js'
import { Box3 } from '../value/Box3.js'

/** @import { Node } from './Node.js' */
/** @import { Geometry } from '../geometry/Geometry.js' */
/** @import { Mat4Like } from '../math/mat4.js' */

/**
 * One blend shape: an offset for each vertex's position (and normal), and the longest of them.
 * @typedef {{ positions: Float32Array, normals: Float32Array | null, reach: number }} MorphTarget
 */

/**
 * A geometry's skinning and blend shapes: per vertex, the four joints it follows (as numbers, indices
 * into its skin's joints) and how much it follows each; and its morph targets.
 * @typedef {{ joints: Float32Array | null, weights: Float32Array | null, targets: MorphTarget[] }} Deform
 */

/**
 * What a mesh needs to be deformed - its skin, its morph weights - read without importing Mesh.
 * @typedef {{ skin: Skin | null, morphWeights: Float32Array | null, geometry: Geometry, worldMatrix: Mat4Like }} Deformable
 */

const INVERSE = new Float32Array(16)
const M = new Float32Array(16)
const IDENTITY = mat4.identity(new Float32Array(16))

/**
 * A skeleton: the joints a skinned mesh follows, and each one's inverse bind matrix - from the mesh's
 * space as it was modelled to the joint's own. Shared by every mesh bound to the same joints.
 */
export class Skin {
  /** @type {Node[]} */ joints
  /** 16 numbers a joint. @type {Float32Array} */ inverseBind
  /** Each joint's move from the bind pose to now, in the mesh's own space - 16 numbers a joint. @type {Float32Array} */ matrices
  /** Bumped when the matrices change, so the GPU's copy is sent again only then. */
  version = 0
  /** Where each joint was in the bind pose, in the mesh's space - 3 numbers a joint. @type {Float32Array} */ #bindPositions
  /** Per geometry bound to it: how far each joint's vertices reach from it (-1 for a joint none follow). @type {WeakMap<Geometry, Float32Array>} */ #reach = new WeakMap()

  /** @param {Node[]} joints @param {Float32Array | null} inverseBind 16 numbers a joint; identities when null */
  constructor(joints, inverseBind) {
    const n = joints.length
    this.joints = joints
    this.inverseBind = inverseBind ?? new Float32Array(n * 16)
    if (!inverseBind) for (let i = 0; i < n; i++) this.inverseBind.set(IDENTITY, i * 16)
    this.matrices = new Float32Array(n * 16)
    for (let i = 0; i < n; i++) this.matrices.set(IDENTITY, i * 16)
    this.#bindPositions = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      // the joint's origin, back in the mesh's space: the inverse of the inverse bind matrix
      if (!mat4.invert(M, this.inverseBind.subarray(i * 16, i * 16 + 16))) continue
      this.#bindPositions.set([M[12], M[13], M[14]], i * 3)
    }
  }

  /**
   * Each joint's matrix for now - its world matrix times its inverse bind matrix, brought into the
   * mesh's own space, so the mesh's world matrix places the result as it places anything else. Call
   * with world matrices up to date (the scene's update does that every frame).
   * @param {Mat4Like} meshWorld
   * @returns {Float32Array}
   */
  update(meshWorld) {
    if (!mat4.invert(INVERSE, meshWorld)) INVERSE.set(IDENTITY)
    const out = this.matrices
    let changed = false
    for (let i = 0; i < this.joints.length; i++) {
      mat4.multiply(M, this.joints[i].worldMatrix, this.inverseBind, i * 16)
      mat4.multiply(M, INVERSE, M)
      for (let k = 0; k < 16; k++) {
        if (out[i * 16 + k] !== M[k]) {
          out[i * 16 + k] = M[k]
          changed = true
        }
      }
    }
    if (changed) this.version++
    return out
  }

  /**
   * How far each joint's vertices reach from it in the bind pose, for a geometry bound to this skin
   * - worked out once.
   * @param {Geometry} geometry
   * @returns {Float32Array}
   */
  reachIn(geometry) {
    let reach = this.#reach.get(geometry)
    if (reach) return reach
    reach = new Float32Array(this.joints.length).fill(-1)
    const d = geometry.deform, p = geometry.positions, b = this.#bindPositions
    if (d?.joints && d.weights) {
      for (let v = 0; v < geometry.vertexCount; v++) {
        for (let k = 0; k < 4; k++) {
          if (d.weights[v * 4 + k] <= 0) continue
          const j = Math.round(d.joints[v * 4 + k])
          if (j < 0 || j >= reach.length) continue
          const r = Math.hypot(p[v * 3] - b[j * 3], p[v * 3 + 1] - b[j * 3 + 1], p[v * 3 + 2] - b[j * 3 + 2])
          if (r > reach[j]) reach[j] = r
        }
      }
    }
    this.#reach.set(geometry, reach)
    return reach
  }

  /** @internal Where joint i was in the bind pose. @param {number} i @returns {Float32Array} */
  bindPosition(i) {
    return this.#bindPositions.subarray(i * 3, i * 3 + 3)
  }
}

/**
 * Does this mesh move its own vertices - a skin, or blend shapes it has weights for?
 * @param {any} node
 * @returns {boolean}
 */
export function isDeformed(node) {
  return !!(node.skin || (node.morphWeights && node.geometry?.deform?.targets.length))
}

/**
 * How far the blend shapes can move any vertex at their weights now.
 * @param {Deformable} mesh
 * @returns {number}
 */
function morphReach(mesh) {
  const targets = mesh.geometry.deform?.targets, w = mesh.morphWeights
  if (!targets || !w) return 0
  let reach = 0
  for (let t = 0; t < targets.length; t++) reach += Math.abs(w[t] ?? 0) * targets[t].reach
  return reach
}

/**
 * A deformed mesh's bounds in its own space, as it is posed now: for a skin, a sphere round each
 * joint that moves vertices, as far as they reach from it - a little loose, but cheap enough for
 * every frame; for blend shapes alone, the geometry's bounds grown by how far they move it.
 * @param {Deformable} mesh
 * @param {Box3} [out]
 * @returns {Box3}
 */
export function deformedBounds(mesh, out = new Box3()) {
  const { geometry, skin } = mesh
  const pad = morphReach(mesh)
  if (!skin) {
    out.copy(geometry.bounds)
    if (pad) {
      for (let k = 0; k < 3; k++) {
        out.min[k] -= pad
        out.max[k] += pad
      }
    }
    return out
  }
  const m = skin.update(mesh.worldMatrix), reach = skin.reachIn(geometry)
  out.makeEmpty()
  for (let i = 0; i < reach.length; i++) {
    if (reach[i] < 0) continue
    const at = i * 16, b = skin.bindPosition(i)
    const x = m[at] * b[0] + m[at + 4] * b[1] + m[at + 8] * b[2] + m[at + 12]
    const y = m[at + 1] * b[0] + m[at + 5] * b[1] + m[at + 9] * b[2] + m[at + 13]
    const z = m[at + 2] * b[0] + m[at + 6] * b[1] + m[at + 10] * b[2] + m[at + 14]
    const scale = Math.max(Math.hypot(m[at], m[at + 1], m[at + 2]), Math.hypot(m[at + 4], m[at + 5], m[at + 6]), Math.hypot(m[at + 8], m[at + 9], m[at + 10]))
    const r = (reach[i] + pad) * scale
    out.expandByXYZ(x - r, y - r, z - r)
    out.expandByXYZ(x + r, y + r, z + r)
  }
  if (out.isEmpty()) out.copy(geometry.bounds)
  return out
}

/** The last posed positions worked out for each mesh, and the pose they were for. @type {WeakMap<object, { key: Float32Array, positions: Float32Array }>} */
const POSED = new WeakMap()

/**
 * A deformed mesh's vertices as they are drawn now, in its own space - the blend shapes mixed in,
 * then skinned, as the GPU does it. Worked out again only when the pose has changed. For rays: a
 * hit on a posed character, or a label hidden behind one.
 * @param {Deformable} mesh
 * @returns {Float32Array}
 */
export function posedPositions(mesh) {
  const { geometry, skin, morphWeights } = mesh
  const d = geometry.deform
  const matrices = skin ? skin.update(mesh.worldMatrix) : null
  // the pose, as numbers: the joints' matrices and the weights
  const keyLength = (matrices?.length ?? 0) + (morphWeights?.length ?? 0)
  const cached = POSED.get(mesh)
  if (cached && cached.key.length === keyLength && cached.positions.length === geometry.positions.length) {
    let same = true
    const key = cached.key
    if (matrices) for (let i = 0; same && i < matrices.length; i++) same = key[i] === matrices[i]
    const off = matrices?.length ?? 0
    if (morphWeights) for (let i = 0; same && i < morphWeights.length; i++) same = key[off + i] === morphWeights[i]
    if (same) return cached.positions
  }
  const base = geometry.positions, n = geometry.vertexCount
  const out = cached?.positions.length === base.length ? cached.positions : new Float32Array(base.length)
  out.set(base)
  if (d?.targets.length && morphWeights) {
    for (let t = 0; t < d.targets.length; t++) {
      const w = morphWeights[t] ?? 0
      if (!w) continue
      const delta = d.targets[t].positions
      for (let i = 0; i < out.length; i++) out[i] += w * delta[i]
    }
  }
  if (matrices && d?.joints && d.weights) {
    const { joints, weights } = d
    for (let v = 0; v < n; v++) {
      const px = out[v * 3], py = out[v * 3 + 1], pz = out[v * 3 + 2]
      let x = 0, y = 0, z = 0
      for (let k = 0; k < 4; k++) {
        const w = weights[v * 4 + k]
        if (!w) continue
        const at = Math.round(joints[v * 4 + k]) * 16
        x += w * (matrices[at] * px + matrices[at + 4] * py + matrices[at + 8] * pz + matrices[at + 12])
        y += w * (matrices[at + 1] * px + matrices[at + 5] * py + matrices[at + 9] * pz + matrices[at + 13])
        z += w * (matrices[at + 2] * px + matrices[at + 6] * py + matrices[at + 10] * pz + matrices[at + 14])
      }
      out[v * 3] = x
      out[v * 3 + 1] = y
      out[v * 3 + 2] = z
    }
  }
  const key = new Float32Array(keyLength)
  if (matrices) key.set(matrices)
  if (morphWeights) key.set(morphWeights, matrices?.length ?? 0)
  POSED.set(mesh, { key, positions: out })
  return out
}
