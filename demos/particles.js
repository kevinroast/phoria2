import { DirectionalLight, Group, HemisphereLight, Mesh, PointLight, View, box, cylinder, extrude, icosphere, lathe, outline, plane } from 'phoria2'
import { Emitter } from 'phoria2/particles'
import { glow, random } from './kit.js'

// Particle emitters from phoria2/particles, each in a small set piece: a fountain whose drops fall
// into its basin or bounce off the paving, a brazier whose flame lights the rocks around it with
// a flickering point light while embers drift up, and snow drifting down over a few houses. Each
// is just a set of Emitter options - origin and spread, velocity, gravity, drag, lifetime and the
// colours a particle fades through - plus onParticle, called for every particle each frame.

// the water's height and edge, and the outside and top of the stone rim round it
const WATER = 0.5, BASIN = 1.95, RIM = 2.22, RIM_TOP = 0.66
// how high each set's particles go
const ROOM = { fountain: 3.2, flame: 3.6, snow: 0 }
const PRESETS = {
  fountain: {
    rate: 420, origin: [0, 1.45, 0], originSpread: 0.06, velocity: [0, 5.2, 0], velocitySpread: [1.2, 0.6, 1.2],
    gravity: [0, -9.8, 0], drag: 0, lifetime: [2.5, 3], color: ['#e6f6ff', '#7cc4ff', '#2a6cff'], size: 0.13,
    blending: 'additive',
    // drops landing in the water or on the rim are gone; those that miss splash on the paving - a
    // bounce or two, losing most of their speed, then gone
    onParticle: (p) => {
      const r = Math.hypot(p.position.x, p.position.z)
      if (r < RIM && p.position.y < (r < BASIN ? WATER : RIM_TOP)) return false
      if (p.position.y < 0) {
        if (p.velocity.y > -1) return false
        p.position.y = 0
        p.velocity.y *= -0.25
        p.velocity.x *= 0.3
        p.velocity.z *= 0.3
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

  // the fountain: a stone basin turned in one profile - up the outside, over the rounded rim, down
  // the inside to its floor - the water a little above the floor, and a spout in the middle
  const fountain = scene.add(new Group())
  const rim = outline.arc({ radius: (RIM - BASIN) / 2, from: 0, to: Math.PI, center: [(RIM + BASIN) / 2, RIM_TOP - (RIM - BASIN) / 2], segments: 12 })
  fountain.add(new Mesh({ geometry: lathe({ points: [[0, 0], [RIM, 0], ...rim, [BASIN, 0.44], [0, 0.44]], segments: 64 }), material: stone, castShadow: true, receiveShadow: true }))
  fountain.add(new Mesh({ geometry: cylinder({ radius: BASIN, height: 0.04, segments: 64 }), material: { color: '#1d4f7a', roughness: 0.05, metalness: 0.3 }, position: [0, WATER, 0] }))
  const spout = [[0, 0.44], [0.22, 0.44], [0.16, 0.6], [0.1, 1.25], [0.17, 1.38], [0.14, 1.41], [0.06, 1.37], [0, 1.37]]
  fountain.add(new Mesh({ geometry: lathe({ points: spout, segments: 24 }), material: stone, castShadow: true }))

  // the brazier: a bowl of glowing coals on a pedestal - one turned iron profile - in a ring of
  // rocks, lit by its own fire
  const brazier = scene.add(new Group())
  const iron = [[0, 0], [0.45, 0], [0.43, 0.06], [0.16, 0.14], [0.12, 0.5], [0.3, 0.62], [0.85, 0.86], [0.9, 0.93], [0.82, 0.93], [0.3, 0.72], [0, 0.72]]
  brazier.add(new Mesh({ geometry: lathe({ points: iron, segments: 32 }), material: { color: '#352d29', metalness: 0.8, roughness: 0.42 }, castShadow: true }))
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2, r = rand() * 0.45
    brazier.add(new Mesh({ geometry: icosphere({ radius: 0.16, detail: 0 }), material: { color: '#1a0a05', emissive: '#ff5a1a', emissiveIntensity: 0.6 + rand(), flatShading: true }, position: [Math.cos(a) * r, 0.84, Math.sin(a) * r] }))
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

  // the village: a few houses with snowy gable roofs and warm windows
  const village = scene.add(new Group())
  // a roof: a triangle in section, its ridge running along x, overhanging the walls
  const roof = extrude({ shape: [[-0.72, 0], [0.72, 0], [0, 0.62]], depth: 1.6, axis: 'x' })
  const HOUSES = [[-2.6, -1, 0.3], [0, -2.2, -0.2], [2.7, -0.8, 0.5], [-1.2, 1.6, 1.2], [1.7, 1.9, -0.6]]
  for (const [x, z, turn] of HOUSES) {
    const house = village.add(new Group({ position: [x, 0, z], rotation: [0, turn, 0] }))
    house.add(new Mesh({ geometry: box({ width: 1.4, height: 1, depth: 1.1 }), material: { color: '#6b4f3f', roughness: 0.9 }, position: [0, 0.5, 0], castShadow: true, receiveShadow: true }))
    house.add(new Mesh({ geometry: roof, material: { color: '#f4f6fa', roughness: 0.7 }, position: [0, 1, 0], castShadow: true }))
    house.add(new Mesh({ geometry: box({ width: 0.3, height: 0.3, depth: 0.02 }), material: { color: '#ffc46b', emissive: '#ffb050', emissiveIntensity: 1.6 }, position: [0.3, 0.55, 0.56] }))
  }

  const flakes = glow(32, { core: 0.4 })
  const soft = glow()
  const emitter = scene.add(new Emitter({ max: 6000, material: { map: soft } }))
  const sets = { fountain, flame: brazier, snow: village }
  const settings = { preset: 'flame', burst: () => emitter.burst(400, { velocitySpread: 5 }) }
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
