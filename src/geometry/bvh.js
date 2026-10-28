// A bounding volume hierarchy over a geometry's triangles, so a ray tests a few dozen boxes and a
// handful of triangles rather than every triangle - picking, label occlusion and the exact step of
// GPU picking stay quick on models of hundreds of thousands of triangles. Built the first time a
// ray needs it, and again only when the geometry changes (needsUpdate()).

/** @import { Geometry } from './Geometry.js' */

// triangles in a leaf, at most
const LEAF = 8
// below this, testing every triangle is as quick as building and walking a tree
export const BVH_MIN_TRIANGLES = 128

/**
 * @typedef {object} BVH
 * @property {Float32Array} boxes min xyz, max xyz per node
 * @property {Int32Array} nodes per node: the first child (inner) or first triangle slot (leaf),
 *   and the triangle count (0 for an inner node, whose children are at first and first + 1)
 * @property {Uint32Array} order triangle indices, grouped by leaf
 */

/** @type {WeakMap<Geometry, { version: number, count: number, bvh: BVH }>} */
const cache = new WeakMap()

/**
 * The geometry's BVH over its first `count` triangles, built now if it hasn't been or the geometry
 * has changed since.
 * @param {Geometry} g @param {number} count triangles
 * @returns {BVH}
 */
export function bvhOf(g, count) {
  const hit = cache.get(g)
  if (hit && hit.version === g.version && hit.count === count) return hit.bvh
  const bvh = build(g, count)
  cache.set(g, { version: g.version, count, bvh })
  return bvh
}

/** @param {Geometry} g @param {number} count @returns {BVH} */
function build(g, count) {
  const p = g.positions, idx = g.indices
  const corner = (f, k) => (idx ? idx[f * 3 + k] : f * 3 + k) * 3
  // each triangle's box and centre
  const tri = new Float32Array(count * 9)
  for (let f = 0; f < count; f++) {
    const a = corner(f, 0), b = corner(f, 1), c = corner(f, 2)
    for (let k = 0; k < 3; k++) {
      const lo = Math.min(p[a + k], p[b + k], p[c + k]), hi = Math.max(p[a + k], p[b + k], p[c + k])
      tri[f * 9 + k] = lo
      tri[f * 9 + 3 + k] = hi
      tri[f * 9 + 6 + k] = (lo + hi) / 2
    }
  }
  const order = new Uint32Array(count)
  for (let f = 0; f < count; f++) order[f] = f
  const maxNodes = Math.max(1, 2 * Math.ceil(count / LEAF) * 2)
  let boxes = new Float32Array(maxNodes * 6), nodes = new Int32Array(maxNodes * 2), used = 0
  const grow = () => {
    const b = new Float32Array(boxes.length * 2), n = new Int32Array(nodes.length * 2)
    b.set(boxes); n.set(nodes)
    boxes = b; nodes = n
  }
  const alloc = () => {
    if ((used + 1) * 2 > nodes.length) grow()
    return used++
  }
  // split [start, end) of order into the node at `at`, longest axis of the centres, at the median
  const stack = [[alloc(), 0, count]]
  while (stack.length) {
    const [at, start, end] = /** @type {number[]} */ (stack.pop())
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
    let cx0 = Infinity, cy0 = Infinity, cz0 = Infinity, cx1 = -Infinity, cy1 = -Infinity, cz1 = -Infinity
    for (let i = start; i < end; i++) {
      const t = order[i] * 9
      x0 = Math.min(x0, tri[t]); y0 = Math.min(y0, tri[t + 1]); z0 = Math.min(z0, tri[t + 2])
      x1 = Math.max(x1, tri[t + 3]); y1 = Math.max(y1, tri[t + 4]); z1 = Math.max(z1, tri[t + 5])
      cx0 = Math.min(cx0, tri[t + 6]); cy0 = Math.min(cy0, tri[t + 7]); cz0 = Math.min(cz0, tri[t + 8])
      cx1 = Math.max(cx1, tri[t + 6]); cy1 = Math.max(cy1, tri[t + 7]); cz1 = Math.max(cz1, tri[t + 8])
    }
    boxes.set([x0, y0, z0, x1, y1, z1], at * 6)
    const sx = cx1 - cx0, sy = cy1 - cy0, sz = cz1 - cz0
    if (end - start <= LEAF || Math.max(sx, sy, sz) <= 0) {
      nodes[at * 2] = start
      nodes[at * 2 + 1] = end - start
      continue
    }
    const axis = sx >= sy && sx >= sz ? 6 : sy >= sz ? 7 : 8
    const mid = (start + end) >> 1
    partition(order, tri, axis, start, end, mid)
    const left = alloc()
    alloc()
    nodes[at * 2] = left
    nodes[at * 2 + 1] = 0
    stack.push([left, start, mid], [left + 1, mid, end])
  }
  return { boxes: boxes.slice(0, used * 6), nodes: nodes.slice(0, used * 2), order }
}

/**
 * Put the k-th smallest (by centre on `axis`) at k, smaller before it and larger after - quickselect.
 * @param {Uint32Array} order @param {Float32Array} tri @param {number} axis @param {number} lo @param {number} hi @param {number} k
 */
function partition(order, tri, axis, lo, hi, k) {
  let l = lo, r = hi - 1
  while (l < r) {
    const pivot = tri[order[(l + r) >> 1] * 9 + axis]
    let i = l, j = r
    while (i <= j) {
      while (tri[order[i] * 9 + axis] < pivot) i++
      while (tri[order[j] * 9 + axis] > pivot) j--
      if (i <= j) {
        const s = order[i]; order[i] = order[j]; order[j] = s
        i++; j--
      }
    }
    if (k <= j) r = j
    else if (k >= i) l = i
    else break
  }
}

/**
 * Walk the tree along a ray, nearest boxes first, calling `test(triangle)` for each triangle in a
 * leaf the ray reaches. `test` returns the distance of the nearest hit so far (Infinity for none),
 * and boxes further than that are skipped.
 * @param {BVH} bvh @param {ArrayLike<number>} o ray origin @param {ArrayLike<number>} d ray direction
 * @param {(triangle: number) => number} test
 */
export function walk(bvh, o, d, test) {
  const { boxes, nodes, order } = bvh
  const ix = 1 / d[0], iy = 1 / d[1], iz = 1 / d[2]
  // where the ray enters a node's box, or Infinity if it misses
  const enter = (n) => {
    const b = n * 6
    let t0 = (boxes[b] - o[0]) * ix, t1 = (boxes[b + 3] - o[0]) * ix
    let lo = Math.min(t0, t1), hi = Math.max(t0, t1)
    t0 = (boxes[b + 1] - o[1]) * iy; t1 = (boxes[b + 4] - o[1]) * iy
    lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1))
    t0 = (boxes[b + 2] - o[2]) * iz; t1 = (boxes[b + 5] - o[2]) * iz
    lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1))
    // NaN from a ray along a face counts as a hit - better a test too many than a miss
    return hi >= Math.max(lo, 0) || Number.isNaN(lo) || Number.isNaN(hi) ? Math.max(lo, 0) || 0 : Infinity
  }
  let best = Infinity
  // a box is worth opening if the ray enters it at all (a miss is Infinity - never worth it, even
  // before anything has been hit) and no further away than the nearest hit so far
  const worth = (t) => t !== Infinity && t <= best
  const root = enter(0)
  if (root === Infinity) return
  const stack = [0], at = [root]
  while (stack.length) {
    const n = /** @type {number} */ (stack.pop()), t = /** @type {number} */ (at.pop())
    if (t > best) continue
    const first = nodes[n * 2], count = nodes[n * 2 + 1]
    if (count) {
      for (let i = first; i < first + count; i++) best = Math.min(best, test(order[i]))
      continue
    }
    const a = enter(first), b = enter(first + 1)
    // the nearer child last, so it comes off the stack first
    if (a <= b) {
      if (worth(b)) { stack.push(first + 1); at.push(b) }
      if (worth(a)) { stack.push(first); at.push(a) }
    } else {
      if (worth(a)) { stack.push(first); at.push(a) }
      if (worth(b)) { stack.push(first + 1); at.push(b) }
    }
  }
}
