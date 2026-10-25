import { Lines, View, grid } from 'phoria2'
import { Emitter } from 'phoria2/particles'
import { glow } from './kit.js'

// Particle emitters from phoria2/particles: each preset is just a set of Emitter options - origin
// and spread, velocity, gravity, drag, lifetime and the colours each particle fades through. The
// fountain also uses onParticle, called for every particle each frame, to bounce drops off the floor.
const bounce = (p) => {
  if (p.position.y < 0 && p.velocity.y < 0) {
    p.position.y = 0
    p.velocity.y *= -0.35
  }
}
const PRESETS = {
  fountain: {
    rate: 400, origin: [0, 0, 0], originSpread: 0.1, velocity: [0, 7, 0], velocitySpread: [1.6, 1, 1.6],
    gravity: [0, -9.8, 0], drag: 0, lifetime: [2.5, 3], color: ['#bfe6ff', '#2a6cff', '#000000'], size: 0.25,
    onParticle: bounce,
  },
  flame: {
    rate: 220, origin: [0, 0.3, 0], originSpread: 0.4, velocity: [0, 1.5, 0], velocitySpread: 0.4,
    gravity: [0, 1, 0], drag: 0.6, lifetime: [0.8, 1.4], color: ['#b8641e', '#902800', '#3a0a00', '#000000'], size: 0.8,
    onParticle: null,
  },
  snow: {
    rate: 250, origin: [0, 8, 0], originSpread: 9, velocity: [0, -1.2, 0], velocitySpread: [0.4, 0.2, 0.4],
    gravity: [0, 0, 0], drag: 0, lifetime: [6, 7], color: ['#ffffff', '#ffffff', '#000000'], size: 0.15,
    onParticle: null,
  },
}

export default function run({ canvas, gui }) {
  const view = new View({ canvas, orbit: true, background: '#101014', camera: { position: [0, 4, 13], target: [0, 2.5, 0] } })
  view.scene.add(new Lines({ geometry: grid({ size: 20, divisions: 20 }), material: { color: '#34343c' } }))

  const emitter = view.scene.add(new Emitter({ max: 5000, material: { map: glow() } }))
  const settings = { preset: 'fountain', burst: () => emitter.burst(500, { velocitySpread: 6 }) }
  const apply = () => {
    const { size, ...options } = PRESETS[settings.preset]
    emitter.set(options)
    emitter.material.size = size
    emitter.clear()
    gui.updateDisplay()
  }
  apply()

  const f = gui.addFolder('Emitter')
  f.add(settings, 'preset', Object.keys(PRESETS)).onChange(apply)
  f.add(emitter, 'rate', 0, 1000, 10)
  f.add(emitter, 'drag', 0, 3, 0.05)
  f.add(emitter.gravity, 'y', -15, 5, 0.1).name('gravity')
  f.add(emitter.material, 'size', 0.05, 2, 0.05)
  f.add(settings, 'burst')

  return view.start()
}
