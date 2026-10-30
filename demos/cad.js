import { DirectionalLight, Geometry, Group, HemisphereLight, Label, Lines, Mesh, Points, Scene, Vec3, View, cylinder, edges, extrude, lathe, outline, sphere } from 'phoria2'

// A pillow-block bearing as an engineering drawing: one scene of parts, seen by four views on a
// sheet - top, isometric, front and right, third-angle - each with its own dimensions (showFrom
// shows them to their view alone). Section A-A cuts the housing and bush through the middle, capped,
// leaving the shaft and fasteners whole as drafting convention has it; Explode draws the parts apart
// and names them; Measure snaps to corners and reads the distance between two clicks. Units are
// centimetres in the scene and millimetres on the sheet.

const MM = 10
const INK = '#1d1d22'
const PARTS = [
  { key: 'base', name: 'Housing base', material: 'Cast iron EN-GJL-250', qty: 1, color: '#bcc2ca', cap: '#7f8791', explode: [0, 0, 0], section: true },
  { key: 'cap', name: 'Housing cap', material: 'Cast iron EN-GJL-250', qty: 1, color: '#bcc2ca', cap: '#7f8791', explode: [0, 3.4, 0], section: true },
  { key: 'bush', name: 'Bearing bush', material: 'Bronze CuSn8', qty: 1, color: '#d8b77f', cap: '#a8844a', explode: [0, 0, 5.5], section: true },
  { key: 'shaft', name: 'Shaft ⌀20', material: 'Steel C45', qty: 1, color: '#dde1e6', cap: '#9aa0a8', explode: [0, 0, -9], section: false },
  { key: 'bolts', name: 'Cap bolt M10 × 35', material: 'Steel, class 8.8', qty: 2, color: '#8f969f', cap: '#5d636b', explode: [0, 7, 0], section: false },
  { key: 'nuts', name: 'Hold-down nut M12', material: 'Steel, class 8', qty: 2, color: '#8f969f', cap: '#5d636b', explode: [0, 2.2, 0], section: false },
]

// ---- the parts' shapes, in centimetres: the shaft's axis along z, 5 up; the foot on the ground

/** The lower half of the housing as seen from the front: a pedestal with the bore's lower half cut out. */
function pedestalShape() {
  const bore = Array.from({ length: 25 }, (_, i) => {
    const a = -Math.PI * (i / 24)
    return [1.8 * Math.cos(a), 5 + 1.8 * Math.sin(a)]
  })
  return [[-4.5, 1.5], [4.5, 1.5], [4.5, 5], ...bore, [-4.5, 5]]
}

/** The cap as seen from the front: flanges for its bolts, an arch over the bore. */
function capShape() {
  const inner = Array.from({ length: 25 }, (_, i) => {
    const a = Math.PI * (1 - i / 24)
    return [1.8 * Math.cos(a), 5 + 1.8 * Math.sin(a)]
  })
  const from = Math.asin(0.8 / 3)
  const outer = Array.from({ length: 25 }, (_, i) => {
    const a = from + (Math.PI - 2 * from) * (i / 24)
    return [3 * Math.cos(a), 5 + 3 * Math.sin(a)]
  })
  return [[-4.5, 5], ...inner, [4.5, 5], [4.5, 5.8], ...outer, [-4.5, 5.8]]
}

/** A hexagonal head or nut, its axis up. @param {number} across @param {number} height */
const hex = (across, height) => cylinder({ radius: across / Math.sqrt(3), height, segments: 6 })

/** Each part's pieces: [geometry, position]. @type {Record<string, [import('phoria2').Geometry, number[]][]>} */
const SHAPES = {
  base: [
    [extrude({ shape: outline.rect({ width: 17, height: 4.5, radius: 0.4 }), holes: [-6.5, 6.5].map((x) => outline.circle({ radius: 0.7, center: [x, 0] })), depth: 1.5, axis: 'y' }), [0, 0.75, 0]],
    [extrude({ shape: pedestalShape(), depth: 4, axis: 'z' }), [0, 0, 0]],
  ],
  cap: [
    [extrude({ shape: capShape(), depth: 4, axis: 'z' }), [0, 0, 0]],
    // the grease nipple on top
    [hex(0.6, 0.4), [0, 8.15, 0]],
    [cylinder({ radius: 0.14, height: 0.4, segments: 16 }), [0, 8.55, 0]],
    [sphere({ radius: 0.2 }), [0, 8.82, 0]],
  ],
  bush: [
    [lathe({ points: [[1, -1.5], [1.8, -1.5], [1.8, 1.5], [1, 1.5], [1, -1.5]], segments: 48, axis: 'z' }), [0, 5, 0]],
  ],
  shaft: [
    [cylinder({ radius: 1, height: 14, segments: 48, axis: 'z' }), [0, 5, 0]],
  ],
  bolts: [-3.7, 3.7].flatMap((x) => [
    [hex(1.6, 0.65), [x, 6.125, 0]],
    [cylinder({ radius: 0.5, height: 3.5, segments: 20 }), [x, 4.05, 0]],
  ]),
  nuts: [-6.5, 6.5].flatMap((x) => [
    [hex(1.9, 1), [x, 2, 0]],
    [cylinder({ radius: 0.6, height: 1.7, segments: 20 }), [x, 2.35, 0]],
  ]),
}

// ---- small vector helpers for the drawing's lines
const add = (/** @type {number[]} */ a, /** @type {number[]} */ b) => a.map((v, k) => v + b[k])
const scale = (/** @type {number[]} */ a, /** @type {number} */ s) => a.map((v) => v * s)
const sub = (/** @type {number[]} */ a, /** @type {number[]} */ b) => a.map((v, k) => v - b[k])
const unit = (/** @type {number[]} */ a) => scale(a, 1 / (Math.hypot(...a) || 1))

export default function run({ canvas, gui, info }) {
  canvas.style.display = 'none'
  void gui
  const sheet = document.createElement('div')
  sheet.className = 'cad-sheet'
  sheet.innerHTML = `
    <div class="cad-frame">
      <div class="cad-toolbar">
        <button type="button" data-act="explode">Explode</button>
        <button type="button" data-act="section">Section A–A</button>
        <button type="button" data-act="dims" aria-pressed="true">Dimensions</button>
        <button type="button" data-act="measure">Measure</button>
        <button type="button" data-act="reset">Reset views</button>
        <span class="cad-readout" role="status"></span>
      </div>
      <div class="cad-views">
        <section class="cad-top"><h4>Top</h4><canvas></canvas></section>
        <section class="cad-iso"><h4>Isometric</h4><canvas></canvas></section>
        <section class="cad-front"><h4>Front</h4><canvas></canvas></section>
        <section class="cad-right"><h4>Right</h4><canvas></canvas></section>
      </div>
      <div class="cad-footer">
        <table class="cad-bom">
          <thead><tr><th>Item</th><th>Part</th><th>Qty</th><th>Material</th></tr></thead>
          <tbody>${PARTS.map((p, i) => `<tr data-part="${p.key}"><td>${i + 1}</td><td>${p.name}</td><td>${p.qty}</td><td>${p.material}</td></tr>`).join('')}</tbody>
        </table>
        <div class="cad-title">
          <div class="cad-title-name"><small>Title</small>Pillow block bearing, assembly</div>
          <div><small>Drawing no.</small>PB-20-001</div><div><small>Scale</small>1:2</div>
          <div><small>Units</small>mm</div>
          <div><small>Projection</small>Third angle <svg viewBox="0 0 40 18" width="40" height="18" aria-label="third angle projection"><path d="M2 5 L14 7 L14 11 L2 13 Z M2 9 H14" fill="none" stroke="currentColor"/><circle cx="28" cy="9" r="6" fill="none" stroke="currentColor"/><circle cx="28" cy="9" r="2.5" fill="none" stroke="currentColor"/></svg></div>
          <div><small>Drawn</small>phoria2</div><div><small>Sheet</small>1 of 1</div>
        </div>
      </div>
    </div>`
  document.body.append(sheet)
  const [topCanvas, isoCanvas, frontCanvas, rightCanvas] = sheet.querySelectorAll('canvas')
  const readout = /** @type {HTMLElement} */ (sheet.querySelector('.cad-readout'))

  // ---- the assembly: one scene, every part a group of pieces with its edges drawn on
  const scene = new Scene()
  scene.add(new HemisphereLight({ sky: '#ffffff', ground: '#9aa0a8', intensity: 1.1 }))
  scene.add(new DirectionalLight({ direction: [-0.5, -1, -0.7], intensity: 1.5 }))
  /** @type {Record<string, Group>} */
  const parts = {}
  /** @type {Record<string, Lines[]>} */
  const outlines = {}
  for (const p of PARTS) {
    const part = scene.add(new Group({ name: p.key, highlightWhole: true, userData: { part: p } }))
    outlines[p.key] = []
    for (const [geometry, position] of SHAPES[p.key]) {
      const piece = part.add(new Mesh({ geometry, position, material: { color: p.color, roughness: 0.55, metalness: p.key === 'bush' ? 0.2 : 0.1 } }))
      // the edges a drawing shows: where faces turn sharply, not the facets of round surfaces
      outlines[p.key].push(piece.add(new Lines({ geometry: edges(geometry, { angle: 30 }), material: { color: INK, width: 1.2 }, pickable: false })))
    }
    parts[p.key] = part
  }
  /** The part a hit belongs to. @param {any} node @returns {any} */
  const partOf = (node) => {
    for (let n = node; n; n = n.parent) if (n.userData?.part) return n.userData.part
    return null
  }

  // ---- four views of the one scene: three orthographic elevations and an isometric that turns
  const tooltip = (/** @type {any} */ hit) => {
    const p = partOf(hit?.node)
    return p ? { title: p.name, rows: { Material: p.material, Qty: p.qty } } : null
  }
  const common = { scene, framing: /** @type {const} */ ('both'), highlight: '#4a8fe0', tooltip }
  const top = new View({ canvas: topCanvas, camera: 'top', ...common })
  const front = new View({ canvas: frontCanvas, camera: 'front', ...common })
  const right = new View({ canvas: rightCanvas, camera: 'side', ...common })
  const iso = new View({ canvas: isoCanvas, camera: 'isometric', orbit: { pan: false }, ...common })
  const views = [top, iso, front, right]
  /** Seen by this view only. @param {View} view */
  const only = (view) => (/** @type {any} */ camera) => camera === view.camera

  // ---- dimensions, each drawn on the view it belongs to, in front of everything it measures
  const dimensions = scene.add(new Group({ name: 'dimensions', pickable: false }))
  /**
   * A dimension between two features, measured along one axis: extension lines from each feature out
   * to the dimension line (which passes through `at`), arrows at its ends, and the length on it in mm.
   * @param {View} view @param {number[]} from @param {number[]} to @param {0 | 1 | 2} axis @param {number[]} at
   * @param {string} [text]
   */
  const dimension = (view, from, to, axis, at, text) => {
    const onLine = (/** @type {number[]} */ p) => at.map((v, k) => (k === axis ? p[k] : v))
    const A = onLine(from), B = onLine(to)
    const along = unit(sub(B, A)), out = (p) => unit(sub(onLine(p), p))
    const seg = []
    // extension lines: a small gap at the feature, past the dimension line a little
    for (const [p, P] of [[from, A], [to, B]]) {
      const n = out(p)
      if (Math.hypot(...sub(P, p)) > 1e-6) seg.push(...add(p, scale(n, 0.15)), ...add(P, scale(n, 0.3)))
    }
    seg.push(...A, ...B)
    // the arrowheads, in the plane the extension lines make with the dimension line
    const side = Math.hypot(...sub(A, from)) > 1e-6 ? unit(sub(A, from)) : unit(sub(B, to))
    for (const [P, dir] of [[A, along], [B, scale(along, -1)]]) {
      for (const s of [1, -1]) seg.push(...P, ...add(add(P, scale(dir, 0.38)), scale(side, 0.13 * s)))
    }
    const group = dimensions.add(new Group({ showFrom: only(view) }))
    group.add(new Lines({ geometry: new Geometry({ positions: seg }), material: { color: INK, width: 1 } }))
    const length = Math.abs(to[axis] - from[axis]) * MM
    group.add(new Label({ text: text ?? `${Math.round(length)}`, position: scale(add(A, B), 0.5), className: 'cad-dim', overlap: 'show' }))
  }
  // front: x across, y up - drawn at z 8, in front of the shaft's end
  dimension(front, [-8.5, 0, 8], [8.5, 0, 8], 0, [0, -1.3, 8])
  dimension(front, [8.5, 0, 8], [0, 5, 8], 1, [10.2, 0, 8])
  dimension(front, [-8.5, 0, 8], [0, 8, 8], 1, [-10.2, 0, 8])
  dimension(front, [-1.8, 5, 8], [1.8, 5, 8], 0, [0, 8.9, 8], '⌀36')
  // top: x across, z up the page - drawn at y 10, above the grease nipple
  dimension(top, [-6.5, 10, 0], [6.5, 10, 0], 0, [0, 10, -3.6])
  dimension(top, [8.5, 10, -2.25], [8.5, 10, 2.25], 2, [10, 10, 0])
  dimension(top, [-1, 10, -7], [-1, 10, 7], 2, [-10, 10, 0])
  // right: z across, y up - drawn at x 10, in front of the foot's end
  dimension(right, [10, 5.8, -2], [10, 5.8, 2], 2, [10, 9.6, 0])
  dimension(right, [10, 4, 7], [10, 6, 7], 1, [10, 0, 8.4], '⌀20')

  // the cutting plane, marked on the top view while the section is on: a chain line with its arrows
  const plane = dimensions.add(new Group({ showFrom: only(top), visible: false }))
  plane.add(new Lines({ geometry: new Geometry({ positions: [
    -10, 10, 0, 10, 10, 0,
    ...[-10, 10].flatMap((x) => [x, 10, 0, x, 10, -1.2, x, 10, -1.2, x - 0.18 * Math.sign(x), 10, -0.75, x, 10, -1.2, x + 0.18 * Math.sign(x), 10, -0.75]),
  ] }), material: { color: '#c0392b', width: 1.4 } }))
  for (const x of [-10, 10]) plane.add(new Label({ text: 'A', position: [x, 10, -1.6], className: 'cad-dim cad-section-mark', overlap: 'show' }))

  // part names on the isometric while exploded - each on its part, so it moves with it
  const names = PARTS.map((p, i) => {
    const b = parts[p.key].bounds
    return parts[p.key].add(new Label({ text: `${i + 1}  ${p.name}`, position: [(b.min[0] + b.max[0]) / 2, b.max[1], (b.min[2] + b.max[2]) / 2], place: 'above',
      className: 'cad-part-name', overlap: 'dim', showFrom: only(iso), visible: false }))
  })

  // ---- measure: two clicks, snapped to a corner of the face clicked when one is near
  const measure = scene.add(new Group({ name: 'measure', pickable: false }))
  const marks = measure.add(new Points({ geometry: new Geometry({ positions: [] }), material: { color: '#c0392b', size: 9, sizeAttenuation: false, depthTest: false } }))
  const tape = measure.add(new Lines({ geometry: new Geometry({ positions: [] }), material: { color: '#c0392b', width: 1.6, depthTest: false } }))
  const tapeLabel = measure.add(new Label({ text: '', className: 'cad-dim cad-measure', overlap: 'show', visible: false }))
  /** @type {number[][]} */
  let picked = []
  /** The point clicked, or the corner of the face under it when one is within 5 mm. @param {any} hit */
  const snap = (hit) => {
    const g = hit.node.geometry, f = hit.face, p = hit.point.toArray()
    if (!g || f === null || f === undefined) return p
    const corners = [0, 1, 2].map((k) => (g.indices ? g.indices[f * 3 + k] : f * 3 + k))
      .map((i) => new Vec3(g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]).applyMatrix4(hit.node.worldMatrix).toArray())
    const near = corners.reduce((best, c) => (Math.hypot(...sub(c, p)) < Math.hypot(...sub(best, p)) ? c : best))
    return Math.hypot(...sub(near, p)) < 0.5 ? near : p
  }
  const showMeasure = () => {
    marks.geometry = new Geometry({ positions: picked.flat() })
    tape.geometry = new Geometry({ positions: picked.length === 2 ? picked.flat() : [] })
    if (picked.length === 2) {
      const d = Math.hypot(...sub(picked[1], picked[0])) * MM
      tapeLabel.text = `${d.toFixed(1)} mm`
      tapeLabel.position = scale(add(picked[0], picked[1]), 0.5)
      readout.textContent = `Distance ${d.toFixed(1)} mm`
    } else readout.textContent = picked.length ? 'Click the second point' : 'Click a point on a part'
    tapeLabel.visible = picked.length === 2
  }

  // ---- the toolbar
  const state = { exploded: false, section: false, dims: true, measuring: false }
  let spread = 0
  const buttons = /** @type {NodeListOf<HTMLButtonElement>} */ (sheet.querySelectorAll('.cad-toolbar button'))
  const press = (/** @type {string} */ act, /** @type {boolean} */ on) => sheet.querySelector(`[data-act=${act}]`)?.setAttribute('aria-pressed', String(on))
  const frameAll = (duration = 0.6) => {
    for (const view of views) view.frame(scene, { padding: 0.12, duration })
  }
  const setSection = (on) => {
    state.section = on
    for (const p of PARTS) {
      if (!p.section) continue
      parts[p.key].clip = on ? { normal: [0, 0, 1], offset: 0, cap: p.cap } : null
      // edges are lines, which a section doesn't cut: the cut parts lose theirs while it's on
      for (const line of outlines[p.key]) line.visible = !on
    }
    plane.visible = on
    sheet.querySelector('.cad-front h4').textContent = on ? 'Front, section A–A' : 'Front'
    press('section', on)
  }
  const actions = {
    explode: () => {
      state.exploded = !state.exploded
      press('explode', state.exploded)
    },
    section: () => setSection(!state.section),
    dims: () => {
      state.dims = !state.dims
      press('dims', state.dims)
    },
    measure: () => {
      state.measuring = !state.measuring
      picked = []
      measure.visible = state.measuring
      showMeasure()
      if (!state.measuring) readout.textContent = ''
      press('measure', state.measuring)
    },
    reset: () => {
      if (iso.controls) iso.camera = 'isometric'
      frameAll()
    },
  }
  buttons.forEach((b) => b.addEventListener('click', () => actions[/** @type {keyof typeof actions} */ (b.dataset.act)]()))
  measure.visible = false

  for (const view of views) {
    view.on('click', (hit) => {
      if (!state.measuring || !hit || !partOf(hit.node)) return
      picked = picked.length === 2 ? [snap(hit)] : [...picked, snap(hit)]
      showMeasure()
    })
  }

  // the parts list points at its part in every view
  sheet.querySelectorAll('.cad-bom tr[data-part]').forEach((row) => {
    const part = parts[/** @type {HTMLElement} */ (row).dataset.part ?? '']
    row.addEventListener('pointerenter', () => { part.outline = { color: '#e67e22', width: 3 } })
    row.addEventListener('pointerleave', () => { part.outline = null })
  })

  // the explosion eases out and back; once it settles, every view frames what is there now
  let settled = true
  iso.start((dt) => {
    const goal = state.exploded ? 1 : 0
    if (spread === goal) {
      if (!settled) {
        settled = true
        frameAll()
      }
      return
    }
    settled = false
    spread = goal > spread ? Math.min(goal, spread + dt * 1.6) : Math.max(goal, spread - dt * 1.6)
    const e = spread * spread * (3 - 2 * spread)
    for (const p of PARTS) parts[p.key].position = scale(p.explode, e)
    names.forEach((label) => { label.visible = spread > 0.98 })
  })
  // dimensions describe the assembly: shown only while it is together (and wanted)
  dimensions.onUpdate(() => { dimensions.visible = state.dims && spread === 0 })

  info.textContent = 'Hover a part to name it · Explode, Section and Measure are on the sheet · drag the isometric to turn it'
  if (import.meta.env.DEV) Object.assign(window, { views, parts })
  return iso
}
