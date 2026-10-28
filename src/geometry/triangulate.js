// Filling flat outlines with triangles: ear clipping, with holes bridged into the outline first so
// the whole thing is one polygon. Plenty for the hand-made shapes extrude() takes - a few hundred
// points - without a library.

/** @typedef {[number, number]} Point2 */

/** Twice the signed area: positive when the points run counter-clockwise. @param {Point2[]} points */
export function area(points) {
  let a = 0
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    a += (points[j][0] - points[i][0]) * (points[j][1] + points[i][1])
  }
  return a
}

/**
 * Triangles filling an outline with holes, as triples of indices into the outline's points
 * followed by each hole's, wound counter-clockwise. The outline may run either way round, and so
 * may the holes.
 * @param {Point2[]} outline
 * @param {Point2[][]} [holes]
 * @returns {number[]}
 */
export function triangulate(outline, holes = []) {
  // every point once, by index: the outline's, then each hole's in turn
  /** @type {Point2[]} */
  const points = [...outline]
  /** @type {number[]} */
  let ring = outline.map((_, i) => i)
  if (area(outline) < 0) ring.reverse()
  // holes go in clockwise, rightmost first, each bridged from its rightmost point
  const placed = holes.map((hole) => {
    const start = points.length
    points.push(...hole)
    const ids = hole.map((_, i) => start + i)
    if (area(hole) > 0) ids.reverse()
    return ids
  }).sort((a, b) => maxX(points, b) - maxX(points, a))
  for (const hole of placed) ring = bridge(points, ring, hole, placed)
  return clip(points, ring)
}

/** @param {Point2[]} points @param {number[]} ids */
const maxX = (points, ids) => Math.max(...ids.map((i) => points[i][0]))

/**
 * Join a hole into the ring: from the hole's rightmost point to the nearest point of the ring it
 * can see, there and back, so the ring runs round the hole too.
 * @param {Point2[]} points @param {number[]} ring @param {number[]} hole @param {number[][]} holes
 * @returns {number[]}
 */
function bridge(points, ring, hole, holes) {
  let m = 0
  hole.forEach((id, k) => { if (points[id][0] > points[hole[m]][0]) m = k })
  const M = points[hole[m]]
  // edges a bridge mustn't cross: the ring's and every hole's
  /** @type {[Point2, Point2][]} */
  const edges = []
  for (const ids of [ring, ...holes]) ids.forEach((id, k) => edges.push([points[id], points[ids[(k + 1) % ids.length]]]))
  let best = -1, bestD = Infinity
  ring.forEach((id, k) => {
    const P = points[id]
    const d = (P[0] - M[0]) ** 2 + (P[1] - M[1]) ** 2
    // nearer first, preferring points to the right as the usual bridge does
    const score = d * (P[0] >= M[0] ? 1 : 4)
    if (score >= bestD) return
    if (edges.some(([a, b]) => crosses(M, P, a, b))) return
    best = k
    bestD = score
  })
  if (best < 0) best = 0
  const around = [...hole.slice(m), ...hole.slice(0, m)]
  return [...ring.slice(0, best + 1), ...around, hole[m], ring[best], ...ring.slice(best + 1)]
}

/** Do segments pq and ab cross, other than at shared ends? @param {Point2} p @param {Point2} q @param {Point2} a @param {Point2} b */
function crosses(p, q, a, b) {
  if (same(p, a) || same(p, b) || same(q, a) || same(q, b)) return false
  const d1 = cross(a, b, p), d2 = cross(a, b, q), d3 = cross(p, q, a), d4 = cross(p, q, b)
  return d1 * d2 < 0 && d3 * d4 < 0
}

/** @param {Point2} a @param {Point2} b */
const same = (a, b) => a[0] === b[0] && a[1] === b[1]

/** Positive when a, b, c turn counter-clockwise. @param {Point2} a @param {Point2} b @param {Point2} c */
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

/**
 * Clip ears off a counter-clockwise ring until it is all triangles.
 * @param {Point2[]} points @param {number[]} ring
 * @returns {number[]}
 */
function clip(points, ring) {
  const left = [...ring], out = []
  while (left.length > 3) {
    let cut = -1
    for (let k = 0; k < left.length && cut < 0; k++) if (isEar(points, left, k)) cut = k
    // nothing clean to cut (a sliver, or points that overlap): take the first convex corner, or any
    if (cut < 0) for (let k = 0; k < left.length && cut < 0; k++) if (convex(points, left, k)) cut = k
    if (cut < 0) cut = 0
    const n = left.length
    out.push(left[(cut + n - 1) % n], left[cut], left[(cut + 1) % n])
    left.splice(cut, 1)
  }
  if (left.length === 3) out.push(...left)
  return out
}

/** @param {Point2[]} points @param {number[]} left @param {number} k */
function convex(points, left, k) {
  const n = left.length
  return cross(points[left[(k + n - 1) % n]], points[left[k]], points[left[(k + 1) % n]]) > 0
}

/** A convex corner with no other point inside its triangle. @param {Point2[]} points @param {number[]} left @param {number} k */
function isEar(points, left, k) {
  if (!convex(points, left, k)) return false
  const n = left.length
  const a = points[left[(k + n - 1) % n]], b = points[left[k]], c = points[left[(k + 1) % n]]
  for (const id of left) {
    const p = points[id]
    if (same(p, a) || same(p, b) || same(p, c)) continue
    if (cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0) return false
  }
  return true
}
