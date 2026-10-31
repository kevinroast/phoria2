import { Box3, Color, DirectionalLight, Group, InstancedMesh, Label, Lines, Mesh, View, extrude, icosphere, outline, plane } from 'phoria2'
import { scaleColor } from 'phoria2/charts'
import { ELEMENTS } from './data/elements.js'

// The periodic table as a board of 118 tiles - one InstancedMesh, one draw - coloured by category.
// Each tile's symbol always shows; its number and name join it as you zoom in (labels with
// minScale). The tiles rise into bars of a property, or gather by category, and back; click one and
// its atom rises above the table - nucleus, shells and electrons - with its facts beside it.
// Data: PubChem's periodic table (NIH, public domain), via scripts/elements.mjs.

const CATEGORIES = {
  'Alkali metal': '#e8705a',
  'Alkaline earth metal': '#f0a35e',
  'Transition metal': '#e9c46a',
  'Post-transition metal': '#9cc5a1',
  Metalloid: '#5fb8a6',
  Nonmetal: '#4f9fd1',
  Halogen: '#7d8fe0',
  'Noble gas': '#b48ae0',
  Lanthanide: '#e083b4',
  Actinide: '#c76b8e',
}
// the properties the tiles can rise to, with their units and how to show a value
const PROPERTIES = {
  'atomic mass': { key: 'mass', unit: 'u', format: (v) => v.toFixed(v < 10 ? 3 : 1) },
  'atomic radius': { key: 'radius', unit: 'pm', format: (v) => String(v) },
  electronegativity: { key: 'electronegativity', unit: '', format: (v) => v.toFixed(2) },
  'ionisation energy': { key: 'ionisation', unit: 'eV', format: (v) => v.toFixed(2) },
  'melting point': { key: 'melting', unit: 'K', format: (v) => Math.round(v).toLocaleString() },
  density: { key: 'density', unit: 'g/cm³', format: (v) => (v < 0.01 ? v.toExponential(1) : v.toFixed(2)) },
}
const PITCH = 1.12 // tile spacing, in tiles
const FLAT = 0.22 // a tile's height on the board
const TALLEST = 5 // the highest bar
const MISSING = new Color('#3a3a44')
const ATOM_SIZE = 2.2 // every atom's outer shell, whatever its element

/** @param {number} t */
const smooth = (t) => t * t * (3 - 2 * t)

/** An element's place on the board: the f-block rows sit a little apart below the main table. @param {typeof ELEMENTS[number]} e */
const boardSpot = (e) => [(e.col - 9.5) * PITCH, ((e.row >= 9 ? e.row - 0.5 : e.row) - 5) * PITCH]

export default function run({ canvas, info }) {
  const view = new View({ canvas, orbit: true, background: '#141418', highlight: '#ffffff',
    tooltip: (hit) => (hit.node === tiles ? tooltipFor(hit.datum) : null) })
  const { scene } = view
  scene.environment = 'studio'
  scene.environmentIntensity = 0.6
  scene.add(new DirectionalLight({ direction: [-0.4, -1, -0.5], intensity: 1.3, castShadow: true }))
  scene.add(new Mesh({ geometry: plane(60), position: [0, -0.01, 0], material: { color: '#1b1b21', roughness: 0.9 }, receiveShadow: true, pickable: false }))

  // ---- the tiles: one rounded tile, 118 times. Each label layer is one kind of text; the number and
  // name wait until a tile is big enough on screen to hold them
  const tiles = scene.add(new InstancedMesh({
    geometry: extrude({ shape: outline.rect({ width: 1, height: 1, radius: 0.14 }), depth: 1, axis: 'y' }),
    material: { roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.3 },
    data: ELEMENTS, castShadow: true, receiveShadow: true,
    labels: [
      { text: (e) => e.symbol, className: 'pt-symbol', occlude: true },
      { text: (e) => e.number, className: 'pt-number', place: 'above', offset: [0, -11], minScale: 70, occlude: true },
      { text: (e) => e.name, className: 'pt-name', place: 'below', offset: [0, 11], minScale: 95, occlude: true },
    ],
  }))
  // the gaps in rows 6 and 7 where the lanthanides and actinides belong
  const gaps = [['57-71', 6], ['89-103', 7]].map(([text, row]) => scene.add(new Label({
    text: String(text), className: 'pt-gap', position: [(3 - 9.5) * PITCH, 0.05, (Number(row) - 5) * PITCH], minScale: 40,
  })))

  // ---- each tile's state, eased from where it was to where it's going: position, height and colour
  const now = ELEMENTS.map((e) => {
    const [x, z] = boardSpot(e)
    return { x, z, h: FLAT, color: new Color(CATEGORIES[e.category]) }
  })
  let from = now.map((s) => ({ ...s, color: s.color.clone() }))
  let to = from
  let clock = 0, started = -10, dim = 0, dimTo = 0
  /** @type {Set<string> | null} */
  let picked = null // the categories picked in the legend, or null for all
  let selected = -1

  /** Move every tile towards a new arrangement, rippling across the board. @param {typeof now} targets */
  const goTo = (targets) => {
    from = now.map((s) => ({ ...s, color: s.color.clone() }))
    to = targets
    started = clock
  }
  const draw = () => {
    ELEMENTS.forEach((e, i) => {
      const s = now[i]
      // others fade back while an atom is shown, and when the legend picks categories
      const faded = (i !== selected ? dim : 0) + (picked && !picked.has(e.category) ? 0.75 : 0)
      const color = s.color.clone().lerp(MISSING, Math.min(0.85, faded))
      tiles.setInstance(i, { position: [s.x, s.h / 2, s.z], scale: [0.92, s.h, 0.92], color })
    })
  }
  /** One step of the easing. @param {number} dt */
  const step = (dt) => {
    clock += dt
    let moving = false
    ELEMENTS.forEach((e, i) => {
      const delay = ((e.col - 1) / 17) * 0.35
      const t = Math.min(1, Math.max(0, (clock - started - delay) / 0.75))
      if (t < 1) moving = true
      const k = smooth(t), a = from[i], b = to[i], s = now[i]
      s.x = a.x + (b.x - a.x) * k
      s.z = a.z + (b.z - a.z) * k
      s.h = a.h + (b.h - a.h) * k
      s.color = a.color.clone().lerp(b.color, k)
    })
    const fading = Math.abs(dimTo - dim) > 1e-3
    dim += (dimTo - dim) * Math.min(1, dt * 6)
    if (moving || fading) draw()
  }

  // ---- the arrangements
  const board = () => ELEMENTS.map((e) => {
    const [x, z] = boardSpot(e)
    return { x, z, h: FLAT, color: new Color(CATEGORIES[e.category]) }
  })
  /** Bars of a property, coloured along a ramp; elements without a value stay flat and grey. @param {keyof typeof PROPERTIES} name */
  const heights = (name) => {
    const { key } = PROPERTIES[name]
    const values = ELEMENTS.map((e) => e[key]).filter((v) => v !== null)
    const lo = Math.min(...values), hi = Math.max(...values)
    const ramp = scaleColor({ domain: [lo, hi], scheme: 'viridis' })
    return ELEMENTS.map((e) => {
      const [x, z] = boardSpot(e)
      const v = e[key]
      if (v === null) return { x, z, h: 0.06, color: MISSING.clone() }
      return { x, z, h: FLAT + TALLEST * (v - lo) / (hi - lo), color: ramp(v) }
    })
  }
  // categories gathered into blocks, two rows of five, each in atomic number order
  const names = Object.keys(CATEGORIES)
  const clusters = names.map((name) => {
    const members = ELEMENTS.filter((e) => e.category === name)
    const cols = Math.max(3, Math.ceil(Math.sqrt(members.length * 1.5)))
    return { name, members, cols, rows: Math.ceil(members.length / cols) }
  })
  const blockAt = clusters.map((c, i) => {
    const row = i < 5 ? 0 : 1
    const before = clusters.slice(row * 5, i).reduce((w, b) => w + b.cols + 1.5, 0)
    return { x: before, z: row === 0 ? 0 : Math.max(...clusters.slice(0, 5).map((b) => b.rows)) + 2.5 }
  })
  const width = Math.max(...[0, 1].map((r) => clusters.slice(r * 5, r * 5 + 5).reduce((w, b) => w + b.cols + 1.5, -1.5)))
  const depth = blockAt[5].z + Math.max(...clusters.slice(5).map((b) => b.rows))
  const grouped = () => {
    const out = board()
    clusters.forEach((c, i) => c.members.forEach((e, j) => {
      const s = out[e.number - 1]
      s.x = (blockAt[i].x + (j % c.cols) - width / 2 + 0.5) * PITCH
      s.z = (blockAt[i].z + Math.floor(j / c.cols) - depth / 2 + 0.5) * PITCH
    }))
    return out
  }
  const titles = clusters.map((c, i) => scene.add(new Label({
    text: c.name, className: 'pt-title', place: 'above', visible: false,
    position: [(blockAt[i].x + c.cols / 2 - width / 2) * PITCH, 0.3, (blockAt[i].z - depth / 2 - 0.3) * PITCH],
  })))

  // ---- the atom: a nucleus of protons and neutrons, shells as rings, electrons going round them
  /** @type {Group | null} */
  let atom = null
  const ball = icosphere({ radius: 1, detail: 2 })
  /** @param {typeof ELEMENTS[number]} e @param {number[]} at where it floats */
  const makeAtom = (e, at) => {
    const group = new Group({ position: at, pickable: false })
    // the nucleus, packed from the middle out - heavy ones drawn with fewer, bigger particles
    const neutrons = Math.max(0, Math.round(e.mass ?? e.number * 2.5) - e.number)
    const total = e.number + neutrons, shown = Math.min(total, 90)
    const r = 0.11 * Math.max(1, Math.cbrt(total / shown)), core = r * Math.cbrt(shown) * 1.05
    const nucleus = group.add(new InstancedMesh({ geometry: ball, count: shown, material: { roughness: 0.35, clearcoat: 0.5 } }))
    for (let k = 0; k < shown; k++) {
      const d = core * Math.cbrt((k + 0.5) / shown), y = 1 - 2 * (k + 0.5) / shown, ring = Math.sqrt(1 - y * y), a = k * 2.39996
      nucleus.setInstance(k, { position: [Math.cos(a) * ring * d, y * d, Math.sin(a) * ring * d], scale: r,
        // protons and neutrons mixed evenly through it, in their proportions
        color: Math.floor((k + 1) * e.number / total) > Math.floor(k * e.number / total) ? '#e5604f' : '#9aa6b8' })
    }
    // shells, each tilted its own way, turning at its own pace - the inner ones faster
    e.shells.forEach((count, s) => {
      const radius = core + 0.45 + 0.36 * s
      const shell = group.add(new Group({ rotation: [0.35 * Math.sin(s * 1.7), 0, 0.3 * Math.cos(s * 1.3)] }))
      const ring = []
      for (let k = 0; k <= 96; k++) ring.push(Math.cos(k / 96 * Math.PI * 2) * radius, 0, Math.sin(k / 96 * Math.PI * 2) * radius)
      const pairs = []
      for (let k = 0; k < 96; k++) pairs.push(k, k + 1)
      shell.add(new Lines({ geometry: { positions: ring, indices: pairs }, material: { color: '#8fb4ff', width: 1.5, opacity: 0.5 } }))
      const turning = shell.add(new Group())
      const electrons = turning.add(new InstancedMesh({ geometry: ball, count, material: { color: '#7fd8ff', emissive: '#3aa8ff', emissiveIntensity: 0.8 } }))
      for (let k = 0; k < count; k++) {
        const a = (k / count) * Math.PI * 2
        electrons.setInstance(k, { position: [Math.cos(a) * radius, 0, Math.sin(a) * radius], scale: 0.07 })
      }
      turning.onUpdate((node, dt) => { node.rotation.y += dt * 1.4 / (s + 1) })
    })
    // its size, to frame it by: the outer shell
    group.userData.radius = core + 0.45 + 0.36 * (e.shells.length - 1)
    return group
  }

  // ---- the info card
  const card = document.createElement('div')
  card.className = 'hud pt-card'
  card.hidden = true
  document.body.append(card)
  /** @param {typeof ELEMENTS[number]} e */
  const showCard = (e) => {
    const fact = (label, value) => (value === null || value === undefined ? '' : `<dt>${label}</dt><dd>${value}</dd>`)
    const year = e.discovered === 'ancient' ? 'known since antiquity' : e.discovered
    card.innerHTML = `
      <div class="pt-card-head" style="--c: ${CATEGORIES[e.category]}"><span class="pt-card-number">${e.number}</span><span class="pt-card-symbol">${e.symbol}</span></div>
      <h2>${e.name}</h2>
      <p class="pt-card-category">${e.category}${e.group ? ` · group ${e.group}` : ''} · period ${e.period}</p>
      <dl>
        ${fact('Atomic mass', e.mass !== null ? `${PROPERTIES['atomic mass'].format(e.mass)} u` : null)}
        ${fact('Electrons per shell', e.shells.join(' · '))}
        ${fact('Configuration', e.config)}
        ${fact('State', e.state)}
        ${fact('Electronegativity', e.electronegativity)}
        ${fact('Melting point', e.melting !== null ? `${Math.round(e.melting).toLocaleString()} K` : null)}
        ${fact('Density', e.density !== null ? `${PROPERTIES.density.format(e.density)} g/cm³` : null)}
        ${fact('Discovered', year)}
      </dl>
      <button type="button" class="pt-card-close">Back to the table</button>`
    card.hidden = false
  }
  card.addEventListener('click', (event) => { if (/** @type {HTMLElement} */ (event.target).closest('.pt-card-close')) deselect() })

  // ---- the legend: categories in the table and grouped views, a colour key for property heights
  const legend = document.createElement('div')
  legend.className = 'hud pt-legend'
  document.body.append(legend)
  const showLegend = () => {
    legend.classList.toggle('pt-legend-ramp', settings.view === 'property heights')
    if (settings.view === 'property heights') {
      const { key, unit, format } = PROPERTIES[settings.property]
      const values = ELEMENTS.map((e) => e[key]).filter((v) => v !== null)
      legend.innerHTML = `<b>${settings.property}${unit ? ` (${unit})` : ''}</b>
        <div class="pt-ramp"></div><div class="pt-ramp-ends"><span>${format(Math.min(...values))}</span><span>${format(Math.max(...values))}</span></div>
        <span class="pt-missing">no value</span>`
      return
    }
    legend.innerHTML = names.map((n) => `<button type="button" data-category="${n}" class="${!picked || picked.has(n) ? '' : 'off'}"><i style="background: ${CATEGORIES[n]}"></i>${n}</button>`).join('')
  }
  legend.addEventListener('click', (event) => {
    const button = /** @type {HTMLElement} */ (event.target).closest('button')
    if (!button?.dataset.category) return
    const name = button.dataset.category
    // the first click picks one category; more clicks add or drop; dropping the last shows them all
    if (!picked) picked = new Set([name])
    else if (picked.has(name)) picked.delete(name)
    else picked.add(name)
    if (!picked.size) picked = null
    showLegend()
    draw()
  })

  /** @param {typeof ELEMENTS[number]} e */
  function tooltipFor(e) {
    const rows = { Category: e.category, 'Atomic mass': e.mass !== null ? `${PROPERTIES['atomic mass'].format(e.mass)} u` : 'unknown' }
    if (settings.view === 'property heights') {
      const { key, unit, format } = PROPERTIES[settings.property]
      rows[settings.property] = e[key] === null ? 'unknown' : `${format(e[key])}${unit ? ` ${unit}` : ''}`
    }
    return { title: `${e.number} · ${e.name}`, rows }
  }

  // ---- the views
  const settings = { view: 'table', property: /** @type {keyof typeof PROPERTIES} */ ('melting point') }
  // looked at from in front and above - lower for the bars, so their heights read
  const direction = () => (settings.view === 'property heights' ? [0, 0.75, 1] : [0, 1.35, 1])
  /** The box the tiles will fill once they get there - and the atom, when one is shown - for the camera to frame. */
  const boxOf = (targets) => {
    const box = new Box3()
    for (const s of targets) {
      box.expandByPoint([s.x - 0.5, 0, s.z - 0.5])
      box.expandByPoint([s.x + 0.5, s.h, s.z + 0.5])
    }
    if (atom) {
      const [x, y, z] = atom.position
      box.expandByPoint([x - ATOM_SIZE, y - ATOM_SIZE, z - ATOM_SIZE])
      box.expandByPoint([x + ATOM_SIZE, y + ATOM_SIZE, z + ATOM_SIZE])
      // room on the right for its card
      box.max[0] += 3 * PITCH
    }
    return box
  }
  const frame = (duration = 1) => view.frame(boxOf(to), { direction: direction(), padding: 0.03, duration })
  const arrange = (duration = 1.1) => {
    deselect(false)
    const targets = settings.view === 'property heights' ? heights(settings.property) : settings.view === 'by category' ? grouped() : board()
    goTo(targets)
    for (const t of titles) t.visible = settings.view === 'by category'
    for (const g of gaps) g.visible = settings.view !== 'by category'
    showLegend()
    showBar()
    frame(duration)
  }

  /**
   * Where an atom floats, whichever element it is: in the table's empty bay above the transition
   * metals - above the bars when they're up - or beyond the categories' far edge when grouped.
   * @returns {[number, number, number]}
   */
  const atomSpot = () => {
    if (settings.view === 'by category') return [0, 1.9, -(depth / 2) * PITCH - ATOM_SIZE - 0.4]
    const [x, z] = [(7.5 - 9.5) * PITCH, (2 - 5) * PITCH]
    return [x, settings.view === 'property heights' ? FLAT + TALLEST + ATOM_SIZE * 0.6 : 2.4, z]
  }
  /** Show an element's atom and its facts; the table dims behind it. @param {number} i */
  const select = (i) => {
    if (atom) scene.remove(atom)
    selected = i
    const e = ELEMENTS[i]
    atom = scene.add(makeAtom(e, atomSpot()))
    // all atoms the same size on screen, their shells facing the camera
    atom.scale.setScalar(ATOM_SIZE / atom.userData.radius)
    const [, up, toward] = direction()
    atom.rotation.x = Math.atan2(toward, up)
    dimTo = 1
    showCard(e)
    frame()
  }
  /** Back to the table. @param {boolean} [reframe] */
  function deselect(reframe = true) {
    if (selected < 0) return
    if (atom) scene.remove(atom)
    atom = null
    selected = -1
    dimTo = 0
    card.hidden = true
    if (reframe) frame()
  }
  view.on('click', (hit) => {
    if (hit?.node === tiles && hit.instance !== null) select(hit.instance)
    else if (!hit) deselect()
  })
  addEventListener('keydown', (event) => { if (event.key === 'Escape') deselect() })

  // ---- the controls: the view, and for the bars which property
  const VIEWS = { table: 'Table', 'property heights': 'Properties', 'by category': 'Categories' }
  const bar = document.createElement('div')
  bar.className = 'hud pt-bar'
  bar.innerHTML = `
    <div class="pt-views">
      ${Object.entries(VIEWS).map(([key, label]) => `<button type="button" data-view="${key}">${label}</button>`).join('')}
      <button type="button" class="pt-reset" data-reset title="Back to where the view started" aria-label="Reset the view">⟲</button>
    </div>
    <div class="pt-properties">
      ${Object.keys(PROPERTIES).map((p) => `<button type="button" data-property="${p}">${p}</button>`).join('')}
    </div>`
  document.body.append(bar)
  const showBar = () => {
    for (const b of bar.querySelectorAll('[data-view]')) b.classList.toggle('now', /** @type {HTMLElement} */ (b).dataset.view === settings.view)
    for (const b of bar.querySelectorAll('[data-property]')) b.classList.toggle('now', /** @type {HTMLElement} */ (b).dataset.property === settings.property)
    const properties = /** @type {HTMLElement} */ (bar.querySelector('.pt-properties'))
    properties.hidden = settings.view !== 'property heights'
  }
  bar.addEventListener('click', (event) => {
    const button = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (event.target).closest('button'))
    if (!button) return
    if (button.dataset.view) settings.view = button.dataset.view
    else if (button.dataset.property) settings.property = /** @type {keyof typeof PROPERTIES} */ (button.dataset.property)
    else if (!('reset' in button.dataset)) return
    arrange(button.dataset.view || button.dataset.property ? 1.1 : 0.8)
  })

  arrange(0)
  draw()
  info.textContent = 'Element data: PubChem (NIH), public domain'
  return view.start((dt) => step(dt))
}
