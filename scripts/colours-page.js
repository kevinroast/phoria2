// The colour check: known colours drawn every way the library colours a surface - material colours,
// instance colours, vertex colours, textures, transparency, the background - each read back from its
// view's picture (view.toImage(), what an app exports) and compared with what it should be, within
// 1 in 255 for rounding. Swatches are sampled in their middles, clear of antialiased edges. A lit
// swatch is measured too, but only reported: light and tone mapping are meant to change colour.
// Run from colours.html, or headless with `npm run colours`.
import { DirectionalLight, Geometry, InstancedMesh, Lines, Mesh, OrthographicCamera, Points, Texture, View, plane } from '../src/index.js'

const COLOURS = ['#e15759', '#4e79a7', '#7f7f7f', '#010203', '#fefdfc']
const BACKGROUND = '#204060'
const SPACING = 1.2
const stage = /** @type {HTMLElement} */ (document.getElementById('stage'))
const table = /** @type {HTMLTableElement} */ (document.getElementById('results'))

/** @typedef {{ check: string, swatch: string, expected: number[] | null, got: number[], ok: boolean | null }} Result */
/** @type {{ done: boolean, results: Result[], error: string | null }} */
const out = { done: false, results: [], error: null }
// @ts-ignore - read by scripts/colours.mjs
window.__colours = out

// the library's own conversions, in the shader's words
const toLinear = (/** @type {number} */ c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toSrgb = (/** @type {number} */ c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)
const bytes = (/** @type {string} */ hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

/**
 * A view of a row of swatches seen straight down, at a pixel ratio of 1, so a swatch's middle is a
 * known pixel of the picture.
 * @param {import('../src/View.js').ViewOptions} [options]
 */
function viewOf(options = {}) {
  const canvas = document.createElement('canvas')
  stage.append(canvas)
  const view = new View({
    canvas, pixelRatio: 1, background: BACKGROUND, renderMode: 'manual', context: 'own',
    camera: new OrthographicCamera({ height: 1.4, position: [0, 10, 0.001], target: [0, 0, 0] }), ...options,
  })
  return view
}

/** Where swatch i of n sits. @param {number} i @param {number} n @returns {[number, number, number]} */
const at = (i, n) => [(i - (n - 1) / 2) * SPACING, 0, 0]

/** One unlit plane per colour, made by `make`. @param {View} view @param {(hex: string, i: number) => Mesh} make */
function row(view, make) {
  COLOURS.forEach((hex, i) => {
    const mesh = make(hex, i)
    mesh.position.copy(at(i, COLOURS.length))
    view.scene.add(mesh)
  })
}

/**
 * Read a view's picture back, and compare each swatch's middle - and the background, in a corner -
 * with what it should be.
 * @param {string} check @param {View} view @param {(number[] | null)[]} expected one per swatch; null only reports
 */
async function compare(check, view, expected) {
  const blob = await view.toImage()
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  const ctx = /** @type {OffscreenCanvasRenderingContext2D} */ (new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d'))
  ctx.drawImage(bitmap, 0, 0)
  const pixel = (/** @type {number} */ x, /** @type {number} */ y) => [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3)]
  const record = (/** @type {string} */ swatch, /** @type {number[] | null} */ want, /** @type {number[]} */ got) => {
    const ok = want ? want.every((v, k) => Math.abs(v - got[k]) <= 1) : null
    out.results.push({ check, swatch, expected: want, got, ok })
  }
  expected.forEach((want, i) => {
    const { x, y } = view.project(at(i, expected.length))
    record(COLOURS[i] ?? `#${i}`, want, pixel(x, y))
  })
  record('background', bytes(BACKGROUND), pixel(4, 4))
}

const unlit = (/** @type {string} */ color) => new Mesh({ geometry: plane(1), material: { color, unlit: true } })

async function run() {
  // plain colours, unlit: drawn exactly, tone mapping or not - unlit skips it
  for (const toneMapping of /** @type {const} */ (['neutral', 'none'])) {
    const view = viewOf({ toneMapping })
    row(view, (hex) => unlit(hex))
    await compare(`unlit material, tone mapping '${toneMapping}'`, view, COLOURS.map(bytes))
  }

  // the same through the page's shared context, whose picture is copied into the view's own canvas
  {
    const view = viewOf({ context: 'shared' })
    row(view, (hex) => unlit(hex))
    await compare('unlit material, shared context', view, COLOURS.map(bytes))
  }

  // instance colours on a white material
  {
    const view = viewOf()
    const n = COLOURS.length
    const swatches = view.scene.add(new InstancedMesh({ geometry: plane(1), material: { unlit: true }, count: n }))
    COLOURS.forEach((hex, i) => swatches.setInstance(i, { position: at(i, n), color: hex }))
    await compare('instance colours', view, COLOURS.map(bytes))
  }

  // an instance colour multiplies the material's, in linear light
  {
    const view = viewOf()
    const n = COLOURS.length, tint = '#c08040'
    const swatches = view.scene.add(new InstancedMesh({ geometry: plane(1), material: { unlit: true, color: tint }, count: n }))
    COLOURS.forEach((hex, i) => swatches.setInstance(i, { position: at(i, n), color: hex }))
    const t = bytes(tint)
    const product = (/** @type {string} */ hex) => bytes(hex).map((v, k) => Math.round(toSrgb(toLinear(v / 255) * toLinear(t[k] / 255)) * 255))
    await compare(`instance colour x material colour ${tint}`, view, COLOURS.map(product))
  }

  // vertex colours, the same at every corner of a swatch
  {
    const view = viewOf()
    row(view, (hex) => {
      const square = plane(1)
      const c = bytes(hex).map((v) => v / 255)
      const colors = Array.from({ length: square.vertexCount }, () => c).flat()
      const geometry = new Geometry({ positions: square.positions, normals: square.normals ?? undefined, uvs: square.uvs ?? undefined, indices: square.indices ?? undefined, colors })
      return new Mesh({ geometry, material: { unlit: true, vertexColors: true } })
    })
    await compare('vertex colours', view, COLOURS.map(bytes))
  }

  // a colour map: an sRGB texture of one colour per swatch
  {
    const view = viewOf()
    row(view, (hex) => {
      const image = document.createElement('canvas')
      image.width = image.height = 4
      const ctx = /** @type {CanvasRenderingContext2D} */ (image.getContext('2d'))
      ctx.fillStyle = hex
      ctx.fillRect(0, 0, 4, 4)
      return new Mesh({ geometry: plane(1), material: { unlit: true, map: new Texture({ image, filter: 'nearest', mipmaps: false }) } })
    })
    await compare('colour map (sRGB texture)', view, COLOURS.map(bytes))
  }

  // lines and points, which have shaders of their own: a thick dash and a big dot per swatch
  {
    const view = viewOf()
    const n = COLOURS.length
    COLOURS.forEach((hex, i) => {
      const [x] = at(i, n)
      view.scene.add(new Lines({ geometry: new Geometry({ positions: [x - 0.4, 0, 0, x + 0.4, 0, 0] }), material: { color: hex, width: 24 } }))
    })
    await compare('lines', view, COLOURS.map(bytes))
  }
  {
    const view = viewOf()
    const n = COLOURS.length
    COLOURS.forEach((hex, i) => {
      view.scene.add(new Points({ geometry: new Geometry({ positions: at(i, n) }), material: { color: hex, size: 40, sizeAttenuation: false } }))
    })
    await compare('points', view, COLOURS.map(bytes))
  }

  // half transparent over the background: blended as the page blends, in sRGB
  {
    const view = viewOf()
    row(view, (hex) => new Mesh({ geometry: plane(1), material: { color: hex, unlit: true, opacity: 0.5 } }))
    const bg = bytes(BACKGROUND)
    await compare('opacity 0.5 over the background', view, COLOURS.map((hex) => bytes(hex).map((v, k) => Math.round((v + bg[k]) / 2))))
  }

  // multiplied over the background, as a colour filter: the picture's colours multiply
  {
    const view = viewOf()
    row(view, (hex) => new Mesh({ geometry: plane(1), material: { color: hex, unlit: true, blending: 'multiply' } }))
    const bg = bytes(BACKGROUND)
    await compare('multiply over the background', view, COLOURS.map((hex) => bytes(hex).map((v, k) => Math.round(v * bg[k] / 255))))
  }

  // lit: a sun straight down on matt swatches - reported, not checked, as light and tone mapping
  // are meant to change what is drawn
  for (const toneMapping of /** @type {const} */ (['none', 'neutral'])) {
    const view = viewOf({ toneMapping })
    view.scene.add(new DirectionalLight({ direction: [0, -1, 0], intensity: 1 }))
    row(view, (hex) => new Mesh({ geometry: plane(1), material: { color: hex, roughness: 1, metalness: 0 } }))
    await compare(`lit, tone mapping '${toneMapping}' (reported only)`, view, COLOURS.map(() => null))
  }

  const hex = (/** @type {number[] | null} */ c) => (c ? `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}` : '-')
  table.innerHTML = '<tr><th>check</th><th>swatch</th><th>expected</th><th>got</th><th></th></tr>' + out.results.map((r) =>
    `<tr><td>${r.check}</td><td>${r.swatch}</td><td>${hex(r.expected)}</td><td>${hex(r.got)}</td><td class="${r.ok === false ? 'bad' : ''}">${r.ok === null ? '' : r.ok ? 'ok' : 'off'}</td></tr>`).join('')
}

run().catch((e) => { out.error = String(e?.stack ?? e) }).finally(() => { out.done = true })
