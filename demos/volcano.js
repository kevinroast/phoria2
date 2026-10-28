import { Box3, DirectionalLight, Geometry, Group, HemisphereLight, InstancedMesh, Label, Mesh, PointLight, Points, Texture, View, cylinder, icosphere } from 'phoria2'
import { Emitter } from 'phoria2/particles'
import { Timeline } from 'phoria2/motion'
import { random } from './kit.js'

// A volcano erupting, as the cut-away diagram in a geography book: a block of land with its front
// quarter taken out, so the inside shows on two cut faces - the magma chamber, the vent rising to
// the crater, the sill and laccolith pushed in between the rock layers. Sea on one side, forest on
// the other. A Timeline runs the eruption; the labels are callouts, set off to the sides with
// leader lines to what they name. The glow is the view's bloom.

const B = 6 // the block runs from -B to B in x and z
const DEPTH = 3.6 // and down to -DEPTH
const PEAK = 4.6, BASE = 5.4 // the cone: its height and the radius of its foot
const RIM = 0.55, CRATER = 0.4 // the crater's radius and depth
const WATER = -0.12
const PARASITE = [0, 2.3] // a small cone on the slope, sitting on the cut so its pipe shows: [x, z]
const TOP = PEAK + 0.3 // the top of the cut faces' pictures

/** Progress through part of a step: 0 before a, 1 after b. */
const part = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)))
/** Eased 0 - 1. */
const smooth = (t) => t * t * (3 - 2 * t)
const lerp = (a, b, t) => a + (b - a) * t
const ramp = (a, b, x) => smooth(part(x, a, b))

// --- the land: one height for every point, which the surface, the cut faces and the flows share

/** The cone, with gullies running down it, and the crater at its top. @param {number} r @param {number} angle */
function cone(r, angle) {
  if (r >= BASE) return 0
  const rim = PEAK * (1 - RIM / BASE) ** 1.6
  if (r < RIM) return rim - CRATER * (1 - (r / RIM) ** 2)
  const gullies = 0.1 * Math.sin(angle * 11 + Math.sin(r * 1.3) * 2) * Math.sin(Math.PI * r / BASE)
  return PEAK * (1 - r / BASE) ** 1.6 + gullies
}

/** How much a direction is sea (the left wing, round to the back-left), 0 - 1. @param {number} angle degrees, atan2(z, x) */
const seaward = (angle) => {
  const a = (angle + 360) % 360
  return a >= 80 && a <= 190 ? 1 : a > 190 && a < 225 ? 1 - (a - 190) / 35 : 0
}
/** How much a direction is forest (the right wing, round to the back-right), 0 - 1. */
const forestward = (angle) => {
  const a = (angle + 360) % 360
  return a >= 270 ? 1 : a > 230 && a < 270 ? (a - 230) / 40 : 0
}

/** Height of the land at (x, z). */
function height(x, z) {
  const r = Math.hypot(x, z), angle = Math.atan2(z, x)
  const deg = angle * 180 / Math.PI
  // the sea floor falls away from the shore; the land elsewhere rolls a little
  const sea = lerp(0.1, -0.9, ramp(4.4, 6.4, r))
  const land = 0.12 + 0.06 * Math.sin(x * 1.7) * Math.cos(z * 1.3)
  const ground = lerp(land, sea, seaward(deg)) * ramp(3.4, 5.2, r)
  // the parasitic cone, with a dimple of a crater
  const p = Math.hypot(x - PARASITE[0], z - PARASITE[1])
  const parasite = 0.5 * Math.exp(-p * p / 0.18) - 0.12 * Math.exp(-p * p / 0.01)
  return cone(r, angle) + ground + parasite
}

/** Colour of the land's surface at (x, z, height), as [r, g, b] 0 - 1. */
function surfaceColor(x, z, h, rand) {
  const r = Math.hypot(x, z), deg = Math.atan2(z, x) * 180 / Math.PI
  const shade = 0.92 + rand() * 0.12
  if (r < RIM * 1.05) return [0.24 * shade, 0.13, 0.11] // the crater's floor, scorched
  if (h < WATER - 0.02) return [0.33, 0.47, 0.5] // sea floor, under the water
  if (h < WATER + 0.14 && seaward(deg) > 0.5) return [0.86 * shade, 0.76 * shade, 0.54 * shade] // the beach
  const rock = cone(r, Math.atan2(z, x))
  if (rock > 0.35) {
    // grey ash and rock, darker in the gullies and toward the top
    const g = 0.36 + 0.06 * Math.sin(Math.atan2(z, x) * 11 + Math.sin(r * 1.3) * 2) - rock * 0.02
    return [g * shade, (g + 0.02) * shade, (g + 0.07) * shade]
  }
  if (forestward(deg) > 0.5) return [0.16 * shade, 0.38 * shade, 0.17 * shade]
  return [0.37 * shade, 0.5 * shade, 0.25 * shade]
}

/** Is (x, z) part of the block - not in the front quarter that's cut away? */
const inBlock = (x, z) => !(x > 1e-6 && z > 1e-6)

/** The land's top surface: a grid over the block, its front quarter left out. */
function surface() {
  const n = 120, step = (2 * B) / n
  const rand = random(4)
  /** @type {number[]} */ const positions = []
  /** @type {number[]} */ const colors = []
  /** @type {number[]} */ const indices = []
  /** @type {Map<number, number>} */ const index = new Map()
  const vertex = (i, j) => {
    const key = i * (n + 1) + j
    let v = index.get(key)
    if (v === undefined) {
      const x = -B + i * step, z = -B + j * step
      const h = height(x, z)
      positions.push(x, h, z)
      colors.push(...surfaceColor(x, z, h, rand))
      v = index.size
      index.set(key, v)
    }
    return v
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      // a cell is in when its centre is
      if (!inBlock(-B + (i + 0.5) * step, -B + (j + 0.5) * step)) continue
      const a = vertex(i, j), b = vertex(i + 1, j), c = vertex(i + 1, j + 1), d = vertex(i, j + 1)
      indices.push(a, d, c, a, c, b)
    }
  }
  const geometry = new Geometry({ positions, colors, indices })
  return geometry.computeNormals()
}

// --- the cut faces: pictures of the rock inside, painted from the same heights

/** The top of a face at a point: the land, or the sea's surface over it. */
const faceTop = (x, z) => Math.max(height(x, z), seaward(Math.atan2(z, x) * 180 / Math.PI) > 0.5 ? WATER : -Infinity)

/**
 * Paint the inside of the ground along a line, s from 0 to its length: ash layers in the cone, soil,
 * then rock strata, red-hot rock and molten orange at the bottom.
 * @param {(s: number) => [number, number]} at the point s along
 * @param {number} length
 */
function rockFace(at, length, seed) {
  const W = 768, H = 512
  const canvas = document.createElement('canvas'), glow = document.createElement('canvas')
  canvas.width = glow.width = W
  canvas.height = glow.height = H
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'))
  const gctx = /** @type {CanvasRenderingContext2D} */ (glow.getContext('2d'))
  const image = ctx.createImageData(W, H), lit = gctx.createImageData(W, H)
  const toY = (py) => TOP - (py + 0.5) / H * (TOP + DEPTH)
  const put = (data, i, [r, g, b]) => {
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    data[i + 3] = 255
  }
  for (let px = 0; px < W; px++) {
    const s = (px + 0.5) / W * length
    const [x, z] = at(s)
    const ground = height(x, z), top = faceTop(x, z)
    const r = Math.hypot(x, z), coneHere = cone(r, Math.atan2(z, x)) > 0.05
    const sea = seaward(Math.atan2(z, x) * 180 / Math.PI) > 0.5
    const wave = 0.12 * Math.sin(s * 0.9 + seed) + 0.05 * Math.sin(s * 2.3 + seed * 2)
    for (let py = 0; py < H; py++) {
      const y = toY(py), i = (py * W + px) * 4
      if (y > top + 0.02) continue
      let c
      let hot = null
      const d = ground - y
      if (y > ground) {
        // the sea, deeper blue further down
        const k = (top - y) / 1.2
        c = [lerp(40, 14, k), lerp(130, 70, k), lerp(200, 140, k)]
      } else if (d < 0.05) {
        c = coneHere && y > 0.3 ? [120, 126, 140] : sea ? [214, 190, 140] : [74, 140, 70]
      } else if (coneHere && y > 0.05) {
        // layers of ash and lava, following the slope
        const band = Math.floor(d / 0.32) % 3
        c = [[78, 84, 98], [96, 102, 116], [62, 67, 80]][band]
        if (d % 0.32 < 0.025) c = [44, 48, 58]
      } else if (d < 0.32) {
        c = sea ? [190, 160, 112] : [105, 72, 44]
      } else if (y > -0.9 + wave) {
        c = [58, 74, 96]
      } else if (y > -1.6 + wave) {
        c = [42, 52, 70]
      } else if (y > -2.2 + wave) {
        c = [72, 82, 100]
      } else if (y > -2.75 + wave) {
        c = [120, 58, 38]
      } else if (y > -3.15 + wave) {
        c = [196, 70, 30]
        hot = [120, 30, 6]
      } else {
        c = [240, 136, 34]
        hot = [255, 120, 20]
      }
      // a thin dark line between the strata
      for (const edge of [-0.9, -1.6, -2.2, -2.75, -3.15]) {
        if (Math.abs(y - (edge + wave)) < 0.012 && d > 0.32) c = [28, 32, 42]
      }
      put(image.data, i, c)
      put(lit.data, i, hot ?? [0, 0, 0])
    }
  }
  ctx.putImageData(image, 0, 0)
  gctx.putImageData(lit, 0, 0)
  return { map: new Texture({ image: canvas, wrap: 'clamp' }), glow: new Texture({ image: glow, wrap: 'clamp' }) }
}

/**
 * One vertical face of the block, from a to b along the ground, from the bottom up to the land (or
 * the sea) - painted with the rock inside.
 * @param {[number, number]} a @param {[number, number]} b @param {number} seed
 */
function face(a, b, seed) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1])
  const at = (s) => /** @type {[number, number]} */ ([lerp(a[0], b[0], s / length), lerp(a[1], b[1], s / length)])
  const n = 140
  /** @type {number[]} */ const positions = [], uvs = [], normals = [], indices = []
  const nx = (b[1] - a[1]) / length, nz = -(b[0] - a[0]) / length
  for (let i = 0; i <= n; i++) {
    const s = i / n * length
    const [x, z] = at(s)
    const top = faceTop(x, z)
    positions.push(x, -DEPTH, z, x, top, z)
    uvs.push(i / n, 1, i / n, (TOP - top) / (TOP + DEPTH))
    normals.push(nx, 0, nz, nx, 0, nz)
    if (i < n) {
      const k = i * 2
      indices.push(k, k + 2, k + 3, k, k + 3, k + 1)
    }
  }
  const { map, glow } = rockFace(at, length, seed)
  return new Mesh({
    geometry: new Geometry({ positions, uvs, normals, indices }), pickable: false,
    material: { map, emissive: '#ffffff', emissiveMap: glow, unlit: true, doubleSided: true },
  })
}

// --- magma: ribbons that fill from one end, so it can rise and flow

/** Glowing lava: bands of yellow, orange and red that scroll along the ribbons. */
function lavaTexture() {
  const rand = random(21)
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 32
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'))
  for (let x = 0; x < 256; x += 4) {
    const k = rand()
    ctx.fillStyle = k > 0.75 ? '#ffe27a' : k > 0.4 ? '#ffa02a' : k > 0.15 ? '#ff6a18' : '#d8320c'
    ctx.fillRect(x, 0, 4 + Math.floor(rand() * 8), 32)
  }
  return new Texture({ image: canvas, wrap: 'repeat' })
}

/** A puff of smoke or ash: soft overlapping blobs, lit from above, fading out at the edges. */
function puffSprite() {
  const rand = random(13)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'))
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2, d = i ? 14 + rand() * 18 : 0, r = 26 + rand() * 14
    const x = 64 + Math.cos(a) * d, y = 66 + Math.sin(a) * d * 0.8
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, 'rgba(255, 255, 255, 0.55)')
    g.addColorStop(0.6, 'rgba(255, 255, 255, 0.3)')
    g.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  // shade the underside, as if lit from above
  ctx.globalCompositeOperation = 'source-atop'
  const shade = ctx.createLinearGradient(0, 30, 0, 110)
  shade.addColorStop(0, 'rgba(255, 255, 255, 0)')
  shade.addColorStop(1, 'rgba(90, 90, 100, 0.55)')
  ctx.fillStyle = shade
  ctx.fillRect(0, 0, 128, 128)
  return new Texture({ image: canvas, wrap: 'clamp' })
}

/** The magma chamber: molten rock, white-hot in the middle, cooler red toward its edge. */
function chamberTexture() {
  const rand = random(23)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'))
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
  g.addColorStop(0, '#fff2b0')
  g.addColorStop(0.35, '#ffb02a')
  g.addColorStop(0.75, '#ff5a14')
  g.addColorStop(1, '#b8260a')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256, 256)
  // blobs of brighter melt
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(255, 220, 120, ${0.12 + rand() * 0.2})`
    ctx.beginPath()
    ctx.arc(rand() * 256, rand() * 256, 4 + rand() * 14, 0, Math.PI * 2)
    ctx.fill()
  }
  return new Texture({ image: canvas, wrap: 'clamp' })
}

/**
 * A ribbon along a line of points, `width` across (a number or one per point), made of pairs so
 * that drawCount fills it from the first point. In 2D on a face (x along, y up), or draped in 3D.
 * @param {number[][]} line points [x, y] or [x, y, z]
 * @param {number | number[]} width
 * @param {(i: number) => [number, number, number]} [across] the direction across, per point (3D)
 */
function ribbon(line, width, across) {
  /** @type {number[]} */ const positions = [], uvs = [], indices = []
  let u = 0
  line.forEach((p, i) => {
    if (i) u += Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1], (p[2] ?? 0) - (line[i - 1][2] ?? 0))
    const w = (Array.isArray(width) ? width[i] : width) / 2
    let side
    if (across) side = across(i)
    else {
      // perpendicular in the face's plane
      const q = line[Math.min(i + 1, line.length - 1)], o = line[Math.max(i - 1, 0)]
      const dx = q[0] - o[0], dy = q[1] - o[1], l = Math.hypot(dx, dy) || 1
      side = [-dy / l, dx / l, 0]
    }
    const z = p[2] ?? 0
    positions.push(p[0] - side[0] * w, p[1] - side[1] * w, z - side[2] * w, p[0] + side[0] * w, p[1] + side[1] * w, z + side[2] * w)
    uvs.push(u / 1.4, 0, u / 1.4, 1)
    if (i < line.length - 1) {
      const k = i * 2
      indices.push(k, k + 1, k + 3, k, k + 3, k + 2)
    }
  })
  return new Geometry({ positions, uvs, indices })
}

/** Show the first t (0 - 1) of a ribbon. @param {Mesh} mesh @param {number} t */
function fill(mesh, t) {
  const pieces = mesh.geometry.positions.length / 6 - 1
  mesh.geometry.drawCount = Math.round(Math.min(1, Math.max(0, t)) * pieces) * 6
  mesh.visible = mesh.geometry.drawCount > 0
}

/** Points along a smooth path through a few [x, y] points, n per stretch. */
function through(points, n = 12) {
  const out = []
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(i + 2, points.length - 1)]
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t
      out.push([0, 1].map((c) => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3)))
    }
  }
  out.push(points[points.length - 1])
  return out
}

export default function run({ canvas, gui, info }) {
  const view = new View({
    canvas, orbit: true, background: '#0d1b2e', camera: 'isometric',
    bloom: { strength: 0.9, radius: 0.65, threshold: 0.62 },
  })
  const { scene } = view
  scene.add(new HemisphereLight({ sky: '#d6e6ff', ground: '#3a2c24', intensity: 0.9 }))
  scene.add(new DirectionalLight({ direction: [-0.45, -0.85, -0.3], intensity: 1.5 }))
  // the crater lights the cone and the cloud from below while it erupts
  const fireLight = scene.add(new PointLight({ color: '#ff7a2a', intensity: 0, range: 9 }))
  const rimHeight = cone(RIM, 0)
  fireLight.position.set(0, rimHeight + 0.6, 0)

  // --- the land, its cut faces, and the sea
  scene.add(new Mesh({ geometry: surface(), material: { vertexColors: true, roughness: 0.9 }, pickable: false }))
  const faces = [
    face([0, 0], [0, B], 1), face([B, 0], [0, 0], 2), // the two cut faces, meeting at the vent
    face([0, B], [-B, B], 3), face([B, -B], [B, 0], 4), // the block's front edges
    face([-B, B], [-B, -B], 5), face([-B, -B], [B, -B], 6), // and its back
  ]
  for (const f of faces) scene.add(f)
  // the sea, over the left wing and round to the back
  const sea = []
  const seaStep = B / 30
  for (let i = 0; i < 60; i++) {
    for (let j = 0; j < 60; j++) {
      const x0 = -B + i * seaStep, z0 = -B + j * seaStep, x1 = x0 + seaStep, z1 = z0 + seaStep
      if (!inBlock((x0 + x1) / 2, (z0 + z1) / 2) || seaward(Math.atan2((z0 + z1) / 2, (x0 + x1) / 2) * 180 / Math.PI) < 0.5) continue
      if (Math.min(height(x0, z0), height(x1, z0), height(x0, z1), height(x1, z1)) > WATER + 0.05) continue
      sea.push(x0, WATER, z0, x0, WATER, z1, x1, WATER, z1, x0, WATER, z0, x1, WATER, z1, x1, WATER, z0)
    }
  }
  scene.add(new Mesh({
    geometry: new Geometry({ positions: sea }).computeNormals(), pickable: false,
    material: { color: '#2a86d8', opacity: 0.82, roughness: 0.15, metalness: 0.1 },
  }))

  // the forest: dark cones over the right wing
  const rand = random(9)
  const trees = []
  for (let x = 0.2; x < B - 0.2; x += 0.4) {
    for (let z = -B + 0.2; z < -0.2; z += 0.4) {
      const tx = x + (rand() - 0.5) * 0.3, tz = z + (rand() - 0.5) * 0.3
      const r = Math.hypot(tx, tz)
      if (r < BASE * 0.9 || forestward(Math.atan2(tz, tx) * 180 / Math.PI) < 0.6) continue
      const s = 0.75 + rand() * 0.6, g = 0.25 + rand() * 0.2
      trees.push({ position: [tx, height(tx, tz) + 0.3 * s, tz], scale: s, color: [0.12, g, 0.14] })
    }
  }
  scene.add(new InstancedMesh({
    geometry: cylinder({ radius: 0.2, radiusTop: 0, height: 0.6, segments: 7 }), instances: trees, pickable: false,
    material: { color: '#ffffff', roughness: 0.8, flatShading: true },
  }))

  // --- magma, on the two cut faces: each face's own space has x along it from the vent, y up
  const sides = {
    sea: scene.add(new Group({ rotation: [0, -Math.PI / 2, 0] })), // x along +z; its front is -z
    land: scene.add(new Group()), // x along +x; its front is +z
  }
  const FRONT = { sea: -0.015, land: 0.015 }
  const lava = lavaTexture()
  /** A lava material: always glowing a little; heat makes it bright. */
  const molten = () => ({ color: '#ff6a1a', map: lava, emissive: '#ffffff', emissiveMap: lava, emissiveIntensity: 0.4, roughness: 0.6, doubleSided: true })
  const chamberY = -2.55
  /** A ribbon on a face, with a dimmer cooled copy under it that's always there. */
  const magma = (side, line, width, layer = 0) => {
    const geometry = ribbon(line, width)
    const z = FRONT[side] * (1 + layer)
    const cold = sides[side].add(new Mesh({ geometry, position: [0, 0, z * 0.5], pickable: false, material: { ...molten(), emissiveIntensity: 0.25, color: '#a8381a' } }))
    const hot = sides[side].add(new Mesh({ geometry: ribbon(line, width), position: [0, 0, z], pickable: false, material: molten() }))
    return { cold, hot }
  }
  // the vent is a column on both faces, from the chamber to the crater - half of it on each, from the
  // corner where they meet
  const ventHeights = through([[0, chamberY + 0.4], [0, -0.6], [0, 1.6], [0, rimHeight - CRATER + 0.02]], 16).map(([, y]) => y)
  const ventWidth = ventHeights.map((y) => 0.2 + 0.1 * ramp(rimHeight - 1.2, rimHeight, y) + 0.12 * ramp(chamberY + 0.8, chamberY, y))
  const vent = ['sea', 'land'].map((side) => magma(side, ventHeights.map((y, i) => [ventWidth[i] / 2, y]), ventWidth, 1))
  // the chamber: half an ellipse on each face, round the foot of the vent
  const melt = chamberTexture()
  /** @type {Mesh[]} */
  const chamber = ['sea', 'land'].map((side) => {
    const positions = [0, 0, 0], uvs = [0.5, 0.5], indices = []
    for (let k = 0; k <= 24; k++) {
      const a = -Math.PI / 2 + k / 24 * Math.PI
      positions.push(Math.cos(a) * 1.6, Math.sin(a) * 0.72, 0)
      uvs.push(0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5)
      if (k) indices.push(0, k, k + 1)
    }
    return sides[side].add(new Mesh({ geometry: new Geometry({ positions, uvs, indices }), position: [0, chamberY, FRONT[side] * 1.5], pickable: false, material: { ...molten(), map: melt, emissiveMap: melt, emissiveIntensity: 0.6 } }))
  })
  // the sill pushes out sideways between strata on the sea face; a pipe climbs to the parasitic cone
  const sill = magma('sea', through([[0.15, -1.25], [1.6, -1.32], [3.0, -1.2], [4.3, -1.3]]), [0.17, 0.2, 0.18, 0.14].flatMap((w) => Array(12).fill(w)).concat(0.08))
  const parasiteTop = height(PARASITE[0], PARASITE[1]) - 0.1
  const pipe = magma('sea', through([[0.15, 0.4], [0.9, 0.9], [1.7, parasiteTop - 0.6], [PARASITE[1], parasiteTop]]), 0.11)
  const dikes = [
    magma('sea', through([[0.7, chamberY + 0.5], [1.4, -1.9], [1.9, -1.6]], 8), 0.08),
    magma('land', through([[0.8, chamberY + 0.45], [1.5, -1.95], [2.3, -1.25]], 8), 0.08),
  ]
  // the laccolith: magma that domed the strata up over it, on the land face, fed from the chamber
  const feeder = magma('land', through([[1.2, chamberY + 0.5], [2.1, -1.8], [2.7, -1.1]], 10), 0.1)
  const domeLine = [], domeWidth = []
  for (let k = 0; k <= 30; k++) {
    const s = 2.3 + k / 30 * 2.4, bulge = Math.sin(Math.PI * k / 30)
    domeLine.push([s, -1.05 + bulge * 0.28])
    domeWidth.push(0.06 + bulge * 0.52)
  }
  const laccolith = magma('land', domeLine, domeWidth)

  // --- lava flows: ribbons draped down the slopes from the rim
  const flowAngles = [128, 156, -38, -66, 205]
  const flows = flowAngles.map((deg, k) => {
    const line = [], across = []
    const a0 = deg * Math.PI / 180
    for (let r = RIM * 0.95; r < BASE * (0.86 + 0.05 * Math.sin(k * 2)); r += 0.06) {
      const a = a0 + 0.1 * Math.sin(r * 1.6 + k) + 0.04 * Math.sin(r * 4 + k * 3)
      const x = Math.cos(a) * r, z = Math.sin(a) * r
      line.push([x, height(x, z) + 0.045, z])
      across.push([-Math.sin(a), 0, Math.cos(a)])
    }
    const width = line.map((_, i) => 0.3 * (1 - 0.45 * i / line.length) + 0.06 * Math.sin(i * 0.7 + k))
    return scene.add(new Mesh({ geometry: ribbon(line, width, (i) => across[i]), pickable: false, material: { ...molten(), transparent: true } }))
  })

  // --- the eruption: a fountain of sparks, bombs flung out, and the ash cloud
  const fountain = scene.add(new Emitter({
    position: [0, rimHeight - 0.15, 0], rate: 0, max: 3000, velocity: [0, 6.2, 0], velocitySpread: [1.7, 1.6, 1.7], originSpread: 0.25,
    gravity: [0, -9.8, 0], lifetime: [0.7, 1.3], color: ['#fff3b0', '#ffb030', '#ff4a10', '#300800'], material: { size: 0.14 },
  }))
  const littleFountain = scene.add(new Emitter({
    position: [PARASITE[0] - 0.05, height(PARASITE[0], PARASITE[1]), PARASITE[1]], rate: 0, max: 400, velocity: [0, 2.6, 0], velocitySpread: [0.6, 0.6, 0.6],
    gravity: [0, -9.8, 0], lifetime: [0.4, 0.7], color: ['#fff3b0', '#ff7020', '#200500'], material: { size: 0.09 },
  }))
  const bombRand = random(31)
  const bombs = Array.from({ length: 7 }, (_, i) => {
    const a = (i / 7) * Math.PI * 2 + 0.4, speed = 2.2 + bombRand() * 1.4
    const node = scene.add(new Mesh({ geometry: icosphere({ radius: 0.13, detail: 1 }), pickable: false, material: { color: '#3a1d14', emissive: '#ff5a1a', emissiveIntensity: 1.6, flatShading: true } }))
    const trail = scene.add(new Emitter({ follow: node, rate: 0, max: 200, velocitySpread: 0.25, lifetime: [0.3, 0.6], color: ['#ffb060', '#802000', '#000'], material: { size: 0.09 } }))
    return { node, trail, launch: 0.15 + i * 0.09 + bombRand() * 0.05, velocity: [Math.cos(a) * speed, 6 + bombRand() * 2, Math.sin(a) * speed] }
  })
  /** A bomb's flight, `age` seconds after launch: where it is, and whether it has come down. */
  const flight = (bomb, age) => {
    const [vx, vy, vz] = bomb.velocity
    let t = Math.max(0, age)
    const at = (t) => [vx * t, rimHeight + vy * t - 4.9 * t * t, vz * t]
    // stop where it meets the ground
    let p = at(t)
    if (t > 0.3 && p[1] < height(p[0], p[2])) {
      let lo = 0.3, hi = t
      for (let k = 0; k < 18; k++) {
        const mid = (lo + hi) / 2, q = at(mid)
        if (q[1] < height(q[0], q[2])) hi = mid
        else lo = mid
      }
      t = lo
      p = at(t)
      return { p, landed: true }
    }
    return { p, landed: false }
  }
  // the ash cloud: a plume of soft puffs, each a sprite of its own (so each has its own size and
  // fade), born at the crater while it erupts, rising and spreading into a cap and leaning with the
  // wind. They're timed by the eruption's own clock, so seeking the story puts them right
  const sprite = puffSprite()
  const PUFFS = 80, PUFF_LIFE = 6.5, ERUPTION_ENDS = 13
  const puffRand = random(44)
  /** @param {string | number[]} color @param {number} size */
  const puffNode = (color, size) => scene.add(new Points({
    geometry: new Geometry({ positions: [0, 0, 0] }), pickable: false, frustumCulled: false,
    material: { map: sprite, color, size, transparent: true, depthWrite: false },
  }))
  const puffs = Array.from({ length: PUFFS }, (_, i) => ({
    node: puffNode('#808080', 1), phase: i / PUFFS, angle: puffRand() * Math.PI * 2, reach: 0.5 + puffRand() * 0.5, size: 0.8 + puffRand() * 0.4,
  }))
  // wisps of steam while it sleeps
  const wisps = Array.from({ length: 5 }, (_, i) => ({ node: puffNode('#e2e6ee', 0.5), phase: i / 5 }))

  // --- callouts: names off to the sides, with leader lines to what they name
  /** @param {string} text @param {import('phoria2').Vec3Input} position @param {'left' | 'right'} edge @param {number} [dy] */
  // in a column at the view's edge, level with the point (dy nudges it up or down), the leader across
  const callout = (text, position, edge, dy = 0) => scene.add(new Label({ text, position, edge, offset: [0, dy - 9], leader: true, className: 'volcano-callout', overlap: 'dim' }))
  const C = {
    cloud: callout('Ash cloud', [0, rimHeight + 3, 0], 'left'),
    flow: callout('Lava flow', flows[0].geometry.positions.slice(60 * 3, 60 * 3 + 3), 'left', -30),
    parasite: callout('Parasitic cone', [0, parasiteTop + 0.12, PARASITE[1]], 'left', -18),
    ash: callout('Layers of ash', [0.02, 1.4, 1.2], 'left', 16),
    sill: callout('Sill', [0.02, -1.25, 3.2], 'left'),
    crater: callout('Crater', [-0.1, rimHeight - 0.1, -0.1], 'right', -10),
    vent: callout('Vent', [0.03, 1.4, 0.03], 'right'),
    laccolith: callout('Laccolith', [3.6, -0.9, 0.02], 'right'),
    chamber: scene.add(new Label({ text: 'Magma chamber', position: [0.03, chamberY, 0.03], place: 'below', offset: [0, 70], leader: true, className: 'volcano-callout', overlap: 'show' })),
  }

  // --- what the story controls, set by its steps each frame, then applied
  const START = { pressure: 0.2, rise: 0.25, heat: 0.15, branch: 0, erupt: 0, eruptTime: 0, cloud: 0, drift: 0, flows: 0, cool: 0, flowFade: 0, smoke: 1, little: 0 }
  const state = { ...START }
  const STEPS = ['Dormant - only a little steam', 'Pressure builds in the magma chamber', 'Magma rises through the vent', 'Eruption', 'Lava flows down the slopes', 'The eruption dies down and the lava cools']
  const FOCUS = [['crater'], ['chamber'], ['vent', 'sill', 'laccolith', 'parasite'], ['crater', 'cloud'], ['flow', 'parasite', 'cloud'], ['ash', 'flow']]
  const story = new Timeline({ loop: true })
  story
    .add(3, () => Object.assign(state, START), { label: STEPS[0] })
    .add(3, (t) => {
      if (t === 0) return
      state.pressure = lerp(0.2, 1, t)
      state.heat = lerp(0.15, 0.6, t)
      state.smoke = 1 - t
    }, { label: STEPS[1], ease: 'inOut' })
    .add(3.5, (t) => {
      if (t === 0) return
      state.pressure = 1
      state.smoke = 0
      state.rise = lerp(0.25, 1, ramp(0, 0.75, t))
      state.branch = ramp(0.35, 1, t)
      state.heat = lerp(0.6, 1, t)
    }, { label: STEPS[2] })
    .add(5.5, (t) => {
      if (t === 0) return
      Object.assign(state, { pressure: 1, smoke: 0, rise: 1, branch: 1, heat: 1 })
      state.erupt = ramp(0, 0.08, t)
      state.eruptTime = t * 5.5
      state.cloud = ramp(0.03, 0.9, t)
    }, { label: STEPS[3] })
    .add(5.5, (t) => {
      if (t === 0) return
      Object.assign(state, { pressure: 1, smoke: 0, rise: 1, branch: 1, heat: 1, cloud: 1, eruptTime: 5.5 + t * 5.5 })
      state.erupt = lerp(1, 0.45, t)
      state.flows = ramp(0, 0.9, t)
      state.drift = 0.35 * t
      state.little = ramp(0.1, 0.25, t) * (1 - ramp(0.75, 1, t))
    }, { label: STEPS[4] })
    .add(5, (t) => {
      if (t === 0) return
      Object.assign(state, { smoke: 0, branch: 1, cloud: 1, flows: 1, eruptTime: 11 + t * 5 })
      state.erupt = lerp(0.45, 0, ramp(0, 0.4, t))
      state.pressure = lerp(1, 0.2, t)
      state.heat = lerp(1, 0.15, ramp(0, 0.8, t))
      state.rise = lerp(1, 0.25, ramp(0.1, 0.9, t))
      state.cool = ramp(0, 0.7, t)
      state.drift = lerp(0.35, 1, t)
      state.flowFade = ramp(0.7, 1, t)
      state.smoke = ramp(0.85, 1, t)
    }, { label: STEPS[5] })

  /** Put everything where the story says. @param {number} time seconds, for flicker and flow */
  const apply = (time) => {
    // lava scrolls along every ribbon
    lava.offset[0] = -time * 0.35
    const flicker = 0.92 + 0.08 * Math.sin(time * 9) * Math.sin(time * 5.3)
    // the chamber swells and brightens with the pressure
    chamber.forEach((m) => {
      m.scale.set(0.85 + 0.25 * state.pressure, 0.85 + 0.3 * state.pressure, 1)
      m.material.emissiveIntensity = (0.4 + 1.4 * state.pressure) * flicker
    })
    for (const { hot } of vent) {
      fill(hot, state.rise)
      hot.material.emissiveIntensity = (0.5 + 1.3 * state.heat) * flicker
    }
    for (const { hot } of [sill, pipe, feeder, laccolith, ...dikes]) {
      fill(hot, state.branch)
      hot.material.emissiveIntensity = (0.4 + 1.2 * state.heat) * flicker
    }
    // flows run down, then cool to a dark crust, then fade before the next eruption
    flows.forEach((m, k) => {
      fill(m, ramp(k * 0.12, k * 0.12 + 0.7, state.flows))
      m.material.emissiveIntensity = lerp(1.5, 0.08, state.cool) * flicker
      m.material.color.set(state.cool > 0.5 ? '#3a2420' : '#ff6a1a')
      m.material.opacity = 1 - state.flowFade
    })
    fountain.rate = 900 * state.erupt
    littleFountain.rate = 140 * state.little
    fireLight.intensity = 6 * state.erupt * flicker + 1.2 * state.heat
    // bombs, flung out early in the eruption, glowing as they cool where they land
    bombs.forEach((bomb) => {
      const age = state.eruptTime - bomb.launch * 5.5
      const { p, landed } = flight(bomb, age)
      bomb.node.position.set(p[0], p[1] + (landed ? 0.06 : 0), p[2])
      bomb.node.visible = age > 0 && state.flowFade < 1
      bomb.node.material.emissiveIntensity = landed ? lerp(1.2, 0.05, state.cool) : 1.8
      bomb.node.scale.setScalar(1 - state.flowFade)
      bomb.trail.rate = age > 0 && !landed ? 80 : 0
    })
    // the plume: each puff's age through its life, and when it was born on the eruption's clock -
    // only those born while it was erupting show, so once it stops the plume lifts away and thins
    const clock = state.eruptTime
    puffs.forEach(({ node, phase, angle, reach, size }, i) => {
      const age = (clock / PUFF_LIFE + phase) % 1, born = clock - age * PUFF_LIFE
      const alive = clock > 0 && born >= 0 && born <= ERUPTION_ENDS
      const fade = ramp(0, 0.06, age) * (1 - ramp(0.68, 1, age)) * (1 - state.flowFade)
      node.visible = alive && fade > 0.01
      if (!node.visible) return
      // up fast at first, slowing as it spreads into the cap; the wind bends the top over
      const rise = 4.8 * (1 - (1 - age) ** 1.8)
      const spread = (0.15 + 0.5 * age + 1.8 * ramp(0.35, 1, age)) * reach
      const wind = age * age
      const churn = 0.12 * Math.sin(time * 0.9 + i * 1.7)
      node.position.set(Math.cos(angle) * spread - wind * 1.8 + churn, rimHeight + 0.2 + rise, Math.sin(angle) * spread * 0.8 + wind * 0.6)
      node.material.size = (0.9 + 3 * age ** 0.8) * size
      node.material.opacity = 0.9 * fade
      // dark ash low down, paler as it rises; the fire tints the bottom of the column
      const g = lerp(0.3, 0.84, age ** 0.7), fire = (1 - age) ** 4 * state.erupt * 0.6
      node.material.color.set([lerp(g, 1, fire), lerp(g, 0.5, fire), lerp(g * 1.02, 0.25, fire)])
    })
    C.cloud.visible = state.cloud > 0.3 && clock < ERUPTION_ENDS + 1.5
    C.cloud.position.set(-1, rimHeight + 3.4, 0.35)
    // steam while it sleeps
    wisps.forEach(({ node, phase }) => {
      const k = (time * 0.16 + phase) % 1
      node.visible = state.smoke > 0.01
      node.position.set(-k * 0.9, rimHeight + 0.15 + k * 2, k * 0.3)
      node.material.size = 0.4 + k * 1.1
      node.material.opacity = state.smoke * 0.6 * Math.sin(Math.PI * k)
    })
    C.flow.visible = state.flows > 0.3 && state.flowFade < 0.5
  }

  story.onStep((index, label) => {
    info.textContent = `${index + 1} / ${STEPS.length}  ${label}`
    for (const [name, label] of Object.entries(C)) label.className = FOCUS[index].includes(name) ? 'volcano-callout now' : 'volcano-callout'
  })
  story.seek(0)
  apply(0)
  if (import.meta.env.DEV) Object.assign(window, { story, view })
  view.frame(new Box3([-B, -DEPTH, -B], [B, PEAK + 3.4, B]), { padding: 0.1 })

  const controls = {
    'play / pause': () => (story.playing ? story.pause() : story.play()),
    'previous step': () => story.seekStep(Math.max(0, story.step - 1)),
    'next step': () => story.seekStep(Math.min(STEPS.length - 1, story.step + 1)),
  }
  for (const name of Object.keys(controls)) gui.add(controls, name)
  gui.add(story, 'speed', 0.25, 3, 0.25)
  const bloom = /** @type {Required<import('phoria2').BloomOptions>} */ (view.bloom)
  gui.add(bloom, 'strength', 0, 3, 0.05).name('glow').onChange(() => view.invalidate())

  return view.start((dt, t) => {
    story.update(dt)
    apply(t)
  })
}
