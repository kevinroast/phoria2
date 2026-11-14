import { Geometry, HemisphereLight, Mesh, RectAreaLight, View, box, lathe, plane, sphere, torus } from 'phoria2'

// A rect-area light in a small photo studio: a softbox over to one side. Light from a whole
// rectangle, not a point: the glossy floor reflects its shape, a glazed vase and a marble block show
// broad soft highlights, a hammered copper ball breaks it into facets and a metal-flake ring glints. Its shadows are soft - sharp
// where things touch the floor, widening as they fall away - as soft as the softbox is big: make it
// smaller and they sharpen, or long and thin for a strip light. Its panel is drawn where it is,
// glowing, so its reflection can be traced back to it.

/**
 * A photographer's sweep: flat from `at` (z) back, curving up through a quarter circle into a wall -
 * the floor-to-wall corner gone, so the backdrop has no line in it.
 * @param {{ width: number, radius: number, height: number, at: number }} o
 */
function sweep({ width, radius, height, at }) {
  /** @type {[number, number, number, number][]} y, z and the normal's y, z along the profile */
  const profile = []
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI / 2
    profile.push([radius - radius * Math.cos(a), at - radius * Math.sin(a), Math.cos(a), Math.sin(a)])
  }
  profile.push([height, at - radius, 0, 1])
  const positions = [], normals = [], indices = []
  for (const [y, z, ny, nz] of profile) {
    for (const x of [-width / 2, width / 2]) {
      positions.push(x, y, z)
      normals.push(0, ny, nz)
    }
  }
  for (let i = 0; i < profile.length - 1; i++) {
    const a = i * 2
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  return new Geometry({ positions, normals, indices })
}

export default function run({ canvas, gui }) {
  const view = new View({
    canvas, background: '#0b0c10',
    camera: { position: [2.6, 2.3, 6.6], target: [-0.3, 1.0, -0.3], fov: 40 },
    orbit: { minDistance: 3, maxDistance: 14, minPitch: 0.05, maxPitch: 1.2 },
    bloom: { strength: 0.35, radius: 0.5, threshold: 0.95 },
  })
  const scene = view.scene

  const settings = { keyWidth: 2.4, keyHeight: 0.8, keyIntensity: 75, floorGloss: 0.85, shadows: true, bounce: true, move: true }

  // the set: a dark floor, polished, faintly mottled like sealed concrete - and behind it a matt sweep,
  // curving up from the floor into the wall, as a photographer's backdrop paper does
  const floor = scene.add(new Mesh({ geometry: plane({ width: 16, depth: 10 }), position: [0, 0, 2], receiveShadow: true,
    material: { color: '#26272b', roughness: 0.15, shader: { fragment: 'base.rgb *= 0.8 + 0.4 * sfbm(vWorldPosition.xz * 0.7);' } } }))
  scene.add(new Mesh({ geometry: sweep({ width: 16, radius: 2, height: 7, at: -3 }), material: { color: '#3a3c42', roughness: 0.9 }, receiveShadow: true }))

  // the subjects: a hammered copper ball, a glazed vase, a marble block and a ring in metal-flake paint
  // - each a few lines of shader hook over the built-in noise, so the light has something to play on.
  // The ball's dimples are cells of cellular noise, each a shallow bowl: the normal bent by the slope of
  // the distance to its middle (from samples a hair apart), breaking the softbox into many highlights
  const hammered = {
    fragment: `vec3 p = vWorldPosition * 8.0;
float e = 0.02, h = voronoi(p).x;
vec3 g = vec3(voronoi(p + vec3(e, 0.0, 0.0)).x - h, voronoi(p + vec3(0.0, e, 0.0)).x - h, voronoi(p + vec3(0.0, 0.0, e)).x - h) / e;
normal = normalize(normal - (g - normal * dot(g, normal)) * 0.12);
base.rgb *= 0.85 + 0.25 * sfbm(vWorldPosition * 3.0);`,
  }
  scene.add(new Mesh({ geometry: sphere({ radius: 0.55, segments: 64 }), material: { color: '#f2a283', metalness: 1, roughness: 0.14, shader: hammered },
    position: [-1.35, 0.55, 0.3], castShadow: true, receiveShadow: true }))
  // the vase's profile: a full belly narrowing to a neck, a lip turned out at the top and back in
  const vase = [[0, 0]]
  for (let i = 0; i <= 32; i++) {
    const t = i / 32, y = t * 1.6
    vase.push([0.2 + 0.26 * Math.sin(Math.min(1, t * 1.25) * Math.PI) ** 1.4 + 0.07 * Math.max(0, t - 0.85) / 0.15, y])
  }
  vase.push([0.24, 1.66], [0.18, 1.58], [0, 1.58])
  // a crackle-glazed celadon: the glaze deeper green where it pooled low, paler on the shoulder, mottled
  // by fbm; fine crazing from the cells' edges (cellular noise, voronoi) - in world space, so no seam
  // where the lathe's UVs wrap round - and an iron-brown rim
  const glaze = {
    fragment: `vec3 v = voronoi(vWorldPosition * 9.0);
float craze = 1.0 - smoothstep(0.0, 0.05, v.y - v.x);
float mottle = sfbm(vWorldPosition * 2.5);
float rise = smoothstep(0.1, 1.4, vWorldPosition.y);
vec3 glaze = mix(srgb(vec3(0.36, 0.52, 0.46)), srgb(vec3(0.72, 0.82, 0.74)), rise * 0.75 + (mottle - 0.5) * 0.6);
base.rgb = glaze * (1.0 - 0.4 * craze * (0.6 + 0.4 * v.z));
base.rgb = mix(base.rgb, srgb(vec3(0.33, 0.21, 0.13)), smoothstep(1.46, 1.52, vWorldPosition.y));`,
  }
  scene.add(new Mesh({ geometry: lathe({ points: vase, segments: 64 }), material: { color: '#ffffff', roughness: 0.22, shader: glaze }, position: [0.15, 0, -0.4], castShadow: true, receiveShadow: true }))
  // the block: a cube's edges rounded in its vertex hook - each vertex pulled onto a smaller cube grown
  // by the radius, its normal from that - and veined white marble from warped stripes of fbm, polished
  const marble = {
    vertex: `vec3 q = clamp(local, vec3(-0.27), vec3(0.27));
n = normalize(local - q);
local = q + n * 0.08;`,
    fragment: `vec3 p = vWorldPosition * 2.2;
float w = sfbm(p, 5);
float vein = pow(1.0 - abs(sin(p.x * 1.1 + p.y * 1.7 + p.z * 0.6 + w * 6.0)), 14.0);
float fine = pow(1.0 - abs(sin(p.x * 2.3 - p.y * 0.9 + p.z * 1.4 + w * 9.0)), 40.0);
base.rgb = srgb(vec3(0.93, 0.91, 0.88)) * (0.88 + 0.12 * w);
base.rgb = mix(base.rgb, srgb(vec3(0.42, 0.43, 0.47)), clamp(vein * 0.75 + fine * 0.35, 0.0, 1.0));`,
  }
  scene.add(new Mesh({ geometry: box({ size: 0.7, segments: 12 }), material: { color: '#ffffff', roughness: 0.3, shader: marble },
    position: [1.45, 0.35, 0.55], rotation: [0, 0.5, 0], castShadow: true, receiveShadow: true }))
  // the ring: metal-flake paint under a clear coat - each tiny cell of cellular noise a flake tilted its
  // own way (its random number, hashed), so they glint one by one as the light moves
  const flakes = {
    fragment: `vec3 f = voronoi(vWorldPosition * 90.0);
normal = normalize(normal + (vec3(hash(f.z), hash(f.z + 0.37), hash(f.z + 0.71)) - 0.5) * 0.16);`,
  }
  scene.add(new Mesh({ geometry: torus({ radius: 0.36, tube: 0.13, segments: 96, tubeSegments: 32 }),
    material: { color: '#1f4fb8', metalness: 0.5, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.04, shader: flakes },
    position: [-0.2, 0.13, 1.25], castShadow: true, receiveShadow: true }))

  // a little light from all round, so nothing is quite black
  scene.add(new HemisphereLight({ sky: '#9aa4b8', ground: '#2a2826', intensity: 0.12 }))

  // the light: a warm softbox above and to the left
  const key = scene.add(new RectAreaLight({ color: '#fff1de', castShadow: true }))

  /** The light's panel, glowing where it is: its four corners, facing the way it shines. @param {RectAreaLight} light */
  const panelOf = (light) => {
    scene.updateWorldTree()
    const [hw, hh] = light.worldEdges
    const p = light.worldPosition, d = light.worldDirection
    // just behind the light's face, so it doesn't stand in its own light
    const at = (/** @type {number} */ a, /** @type {number} */ b) => [0, 1, 2].map((i) => p[i] + hw[i] * a + hh[i] * b - d[i] * 0.01)
    return new Geometry({ positions: [...at(1, -1), ...at(-1, -1), ...at(-1, 1), ...at(1, 1)], indices: [0, 1, 2, 0, 2, 3] })
  }
  const glowing = (/** @type {string} */ color) => ({ color: '#000000', emissive: color, emissiveIntensity: 3, doubleSided: true })
  const keyPanel = scene.add(new Mesh({ geometry: panelOf(key), material: glowing('#fff1de'), castShadow: false, receiveShadow: false }))
  // a bounce card on the far side, as a photographer would stand one: a white board catching the
  // softbox and throwing a little of it back into the shadow side - a dim rect light of its own, no
  // shadow, and the board drawn where it is, so its soft reflection in the glossy things makes sense
  const bounce = scene.add(new RectAreaLight({ color: '#fff4e8', width: 1.6, height: 1.2, intensity: 6, position: [2.7, 0.9, 2.3], target: [0, 0.4, 0.4] }))
  const card = scene.add(new Mesh({ geometry: panelOf(bounce), castShadow: false, receiveShadow: false,
    material: { color: '#d9d5cd', roughness: 0.95, emissive: '#fff4e8', emissiveIntensity: 0.35, doubleSided: true } }))

  let swing = 0
  // the key swings slowly round the front left, always aimed at the subjects
  const placeKey = () => {
    const a = 2.35 + Math.sin(swing) * 0.45
    key.position.set(Math.cos(a) * 3.2, 3.1, Math.sin(a) * -3.2 + 1.2)
    key.target = [0, 0.4, 0.2]
    keyPanel.geometry = panelOf(key)
  }

  const apply = () => {
    key.width = settings.keyWidth
    key.height = settings.keyHeight
    key.intensity = settings.keyIntensity
    key.castShadow = settings.shadows
    bounce.intensity = settings.bounce ? 6 : 0
    card.visible = settings.bounce
    floor.material.roughness = 1 - settings.floorGloss
    placeKey()
  }

  gui.add(settings, 'keyWidth', 0.2, 4, 0.05).name('softbox width').onChange(apply)
  gui.add(settings, 'keyHeight', 0.2, 3, 0.05).name('softbox height').onChange(apply)
  gui.add(settings, 'keyIntensity', 0, 200, 1).name('softbox intensity').onChange(apply)
  gui.add(settings, 'floorGloss', 0, 1, 0.05).name('floor gloss').onChange(apply)
  gui.add(settings, 'shadows').onChange(apply)
  gui.add(settings, 'bounce').name('bounce card').onChange(apply)
  gui.add(settings, 'move').name('move the softbox')
  apply()

  return view.start((dt) => {
    if (!settings.move) return
    swing += dt * 0.25
    placeKey()
  })
}
