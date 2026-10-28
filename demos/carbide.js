import { AmbientLight, Box3, DirectionalLight, Geometry, Group, InstancedMesh, Mesh, PointLight, SpotLight, Texture, View, box, cylinder, extrude, outline } from 'phoria2'
import { random } from './kit.js'

// Carbide, the Robot Wars champion: a low black and neon green double wedge on two yellow wheels,
// with a thick steel bar at its nose that spins into a slot cut round the front of the body. It
// sits on a scuffed steel
// table in a dark arena and runs through its paces - rocks on its wheels, spins the blade up,
// shuffles about at full speed, winds down. The blade turns at its true speed, so at full speed it
// strobes, as it does on film. The readout keeps count.

const TAU = Math.PI * 2
const GREEN = '#3df51f', YELLOW = '#f5c518', BLACK = '#0b0c0c'
const MAX_RPM = 2400
const HUB = [0, 3.9] // the weapon's axle, from above: x, z
const REACH = 4.8 // half the blade's length
const WHEEL = { x: 3.0, z: -2.2, radius: 1.15, width: 0.6 }
const BASE = 0.22, MID = 1.0, TOP = 1.78 // the walls' foot, their widest line, and their top
const SLOPE = 0.35 // how far the walls lean in, from the middle up to the top and down to the foot
const SLOT = 0.32 // half the height of the slot the blade spins into
const CAVITY = REACH + 0.25 // the radius of the space inside the body that the blade turns in
const BAR = { bottom: MID - 0.19, top: MID + 0.19, half: 0.45 }
const PLATE = { bottom: TOP + 0.05, top: TOP + 0.11 }
const UNDER = { bottom: BASE - 0.11, top: BASE - 0.05 } // the bottom plate
const LOOP = 16 // seconds
const AT = -2 // where on the table it stands, front to back
// the body's outline from above (x, z, corner radius): a wedge from the wide back to the nose
const CORNERS = [[1.0, 3.3, 0.8], [4.75, -2.6, 0.8], [3.9, -3.6, 0.8], [-3.9, -3.6, 0.8], [-4.75, -2.6, 0.8], [-1.0, 3.3, 0.8]]

const clamp01 = (t) => Math.min(1, Math.max(0, t))
const smooth = (t) => t * t * (3 - 2 * t)
/** 0 before a, 1 after b, eased between. */
const ramp = (t, a, b) => smooth(clamp01((t - a) / (b - a)))

/** A canvas, drawn on, as a texture. */
function painted(width, height, draw, options = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  draw(/** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d')), width, height)
  return new Texture({ image: canvas, ...options })
}

// --- outlines: closed lists of [x, z], clockwise seen from above with +z toward you

/** Corners rounded off and walked into points about `step` apart, starting mid-way along the front edge. */
function rounded(corners, step) {
  const n = corners.length, path = []
  const [ax, az] = corners[n - 1], [bx, bz] = corners[0]
  path.push([(ax + bx) / 2, (az + bz) / 2])
  for (let i = 0; i < n; i++) {
    const [px, pz] = corners[(i + n - 1) % n], [x, z, r] = corners[i], [nx, nz] = corners[(i + 1) % n]
    const pl = Math.hypot(px - x, pz - z), nl = Math.hypot(nx - x, nz - z)
    const ux = (px - x) / pl, uz = (pz - z) / pl, vx = (nx - x) / nl, vz = (nz - z) / nl
    const half = Math.acos(Math.max(-1, Math.min(1, ux * vx + uz * vz))) / 2
    // the arc's centre is along the bisector; it meets each edge where the edge is tangent to it
    const bl = Math.hypot(ux + vx, uz + vz), far = r / Math.sin(half)
    const cx = x + (ux + vx) / bl * far, cz = z + (uz + vz) / bl * far
    const t = r / Math.tan(half)
    let a0 = Math.atan2(z + uz * t - cz, x + ux * t - cx), a1 = Math.atan2(z + vz * t - cz, x + vx * t - cx)
    // the short way round
    if (a1 - a0 > Math.PI) a1 -= TAU
    if (a0 - a1 > Math.PI) a1 += TAU
    for (let k = 0; k <= 8; k++) {
      const a = a0 + (a1 - a0) * k / 8
      path.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r])
    }
  }
  return resample(path, step)
}

/** Points evenly spaced round a closed path. */
function resample(path, step) {
  const lengths = [0]
  for (let i = 1; i <= path.length; i++) {
    const [ax, az] = path[i - 1], [bx, bz] = path[i % path.length]
    lengths.push(lengths[i - 1] + Math.hypot(bx - ax, bz - az))
  }
  const total = lengths[path.length], count = Math.max(3, Math.round(total / step)), out = []
  let j = 0
  for (let k = 0; k < count; k++) {
    const d = total * k / count
    while (lengths[j + 1] < d) j++
    const f = (d - lengths[j]) / (lengths[j + 1] - lengths[j] || 1)
    const [ax, az] = path[j], [bx, bz] = path[(j + 1) % path.length]
    out.push([ax + (bx - ax) * f, az + (bz - az) * f])
  }
  return out
}

/** Each point's outward direction, from its neighbours. */
function normals(points) {
  return points.map((_, i) => {
    const [ax, az] = points[(i + points.length - 1) % points.length], [bx, bz] = points[(i + 1) % points.length]
    const tx = bx - ax, tz = bz - az, l = Math.hypot(tx, tz)
    return [-tz / l, tx / l]
  })
}

/** The same outline moved in by d. */
function inset(points, d) {
  const n = normals(points)
  return points.map(([x, z], i) => [x - n[i][0] * d, z - n[i][1] * d])
}

/** Whether a point is inside a polygon. */
function inside([x, z], points) {
  let hit = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, az] = points[i], [bx, bz] = points[j]
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) hit = !hit
  }
  return hit
}

/**
 * A flat piece cut from an outline in plan ([x, z] pairs), from y0 up to y1 - mesh options, its
 * geometry and where it sits. Seen from above, an outline's y runs away from you, towards -z.
 */
function slab(points, y0, y1) {
  return { geometry: extrude({ shape: points.map(([x, z]) => [x, -z]), depth: y1 - y0, axis: 'y' }), position: [0, (y0 + y1) / 2, 0] }
}

/**
 * A band joining two matching rings of [x, y, z] points - the walls, the lips. u runs round the
 * ring; v is 0 along the upper ring and 1 along the lower, unless `v(i, upper)` says otherwise.
 * An open band's ends don't meet.
 */
function loft(lower, upper, v = (i, up) => (up ? 0 : 1), closed = true) {
  const positions = [], uvs = [], indices = [], n = lower.length, columns = closed ? n + 1 : n
  for (let i = 0; i < columns; i++) {
    const k = i % n
    positions.push(...lower[k], ...upper[k])
    uvs.push(i / (columns - 1), v(k, false), i / (columns - 1), v(k, true))
  }
  for (let i = 0; i < columns - 1; i++) {
    const b = i * 2, t = b + 1, b2 = b + 2, t2 = b + 3
    indices.push(b, b2, t2, b, t2, t)
  }
  return new Geometry({ positions, uvs, indices })
}

// --- textures

/**
 * One band of the armour: trim along its top and foot edges, flames streaming back down the sides,
 * and on the upper band the name across the back. `top` and `foot` give where each point's band
 * begins and ends, as v; `flames` is the flames' height on it, as v.
 */
function armourTexture(outline, { top, foot, base, ink, flames, name = false }) {
  const rand = random(11)
  const n = outline.length, dirs = normals(outline)
  let perimeter = 0
  for (let i = 0; i < n; i++) perimeter += Math.hypot(outline[(i + 1) % n][0] - outline[i][0], outline[(i + 1) % n][1] - outline[i][1])
  const W = 4096, H = 256
  // texels per unit round the wall, against texels per unit up it - text is drawn squeezed by this to come out square
  const squeeze = (W / perimeter) / (H / Math.hypot(TOP - MID, SLOPE))
  return painted(W, H, (ctx) => {
    ctx.fillStyle = base
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = ink
    // trim along both edges, following them round the slot's opening
    const along = (fn, x) => {
      const p = x / W * n, i = Math.floor(p), t = p - i
      return fn(i % n) * (1 - t) + fn((i + 1) % n) * t
    }
    for (let x = 0; x < W; x++) {
      ctx.fillRect(x, along(top, x) * H - 1, 1, H * 0.08 + 1)
      const v = along(foot, x)
      ctx.fillRect(x, (v - 0.09) * H, 1, H * 0.09 + 1)
    }
    // flames down the sides, streaming back from near the nose: tapering tongues, ragged at the root
    const sides = []
    for (let i = 0; i < n; i++) if (Math.abs(dirs[i][0]) > 0.75 && outline[i][1] > -0.6) sides.push(i)
    for (const way of [-1, 1]) {
      const mine = sides.filter((i) => Math.sign(outline[i][0]) === way)
      for (let f = 0; f < 4; f++) {
        const i = mine[Math.floor((0.1 + f * 0.22 + rand() * 0.08) * mine.length)]
        const back = Math.sign(outline[(i + 1) % n][1] - outline[i][1]) < 0 ? 1 : -1
        const x0 = i / n * W, len = (190 + rand() * 150) * back, y = H * (flames + (rand() - 0.5) * 0.1), thick = H * (0.05 + rand() * 0.04)
        ctx.beginPath()
        ctx.moveTo(x0, y - thick)
        ctx.quadraticCurveTo(x0 + len * 0.5, y - thick * 1.1, x0 + len, y - thick * 0.2)
        ctx.quadraticCurveTo(x0 + len * 0.45, y + thick * 1.1, x0, y + thick * 0.7)
        ctx.lineTo(x0 - back * thick * 0.7, y + thick * 0.2)
        ctx.lineTo(x0 + back * thick * 0.3, y - thick * 0.2)
        ctx.lineTo(x0 - back * thick * 0.6, y - thick * 0.8)
        ctx.closePath()
        ctx.fill()
      }
    }
    // grime: faint scuffs and chips
    for (let k = 0; k < 400; k++) {
      ctx.fillStyle = `rgba(${rand() < 0.5 ? '255, 255, 255' : '0, 0, 0'}, ${0.04 + rand() * 0.08})`
      ctx.fillRect(rand() * W, rand() * H, 2 + rand() * 18, 1 + rand() * 2)
    }
    if (name) {
      // the name, big on the back panel
      const write = (u, size, w) => {
        ctx.save()
        ctx.translate(u * W, H * 0.52)
        ctx.scale(squeeze, 1)
        ctx.font = `italic 900 ${size}px "Arial Black", Impact, system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.lineWidth = w
        ctx.strokeStyle = '#000'
        ctx.strokeText('CARBIDE', 0, 0)
        ctx.fillStyle = GREEN
        ctx.fillText('CARBIDE', 0, 0)
        ctx.restore()
      }
      let back = 0, best = Infinity
      outline.forEach(([x, z], i) => {
        if (z < -3 && Math.abs(x) < best) { best = Math.abs(x); back = i }
      })
      // the back panel's frame
      ctx.save()
      ctx.translate(back / n * W, H * 0.52)
      ctx.scale(squeeze, 1)
      ctx.strokeStyle = GREEN
      ctx.lineWidth = 10
      ctx.strokeRect(-330, -70, 660, 140)
      ctx.restore()
      write(back / n, 112, 10)
    }
  })
}

/** The top plate: dark and glossy with a green border, the name down the middle and a hatch. */
function plateTexture(outline, bounds) {
  const S = 1024
  const map = ([x, z]) => [(x - bounds.x0) / (bounds.x1 - bounds.x0) * S, (z - bounds.z0) / (bounds.z1 - bounds.z0) * S]
  return painted(S, S, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, S, S)
    g.addColorStop(0, '#1d2023')
    g.addColorStop(1, '#121416')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, S, S)
    ctx.strokeStyle = GREEN
    ctx.lineWidth = 9
    ctx.beginPath()
    inset(outline, 0.16).forEach((p, i) => (i ? ctx.lineTo(...map(p)) : ctx.moveTo(...map(p))))
    ctx.closePath()
    ctx.stroke()
    // the name runs front to back, read from the left side
    ctx.save()
    ctx.translate(S / 2, S * 0.52)
    ctx.rotate(-Math.PI / 2)
    ctx.scale(1, (bounds.x1 - bounds.x0) / (bounds.z1 - bounds.z0))
    ctx.font = 'italic 900 112px "Arial Black", Impact, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 8
    ctx.strokeStyle = '#000'
    ctx.strokeText('CARBIDE', 0, 0)
    ctx.fillStyle = GREEN
    ctx.fillText('CARBIDE', 0, 0)
    ctx.restore()
    // wear
    const rand = random(4)
    for (let k = 0; k < 220; k++) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.03 + rand() * 0.06})`
      ctx.lineWidth = 1
      const x = rand() * S, y = rand() * S, a = rand() * TAU, l = 10 + rand() * 60
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l)
      ctx.stroke()
    }
  })
}

/** Brushed steel, the grain running one way. */
function brushedTexture(seed, tone = 150) {
  const rand = random(seed)
  return painted(512, 128, (ctx, w, h) => {
    ctx.fillStyle = `rgb(${tone}, ${tone + 2}, ${tone + 5})`
    ctx.fillRect(0, 0, w, h)
    for (let k = 0; k < 900; k++) {
      const c = tone + (rand() - 0.5) * 60
      ctx.fillStyle = `rgba(${c}, ${c}, ${c + 4}, 0.35)`
      ctx.fillRect(rand() * w, rand() * h, 20 + rand() * 160, 1)
    }
  })
}

/** The weapon drum: turned steel with deep flutes, so it can be seen to turn. */
function drumTexture() {
  return painted(512, 64, (ctx, w, h) => {
    ctx.fillStyle = '#a9aeb4'
    ctx.fillRect(0, 0, w, h)
    for (let k = 0; k < 12; k++) {
      const x = k / 12 * w
      const g = ctx.createLinearGradient(x, 0, x + w / 24, 0)
      g.addColorStop(0, '#3a3e44')
      g.addColorStop(1, '#8c9197')
      ctx.fillStyle = g
      ctx.fillRect(x, h * 0.18, w / 24, h * 0.64)
    }
  })
}

/** Knobbly yellow tread, blocks staggered round the tyre. */
function treadTexture() {
  return painted(512, 64, (ctx, w, h) => {
    ctx.fillStyle = '#c9951a'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = YELLOW
    for (let k = 0; k < 28; k++) {
      const x = k / 28 * w
      ctx.fillRect(x + 2, 4, w / 28 - 6, h * 0.42)
      ctx.fillRect(x + w / 56 + 2, h * 0.54, w / 28 - 6, h * 0.42)
    }
  })
}

/** The table's steel top: mottled grey, ground in swirls, scratched and scuffed. */
function tableTexture() {
  const rand = random(21)
  return painted(2048, 2048, (ctx, w, h) => {
    ctx.fillStyle = '#4b4e52'
    ctx.fillRect(0, 0, w, h)
    for (let k = 0; k < 260; k++) {
      const x = rand() * w, y = rand() * h, r = 40 + rand() * 260
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      const dark = rand() < 0.6
      g.addColorStop(0, dark ? `rgba(20, 22, 24, ${0.12 + rand() * 0.2})` : `rgba(150, 155, 160, ${0.06 + rand() * 0.1})`)
      g.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = g
      ctx.fillRect(x - r, y - r, r * 2, r * 2)
    }
    // grinder swirls
    for (let k = 0; k < 40; k++) {
      const x = rand() * w, y = rand() * h, r = 30 + rand() * 90
      ctx.strokeStyle = `rgba(190, 195, 200, ${0.015 + rand() * 0.03})`
      ctx.lineWidth = 1
      for (let j = 0; j < 6; j++) {
        ctx.beginPath()
        ctx.arc(x + rand() * 6, y + rand() * 6, r - j * 3, rand() * TAU, rand() * TAU + 2)
        ctx.stroke()
      }
    }
    // scratches
    for (let k = 0; k < 1400; k++) {
      const x = rand() * w, y = rand() * h, a = rand() * TAU, l = 6 + rand() * 120
      ctx.strokeStyle = rand() < 0.75 ? `rgba(210, 214, 220, ${0.05 + rand() * 0.15})` : `rgba(10, 10, 12, ${0.1 + rand() * 0.2})`
      ctx.lineWidth = rand() < 0.9 ? 1 : 2
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.quadraticCurveTo(x + Math.cos(a + 0.2) * l / 2, y + Math.sin(a + 0.2) * l / 2, x + Math.cos(a) * l, y + Math.sin(a) * l)
      ctx.stroke()
    }
    // speckle
    for (let k = 0; k < 30000; k++) {
      const c = 60 + rand() * 90
      ctx.fillStyle = `rgba(${c}, ${c + 2}, ${c + 5}, 0.25)`
      ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2)
    }
  })
}

/** The arena floor far below: dark steel plates with seams, fading into the dark. */
function floorTexture() {
  return painted(1024, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#1a1c1f'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)'
    ctx.lineWidth = 3
    for (let k = 0; k <= 8; k++) {
      ctx.beginPath()
      ctx.moveTo(k / 8 * w, 0)
      ctx.lineTo(k / 8 * w, h)
      ctx.moveTo(0, k / 8 * h)
      ctx.lineTo(w, k / 8 * h)
      ctx.stroke()
    }
    const fade = ctx.createRadialGradient(w / 2, h / 2, w * 0.08, w / 2, h / 2, w * 0.5)
    fade.addColorStop(0, 'rgba(0, 0, 0, 0)')
    fade.addColorStop(1, 'rgba(0, 0, 0, 1)')
    ctx.fillStyle = fade
    ctx.fillRect(0, 0, w, h)
  })
}

// --- the robot

/**
 * A deck across the body - a plate or a shelf - from a ring round the hub at the front back to the
 * wheels, cut away round them. `offset` is how far in from the walls' widest line its sides run.
 */
function deck(offset, r) {
  const notch = WHEEL.x - WHEEL.width / 2 - 0.08, rear = CORNERS[2][1] + offset
  const side = (z) => {
    const [ax, az] = CORNERS[0], [bx, bz] = CORNERS[1]
    return ax + (bx - ax) * (z - az) / (bz - az) - offset
  }
  // the sides run straight from just ahead of the wheels to meet the ring round the hub
  const ledge = WHEEL.z + WHEEL.radius + 0.1, edgeX = side(ledge)
  const beta = Math.atan2(ledge - HUB[1], edgeX - HUB[0]), D = Math.hypot(ledge - HUB[1], edgeX - HUB[0])
  const reach = beta + Math.acos(r / D)
  const path = []
  for (let k = 0; k <= 24; k++) {
    const a = Math.PI - reach + (2 * reach - Math.PI) * k / 24
    path.push([HUB[0] + Math.cos(a) * r, HUB[1] + Math.sin(a) * r])
  }
  path.push([edgeX, ledge], [notch, ledge], [notch, rear], [-notch, rear], [-notch, ledge], [-edgeX, ledge])
  return { points: resample(path, 0.1), bounds: { x0: -edgeX, x1: edgeX, z0: rear, z1: HUB[1] + r } }
}

/**
 * The body: a double wedge, its armour leaning in from the widest line round the middle to the top
 * and to the foot, with green lips, top and bottom plates, and the slot round the front that the
 * blade spins into - a dark cavity inside.
 */
function body() {
  const g = new Group()
  const outline = rounded(CORNERS, 0.08)
  const leaned = inset(outline, SLOPE)
  /** A point on the wall at height y: out at the middle, leaning in above and below. */
  const wall = (i, y) => {
    const [bx, bz] = outline[i], [tx, tz] = leaned[i], t = y > MID ? (y - MID) / (TOP - MID) : (MID - y) / (MID - BASE)
    return [bx + (tx - bx) * t, y, bz + (tz - bz) * t]
  }
  const ring = (y) => outline.map((_, i) => wall(i, y(i)))
  // the slot opens wherever the blade's sweep reaches the walls
  const open = (i) => {
    const [x, z] = outline[i]
    return smooth(clamp01((CAVITY + 0.15 - Math.hypot(x - HUB[0], z - HUB[1])) / 0.4))
  }
  const upperFoot = (i) => 1 - open(i) * SLOT / (TOP - MID), lowerTop = (i) => open(i) * SLOT / (MID - BASE)
  const armour = { roughness: 0.42, metalness: 0.15, doubleSided: true }
  const top = ring(() => TOP), bottom = ring(() => BASE)
  // above the slot black with green flames; below it green with black
  g.add(new Mesh({
    geometry: loft(ring((i) => MID + open(i) * SLOT), top, (i, up) => (up ? 0 : upperFoot(i))), castShadow: true,
    material: { ...armour, map: armourTexture(outline, { top: () => 0, foot: upperFoot, base: BLACK, ink: GREEN, flames: 0.3, name: true }) },
  }))
  g.add(new Mesh({
    geometry: loft(bottom, ring((i) => MID - open(i) * SLOT), (i, up) => (up ? lowerTop(i) : 1)), castShadow: true,
    material: { ...armour, map: armourTexture(outline, { top: lowerTop, foot: () => 1, base: GREEN, ink: BLACK, flames: 0.72 }) },
  }))
  // the lips: green bevels from the walls' top and foot in to the plates
  const lip = { color: GREEN, roughness: 0.35, metalness: 0.1, doubleSided: true }
  const flatten = (points) => points.map(([x, , z]) => [x, z])
  g.add(new Mesh({ geometry: loft(top, inset(flatten(top), 0.2).map(([x, z]) => [x, TOP + 0.08, z])), castShadow: true, material: lip }))
  g.add(new Mesh({ geometry: loft(inset(flatten(bottom), 0.2).map(([x, z]) => [x, BASE - 0.08, z]), bottom), castShadow: true, material: lip }))

  // the cavity: dark shelves above and below the slot, and a wall round the back of the blade's sweep
  const dark = { color: '#050505', unlit: true, doubleSided: true }
  const shelf = deck(0.2, 0.62).points
  g.add(new Mesh({ ...slab(shelf, MID + SLOT, MID + SLOT + 0.03), material: dark }))
  g.add(new Mesh({ ...slab(shelf, MID - SLOT - 0.03, MID - SLOT), material: dark }))
  const within = inset(outline, 0.05), arc = []
  for (let k = 0; k <= 240; k++) {
    const a = -Math.PI / 2 + (k / 240 - 0.5) * TAU, p = [HUB[0] + Math.cos(a) * CAVITY, HUB[1] + Math.sin(a) * CAVITY]
    if (inside(p, within)) arc.push(p)
  }
  g.add(new Mesh({ geometry: loft(arc.map(([x, z]) => [x, MID - SLOT, z]), arc.map(([x, z]) => [x, MID + SLOT, z]), undefined, false), material: dark }))

  // the top plate: out to a ring round the weapon's hub at the front, cut away round the wheels at
  // the back; the bottom plate the same shape underneath
  // extrude() spreads its texture over the outline's bounds, as the plate's texture is drawn
  const { points: plate, bounds } = deck(SLOPE + 0.2, 0.95)
  g.add(new Mesh({
    ...slab(plate, PLATE.bottom, PLATE.top), castShadow: true, receiveShadow: true,
    material: { map: plateTexture(plate, bounds), roughness: 0.3, metalness: 0.35 },
  }))
  g.add(new Mesh({ ...slab(plate, UNDER.bottom, UNDER.top), castShadow: true, material: { color: '#16181a', roughness: 0.5, metalness: 0.4 } }))
  // bolts round the plate's edge
  const bolts = resample(inset(plate, 0.3), 0.9).filter(([x, z]) => Math.hypot(x - HUB[0], z - HUB[1]) > 0.75)
  g.add(new InstancedMesh({
    geometry: cylinder({ radius: 0.07, height: 0.05, segments: 6 }),
    instances: bolts.map(([x, z]) => ({ position: [x, PLATE.top + 0.025, z] })),
    material: { color: '#9aa0a6', metalness: 1, roughness: 0.35 },
  }))
  // a hatch at the back, and the yellow power switch
  g.add(new Mesh({ geometry: box({ width: 1.5, height: 0.07, depth: 1.0 }), position: [0, PLATE.top + 0.035, -2.1], castShadow: true, material: { color: '#0a0b0c', roughness: 0.5 } }))
  g.add(new Mesh({ geometry: cylinder({ radius: 0.15, height: 0.14, segments: 20 }), position: [-1.35, PLATE.top + 0.07, 0.9], castShadow: true, material: { color: YELLOW, roughness: 0.4 } }))
  return g
}

/** A drive wheel: yellow knobbly tyre on a darker hub, bolts to show it turning. Turns about x. */
function wheel(side) {
  const g = new Group({ position: [side * WHEEL.x, WHEEL.radius, WHEEL.z] })
  const spin = g.add(new Group())
  spin.add(new Mesh({ geometry: cylinder({ radius: WHEEL.radius, height: WHEEL.width, segments: 40, caps: false, axis: 'x' }), castShadow: true, material: { map: treadTexture(), roughness: 0.85, doubleSided: true } }))
  spin.add(new Mesh({ geometry: cylinder({ radius: WHEEL.radius - 0.02, height: WHEEL.width - 0.02, segments: 40, axis: 'x' }), castShadow: true, material: { color: '#e0ad17', roughness: 0.8 } }))
  spin.add(new Mesh({ geometry: cylinder({ radius: 0.38, height: WHEEL.width + 0.04, segments: 24, axis: 'x' }), material: { color: '#b07c10', roughness: 0.6 } }))
  spin.add(new InstancedMesh({
    geometry: cylinder({ radius: 0.06, height: WHEEL.width + 0.1, segments: 6, axis: 'x' }),
    instances: Array.from({ length: 5 }, (_, k) => ({ position: [0, Math.cos(k / 5 * TAU) * 0.24, Math.sin(k / 5 * TAU) * 0.24] })),
    material: { color: '#2b2b2b', metalness: 0.8, roughness: 0.4 },
  }))
  return { node: g, spin }
}

/** The weapon: the steel bar with yellow tips, clamped under a fluted drum and sprocket. Turns about y. */
function weapon() {
  const g = new Group({ position: [HUB[0], 0, HUB[1]] })
  const L = REACH, w = BAR.half
  // the bar's middle, and its tips - each with a tooth on its leading edge (the bar turns anticlockwise from above)
  const mid = L - 0.7
  const middle = [[-mid, w], [mid, w], [mid, -w], [-mid, -w]]
  const tip = [[mid, w], [L - 0.55, w], [L, w - 0.3], [L, -w - 0.06], [L - 0.35, -w - 0.06], [L - 0.45, -w], [mid, -w]]
  const steel = { map: brushedTexture(7, 150), metalness: 0.95, roughness: 0.32 }
  g.add(new Mesh({ ...slab(middle, BAR.bottom, BAR.top), castShadow: true, material: steel }))
  const paint = { color: YELLOW, roughness: 0.45, metalness: 0.2 }
  g.add(new Mesh({ ...slab(tip, BAR.bottom, BAR.top), castShadow: true, material: paint }))
  g.add(new Mesh({ ...slab(tip.map(([x, z]) => [-x, -z]), BAR.bottom, BAR.top), castShadow: true, material: paint }))
  // clamps above and below, the boss down to the bottom plate, the drum, sprocket and cap
  const shiny = { color: '#c4c9cf', metalness: 1, roughness: 0.25 }
  g.add(new Mesh({ geometry: cylinder({ radius: 0.78, height: 0.12, segments: 32 }), position: [0, BAR.top + 0.06, 0], castShadow: true, material: shiny }))
  g.add(new Mesh({ geometry: cylinder({ radius: 0.78, height: 0.12, segments: 32 }), position: [0, BAR.bottom - 0.06, 0], castShadow: true, material: shiny }))
  const boss = BAR.bottom - 0.12 - UNDER.top
  g.add(new Mesh({ geometry: cylinder({ radius: 0.5, height: boss, segments: 32 }), position: [0, UNDER.top + boss / 2, 0], material: { map: drumTexture(), metalness: 1, roughness: 0.3 } }))
  const drum = PLATE.top + 0.06 - (BAR.top + 0.12)
  g.add(new Mesh({ geometry: cylinder({ radius: 0.58, height: drum, segments: 36 }), position: [0, BAR.top + 0.12 + drum / 2, 0], castShadow: true, material: { map: drumTexture(), metalness: 1, roughness: 0.3 } }))
  const sprocketY = MID + 0.5
  g.add(new Mesh({ geometry: extrude({ shape: outline.gear({ radius: 0.78, teeth: 20, depth: 0.1 }), depth: 0.1, axis: 'y' }), position: [0, sprocketY, 0], castShadow: true, material: shiny }))
  const capY = BAR.top + 0.12 + drum
  g.add(new Mesh({ geometry: cylinder({ radius: 0.46, height: 0.06, segments: 32 }), position: [0, capY + 0.03, 0], material: shiny }))
  g.add(new InstancedMesh({
    geometry: cylinder({ radius: 0.06, height: 0.06, segments: 6 }),
    instances: Array.from({ length: 8 }, (_, k) => ({ position: [Math.cos(k / 8 * TAU) * 0.32, capY + 0.08, Math.sin(k / 8 * TAU) * 0.32] })),
    material: { color: '#4a4e54', metalness: 1, roughness: 0.4 },
  }))
  return g
}

// --- the show

/** The blade's speed through the loop, in rpm: still, spin up, full, wind down, still. */
function rpmAt(t) {
  if (t < 3) return 0
  if (t < 6) return MAX_RPM * (1 - (1 - (t - 3) / 3) ** 3)
  if (t < 10) return MAX_RPM
  if (t < 14) return MAX_RPM * (1 - (t - 10) / 4) ** 2
  return 0
}

/** Where the robot is through the loop: a rock on its wheels, then a shuffle and a few turns at speed. */
function poseAt(t) {
  const jog = Math.sin(Math.PI * clamp01((t - 0.6) / 2)) ** 2
  const turns = ramp(t, 6.2, 6.8) * (1 - ramp(t, 9.6, 10.4))
  const yaw = 0.32 * Math.sin(TAU * (t - 6.2) / 3.4) * turns
  const shuffle = 0.35 * Math.sin(TAU * (t - 6.2) / 6.8) * turns
  return { x: 0, z: 0.6 * jog + shuffle, yaw }
}

export default function run({ canvas, gui, info }) {
  const view = new View({
    canvas, background: '#050607',
    orbit: { minPitch: 0.06, maxPitch: 1.35, minDistance: 7, maxDistance: 45 },
    camera: { position: [5.5, 6.5, 15], target: [0, 0.4, 0.4], fov: 40 },
  })
  const { scene } = view
  // a dim studio for the metal to reflect; the arena itself is dark, lit from above
  scene.environment = 'studio'
  scene.environmentIntensity = 0.35
  scene.add(new AmbientLight({ intensity: 0.12 }))
  scene.add(new DirectionalLight({ direction: [0.45, -1, -0.5], intensity: 2.2, castShadow: true }))
  scene.add(new SpotLight({ color: '#fff4e0', position: [0, 18, 1], direction: [0, -1, -0.05], angle: 0.5, penumbra: 0.6, range: 40, intensity: 220 }))
  // coloured rims from the arena lights behind
  scene.add(new PointLight({ color: '#3d7bff', position: [-12, 6, -12], range: 40, intensity: 70 }))
  scene.add(new PointLight({ color: '#9dff6a', position: [12, 4, -10], range: 40, intensity: 40 }))

  // --- the table and the arena floor
  scene.add(new Mesh({
    geometry: box({ width: 22, height: 0.5, depth: 15 }), position: [0, -0.25, 0], receiveShadow: true, castShadow: true, pickable: false,
    material: { map: tableTexture(), metalness: 0.65, roughness: 0.55 },
  }))
  const frame = { color: '#16181a', roughness: 0.6, metalness: 0.5 }
  for (const [x, z] of [[-10.3, -6.8], [10.3, -6.8], [-10.3, 6.8], [10.3, 6.8]]) {
    scene.add(new Mesh({ geometry: box({ width: 0.6, height: 8.5, depth: 0.6 }), position: [x, -4.75, z], castShadow: true, pickable: false, material: frame }))
  }
  for (const z of [-6.8, 6.8]) scene.add(new Mesh({ geometry: box({ width: 20, height: 0.5, depth: 0.4 }), position: [0, -1.0, z], pickable: false, material: frame }))
  for (const x of [-10.3, 10.3]) scene.add(new Mesh({ geometry: box({ width: 0.4, height: 0.5, depth: 13 }), position: [x, -1.0, 0], pickable: false, material: frame }))
  scene.add(new Mesh({
    geometry: box({ width: 140, height: 0.2, depth: 140 }), position: [0, -9.1, 0], receiveShadow: true, pickable: false,
    material: { map: floorTexture(), roughness: 0.7, metalness: 0.4 },
  }))

  // --- the robot
  const bot = scene.add(new Group({ position: [0, 0, AT] }))
  bot.add(body())
  const wheels = [wheel(-1), wheel(1)]
  for (const w of wheels) bot.add(w.node)
  const blade = bot.add(weapon())

  // --- the readout
  const readout = document.createElement('div')
  readout.className = 'hud bot-readout'
  readout.innerHTML = '<span>Weapon</span><b>0</b><em>rpm</em><i><s></s></i><small>tip speed 0 mph</small>'
  document.body.append(readout)
  const digits = /** @type {HTMLElement} */ (readout.querySelector('b'))
  const meter = /** @type {HTMLElement} */ (readout.querySelector('s'))
  const tip = /** @type {HTMLElement} */ (readout.querySelector('small'))
  let shown = -1

  // the loop's clock, the blade's and wheels' angles, and where the robot was last frame
  const state = { playing: true, time: 0, blade: 0, left: 0, right: 0, twist: 0, z: 0, yaw: 0 }
  gui.add(state, 'playing').name('play')
  if (import.meta.env.DEV) Object.assign(window, { view, state })
  // the robot and the blade's sweep, from the front quarter
  view.frame(new Box3([-REACH, 0, AT - 3.8], [REACH, 2, AT + HUB[1] + REACH]), { padding: 0.06 })
  info.textContent = 'Carbide - two-time Robot Wars champion'

  return view.start((dt) => {
    if (!state.playing || !(dt > 0)) return
    dt = Math.min(dt, 0.1)
    state.time = (state.time + dt) % LOOP
    const rpm = rpmAt(state.time)
    // spinning the blade up twists the body the other way, and winding it down twists it back
    const push = (rpm - rpmAt(Math.max(0, state.time - dt))) / (MAX_RPM * dt)
    state.twist += (-0.07 * push - state.twist) * Math.min(1, dt * 4)
    const pose = poseAt(state.time), yaw = pose.yaw + state.twist
    // each wheel rolls as far as its side of the robot goes - forward, and round as it turns
    const ds = (pose.z - state.z) * Math.cos(yaw), dyaw = yaw - state.yaw
    state.right += (ds - dyaw * WHEEL.x) / WHEEL.radius
    state.left += (ds + dyaw * WHEEL.x) / WHEEL.radius
    state.z = pose.z
    state.yaw = yaw
    wheels[0].spin.rotation.set(state.left, 0, 0)
    wheels[1].spin.rotation.set(state.right, 0, 0)
    // a buzz through the chassis at speed
    const buzz = rpm / MAX_RPM, t = performance.now() / 1000
    bot.position.set(pose.x + Math.sin(t * 71) * 0.006 * buzz, Math.abs(Math.sin(t * 97)) * 0.008 * buzz, AT + pose.z)
    bot.rotation.set(Math.sin(t * 131) * 0.002 * buzz, yaw, Math.sin(t * 89) * 0.003 * buzz)
    state.blade = (state.blade + rpm / 60 * TAU * dt) % TAU
    blade.rotation.set(0, state.blade, 0)

    const r = Math.round(rpm / 10) * 10
    if (r !== shown) {
      shown = r
      digits.textContent = r.toLocaleString('en-GB')
      meter.style.width = `${(rpm / MAX_RPM * 100).toFixed(1)}%`
      // the tip's speed, with the robot at about a metre across
      tip.textContent = `tip speed ${Math.round(rpm / 60 * TAU * REACH * 0.1 * 2.237)} mph`
    }
  })
}
