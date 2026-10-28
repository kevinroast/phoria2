import { DirectionalLight, Geometry, HemisphereLight, Mesh, PointLight, SpotLight, Texture, View, cylinder, lathe, plane } from 'phoria2'

// A jack-o'-lantern in a dark studio. The pumpkin is made in code - ribbed lobes, a dimple at
// the stem, a skin of fine streaks as a bump map - and its face is carved right through a wall
// two centimetres thick, so the cut edges show the pale flesh. A candle inside is a point light
// that casts shadows all round: the shell holds its light in, and only the carved face lets it
// out, throwing the grin across the floor. Pick another face to carve it afresh.

/** Lobes round the pumpkin, its radius and half its height, and the thickness of its wall, in metres. */
const LOBES = 9, RADIUS = 0.16, HALF = 0.12, WALL = 0.018
/** The skin's grid: round the pumpkin, and from the stem down. Fine enough for crisp cut edges. */
const AROUND = 288, DOWN = 144

// each face is a few shapes drawn on the front of the pumpkin, as if seen straight on: x across
// and y up from its middle, in metres
const FACES = {
  classic: [
    [[-0.088, 0.02], [-0.032, 0.02], [-0.06, 0.068]],
    [[0.032, 0.02], [0.088, 0.02], [0.06, 0.068]],
    [[-0.017, -0.012], [0.017, -0.012], [0, 0.014]],
    grin({ width: 0.105, top: -0.034, bottom: -0.08, teeth: [[-0.046, -0.02, -0.056], [0.02, 0.046, -0.048]] }),
  ],
  scary: [
    [[-0.098, 0.064], [-0.026, 0.026], [-0.084, 0.01]],
    [[0.098, 0.064], [0.026, 0.026], [0.084, 0.01]],
    [[-0.014, 0.01], [0.014, 0.01], [0, -0.018]],
    fangs({ width: 0.11, top: -0.03, bottom: -0.088, fang: 0.019, count: 9 }),
  ],
  cute: [
    circle(-0.055, 0.04, 0.023),
    circle(0.055, 0.04, 0.023),
    [[-0.012, 0.012], [0.012, 0.012], [0, -0.004]],
    smile({ top: -0.033, bottom: -0.056, curve: 2.4, width: 0.085 }),
  ],
}

export default function run({ canvas, gui, info }) {
  const BACKDROP = '#0b0a10'
  const view = new View({
    canvas, background: BACKDROP,
    bloom: { strength: 0.9, radius: 0.6, threshold: 0.75 },
    orbit: { minDistance: 0.45, maxDistance: 2.2, minPitch: 0.05, maxPitch: 1.3 },
    camera: { position: [0.18, 0.42, 1.05], target: [0, 0.1, 0.12], fov: 34 },
  })
  const scene = view.scene
  scene.fog = { color: BACKDROP, density: 0.35 }

  // a dark studio: a floor fading into the backdrop, a cold key light from the front, a rim light
  // behind, a little fill
  scene.add(new Mesh({ geometry: plane(8), material: { color: '#2a2530', roughness: 0.75 }, receiveShadow: true }))
  scene.add(new HemisphereLight({ sky: '#283048', ground: '#100c10', intensity: 0.25 }))
  scene.add(new SpotLight({ position: [-0.9, 1.1, 1.0], target: [0, 0.1, 0], color: '#dfe3ff', intensity: 1.5, angle: 0.32, penumbra: 0.7 }))
  scene.add(new DirectionalLight({ direction: [0.5, -0.7, 1], color: '#8ea2ff', intensity: 0.5, castShadow: true }))

  // the skin waxy and streaked; the flesh pale and matt, lit only by the candle
  const carved = carve(FACES.classic)
  const skin = scene.add(new Mesh({ geometry: carved.skin, material: { vertexColors: true, roughness: 0.5, bumpMap: streaks(), bumpScale: 0.0003 }, castShadow: true, receiveShadow: true }))
  // a real lantern's light bounces round inside it, so the flesh glows a little all over
  const flesh = scene.add(new Mesh({ geometry: carved.flesh, material: { vertexColors: true, roughness: 0.85, emissive: '#ff7a1c', emissiveIntensity: 0.3 }, castShadow: true, receiveShadow: true }))
  scene.add(stem())

  // a pillar candle inside, its flame about level with the nose so the grin is thrown down on to
  // the floor and the eyes up into the dark
  const floor = WALL + 0.012
  scene.add(new Mesh({ geometry: cylinder({ radius: 0.017, height: 0.085 }), position: [0, floor + 0.0425, 0], material: { color: '#f3ead6', roughness: 0.6 }, castShadow: true }))
  scene.add(new Mesh({ geometry: cylinder({ radius: 0.0012, height: 0.008 }), position: [0, floor + 0.089, 0], material: { color: '#1a1410' } }))
  const flameAt = [0, floor + 0.1, 0]
  const flame = scene.add(new Mesh({
    geometry: lathe({ points: [[0, -0.008], [0.0045, -0.004], [0.005, 0.002], [0.003, 0.01], [0, 0.018]], segments: 16 }),
    position: flameAt, material: { color: '#000', emissive: '#ffb04a', emissiveIntensity: 6 },
  }))
  const candle = scene.add(new PointLight({ position: flameAt, color: '#ff9a3c', intensity: 0.5, range: 4, castShadow: true }))

  const settings = { face: 'classic' }
  gui.add(settings, 'face', { Classic: 'classic', Scary: 'scary', Cute: 'cute' }).name('face').onChange((/** @type {keyof typeof FACES} */ name) => {
    // the old carving's geometry goes with it
    const old = [skin.geometry, flesh.geometry]
    const fresh = carve(FACES[name])
    skin.geometry = fresh.skin
    flesh.geometry = fresh.flesh
    for (const g of old) g.dispose()
  })
  info.textContent = "A jack-o'-lantern: the candle is a point light casting shadows all round, so its light leaves only through the carved face"

  // the flame flickers: a few slow and quick wobbles, never quite repeating
  return view.start((_dt, t) => {
    const flicker = 0.82 + 0.1 * Math.sin(t * 7.3) + 0.06 * Math.sin(t * 13.1 + 1.7) + 0.04 * Math.sin(t * 23.7 + 0.3)
    candle.intensity = 0.5 * flicker
    flesh.material.emissiveIntensity = 0.3 * flicker
    const sway = 0.0012 * Math.sin(t * 3.1) + 0.0006 * Math.sin(t * 8.9)
    candle.position.set(flameAt[0] + sway, flameAt[1], flameAt[2] + 0.5 * sway)
    flame.position.set(flameAt[0] + sway * 0.6, flameAt[1], flameAt[2] + 0.3 * sway)
    flame.scale.set(1, 0.92 + 0.12 * flicker, 1)
    flame.rotation.z = sway * 18
  })
}

// --- the pumpkin's shape

/** How far the pumpkin is lifted so its lowest point is on the floor. */
const LIFT = (() => {
  let low = Infinity
  for (let i = 0; i <= 400; i++) low = Math.min(low, profile(i / 400).y)
  return -low * HALF
})()

/** The pumpkin's outline from the stem (v = 0) down: a squat ball with a dimple at each end. @param {number} v */
function profile(v) {
  const phi = v * Math.PI, s = Math.sin(phi), c = Math.cos(phi)
  // the ends sink in: deeper at the stem than underneath
  const y = phi < Math.PI / 2 ? c - 0.35 * (1 - s) ** 4 : c + 0.18 * (1 - s) ** 4
  return { r: Math.pow(s, 0.85), y, s }
}

/**
 * The outside of the pumpkin at (u, v): u round it, the front (+Z) half way; v from the stem down.
 * Also how far into a groove between lobes it is, 0 - 1, for its colour.
 * @param {number} u @param {number} v
 */
function outside(u, v) {
  const theta = (u - 0.5) * Math.PI * 2
  const { r, y, s } = profile(v)
  // lobes full in the middle and pinched into a groove between, unevenly - no two quite the same
  const warp = theta + 0.06 * Math.sin(3 * theta + 0.7)
  const groove = 1 - Math.pow(Math.abs(Math.cos(LOBES * warp / 2)), 0.4)
  const depth = 0.075 * (1 + 0.3 * Math.sin(2 * theta + 1.3)) * Math.pow(s, 0.6)
  const radius = RADIUS * r * (1 - depth * groove) * (1 + 0.025 * Math.sin(theta + 0.4))
  return { x: radius * Math.sin(theta), y: HALF * y + LIFT, z: radius * Math.cos(theta), groove }
}

/** The outward normal at (u, v), from the surface either side. @param {number} u @param {number} v */
function normalAt(u, v) {
  const e = 1e-4
  const a = outside(u - e, v), b = outside(u + e, v), c = outside(u, Math.max(0, v - e)), d = outside(u, Math.min(1, v + e))
  const su = [b.x - a.x, b.y - a.y, b.z - a.z], sv = [d.x - c.x, d.y - c.y, d.z - c.z]
  // down the pumpkin crossed with round it points out
  const n = [sv[1] * su[2] - sv[2] * su[1], sv[2] * su[0] - sv[0] * su[2], sv[0] * su[1] - sv[1] * su[0]]
  const len = Math.hypot(n[0], n[1], n[2])
  // at the very ends every u is the same point: straight up out of the stem's dimple, down underneath
  return len > 1e-12 ? [n[0] / len, n[1] / len, n[2] / len] : [0, v < 0.5 ? 1 : -1, 0]
}

// --- carving

/**
 * The pumpkin with a face carved through it: its skin, and its flesh - the inside of the wall and
 * the cut edges. Each triangle of the skin's grid is clipped against the face's shapes, the same
 * cut is made in the inside of the wall, and the two are joined round every hole.
 * @param {number[][][]} shapes
 */
function carve(shapes) {
  const middle = HALF * profile(0.5).y + LIFT
  // how far outside the face's shapes a point is, in metres - negative inside a hole. Only the front
  // is carved
  const away = (/** @type {{ x: number, y: number, z: number }} */ p) => {
    if (p.z < 0.03) return 1
    let d = Infinity
    for (const shape of shapes) d = Math.min(d, polygonDistance(p.x, p.y - middle, shape))
    return d
  }

  // every point twice: on the skin, and the same point WALL further in
  const uv = [], outer = [], inner = [], normal = [], colour = [], distance = []
  const add = (/** @type {number} */ u, /** @type {number} */ v) => {
    const p = outside(u, v), n = normalAt(u, v)
    uv.push(u, v)
    outer.push(p.x, p.y, p.z)
    inner.push(p.x - n[0] * WALL, p.y - n[1] * WALL, p.z - n[2] * WALL)
    normal.push(...n)
    colour.push(...skinColour(p.groove, v))
    distance.push(away(p))
    return distance.length - 1
  }
  for (let j = 0; j <= DOWN; j++) for (let i = 0; i <= AROUND; i++) add(i / AROUND, j / DOWN)

  // where an edge crosses a hole's outline: a point on the surface, shared by the triangles either side
  /** @type {Map<number, number>} */
  const cuts = new Map()
  const cut = (/** @type {number} */ a, /** @type {number} */ b) => {
    const key = a < b ? a * 1e6 + b : b * 1e6 + a
    let k = cuts.get(key)
    if (k === undefined) {
      const t = distance[a] / (distance[a] - distance[b])
      k = add(uv[a * 2] + (uv[b * 2] - uv[a * 2]) * t, uv[a * 2 + 1] + (uv[b * 2 + 1] - uv[a * 2 + 1]) * t)
      distance[k] = 0
      cuts.set(key, k)
    }
    return k
  }

  const kept = [], edges = []
  // a triangle (wound outwards) less what lies in a hole; the cut it makes, and which side the hole is
  const clip = (/** @type {number[]} */ tri) => {
    const inside = tri.map((k) => distance[k] < 0)
    const count = inside.filter(Boolean).length
    if (count === 0) return kept.push(...tri)
    if (count === 3) return
    // turn it so the odd one out comes first
    const odd = count === 1 ? inside.indexOf(true) : inside.indexOf(false)
    const [x, y, z] = [tri[odd], tri[(odd + 1) % 3], tri[(odd + 2) % 3]]
    const p = cut(x, y), q = cut(z, x)
    if (count === 1) {
      kept.push(p, y, z, p, z, q)
      edges.push([p, q, x])
    } else {
      kept.push(x, p, q)
      edges.push([p, q, y])
    }
  }
  for (let j = 0; j < DOWN; j++) {
    for (let i = 0; i < AROUND; i++) {
      const a = j * (AROUND + 1) + i, b = a + 1, d = a + AROUND + 1, c = d + 1
      clip([a, c, b])
      clip([a, d, c])
    }
  }

  // the skin, outside
  const skin = new Geometry({ positions: outer, normals: normal, uvs: uv, colors: colour, indices: kept })

  // the flesh: the inside of the wall, wound the other way, then the cut edges round each hole -
  // a thin band of skin, then pale flesh
  const positions = [...inner], normals = normal.map((n) => -n), colours = [], indices = []
  for (let k = 0; k < distance.length; k++) colours.push(...fleshColour(uv[k * 2], uv[k * 2 + 1]))
  for (let t = 0; t < kept.length; t += 3) indices.push(kept[t], kept[t + 2], kept[t + 1])
  const at = (/** @type {number[]} */ list, /** @type {number} */ k) => [list[k * 3], list[k * 3 + 1], list[k * 3 + 2]]
  const mix = (/** @type {number[]} */ a, /** @type {number[]} */ b, /** @type {number} */ t) => a.map((x, i) => x + (b[i] - x) * t)
  for (const [p, q, hole] of edges) {
    const po = at(outer, p), qo = at(outer, q), pi = at(inner, p), qi = at(inner, q)
    // the edge faces into the hole
    const along = [qo[0] - po[0], qo[1] - po[1], qo[2] - po[2]], down = [pi[0] - po[0], pi[1] - po[1], pi[2] - po[2]]
    let n = [along[1] * down[2] - along[2] * down[1], along[2] * down[0] - along[0] * down[2], along[0] * down[1] - along[1] * down[0]]
    const toHole = [outer[hole * 3] - po[0], outer[hole * 3 + 1] - po[1], outer[hole * 3 + 2] - po[2]]
    const flip = n[0] * toHole[0] + n[1] * toHole[1] + n[2] * toHole[2] < 0
    const len = Math.hypot(n[0], n[1], n[2]) || 1
    n = n.map((x) => (flip ? -x : x) / len)
    const band = (/** @type {number} */ from, /** @type {number} */ to, /** @type {number[]} */ rgb) => {
      const start = positions.length / 3
      positions.push(...mix(po, pi, from), ...mix(qo, qi, from), ...mix(qo, qi, to), ...mix(po, pi, to))
      for (let i = 0; i < 4; i++) normals.push(...n), colours.push(...rgb)
      if (flip) indices.push(start, start + 2, start + 1, start, start + 3, start + 2)
      else indices.push(start, start + 1, start + 2, start, start + 2, start + 3)
    }
    band(0, 0.1, [0.93, 0.5, 0.1])
    band(0.1, 1, [0.98, 0.84, 0.5])
  }
  const flesh = new Geometry({ positions, normals, colors: colours, indices })
  return { skin, flesh }
}

/** The skin's colour: orange, darker down the grooves, olive and brown round the stem. @param {number} groove @param {number} v */
function skinColour(groove, v) {
  const lobe = [0.95, 0.47, 0.07], deep = [0.62, 0.25, 0.04], stem = [0.48, 0.4, 0.12]
  const g = Math.pow(groove, 1.5)
  let c = lobe.map((x, i) => x + (deep[i] - x) * g * 0.8)
  const top = Math.max(0, 1 - v / 0.12) ** 2
  c = c.map((x, i) => x + (stem[i] - x) * top)
  return c
}

/** The flesh inside: pale yellow, a little uneven. @param {number} u @param {number} v */
function fleshColour(u, v) {
  const f = 0.92 + 0.08 * Math.sin(u * 97) * Math.sin(v * 41)
  return [0.97 * f, 0.72 * f, 0.33 * f]
}

// --- the face's shapes

/** A circle as a polygon. @param {number} x @param {number} y @param {number} r */
function circle(x, y, r) {
  return Array.from({ length: 32 }, (_, i) => [x + r * Math.cos(i / 32 * Math.PI * 2), y + r * Math.sin(i / 32 * Math.PI * 2)])
}

/**
 * The classic grin: a wide crescent with square teeth - those left of the middle hang from the top,
 * the rest stand up from the bottom.
 * @param {{ width: number, top: number, bottom: number, teeth: number[][] }} o teeth: [from x, to x, tip y]
 */
function grin({ width, top, bottom, teeth }) {
  const upper = (/** @type {number} */ x) => top + (-0.018 - top) * (x / width) ** 2
  const lower = (/** @type {number} */ x) => bottom + (-0.018 - bottom) * (x / width) ** 2
  const hanging = teeth.filter(([a, b]) => a + b < 0), standing = teeth.filter(([a, b]) => a + b >= 0)
  /** Along one edge, stepping round each tooth. @param {(x: number) => number} curve @param {number[][]} list @param {boolean} rightwards */
  const edge = (curve, list, rightwards) => {
    const xs = Array.from({ length: 25 }, (_, i) => -width + (2 * width * i) / 24)
      .filter((x) => !list.some(([a, b]) => x >= a && x <= b))
      .concat(list.flatMap(([a, b]) => [a, b]))
      .sort((a, b) => (rightwards ? a - b : b - a))
    const points = []
    for (const x of xs) {
      const tooth = list.find(([a, b]) => x === a || x === b)
      if (!tooth) points.push([x, curve(x)])
      else if ((x === tooth[0]) === rightwards) points.push([x, curve(x)], [x, tooth[2]])
      else points.push([x, tooth[2]], [x, curve(x)])
    }
    return points
  }
  // the bottom edge leaves out the corners the top edge already has
  return [...edge(upper, hanging, true), ...edge(lower, standing, false).filter(([x]) => Math.abs(x) < width)]
}

/**
 * A scary mouth: a wide crescent edged with fangs, top and bottom.
 * @param {{ width: number, top: number, bottom: number, fang: number, count: number }} o
 */
function fangs({ width, top, bottom, fang, count }) {
  const upper = (/** @type {number} */ x) => top + (-0.012 - top) * (x / width) ** 2
  const lower = (/** @type {number} */ x) => bottom + (-0.012 - bottom) * (x / width) ** 2
  const points = [[-width, upper(-width)]]
  const step = (2 * width) / count
  for (let i = 0; i < count; i++) {
    const x0 = -width + i * step, xm = x0 + step / 2, x1 = x0 + step
    // fangs shrink towards the corners
    const size = fang * (1 - 0.6 * Math.abs(xm / width))
    points.push([xm, upper(xm) - size], [x1, upper(x1)])
  }
  for (let i = count - 1; i >= 0; i--) {
    const x1 = -width + (i + 1) * step, xm = x1 - step / 2
    const size = fang * 0.8 * (1 - 0.6 * Math.abs(xm / width))
    if (i < count - 1) points.push([x1, lower(x1)])
    points.push([xm, lower(xm) + size])
  }
  return points
}

/**
 * A smile: a slim crescent, curling up at the ends.
 * @param {{ top: number, bottom: number, curve: number, width: number }} o
 */
function smile({ top, bottom, curve, width }) {
  const upper = (/** @type {number} */ x) => top + curve * x * x
  const lower = (/** @type {number} */ x) => bottom + (curve + (top - bottom) / (width * width)) * x * x
  const points = []
  for (let i = 0; i <= 24; i++) {
    const x = -width + (2 * width * i) / 24
    points.push([x, upper(x)])
  }
  for (let i = 23; i >= 1; i--) {
    const x = -width + (2 * width * i) / 24
    points.push([x, lower(x)])
  }
  return points
}

/**
 * How far a point is from a polygon's edge: negative inside, positive outside.
 * @param {number} x @param {number} y @param {number[][]} poly
 */
function polygonDistance(x, y, poly) {
  let d = Infinity, inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j], [bx, by] = poly[i]
    const ex = bx - ax, ey = by - ay, wx = x - ax, wy = y - ay
    const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)))
    d = Math.min(d, Math.hypot(wx - ex * t, wy - ey * t))
    if ((ay > y) !== (by > y) && x < ax + (ex * (y - ay)) / ey) inside = !inside
  }
  return inside ? -d : d
}

// --- the stem and the skin's texture

/** A stem: five-ridged, tapering and bent over, flared where it meets the pumpkin. */
function stem() {
  const RINGS = 14, SIDES = 40
  const base = outside(0.5, 0).y
  const spine = (/** @type {number} */ t) => [0.016 * t * t, base - 0.01 + 0.075 * t, -0.008 * t * t]
  const positions = [], indices = []
  for (let j = 0; j <= RINGS; j++) {
    const t = j / RINGS
    // up and over to one side, twisting a little
    const [cx, cy, cz] = spine(t)
    const radius = 0.0125 * (1 - 0.3 * t) + 0.013 * Math.max(0, 1 - t / 0.2) ** 2
    for (let i = 0; i <= SIDES; i++) {
      const a = (i / SIDES) * Math.PI * 2 + t * 0.6
      const ridge = 1 + 0.16 * Math.abs(Math.cos(a * 2.5))
      positions.push(cx + Math.cos(a) * radius * ridge, cy, cz + Math.sin(a) * radius * ridge)
    }
  }
  for (let j = 0; j < RINGS; j++) {
    for (let i = 0; i < SIDES; i++) {
      const a = j * (SIDES + 1) + i, b = a + 1, c = a + SIDES + 1, d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }
  // a cut end on top
  const top = positions.length / 3, last = RINGS * (SIDES + 1)
  positions.push(...spine(1))
  for (let i = 0; i < SIDES; i++) indices.push(top, last + i + 1, last + i)
  return new Mesh({ geometry: new Geometry({ positions, indices }), material: { color: '#94844c', roughness: 0.85, bumpMap: streaks(), bumpScale: 0.0004 }, castShadow: true, receiveShadow: true })
}

/** The skin's fine relief: streaks down the pumpkin and a few speckles, as heights for a bump map. */
function streaks() {
  const SIZE = 256
  let seed = 11
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  // value noise that wraps, stretched along v so it runs down the pumpkin in streaks
  const noise = (/** @type {number} */ cu, /** @type {number} */ cv) => {
    const g = Array.from({ length: cu * cv }, rand)
    return (/** @type {number} */ x, /** @type {number} */ y) => {
      const fx = (x / SIZE) * cu, fy = (y / SIZE) * cv, x0 = Math.floor(fx), y0 = Math.floor(fy)
      const tx = fx - x0, ty = fy - y0, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty)
      const at = (/** @type {number} */ i, /** @type {number} */ j) => g[(j % cv) * cu + (i % cu)]
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx
      return a + (b - a) * sy
    }
  }
  // soft lumps, then streaks, faint and fine
  const layers = [[noise(8, 4), 0.45], [noise(24, 3), 0.3], [noise(64, 6), 0.15], [noise(128, 16), 0.1]]
  const speckle = noise(64, 64)
  const data = new Uint8Array(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let h = 0
      for (const [n, w] of /** @type {[(x: number, y: number) => number, number][]} */ (layers)) h += n(x, y) * w
      h -= Math.max(0, speckle(x, y) - 0.8) * 1.5
      data.set([Math.max(0, Math.min(255, h * 255)), 0, 0, 255], (y * SIZE + x) * 4)
    }
  }
  return new Texture({ image: { data, width: SIZE, height: SIZE }, colorSpace: 'linear', repeat: [12, 3] })
}
