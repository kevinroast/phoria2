import { Group, Lines, View, grid } from 'phoria2'
import { Body, Emitter } from 'phoria2/particles'
import { glow, sparkle, starfield } from './kit.js'

const COLORS = ['#ff4d6d', '#ffd166', '#06d6a0', '#4cc9f0', '#c77dff', '#ff9e00', '#ffffff']
const rand = (min, max) => min + Math.random() * (max - min)

// Fireworks: each rocket is a node moved by a Body, trailed by its own emitter that follows it.
// Near the top of its climb it bursts into one shared emitter - every explosion in the sky is a
// single draw call. Click or press space to launch more.
export default function run({ canvas, gui, info }) {
  info.textContent = 'Click or press space to launch a firework'
  const view = new View({
    canvas, orbit: { autoRotate: 0.06 }, background: '#05050a',
    camera: { position: [0, 8, 48], target: [0, 14, 0], far: 2000 },
  })
  view.scene.add(starfield(1500, 600))
  view.scene.add(new Lines({ geometry: grid({ size: 40, divisions: 16 }), material: { color: '#1f3a2a' }, pickable: false }))

  const sparks = view.scene.add(new Emitter({
    max: 30000, rate: 0, gravity: [0, -4, 0], drag: 1.1, lifetime: [1.6, 2.4], material: { map: sparkle(), size: 0.8 },
  }))
  const trailSprite = glow(32)

  const launch = () => {
    const rocket = view.scene.add(new Group({ position: [rand(-12, 12), 0, rand(-8, 8)] }))
    const body = new Body({ velocity: [rand(-1.5, 1.5), rand(20, 25), rand(-1.5, 1.5)], gravity: [0, -9.8, 0] })
    const trail = view.scene.add(new Emitter({
      max: 600, rate: 160, follow: rocket, velocity: [0, -2, 0], velocitySpread: 0.8, lifetime: [0.3, 0.7],
      color: ['#ffd9a0', '#ff6a00', '#000000'], material: { map: trailSprite, size: 0.6 },
    }))
    const color = COLORS[Math.floor(Math.random() * COLORS.length)]
    rocket.onUpdate(body.update)
    rocket.onUpdate(() => {
      // burst once the climb has nearly stopped
      if (body.velocity.y > 3) return
      sparks.burst(Math.round(rand(350, 600)), {
        origin: rocket.position, velocity: [0, 0, 0], velocitySpread: rand(14, 20), color: ['#ffffff', color, color, color, '#000000'],
      })
      view.scene.remove(rocket)
      trail.follow = null
      trail.rate = 0
      // the trail goes once its last particle has
      trail.onUpdate(() => { if (trail.count === 0) view.scene.remove(trail) })
    })
  }

  canvas.addEventListener('click', launch)
  document.addEventListener('keydown', (e) => { if (e.code === 'Space') launch() })

  const settings = { auto: true, every: 0.8 }
  const f = gui.addFolder('Show')
  f.add(settings, 'auto')
  f.add(settings, 'every', 0.2, 3, 0.1).name('seconds between')
  f.add(sparks.gravity, 'y', -10, 0, 0.5).name('gravity')
  f.add(sparks.material, 'size', 0.2, 2, 0.05).name('spark size')

  let wait = 0
  return view.start((dt) => {
    if (!settings.auto) return
    wait -= dt
    if (wait > 0) return
    launch()
    wait = settings.every * rand(0.5, 1.5)
  })
}
