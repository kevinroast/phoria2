import { DirectionalLight, Geometry, Group, HemisphereLight, InstancedMesh, Mesh, Points, SpotLight, Texture, View, box, curve, cylinder, icosphere, lathe, plane } from 'phoria2'
import { glow, random } from './kit.js'

// A harbour on a foggy night. Lamps along the quay are spot lights casting shadows - of the
// bollards, barrels and crates, and of each other's posts - into fog thick enough to hide the far
// side; the lighthouse out on the breakwater sweeps its beam, a fourth shadow-casting spot light,
// across the water and the boats. The moon behind the cloud casts faint shadows of its own. The
// lamps' cones and the beam are additive, so the fog fades them out with distance rather than
// greying them. The boats' decks are the flat caps of section planes through their hulls.

const NIGHT = '#0d141c'
const QUAY = 1.2 // the quay's top, above the water
const LAMPS = [-11, -3.5, 4] // along the quay
const LIGHTHOUSE = [-13, 0, -15]
const WARM = '#ffcf8a'
// the swell: a grid of water round the harbour, its middle here and its half-width this
const SEA = { x: -4, z: -20, half: 60 }

/** The sea's height at a point and time: three crossing swells, calming to flat at the grid's edge. */
function swell(x, z, t) {
  const edge = Math.max(Math.abs(x - SEA.x), Math.abs(z - SEA.z)) / SEA.half
  const calm = Math.min(1, Math.max(0, (1 - edge) * 4))
  return calm * (0.075 * Math.sin(x * 0.31 + z * 0.12 + t * 0.8) + 0.045 * Math.sin(z * 0.47 - x * 0.18 - t * 1.05) + 0.022 * Math.sin((x - z) * 0.9 + t * 1.6))
}

/** A canvas, drawn on, as a texture. */
function painted(width, height, draw, options = {}) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  draw(/** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d')), width, height)
  return new Texture({ image: canvas, ...options })
}

/** Ripples as a normal map: wavelets of many sizes crossing, tiling, so the lamps glint off moving water. */
function rippleNormals(repeat) {
  const S = 256
  const waves = [[3, 2, 0.5, 0], [7, -4, 0.3, 1], [-5, 9, 0.2, 2], [13, 11, 0.12, 3], [-17, 6, 0.08, 4], [21, -19, 0.05, 5]]
  const height = (x, y) => {
    const a = (x / S) * Math.PI * 2, b = (y / S) * Math.PI * 2
    let h = 0
    for (const [u, v, amp, phase] of waves) h += Math.sin(a * u + b * v + phase) * amp
    return h
  }
  return painted(S, S, (ctx) => {
    const img = ctx.createImageData(S, S)
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = height(x + 1, y) - height(x - 1, y), dy = height(x, y + 1) - height(x, y - 1)
        const nx = -dx * 4, ny = -dy * 4, l = Math.hypot(nx, ny, 1)
        const o = (y * S + x) * 4
        img.data[o] = (nx / l * 0.5 + 0.5) * 255
        img.data[o + 1] = (ny / l * 0.5 + 0.5) * 255
        img.data[o + 2] = (1 / l * 0.5 + 0.5) * 255
        img.data[o + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  }, { colorSpace: 'linear', repeat })
}

/**
 * A light's reflection on the water, as a night harbour shows it: broken dashes stretching from
 * under the light towards you, brightest nearest it - down the image from its top, as a plane's v runs.
 */
function reflectionStreak() {
  const rand = random(23)
  return painted(64, 256, (ctx, w, h) => {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)
    for (let i = 0; i < 260; i++) {
      const t = rand() ** 1.5, y = t * h
      const spread = w * (0.12 + t * 0.3), x = w / 2 + (rand() - 0.5) * spread
      const len = (6 + rand() * 20) * (1 - t * 0.5), bright = (1 - t) ** 1.3 * (0.35 + rand() * 0.65)
      ctx.fillStyle = `rgba(255, 255, 255, ${bright})`
      ctx.fillRect(x - len / 2, y, len, 1.5 + rand() * 2.5)
    }
  }, { wrap: 'clamp' })
}

/** The quay's cobbles: rounded setts in rows, wet and dark. */
function cobbles() {
  const rand = random(3)
  return painted(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#1b1c1e'
    ctx.fillRect(0, 0, w, h)
    for (let row = 0; row < 16; row++) {
      for (let col = 0; col < 12; col++) {
        const x = (col + (row % 2) * 0.5) * (w / 12), y = row * (h / 16)
        const shade = 60 + rand() * 40
        ctx.fillStyle = `rgb(${shade}, ${shade - 2}, ${shade - 6})`
        ctx.beginPath()
        ctx.roundRect(x + 2, y + 2, w / 12 - 4, h / 16 - 4, 8)
        ctx.fill()
      }
    }
  }, { repeat: [10, 2] })
}

/** The lighthouse's bands, round the tower: red and white, top to bottom as lathe() runs v. */
function bands() {
  return painted(4, 128, (ctx, w, h) => {
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 ? '#e9e4da' : '#b8352b'
      ctx.fillRect(0, (i / 6) * h, w, h / 6 + 1)
    }
  })
}

/** A beam fading from the lamp out to its end: lathe() runs v from the profile's last point - the lamp - at the top. */
function beamFade() {
  return painted(4, 128, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, 'rgba(255, 255, 255, 1)')
    g.addColorStop(0.35, 'rgba(255, 255, 255, 0.35)')
    g.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  })
}

/** A street lamp: a turned post, an arm out over the quay's edge, a lantern hanging from it, its light shining down. */
function streetLamp(x, glowSprite, fade) {
  const g = new Group({ position: [x, QUAY, 1.2] })
  const iron = { color: '#202326', metalness: 0.7, roughness: 0.45 }
  const post = [[0, 0], [0.22, 0], [0.22, 0.12], [0.12, 0.25], [0.09, 0.6], [0.06, 3.9], [0.09, 4.0], [0.05, 4.1], [0, 4.1]]
  g.add(new Mesh({ geometry: lathe({ points: post, segments: 20 }), material: iron, castShadow: true }))
  // the arm, out towards the water, and the lantern hanging from its end
  g.add(new Mesh({ geometry: curve([[0, 3.9, 0], [0, 4.15, -0.4], [0, 4.0, -0.85]]).tube({ radius: 0.04, segments: 16, sides: 6 }), material: iron, castShadow: true }))
  const lantern = g.add(new Group({ position: [0, 3.75, -0.85] }))
  lantern.add(new Mesh({ geometry: lathe({ points: [[0, 0.18], [0.2, 0.08], [0.3, 0.08], [0.28, 0.12], [0.08, 0.3], [0, 0.3]], segments: 16 }), material: iron, castShadow: true }))
  lantern.add(new Mesh({ geometry: cylinder({ radius: 0.16, radiusTop: 0.2, height: 0.3, segments: 8 }), position: [0, -0.07, 0], material: { color: '#fff1c8', emissive: WARM, emissiveIntensity: 2.4 } }))
  lantern.add(new Points({ geometry: new Geometry({ positions: [0, -0.05, 0] }), material: { color: WARM, size: 2.2, map: glowSprite, blending: 'additive', depthWrite: false, opacity: 0.55 }, pickable: false }))
  // the light, and the cone of it the fog shows
  const light = lantern.add(new SpotLight({ color: WARM, intensity: 34, range: 16, angle: 0.85, penumbra: 0.55, direction: [0, -1, 0.12], castShadow: true }))
  // from the wide end up to the lamp, so the profile's last point - where the fade starts - is the lamp
  const cone = lathe({ points: [[3.4, -3.8], [0.15, 0]], segments: 32 })
  lantern.add(new Mesh({ geometry: cone, position: [0, -0.1, 0], pickable: false, material: { color: '#ffd9a0', map: fade, blending: 'additive', opacity: 0.16, depthWrite: false, doubleSided: true, unlit: true } }))
  return { node: g, light }
}

/** A cast-iron bollard: a turned mushroom on a stout neck. */
function bollard() {
  return lathe({ points: [[0, 0], [0.2, 0], [0.16, 0.12], [0.14, 0.42], [0.22, 0.5], [0.2, 0.58], [0, 0.6]], segments: 20 })
}

/** A barrel: a bulging stave profile, its hoops a little proud of it. */
function barrel() {
  const g = new Group()
  const staves = [[0, 0], [0.3, 0], [0.36, 0.25], [0.38, 0.45], [0.36, 0.65], [0.3, 0.9], [0, 0.9]]
  g.add(new Mesh({ geometry: lathe({ points: staves, segments: 24 }), material: { color: '#5a3d26', roughness: 0.7 }, castShadow: true, receiveShadow: true }))
  for (const y of [0.15, 0.75]) g.add(new Mesh({ geometry: cylinder({ radius: 0.36, height: 0.05, segments: 24, caps: false }), position: [0, y, 0], material: { color: '#2a2a2a', metalness: 0.8, roughness: 0.4, doubleSided: true } }))
  return g
}

/**
 * A small boat: a pointed hull turned along x, its top cut flat by a section plane - the cap is its
 * deck - with a wheelhouse on the deck. Moored at the quay, it bobs.
 */
function boat(paint, deck) {
  const g = new Group()
  const hull = g.add(new Group({ scale: [1, 0.62, 1], clip: { normal: [0, 1, 0], offset: 0.45, cap: deck } }))
  const profile = [[0, -2.6], [0.55, -2.0], [0.88, -1.0], [0.95, 0], [0.9, 1.0], [0.62, 1.9], [0, 2.4]]
  hull.add(new Mesh({ geometry: lathe({ points: profile, segments: 32, axis: 'x' }), material: { color: paint, roughness: 0.5 }, castShadow: true, receiveShadow: true }))
  g.add(new Mesh({ geometry: box({ width: 0.9, height: 0.7, depth: 0.9 }), position: [-0.4, 0.6, 0], material: { color: '#d8d2c4', roughness: 0.6 }, castShadow: true, receiveShadow: true }))
  g.add(new Mesh({ geometry: box({ width: 1.0, height: 0.06, depth: 1.0 }), position: [-0.4, 0.98, 0], material: { color: '#2c2f33' }, castShadow: true }))
  // a lit window, glowing in the fog
  g.add(new Mesh({ geometry: box({ width: 0.02, height: 0.22, depth: 0.5 }), position: [0.06, 0.66, 0], material: { color: '#ffd28a', emissive: '#ffb050', emissiveIntensity: 1.6 } }))
  return g
}

/** The lighthouse: banded tower, gallery, lantern room and cap, all turned; the beam turns inside. */
function lighthouse(glowSprite, fade) {
  const g = new Group({ position: LIGHTHOUSE })
  const rand = random(9)
  // the breakwater it stands on: a concrete plinth in a heap of rocks
  g.add(new Mesh({ geometry: lathe({ points: [[0, 0], [3.2, 0], [3.0, 1.4], [0, 1.4]], segments: 32 }), material: { color: '#55585c', roughness: 0.9 }, castShadow: true, receiveShadow: true }))
  g.add(new InstancedMesh({
    geometry: icosphere({ radius: 1, detail: 0 }), material: { color: '#3f4246', roughness: 0.95, flatShading: true }, castShadow: true, receiveShadow: true,
    instances: Array.from({ length: 22 }, (_, i) => {
      const a = i / 22 * Math.PI * 2 + rand() * 0.2, r = 3.4 + rand() * 1.2, s = 0.6 + rand() * 0.7
      return { position: [Math.cos(a) * r, 0.1, Math.sin(a) * r], scale: [s, s * 0.7, s], rotation: [rand(), rand() * 3, rand()] }
    }),
  }))
  const tower = [[0, 1.4], [1.5, 1.4], [1.1, 11.4], [0, 11.4]]
  g.add(new Mesh({ geometry: lathe({ points: tower, segments: 40 }), material: { map: bands(), roughness: 0.6 }, castShadow: true, receiveShadow: true }))
  const dark = { color: '#1d2023', metalness: 0.6, roughness: 0.4 }
  g.add(new Mesh({ geometry: lathe({ points: [[0, 11.3], [1.75, 11.3], [1.75, 11.5], [0, 11.5]], segments: 40 }), material: dark, castShadow: true }))
  g.add(new Mesh({ geometry: cylinder({ radius: 1.7, height: 0.6, segments: 40, caps: false }), position: [0, 11.8, 0], material: { ...dark, doubleSided: true } }))
  g.add(new Mesh({ geometry: cylinder({ radius: 0.85, height: 1.4, segments: 24, caps: false }), position: [0, 12.2, 0], material: { color: '#a8c4d8', opacity: 0.25, roughness: 0.05, doubleSided: true } }))
  g.add(new Mesh({ geometry: lathe({ points: [[0, 12.85], [1.05, 12.85], [0.9, 13.3], [0.25, 13.7], [0.1, 14.1], [0, 14.1]], segments: 32 }), material: dark, castShadow: true }))
  // the lamp, and the turning head with its beams and light
  g.add(new Mesh({ geometry: icosphere({ radius: 0.35, detail: 2 }), position: [0, 12.2, 0], material: { color: '#fff6dc', emissive: '#fff0c0', emissiveIntensity: 4 } }))
  g.add(new Points({ geometry: new Geometry({ positions: [0, 12.2, 0] }), material: { color: '#fff3d0', size: 7, map: glowSprite, blending: 'additive', depthWrite: false, opacity: 0.7 }, pickable: false }))
  const head = g.add(new Group({ position: [0, 12.2, 0] }))
  // two beams, front and back; the front one is a light that casts
  const beam = lathe({ points: [[6.5, 46], [0.3, 0]], segments: 32, axis: 'x' })
  for (const side of [1, -1]) {
    head.add(new Mesh({ geometry: beam, rotation: [0, side > 0 ? 0 : Math.PI, 0], pickable: false, material: { color: '#fff1c8', map: fade, blending: 'additive', opacity: 0.38, depthWrite: false, doubleSided: true, unlit: true } }))
  }
  head.add(new SpotLight({ color: '#fff1d0', intensity: 900, range: 70, angle: 0.11, penumbra: 0.4, direction: [1, -0.03, 0], castShadow: true }))
  return { node: g, head }
}

export default function run({ canvas, gui, info }) {
  const view = new View({
    canvas, background: NIGHT, bloom: { strength: 0.85, radius: 0.55, threshold: 0.75 },
    orbit: { minDistance: 6, maxDistance: 45, maxPitch: 1.35, minPitch: 0.05 },
    camera: { position: [14, 5, 8], target: [-6, 3.5, -7], fov: 46 },
  })
  const { scene } = view
  scene.fog = { color: NIGHT, density: 0.034 }
  scene.add(new HemisphereLight({ sky: '#283850', ground: '#0a0c10', intensity: 0.35 }))
  // the moon behind the cloud: faint, cool and high, with soft shadows of its own
  scene.add(new DirectionalLight({ color: '#9fb4d8', intensity: 0.22, direction: [0.5, -1, 0.7], castShadow: true }))
  const sprite = glow(64)
  const fade = beamFade()

  // --- the water: a swelling grid round the harbour, rippled, over a flat sea out to the fog
  const sea = { color: '#050f15', roughness: 0.14, metalness: 0.2, normalScale: 0.35 }
  const ripples = rippleNormals([40, 40])
  const swellGrid = plane({ width: SEA.half * 2, depth: SEA.half * 2, segments: 160 })
  scene.add(new Mesh({ geometry: swellGrid, position: [SEA.x, 0, SEA.z], receiveShadow: true, pickable: false, material: { ...sea, normalMap: ripples } }))
  const farRipples = rippleNormals([130, 130])
  scene.add(new Mesh({ geometry: plane(400), position: [SEA.x, -0.03, SEA.z], receiveShadow: true, pickable: false, material: { ...sea, normalMap: farRipples } }))
  // the lights' reflections, turned each frame to stretch towards the camera
  const streak = reflectionStreak()
  const streakGeometry = plane(1)

  // --- the quay: a stone wall to the water, cobbles on top
  const quay = scene.add(new Group())
  quay.add(new Mesh({ geometry: box({ width: 40, height: QUAY + 0.5, depth: 9 }), position: [-4, (QUAY - 0.5) / 2, 5.5], receiveShadow: true, castShadow: true, pickable: false, material: { color: '#3a3b3d', roughness: 0.85 } }))
  quay.add(new Mesh({ geometry: plane({ width: 40, depth: 9 }), position: [-4, QUAY + 0.005, 5.5], receiveShadow: true, pickable: false, material: { map: cobbles(), roughness: 0.35, metalness: 0.1 } }))
  // the kerb along the edge
  quay.add(new Mesh({ geometry: box({ width: 40, height: 0.18, depth: 0.5 }), position: [-4, QUAY + 0.09, 1.25], castShadow: true, receiveShadow: true, pickable: false, material: { color: '#5d5f62', roughness: 0.8 } }))

  const lamps = LAMPS.map((x) => {
    const lamp = streetLamp(x, sprite, fade)
    scene.add(lamp.node)
    return lamp
  })
  // bollards along the edge, between the lamps
  const bollardGeometry = bollard()
  const bollards = [-14, -7.5, 0, 7.5]
  scene.add(new InstancedMesh({
    geometry: bollardGeometry, material: { color: '#16181b', metalness: 0.6, roughness: 0.5 }, castShadow: true, receiveShadow: true,
    instances: bollards.map((x) => ({ position: [x, QUAY, 1.7] })),
  }))
  // barrels and crates by the lamps, for their shadows
  const rand = random(17)
  for (const [x, z] of [[-10.2, 3.2], [-9.4, 3.5], [-9.9, 4.2], [4.8, 2.9], [5.5, 3.6]]) {
    const b = scene.add(barrel())
    b.position.set(x, QUAY, z)
    b.rotation.y = rand() * 3
  }
  for (const [x, z, s, turn] of [[-3, 3.4, 0.9, 0.3], [-2.2, 4.6, 0.7, -0.4], [-3.1, 3.4 + 0, 0.6, 0.8], [3.2, 4.8, 0.8, 0.1]]) {
    const y = QUAY + s / 2 + (x === -3.1 ? 0.9 : 0)
    scene.add(new Mesh({ geometry: box(s), position: [x, y, z], rotation: [0, turn, 0], castShadow: true, receiveShadow: true, material: { color: '#6b5236', roughness: 0.8 } }))
  }

  // --- two boats moored at the quay, roped to the bollards
  const boats = [
    { node: boat('#2b5d7a', '#8a6a48'), at: [-4, 0, -1.6], rope: [-7.5, 0] },
    { node: boat('#8a3a2c', '#7c6345'), at: [6.5, 0, -2.0], rope: [7.5, 0] },
  ]
  for (const b of boats) {
    b.node.position.set(b.at[0], b.at[1], b.at[2])
    scene.add(b.node)
    const [bx] = b.rope
    scene.add(new Mesh({
      geometry: curve([[bx, QUAY + 0.5, 1.7], [bx + (b.at[0] - bx) * 0.5, 0.7, (b.at[2] + 1.7) / 2], [b.at[0] + 2.0, 0.55, b.at[2] + 0.3]]).tube({ radius: 0.025, segments: 24, sides: 5 }),
      material: { color: '#9a8a6a', roughness: 0.9 }, pickable: false,
    }))
  }

  // --- the lighthouse, out on the breakwater
  const tower = lighthouse(sprite, fade)
  scene.add(tower.node)

  // a reflection under each lamp and the lighthouse's light: where on the water, how long, how bright
  const reflections = [
    ...LAMPS.map((x) => ({ at: [x, 0.35], length: 10, width: 1.5, color: WARM, opacity: 1 })),
    { at: [LIGHTHOUSE[0], LIGHTHOUSE[2]], length: 24, width: 3, color: '#fff1c8', opacity: 0.9 },
  ].map((r) => ({ ...r, mesh: scene.add(new Mesh({ geometry: streakGeometry, pickable: false, material: { color: r.color, map: streak, blending: 'additive', opacity: r.opacity, depthWrite: false, unlit: true } })) }))

  const settings = { fog: 0.034, beam: 0.35, shadows: true }
  const lights = [...lamps.map((l) => l.light), tower.head.children.find((n) => n instanceof SpotLight)]
  gui.add(settings, 'fog', 0, 0.12, 0.005).name('fog density').onChange((v) => { scene.fog = v > 0 ? { color: NIGHT, density: v } : null })
  gui.add(settings, 'beam', 0, 1.5, 0.05).name('beam speed')
  gui.add(settings, 'shadows').onChange((on) => { for (const l of lights) l.castShadow = on })
  info.textContent = 'A foggy harbour at night - lamps and the lighthouse beam casting shadows through the mist'
  if (import.meta.env.DEV) Object.assign(window, { view, settings })

  let beamAngle = 0
  const grid = swellGrid.positions
  return view.start((dt, t) => {
    beamAngle += dt * settings.beam
    tower.head.rotation.set(0, beamAngle, 0)
    // the swell moves the grid; the ripples drift over it
    for (let i = 0; i < grid.length; i += 3) grid[i + 1] = swell(grid[i] + SEA.x, grid[i + 2] + SEA.z, t)
    swellGrid.computeNormals()
    swellGrid.needsUpdate()
    for (const r of [ripples, farRipples]) {
      r.offset[0] = t * 0.012
      r.offset[1] = t * 0.007
    }
    // the boats ride the swell: up and down with it, pitching and rolling with its slope
    for (const b of boats) {
      const [x, , z] = b.at
      b.node.position.y = swell(x, z, t)
      b.node.rotation.set(-Math.atan((swell(x, z + 1, t) - swell(x, z - 1, t)) / 2), 0, Math.atan((swell(x + 2, z, t) - swell(x - 2, z, t)) / 4))
    }
    // each reflection lies from under its light towards the camera, shimmering
    const eye = view.camera.position
    reflections.forEach((r, i) => {
      const [x, z] = r.at, dx = eye[0] - x, dz = eye[2] - z, l = Math.hypot(dx, dz) || 1
      r.mesh.position.set(x + dx / l * r.length / 2, 0.12, z + dz / l * r.length / 2)
      r.mesh.rotation.set(0, Math.atan2(dx, dz), 0)
      r.mesh.scale.set(r.width * (1 + 0.15 * Math.sin(t * 2.3 + i)), 1, r.length)
      r.mesh.material.opacity = r.opacity * (0.85 + 0.15 * Math.sin(t * 3.1 + i * 1.7))
    })
  })
}
