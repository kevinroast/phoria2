// The perf harness: the same scenes built in phoria2 and in three.js, timed the same way. Frame
// times render and then read one pixel back from every context drawn, so they include the GPU's
// work, not just the calls that queue it. Like for like: both tone map with Khronos PBR Neutral,
// both draw round points, and a "first frame" is the first complete picture - for phoria2, whose
// shaders compile in the background, the first frame with every program ready. Run from perf.html (the Run button, or ?auto), or headless with `npm run perf`.
import * as P from 'phoria2'
import * as THREE from 'three'

const WIDTH = 800, HEIGHT = 600
const BARS = 100_000, POINTS = 1_000_000, VIEWS = 20, TILE_BARS = 400
const stage = /** @type {HTMLElement} */ (document.getElementById('stage'))
const status = /** @type {HTMLElement} */ (document.getElementById('status'))
const table = /** @type {HTMLTableElement} */ (document.getElementById('results'))

/** @type {{ done: boolean, results: { scene: string, metric: string, unit: string, phoria2: number | null, three: number | null }[], env: Record<string, string> }} */
const perf = { done: false, results: [], env: {} }
// @ts-ignore - read by perf/run.mjs
window.__perf = perf

const pixel = new Uint8Array(4)
/** Wait for the GPU: reading a pixel back can't finish before the drawing has. @param {WebGL2RenderingContext} gl */
const sync = (gl) => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1]
const nextFrame = () => new Promise((r) => setTimeout(r, 0))

/**
 * Median ms of fn() with the GPU waited for.
 * @param {() => void} fn @param {WebGL2RenderingContext | WebGL2RenderingContext[]} contexts every context drawn
 */
async function frames(fn, contexts, n = 30) {
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
function canvas(w = WIDTH, h = HEIGHT, x = 0, y = 0) {
  const c = document.createElement('canvas')
  Object.assign(c.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` })
  stage.append(c)
  return c
}

/** @param {string} scene @param {string} metric @param {string} unit @param {number | null} phoria2 @param {number | null} three */
function record(scene, metric, unit, phoria2, three) {
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

// a grid of bars, heights from the index
/** @param {number} n @param {number} i */
function bar(n, i) {
  const side = Math.ceil(Math.sqrt(n))
  return { x: (i % side) - side / 2, z: Math.floor(i / side) - side / 2, h: 1 + ((i * 7919) % 13) }
}
/** Fill 16-number matrices for n bars. @param {Float32Array} m @param {number} n @param {number} t */
function fillBars(m, n, t = 0) {
  for (let i = 0; i < n; i++) {
    const { x, z, h } = bar(n, i)
    const height = h * (0.75 + 0.25 * Math.sin(t + i * 0.01))
    const o = i * 16
    m.fill(0, o, o + 16)
    m[o] = 0.8; m[o + 5] = height; m[o + 10] = 0.8; m[o + 15] = 1
    m[o + 12] = x; m[o + 13] = height / 2; m[o + 14] = z
  }
}

// --- phoria2 and three.js builders for the same scenes ---

/** Draw until the picture is complete - every shader compiled - and the GPU done. @param {any} view */
async function firstPicture(view) {
  view.render()
  while (view.renderer.info.compiling) {
    await new Promise((r) => setTimeout(r, 1))
    view.render()
  }
  sync(view.renderer.gl)
}

function phoriaView(c, camera = { position: [0, 140, 300], target: [0, 0, 0] }) {
  const view = new P.View({ canvas: c, renderMode: 'manual', pixelRatio: 1, autoLight: false, camera: { ...camera, far: 2000 } })
  view.scene.add(new P.HemisphereLight({ sky: '#ffffff', ground: '#444444', intensity: 0.6 }))
  view.scene.add(new P.DirectionalLight({ direction: [-1, -2, -1], intensity: 1.4 }))
  return view
}
function phoriaBars(view, n) {
  const bars = view.scene.add(new P.InstancedMesh({ geometry: P.box(1), material: { color: '#4a90e2', roughness: 0.5 }, count: n }))
  fillBars(bars.instanceMatrices, n)
  bars.needsUpdate()
  return bars
}
function threeRenderer(c) {
  const renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true })
  // phoria2's default tone mapping, so both do the same work per pixel
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.setPixelRatio(1)
  renderer.setSize(parseFloat(c.style.width), parseFloat(c.style.height), false)
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.6 * Math.PI))
  const sun = new THREE.DirectionalLight(0xffffff, 1.4 * Math.PI)
  sun.position.set(1, 2, 1)
  scene.add(sun)
  const camera = new THREE.PerspectiveCamera(50, parseFloat(c.style.width) / parseFloat(c.style.height), 0.1, 2000)
  camera.position.set(0, 140, 300)
  camera.lookAt(0, 0, 0)
  return { renderer, scene, camera, gl: /** @type {WebGL2RenderingContext} */ (renderer.getContext()) }
}
function threeBars(scene, n) {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#4a90e2', roughness: 0.5 }), n)
  fillBars(/** @type {Float32Array} */ (mesh.instanceMatrix.array), n)
  mesh.instanceMatrix.needsUpdate = true
  scene.add(mesh)
  return mesh
}
/** A white disc, for three.js round points. */
function roundSprite() {
  const c = document.createElement('canvas')
  c.width = c.height = 32
  const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'))
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(16, 16, 15.5, 0, Math.PI * 2)
  ctx.fill()
  return new THREE.CanvasTexture(c)
}

function disposeThree(t) {
  t.renderer.dispose()
  t.renderer.forceContextLoss()
  t.renderer.domElement.remove()
}

// --- the scenes ---

async function bars() {
  // phoria2
  let c = canvas()
  let t0 = performance.now()
  const view = phoriaView(c)
  const pbars = phoriaBars(view, BARS)
  await firstPicture(view)
  const pBuild = performance.now() - t0
  const pFrame = await frames(() => view.render(), view.renderer.gl)
  const pUpdate = await frames(() => {
    fillBars(pbars.instanceMatrices, BARS, performance.now() / 1000)
    pbars.needsUpdate()
  }, view.renderer.gl, 10)
  const pUpdateFrame = await frames(() => {
    fillBars(pbars.instanceMatrices, BARS, performance.now() / 1000)
    pbars.needsUpdate()
    view.render()
  }, view.renderer.gl, 15)

  // picking: phoria2 on the GPU - what the main thread spends on a hover, and a click's full wait
  const points = Array.from({ length: 12 }, (_, i) => [80 + ((i * 263) % 640), 80 + ((i * 151) % 440)])
  view.pick(points[0][0], points[0][1])
  await new Promise((r) => setTimeout(r, 300))
  view.render()
  const hover = [], click = []
  for (const [x, y] of points) {
    let t = performance.now()
    const request = view.renderer.pickAsync(/** @type {any} */ (view.lastFrame), x, y)
    hover.push(performance.now() - t)
    await request
    t = performance.now()
    view.pick(x, y)
    click.push(performance.now() - t)
  }
  view.dispose()
  c.remove()

  // three.js
  c = canvas()
  t0 = performance.now()
  const t = threeRenderer(c)
  const tbars = threeBars(t.scene, BARS)
  t.renderer.render(t.scene, t.camera)
  sync(t.gl)
  const tBuild = performance.now() - t0
  const tFrame = await frames(() => t.renderer.render(t.scene, t.camera), t.gl)
  const tUpdate = await frames(() => {
    fillBars(/** @type {Float32Array} */ (tbars.instanceMatrix.array), BARS, performance.now() / 1000)
    tbars.instanceMatrix.needsUpdate = true
  }, t.gl, 10)
  const tUpdateFrame = await frames(() => {
    fillBars(/** @type {Float32Array} */ (tbars.instanceMatrix.array), BARS, performance.now() / 1000)
    tbars.instanceMatrix.needsUpdate = true
    t.renderer.render(t.scene, t.camera)
  }, t.gl, 15)
  const raycaster = new THREE.Raycaster()
  const tPick = []
  for (const [x, y] of points) {
    const time = performance.now()
    raycaster.setFromCamera(new THREE.Vector2((x / WIDTH) * 2 - 1, 1 - (y / HEIGHT) * 2), t.camera)
    raycaster.intersectObject(tbars)
    tPick.push(performance.now() - time)
  }
  disposeThree(t)

  record('100k bars', 'build + first frame', 'ms', pBuild, tBuild)
  record('100k bars', 'frame', 'ms', pFrame, tFrame)
  record('100k bars', 'update every bar (CPU)', 'ms', pUpdate, tUpdate)
  record('100k bars', 'update every bar + frame', 'ms', pUpdateFrame, tUpdateFrame)
  record('100k bars', 'hover pick, main thread', 'ms', median(hover), median(tPick))
  record('100k bars', 'click pick, waited', 'ms', median(click), median(tPick))
}

async function points() {
  const positions = new Float32Array(POINTS * 3)
  let seed = 1
  for (let i = 0; i < positions.length; i++) {
    seed = (seed * 16807) % 2147483647
    positions[i] = (seed / 2147483647 - 0.5) * 200
  }
  let c = canvas()
  let t0 = performance.now()
  const view = phoriaView(c)
  view.scene.add(new P.Points({ geometry: new P.Geometry({ positions }), material: { color: '#9cf', size: 2, sizeAttenuation: false } }))
  await firstPicture(view)
  const pBuild = performance.now() - t0
  const pFrame = await frames(() => view.render(), view.renderer.gl)
  view.dispose()
  c.remove()

  c = canvas()
  t0 = performance.now()
  const t = threeRenderer(c)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  // phoria2's points are round, so three's get a round sprite (its default is square)
  t.scene.add(new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#9cf', size: 2, sizeAttenuation: false, map: roundSprite(), alphaTest: 0.5 })))
  t.renderer.render(t.scene, t.camera)
  sync(t.gl)
  const tBuild = performance.now() - t0
  const tFrame = await frames(() => t.renderer.render(t.scene, t.camera), t.gl)
  disposeThree(t)

  record('1M points', 'build + first frame', 'ms', pBuild, tBuild)
  record('1M points', 'frame', 'ms', pFrame, tFrame)
}

async function views() {
  const cols = 5, w = WIDTH / cols, h = HEIGHT / (VIEWS / cols)
  /** @param {(c: HTMLCanvasElement) => any} make */
  const grid = (make) => Array.from({ length: VIEWS }, (_, i) => make(canvas(w, h, (i % cols) * w, Math.floor(i / cols) * h)))
  const lostCount = () => {
    let lost = 0
    for (const c of stage.querySelectorAll('canvas')) c.addEventListener('webglcontextlost', () => lost++)
    return () => lost
  }

  let t0 = performance.now()
  const tiles = grid((c) => {
    const view = phoriaView(c, { position: [0, 30, 60], target: [0, 0, 0] })
    phoriaBars(view, TILE_BARS)
    return view
  })
  // all at once, as a dashboard would: start every view, then wait until every picture is complete
  tiles.forEach((v) => v.render())
  while (tiles.some((v) => v.renderer.info.compiling)) {
    await new Promise((r) => setTimeout(r, 1))
    tiles.forEach((v) => v.renderer.info.compiling && v.render())
  }
  new Set(tiles.map((v) => v.renderer.gl)).forEach(sync)
  const pBuild = performance.now() - t0
  const pLost = lostCount()
  const pContexts = [...new Set(tiles.map((v) => v.renderer.gl))]
  const pAll = await frames(() => tiles.forEach((v) => v.render()), pContexts, 10)
  const contexts = pContexts.length
  const pDrawn = tiles.filter((v) => !v.renderer.gl.isContextLost()).length
  await new Promise((r) => setTimeout(r, 300))
  const pLostCount = pLost()
  tiles.forEach((v) => v.dispose())
  stage.replaceChildren()

  t0 = performance.now()
  const threes = grid((c) => {
    const t = threeRenderer(c)
    t.camera.position.set(0, 30, 60)
    t.camera.lookAt(0, 0, 0)
    threeBars(t.scene, TILE_BARS)
    t.renderer.render(t.scene, t.camera)
    return t
  })
  const tLost = lostCount()
  threes.forEach((t) => sync(t.gl))
  const tBuild = performance.now() - t0
  // only contexts still alive draw; waiting on a lost one returns at once
  const tAll = await frames(() => threes.forEach((t) => t.renderer.render(t.scene, t.camera)), threes.map((t) => t.gl), 10)
  await new Promise((r) => setTimeout(r, 300))
  const tLostCount = tLost()
  const tDrawn = threes.filter((t) => !t.gl.isContextLost()).length
  threes.forEach(disposeThree)
  stage.replaceChildren()

  record(`${VIEWS} views`, 'build + first frames', 'ms', pBuild, tBuild)
  record(`${VIEWS} views`, 'redraw all', 'ms', pAll, tAll)
  record(`${VIEWS} views`, 'views that drew', 'count', pDrawn, tDrawn)
  record(`${VIEWS} views`, 'WebGL contexts', 'count', contexts, VIEWS)
  record(`${VIEWS} views`, 'contexts lost', 'count', pLostCount, tLostCount)
}

async function run() {
  const button = /** @type {HTMLButtonElement} */ (document.getElementById('run'))
  button.disabled = true
  table.replaceChildren()
  const head = table.createTHead().insertRow()
  for (const h of ['scene', 'metric', 'unit', 'phoria2', 'three.js', 'three / phoria2']) head.append(Object.assign(document.createElement('th'), { textContent: h }))
  const probe = /** @type {WebGL2RenderingContext} */ (document.createElement('canvas').getContext('webgl2'))
  const info = probe.getExtension('WEBGL_debug_renderer_info')
  perf.env = {
    gpu: info ? probe.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown',
    userAgent: navigator.userAgent,
    three: THREE.REVISION,
    date: new Date().toISOString(),
  }
  probe.getExtension('WEBGL_lose_context')?.loseContext()
  for (const [name, scene] of [['100k bars', bars], ['1M points', points], [`${VIEWS} views`, views]]) {
    status.textContent = `running ${name}...`
    await nextFrame()
    await /** @type {() => Promise<void>} */ (scene)()
  }
  status.textContent = `done - ${perf.env.gpu}`
  button.disabled = false
  perf.done = true
}

document.getElementById('run')?.addEventListener('click', run)
if (new URLSearchParams(location.search).has('auto')) run()
