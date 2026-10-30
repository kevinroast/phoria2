import { Box3, Geometry, InstancedMesh, Label, Lines, Mesh, SpotLight, View, box, cylinder, sphere } from 'phoria2'

// Colour, as a poster of four live views: the HSL cylinder cut open, the RGB cube, light adding
// and filters multiplying, and swatches. Everything that shows a colour is unlit, so it draws at
// exactly the colour it was given - `npm run colours` checks that pixel by pixel - and clicking a
// swatch, a harmony or its hex copies it. Only the lamps' pools of light are lit: light is meant to
// change colour, and the poster says so. It is a poster first: the views turn, but don't zoom or pan,
// and its two settings - the hue and its harmony - are part of the page rather than a panel.

const TAU = Math.PI * 2
const R = 1.6, H = 2.6
// the wedge cut from the cylinder: a quarter, facing the camera
const CUT = TAU / 4
const VIEW = Math.atan2(-1, 0.6)
const HARMONIES = {
  complementary: [0, 180],
  analogous: [-30, 0, 30],
  triadic: [0, 120, 240],
  'split complementary': [0, 150, 210],
  tetradic: [0, 90, 180, 270],
}

/** HSL (hue in degrees, saturation and lightness 0-1) to sRGB, 0-1. @returns {[number, number, number]} */
function hsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return [f(0), f(8), f(4)]
}
const hex = (/** @type {number[]} */ c) => `#${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`
const wrap = (/** @type {number} */ deg) => ((deg % 360) + 360) % 360

/**
 * A surface made of a grid of quads, coloured per vertex - fine enough that colours blending across
 * each quad (in linear light, as the GPU does) stay close to the ramp they stand for.
 */
class Surface {
  /** @type {number[]} */ positions = []
  /** @type {number[]} */ colors = []
  /** @type {number[]} */ indices = []
  /**
   * @param {number} nu @param {number} nv quads across and up
   * @param {(u: number, v: number) => number[]} at where, for u and v 0-1
   * @param {(u: number, v: number) => number[]} color its colour there, sRGB 0-1
   * @param {boolean} [flip] wind the other way, to face the other side
   */
  grid(nu, nv, at, color, flip = false) {
    const first = this.positions.length / 3
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        this.positions.push(...at(i / nu, j / nv))
        this.colors.push(...color(i / nu, j / nv))
      }
    }
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = first + j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1
        if (flip) this.indices.push(a, d, b, a, c, d)
        else this.indices.push(a, b, d, a, d, c)
      }
    }
    return this
  }

  geometry() {
    return new Geometry({ positions: this.positions, colors: this.colors, indices: this.indices })
  }
}

/** The HSL cylinder: hue round the axis, saturation out from it, lightness up - a wedge cut away. */
function cylinderOf() {
  const around = (u) => VIEW + CUT / 2 + u * (TAU - CUT)
  const hueAt = (angle) => wrap((angle * 180) / Math.PI)
  const point = (angle, r, y) => [Math.cos(angle) * r, y, -Math.sin(angle) * r]
  const s = new Surface()
  // the outside: full saturation, dark at the foot to light at the top
  s.grid(96, 24, (u, v) => point(around(u), R, v * H), (u, v) => hsl(hueAt(around(u)), 1, v))
  // the top is white and the foot black, whatever the hue
  s.grid(96, 1, (u, v) => point(around(u), R * v, H), () => [1, 1, 1])
  s.grid(96, 1, (u, v) => point(around(u), R * v, 0), () => [0, 0, 0])
  // the two faces of the cut: saturation out, lightness up, at the hue of each
  for (const angle of [around(0), around(1)]) {
    s.grid(16, 24, (u, v) => point(angle, u * R, v * H), (u, v) => hsl(hueAt(angle), u, v))
  }
  return s.geometry()
}

/** The RGB cube, 2 across: red along x, green up, blue towards the front - black at one corner. */
function cubeOf() {
  const s = new Surface()
  // each face: two of the three channels change across it, the third is 0 or 1 - the faces at 0
  // wound the other way, so every face faces out
  for (const [a, b, c] of [[0, 1, 2], [1, 2, 0], [2, 0, 1]]) {
    for (const side of [0, 1]) {
      s.grid(16, 16, (u, v) => {
        const p = [0, 0, 0]
        p[a] = u; p[b] = v; p[c] = side
        return p.map((x) => x * 2 - 1)
      }, (u, v) => {
        const rgb = [0, 0, 0]
        rgb[a] = u; rgb[b] = v; rgb[c] = side
        return rgb
      }, side === 0)
    }
  }
  return s.geometry()
}

const CORNERS = [['black', '#000000'], ['red', '#ff0000'], ['green', '#00ff00'], ['blue', '#0000ff'],
  ['yellow', '#ffff00'], ['magenta', '#ff00ff'], ['cyan', '#00ffff'], ['white', '#ffffff']]

export default function run({ canvas, gui, info }) {
  canvas.style.display = 'none'
  const poster = document.createElement('div')
  poster.className = 'colour-poster'
  poster.innerHTML = `
    <header><h2>Colour, exactly</h2><p>Four live views of colour. Every swatch, face and marker is drawn at exactly the colour it was given - checked pixel for pixel - so click any of them to copy its hex.</p></header>
    <div class="colour-grid">
      <section class="colour-hsl"><h3>HSL</h3><p>Hue goes round the axis, saturation out from it, lightness up it. A wedge is cut away to show the inside; the markers on the rim are the harmony of the hue you pick.</p><canvas></canvas></section>
      <section class="colour-rgb"><h3>RGB</h3><p>Red, green and blue as the three edges of a cube - black at one corner, white at the opposite one, greys on the diagonal between.</p><canvas></canvas></section>
      <section class="colour-mix"><h3>Mixing</h3><p>Light adds: red, green and blue lamps make white where they overlap. Ink and filters multiply: cyan, magenta and yellow make black.</p><canvas></canvas></section>
      <section class="colour-swatches"><h3>Swatches</h3><p>Unlit, they show exactly the colour given. A lit surface doesn't: light and tone mapping are meant to change it, as the lamps' pools show.</p>
        <div class="colour-controls">
          <label>Base hue <input type="range" min="0" max="359" step="1" name="hue"><output></output></label>
          <label>Harmony <select name="harmony">${Object.keys(HARMONIES).map((h) => `<option>${h}</option>`).join('')}</select></label>
        </div><canvas></canvas></section>
    </div>`
  document.body.append(poster)
  const [hslCanvas, rgbCanvas, mixCanvas, swatchCanvas] = poster.querySelectorAll('canvas')

  const settings = { hue: 210, harmony: 'triadic' }
  const copy = (/** @type {string} */ value) => {
    navigator.clipboard?.writeText(value).catch(() => {})
    info.textContent = `Copied ${value}`
  }
  /** @param {string} colour @param {string} [what] */
  const tip = (colour, what) => ({ title: colour, rows: what ? { '': what } : {} })

  // ---- HSL: the cylinder, its harmony, and what is under the pointer
  /** The colour of the cylinder where a hit lands, worked out from where it is. @param {any} hit */
  const hslAt = (hit) => {
    const p = hit.point, r = Math.hypot(p[0], p[2]), h = wrap(Math.atan2(-p[2], p[0]) * 180 / Math.PI)
    // the top and the foot are white and black at any saturation
    const l = Math.min(1, Math.max(0, p[1] / H)), sat = p[1] > H - 1e-3 || p[1] < 1e-3 ? 0 : Math.min(1, r / R)
    return { hex: hex(hsl(h, sat, l)), name: `hsl(${Math.round(h)}, ${Math.round(sat * 100)}%, ${Math.round(l * 100)}%)` }
  }
  const hslView = new View({ canvas: hslCanvas, orbit: { autoRotate: 0.15, pan: false, zoom: false, minPitch: -0.2 }, camera: { fov: 38 },
    tooltip: (hit) => {
      const c = hit?.node === solid ? hslAt(hit) : hit?.datum
      return c?.hex ? tip(c.hex, c.name) : null
    },
  })
  const solid = hslView.scene.add(new Mesh({ geometry: cylinderOf(), material: { unlit: true, vertexColors: true, doubleSided: true }, outline: { color: '#2b2b33', width: 1 } }))
  // from above the cut, so the white top and the inside both show - then closer, as a round thing
  // fills less of the view than the corners of its box, which the fit goes by
  hslView.frame(solid, { direction: [0.6, 0.95, 1], padding: 0.05 })
  hslView.controls?.zoomBy(0.78)
  hslView.on('click', (hit) => { if (hit?.node === solid) copy(hslAt(hit).hex) })
  // the harmony: markers on the rim at half lightness, joined round
  const markers = hslView.scene.add(new InstancedMesh({ geometry: sphere({ radius: 0.11 }), material: { unlit: true }, count: 4, outline: '#ffffff',
    labels: { text: (row) => row.hex, place: 'above', className: 'colour-hex' }, onClick: (hit) => hit.datum && copy(hit.datum.hex) }))
  const ring = hslView.scene.add(new Lines({ geometry: new Geometry({ positions: [] }), material: { color: '#2b2b33', width: 2 }, pickable: false }))
  const callout = (text, position, edge) => hslView.scene.add(new Label({ text, position, edge, leader: true, className: 'colour-callout', overlap: 'show' }))
  callout('Hue - round the axis', [Math.cos(VIEW + CUT * 0.9) * R, H * 0.75, -Math.sin(VIEW + CUT * 0.9) * R], 'right')
  callout('Saturation - out from the axis', [Math.cos(VIEW - CUT / 2) * R * 0.6, H * 0.35, -Math.sin(VIEW - CUT / 2) * R * 0.6], 'left')
  callout('Lightness - up the axis', [0, H * 0.9, 0], 'left')

  // ---- RGB: the cube, its corners named
  const rgbView = new View({ canvas: rgbCanvas, orbit: { autoRotate: 0.15, pan: false, zoom: false }, camera: 'perspective',
    tooltip: (hit) => {
      if (hit?.node !== cube) return null
      const c = [0, 1, 2].map((k) => (hit.point[k] + 1) / 2)
      return tip(hex(c), `rgb(${c.map((v) => Math.round(v * 255)).join(', ')})`)
    },
  })
  const cube = rgbView.scene.add(new Mesh({ geometry: cubeOf(), material: { unlit: true, vertexColors: true }, outline: { color: '#2b2b33', width: 1 } }))
  rgbView.frame(cube, { direction: 'perspective', padding: 0.08 })
  rgbView.on('click', (hit) => { if (hit?.node === cube) copy(hex([0, 1, 2].map((k) => (hit.point[k] + 1) / 2))) })
  CORNERS.forEach(([name, value]) => {
    const c = [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255)
    const at = c.map((v) => (v * 2 - 1) * 1.08)
    rgbView.scene.add(new Label({ text: `${name} ${value}`, position: at, place: c[1] ? 'above' : 'below', className: 'colour-hex', onClick: () => copy(value) }))
  })

  // ---- Mixing: lamps on a dark plate, filters on a white one - seen straight down, and still
  // what covers a point: the lamps' pools add, the filters multiply - the colour the tooltip gives
  const POOL = 4 * Math.tan(0.24), DISC = 0.95
  /** @type {{ x: number, z: number, name: string, rgb: number[] }[]} */
  const pools = [], discs = []
  /** @param {ArrayLike<number>} p */
  const mixAt = (p) => {
    const lit = p[0] < 0
    const over = (lit ? pools : discs).filter((d) => Math.hypot(p[0] - d.x, p[2] - d.z) <= (lit ? POOL : DISC))
    const rgb = lit
      ? over.reduce((sum, d) => sum.map((v, k) => Math.min(1, v + d.rgb[k])), [0, 0, 0])
      : over.reduce((product, d) => product.map((v, k) => v * d.rgb[k]), [1, 1, 1])
    const name = over.length ? over.map((d) => d.name).join(lit ? ' + ' : ' × ') : lit ? 'no light' : 'white paper'
    return { hex: hex(rgb), name }
  }
  const mixView = new View({ canvas: mixCanvas, camera: { position: [0, 10, 0.001], target: [0, 0, 0], fov: 40 }, toneMapping: 'none', autoLight: false,
    tooltip: (hit) => {
      if (!hit) return null
      const c = mixAt(hit.point)
      return tip(c.hex, c.name)
    },
  })
  mixView.on('click', (hit) => { if (hit) copy(mixAt(hit.point).hex) })
  const lamps = mixView.scene.add(new Mesh({ geometry: cylinder({ radius: 2, height: 0.08, segments: 64 }), position: [-2.3, -0.04, 0], material: { color: '#ffffff', roughness: 1 } }))
  const filters = mixView.scene.add(new Mesh({ geometry: cylinder({ radius: 2, height: 0.08, segments: 64 }), position: [2.3, -0.04, 0], material: { color: '#ffffff', unlit: true } }))
  ;[['#ff0000', 90, 'red'], ['#00ff00', 210, 'green'], ['#0000ff', 330, 'blue']].forEach(([color, deg, name], i) => {
    const a = (Number(deg) * Math.PI) / 180, offset = [Math.cos(a) * 0.62, 0, -Math.sin(a) * 0.62]
    const ink = [['#00ffff', 'cyan'], ['#ff00ff', 'magenta'], ['#ffff00', 'yellow']][i]
    const channels = (/** @type {string} */ value) => [1, 3, 5].map((k) => parseInt(value.slice(k, k + 2), 16) / 255)
    pools.push({ x: -2.3 + offset[0], z: offset[2], name: String(name), rgb: channels(String(color)) })
    discs.push({ x: 2.3 + offset[0], z: offset[2], name: ink[1], rgb: channels(ink[0]) })
    // over the lamps' plate: a spot light, its intensity the square of its height, so its pool is fully that colour
    const height = 4
    mixView.scene.add(new SpotLight({ color: String(color), intensity: height * height, position: [-2.3 + offset[0], height, offset[2]],
      target: [-2.3 + offset[0], 0, offset[2]], angle: 0.24, penumbra: 0.25 }))
    // over the filters' plate: a disc that multiplies what is behind it
    mixView.scene.add(new Mesh({ geometry: cylinder({ radius: DISC, height: 0.01, segments: 64 }), position: [2.3 + offset[0], 0.02 + i * 0.005, offset[2]],
      material: { color: ink[0], unlit: true, blending: 'multiply' } }))
  })
  void lamps
  void filters
  mixView.scene.add(new Label({ text: 'Light adds', position: [-2.3, 0, 2.2], place: 'below', className: 'colour-callout' }))
  mixView.scene.add(new Label({ text: 'Filters multiply', position: [2.3, 0, 2.2], place: 'below', className: 'colour-callout' }))
  // room below the plates for their names
  mixView.frame(undefined, { padding: 0.3 })

  // ---- Swatches: primaries, the harmony, and tints, tones and shades of the hue - eight to a row,
  // or four on a phone (in the taller box it has there), each group named above its first row
  const SIZE = 0.8, GAP = 1, PITCH = 0.95, MOST = 24
  const swatchView = new View({ canvas: swatchCanvas, camera: 'front', framing: 'both' })
  const swatches = swatchView.scene.add(new InstancedMesh({ geometry: box({ width: SIZE, height: SIZE * 0.62, depth: 0.05 }), material: { unlit: true }, count: MOST,
    onClick: (hit) => hit.datum && copy(hit.datum.hex) }))
  // each swatch's hex just under it - its own label, so a click on it copies it too
  const hexes = Array.from({ length: MOST }, () => swatchView.scene.add(new Label({ text: '', place: 'below', className: 'colour-hex', overlap: 'show' })))
  hexes.forEach((label) => { label.onClick = () => copy(label.text) })
  const groupNames = ['Primaries', 'Harmony', 'Tints, tones, shades'].map((text) => swatchView.scene.add(new Label({ text, place: 'right', className: 'colour-row', overlap: 'show' })))
  swatchView.tooltip((hit) => (hit?.datum?.hex ? tip(hit.datum.hex, hit.datum.name) : null))
  const columns = () => (swatchCanvas.clientWidth >= 480 ? 8 : 4)

  /** Lay the swatches out for the view's width, and fit the view round them, names and hexes too. @param {string[][][]} groups */
  const layOut = (groups) => {
    const cols = columns(), left = -((cols - 1) / 2) * GAP
    /** @type {{ name: string, hex: string }[]} */
    const all = []
    let y = 0
    groups.forEach((list, g) => {
      groupNames[g].position = [left - SIZE / 2, y + 0.06, 0]
      y -= 0.42
      list.forEach(([name, value], k) => {
        const i = all.length, position = [left + (k % cols) * GAP, y - Math.floor(k / cols) * PITCH, 0]
        all.push({ name, hex: value })
        swatches.setInstance(i, { position, color: value })
        hexes[i].position = [position[0], position[1] - SIZE * 0.31, 0]
        hexes[i].text = value
      })
      y -= Math.ceil(list.length / cols) * PITCH
    })
    hexes.forEach((label, i) => { label.visible = i < all.length })
    swatches.count = all.length
    swatches.data = all
    swatchView.frame(new Box3([left - SIZE / 2, y + PITCH - 0.62, 0], [-left + SIZE / 2, 0.24, 0]), { padding: 0.04 })
  }
  /** @type {string[][][]} */
  let groups = []
  // narrower or wider: the rows break differently
  let laidFor = 0
  new ResizeObserver(() => {
    if (columns() === laidFor) return
    laidFor = columns()
    layOut(groups)
  }).observe(swatchCanvas)

  /** Recolour everything that follows the chosen hue and harmony. */
  const apply = () => {
    const hues = HARMONIES[settings.harmony].map((d) => wrap(settings.hue + d))
    // the harmony on the cylinder
    const rows = hues.map((h, i) => ({ hex: hex(hsl(h, 1, 0.5)), name: i ? `${settings.harmony}` : 'base hue' }))
    markers.count = hues.length
    hues.forEach((h, i) => {
      const a = (h * Math.PI) / 180
      markers.setInstance(i, { position: [Math.cos(a) * (R + 0.16), H / 2, -Math.sin(a) * (R + 0.16)], color: rows[i].hex })
    })
    markers.data = rows
    const loop = hues.length > 1 ? hues : []
    ring.geometry = new Geometry({ positions: loop.flatMap((h, i) => {
      const a = (h * Math.PI) / 180, b = (loop[(i + 1) % loop.length] * Math.PI) / 180
      return [Math.cos(a) * (R + 0.16), H / 2, -Math.sin(a) * (R + 0.16), Math.cos(b) * (R + 0.16), H / 2, -Math.sin(b) * (R + 0.16)]
    }) })
    // the swatches
    const base = settings.hue
    const primaries = [['red', '#ff0000'], ['yellow', '#ffff00'], ['green', '#00ff00'], ['cyan', '#00ffff'], ['blue', '#0000ff'], ['magenta', '#ff00ff'], ['black', '#000000'], ['white', '#ffffff']]
    const harmony = hues.flatMap((h) => [[`hue ${Math.round(h)}`, hex(hsl(h, 1, 0.5))], [`hue ${Math.round(h)}, muted`, hex(hsl(h, 0.45, 0.5))]]).slice(0, 8)
    const family = [
      ...[0.85, 0.72].map((l) => [`tint, lightness ${l * 100}%`, hex(hsl(base, 1, l))]),
      ...[0.7, 0.4, 0.15].map((s) => [`tone, saturation ${Math.round(s * 100)}%`, hex(hsl(base, s, 0.5))]),
      ...[0.35, 0.22, 0.1].map((l) => [`shade, lightness ${Math.round(l * 100)}%`, hex(hsl(base, 1, l))]),
    ]
    groups = [primaries, harmony, family]
    laidFor = columns()
    layOut(groups)
  }
  apply()

  // the poster's own settings, beside the swatches they change
  const hueInput = /** @type {HTMLInputElement} */ (poster.querySelector('input[name=hue]'))
  const hueOut = /** @type {HTMLOutputElement} */ (poster.querySelector('.colour-controls output'))
  const harmonyInput = /** @type {HTMLSelectElement} */ (poster.querySelector('select[name=harmony]'))
  hueInput.value = String(settings.hue)
  hueOut.textContent = `${settings.hue}°`
  harmonyInput.value = settings.harmony
  hueInput.addEventListener('input', () => {
    settings.hue = Number(hueInput.value)
    hueOut.textContent = `${settings.hue}°`
    apply()
  })
  harmonyInput.addEventListener('change', () => {
    settings.harmony = harmonyInput.value
    apply()
  })
  // no panel: the settings are on the poster
  void gui

  info.textContent = 'Hover a colour to read it; click a swatch, a marker or a hex to copy it'
  if (import.meta.env.DEV) Object.assign(window, { views: [hslView, rgbView, mixView, swatchView] })
  return hslView
}
