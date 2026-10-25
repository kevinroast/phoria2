import { DirectionalLight, Group, HemisphereLight, Mesh, PointLight, View, box, cylinder, icosphere, plane, torus } from 'phoria2'
import { Emitter } from 'phoria2/particles'
import { glow, random } from './kit.js'

// Particle emitters from phoria2/particles, each in a small set piece: a fountain whose drops fall
// into its basin or bounce off the paving, a brazier whose flame lights the rocks around it with
// a flickering point light while embers drift up, and snow drifting down over a few houses. Each
// is just a set of Emitter options - origin and spread, velocity, gravity, drag, lifetime and the
// colours a particle fades through - plus onParticle, called for every particle each frame.

const WATER = 0.5, BASIN = 1.95
// how high each set's particles go
const ROOM = { fountain: 3.2, flame: 3.6, snow: 0 }
const PRESETS = {
  fountain: {
    rate: 420, origin: [0, 1.45, 0], originSpread: 0.06, velocity: [0, 5.2, 0], velocitySpread: [1.2, 0.6, 1.2],
    gravity: [0, -9.8, 0], drag: 0, lifetime: [2.5, 3], color: ['#e6f6ff', '#7cc4ff', '#2a6cff'], size: 0.13,
    blending: 'additive',
    // drops landing in the basin join the water; those that miss bounce off the paving
    onParticle: (p) => {
      const r = Math.hypot(p.position.x, p.position.z)
      if (r < BASIN && p.position.y < WATER) return false
      if (p.position.y < 0 && p.velocity.y < 0) {
        p.position.y = 0
        p.velocity.y *= -0.3
      }
    },
  },
  flame: {
    rate: 320, origin: [0, 1.05, 0], originSpread: 0.35, velocity: [0, 1.4, 0], velocitySpread: 0.35,
    gravity: [0, 1.8, 0], drag: 0.4, lifetime: [0.7, 1.2], color: ['#fff3c0', '#ffa630', '#d2400c', '#300800'], size: 0.65,
    blending: 'additive', onParticle: null,
  },
  snow: {
    rate: 260, origin: [0, 9, 0], originSpread: 9, velocity: [0, -1, 0], velocitySpread: [0.3, 0.2, 0.3],
    gravity: [0, 0, 0], drag: 0, lifetime: [9, 10], color: ['#ffffff', '#f2f6ff'], size: 0.09,
    blending: 'normal',
    // a slow sideways drift that differs from flake to flake, and gone on reaching the ground
    onParticle: (p) => {
      p.velocity.x = 0.45 * Math.sin(p.age * 0.9 + p.position.z * 0.7)
      p.velocity.z = 0.25 * Math.cos(p.age * 0.7 + p.position.x * 0.5)
      return p.position.y > 0.02
    },
  },
}

export default function run({ canvas, gui, info }) {
  const view = new View({ canvas, orbit: { maxPitch: 1.25 }, background: '#0b0d13', camera: { position: [0, 4, 11], target: [0, 1.5, 0] } })
  const scene = view.scene
  scene.add(new HemisphereLight({ sky: '#2a3550', ground: '#0d0d10', intensity: 0.7 }))
  scene.add(new DirectionalLight({ color: '#b8c8ff', direction: [-0.4, -1, -0.6], intensity: 0.35, castShadow: true }))
  scene.add(new Mesh({ geometry: plane(240), material: { color: '#2a2c33', roughness: 0.95 }, receiveShadow: true }))
  const rand = random(7)
  const stone = { color: '#8d8a84', roughness: 0.9 }

  // the fountain: a basin of water and a spout
  const fountain = scene.add(new Group())
  // a low base, the water a little above it, and a rim round both - no two surfaces at the same height
  fountain.add(new Mesh({ geometry: cylinder({ radius: 2.2, height: 0.44, segments: 64 }), material: stone, position: [0, 0.22, 0], castShadow: true, receiveShadow: true }))
  fountain.add(new Mesh({ geometry: cylinder({ radius: BASIN, height: 0.04, segments: 64 }), material: { color: '#1d4f7a', roughness: 0.05, metalness: 0.3 }, position: [0, WATER, 0] }))
  fountain.add(new Mesh({ geometry: torus({ radius: 2.06, tube: 0.16, segments: 64 }), material: stone, position: [0, 0.5, 0], castShadow: true, receiveShadow: true }))
  fountain.add(new Mesh({ geometry: cylinder({ radius: 0.16, radiusTop: 0.1, height: 0.9, segments: 24 }), material: stone, position: [0, 0.95, 0], castShadow: true }))

  // the brazier: a bowl of glowing coals on a stand, in a ring of rocks, lit by its own fire
  const brazier = scene.add(new Group())
  brazier.add(new Mesh({ geometry: cylinder({ radius: 0.2, height: 0.6 }), material: { color: '#2b2523', metalness: 0.8, roughness: 0.4 }, position: [0, 0.3, 0], castShadow: true }))
  brazier.add(new Mesh({ geometry: cylinder({ radius: 0.85, radiusTop: 0.85, height: 0.3, segments: 32 }), material: { color: '#3a302b', metalness: 0.8, roughness: 0.45 }, position: [0, 0.75, 0], castShadow: true }))
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2, r = rand() * 0.45
    brazier.add(new Mesh({ geometry: icosphere({ radius: 0.16, detail: 0 }), material: { color: '#1a0a05', emissive: '#ff5a1a', emissiveIntensity: 0.6 + rand(), flatShading: true }, position: [Math.cos(a) * r, 0.95, Math.sin(a) * r] }))
  }
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rand() * 0.2, r = 2.4 + rand() * 0.6, s = 0.6 + rand() * 0.9
    brazier.add(new Mesh({ geometry: icosphere({ radius: 0.3, detail: 0 }), material: { color: '#77706a', roughness: 0.85, flatShading: true }, position: [Math.cos(a) * r, 0.15 * s, Math.sin(a) * r], scale: [s, s * 0.7, s], rotation: [rand(), rand() * 3, rand()], castShadow: true, receiveShadow: true }))
  }
  const fire = brazier.add(new PointLight({ color: '#ff8a3a', intensity: 14, range: 10, position: [0, 1.6, 0] }))
  const embers = brazier.add(new Emitter({
    max: 300, rate: 30, origin: [0, 1.2, 0], originSpread: 0.4, velocity: [0, 2.2, 0], velocitySpread: [0.6, 0.6, 0.6],
    gravity: [0, 0.4, 0], drag: 0.3, lifetime: [1.5, 2.6], color: ['#ffd27a', '#ff6a00', '#200000'],
    material: { map: glow(), size: 0.06, blending: 'additive' },
  }))

  // the village: a few houses with snowy roofs and warm windows
  const village = scene.add(new Group())
  const HOUSES = [[-2.6, -1, 0.3], [0, -2.2, -0.2], [2.7, -0.8, 0.5], [-1.2, 1.6, 1.2], [1.7, 1.9, -0.6]]
  for (const [x, z, turn] of HOUSES) {
    const house = village.add(new Group({ position: [x, 0, z], rotation: [0, turn, 0] }))
    house.add(new Mesh({ geometry: box({ width: 1.4, height: 1, depth: 1.1 }), material: { color: '#6b4f3f', roughness: 0.9 }, position: [0, 0.5, 0], castShadow: true, receiveShadow: true }))
    house.add(new Mesh({ geometry: cylinder({ radius: 1.1, radiusTop: 0, height: 0.8, segments: 4 }), material: { color: '#f4f6fa', roughness: 0.7 }, position: [0, 1.4, 0], rotation: [0, Math.PI / 4, 0], scale: [1, 1, 0.8], castShadow: true }))
    house.add(new Mesh({ geometry: box({ width: 0.3, height: 0.3, depth: 0.02 }), material: { color: '#ffc46b', emissive: '#ffb050', emissiveIntensity: 1.6 }, position: [0.3, 0.55, 0.56] }))
  }

  const flakes = glow(32, { core: 0.4 })
  const soft = glow()
  const emitter = scene.add(new Emitter({ max: 6000, material: { map: soft } }))
  const sets = { fountain, flame: brazier, snow: village }
  const settings = { preset: 'fountain', burst: () => emitter.burst(400, { velocitySpread: 5 }) }
  const apply = () => {
    const { size, blending, ...options } = PRESETS[settings.preset]
    emitter.set(options)
    emitter.material.size = size
    emitter.material.blending = blending
    emitter.material.map = settings.preset === 'snow' ? flakes : soft
    emitter.clear()
    for (const [name, set] of Object.entries(sets)) set.visible = name === settings.preset
    embers.rate = settings.preset === 'flame' ? 30 : 0
    view.camera.position.set(0, settings.preset === 'snow' ? 5 : 3.5, 11)
    view.camera.target?.set(0, 1.2, 0)
    // the set piece, and the air its particles fill above it
    const room = sets[settings.preset].bounds.expandByPoint([0, ROOM[settings.preset], 0])
    view.frame(room, { padding: settings.preset === 'snow' ? 0.15 : 0.3 })
    gui.updateDisplay()
  }
  apply()

  const f = gui.addFolder('Emitter')
  f.add(settings, 'preset', Object.keys(PRESETS)).onChange(apply)
  f.add(emitter, 'rate', 0, 1000, 10)
  f.add(emitter, 'drag', 0, 3, 0.05)
  f.add(emitter.gravity, 'y', -15, 5, 0.1).name('gravity')
  f.add(emitter.material, 'size', 0.03, 1.5, 0.01)
  f.add(settings, 'burst')

  let shown = -1
  return view.start((dt, t) => {
    // the fire breathes: two slow waves and a fast one
    fire.intensity = 13 + 3 * Math.sin(t * 7.3) + 2 * Math.sin(t * 13.1 + 1) + 1.5 * Math.sin(t * 2.1)
    const n = emitter.count + (settings.preset === 'flame' ? embers.count : 0)
    if (Math.abs(n - shown) >= 10) {
      shown = n
      info.textContent = `${n.toLocaleString()} particles`
    }
  })
}
