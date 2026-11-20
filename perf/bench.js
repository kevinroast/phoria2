// The perf harness: the same scenes built in phoria2 and in three.js, timed the same way. Frame
// times render and then read one pixel back from every context drawn, so they include the GPU's
// work, not just the calls that queue it. Like for like: both tone map with Khronos PBR Neutral,
// both draw round points, and a "first frame" is the first complete picture - for phoria2, whose
// shaders compile in the background, the first frame with every program ready. Run from perf.html
// (the Run button, or ?auto), or headless with `npm run perf` - `npm run perf -- glass labels` runs
// only those scenes (by key: see SCENES), and `--pictures` keeps a PNG of each library's frame.
// The scenes since 1.9 are in scenes.js; what they all share is in harness.js.
import * as P from 'phoria2'
import * as THREE from 'three'
import { canvas, cloud, disposeThree, firstPicture, frames, median, nextFrame, orbiter, perf, phoriaView, record, roundSprite, sync, threeRenderer, WIDTH, HEIGHT, stage } from './harness.js'
import { MORE_SCENES } from './scenes.js'

const BARS = 100_000, POINTS = 1_000_000, VIEWS = 20, TILE_BARS = 400, SORTED = 100_000, MESHES = 2_000
const status = /** @type {HTMLElement} */ (document.getElementById('status'))
const table = /** @type {HTMLTableElement} */ (document.getElementById('results'))

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

function phoriaBars(view, n) {
  const bars = view.scene.add(new P.InstancedMesh({ geometry: P.box(1), material: { color: '#4a90e2', roughness: 0.5 }, count: n }))
  fillBars(bars.instanceMatrices, n)
  bars.needsUpdate()
  return bars
}
function threeBars(scene, n) {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#4a90e2', roughness: 0.5 }), n)
  fillBars(/** @type {Float32Array} */ (mesh.instanceMatrix.array), n)
  mesh.instanceMatrix.needsUpdate = true
  scene.add(mesh)
  return mesh
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

// see-through points drawn back to front, as a scatter chart draws them: with the camera still
// (nothing to sort again) and moving (a sort every frame). three.js doesn't sort a Points' own
// points, so it sorts the index by depth each frame, as an app would
async function sortedPoints() {
  const positions = cloud(SORTED)
  let c = canvas()
  let t0 = performance.now()
  const view = phoriaView(c)
  view.scene.add(new P.Points({ geometry: new P.Geometry({ positions }), material: { color: '#9cf', size: 3, sizeAttenuation: false, opacity: 0.5, depthWrite: false }, sort: true }))
  await firstPicture(view)
  const pBuild = performance.now() - t0
  const pStill = await frames(() => view.render(), view.renderer.gl)
  const pNext = orbiter()
  const pMoving = await frames(() => {
    view.camera.position.set(...pNext())
    view.render()
  }, view.renderer.gl)
  view.dispose()
  c.remove()

  c = canvas()
  t0 = performance.now()
  const t = threeRenderer(c)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const index = new Uint32Array(SORTED), depth = new Float32Array(SORTED)
  geometry.setIndex(new THREE.BufferAttribute(index, 1))
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#9cf', size: 3, sizeAttenuation: false, map: roundSprite(), transparent: true, opacity: 0.5, depthWrite: false }))
  t.scene.add(points)
  const sortFrom = () => {
    t.camera.updateMatrixWorld()
    const m = t.camera.matrixWorldInverse.elements
    for (let i = 0; i < SORTED; i++) {
      depth[i] = m[2] * positions[i * 3] + m[6] * positions[i * 3 + 1] + m[10] * positions[i * 3 + 2] + m[14]
      index[i] = i
    }
    index.sort((a, b) => depth[a] - depth[b])
    const sorted = /** @type {THREE.BufferAttribute} */ (geometry.index)
    sorted.needsUpdate = true
  }
  sortFrom()
  t.renderer.render(t.scene, t.camera)
  sync(t.gl)
  const tBuild = performance.now() - t0
  const tStill = await frames(() => t.renderer.render(t.scene, t.camera), t.gl)
  const tNext = orbiter()
  const tMoving = await frames(() => {
    t.camera.position.set(...tNext())
    t.camera.lookAt(0, 0, 0)
    sortFrom()
    t.renderer.render(t.scene, t.camera)
  }, t.gl)
  disposeThree(t)

  record('100k sorted points', 'build + first frame', 'ms', pBuild, tBuild)
  record('100k sorted points', 'frame, camera still', 'ms', pStill, tStill)
  record('100k sorted points', 'frame, camera moving', 'ms', pMoving, tMoving)
}

// the bars again, on a floor, casting shadows from a sun and a point light: fitting each light's
// shadow round 100k instances every frame, then drawing the maps
async function shadowedBars() {
  let c = canvas()
  let t0 = performance.now()
  const view = new P.View({ canvas: c, renderMode: 'manual', pixelRatio: 1, autoLight: false, camera: { position: [0, 140, 300], target: [0, 0, 0], far: 2000 } })
  view.scene.add(new P.HemisphereLight({ sky: '#ffffff', ground: '#444444', intensity: 0.6 }))
  view.scene.add(new P.DirectionalLight({ direction: [-1, -2, -1], intensity: 1.4, castShadow: true }))
  view.scene.add(new P.PointLight({ position: [0, 40, 0], intensity: 3000, range: 200, castShadow: true }))
  view.scene.add(new P.Mesh({ geometry: P.plane(340), material: { color: '#888888' }, receiveShadow: true }))
  const pbars = phoriaBars(view, BARS)
  pbars.castShadow = true
  pbars.receiveShadow = true
  await firstPicture(view)
  const pBuild = performance.now() - t0
  const pStill = await frames(() => view.render(), view.renderer.gl)
  const pNext = orbiter()
  const pMoving = await frames(() => {
    view.camera.position.set(...pNext())
    view.render()
  }, view.renderer.gl)
  view.dispose()
  c.remove()

  c = canvas()
  t0 = performance.now()
  const t = threeRenderer(c)
  t.renderer.shadowMap.enabled = true
  const sun = /** @type {THREE.DirectionalLight} */ (t.scene.children.find((o) => o instanceof THREE.DirectionalLight))
  // three.js's sun shadow covers a box it is told: the grid's, as phoria2 fits its own
  sun.position.set(100, 200, 100)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  Object.assign(sun.shadow.camera, { left: -230, right: 230, top: 230, bottom: -230, near: 1, far: 600 })
  sun.shadow.camera.updateProjectionMatrix()
  const lamp = new THREE.PointLight(0xffffff, 3000, 200, 2)
  lamp.position.set(0, 40, 0)
  lamp.castShadow = true
  lamp.shadow.mapSize.set(1024, 1024)
  t.scene.add(lamp)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(340, 340), new THREE.MeshStandardMaterial({ color: '#888888' }))
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  t.scene.add(floor)
  const tbars = threeBars(t.scene, BARS)
  tbars.castShadow = true
  tbars.receiveShadow = true
  t.renderer.render(t.scene, t.camera)
  sync(t.gl)
  const tBuild = performance.now() - t0
  const tStill = await frames(() => t.renderer.render(t.scene, t.camera), t.gl)
  const tNext = orbiter()
  const tMoving = await frames(() => {
    t.camera.position.set(...tNext())
    t.camera.lookAt(0, 0, 0)
    t.renderer.render(t.scene, t.camera)
  }, t.gl)
  disposeThree(t)

  record('100k shadowed bars', 'build + first frame', 'ms', pBuild, tBuild)
  record('100k shadowed bars', 'frame, camera still', 'ms', pStill, tStill)
  record('100k shadowed bars', 'frame, camera moving', 'ms', pMoving, tMoving)
}

// many separate meshes, each with a material of its own - a draw call each, as scenes built from
// parts are: what each draw costs the CPU, binding and setting, more than the GPU
async function meshes() {
  const side = Math.ceil(Math.sqrt(MESHES))
  const at = (i) => [((i % side) - side / 2) * 4, 0, (Math.floor(i / side) - side / 2) * 4]
  const colour = (i) => `hsl(${(i * 37) % 360}, 60%, 55%)`
  let c = canvas()
  let t0 = performance.now()
  const view = phoriaView(c)
  const geometry = P.box(2)
  for (let i = 0; i < MESHES; i++) view.scene.add(new P.Mesh({ geometry, material: { color: colour(i), roughness: 0.5 }, position: at(i), rotation: [0, i, 0] }))
  await firstPicture(view)
  const pBuild = performance.now() - t0
  const pFrame = await frames(() => view.render(), view.renderer.gl)
  view.dispose()
  c.remove()

  c = canvas()
  t0 = performance.now()
  const t = threeRenderer(c)
  const box = new THREE.BoxGeometry(2, 2, 2)
  for (let i = 0; i < MESHES; i++) {
    const mesh = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ color: colour(i), roughness: 0.5 }))
    mesh.position.set(...at(i))
    mesh.rotation.y = i
    t.scene.add(mesh)
  }
  t.renderer.render(t.scene, t.camera)
  sync(t.gl)
  const tBuild = performance.now() - t0
  const tFrame = await frames(() => t.renderer.render(t.scene, t.camera), t.gl)
  disposeThree(t)

  record('2k meshes', 'build + first frame', 'ms', pBuild, tBuild)
  record('2k meshes', 'frame', 'ms', pFrame, tFrame)
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
  // ?scenes=glass,labels runs only those, by key
  const only = new URLSearchParams(location.search).get('scenes')?.split(',').filter(Boolean) ?? null
  const unknown = only?.filter((key) => !SCENES.some(([k]) => k === key)) ?? []
  if (unknown.length) status.textContent = `no scene ${unknown.join(', ')} - the keys are ${SCENES.map(([k]) => k).join(', ')}`
  for (const [key, name, scene] of SCENES) {
    if (only && !only.includes(key)) continue
    status.textContent = `running ${name}...`
    await nextFrame()
    await scene()
  }
  status.textContent = `done - ${perf.env.gpu}`
  button.disabled = false
  perf.done = true
}

/** Every scene: its key (for ?scenes=), its name, and what runs it. @type {[string, string, () => Promise<void>][]} */
const SCENES = [
  ['bars', '100k bars', bars], ['points', '1M points', points], ['sorted', '100k sorted points', sortedPoints],
  ['shadowed', '100k shadowed bars', shadowedBars], ['meshes', '2k meshes', meshes], ['views', `${VIEWS} views`, views],
  ...MORE_SCENES,
]

document.getElementById('run')?.addEventListener('click', run)
if (new URLSearchParams(location.search).has('auto')) run()
