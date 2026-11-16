import { Geometry, Group, HemisphereLight, Mesh, Quat, RectAreaLight, View, box, cylinder, lathe, plane, sphere, torus } from 'phoria2'

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
    // bloom works in light: past 1.5 - half as bright again as a white surface in full light - the
    // softbox's face and its reflections glow, more the brighter it is; the lit marble and card don't
    bloom: { strength: 0.42, radius: 0.7, threshold: 1.5 },
    // still (the softbox not moving), the picture refines: antialiased, and the softbox's shadows
    // exact - each sample's from a different point on it
    refine: true,
  })
  const scene = view.scene

  const settings = { keyWidth: 2.4, keyHeight: 0.8, keyIntensity: 75, floorGloss: 0.85, shadows: true, bounce: true, place: 0, move: false, aperture: 0, focus: 0 }

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

  /**
   * A light's rectangle as world points: `at(a, b)` is its middle plus a halves of its width and b of
   * its height, `back` world units behind its face. @param {RectAreaLight} light
   */
  const frameOf = (light) => {
    scene.updateWorldTree()
    const [hw, hh] = light.worldEdges
    const p = light.worldPosition, d = light.worldDirection
    return (/** @type {number} */ a, /** @type {number} */ b, back = 0, /** @type {number} */ s = 1) =>
      [0, 1, 2].map((i) => p[i] + (hw[i] * a + hh[i] * b) * s - d[i] * back)
  }
  /**
   * A closed solid from its faces, each four corners: flat shaded, every face wound to face outwards
   * (away from the middle of all its corners).
   * @param {number[][][]} faces
   */
  const solid = (faces) => {
    const all = faces.flat(), mid = [0, 1, 2].map((i) => all.reduce((t, c) => t + c[i], 0) / all.length)
    const positions = [], normals = [], indices = []
    for (let [a, b, c, d] of faces) {
      const u = [0, 1, 2].map((i) => b[i] - a[i]), v = [0, 1, 2].map((i) => d[i] - a[i])
      let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
      const out = [0, 1, 2].reduce((t, i) => t + n[i] * ((a[i] + c[i]) / 2 - mid[i]), 0)
      if (out < 0) {
        ;[b, d] = [d, b]
        n = n.map((x) => -x)
      }
      const len = Math.hypot(...n) || 1
      const base = positions.length / 3
      for (const corner of [a, b, c, d]) {
        positions.push(...corner)
        normals.push(...n.map((x) => x / len))
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
    return new Geometry({ positions, normals, indices })
  }

  // the softbox: its diffuser glowing - bright enough to bloom - in front of a black fabric body
  // tapering back to where it would mount, so it reads as a light, not a pale board
  const diffuserOf = (/** @type {RectAreaLight} */ light) => {
    const at = frameOf(light)
    return new Geometry({ positions: [...at(1, -1, 0.01), ...at(-1, -1, 0.01), ...at(-1, 1, 0.01), ...at(1, 1, 0.01)], indices: [0, 1, 2, 0, 2, 3] })
  }
  const bodyOf = (/** @type {RectAreaLight} */ light) => {
    const at = frameOf(light)
    // the rim just round the diffuser, the back a third the size, half a metre behind
    const rim = (/** @type {number} */ a, /** @type {number} */ b) => at(a, b, 0.012, 1.03), rear = (/** @type {number} */ a, /** @type {number} */ b) => at(a, b, 0.5, 0.35)
    const corners = /** @type {[number, number][]} */ ([[1, -1], [-1, -1], [-1, 1], [1, 1]])
    const sides = corners.map(([a, b], i) => {
      const [c, d] = corners[(i + 1) % 4]
      return [rim(a, b), rim(c, d), rear(c, d), rear(a, b)]
    })
    return solid([...sides, corners.map(([a, b]) => rear(a, b))])
  }
  const keyPanel = scene.add(new Mesh({ geometry: diffuserOf(key), castShadow: false, receiveShadow: false, pickable: false,
    material: { color: '#000000', emissive: '#fff1de', emissiveIntensity: 8, doubleSided: true } }))
  const keyBody = scene.add(new Mesh({ geometry: bodyOf(key), castShadow: false, receiveShadow: false, pickable: false,
    material: { color: '#141416', roughness: 0.85 } }))

  // a bounce card on the far side, as a photographer would stand one: a white foam board on a little
  // tripod, catching the softbox and throwing some of it back into the shadow side. The board doesn't
  // glow - it is only as bright as the softbox lights it; the light it sends back is a dim rect light
  // at its face, with no shadow
  const bounce = scene.add(new RectAreaLight({ color: '#fff4e8', width: 1.92, height: 1.44, intensity: 6, position: [2.9, 1.15, 0.4], target: [0, 0.45, 1.2] }))
  const rig = scene.add(new Group())
  {
    const at = frameOf(bounce)
    // the board, 2 cm thick, just behind the light's face
    const corners = /** @type {[number, number][]} */ ([[1, -1], [-1, -1], [-1, 1], [1, 1]])
    const front = corners.map(([a, b]) => at(a, b, 0.01)), back = corners.map(([a, b]) => at(a, b, 0.03))
    const edges = corners.map((_, i) => [front[i], front[(i + 1) % 4], back[(i + 1) % 4], back[i]])
    rig.add(new Mesh({ geometry: solid([front, back, ...edges]), castShadow: false, receiveShadow: true,
      material: { color: '#cdcac3', roughness: 0.9 } }))
    // the stand: a pole up behind the board's lower edge, a clamp holding it, three legs splayed from a hub
    const foot = at(0, -1, 0.06)
    const metal = { color: '#2a2b2e', metalness: 0.8, roughness: 0.35 }
    const hub = 0.32
    rig.add(new Mesh({ geometry: cylinder({ radius: 0.014, height: foot[1] - hub + 0.1, segments: 12 }), material: metal,
      position: [foot[0], (foot[1] + hub + 0.1) / 2, foot[2]] }))
    rig.add(new Mesh({ geometry: box({ width: 0.08, height: 0.05, depth: 0.06 }), material: metal, position: [foot[0], foot[1] + 0.06, foot[2]] }))
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.4
      const toe = [foot[0] + Math.cos(a) * 0.3, 0, foot[2] + Math.sin(a) * 0.3]
      const v = [foot[0] - toe[0], hub, foot[2] - toe[2]], len = Math.hypot(...v)
      // turned from straight up to lean in from the toe to the hub
      const axis = [v[2], 0, -v[0]], al = Math.hypot(...axis)
      const q = new Quat().setFromAxisAngle([axis[0] / al, 0, axis[2] / al], Math.acos(v[1] / len))
      rig.add(new Mesh({ geometry: cylinder({ radius: 0.01, height: len, segments: 8 }), material: metal, quaternion: q.toArray(),
        position: [(toe[0] + foot[0]) / 2, hub / 2, (toe[2] + foot[2]) / 2] }))
    }
  }

  // the key's place on its arc round the front left, -1 to 1 - set by its slider, or swinging slowly
  // back and forth; always aimed at the subjects
  let swing = 0
  // The light reaching the card from the softbox, as a point light of its intensity would give it:
  // facing each other or not, over the distance squared
  const onCard = () => {
    scene.updateWorldTree()
    const kp = key.worldPosition, kd = key.worldDirection, bp = bounce.worldPosition, bd = bounce.worldDirection
    const l = [kp[0] - bp[0], kp[1] - bp[1], kp[2] - bp[2]], d2 = l[0] * l[0] + l[1] * l[1] + l[2] * l[2], len = Math.sqrt(d2)
    const card = Math.max(0, (bd[0] * l[0] + bd[1] * l[1] + bd[2] * l[2]) / len), box = Math.max(0, -(kd[0] * l[0] + kd[1] * l[1] + kd[2] * l[2]) / len)
    return key.intensity * card * box / d2
  }
  // the card sends back what reaches it: none with the softbox off, more as it swings round to face it -
  // as much as at the start (intensity 6) for the light the card got then. And more from a bigger
  // softbox: by the square root of its area against the starting 2.4 x 0.8 m - gently - up to twice.
  // (Staging, not physics: intensity is a point light's, so a bigger softbox is softer, not brighter)
  let onCardAtStart = 0
  const placeKey = () => {
    const a = 2.35 + settings.place * 0.45
    key.position.set(Math.cos(a) * 3.2, 3.1, Math.sin(a) * -3.2 + 1.2)
    key.target = [0, 0.4, 0.2]
    keyPanel.geometry = diffuserOf(key)
    keyBody.geometry = bodyOf(key)
    if (!onCardAtStart) {
      const was = key.intensity
      key.intensity = 75
      onCardAtStart = onCard()
      key.intensity = was
    }
    const size = Math.min(2, Math.sqrt((key.width * key.height) / 1.92))
    bounce.intensity = settings.bounce && onCardAtStart ? 6 * size * onCard() / onCardAtStart : 0
  }

  const apply = () => {
    key.width = settings.keyWidth
    key.height = settings.keyHeight
    key.intensity = settings.keyIntensity
    // its face as bright as the light it gives: with the intensity, spread over its area (8 at the
    // starting 75 over 2.4 x 0.8 m)
    keyPanel.material.emissiveIntensity = 8 * (settings.keyIntensity / 75) * (1.92 / (settings.keyWidth * settings.keyHeight))
    key.castShadow = settings.shadows
    rig.visible = settings.bounce
    floor.material.roughness = 1 - settings.floorGloss
    placeKey()
  }

  gui.add(settings, 'keyWidth', 0.2, 4, 0.05).name('softbox width').onChange(apply)
  gui.add(settings, 'keyHeight', 0.2, 3, 0.05).name('softbox height').onChange(apply)
  gui.add(settings, 'keyIntensity', 0, 200, 1).name('softbox intensity').onChange(apply)
  gui.add(settings, 'floorGloss', 0, 1, 0.05).name('floor gloss').onChange(apply)
  gui.add(settings, 'shadows').onChange(apply)
  gui.add(settings, 'bounce').name('bounce card').onChange(apply)
  const place = gui.add(settings, 'place', -1, 1, 0.01).name('softbox position').onChange(() => {
    // moving on from here when it swings again
    swing = Math.asin(settings.place)
    placeKey()
  })
  gui.add(settings, 'move').name('move the softbox')
  gui.add({ refine: true }, 'refine').name('refine when still').onChange((on) => { view.refine = on })
  // depth of field, shown as the picture refines: the lens's radius, and the focus nearer or further
  // than the orbit's pivot
  const camera = /** @type {import('phoria2').PerspectiveCamera} */ (view.camera)
  const lens = gui.addFolder('Lens (refined)')
  lens.add(settings, 'aperture', 0, 0.25, 0.005).name('aperture').onChange((v) => { camera.aperture = v })
  lens.add(settings, 'focus', -3, 3, 0.05).name('focus from pivot')
  apply()

  return view.start((dt) => {
    // the focus follows the pivot as the view orbits and zooms: on it, or the slider's way nearer or further
    const pivot = camera.target ? camera.position.distanceTo(camera.target) : 10
    const focus = settings.focus ? Math.max(0.2, pivot + settings.focus) : null
    if (camera.focusDistance !== focus) camera.focusDistance = focus
    if (!settings.move) return
    swing += dt * 0.25
    settings.place = Math.sin(swing)
    place.updateDisplay()
    placeKey()
  })
}
