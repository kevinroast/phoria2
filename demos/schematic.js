import { DirectionalLight, Geometry, Group, HemisphereLight, Label, Lines, Material, Mesh, OrthographicCamera, View, box, curve, cylinder, edges, extrude, lathe } from 'phoria2'

// An exploded parts schematic of a generic striker-fired pistol, drawn as a workshop poster: grey
// parts with inked edges and an inked silhouette on grid paper, every part numbered with a legend.
// Each part is built where it sits in the assembled pistol; its place in the exploded layout is taken
// from where the poster puts it, so Explode and Assemble move every part between the two, one after
// another. Hover a part or a legend entry to find the other. The shapes are illustrative - recognisable
// outlines, not working dimensions. Units are centimetres, the muzzle towards -x.

const INK = '#26282c'
const STEEL = '#b2b6bb', POLYMER = '#8e9298', SPRING = '#c4c7cb', ACCENT = '#eaa23a'
const TAU = Math.PI * 2

// ---- geometry helpers

/** A flat part as seen from the side, `depth` thick, centred on z. @param {number[][]} points @param {number} depth */
const plate = (points, depth, holes = []) => extrude({ shape: points, holes, depth, axis: 'z' })
/** A circle of points, for holes. @param {number} x @param {number} y @param {number} r */
const ring = (x, y, r, n = 20) => Array.from({ length: n }, (_, i) => [x + r * Math.cos((i / n) * TAU), y + r * Math.sin((i / n) * TAU)])
/** A rod along an axis. @param {number} radius @param {number} length @param {'x' | 'y' | 'z'} axis */
const rod = (radius, length, axis) => cylinder({ radius, height: length, segments: 18, axis })
/** A hollow tube along an axis, from its inner and outer radius. @param {number} inner @param {number} outer @param {number} length @param {'x' | 'y' | 'z'} axis */
const sleeve = (inner, outer, length, axis) => lathe({ points: [[inner, -length / 2], [outer, -length / 2], [outer, length / 2], [inner, length / 2], [inner, -length / 2]], segments: 24, axis })
/**
 * A coil spring along an axis, centred: `radius` across (and `across` the other way, for a flat
 * magazine spring), `turns` coils of round wire.
 * @param {{ radius: number, length: number, turns: number, wire: number, axis?: 'x' | 'y', across?: number }} o
 */
function coil({ radius, length, turns, wire, axis = 'x', across = radius }) {
  const steps = Math.round(turns * 16)
  const points = Array.from({ length: steps + 1 }, (_, i) => {
    const a = (i / 16) * TAU, along = -length / 2 + (length * i) / steps
    return axis === 'x' ? [along, radius * Math.cos(a), across * Math.sin(a)] : [radius * Math.cos(a), along, across * Math.sin(a)]
  })
  return curve(points).tube({ radius: wire, sides: 6, segments: steps * 2 })
}

// ---- the parts, as the poster numbers them. Each piece: [geometry, position, options] - options can
// say how sharp a turn its edges need to be inked (`angle`; 0 for none, as for springs). `mount` is the
// part's own frame in the pistol - the magazine's parts lean with the grip. `at` is where the poster
// puts the part's middle, in its pixels; `turn` how much it turns from its mount when exploded.

const BORE = 1.05
const MAG = { position: [2.78, -1.0, 0], rotation: [0, 0, 0.297] }

const SLIDE_SECTION = [[-1.27, 0], [1.27, 0], [1.27, 2.45], [0.85, 2.9], [-0.85, 2.9], [-1.27, 2.45]]
/** Points round an arc, angles in degrees. @param {number} cx @param {number} cy @param {number} r @param {number} from @param {number} to */
const arc = (cx, cy, r, from, to, n = 10) => Array.from({ length: n + 1 }, (_, i) => {
  const a = ((from + ((to - from) * i) / n) * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
})
// the receiver from the side: dust cover, a squared-off trigger guard, the grip raked back about 17
// degrees, and the beavertail over the web of the hand
const FRAME = [
  ...arc(-8.45, -0.27, 0.25, 90, 180, 4), ...arc(-8.45, -1.02, 0.25, 180, 270, 4), [-4.6, -1.27],
  ...arc(-3.3, -2.55, 1.25, 165, 270), [0.4, -3.8], ...arc(0.4, -3.3, 0.5, 270, 360, 5),
  [2.85, -10.0], ...arc(3.15, -10.1, 0.3, 180, 270, 4), [7.95, -10.4], ...arc(7.95, -10.1, 0.3, 270, 360, 4),
  [5.85, -2.6], [6.2, -1.85], [7.2, -1.38], [8.5, -1.08], [9.3, -0.78], ...arc(9.2, -0.4, 0.38, 290, 400, 5), [9.0, -0.02],
]
const GUARD = [...arc(-3.3, -2.42, 0.92, 90, 270), [0.05, -3.34], [0.45, -2.95], [0.45, -1.75], [0.2, -1.5]]
// the grip's checkered panel, a convex outline on the near side
const GRIP = [[1.67, -4.4], [5.66, -3.4], [7.74, -9.75], [3.22, -9.75]]

/** @type {{ n: string, name: string, color: string, at: [number, number], turn?: number, mount?: { position: number[], rotation: number[] }, pieces: [any, number[], { angle?: number, rotation?: number[] }?][], ink?: number[] }[]} */
const PARTS = [
  { n: '1', name: 'Slide', color: STEEL, at: [230, 80], pieces: [
    [extrude({ shape: SLIDE_SECTION, holes: [ring(0, BORE, 0.66)], depth: 18.6, axis: 'x' }), [0, 0, 0]],
  ] },
  { n: '2', name: 'Barrel', color: STEEL, at: [165, 165], pieces: [
    [sleeve(0.45, 0.62, 10.6, 'x'), [-3.95, BORE, 0], { angle: 50 }],
    [box({ width: 2.7, height: 1.3, depth: 1.25 }), [2.25, 1.15, 0]],
    [plate([[1.0, 0.5], [3.4, 0.5], [3.4, -0.25], [2.9, -0.55], [2.3, -0.55], [1.6, 0.05]], 0.8), [0, 0, 0]],
  ] },
  { n: '3', name: 'Recoil spring assembly', color: SPRING, at: [140, 215], pieces: [
    [rod(0.16, 9.3, 'x'), [-3.95, 0.2, 0], { angle: 50 }],
    [coil({ radius: 0.38, length: 8.3, turns: 17, wire: 0.05 }), [-4.25, 0.2, 0], { angle: 0 }],
    [rod(0.5, 0.18, 'x'), [0.5, 0.2, 0], { angle: 50 }],
  ] },
  { n: '4', name: 'Firing pin', color: STEEL, at: [630, 205], pieces: [
    [rod(0.09, 5.0, 'x'), [6.1, BORE, 0], { angle: 50 }],
    [box({ width: 0.5, height: 0.45, depth: 0.2 }), [8.1, BORE - 0.25, 0]],
    [rod(0.17, 0.3, 'x'), [8.75, BORE, 0], { angle: 50 }],
  ] },
  { n: '5', name: 'Spacer sleeve', color: STEEL, at: [520, 185], pieces: [[sleeve(0.12, 0.22, 1.8, 'x'), [7.2, BORE, 0], { angle: 50 }]] },
  { n: '6', name: 'Firing pin spring', color: SPRING, at: [620, 148], pieces: [[coil({ radius: 0.2, length: 2.3, turns: 9, wire: 0.03 }), [5.75, BORE, 0], { angle: 0 }]] },
  { n: '7', name: 'Spring cups (2)', color: STEEL, at: [515, 130], pieces: [
    [sleeve(0.1, 0.2, 0.25, 'x'), [4.5, BORE, 0], { angle: 50 }],
    [sleeve(0.1, 0.2, 0.25, 'x'), [6.95, BORE, 0], { angle: 50 }],
  ] },
  { n: '8', name: 'Firing pin safety', color: STEEL, at: [288, 185], pieces: [
    [rod(0.2, 0.9, 'y'), [3.25, 1.95, 0], { angle: 50 }],
    [box({ width: 0.3, height: 0.2, depth: 0.3 }), [3.25, 1.45, 0]],
  ] },
  { n: '9', name: 'Firing pin safety spring', color: SPRING, at: [283, 152], pieces: [[coil({ radius: 0.11, length: 0.45, turns: 5, wire: 0.025, axis: 'y' }), [3.25, 2.62, 0], { angle: 0 }]] },
  { n: '10', name: 'Extractor', color: STEEL, at: [500, 85], pieces: [
    [plate([[3.2, 1.2], [5.3, 1.2], [5.3, 1.75], [4.0, 1.75], [4.0, 2.15], [3.2, 2.15]], 0.18), [0, 0, -1.18]],
    [box({ width: 0.2, height: 0.3, depth: 0.35 }), [3.25, 1.4, -1.0]],
  ] },
  { n: '11', name: 'Extractor plunger', color: STEEL, at: [575, 95], pieces: [
    [rod(0.07, 3.6, 'x'), [6.4, 1.75, -0.75], { angle: 50 }],
    [rod(0.14, 0.15, 'x'), [4.6, 1.75, -0.75], { angle: 50 }],
  ] },
  { n: '12', name: 'Extractor plunger spring', color: SPRING, at: [648, 103], pieces: [[coil({ radius: 0.12, length: 1.2, turns: 7, wire: 0.025 }), [7.2, 1.75, -0.75], { angle: 0 }]] },
  { n: '13', name: 'Spring-loaded bearing', color: STEEL, at: [690, 118], pieces: [
    [rod(0.1, 0.6, 'x'), [8.5, 1.75, -0.75], { angle: 50 }],
    [rod(0.16, 0.12, 'x'), [8.85, 1.75, -0.75], { angle: 50 }],
  ] },
  { n: '14', name: 'Slide cover plate', color: STEEL, at: [395, 182], pieces: [[box({ width: 0.3, height: 1.7, depth: 1.55 }), [9.45, 1.2, 0]]],
    ink: [9.61, 0.7, -0.6, 9.61, 0.7, 0.6, 9.61, 1.0, -0.6, 9.61, 1.0, 0.6, 9.61, 1.3, -0.6, 9.61, 1.3, 0.6] },
  { n: '15', name: 'Rear sight', color: STEEL, at: [432, 62], pieces: [
    [extrude({ shape: [[-0.7, 0], [0.7, 0], [0.55, 0.5], [0.16, 0.5], [0.16, 0.28], [-0.16, 0.28], [-0.16, 0.5], [-0.55, 0.5]], depth: 0.5, axis: 'x' }), [8.2, 2.9, 0]],
  ] },
  { n: '16', name: 'Receiver', color: POLYMER, at: [240, 560], pieces: [[plate(FRAME, 2.75, [GUARD]), [0, 0, 0]]] },
  { n: '17', name: 'Magazine catch spring', color: SPRING, at: [472, 545], pieces: [[rod(0.035, 4.0, 'y'), [1.75, -6.2, 0.4], { angle: 0, rotation: [0, 0, 0.28] }]] },
  { n: '18', name: 'Magazine catch', color: POLYMER, at: [465, 487], pieces: [[plate([[0.55, -2.15], [1.25, -2.15], [1.35, -3.05], [0.55, -3.05]], 3.1), [0, 0, 0]]],
    ink: [0.65, -2.35, 1.56, 1.25, -2.35, 1.56, 0.65, -2.6, 1.56, 1.28, -2.6, 1.56, 0.65, -2.85, 1.56, 1.3, -2.85, 1.56] },
  { n: '19', name: 'Slide lock spring', color: SPRING, at: [212, 438], pieces: [[coil({ radius: 0.1, length: 0.5, turns: 5, wire: 0.025, axis: 'y' }), [-2.4, -0.95, 0], { angle: 0 }]] },
  { n: '20', name: 'Slide lock', color: STEEL, at: [112, 540], pieces: [
    [box({ width: 0.5, height: 0.35, depth: 3.1 }), [-3.0, -0.55, 0]],
    [box({ width: 0.25, height: 0.5, depth: 0.15 }), [-2.85, -0.75, 1.5]],
  ] },
  { n: '21', name: 'Locking block', color: STEEL, at: [240, 385], pieces: [
    [plate([[-1.4, -0.05], [1.2, -0.05], [1.2, -0.7], [0.6, -1.3], [-0.6, -1.3], [-1.4, -0.6]], 1.6, [ring(-0.9, -0.8, 0.12, 12)]), [0, 0, 0]],
  ] },
  { n: '22', name: 'Trigger mechanism housing with ejector', color: STEEL, at: [355, 360], pieces: [
    [plate([[5.4, -0.1], [8.7, -0.1], [8.9, -0.5], [7.6, -1.15], [6.2, -1.6], [5.4, -1.5], [5.1, -0.9]], 1.3, [ring(6.9, -0.75, 0.12, 12)]), [0, 0, 0]],
    [plate([[6.0, -0.1], [7.0, -0.1], [7.0, 0.5], [6.6, 0.5]], 0.15), [0, 0, -0.4]],
  ] },
  { n: '23', name: 'Connector', color: STEEL, at: [452, 318], pieces: [
    [plate([[7.3, -0.3], [8.3, -0.3], [8.35, -1.0], [8.2, -1.05], [8.15, -0.5], [7.3, -0.5]], 0.5), [0, 0, 0.6]],
  ] },
  { n: '24', name: 'Trigger spring', color: SPRING, at: [373, 292], pieces: [[coil({ radius: 0.12, length: 1.0, turns: 8, wire: 0.025 }), [5.9, -1.2, -0.3], { angle: 0 }]] },
  { n: '25', name: 'Trigger with trigger bar', color: STEEL, at: [300, 265], pieces: [
    [plate([[-1.2, -1.0], [-0.7, -1.0], [-0.85, -1.8], [-1.1, -2.6], [-1.5, -3.02], [-1.82, -2.92], [-1.6, -2.3], [-1.5, -1.6]], 0.6), [0, 0, 0]],
    [plate([[-1.1, -0.75], [6.4, -0.75], [6.6, -0.3], [6.0, -0.15], [-0.4, -0.5], [-1.1, -0.5]], 0.18), [0, 0, 0.55]],
  ] },
  { n: '26', name: 'Slide stop lever', color: STEEL, at: [280, 440], pieces: [
    [plate([[-0.4, -0.4], [2.4, -0.4], [2.4, -0.75], [0.6, -0.9], [-0.4, -0.75]], 0.12), [0, 0, 1.45]],
    [box({ width: 0.7, height: 0.3, depth: 0.3 }), [0.15, -0.3, 1.5]],
  ] },
  { n: '27', name: 'Trigger pin', color: STEEL, at: [125, 567], pieces: [[rod(0.09, 3.0, 'z'), [-0.9, -0.8, 0], { angle: 50 }]] },
  { n: '28', name: 'Mechanism housing pin', color: STEEL, at: [420, 543], pieces: [[rod(0.09, 3.0, 'z'), [6.9, -0.75, 0], { angle: 50 }]] },
  { n: '29', name: 'Follower', color: POLYMER, at: [665, 400], mount: MAG, turn: -0.12, pieces: [
    [plate([[-1.3, -0.2], [0.4, -0.2], [1.3, -0.5], [1.3, -1.0], [-1.3, -1.0]], 1.8), [0, 0, 0]],
  ] },
  { n: '30', name: 'Magazine spring', color: SPRING, at: [720, 600], mount: MAG, turn: -0.12, pieces: [[coil({ radius: 1.15, across: 0.75, length: 8.2, turns: 7, wire: 0.045, axis: 'y' }), [0, -5.3, 0], { angle: 0 }]] },
  { n: '31', name: 'Magazine floorplate', color: POLYMER, at: [495, 740], mount: MAG, turn: -0.2, pieces: [[box({ width: 3.4, height: 0.4, depth: 2.5 }), [0, -10.1, 0]]] },
  { n: '32', name: 'Magazine tube', color: POLYMER, at: [590, 640], mount: MAG, turn: 0.05, pieces: [
    [plate([[-1.5, 0], [0.2, 0], [1.5, -0.6], [1.5, -9.9], [-1.5, -9.9]], 2.2), [0, 0, 0]],
  ] },
  { n: '33', name: 'Front sight', color: STEEL, at: [70, 18], pieces: [[box({ width: 0.4, height: 0.45, depth: 0.35 }), [-8.4, 3.12, 0]]] },
  { n: '33b', name: 'Front sight screw', color: STEEL, at: [70, 118], pieces: [[rod(0.09, 0.4, 'y'), [-8.4, 2.7, 0], { angle: 50 }]] },
]

// ---- drawn details: ink lines on a part's faces, in the part's own frame

/** Rear grip serrations down the near side of the slide. */
const serrations = () => Array.from({ length: 11 }, (_, i) => 5.7 + i * 0.32).flatMap((x) => [x, 0.35, 1.28, x, 2.3, 1.28])
/** The ejection port, on top of the slide. */
const port = () => {
  const y = 2.91, c = [[-1.2, -1.0], [2.6, -1.0], [2.6, 0.45], [-1.2, 0.45]]
  return c.flatMap((p, i) => [p[0], y, p[1], c[(i + 1) % 4][0], y, c[(i + 1) % 4][1]])
}
/**
 * Lines across a convex outline at an angle, `gap` apart - the grip's checkering.
 * @param {number[][]} poly @param {number} angle @param {number} gap @param {number} z
 */
function hatch(poly, angle, gap, z) {
  const d = [Math.cos(angle), Math.sin(angle)], nrm = [-d[1], d[0]]
  const offsets = poly.map((p) => p[0] * nrm[0] + p[1] * nrm[1])
  const out = []
  for (let o = Math.min(...offsets) + gap / 2; o < Math.max(...offsets); o += gap) {
    // clip the line { o * nrm + t * d } to the outline, edge by edge
    let lo = -1e3, hi = 1e3
    const base = [o * nrm[0], o * nrm[1]]
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length]
      const inward = [-(b[1] - a[1]), b[0] - a[0]]
      // which way is inside: towards the outline's middle
      const mid = poly.reduce((m, p) => [m[0] + p[0] / poly.length, m[1] + p[1] / poly.length], [0, 0])
      const sign = Math.sign((mid[0] - a[0]) * inward[0] + (mid[1] - a[1]) * inward[1])
      const num = ((base[0] - a[0]) * inward[0] + (base[1] - a[1]) * inward[1]) * sign
      const den = (d[0] * inward[0] + d[1] * inward[1]) * sign
      if (Math.abs(den) < 1e-9) { if (num < 0) { lo = 1; hi = 0 } continue }
      const t = -num / den
      if (den > 0) lo = Math.max(lo, t)
      else hi = Math.min(hi, t)
    }
    if (hi > lo) out.push(base[0] + d[0] * lo, base[1] + d[1] * lo, z, base[0] + d[0] * hi, base[1] + d[1] * hi, z)
  }
  return out
}
/** An outline as line segments. @param {number[][]} poly @param {number} z */
const loop = (poly, z) => poly.flatMap((p, i) => [p[0], p[1], z, poly[(i + 1) % poly.length][0], poly[(i + 1) % poly.length][1], z])
/** The magazine's witness holes, two columns of circles on its near side. */
const witness = () => [-0.2, 0.75].flatMap((x, col) => Array.from({ length: col ? 6 : 7 }, (_, i) => ring(x, -2.0 - i * 1.05 - col * 0.5, 0.17, 12)).flatMap((c) => loop(c, 1.11)))

/** @type {Record<string, number[]>} */
const DETAILS = {
  '1': [...serrations(), ...port()],
  '16': [...hatch(GRIP, Math.PI / 4, 0.3, 1.385), ...hatch(GRIP, -Math.PI / 4, 0.3, 1.385), ...loop(GRIP, 1.385), -7.6, -1.27, 1.385, -7.6, -0.75, 1.385, -6.4, -1.27, 1.385, -6.4, -0.75, 1.385],
  '32': witness(),
}

const smooth = (t) => t * t * (3 - 2 * t)

export default function run({ canvas, gui, info }) {
  canvas.style.display = 'none'
  void gui
  const poster = document.createElement('div')
  poster.className = 'gun-poster'
  poster.innerHTML = `
    <div class="gun-sheet">
      <div class="gun-view">
        <canvas></canvas>
        <div class="gun-controls">
          <button type="button" class="gun-toggle">Assemble</button>
          <label>Assembled <input type="range" min="0" max="1" step="0.001" value="1" aria-label="Exploded"> Exploded</label>
        </div>
      </div>
      <aside class="gun-legend">
        <h2>Parts Legend</h2>
        <ol>${PARTS.map((p, i) => `<li data-part="${i}"><b>${p.n}.</b> ${p.name}</li>`).join('')}</ol>
      </aside>
    </div>`
  document.body.append(poster)
  const viewCanvas = /** @type {HTMLCanvasElement} */ (poster.querySelector('canvas'))
  const toggle = /** @type {HTMLButtonElement} */ (poster.querySelector('.gun-toggle'))
  const slider = /** @type {HTMLInputElement} */ (poster.querySelector('input'))
  const entries = /** @type {HTMLElement[]} */ ([...poster.querySelectorAll('.gun-legend li')])

  // ---- the pistol, assembled: every part a group, its pieces in its mount, edges inked
  const camera = new OrthographicCamera({ position: [-13, 11, 60], target: [0, -2, 0], near: 1, far: 300 })
  const view = new View({
    // a poster, held still: no orbiting or zooming
    canvas: viewCanvas, camera, background: null, framing: 'both', orbit: false,
    tooltip: (hit) => {
      const p = PARTS[partOf(hit?.node) ?? -1]
      return p ? `${p.n}. ${p.name}` : null
    },
  })
  const { scene } = view
  scene.add(new HemisphereLight({ sky: '#ffffff', ground: '#5d6168', intensity: 1.05 }))
  scene.add(new DirectionalLight({ direction: [0.45, -0.7, -0.75], intensity: 1.15 }))
  // one inked silhouette round everything; the parts' own edges are inked lines
  const pistol = scene.add(new Group({ name: 'pistol', outline: { color: INK, width: 1.6 } }))

  const parts = PARTS.map((p, index) => {
    const part = pistol.add(new Group({ name: p.name, userData: { index } }))
    const mount = part.add(new Group(p.mount ?? {}))
    const material = new Material({ color: p.color, roughness: 0.85 })
    for (const [geometry, position, options = {}] of p.pieces) {
      const mesh = mount.add(new Mesh({ geometry, material, position, rotation: options.rotation ?? [0, 0, 0] }))
      const angle = options.angle ?? 30
      if (angle) mesh.add(new Lines({ geometry: edges(geometry, { angle }), material: { color: INK, width: 1.1 }, pickable: false }))
    }
    const drawn = [...(DETAILS[p.n] ?? []), ...(p.ink ?? [])]
    if (drawn.length) mount.add(new Lines({ geometry: new Geometry({ positions: drawn }), material: { color: INK, width: 0.9 }, pickable: false }))
    return { spec: p, part, mount, material, rest: [...(p.mount?.rotation ?? [0, 0, 0])], offset: [0, 0, 0] }
  })
  /** The part a node belongs to, by its index. @param {any} node @returns {number | null} */
  function partOf(node) {
    for (let n = node; n; n = n.parent) if (n.userData?.index !== undefined) return n.userData.index
    return null
  }

  // ---- the exploded layout, from the poster: its pixels mapped about the receiver's middle
  scene.updateWorldTree()
  const centres = parts.map(({ part }) => part.bounds.getCenter().toArray())
  const receiver = centres[PARTS.findIndex((p) => p.n === '16')]
  const ACROSS = 0.068, DOWN = 0.047
  for (const [i, p] of parts.entries()) {
    const target = [receiver[0] + (p.spec.at[0] - 240) * ACROSS, receiver[1] - (p.spec.at[1] - 560) * DOWN, 0]
    p.offset = target.map((v, k) => v - centres[i][k])
  }

  // the poster's numbers, each beside its part and moving with it
  const numbers = parts.map(({ part, spec }) => {
    const b = part.bounds
    return part.add(new Label({ text: spec.n, position: [b.min[0] - 0.15, b.max[1] + 0.15, b.max[2]], className: 'gun-num', overlap: 'show' }))
  })

  // ---- exploding: one value from assembled (0) to exploded (1); each part moves in its own slice of
  // it, the slide first, so they come apart and go back together one after another. The view frames
  // what is there at every step, so it zooms with the parts as they move
  let spread = 1, goal = 1
  const place = () => {
    for (const [i, p] of parts.entries()) {
      const start = (i / parts.length) * 0.55
      const e = smooth(Math.min(1, Math.max(0, (spread - start) / 0.45)))
      p.part.position = p.offset.map((v) => v * e)
      p.mount.rotation.z = p.rest[2] + (p.spec.turn ?? 0) * e
      // the magazine spring is squeezed into its tube when assembled
      if (p.spec.n === '30') p.mount.scale.y = 0.62 + 0.38 * e
      numbers[i].visible = e > 0.92
    }
    toggle.textContent = goal > 0.5 ? 'Assemble' : 'Explode'
    // a wider margin round the assembled pistol than round the parts, which fill the poster
    view.frame(pistol, { padding: 0.14 - 0.08 * spread })
  }
  place()

  toggle.addEventListener('click', () => {
    goal = goal > 0.5 ? 0 : 1
    place()
  })
  slider.addEventListener('input', () => {
    spread = goal = Number(slider.value)
    place()
  })

  // ---- a part and its legend entry light together
  let focused = -1
  /** @param {number} index -1 for none */
  const focus = (index) => {
    if (index === focused) return
    focused = index
    parts.forEach((p, i) => {
      p.material.color.set(i === index ? ACCENT : p.spec.color)
      numbers[i].className = i === index ? 'gun-num now' : 'gun-num'
    })
    entries.forEach((li, i) => li.classList.toggle('now', i === index))
    view.invalidate()
  }
  view.on('hover', (hit) => focus(partOf(hit?.node) ?? -1))
  entries.forEach((li, i) => {
    li.addEventListener('pointerenter', () => focus(i))
    li.addEventListener('pointerleave', () => focus(-1))
  })

  view.start((dt) => {
    if (spread === goal) return
    spread = goal > spread ? Math.min(goal, spread + dt * 0.45) : Math.max(goal, spread - dt * 0.45)
    slider.value = String(spread)
    place()
  })

  info.textContent = 'Explode and Assemble, or drag the slider · hover a part or a legend entry to find the other'
  if (import.meta.env.DEV) Object.assign(window, { parts })
  return view
}
