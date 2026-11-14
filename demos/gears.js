import { DirectionalLight, Geometry, Group, Lines, Mesh, Texture, View, cylinder, extrude, outline, plane } from 'phoria2'
import { download } from './kit.js'

// Every gear has teeth the same size, so a gear's pitch radius - where it meets another - is its
// tooth count over TEETH_PER_UNIT, and any wheel rolling on any ring stays in mesh.
const TEETH_PER_UNIT = 12
const pitch = (/** @type {number} */ teeth) => teeth / TEETH_PER_UNIT
// how far a tooth stands, how thick the plastic is, the pen holes' size
const TOOTH = 0.22, THICK = 0.14, HOLE = 0.11
// rings: teeth on the inside, teeth on the outside
const RINGS = { '96 / 144': [96, 144], '105 / 150': [105, 150] }
const WHEELS = [24, 30, 32, 36, 40, 42, 45, 48, 52, 56, 60, 63, 64, 72]
// gel pens
const PENS = ['#1f4fd1', '#e0264f', '#0e9f6e', '#7a3fd0', '#f07c00', '#0aa5c4', '#d1349b', '#24262b']
const WIDTHS = { fine: 1.5, medium: 2.5, bold: 4 }
// ink is kept in chunks of this many segments - only the chunk being drawn into goes to the GPU again
const CHUNK = 8192
// the paper: SHEET units square, ruled in unit squares
const SHEET = 64
const TAU = Math.PI * 2
const gcd = (/** @type {number} */ a, /** @type {number} */ b) => (b ? gcd(b, a % b) : a)

/** A gear's outline at a pitch radius, turned so a tooth is centred on angle 0. @param {number} teeth @param {number} radius */
function toothed(teeth, radius) {
  const turn = -0.25 * TAU / teeth, c = Math.cos(turn), s = Math.sin(turn)
  return outline.gear({ radius: radius + TOOTH / 2, teeth, depth: TOOTH }).map(([x, y]) => [x * c - y * s, x * s + y * c])
}

/** A wheel's pen holes: a spiral in from near its teeth to the hub, where its size is moulded. @param {number} radius */
function holesOf(radius) {
  const out = []
  let a = 0
  for (let d = radius - 0.55; d >= 0.62; d -= 0.27) {
    out.push([d * Math.cos(a), d * Math.sin(a)])
    a += 0.85 / d
  }
  return out
}

// ---- the moulding on the plastic: scales, numbers, rims round the holes, its size - drawn on a
// canvas laid over the top face. Canvas y runs down, the toy's up: a point at angle a is at
// (cos a, -sin a). Marks are a deep tint of the plastic, as moulded detail reads through it
const MARK = 'rgba(8, 36, 80, 0.55)'
/** The ring's pin holes - to hold it to the paper - one at each numbered position. @param {number} inner */
const pinsOf = (inner) => {
  const every = inner / numbered(inner), r = pitch(inner) + TOOTH / 2 + 1.75
  return Array.from({ length: numbered(inner) }, (_, m) => {
    const a = (m * every + 0.5) * TAU / inner
    return [r * Math.cos(a), r * Math.sin(a)]
  })
}
const PIN = 0.17
/** How many numbered positions round a ring: 12 for 96 teeth, 15 for 105. @param {number} teeth */
const numbered = (teeth) => [12, 15, 16, 10, 8].find((m) => teeth % m === 0) ?? 1

/**
 * A square sheet `half` units each way from the middle, with marks painted on it, to lay over a
 * part's top face. `paint` draws in the part's units, round its middle; k is pixels a unit.
 * @param {number} half @param {(g: CanvasRenderingContext2D, k: number) => void} paint
 */
function engraving(half, paint) {
  const px = Math.min(2048, 2 ** Math.ceil(Math.log2(half * 2 * 80)))
  const c = document.createElement('canvas')
  c.width = c.height = px
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'))
  const k = px / (2 * half)
  g.translate(px / 2, px / 2)
  g.scale(k, k)
  paint(g, k)
  const geometry = new Geometry({ positions: [-half, -half, 0, half, -half, 0, half, half, 0, -half, half, 0], uvs: [0, 1, 1, 1, 1, 0, 0, 0], indices: [0, 1, 2, 0, 2, 3] })
  return { geometry, map: new Texture({ image: c, anisotropy: 8 }) }
}

/** A circle's outline. @param {CanvasRenderingContext2D} g @param {number} x @param {number} y @param {number} r */
function circle(g, x, y, r) {
  g.beginPath()
  g.arc(x, -y, r, 0, TAU)
  g.stroke()
}
/** A line out from the middle, at angle a from radius r0 to r1. @param {CanvasRenderingContext2D} g @param {number} a @param {number} r0 @param {number} r1 */
function spoke(g, a, r0, r1) {
  const c = Math.cos(a), s = -Math.sin(a)
  g.beginPath()
  g.moveTo(c * r0, s * r0)
  g.lineTo(c * r1, s * r1)
  g.stroke()
}
/**
 * Text centred r out at angle a, its top facing away from the middle.
 * @param {CanvasRenderingContext2D} g @param {number} k @param {string} text @param {number} r @param {number} a @param {number} size
 */
function label(g, k, text, r, a, size) {
  g.save()
  g.translate(r * Math.cos(a), -r * Math.sin(a))
  g.rotate(Math.PI / 2 - a)
  g.scale(1 / k, 1 / k)
  g.font = `600 ${size * k}px Saira, system-ui, sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text, 0, 0)
  g.restore()
}
/** The plastic darker towards its edges, as its thickness shows there, between radii r0 and r1. @param {CanvasRenderingContext2D} g @param {number} r0 @param {number} r1 */
function edges(g, r0, r1) {
  const shade = g.createRadialGradient(0, 0, Math.max(0, r0), 0, 0, r1), w = 0.45 / (r1 - r0)
  shade.addColorStop(0, r0 > 0 ? 'rgba(8, 36, 80, 0.3)' : 'rgba(8, 36, 80, 0)')
  shade.addColorStop(Math.min(0.49, w), 'rgba(8, 36, 80, 0)')
  shade.addColorStop(Math.max(0.51, 1 - w), 'rgba(8, 36, 80, 0)')
  shade.addColorStop(1, 'rgba(8, 36, 80, 0.3)')
  g.fillStyle = shade
  g.beginPath()
  g.arc(0, 0, r1, 0, TAU)
  if (r0 > 0) g.arc(0, 0, r0, 0, TAU, true)
  g.fill()
}

/** The ring's moulding: a scale along each toothed edge - a tick a tooth - numbered positions with a pin hole by each, and its tooth counts. @param {number} inner @param {number} outer */
function ringMarks(inner, outer) {
  const ri = pitch(inner) + TOOTH / 2, ro = pitch(outer) - TOOTH / 2, M = numbered(inner)
  return engraving(ro + TOOTH, (g, k) => {
    edges(g, ri, ro)
    g.strokeStyle = g.fillStyle = MARK
    g.lineWidth = 0.035
    circle(g, 0, 0, ri + 0.22)
    circle(g, 0, 0, ro - 0.22)
    // inside, the ring's teeth stand half a tooth round from angle 0; outside, on it
    for (let j = 0; j < inner; j++) spoke(g, (j + 0.5) * TAU / inner, ri + 0.22, ri + 0.22 + (j % (inner / M) === 0 ? 0.5 : 0.22))
    const outerEvery = outer / numbered(outer)
    for (let j = 0; j < outer; j++) spoke(g, j * TAU / outer, ro - 0.22, ro - 0.22 - (j % outerEvery === 0 ? 0.5 : 0.22))
    for (let m = 0; m < M; m++) label(g, k, String(m + 1), ri + 1.05, (m * inner / M + 0.5) * TAU / inner, 0.42)
    // the tooth counts, between the first two positions
    const a = (0.5 * inner / M + 0.5) * TAU / inner
    label(g, k, `${inner}`, ri + 0.95, a, 0.3)
    label(g, k, `${outer}`, ro - 0.95, a, 0.3)
    // the pin holes' moulded rims
    g.lineWidth = 0.07
    for (const [x, y] of pinsOf(inner)) circle(g, x, y, PIN + 0.035)
  })
}

/** A wheel's moulding: a line in from its teeth, a rim round each hole, a notch to line it up by and its size on the hub. @param {number} teeth @param {number[][]} holes */
function wheelMarks(teeth, holes) {
  const r = pitch(teeth)
  return engraving(r + TOOTH, (g, k) => {
    edges(g, 0, r - TOOTH / 2)
    g.strokeStyle = g.fillStyle = MARK
    g.lineWidth = 0.03
    circle(g, 0, 0, r - 0.3)
    // the holes' moulded rims
    g.lineWidth = 0.05
    for (const [x, y] of holes) circle(g, x, y, HOLE + 0.025)
    // the notch, on the line the pen holes' spiral starts from
    g.beginPath()
    g.moveTo(r - 0.3, 0)
    g.lineTo(r - 0.48, -0.09)
    g.lineTo(r - 0.48, 0.09)
    g.fill()
    label(g, k, String(teeth), 0, Math.PI / 2, 0.3)
  })
}

// A toy for drawing with gears. A toothed wheel rolls round a fixed ring - inside it, or round its
// outside - and a pen through one of the wheel's holes draws as it goes: hypotrochoids inside,
// epitrochoids outside. Because the teeth mesh, the pattern always closes, and the tooth counts say
// when: with g their greatest common divisor, it has ring / g points and closes after wheel / g laps.
// Drag round the ring to roll the wheel; tap a hole to move the pen there. Change pen, wheel or hole
// and draw again - layer on layer.
// The ink is Lines, kept in chunks of fixed size and grown with drawCount, so only the chunk being
// drawn into is sent again each frame.
export default function run({ canvas, gui, info }) {
  // the readout of points and laps, and the frame rate: hidden on a phone, where the drawing needs
  // the room (demos.css)
  info.classList.add('gears-info')
  document.getElementById('fps')?.classList.add('gears-fps')
  const settings = {
    ring: Object.keys(RINGS)[0], wheel: 52, hole: 4, rolling: 'inside', pen: PENS[0], width: 'medium', speed: 1,
  }
  let [inner, outer] = RINGS[settings.ring]
  const radius = () => pitch(settings.wheel)
  const ringTeeth = () => (settings.rolling === 'inside' ? inner : outer)
  // how far the pen can reach from the middle: what the camera has to show
  const reach = () => (settings.rolling === 'inside' ? pitch(outer) + TOOTH : pitch(outer) + 2 * radius() + TOOTH) + 0.6

  // overhead, a little in front, so the gears' thickness and shadows show. The orbit is off while
  // drawing - a drag rolls the wheel - and on once the layers are lifted to look round
  const view = new View({ canvas, background: '#2b2420', camera: { position: [0, 1, 0.12], target: [0, 0, 0], fov: 30, near: 2 },
    orbit: { enabled: false, pan: false, autoRotate: 0.12, minDistance: 8, maxDistance: 400, minPitch: 0.05 } })
  const scene = view.scene
  scene.environment = 'studio'
  scene.environmentIntensity = 0.7
  const sun = scene.add(new DirectionalLight({ direction: [-0.35, -1, -0.45], intensity: 1.3, castShadow: true }))
  sun.shadowBounds = { min: [-30, -1, -30], max: [30, 2, 30] }

  // the squared paper: the squares drawn in its shader, from where each pixel is on the desk, rather
  // than as a small tile repeated across it - a phone's GPU blurs a much-repeated tile away, and
  // streaks it. Each line is a pixel and a bit wide at any distance (fwidth: how far one pixel spans),
  // fading out as the squares get too small to show
  const paper = new Mesh({
    geometry: plane(SHEET),
    material: {
      color: '#fbfaf5', roughness: 0.95,
      shader: {
        uniforms: { uRule: [0.06, 0.2, 0.55], uRuleWidth: 1.25, uRuleStrength: 0.32 },
        fragment: `vec2 p = vWorldPosition.xz;
vec2 w = max(fwidth(p), vec2(1e-5));
vec2 d = abs(fract(p - 0.5) - 0.5) / w;
float line = clamp(uRuleWidth * 0.5 + 0.5 - min(d.x, d.y), 0.0, 1.0);
float shown = smoothstep(3.0, 8.0, 1.0 / max(w.x, w.y));
base.rgb = mix(base.rgb, uRule, line * shown * uRuleStrength);`,
      },
    },
    receiveShadow: true,
  })

  // everything drawn with lies flat on the paper: the toy's own x, y are the paper's, z up off it.
  // The desk is a frame round the paper, not under it: two surfaces a hair apart are more than many
  // phones' depth buffers can tell apart from this far back
  const desk = scene.add(new Group())
  desk.add(new Mesh({ geometry: extrude({ shape: outline.rect(400), holes: [outline.rect(SHEET)], depth: 0.02, axis: 'y' }), material: { color: '#4a3a30', roughness: 0.7 }, position: [0, -0.011, 0], receiveShadow: true }))
  desk.add(paper)
  const toy = desk.add(new Group({ rotation: [-Math.PI / 2, 0, 0] }))
  /** A point on the desk, in the toy's x, y. @param {{ x: number, z: number }} p */
  const onToy = (p) => [p.x, -p.z]

  // the plastic: glassy, so the paper and the ink show through it tinted, with a glossy coat
  const plastic = (/** @type {string} */ color) => ({ color, transmission: 0.5, roughness: 0.12, clearcoat: 0.6, clearcoatRoughness: 0.08, depthWrite: false })
  // the moulding lies a hair over the plastic's top face, drawn after it
  const TOP = 0.01 + THICK + 0.003
  /** A part's moulding, as a mesh over its top face. @param {{ geometry: Geometry, map: Texture }} marks */
  const moulding = ({ geometry, map }) => new Mesh({ geometry, material: { map, transparent: true, depthWrite: false, unlit: true }, position: [0, 0, TOP], pickable: false, renderOrder: 1 })

  // the ring: a band with teeth round both edges - its hole shaped as a gear makes the teeth inside -
  // pinned to the paper through holes at its numbered positions
  /** @type {Group | null} */
  let ring = null
  const buildRing = () => {
    if (ring) toy.remove(ring)
    ring = toy.add(new Group())
    ring.add(new Mesh({
      geometry: extrude({
        shape: toothed(outer, pitch(outer)),
        holes: [toothed(inner, pitch(inner)), ...pinsOf(inner).map(([x, y]) => outline.circle({ radius: PIN, center: [x, y], segments: 20 }))],
        depth: THICK,
      }),
      material: plastic('#2b7fd4'), position: [0, 0, THICK / 2 + 0.01], castShadow: true, pickable: false,
    }))
    ring.add(moulding(ringMarks(inner, outer)))
  }

  // the wheel turns on its own frame: the plastic, its moulding, and the pen standing in the chosen hole
  const wheel = toy.add(new Group())
  /** @type {Map<number, { geometry: Geometry, marks: { geometry: Geometry, map: Texture } }>} */
  const wheels = new Map()
  const body = wheel.add(new Mesh({ geometry: new Geometry({ positions: [0, 0, 0, 0, 0, 0, 0, 0, 0] }), material: plastic('#fff'), position: [0, 0, THICK / 2 + 0.01], castShadow: true }))
  const marks = wheel.add(moulding({ geometry: new Geometry({ positions: [0, 0, 0, 0, 0, 0, 0, 0, 0] }), map: new Texture({ image: document.createElement('canvas') }) }))
  const pen = wheel.add(new Mesh({ geometry: cylinder({ radius: 0.16, height: 1.4, segments: 24 }), material: { color: settings.pen, roughness: 0.35 }, rotation: [Math.PI / 2, 0, 0], castShadow: true, pickable: false }))
  let holes = holesOf(radius())
  const buildWheel = () => {
    const n = settings.wheel, r = radius()
    holes = holesOf(r)
    if (!wheels.has(n)) {
      wheels.set(n, {
        geometry: extrude({ shape: toothed(n, r), holes: holes.map(([x, y]) => outline.circle({ radius: HOLE, center: [x, y], segments: 16 })), depth: THICK }),
        marks: wheelMarks(n, holes),
      })
    }
    const made = /** @type {{ geometry: Geometry, marks: { geometry: Geometry, map: Texture } }} */ (wheels.get(n))
    body.geometry = made.geometry
    marks.geometry = made.marks.geometry
    marks.material.map = made.marks.map
    // a hue for each size, as the plastic sets come
    body.material.color.set(`hsl(${(WHEELS.indexOf(n) * 47) % 360}, 80%, 50%)`)
    settings.hole = Math.min(settings.hole, holes.length)
    holeControl?.input && (holeControl.input.max = String(holes.length))
  }

  // where things are: theta is the angle round the ring to where the wheel meets it
  let theta = 0
  const spinOf = (/** @type {number} */ angle) => {
    const r = radius(), R = pitch(ringTeeth())
    // rolling inside, the wheel turns back as it goes round; outside, it turns on with it - and is
    // set down a half tooth round, so its gap meets the ring's tooth
    return settings.rolling === 'inside' ? -(R - r) / r * angle : (R + r) / r * angle + Math.PI - Math.PI / settings.wheel
  }
  const centreOf = (/** @type {number} */ angle) => {
    const r = radius(), R = pitch(ringTeeth()), d = settings.rolling === 'inside' ? R - r : R + r
    return [d * Math.cos(angle), d * Math.sin(angle)]
  }
  /** Where the pen is at an angle round the ring. @param {number} angle */
  const penAt = (angle) => {
    const [cx, cy] = centreOf(angle), spin = spinOf(angle), [hx, hy] = holes[settings.hole - 1]
    const c = Math.cos(spin), s = Math.sin(spin)
    return [cx + hx * c - hy * s, cy + hx * s + hy * c]
  }
  const place = () => {
    const [cx, cy] = centreOf(theta), [hx, hy] = holes[settings.hole - 1]
    wheel.position.set(cx, cy, 0)
    wheel.rotation.set(0, 0, spinOf(theta))
    pen.position.set(hx, hy, 0.7)
  }

  // ---- the ink: a layer for each go with a pen, each in chunks of CHUNK segments, in a group of its
  // own to lift off the paper
  /** @typedef {{ group: Group, chunks: Lines[], used: number, lift: number, outside: boolean }} Layer */
  /** @type {Layer[]} */
  const layers = []
  /** @type {Layer | null} */
  let layer = null
  /** @type {Set<Lines>} */
  const dirty = new Set()
  const ink = toy.add(new Group({ position: [0, 0, 0.012] }))
  const chunk = (/** @type {Group} */ group) => group.add(new Lines({
    geometry: Object.assign(new Geometry({ positions: new Float32Array(CHUNK * 6) }), { drawCount: 0 }),
    material: { color: settings.pen, width: WIDTHS[settings.width], opacity: 0.88 }, pickable: false,
    // ink and plastic are both see-through, which are drawn furthest first - and from a camera
    // tilted a little, a wheel at the top of the ring is further than the ink. So ink goes first
    // always, writing its depth: on the paper the plastic above still covers it, and lifted over
    // the gears it hides what is under its lines
    renderOrder: -1,
  }))
  /** One stroke of ink from a to b. @param {number[]} a @param {number[]} b */
  const stroke = (a, b) => {
    if (!layer) {
      const group = ink.add(new Group())
      layers.push(layer = { group, chunks: [chunk(group)], used: 0, lift: 0, outside: settings.rolling === 'outside' })
    }
    if (layer.used === CHUNK) {
      layer.chunks.push(chunk(layer.group))
      layer.used = 0
    }
    const lines = layer.chunks[layer.chunks.length - 1], p = lines.geometry.positions, i = layer.used * 6
    p[i] = a[0], p[i + 1] = a[1], p[i + 2] = 0
    p[i + 3] = b[0], p[i + 4] = b[1], p[i + 5] = 0
    lines.geometry.drawCount = ++layer.used * 2
    dirty.add(lines)
  }
  // a new pen, wheel, hole or anything else starts a new layer with the next stroke
  const lifted = () => { layer = null }
  const undo = () => {
    const last = layers.pop()
    if (last) ink.remove(last.group)
    layer = null
    show()
  }
  const clear = () => {
    while (layers.length) undo()
    auto = 0
    show()
  }

  // ---- rolling: on round the ring, inking in short steps so the curve stays smooth
  let drawn = 0
  /** @param {number} by radians round the ring, either way */
  const roll = (by) => {
    const r = radius(), R = pitch(ringTeeth()), d = settings.rolling === 'inside' ? R - r : R + r
    // the pen's speed against theta's, at most: the wheel's centre going round, plus the hole round it
    const fast = d + Math.hypot(...holes[settings.hole - 1]) * d / r
    const steps = Math.max(1, Math.ceil(Math.abs(by) * fast / 0.06))
    let from = penAt(theta)
    for (let i = 0; i < steps; i++) {
      theta += by / steps
      const to = penAt(theta)
      stroke(from, to)
      from = to
    }
    drawn += Math.abs(by)
    place()
  }
  // the pattern's numbers: points, and laps round the ring until it closes
  const shape = () => {
    const g = gcd(ringTeeth(), settings.wheel)
    return { points: ringTeeth() / g, laps: settings.wheel / g }
  }

  // drag round the ring - anywhere on the paper - and the wheel follows the pointer's angle
  let was = /** @type {number | null} */ (null)
  desk.onDrag = (drag) => {
    if (drag.phase === 'end' || !drag.point) {
      was = null
      return
    }
    const [x, y] = onToy(drag.point)
    // too near the middle, the angle swings wildly
    if (Math.hypot(x, y) < 1.5) return void (was = null)
    const now = Math.atan2(y, x)
    if (was !== null) {
      auto = 0
      roll(Math.atan2(Math.sin(now - was), Math.cos(now - was)))
    }
    was = now
  }
  const rolling = desk.onDrag
  // tap a hole to put the pen in it
  body.onClick = (hit) => {
    if (exploded) return
    const [x, y] = onToy(hit.point), [cx, cy] = centreOf(theta), spin = -spinOf(theta)
    const lx = (x - cx) * Math.cos(spin) - (y - cy) * Math.sin(spin), ly = (x - cx) * Math.sin(spin) + (y - cy) * Math.cos(spin)
    let best = 0
    holes.forEach(([hx, hy], i) => { if (Math.hypot(hx - lx, hy - ly) < Math.hypot(holes[best][0] - lx, holes[best][1] - ly)) best = i })
    settings.hole = best + 1
    gui.updateDisplay()
    changed()
  }

  // ---- drawing by itself: once round the whole pattern, at speed laps a second
  let auto = 0
  const draw = () => {
    auto = auto ? 0 : shape().laps * TAU
    drawn = 0
    show()
  }

  // ---- the camera, as yaw and pitch round its target, how far off and the target's height. Drawing,
  // it stands overhead, back far enough for the pen's reach across the narrower of the canvas's
  // width and height. Exploded, the layers rise off the paper, a gap apart, and it swings down to
  // see the stack from the side - then the orbit is the visitor's, turning slowly by itself
  /** @typedef {{ yaw: number, pitch: number, distance: number, y: number }} Pose */
  const controls = /** @type {import('phoria2').OrbitControl} */ (view.controls)
  const fit = (/** @type {number} */ size) => size / Math.tan(15 * Math.PI / 180) / Math.min(1, canvas.clientWidth / (canvas.clientHeight || 1))
  const gap = () => reach() * 0.13
  /** @returns {Pose} */
  const flat = () => ({ yaw: 0, pitch: Math.atan2(1, 0.12), distance: fit(reach() * 1.08) * Math.hypot(1, 0.12), y: 0 })
  /** @returns {Pose} */
  const stacked = () => {
    const outside = layers.filter((l) => l.outside).length
    const stack = (Math.max(outside, layers.length - outside) + 1) * gap()
    return { yaw: -0.55, pitch: 0.38, distance: fit(reach() * 0.9 + stack * 0.35), y: stack * 0.5 }
  }
  /** @returns {Pose} */
  const pose = () => ({ ...controls.spherical, y: view.camera.target[1] })
  const setPose = (/** @type {Pose} */ p) => {
    view.camera.target.set(0, p.y, 0)
    controls.spherical = p
  }
  setPose(flat())

  let exploded = false
  // how far lifted the layers are, 0 - 1, and how far the camera is from where it set off to its new pose
  let rise = 0, swing = 1
  let from = pose()
  const smooth = (/** @type {number} */ x) => x * x * (3 - 2 * x)
  const explode = () => {
    exploded = !exploded
    from = pose()
    swing = 0
    controls.enabled = false
    controls.cancel()
    // exploded, a drag looks round rather than drawing
    desk.onDrag = exploded ? null : rolling
    show()
  }

  const changed = () => {
    lifted()
    place()
    show()
  }

  // ---- the bar along the bottom, in two rows - what a phone needs at hand: the pens and the wheel,
  // then drawing, which way round the ring, the pen's hole, exploding, undo and a clean sheet.
  // The finer settings stay in the panel
  const bar = document.createElement('div')
  bar.className = 'hud paint-bar gears-bar'
  bar.innerHTML = `
    ${PENS.map((c) => `<button type="button" class="paint-swatch" data-pen="${c}" aria-label="pen ${c}"><span style="background: ${c}"></span></button>`).join('')}
    <span class="paint-gap"></span>
    <button type="button" class="gears-step" data-wheel="-1" title="A smaller wheel" aria-label="A smaller wheel">‹</button>
    <span class="gears-wheel"></span>
    <button type="button" class="gears-step" data-wheel="1" title="A bigger wheel" aria-label="A bigger wheel">›</button>
    <span class="gears-break"></span>
    <button type="button" data-draw title="Draw the whole pattern">Draw</button>
    <button type="button" data-roll title="Roll the wheel inside the ring or round its outside">Inside</button>
    <button type="button" data-hole title="Move the pen to the next hole along">Hole</button>
    <button type="button" data-explode title="Lift the layers off the paper to look round them">Explode</button>
    <button type="button" class="paint-clean" data-undo title="Take off the last layer" aria-label="Take off the last layer">↶</button>
    <button type="button" class="paint-clean" data-clear title="A clean sheet" aria-label="A clean sheet">⟲</button>`
  document.body.append(bar)
  bar.addEventListener('click', (event) => {
    const button = /** @type {HTMLButtonElement | null} */ (/** @type {HTMLElement} */ (event.target).closest('button'))
    if (!button) return
    const { dataset } = button
    if (dataset.pen) {
      settings.pen = dataset.pen
      pen.material.color.set(settings.pen)
      changed()
    } else if (dataset.wheel) {
      const i = WHEELS.indexOf(settings.wheel) + Number(dataset.wheel)
      if (i < 0 || i >= WHEELS.length) return
      settings.wheel = WHEELS[i]
      buildWheel()
      changed()
    } else if ('roll' in dataset) {
      settings.rolling = settings.rolling === 'inside' ? 'outside' : 'inside'
      changed()
    } else if ('hole' in dataset) {
      // the next hole along the spiral, back to the first after the last
      settings.hole = settings.hole % holes.length + 1
      gui.updateDisplay()
      changed()
    } else if ('draw' in dataset) draw()
    else if ('explode' in dataset) explode()
    else if ('undo' in dataset) undo()
    else if ('clear' in dataset) clear()
  })

  /** What the pattern will be, and how far through it the drawing is. */
  function show() {
    const { points, laps } = shape()
    info.textContent = `${settings.wheel} teeth ${settings.rolling} ${ringTeeth()}: ${points} points, closes after ${laps} lap${laps === 1 ? '' : 's'}`
      + (auto ? ` · drawing lap ${Math.min(laps, Math.floor(drawn / TAU) + 1)} of ${laps}` : '')
      + (exploded ? ' · drag to look round' : '')
    for (const b of bar.querySelectorAll('[data-pen]')) b.classList.toggle('now', /** @type {HTMLElement} */ (b).dataset.pen === settings.pen)
    const go = /** @type {HTMLElement} */ (bar.querySelector('[data-draw]'))
    go.textContent = auto ? 'Stop' : 'Draw'
    go.classList.toggle('now', !!auto)
    const toggle = /** @type {HTMLElement} */ (bar.querySelector('[data-explode]'))
    toggle.textContent = exploded ? 'Flatten' : 'Explode'
    toggle.classList.toggle('now', exploded)
    const roll = /** @type {HTMLElement} */ (bar.querySelector('[data-roll]'))
    roll.textContent = settings.rolling === 'inside' ? 'Inside' : 'Outside'
    const hole = /** @type {HTMLElement} */ (bar.querySelector('[data-hole]'))
    hole.textContent = `Hole ${settings.hole}`
    const size = /** @type {HTMLElement} */ (bar.querySelector('.gears-wheel'))
    size.textContent = `${settings.wheel} teeth`
    const i = WHEELS.indexOf(settings.wheel)
    const smaller = /** @type {HTMLButtonElement} */ (bar.querySelector('[data-wheel="-1"]'))
    const bigger = /** @type {HTMLButtonElement} */ (bar.querySelector('[data-wheel="1"]'))
    smaller.disabled = i === 0
    bigger.disabled = i === WHEELS.length - 1
  }

  // ---- the panel: the finer settings
  gui.add(settings, 'ring', Object.keys(RINGS)).onChange((v) => {
    ;[inner, outer] = RINGS[v]
    buildRing()
    changed()
  })
  const holeControl = gui.add(settings, 'hole', 1, holesOf(radius()).length, 1).name('pen hole').onChange(changed)
  gui.add(settings, 'width', Object.keys(WIDTHS)).name('pen').onChange(changed)
  gui.add(settings, 'speed', 0.05, 2, 0.05).name('laps a second')
  gui.add({ save: () => {
    // the drawing alone: the gears off the paper for the picture
    wheel.visible = false
    if (ring) ring.visible = false
    view.toImage().then((blob) => download(blob, 'gears.png')).finally(() => {
      wheel.visible = true
      if (ring) ring.visible = true
    })
  } }, 'save').name('save drawing as PNG')

  buildRing()
  buildWheel()
  place()
  // a clean sheet, the first pattern drawing itself
  changed()
  draw()

  return view.start((dt) => {
    if (auto) {
      const by = Math.min(auto, settings.speed * TAU * dt)
      roll(by)
      auto -= by
      if (auto <= 1e-9) auto = 0
      show()
    }
    for (const lines of dirty) lines.geometry.needsUpdate()
    dirty.clear()

    // the layers rise and settle, each a gap above the one under it - and flat on the paper, each a
    // hair above the last, so where their lines cross the newer is on top rather than fighting it.
    // The hairs stop short of the plastic's top, which still covers them
    rise = Math.min(1, Math.max(0, rise + (exploded ? dt : -dt) / 1.2))
    const up = smooth(rise) * gap()
    // drawn inside the ring and round its outside, the patterns never meet: each has a stack of its
    // own, from the paper up
    const counts = [0, 0]
    for (const l of layers) {
      const i = counts[+l.outside]++
      const z = up * (i + 1) + Math.min(i, 30) * 0.003
      if (l.lift !== z) l.group.position.set(0, 0, l.lift = z)
    }

    // the camera swings between overhead and the side of the stack - and drawing, it eases to the
    // pen's reach as that changes
    if (swing < 1) {
      swing = Math.min(1, swing + dt / 1.2)
      const to = exploded ? stacked() : flat(), t = smooth(swing)
      const yaw = from.yaw + Math.atan2(Math.sin(to.yaw - from.yaw), Math.cos(to.yaw - from.yaw)) * t
      setPose({ yaw, pitch: from.pitch + (to.pitch - from.pitch) * t, distance: from.distance + (to.distance - from.distance) * t, y: from.y + (to.y - from.y) * t })
      if (swing === 1 && exploded) controls.enabled = true
    } else if (!exploded) {
      const want = flat(), now = pose()
      if (Math.abs(want.distance - now.distance) > 0.01) setPose({ ...want, distance: now.distance + (want.distance - now.distance) * Math.min(1, dt * 6) })
    }
  })
}
