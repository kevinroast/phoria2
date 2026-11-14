import {
  DirectionalLight, Geometry, Group, HemisphereLight, InstancedMesh, Mesh, PointLight, SpotLight, Texture, View,
  box, cylinder, extrude, icosphere, lathe, plane, sphere,
} from 'phoria2'
import { random } from './kit.js'

// Soft shadows that harden where things touch. A garden courtyard on rough, stony ground - a
// planked pergola under a vine, a bronze sundial, a stone ball on its plinth, boulders, a lamp post
// and an iron lantern - lit by one of three lights at a time: a low sun (directional), the lamp
// post's spot, or the candle in the lantern (point). Each casts with shadowSoftness: a shadow is
// sharp where an object meets what it stands on and spreads the further it falls, as under a real,
// sized light - the sundial's gnomon, the pergola's posts and slats, the lantern's bars and every
// stone show it. Soft or hard compares it with the plain filtered edge.
// The vine's leaves are cut-out cards (alphaTest) - they shadow with their holes - lit through from
// behind (translucency). Ambient occlusion seats the stones in the ground, bloom lights the bulbs.

// ---- noise, for the ground, the stones and the bump map: value noise and octaves of it
/** @param {number} x @param {number} z */
function lattice(x, z) {
  let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
/** Smooth value noise, 0-1; with a period it tiles. @param {number} x @param {number} z @param {number} [period] */
function noise(x, z, period = 0) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz)
  const w = (/** @type {number} */ i) => (period ? ((i % period) + period) % period : i)
  const a = lattice(w(ix), w(iz)), b = lattice(w(ix + 1), w(iz)), c = lattice(w(ix), w(iz + 1)), d = lattice(w(ix + 1), w(iz + 1))
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz
}
/** Octaves of noise, 0-1. @param {number} x @param {number} z @param {number} [octaves] @param {number} [period] */
function fbm(x, z, octaves = 4, period = 0) {
  let sum = 0, amp = 0.5, total = 0
  for (let o = 0; o < octaves; o++) {
    sum += noise(x, z, period) * amp
    total += amp
    x *= 2
    z *= 2
    period *= 2
    amp *= 0.5
  }
  return sum / total
}

// the ground's height: broad, low mounds and a little roughness, levelled to 0 where things stand -
// wide enough for every foot of them, so nothing floats with light under it
const SETTLE = [[-1.7, 0.4, 2.4], [1.4, 0.9, 0.8], [0.7, -1.5, 0.7], [3.0, -2.3, 0.6], [-0.6, 2.0, 0.6]]
/** @param {number} x @param {number} z */
function heightAt(x, z) {
  let h = (fbm(x * 0.22 + 7, z * 0.22 + 3, 3) - 0.5) * 0.5 + (fbm(x * 1.6, z * 1.6, 3) - 0.5) * 0.06
  for (const [cx, cz, r] of SETTLE) {
    const d = Math.hypot(x - cx, z - cz) / r
    if (d < 1.3) h *= Math.min(1, Math.max(0, (d - 0.6) / 0.7))
  }
  return h
}

/** The ground: a grid on heightAt, coloured earth to gravel by height and grain. @param {number} size @param {number} n cells across */
function ground(size, n) {
  const positions = [], uvs = [], colors = [], indices = []
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = (i / n - 0.5) * size, z = (j / n - 0.5) * size
      positions.push(x, heightAt(x, z), z)
      uvs.push(i / n, j / n)
      // dark earth in the hollows, pale dusty gravel on the rises, blotched
      const t = Math.min(1, Math.max(0, (heightAt(x, z) + 0.12) * 3.2 + (fbm(x * 0.9 + 40, z * 0.9, 3) - 0.5) * 0.9))
      colors.push(0.27 + 0.2 * t, 0.25 + 0.18 * t, 0.23 + 0.15 * t)
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1
      indices.push(a, c, b, b, c, d)
    }
  }
  return new Geometry({ positions, uvs, colors, indices })
}

/** A rock: an icosphere pushed in and out by noise, then smoothed - coarser for pebbles. @param {number} seed @param {number} [detail] */
function rock(seed, detail = 3) {
  const g = icosphere({ radius: 1, detail })
  const p = g.positions
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2]
    const k = 0.72 + 0.5 * fbm(x * 1.3 + seed, y * 1.3 + z * 0.9 - seed, 3) + 0.12 * fbm(z * 4 + seed, x * 4 + y, 2)
    // flattened underneath, as stones rest
    p[i] = x * k
    p[i + 1] = y * k * (y < 0 ? 0.55 : 0.85)
    p[i + 2] = z * k
  }
  g.needsUpdate()
  g.computeNormals()
  return g
}

/** A grey, tiling bump texture: gravel grain over coarser pits. @param {number} size */
function grain(size) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'))
  const img = g.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = 0.6 * fbm(x / size * 8, y / size * 8, 4, 8) + 0.4 * fbm(x / size * 32 + 9, y / size * 32, 2, 32)
      const i = (y * size + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(v * 255)
      img.data[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  return new Texture({ image: c, colorSpace: 'linear' })
}

/** Ivy-like leaves on a transparent card, for the vine: three to a card, veined. */
function leaves() {
  const S = 128, c = document.createElement('canvas')
  c.width = c.height = S
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'))
  const leaf = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ a, /** @type {number} */ s, /** @type {string} */ fill) => {
    g.save()
    g.translate(x, y)
    g.rotate(a)
    g.scale(s, s)
    g.beginPath()
    g.moveTo(0, 30)
    g.bezierCurveTo(-26, 12, -24, -16, 0, -30)
    g.bezierCurveTo(24, -16, 26, 12, 0, 30)
    g.fillStyle = fill
    g.fill()
    g.strokeStyle = 'rgba(20, 40, 10, 0.5)'
    g.lineWidth = 1.6
    g.beginPath()
    g.moveTo(0, 28)
    g.lineTo(0, -26)
    for (let k = -18; k < 22; k += 10) {
      g.moveTo(0, k)
      g.lineTo(-13, k - 9)
      g.moveTo(0, k)
      g.lineTo(13, k - 9)
    }
    g.stroke()
    g.restore()
  }
  leaf(40, 46, -0.5, 0.95, '#4f7d2c')
  leaf(88, 44, 0.6, 0.85, '#628f34')
  leaf(64, 88, 0.1, 1.05, '#44722a')
  return new Texture({ image: c })
}

export default function run({ canvas, gui, info }) {
  info.textContent = 'Drag to orbit · pick a light below'
  const rand = random(11)
  const view = new View({
    canvas, background: '#c9ab8c',
    camera: { position: [4.35, 4.1, 7.4], target: [-0.3, 0.9, -0.3], fov: 40 },
    orbit: { minDistance: 2.5, maxDistance: 16, minPitch: 0.06, maxPitch: 1.35 },
    ambientOcclusion: true,
    bloom: { strength: 0.7, radius: 0.5, threshold: 0.95 },
  })
  const scene = view.scene
  scene.environment = 'hdr/studio_small_09_1k.hdr'

  // ---- materials
  const bump = grain(256)
  const stone = { color: '#9a958d', roughness: 0.9, bumpMap: bump, bumpScale: 0.012, triplanar: 1.6 }
  const planks = {
    map: 'textures/weathered_brown_planks_diff_1k.jpg', normalMap: 'textures/weathered_brown_planks_nor_gl_1k.jpg',
    roughnessMap: 'textures/weathered_brown_planks_arm_1k.jpg', aoMap: 'textures/weathered_brown_planks_arm_1k.jpg', triplanar: 0.9,
  }
  const iron = {
    map: 'textures/rusty_metal_02_diff_1k.jpg', normalMap: 'textures/rusty_metal_02_nor_gl_1k.jpg',
    roughnessMap: 'textures/rusty_metal_02_arm_1k.jpg', metalnessMap: 'textures/rusty_metal_02_arm_1k.jpg', triplanar: 3,
  }
  const bronze = { color: '#a7804a', metalness: 1, roughness: 0.32 }

  // ---- the ground, and stones scattered on it - clear of what stands there
  scene.add(new Mesh({
    geometry: ground(22, 180),
    material: { vertexColors: true, roughness: 0.95, bumpMap: { image: bump.image, colorSpace: 'linear', repeat: [70, 70] }, bumpScale: 0.006 },
    receiveShadow: true,
  }))
  const clear = [...SETTLE.map(([x, z, r]) => [x, z, r * 0.75])]
  /** @param {number} x @param {number} z */
  const free = (x, z) => clear.every(([cx, cz, r]) => Math.hypot(x - cx, z - cz) > r)
  /** Stones of one shape, sizes from lo to hi, n of them over a disc of radius spread. */
  const scatter = (/** @type {number} */ n, /** @type {number} */ lo, /** @type {number} */ hi, /** @type {number} */ spread, /** @type {number} */ seed, detail = 3) => {
    /** @type {any[]} */
    const instances = []
    while (instances.length < n) {
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * spread
      const x = Math.cos(a) * d, z = Math.sin(a) * d
      if (!free(x, z)) continue
      const s = lo * Math.pow(hi / lo, Math.pow(rand(), 2.2))
      const shade = 0.66 + rand() * 0.26, warm = rand() * 0.07
      instances.push({
        position: [x, heightAt(x, z) - s * 0.2, z], rotation: [0, rand() * Math.PI * 2, (rand() - 0.5) * 0.4],
        scale: [s * (0.8 + rand() * 0.5), s * (0.7 + rand() * 0.4), s * (0.8 + rand() * 0.5)],
        color: [shade + warm, shade, shade - warm],
      })
    }
    scene.add(new InstancedMesh({ geometry: rock(seed, detail), material: stone, instances, castShadow: true, receiveShadow: true }))
  }
  scatter(70, 0.08, 0.32, 8, 1)
  scatter(420, 0.025, 0.08, 7, 5, 2)
  // boulders, alone
  for (const [x, z, s, turn] of [[-3.6, -1.6, 0.75, 0.4], [-3.0, -2.3, 0.42, 1.9], [2.9, 1.9, 0.55, 2.7], [-0.9, -3.2, 0.5, 1.1]]) {
    scene.add(new Mesh({ geometry: rock(x * 3 + z), material: stone, position: [x, heightAt(x, z) - s * 0.25, z], rotation: [0, turn, 0.08], scale: [s * 1.3, s, s], castShadow: true, receiveShadow: true }))
    clear.push([x, z, s * 1.2])
  }

  // ---- the pergola: four posts, two beams, slats across - and a vine over it
  const pergola = scene.add(new Group({ position: [-1.7, heightAt(-1.7, 0.4), 0.4], rotation: [0, 0.3, 0] }))
  const W = 1.1, D = 0.8, H = 2.3
  for (const [x, z] of [[-W, -D], [W, -D], [-W, D], [W, D]]) {
    // sunk 0.2 into the ground, as posts are
    pergola.add(new Mesh({ geometry: box({ width: 0.13, height: H + 0.2, depth: 0.13 }), material: planks, position: [x, H / 2 - 0.1, z], castShadow: true, receiveShadow: true }))
  }
  for (const z of [-D, D]) pergola.add(new Mesh({ geometry: box({ width: W * 2 + 0.6, height: 0.16, depth: 0.09 }), material: planks, position: [0, H + 0.04, z], castShadow: true, receiveShadow: true }))
  const SLATS = 11
  for (let i = 0; i < SLATS; i++) {
    const x = -W - 0.15 + (i / (SLATS - 1)) * (W * 2 + 0.3)
    pergola.add(new Mesh({ geometry: box({ width: 0.06, height: 0.1, depth: D * 2 + 0.5 }), material: planks, position: [x, H + 0.17, 0], castShadow: true, receiveShadow: true }))
  }
  // the vine: leaf cards along the slats, thicker at one end, and trailing down a post
  /** @type {any[]} */
  const vine = []
  // in clumps along the slats, with sky between them - so the sun comes through in dapples
  for (let c = 0; c < 26; c++) {
    const cx = -W - 0.1 + Math.pow(rand(), 0.8) * (W * 2 + 0.2), cz = (rand() - 0.5) * (D * 2 + 0.3)
    const size = 0.16 + rand() * 0.22, n = Math.round(14 + size * 80)
    for (let k = 0; k < n; k++) {
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * size
      vine.push({ position: [cx + Math.cos(a) * d, H + 0.24 + rand() * 0.12, cz + Math.sin(a) * d], rotation: [(rand() - 0.5) * 1.2, rand() * Math.PI * 2, (rand() - 0.5) * 1.2], scale: 0.75 + rand() * 0.6 })
    }
  }
  for (let k = 0; k < 160; k++) {
    const y = H * (0.25 + 0.75 * Math.sqrt(rand()))
    const a = rand() * Math.PI * 2
    vine.push({ position: [-W + Math.cos(a) * 0.12, y, -D + Math.sin(a) * 0.12], rotation: [(rand() - 0.5) * 1.4, rand() * Math.PI * 2, Math.PI / 2 + (rand() - 0.5)], scale: 0.6 + rand() * 0.5 })
  }
  pergola.add(new InstancedMesh({
    geometry: plane({ width: 0.2, depth: 0.2 }),
    material: { map: leaves(), alphaTest: 0.5, doubleSided: true, roughness: 0.55, translucency: 0.55, translucencyColor: '#c6f07a' },
    instances: vine, castShadow: true, receiveShadow: true, pickable: false,
  }))

  // ---- the sundial: a turned stone pillar, a bronze dial with hour marks, and its gnomon
  const dial = scene.add(new Group({ position: [1.4, heightAt(1.4, 0.9), 0.9], rotation: [0, -0.5, 0] }))
  dial.add(new Mesh({
    geometry: lathe({ points: [[0, 0], [0.34, 0], [0.34, 0.08], [0.26, 0.12], [0.2, 0.2], [0.17, 0.62], [0.22, 0.7], [0.3, 0.74], [0.3, 0.8], [0, 0.8]], segments: 48 }),
    material: stone, castShadow: true, receiveShadow: true,
  }))
  dial.add(new Mesh({ geometry: cylinder({ radius: 0.33, height: 0.03, segments: 64 }), material: bronze, position: [0, 0.815, 0], castShadow: true, receiveShadow: true }))
  for (let h = 0; h < 12; h++) {
    const a = (h / 12) * Math.PI * 2
    dial.add(new Mesh({ geometry: box({ width: h % 3 ? 0.012 : 0.02, height: 0.008, depth: h % 3 ? 0.05 : 0.08 }), material: bronze, position: [Math.sin(a) * 0.27, 0.833, Math.cos(a) * 0.27], rotation: [0, a, 0], castShadow: true, receiveShadow: true }))
  }
  // the gnomon across the middle of the dial: turned a quarter so its base runs along the dial's z, from
  // +0.135 to -0.135 - centred on the dial, its tall end at one side, sloping down to the other
  dial.add(new Mesh({ geometry: extrude({ shape: [[0, 0], [0.27, 0], [0.02, 0.2], [0, 0.2]], depth: 0.014 }), material: bronze, position: [0, 0.83, 0.135], rotation: [0, Math.PI / 2, 0], castShadow: true, receiveShadow: true }))

  // ---- a stone ball on a squat plinth
  const orb = scene.add(new Group({ position: [0.7, heightAt(0.7, -1.5), -1.5] }))
  orb.add(new Mesh({ geometry: box({ width: 0.5, height: 0.42, depth: 0.5 }), material: stone, position: [0, 0.21, 0], castShadow: true, receiveShadow: true }))
  orb.add(new Mesh({ geometry: box({ width: 0.58, height: 0.06, depth: 0.58 }), material: stone, position: [0, 0.45, 0], castShadow: true, receiveShadow: true }))
  orb.add(new Mesh({ geometry: sphere({ radius: 0.26, segments: 48, rings: 32 }), material: stone, position: [0, 0.74, 0], castShadow: true, receiveShadow: true }))

  // ---- the lamp post: an iron pole, an arm, a shade - and its spot light, aimed at the middle
  const post = scene.add(new Group({ position: [3.0, heightAt(3.0, -2.3), -2.3] }))
  post.add(new Mesh({ geometry: cylinder({ radius: 0.09, radiusTop: 0.05, height: 0.45 }), material: iron, position: [0, 0.075, 0], castShadow: true, receiveShadow: true }))
  post.add(new Mesh({ geometry: cylinder({ radius: 0.045, height: 3.4 }), material: iron, position: [0, 1.7, 0], castShadow: true, receiveShadow: true }))
  // the arm reaches towards the middle of the garden: turned about y so its +x points there
  const toward = Math.atan2(-2.3, -3.0)
  const arm = post.add(new Group({ position: [0, 3.35, 0], rotation: [0, toward, 0] }))
  arm.add(new Mesh({ geometry: cylinder({ radius: 0.03, height: 0.7, axis: 'x' }), material: iron, position: [0.35, 0, 0], castShadow: true }))
  const head = arm.add(new Group({ position: [0.7, -0.05, 0], rotation: [0, 0, -0.35] }))
  head.add(new Mesh({ geometry: lathe({ points: [[0.03, 0.12], [0.08, 0.1], [0.2, -0.06], [0.21, -0.08], [0.19, -0.08], [0.07, 0.07], [0.02, 0.09]], segments: 40 }), material: { ...iron, doubleSided: true }, castShadow: true }))
  const bulb = head.add(new Mesh({ geometry: sphere({ radius: 0.05 }), material: { color: '#000', emissive: '#ffe6b8', emissiveIntensity: 6 }, position: [0, -0.02, 0], pickable: false }))
  // the light itself in the world, where the shade is, aimed at a point that wanders over the garden
  const lampAt = [3.0 + 0.7 * Math.cos(toward), post.position[1] + 3.24, -2.3 - 0.7 * Math.sin(toward)]
  const aim = [-0.4, 0, 0.6]
  const spot = scene.add(new SpotLight({ position: lampAt, target: aim, color: '#ffe2b4', angle: 0.62, penumbra: 0.5, range: 16 }))

  // ---- the lantern: a candle in an iron cage on a short post; its bars throw shadows all round
  const lantern = scene.add(new Group({ position: [-0.6, heightAt(-0.6, 2.0), 2.0] }))
  lantern.add(new Mesh({ geometry: cylinder({ radius: 0.05, height: 1.1 }), material: iron, position: [0, 0.35, 0], castShadow: true, receiveShadow: true }))
  lantern.add(new Mesh({ geometry: box({ width: 0.3, height: 0.03, depth: 0.3 }), material: iron, position: [0, 0.915, 0], castShadow: true, receiveShadow: true }))
  for (const [x, z] of [[-0.13, -0.13], [0.13, -0.13], [-0.13, 0.13], [0.13, 0.13], [0, -0.13], [0, 0.13], [-0.13, 0], [0.13, 0]]) {
    lantern.add(new Mesh({ geometry: cylinder({ radius: 0.008, height: 0.36 }), material: iron, position: [x, 1.11, z], castShadow: true }))
  }
  for (const y of [1.0, 1.2]) {
    for (const [w, d, x, z] of [[0.27, 0.012, 0, -0.13], [0.27, 0.012, 0, 0.13], [0.012, 0.27, -0.13, 0], [0.012, 0.27, 0.13, 0]]) {
      lantern.add(new Mesh({ geometry: box({ width: w, height: 0.012, depth: d }), material: iron, position: [x, y, z], castShadow: true }))
    }
  }
  lantern.add(new Mesh({ geometry: lathe({ points: [[0, 0.36], [0.06, 0.34], [0.22, 0.22], [0.22, 0.2], [0, 0.2]], segments: 4 }), material: iron, position: [0, 1.09, 0], rotation: [0, Math.PI / 4, 0], castShadow: true }))
  lantern.add(new Mesh({ geometry: cylinder({ radius: 0.035, height: 0.1 }), material: { color: '#efe6d2', roughness: 0.7, translucency: 0.6, translucencyColor: '#ffb070' }, position: [0, 0.98, 0], castShadow: true }))
  const flame = lantern.add(new Mesh({ geometry: sphere({ radius: 0.022 }), material: { color: '#000', emissive: '#ffb050', emissiveIntensity: 9 }, position: [0, 1.06, 0], scale: [1, 1.7, 1], pickable: false }))
  const candle = lantern.add(new PointLight({ position: [0, 1.07, 0], color: '#ffa860', range: 9 }))

  // ---- the sun
  // its shadow map spread only over where things stand - the set pieces and the boulders, up to the
  // lamp's head - so its texels are small and the edges crisp; the ground beyond still gets shadows,
  // from wherever they fall, just coarser
  const sun = scene.add(new DirectionalLight({ color: '#ffd09a', shadowBounds: { min: [-4.6, -0.6, -3.9], max: [3.9, 3.7, 3.2] } }))
  const sky = scene.add(new HemisphereLight())

  // ---- the three lights, each with its time of day: the sky, the fog, the fill, the bulbs
  const MOODS = {
    sun: { name: 'Sun', background: '#c9ab8c', fog: 0.02, sky: ['#cfd8ff', '#4a3a2c', 0.32], env: 0.12, softness: 0.15 },
    spot: { name: 'Spot', background: '#1d2433', fog: 0.035, sky: ['#40506e', '#14120f', 0.2], env: 0.06, softness: 0.3 },
    lantern: { name: 'Lantern', background: '#0b0c14', fog: 0.04, sky: ['#1c2440', '#080706', 0.08], env: 0.02, softness: 0.4 },
  }
  /** @typedef {keyof typeof MOODS} Mood */
  const lights = { sun, spot, lantern: candle }
  const settings = { light: /** @type {Mood} */ ('sun'), soft: true, softness: MOODS.sun.softness, move: true, time: 0.3 }

  const apply = () => {
    const m = MOODS[settings.light]
    scene.background = m.background
    scene.fog = { color: m.background, density: m.fog }
    sky.sky.set(m.sky[0])
    sky.ground.set(m.sky[1])
    sky.intensity = /** @type {number} */ (m.sky[2])
    scene.environmentIntensity = m.env
    for (const [key, light] of Object.entries(lights)) {
      const on = key === settings.light
      light.castShadow = on
      light.shadowSoftness = settings.soft ? settings.softness : 0
    }
    sun.intensity = settings.light === 'sun' ? 3.6 : 0
    spot.intensity = settings.light === 'spot' ? 70 : 0
    bulb.material.emissiveIntensity = settings.light === 'spot' ? 6 : 0.2
    candle.intensity = settings.light === 'lantern' ? 5 : 0
    flame.visible = settings.light === 'lantern'
    showBar()
    gui.updateDisplay()
  }
  // the sun from over the far side of the garden, coming round as the time moves - so its shadows
  // stretch across the ground towards the camera, not away behind what casts them. Low at either end
  // of the day; at midday (0.5) nearly overhead, about 75 degrees up, for short shadows under things
  const placeSun = () => {
    const az = 0.15 + settings.time * 1.3, el = 0.36 + 0.95 * Math.sin(settings.time * Math.PI)
    sun.direction.set(Math.cos(el) * Math.cos(az), -Math.sin(el), Math.cos(el) * Math.sin(az))
  }

  // ---- the bar along the bottom: a light each, and soft or hard to compare
  const bar = document.createElement('div')
  bar.className = 'hud paint-bar'
  bar.innerHTML = `${Object.entries(MOODS).map(([key, m]) => `<button type="button" data-light="${key}">${m.name}</button>`).join('')}
    <span class="paint-gap"></span>
    <button type="button" data-soft title="Contact-hardening soft shadows, or the plain edge">Soft</button>`
  document.body.append(bar)
  bar.addEventListener('click', (event) => {
    const button = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (event.target).closest('button'))
    if (!button) return
    if (button.dataset.light) {
      settings.light = /** @type {Mood} */ (button.dataset.light)
      settings.softness = MOODS[settings.light].softness
    } else if ('soft' in button.dataset) settings.soft = !settings.soft
    apply()
  })
  function showBar() {
    for (const b of bar.querySelectorAll('[data-light]')) b.classList.toggle('now', /** @type {HTMLElement} */ (b).dataset.light === settings.light)
    const soft = /** @type {HTMLElement} */ (bar.querySelector('[data-soft]'))
    soft.textContent = settings.soft ? 'Soft' : 'Hard'
    soft.classList.toggle('now', settings.soft)
  }

  // ---- the panel: the finer settings
  gui.add(settings, 'light', Object.fromEntries(Object.entries(MOODS).map(([key, m]) => [m.name, key]))).onChange(() => {
    settings.softness = MOODS[settings.light].softness
    apply()
  })
  gui.add(settings, 'soft').name('soft shadows').onChange(apply)
  gui.add(settings, 'softness', 0, 1, 0.05).name('shadow softness').onChange(apply)
  gui.add(settings, 'move').name('move the light')
  gui.add(settings, 'time', 0, 1, 0.01).name('time of day').onChange(placeSun)

  placeSun()
  apply()
  // each light needs shaders of its own, which take a moment to compile the first time - so once the
  // garden is showing, start the other lights' compiling: draw each once, unseen (only the last frame
  // drawn in a task reaches the screen), and put this one back
  setTimeout(() => {
    const keep = settings.light
    for (const key of /** @type {Mood[]} */ (Object.keys(MOODS))) {
      if (key === keep) continue
      settings.light = key
      apply()
      view.render()
    }
    settings.light = keep
    apply()
    view.render()
  }, 1200)

  let t = 0
  // which way the sun is moving through the day: on, or back
  let sunWay = 1
  return view.start((dt) => {
    t += dt
    if (settings.move) {
      if (settings.light === 'sun') {
        // the sun goes on to evening, then back towards morning - never jumping from one to the other
        settings.time += dt * 0.01 * sunWay
        if (settings.time >= 1 || settings.time <= 0) {
          settings.time = Math.min(1, Math.max(0, settings.time))
          sunWay = -sunWay
        }
        placeSun()
      }
      // the lamp head nods slowly, its pool of light sweeping the stones
      if (settings.light === 'spot') {
        const x = aim[0] + Math.sin(t * 0.27) * 1.3, z = aim[2] + Math.sin(t * 0.19) * 0.9
        spot.target = [x, 0, z]
        head.rotation.z = -0.35 + Math.sin(t * 0.27) * 0.12
      }
    }
    // a candle flickers
    if (settings.light === 'lantern') {
      const f = 0.85 + 0.1 * Math.sin(t * 13.1) + 0.06 * Math.sin(t * 29.7 + 1.3)
      candle.intensity = 5 * f
      flame.scale.set(1, 1.7 * (0.9 + 0.15 * f), 1)
    }
  })
}
