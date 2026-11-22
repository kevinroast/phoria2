import { Geometry, Group, HemisphereLight, Mesh, RectAreaLight, View, box, cylinder, lathe, roundedBox } from 'phoria2'

// A heavy-based whisky tumbler on a checkerboard table, lit like a product shot by two softboxes and
// a strip light behind. Glass seen through glass: the drink is its own piece of glass, drawn after
// the tumbler (renderOrder), so it bends the checks behind both - the thin walls shift them a
// little, the thick base and the drink sweep them round. The ice is rounded boxes of glass in the
// drink; the softboxes are crisp rectangles in the glass; the glass stands in its own soft ground
// shadow, lighter than a solid's. Still, the picture refines. Built from an agent eval's page (eval
// v3, glass-tumbler-refraction).

// sizes in metres; the tumbler stands on the table top at y = 0
const H = 0.092, BASE = 0.022, WALL = 0.0032, R_FOOT = 0.0325, FLARE = 0.006, SEGMENTS = 112
const outerR = (/** @type {number} */ y) => R_FOOT + FLARE * Math.pow(y / H, 1.6)
const innerR = (/** @type {number} */ y) => outerR(y) - WALL
const FLOOR = -0.45
// the table top, a hair under the glass's foot at y = 0 - the two never share a depth and flicker
const TABLE = -0.0006
const FILL = BASE + (H - BASE) * 0.667
const LIFT = 0.0006
const LIQUIDS = {
  whisky: { color: '#dd8a1e', ice: '#ffe6bf' },
  cola: { color: '#3a1709', ice: '#b9937a' },
  empty: null,
}

/** The tumbler's wall: up the outside, over a rounded rim and down the inside to the base. */
function wallProfile() {
  const points = [], steps = 14, top = H - 0.0016
  for (let i = 0; i <= steps; i++) {
    const y = BASE + ((top - BASE) * i) / steps
    points.push([outerR(y), y])
  }
  const middle = (outerR(H) + innerR(H)) / 2, r = WALL / 2
  for (let i = 1; i < 9; i++) {
    const a = (i / 9) * Math.PI
    points.push([middle + r * Math.cos(a), H - r + r * Math.sin(a)])
  }
  for (let i = steps; i >= 0; i--) {
    const y = BASE + ((top - BASE) * i) / steps
    points.push([innerR(y), y])
  }
  return points
}

/** The base: a solid disc of glass up to the inside floor, its foot softly rounded. */
function baseProfile() {
  const r = outerR(BASE), round = 0.0035
  const points = [[0, 0], [r - round, 0]]
  for (let i = 1; i <= 5; i++) {
    const a = (i / 5) * Math.PI / 2
    points.push([r - round + round * Math.sin(a), round - round * Math.cos(a)])
  }
  points.push([r, BASE], [0, BASE])
  return points
}

/** The drink: the inside of the wall, two thirds up, with a flat top - its floor a hair above the
 * base's top (LIFT), so the two faces never share a depth and flicker. */
function drinkProfile() {
  const floor = BASE + LIFT
  const points = [[0, floor]]
  for (let i = 0; i <= 8; i++) {
    const y = floor + ((FILL - floor) * i) / 8
    points.push([innerR(y) - 0.0003, y])
  }
  points.push([0, FILL])
  return points
}

/** A studio wall curving into the floor: a profile swept along x. */
function cove() {
  const zc = -0.9, R = 0.7, yc = FLOOR + R
  /** @type {[number, number, number, number][]} z, y and the normal's z, y */
  const profile = [[2.6, FLOOR, 0, 1], [zc, FLOOR, 0, 1]]
  for (let k = 1; k <= 24; k++) {
    const a = (k / 24) * Math.PI / 2
    profile.push([zc - R * Math.sin(a), yc - R * Math.cos(a), Math.sin(a), Math.cos(a)])
  }
  profile.push([zc - R, yc + 2.2, 1, 0])
  const positions = [], normals = [], indices = []
  for (const [z, y, nz, ny] of profile) {
    positions.push(-3, y, z, 3, y, z)
    normals.push(0, ny, nz, 0, ny, nz)
  }
  for (let k = 0; k + 1 < profile.length; k++) {
    const a = k * 2
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  return new Geometry({ positions, normals, indices })
}

export default function run({ canvas, gui }) {
  const view = new View({
    canvas, background: '#c6c6c9', fxaa: true, refine: true,
    camera: { position: [0.246, 0.166, 0.318], target: [0, 0.042, 0], fov: 28, near: 0.02, far: 30 },
    orbit: { minDistance: 0.12, maxDistance: 1.1, minPitch: 0.03, maxPitch: 1.5 },
    // the glass's soft contact shadow on the table, round its foot - glass leaves it off the table
    // right under it, which is seen through the glass
    groundShadow: { y: TABLE, size: 0.24, height: 0.06, softness: 0.8, opacity: 1 },
  })
  const scene = view.scene
  scene.environment = 'studio'
  scene.environmentIntensity = 0.12

  // the table: a round top printed with checks - a few lines of shader hook, antialiased by how fast
  // they change across a pixel (fwidth) - on a dark stand, in front of the cove
  scene.add(new Mesh({
    geometry: cylinder({ radius: 0.42, height: 0.03, segments: 128 }), position: [0, TABLE - 0.015, 0], receiveShadow: true,
    material: {
      roughness: 0.75,
      shader: {
        uniforms: { uCheck: 0.04 },
        fragment: `
          if (vNormal.y > 0.5) {
            vec2 p = vWorldPosition.xz / uCheck;
            vec2 w = fwidth(p) + 0.0005;
            vec2 i = 2.0 * (abs(fract((p - 0.5 * w) * 0.5) - 0.5) - abs(fract((p + 0.5 * w) * 0.5) - 0.5)) / w;
            base.rgb = vec3(mix(0.012, 0.6, 0.5 - 0.5 * i.x * i.y));
          }`,
      },
    },
  }))
  const metal = { color: '#34343a', metalness: 0.7, roughness: 0.3 }
  scene.add(new Mesh({ geometry: cylinder({ radius: 0.034, height: 0.42, segments: 48 }), position: [0, -0.24, 0], material: metal, receiveShadow: true }))
  scene.add(new Mesh({ geometry: cylinder({ radius: 0.2, height: 0.02, segments: 64 }), position: [0, FLOOR + 0.01, 0], material: metal, receiveShadow: true }))
  scene.add(new Mesh({ geometry: cove(), material: { color: '#d2d2d5', roughness: 0.92, doubleSided: true }, receiveShadow: true }))

  // the studio: a little fill all round, two softboxes (warm left, cool right) and a strip behind -
  // each a rect-area light, its glowing panel beside it to be seen in the glass; the panels only
  // receive shadows, so they stay out of the glass's ground shadow. And the key: a small light high
  // behind, out of sight, lighting the glass through so its coloured shadow falls towards you - with
  // caustics, the drink and the heavy base gathering its light into a bright pool in the shadow. Small
  // (3 cm), as a big light softens caustics and shadows away - refined, each is cast from all over it
  scene.add(new HemisphereLight({ sky: '#f2f2f6', ground: '#9a9a9e', intensity: 0.15 }))
  const target = [0, 0.045, 0]
  for (const [x, color, glow] of [[-0.52, '#ffe0bd', '#ffd9ae'], [0.52, '#cfe3ff', '#c4dcff']]) {
    const at = [/** @type {number} */ (x), 0.3, 0.22]
    scene.add(new RectAreaLight({ position: at, target, width: 0.42, height: 0.55, intensity: 0.3, color: /** @type {string} */ (color), castShadow: true }))
    const dx = target[0] - at[0], dz = target[2] - at[2]
    scene.add(new Mesh({
      geometry: box({ width: 0.42, height: 0.55, depth: 0.012 }), position: [at[0] - dx * 0.01, at[1], at[2] - dz * 0.01],
      rotation: [0, Math.atan2(dx, dz), 0], material: { color: '#222226', emissive: /** @type {string} */ (glow), emissiveIntensity: 2.2, roughness: 0.6 }, receiveShadow: true,
    }))
  }
  scene.add(new RectAreaLight({ position: [0, 0.2, -0.5], direction: [0, -0.1, 1], width: 0.045, height: 0.7, intensity: 0.45, castShadow: true }))
  const key = scene.add(new RectAreaLight({ position: [0, 0.42, -0.42], target: [0, 0.03, 0], width: 0.03, height: 0.03, intensity: 3, castShadow: true, caustics: true }))
  scene.add(new Mesh({
    geometry: box({ width: 0.045, height: 0.7, depth: 0.01 }), position: [0, 0.2, -0.51],
    material: { color: '#222226', emissive: '#ffffff', emissiveIntensity: 3.2 }, receiveShadow: true,
  }))

  // the tumbler: a thin-walled shell and a solid base, the drink its own glass drawn after them
  // (renderOrder 1), the ice after that
  const clear = { color: '#ffffff', transmission: 1, roughness: 0.015, ior: 1.5, attenuationColor: '#cfeee2', attenuationDistance: 0.06 }
  const glass = scene.add(new Group({ name: 'tumbler' }))
  glass.add(new Mesh({ geometry: lathe({ points: wallProfile(), segments: SEGMENTS }), material: { ...clear, thickness: 0.004, thinWalled: true, doubleSided: true }, castShadow: true }))
  glass.add(new Mesh({ geometry: lathe({ points: baseProfile(), segments: SEGMENTS }), material: { ...clear, thickness: 0.02, doubleSided: true, attenuationDistance: 0.05 }, castShadow: true }))
  const drink = scene.add(new Mesh({
    geometry: lathe({ points: drinkProfile(), segments: SEGMENTS }), renderOrder: 1, castShadow: true,
    material: { transmission: 1, thickness: 0.05, ior: 1.33, roughness: 0.02, attenuationColor: '#dd8a1e', attenuationDistance: 0.045 },
  }))
  const cube = roundedBox({ size: 0.024, radius: 0.0045, segments: 5 })
  const SPOTS = [
    { floating: [-0.01, FILL - 0.0075, 0.004], resting: [-0.014, BASE + 0.0135, 0.002], rotation: [0.35, 0.55, 0.15] },
    { floating: [0.011, FILL - 0.0055, -0.008], resting: [0.014, BASE + 0.0135, -0.004], rotation: [-0.2, 1.15, 0.42] },
  ]
  const ice = SPOTS.map((s) => scene.add(new Mesh({
    geometry: cube, rotation: s.rotation, renderOrder: 2, castShadow: true,
    material: { transmission: 1, thickness: 0.022, ior: 1.31, roughness: 0.1, attenuationColor: '#eaf6ff', attenuationDistance: 0.12 },
  })))

  const settings = { drink: 'whisky' }
  const pour = () => {
    const liquid = LIQUIDS[/** @type {keyof typeof LIQUIDS} */ (settings.drink)]
    drink.visible = !!liquid
    if (liquid) drink.material.attenuationColor.set(liquid.color)
    ice.forEach((c, i) => {
      const [x, y, z] = liquid ? SPOTS[i].floating : SPOTS[i].resting
      c.position.set(x, y, z)
      // ice in a drink takes its colour; dry, it is clear
      c.material.color.set(liquid ? liquid.ice : '#ffffff')
      c.material.attenuationColor.set(liquid ? liquid.ice : '#eaf6ff')
      c.material.attenuationDistance = liquid ? 0.05 : 0.12
    })
  }
  pour()

  gui.add(settings, 'drink', Object.keys(LIQUIDS)).onChange(pour)
  gui.add(key, 'caustics')
  gui.add({ refine: true }, 'refine').name('refine when still').onChange((on) => { view.refine = on })

  return view.start()
}
