// What every perf scene shares: the page's stage and results table, timing with the GPU waited for,
// recording a result, a picture of each library's frame (?pictures, to see both draw the same
// thing), and plain phoria2 and three.js setups lit the same way. Like for like: both tone map with
// Khronos PBR Neutral at 800 x 600 and pixel ratio 1, and light intensities match (three.js's are π
// times phoria2's, its physical units against phoria2's).
import * as P from 'phoria2'
import * as THREE from 'three'

export const WIDTH = 800, HEIGHT = 600
export const stage = /** @type {HTMLElement} */ (document.getElementById('stage'))
const table = /** @type {HTMLTableElement} */ (document.getElementById('results'))

/**
 * What the run found, read by perf/run.mjs: results, the environment, and - with ?pictures - a PNG
 * of each scene as each library drew it.
 * @type {{ done: boolean, results: { scene: string, metric: string, unit: string, phoria2: number | null, three: number | null }[], env: Record<string, string>, pictures: Record<string, string> }}
 */
export const perf = { done: false, results: [], env: {}, pictures: {} }
// @ts-ignore - read by perf/run.mjs
window.__perf = perf
const params = new URLSearchParams(location.search)
const wantPictures = params.has('pictures')

const pixel = new Uint8Array(4)
/** Wait for the GPU: reading a pixel back can't finish before the drawing has. @param {WebGL2RenderingContext} gl */
export const sync = (gl) => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
export const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1]
export const nextFrame = () => new Promise((r) => setTimeout(r, 0))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Median ms of fn() with the GPU waited for.
 * @param {() => void} fn @param {WebGL2RenderingContext | WebGL2RenderingContext[]} contexts every context drawn
 */
export async function frames(fn, contexts, n = 30) {
  const all = [contexts].flat()
  const syncAll = () => all.forEach(sync)
  for (let i = 0; i < 3; i++) fn()
  syncAll()
  const times = []
  for (let i = 0; i < n; i++) {
    const t = performance.now()
    fn()
    syncAll()
    times.push(performance.now() - t)
    if (i % 10 === 9) await nextFrame()
  }
  return median(times)
}

/** @param {number} w @param {number} h @param {number} [x] @param {number} [y] */
export function canvas(w = WIDTH, h = HEIGHT, x = 0, y = 0) {
  const c = document.createElement('canvas')
  Object.assign(c.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` })
  stage.append(c)
  return c
}

/** @param {string} scene @param {string} metric @param {string} unit @param {number | null} phoria2 @param {number | null} three */
export function record(scene, metric, unit, phoria2, three) {
  perf.results.push({ scene, metric, unit, phoria2, three })
  const row = table.insertRow()
  const cell = (text, win = false) => {
    const td = row.insertCell()
    td.textContent = text
    if (win) td.className = 'win'
  }
  const fmt = (v) => (v === null ? '-' : v >= 100 ? v.toFixed(0) : v.toFixed(2))
  cell(scene)
  cell(metric)
  cell(unit)
  const better = phoria2 !== null && three !== null ? (phoria2 <= three ? 'p' : 't') : ''
  cell(fmt(phoria2), better === 'p')
  cell(fmt(three), better === 't')
  cell(phoria2 && three ? `${(three / phoria2).toFixed(1)}x` : '')
}

/**
 * With ?pictures, keep what a canvas shows - called straight after drawing, before the browser
 * presents and clears it. @param {string} name @param {HTMLCanvasElement} c
 */
export function picture(name, c) {
  if (wantPictures) perf.pictures[name] = c.toDataURL('image/png')
}

/** Draw until the picture is complete - every shader compiled - and the GPU done. @param {any} view */
export async function firstPicture(view) {
  view.render()
  while (view.renderer.info.compiling) {
    await new Promise((r) => setTimeout(r, 1))
    view.render()
  }
  sync(view.renderer.gl)
}

/**
 * Draw until nothing more is coming: no shader compiling, and no part loaded since the last frame
 * (shadows, effects, an environment's prefiltering - each loads the first time a scene has one).
 * Resolves with the time the last frame that changed anything was done.
 * @param {any} view
 * @returns {Promise<number>}
 */
export async function complete(view) {
  const renderer = view.renderer, before = renderer.onReady
  let loaded = true, done = performance.now()
  /** @type {(() => void) | null} */
  let wake = null
  renderer.onReady = () => {
    loaded = true
    wake?.()
    before?.()
  }
  for (let i = 0; i < 400 && (loaded || renderer.info.compiling); i++) {
    loaded = false
    view.render()
    sync(renderer.gl)
    done = performance.now()
    // shaders: check again shortly; otherwise wait for a part to load - drawn again the moment one
    // does, or, with nothing coming, finished (that last wait isn't counted)
    if (renderer.info.compiling) await sleep(1)
    else await new Promise((r) => { wake = r; setTimeout(r, 300) })
    wake = null
  }
  renderer.onReady = before
  return done
}

/** A phoria2 view at 800 x 600, drawn when asked, with a sky light and a sun. */
export function phoriaView(c, camera = { position: [0, 140, 300], target: [0, 0, 0] }) {
  const view = phoriaBare(c, camera)
  view.scene.add(new P.HemisphereLight({ sky: '#ffffff', ground: '#444444', intensity: 0.6 }))
  view.scene.add(new P.DirectionalLight({ direction: [-1, -2, -1], intensity: 1.4 }))
  return view
}

/**
 * A phoria2 view with no lights of its own, on black - as three.js clears, so both fill every pixel.
 * @param {HTMLCanvasElement} c @param {object} camera @param {object} [options]
 */
export function phoriaBare(c, camera, options = {}) {
  return new P.View({ canvas: c, renderMode: 'manual', pixelRatio: 1, autoLight: false, background: '#000000', camera: { ...camera, far: 2000 }, ...options })
}

/** The three.js side: a renderer, a scene with a sky light and a sun, and a camera. */
export function threeRenderer(c) {
  const t = threeBare(c, [0, 140, 300])
  t.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.6 * Math.PI))
  const sun = new THREE.DirectionalLight(0xffffff, 1.4 * Math.PI)
  sun.position.set(1, 2, 1)
  t.scene.add(sun)
  return t
}

/**
 * A three.js renderer, scene and camera with no lights. @param {HTMLCanvasElement} c
 * @param {number[]} position @param {number[]} [target]
 */
export function threeBare(c, position, target = [0, 0, 0]) {
  const renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true })
  // phoria2's default tone mapping, so both do the same work per pixel
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.setPixelRatio(1)
  renderer.setSize(parseFloat(c.style.width), parseFloat(c.style.height), false)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(50, parseFloat(c.style.width) / parseFloat(c.style.height), 0.1, 2000)
  camera.position.set(position[0], position[1], position[2])
  camera.lookAt(target[0], target[1], target[2])
  return { renderer, scene, camera, gl: /** @type {WebGL2RenderingContext} */ (renderer.getContext()) }
}

/** A white disc, for three.js round points. */
export function roundSprite() {
  const c = document.createElement('canvas')
  c.width = c.height = 32
  const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'))
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(16, 16, 15.5, 0, Math.PI * 2)
  ctx.fill()
  return new THREE.CanvasTexture(c)
}

export function disposeThree(t) {
  t.renderer.dispose()
  t.renderer.forceContextLoss()
  t.renderer.domElement.remove()
}

/** n positions in a cube 200 across, the same every run. @param {number} n */
export function cloud(n) {
  const positions = new Float32Array(n * 3)
  let seed = 1
  for (let i = 0; i < positions.length; i++) {
    seed = (seed * 16807) % 2147483647
    positions[i] = (seed / 2147483647 - 0.5) * 200
  }
  return positions
}

/** A camera position on a circle round the middle, a little further on each call. @param {number} [radius] @param {number} [height] */
export function orbiter(radius = 300, height = 140) {
  let a = 0
  return () => {
    a += 0.01
    return [Math.sin(a) * radius, height, Math.cos(a) * radius]
  }
}

/** Seeded random numbers in [0, 1), the same every run. @param {number} [seed] */
export function random(seed = 7) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647
}
