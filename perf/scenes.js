// The perf scenes added after 1.9 - lighting and shadows, materials and effects, overlays and
// geometry - each built the same way in phoria2 and in three.js. Where the two don't do quite the same
// work the metric says so: soft shadows filter differently, phoria2 alone fills section caps, and its
// labels lay themselves out round each other by default. Light counts stay within phoria2's limits
// (4 point and spot lights, 2 directional). Every scene keeps a picture of each library's frame
// with ?pictures, to see they draw the same thing.
import * as P from 'phoria2'
import { Emitter } from 'phoria2/particles'
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import { HEIGHT, WIDTH, canvas, cloud, complete, disposeThree, frames, orbiter, phoriaBare, picture, random, record, stage, sync, threeBare } from './harness.js'

const PI = Math.PI
const HDR = 'hdr/studio_small_09_1k.hdr'
const TEXTURE_SETS = ['red_brick_03', 'rusty_metal_02', 'weathered_brown_planks']
const texturesOf = (set) => ({ map: `textures/${set}_diff_1k.jpg`, normal: `textures/${set}_nor_gl_1k.jpg`, arm: `textures/${set}_arm_1k.jpg` })

// --- shared set pieces, made the same in both ---

/** Boxes in a grid, `n` of them, their heights varying: [x, z, height] each. @param {number} n @param {number} spacing */
function grid(n, spacing) {
  const side = Math.ceil(Math.sqrt(n))
  return Array.from({ length: n }, (_, i) => [((i % side) - side / 2 + 0.5) * spacing, (Math.floor(i / side) - side / 2 + 0.5) * spacing, 0.6 + ((i * 7919) % 7) * 0.4])
}

function phoriaFloor(size) {
  return new P.Mesh({ geometry: P.plane(size), material: { color: '#9a9a9a', roughness: 0.9 }, receiveShadow: true })
}
function threeFloor(size) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ color: '#9a9a9a', roughness: 0.9 }))
  floor.rotation.x = -PI / 2
  floor.receiveShadow = true
  return floor
}

/** phoria2's sky light and sun (optionally casting, softly). @param {any} view */
function phoriaLights(view, { sun = 1.4, sky = 0.6, castShadow = false, shadowSoftness = 0 } = {}) {
  view.scene.add(new P.HemisphereLight({ sky: '#ffffff', ground: '#444444', intensity: sky }))
  return sun ? view.scene.add(new P.DirectionalLight({ direction: [-1, -2, -1], intensity: sun, castShadow, shadowSoftness })) : null
}
/** three.js's, the same: π times the intensity. @param {any} t */
function threeLights(t, { sun = 1.4, sky = 0.6, castShadow = false, bounds = 40 } = {}) {
  t.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, sky * PI))
  if (!sun) return null
  const light = new THREE.DirectionalLight(0xffffff, sun * PI)
  light.position.set(20, 40, 20)
  if (castShadow) {
    light.castShadow = true
    light.shadow.mapSize.set(2048, 2048)
    Object.assign(light.shadow.camera, { left: -bounds, right: bounds, top: bounds, bottom: -bounds, near: 1, far: 120 })
    light.shadow.camera.updateProjectionMatrix()
  }
  t.scene.add(light)
  return light
}

/** Load phoria2 textures for a map set. @param {string} set */
async function phoriaTextures(set) {
  const f = texturesOf(set)
  const [map, normal, arm] = await Promise.all([P.loadTexture(f.map), P.loadTexture(f.normal), P.loadTexture(f.arm)])
  return { map, normalMap: normal, roughnessMap: arm, metalnessMap: arm, aoMap: arm }
}
// phoria2 samples textures 8x anisotropically by default; three.js doesn't - its textures here do,
// for the same work per pixel
const ANISOTROPY = 8

/** And three.js's. @param {string} set */
async function threeTextures(set) {
  const f = texturesOf(set), loader = new THREE.TextureLoader()
  const [map, normal, arm] = await Promise.all([loader.loadAsync(f.map), loader.loadAsync(f.normal), loader.loadAsync(f.arm)])
  map.colorSpace = THREE.SRGBColorSpace
  for (const t of [map, normal, arm]) t.anisotropy = ANISOTROPY
  return { map, normalMap: normal, roughnessMap: arm, metalnessMap: arm, aoMap: arm }
}

/**
 * Time a phoria2 view: build (until complete), a picture, then each metric's frames.
 * @param {string} key @param {(c: HTMLCanvasElement) => Promise<any> | any} build returns the view
 * @param {Record<string, (view: any) => void>} metrics each a frame's work, before render
 */
async function timePhoria(key, build, metrics) {
  const c = canvas()
  const t0 = performance.now()
  const view = await build(c)
  const built = (await complete(view)) - t0
  view.render()
  picture(`${key}-phoria2`, c)
  /** @type {Record<string, number>} */
  const out = { build: built }
  for (const [name, step] of Object.entries(metrics)) out[name] = await frames(() => { step(view); view.render() }, view.renderer.gl)
  view.dispose()
  c.remove()
  return out
}

/**
 * Time the three.js side the same way. `draw` renders a frame (a composer, or extra renderers).
 * @param {string} key @param {(c: HTMLCanvasElement) => Promise<any> | any} build returns { renderer, scene, camera, gl, draw?, dispose? }
 * @param {Record<string, (t: any) => void>} metrics
 */
async function timeThree(key, build, metrics) {
  const c = canvas()
  const t0 = performance.now()
  const t = await build(c)
  const draw = t.draw ?? (() => t.renderer.render(t.scene, t.camera))
  draw()
  sync(t.gl)
  const built = performance.now() - t0
  draw()
  picture(`${key}-three`, c)
  /** @type {Record<string, number>} */
  const out = { build: built }
  for (const [name, step] of Object.entries(metrics)) out[name] = await frames(() => { step(t); draw() }, t.gl)
  t.dispose?.()
  disposeThree(t)
  return out
}

/** Record both sides' metrics, by name. @param {string} scene @param {Record<string, number>} p @param {Record<string, number>} t @param {Record<string, string>} names */
function recordAll(scene, p, t, names) {
  record(scene, 'build + first frame', 'ms', p.build, t.build)
  for (const [key, label] of Object.entries(names)) record(scene, label, 'ms', p[key] ?? null, t[key] ?? null)
}

/** A camera stepping round a circle each frame, for phoria2 and three.js alike. */
const phoriaOrbit = (radius, height) => {
  const next = orbiter(radius, height)
  return (view) => view.camera.position.set(...next())
}
const threeOrbit = (radius, height, target = [0, 0, 0]) => {
  const next = orbiter(radius, height)
  return (t) => {
    t.camera.position.set(...next())
    t.camera.lookAt(target[0], target[1], target[2])
  }
}

// --- lighting and shadows ---

// three spot lights and a point light (phoria2's four), each casting, over 500 boxes: the spot
// atlas and the point cube against three.js's map per spot and its point map. With the camera moving
// phoria2 keeps its maps; with the lights moving both draw them every frame
async function spotShadows() {
  const boxes = grid(500, 2.2), spots = [[18, 14, 12], [-18, 14, 12], [0, 14, -18]], camera = [0, 30, 45]
  const swing = (k, a) => spots[k][0] + Math.sin(a + k) * 2
  let pa = 0, ta = 0
  const p = await timePhoria('spots', (c) => {
    const view = phoriaBare(c, { position: camera, target: [0, 0, 0] })
    view.scene.add(new P.HemisphereLight({ sky: '#ffffff', ground: '#444444', intensity: 0.3 }))
    view.scene.add(phoriaFloor(80))
    const geometry = P.box(1), material = new P.Material({ color: '#c8c2b8', roughness: 0.6 })
    for (const [x, z, h] of boxes) view.scene.add(new P.Mesh({ geometry, material, position: [x, h / 2, z], scale: [1.4, h, 1.4], castShadow: true, receiveShadow: true }))
    view.spots = spots.map((s) => view.scene.add(new P.SpotLight({ position: s, direction: [-s[0], -s[1], -s[2]], angle: 0.6, penumbra: 0.3, intensity: 500, castShadow: true })))
    view.scene.add(new P.PointLight({ position: [0, 5, 0], intensity: 40, castShadow: true }))
    return view
  }, {
    moving: phoriaOrbit(50, 30),
    lights: (view) => { pa += 0.02; view.spots.forEach((s, k) => { s.position.x = swing(k, pa) }) },
  })
  const t = await timeThree('spots', (c) => {
    const t = threeBare(c, camera)
    t.renderer.shadowMap.enabled = true
    t.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.3 * PI))
    t.scene.add(threeFloor(80))
    const geometry = new THREE.BoxGeometry(1, 1, 1), material = new THREE.MeshStandardMaterial({ color: '#c8c2b8', roughness: 0.6 })
    for (const [x, z, h] of boxes) {
      const m = new THREE.Mesh(geometry, material)
      m.position.set(x, h / 2, z)
      m.scale.set(1.4, h, 1.4)
      m.castShadow = m.receiveShadow = true
      t.scene.add(m)
    }
    t.spots = spots.map((s) => {
      const light = new THREE.SpotLight(0xffffff, 500 * PI, 0, 0.6, 0.3, 2)
      light.position.set(s[0], s[1], s[2])
      light.castShadow = true
      light.shadow.mapSize.set(1024, 1024)
      t.scene.add(light, light.target)
      return light
    })
    const point = new THREE.PointLight(0xffffff, 40 * PI, 0, 2)
    point.position.set(0, 5, 0)
    point.castShadow = true
    point.shadow.mapSize.set(1024, 1024)
    t.scene.add(point)
    return t
  }, {
    moving: threeOrbit(50, 30),
    lights: (t) => { ta += 0.02; t.spots.forEach((s, k) => { s.position.x = swing(k, ta) }) },
  })
  recordAll('spot + point shadows', p, t, { moving: 'frame, camera moving', lights: 'frame, lights moving' })
}

// as many lights as phoria2 takes - four point lights, two suns and a sky - on 500 spheres, no shadows:
// the lit shader's own cost
async function manyLights() {
  const spheres = grid(500, 2.2), camera = [0, 30, 45]
  const points = [[-15, 6, -15, '#ff8866'], [15, 6, -15, '#66aaff'], [-15, 6, 15, '#88ff88'], [15, 6, 15, '#ffdd66']]
  const colours = ['#d8d0c8', '#8899aa', '#aa8877', '#77aa88']
  const p = await timePhoria('lights', (c) => {
    const view = phoriaBare(c, { position: camera, target: [0, 0, 0] })
    view.scene.add(new P.HemisphereLight({ sky: '#ffffff', ground: '#444444', intensity: 0.2 }))
    view.scene.add(new P.DirectionalLight({ direction: [-1, -2, -1], intensity: 0.6 }), new P.DirectionalLight({ direction: [1, -1, 1], intensity: 0.3, color: '#aaccff' }))
    for (const [x, y, z, color] of points) view.scene.add(new P.PointLight({ position: [x, y, z], color, intensity: 120 }))
    const geometry = P.sphere({ radius: 0.8, segments: 24, rings: 16 }), materials = colours.map((color) => new P.Material({ color, roughness: 0.4 }))
    spheres.forEach(([x, z], i) => view.scene.add(new P.Mesh({ geometry, material: materials[i % 4], position: [x, 0.8, z] })))
    return view
  }, { moving: phoriaOrbit(50, 30) })
  const t = await timeThree('lights', (c) => {
    const t = threeBare(c, camera)
    t.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.2 * PI))
    const sun = new THREE.DirectionalLight(0xffffff, 0.6 * PI), fill = new THREE.DirectionalLight('#aaccff', 0.3 * PI)
    sun.position.set(1, 2, 1)
    fill.position.set(-1, 1, -1)
    t.scene.add(sun, fill)
    for (const [x, y, z, color] of points) {
      const light = new THREE.PointLight(color, 120 * PI, 0, 2)
      light.position.set(x, y, z)
      t.scene.add(light)
    }
    const geometry = new THREE.SphereGeometry(0.8, 24, 16), materials = colours.map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.4 }))
    spheres.forEach(([x, z], i) => {
      const m = new THREE.Mesh(geometry, materials[i % 4])
      m.position.set(x, 0.8, z)
      t.scene.add(m)
    })
    return t
  }, { moving: threeOrbit(50, 30) })
  recordAll('max lights', p, t, { moving: 'frame, camera moving' })
}

// a sun's shadow over 500 boxes. Like for like: phoria2's default shadow edge against three.js's
// PCFSoftShadowMap - the two look alike (a crisp, evenly filtered edge). Then phoria2's
// contact-hardening shadows, which three.js doesn't ship (its PCSS is an example to patch in), at
// shadowSoftness 0.15 - a sun's: sharp where things meet the ground, softer further off - as rows of
// its own, for what turning them on costs
async function softShadows() {
  const boxes = grid(500, 2.2), camera = [0, 30, 45]
  const phoria = (softness) => {
    let pa = 0
    return timePhoria(softness ? 'soft-hardening' : 'soft', (c) => {
      const view = phoriaBare(c, { position: camera, target: [0, 0, 0] })
      view.sun = phoriaLights(view, { castShadow: true, shadowSoftness: softness })
      view.scene.add(phoriaFloor(80))
      const geometry = P.box(1), material = new P.Material({ color: '#c8c2b8', roughness: 0.6 })
      for (const [x, z, h] of boxes) view.scene.add(new P.Mesh({ geometry, material, position: [x, h / 2, z], scale: [1.4, h, 1.4], castShadow: true, receiveShadow: true }))
      return view
    }, {
      moving: phoriaOrbit(50, 30),
      sun: (view) => { pa += 0.01; view.sun.direction.set(-1 + Math.sin(pa) * 0.3, -2, -1) },
    })
  }
  let ta = 0
  const p = await phoria(0)
  const t = await timeThree('soft', (c) => {
    const t = threeBare(c, camera)
    t.renderer.shadowMap.enabled = true
    t.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    t.sun = threeLights(t, { castShadow: true })
    t.scene.add(threeFloor(80))
    const geometry = new THREE.BoxGeometry(1, 1, 1), material = new THREE.MeshStandardMaterial({ color: '#c8c2b8', roughness: 0.6 })
    for (const [x, z, h] of boxes) {
      const m = new THREE.Mesh(geometry, material)
      m.position.set(x, h / 2, z)
      m.scale.set(1.4, h, 1.4)
      m.castShadow = m.receiveShadow = true
      t.scene.add(m)
    }
    return t
  }, {
    moving: threeOrbit(50, 30),
    sun: (t) => { ta += 0.01; t.sun.position.set(20 - Math.sin(ta) * 6, 40, 20) },
  })
  recordAll('soft shadows', p, t, { moving: 'frame, camera moving', sun: 'frame, sun moving' })
  const hard = await phoria(0.15)
  record('soft shadows', 'build + first frame, contact-hardening 0.15', 'ms', hard.build, null)
  record('soft shadows', 'frame, camera moving, contact-hardening 0.15', 'ms', hard.moving, null)
  record('soft shadows', 'frame, sun moving, contact-hardening 0.15', 'ms', hard.sun, null)
}

// 200 spheres, metal and rough by row and column, lit only by an HDR studio: the first frame loads
// and prefilters it (three.js: PMREM)
async function hdrEnvironment() {
  const camera = [0, 10, 26]
  const at = (i) => [((i % 20) - 9.5) * 2, 1 + Math.floor(i / 20) * 0.01, (Math.floor(i / 20) - 4.5) * 2]
  const p = await timePhoria('hdr', async (c) => {
    const view = phoriaBare(c, { position: camera, target: [0, 0, 0] })
    view.scene.environment = await P.loadTexture(HDR)
    const geometry = P.sphere({ radius: 0.8, segments: 32, rings: 16 })
    for (let i = 0; i < 200; i++) view.scene.add(new P.Mesh({ geometry, material: { color: '#d0d0d0', metalness: (i % 20) / 19, roughness: Math.floor(i / 20) / 9 }, position: at(i) }))
    return view
  }, { moving: phoriaOrbit(26, 10) })
  const t = await timeThree('hdr', async (c) => {
    const t = threeBare(c, camera)
    const hdr = await new HDRLoader().loadAsync(HDR)
    const pmrem = new THREE.PMREMGenerator(t.renderer)
    t.scene.environment = pmrem.fromEquirectangular(hdr).texture
    pmrem.dispose()
    const geometry = new THREE.SphereGeometry(0.8, 32, 16)
    for (let i = 0; i < 200; i++) {
      const m = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#d0d0d0', metalness: (i % 20) / 19, roughness: Math.floor(i / 20) / 9 }))
      m.position.set(...at(i))
      t.scene.add(m)
    }
    return t
  }, { moving: threeOrbit(26, 10) })
  recordAll('HDR environment', p, t, { moving: 'frame, camera moving' })
}

// --- materials and effects ---

// 30 clear glass spheres in front of a brick wall: phoria2's copy of the picture behind against
// three.js's transmission pass
async function glass() {
  const camera = [0, 2, 16], target = [0, 0, -2]
  const at = (i) => [((i % 6) - 2.5) * 2.4, ((Math.floor(i / 6)) - 2) * 2.2, 0]
  const p = await timePhoria('glass', async (c) => {
    const view = phoriaBare(c, { position: camera, target })
    phoriaLights(view)
    const wall = await P.loadTexture(texturesOf('red_brick_03').map)
    wall.repeat = [4, 3]
    view.scene.add(new P.Mesh({ geometry: P.plane({ width: 40, depth: 30 }), material: { map: wall, roughness: 0.9 }, position: [0, 0, -6], rotation: [PI / 2, 0, 0] }))
    const geometry = P.sphere({ radius: 0.9, segments: 32, rings: 16 }), material = new P.Material({ transmission: 1, roughness: 0.05, thickness: 0.6, ior: 1.5 })
    for (let i = 0; i < 30; i++) view.scene.add(new P.Mesh({ geometry, material, position: at(i) }))
    return view
  }, { moving: phoriaOrbit(16, 2) })
  const t = await timeThree('glass', async (c) => {
    const t = threeBare(c, camera, target)
    threeLights(t)
    const wall = await new THREE.TextureLoader().loadAsync(texturesOf('red_brick_03').map)
    wall.colorSpace = THREE.SRGBColorSpace
    wall.anisotropy = ANISOTROPY
    wall.wrapS = wall.wrapT = THREE.RepeatWrapping
    wall.repeat.set(4, 3)
    const back = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), new THREE.MeshStandardMaterial({ map: wall, roughness: 0.9 }))
    back.position.set(0, 0, -6)
    t.scene.add(back)
    const geometry = new THREE.SphereGeometry(0.9, 32, 16), material = new THREE.MeshPhysicalMaterial({ transmission: 1, roughness: 0.05, thickness: 0.6, ior: 1.5 })
    for (let i = 0; i < 30; i++) {
      const m = new THREE.Mesh(geometry, material)
      m.position.set(...at(i))
      t.scene.add(m)
    }
    return t
  }, { moving: threeOrbit(16, 2, target) })
  recordAll('30 glass spheres', p, t, { moving: 'frame, camera moving' })
}

// a sphere of each kind of material - each its own shader: the first frame is mostly compiling them
// (phoria2's in parallel where the browser allows)
async function materialVariety() {
  const camera = [0, 4, 14]
  const at = (i) => [((i % 4) - 1.5) * 2.6, 1 - Math.floor(i / 4) * 2.4 + 2, 0]
  const kinds = (tex, three) => [
    three ? new THREE.MeshStandardMaterial({ color: '#c0c0c0', roughness: 0.5 }) : { color: '#c0c0c0', roughness: 0.5 },
    three ? new THREE.MeshStandardMaterial({ color: '#d4af37', metalness: 1, roughness: 0.25 }) : { color: '#d4af37', metalness: 1, roughness: 0.25 },
    three ? new THREE.MeshPhysicalMaterial({ color: '#a01010', clearcoat: 1, clearcoatRoughness: 0.1 }) : { color: '#a01010', clearcoat: 1, clearcoatRoughness: 0.1 },
    three ? new THREE.MeshPhysicalMaterial({ color: '#303080', sheen: 1, sheenColor: '#ff88cc', sheenRoughness: 0.5 }) : { color: '#303080', sheen: 1, sheenColor: '#ff88cc', sheenRoughness: 0.5 },
    three ? new THREE.MeshPhysicalMaterial({ color: '#202020', metalness: 1, roughness: 0.2, iridescence: 1, iridescenceIOR: 1.3, iridescenceThicknessRange: [100, 400] }) : { color: '#202020', metalness: 1, roughness: 0.2, iridescence: 1 },
    three ? new THREE.MeshPhysicalMaterial({ color: '#aaaaaa', metalness: 1, roughness: 0.4, anisotropy: 0.8 }) : { color: '#aaaaaa', metalness: 1, roughness: 0.4, anisotropy: 0.8 },
    three ? new THREE.MeshPhysicalMaterial({ transmission: 1, roughness: 0.05, thickness: 0.5 }) : { transmission: 1, roughness: 0.05, thickness: 0.5 },
    three ? new THREE.MeshStandardMaterial({ ...tex }) : { ...tex },
    three ? new THREE.MeshStandardMaterial({ color: '#111111', emissive: '#ff6600', emissiveIntensity: 2 }) : { color: '#111111', emissive: '#ff6600', emissiveIntensity: 2 },
    three ? new THREE.MeshBasicMaterial({ color: '#33cc88' }) : { color: '#33cc88', unlit: true },
    three ? new THREE.MeshToonMaterial({ color: '#3388ff' }) : { color: '#3388ff', toon: 4 },
    three ? new THREE.MeshStandardMaterial({ color: '#cc8833', flatShading: true }) : { color: '#cc8833', flatShading: true },
  ]
  const p = await timePhoria('variety', async (c) => {
    const view = phoriaBare(c, { position: camera, target: [0, 1, 0] })
    phoriaLights(view)
    const geometry = P.sphere({ radius: 1, segments: 48, rings: 24 })
    kinds(await phoriaTextures('rusty_metal_02'), false).forEach((material, i) => view.scene.add(new P.Mesh({ geometry, material, position: at(i) })))
    return view
  }, { still: () => {} })
  const t = await timeThree('variety', async (c) => {
    const t = threeBare(c, camera, [0, 1, 0])
    threeLights(t)
    const geometry = new THREE.SphereGeometry(1, 48, 24)
    kinds(await threeTextures('rusty_metal_02'), true).forEach((material, i) => {
      const m = new THREE.Mesh(geometry, material)
      m.position.set(...at(i))
      t.scene.add(m)
    })
    return t
  }, { still: () => {} })
  recordAll('12 material kinds', p, t, { still: 'frame' })
}

// 1,000 boxes, a third glowing, through bloom and FXAA: phoria2's own against three.js's
// EffectComposer with UnrealBloomPass, OutputPass and FXAAPass
async function bloomFxaa() {
  const boxes = grid(1000, 2.2), camera = [0, 35, 55]
  const p = await timePhoria('bloom', (c) => {
    const view = phoriaBare(c, { position: camera, target: [0, 0, 0] }, { bloom: { strength: 0.8, radius: 0.5, threshold: 1 }, fxaa: true })
    phoriaLights(view)
    const geometry = P.box(1)
    const plain = new P.Material({ color: '#556070', roughness: 0.6 }), glowing = new P.Material({ color: '#222222', emissive: '#ffaa33', emissiveIntensity: 4 })
    boxes.forEach(([x, z, h], i) => view.scene.add(new P.Mesh({ geometry, material: i % 3 ? plain : glowing, position: [x, h / 2, z], scale: [1.4, h, 1.4] })))
    return view
  }, { moving: phoriaOrbit(60, 35) })
  const t = await timeThree('bloom', (c) => {
    const t = threeBare(c, camera)
    threeLights(t)
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const plain = new THREE.MeshStandardMaterial({ color: '#556070', roughness: 0.6 }), glowing = new THREE.MeshStandardMaterial({ color: '#222222', emissive: '#ffaa33', emissiveIntensity: 4 })
    boxes.forEach(([x, z, h], i) => {
      const m = new THREE.Mesh(geometry, i % 3 ? plain : glowing)
      m.position.set(x, h / 2, z)
      m.scale.set(1.4, h, 1.4)
      t.scene.add(m)
    })
    const composer = new EffectComposer(t.renderer)
    composer.setSize(WIDTH, HEIGHT)
    composer.addPass(new RenderPass(t.scene, t.camera))
    // its own scale: tuned by eye to glow about as much as phoria2's
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(WIDTH, HEIGHT), 0.12, 0.2, 1))
    composer.addPass(new OutputPass())
    composer.addPass(new FXAAPass())
    t.draw = () => composer.render()
    t.dispose = () => composer.dispose()
    return t
  }, { moving: threeOrbit(60, 35) })
  recordAll('bloom + FXAA', p, t, { moving: 'frame, camera moving' })
}

// 1,000 boxes in three photo materials - colour, normal and ARM maps each - under a sun
async function textured() {
  const boxes = grid(1000, 2.2), camera = [0, 30, 45]
  const p = await timePhoria('textured', async (c) => {
    const view = phoriaBare(c, { position: camera, target: [0, 0, 0] })
    phoriaLights(view)
    const sets = await Promise.all(TEXTURE_SETS.map(phoriaTextures))
    const materials = sets.map((maps) => new P.Material(maps)), geometry = P.box(1)
    boxes.forEach(([x, z, h], i) => view.scene.add(new P.Mesh({ geometry, material: materials[i % 3], position: [x, h / 2, z], scale: [1.4, h, 1.4] })))
    return view
  }, { moving: phoriaOrbit(50, 30) })
  const t = await timeThree('textured', async (c) => {
    const t = threeBare(c, camera)
    threeLights(t)
    const sets = await Promise.all(TEXTURE_SETS.map(threeTextures))
    const materials = sets.map((maps) => new THREE.MeshStandardMaterial(maps)), geometry = new THREE.BoxGeometry(1, 1, 1)
    boxes.forEach(([x, z, h], i) => {
      const m = new THREE.Mesh(geometry, materials[i % 3])
      m.position.set(x, h / 2, z)
      m.scale.set(1.4, h, 1.4)
      t.scene.add(m)
    })
    return t
  }, { moving: threeOrbit(50, 30) })
  recordAll('1k textured meshes', p, t, { moving: 'frame, camera moving' })
}

// --- overlays and geometry ---

// 1,000 HTML labels pinned in space while the camera moves, against three.js's CSS2DRenderer. Each
// frame ends by asking for the page's layout, so both pay for placing the labels. phoria2 lays its
// labels out round each other by default ('dim'); 'show' does what CSS2DRenderer does
async function labels() {
  const at = cloud(1000)
  const settle = () => stage.getBoundingClientRect() && document.body.offsetHeight
  const labelled = (overlap) => async (c) => {
    const view = phoriaBare(c, { position: [0, 140, 300], target: [0, 0, 0] })
    for (let i = 0; i < 1000; i++) view.scene.add(new P.Label({ text: `L${i}`, position: [at[i * 3], at[i * 3 + 1], at[i * 3 + 2]], overlap }))
    return view
  }
  const step = phoriaOrbit(300, 140)
  const shown = await timePhoria('labels', labelled('show'), { moving: (view) => { step(view); settle() } })
  const dimmed = await timePhoria('labels-dim', labelled('dim'), { moving: (view) => { step(view); settle() } })
  const orbit = threeOrbit(300, 140)
  const t = await timeThree('labels', (c) => {
    const t = threeBare(c, [0, 140, 300])
    const css = new CSS2DRenderer()
    css.setSize(WIDTH, HEIGHT)
    Object.assign(css.domElement.style, { position: 'absolute', left: '0', top: '0' })
    stage.append(css.domElement)
    for (let i = 0; i < 1000; i++) {
      const div = document.createElement('div')
      div.textContent = `L${i}`
      div.className = 'perf-label'
      const label = new CSS2DObject(div)
      label.position.set(at[i * 3], at[i * 3 + 1], at[i * 3 + 2])
      t.scene.add(label)
    }
    t.draw = () => {
      t.renderer.render(t.scene, t.camera)
      css.render(t.scene, t.camera)
    }
    t.dispose = () => css.domElement.remove()
    return t
  }, { moving: (t) => { orbit(t); settle() } })
  record('1k labels', 'build + first frame', 'ms', shown.build, t.build)
  record('1k labels', 'frame, camera moving', 'ms', shown.moving, t.moving)
  record('1k labels', "frame, moving (phoria2's default overlap)", 'ms', dimmed.moving, null)
}

// 10,000 line segments 2 pixels wide, against three.js's LineSegments2
async function thickLines() {
  const positions = cloud(20_000)
  const p = await timePhoria('lines', (c) => {
    const view = phoriaBare(c, { position: [0, 140, 300], target: [0, 0, 0] })
    view.scene.add(new P.Lines({ geometry: new P.Geometry({ positions }), material: { color: '#66ccff', width: 2 } }))
    return view
  }, { moving: phoriaOrbit(300, 140) })
  const t = await timeThree('lines', (c) => {
    const t = threeBare(c, [0, 140, 300])
    const geometry = new LineSegmentsGeometry()
    geometry.setPositions(positions)
    const material = new LineMaterial({ color: 0x66ccff, linewidth: 2 })
    material.resolution.set(WIDTH, HEIGHT)
    t.scene.add(new LineSegments2(geometry, material))
    return t
  }, { moving: threeOrbit(300, 140) })
  recordAll('10k thick lines', p, t, { moving: 'frame, camera moving' })
}

// 2,000 boxes cut by a section plane moving every frame, against three.js's clipping planes;
// phoria2 can also fill the cut faces (caps), which three.js has no equal for
async function sectionPlane() {
  const boxes = grid(2000, 2.2), camera = [0, 40, 70]
  const build = (cap) => (c) => {
    const view = phoriaBare(c, { position: camera, target: [0, 0, 0] })
    phoriaLights(view)
    view.cut = view.scene.add(new P.Group({ clip: { normal: [1, 0, 0], offset: 0, ...(cap ? { cap: '#cc4444' } : {}) } }))
    const geometry = P.box(1), material = new P.Material({ color: '#7f9fbf', roughness: 0.5 })
    for (const [x, z, h] of boxes) view.cut.add(new P.Mesh({ geometry, material, position: [x, h / 2, z], scale: [1.4, h, 1.4] }))
    return view
  }
  const move = (cap) => {
    let a = 0
    return (view) => {
      a += 0.02
      view.cut.clip = { normal: [1, 0, 0], offset: Math.sin(a) * 20, ...(cap ? { cap: '#cc4444' } : {}) }
    }
  }
  const p = await timePhoria('section', build(false), { moving: move(false) })
  const capped = await timePhoria('section-capped', build(true), { moving: move(true) })
  let ta = 0
  const t = await timeThree('section', (c) => {
    const t = threeBare(c, camera)
    threeLights(t)
    t.renderer.localClippingEnabled = true
    t.plane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0)
    const geometry = new THREE.BoxGeometry(1, 1, 1), material = new THREE.MeshStandardMaterial({ color: '#7f9fbf', roughness: 0.5, clippingPlanes: [t.plane] })
    for (const [x, z, h] of boxes) {
      const m = new THREE.Mesh(geometry, material)
      m.position.set(x, h / 2, z)
      m.scale.set(1.4, h, 1.4)
      t.scene.add(m)
    }
    return t
  }, { moving: (t) => { ta += 0.02; t.plane.constant = Math.sin(ta) * 20 } })
  recordAll('2k meshes, section plane', p, t, { moving: 'frame, plane moving' })
  record('2k meshes, section plane', 'frame, plane moving, capped', 'ms', capped.moving, null)
}

// 50,000 additive particles fountaining up and falling, moved every frame: phoria2's Emitter against
// three.js Points moved by hand the same way
async function particles() {
  const N = 50_000, LIFE = 2, camera = [0, 10, 40], target = [0, 6, 0]
  const p = await timePhoria('particles', (c) => {
    const view = phoriaBare(c, { position: camera, target })
    view.scene.add(new Emitter({ max: N, rate: N / LIFE, lifetime: LIFE, velocity: [0, 9, 0], velocitySpread: 3, gravity: [0, -6, 0], color: '#ffaa55', material: { size: 2, sizeAttenuation: false } }))
    // run it until it is full
    for (let i = 0; i < 150; i++) view.scene.update(1 / 60, i / 60)
    view.clock = 150 / 60
    return view
  }, { running: (view) => { view.clock += 1 / 60; view.scene.update(1 / 60, view.clock) } })
  const t = await timeThree('particles', (c) => {
    const t = threeBare(c, camera, target)
    const rand = random(3)
    const position = new Float32Array(N * 3), velocity = new Float32Array(N * 3), age = new Float32Array(N)
    const spawn = (i) => {
      position[i * 3] = position[i * 3 + 1] = position[i * 3 + 2] = 0
      // a velocity within the spread round straight up, as the Emitter's
      const u = rand() * 2 - 1, phi = rand() * PI * 2, r = Math.cbrt(rand()) * 3, s = Math.sqrt(1 - u * u)
      velocity[i * 3] = r * s * Math.cos(phi)
      velocity[i * 3 + 1] = 9 + r * u
      velocity[i * 3 + 2] = r * s * Math.sin(phi)
    }
    for (let i = 0; i < N; i++) {
      spawn(i)
      age[i] = rand() * LIFE
    }
    const geometry = new THREE.BufferGeometry()
    const attribute = new THREE.BufferAttribute(position, 3)
    attribute.setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute('position', attribute)
    t.scene.add(new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#ffaa55', size: 2, sizeAttenuation: false, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })))
    t.step = (dt) => {
      for (let i = 0; i < N; i++) {
        age[i] += dt
        if (age[i] > LIFE) {
          age[i] -= LIFE
          spawn(i)
        }
        velocity[i * 3 + 1] -= 6 * dt
        position[i * 3] += velocity[i * 3] * dt
        position[i * 3 + 1] += velocity[i * 3 + 1] * dt
        position[i * 3 + 2] += velocity[i * 3 + 2] * dt
      }
      attribute.needsUpdate = true
    }
    for (let i = 0; i < 150; i++) t.step(1 / 60)
    return t
  }, { running: (t) => t.step(1 / 60) })
  recordAll('50k particles', p, t, { running: 'frame, simulated' })
}

/** The scenes here, as bench.js lists them: key, name, run. @type {[string, string, () => Promise<void>][]} */
export const MORE_SCENES = [
  ['spots', 'spot + point shadows', spotShadows],
  ['lights', 'max lights', manyLights],
  ['soft', 'soft shadows', softShadows],
  ['hdr', 'HDR environment', hdrEnvironment],
  ['glass', '30 glass spheres', glass],
  ['variety', '12 material kinds', materialVariety],
  ['bloom', 'bloom + FXAA', bloomFxaa],
  ['textured', '1k textured meshes', textured],
  ['labels', '1k labels', labels],
  ['lines', '10k thick lines', thickLines],
  ['section', '2k meshes, section plane', sectionPlane],
  ['particles', '50k particles', particles],
]
