import { Geometry, Group, HemisphereLight, Mesh, PointLight, Points, Texture, View, box, plane } from 'phoria2'
import { Body, Emitter } from 'phoria2/particles'
import { glow, random, starfield } from './kit.js'

const COLORS = ['#ff4d6d', '#ffd166', '#06d6a0', '#4cc9f0', '#c77dff', '#ff9e00', '#ffffff']
const SHAPES = ['peony', 'ring', 'willow', 'crackle']
const rand = (min, max) => min + Math.random() * (max - min)

// Fireworks over a city across the water. Each rocket is a node moved by a Body, trailed by its
// own emitter that follows it. Near the top of its climb it bursts into one of the shared
// emitters - every explosion in the sky is a single draw call - as a peony, a tilted ring, a
// drooping gold willow or a crackle of late flashes, and a light flashes its colour over the city.
// The reflections are the same particles drawn again, flipped under the water: a second Points
// sharing each emitter's geometry and material, seen through the water's surface.
export default function run({ canvas, gui, info }) {
  info.textContent = 'Click or press space to launch a firework'
  const view = new View({ canvas, orbit: { maxPitch: 0.5 }, background: sky(), camera: { position: [0, 5, 58], target: [0, 15, -10], far: 3000 } })
  const { scene } = view
  scene.add(starfield(1500, 700))
  scene.add(new HemisphereLight({ sky: '#28305a', ground: '#05060a', intensity: 0.35 }))
  const flash = scene.add(new PointLight({ intensity: 0, range: 120 }))

  const sprite = glow(32, { core: 0.25 })
  const sparks = scene.add(new Emitter({
    max: 30000, rate: 0, velocity: [0, 0, 0], gravity: [0, -4, 0], drag: 1.1, lifetime: [1.6, 2.4], renderOrder: 1,
    material: { map: sprite, size: 0.7 },
  }))
  const willow = scene.add(new Emitter({
    max: 8000, rate: 0, velocity: [0, 0, 0], gravity: [0, -2.2, 0], drag: 1.9, lifetime: [3.5, 4.5], renderOrder: 1,
    color: ['#fff4c8', '#ffb347', '#a0521a', '#000000'], material: { map: sprite, size: 0.45 },
  }))
  const crackles = scene.add(new Emitter({
    max: 4000, rate: 0, velocity: [0, 0, 0], drag: 2, lifetime: [0.08, 0.22], renderOrder: 1,
    color: ['#ffffff', '#fff3c4', '#000000'], material: { map: sprite, size: 0.5 },
  }))

  // the city: blocks in three rows across the bay, with lit windows on the faces towards us
  const city = scene.add(new Group({ pickable: false }))
  const facade = { color: '#141726', roughness: 0.85 }
  const windows = []
  const r = random(11)
  for (const [z, tall] of [[-30, 0.6], [-38, 1], [-48, 1.3]]) {
    for (let x = -70; x < 70;) {
      const w = 3 + r() * 5, d = 4 + r() * 3
      const h = (4 + r() * 14) * tall * (1.4 - Math.abs(x) / 100)
      city.add(new Mesh({ geometry: box({ width: w, height: h, depth: d }), material: facade, position: [x + w / 2, h / 2, z] }))
      for (let wy = 1; wy < h - 0.6; wy += 1.1) {
        for (let wx = x + 0.7; wx < x + w - 0.5; wx += 0.9) {
          if (r() > 0.32) continue
          const warm = r() < 0.75
          windows.push({ at: [wx, wy, z + d / 2 + 0.02], color: warm ? [1, 0.78, 0.42] : [0.6, 0.8, 1] })
        }
      }
      x += w + 0.3 + r() * 1.5
    }
  }
  const lit = city.add(new Points({
    geometry: new Geometry({ positions: windows.flatMap((w) => w.at), colors: windows.flatMap((w) => w.color) }),
    material: { size: 0.4, vertexColors: true },
  }))

  // the water: a dark surface seen through, with everything bright drawn again upside down below it
  const mirror = scene.add(new Group({ scale: [1, -1, 1], pickable: false }))
  for (const p of [sparks, willow, crackles, lit]) {
    mirror.add(new Points({ geometry: p.geometry, material: p.material, renderOrder: -1, frustumCulled: false }))
  }
  // unlit, so a burst's flash doesn't light it up as a solid patch - the reflections are the particles below
  scene.add(new Mesh({ geometry: plane(1600), material: { color: '#04060c', unlit: true, opacity: 0.88, depthWrite: false }, pickable: false }))
  scene.add(new Mesh({ geometry: box({ width: 36, height: 0.8, depth: 5 }), material: { color: '#1a1b22', roughness: 0.7 }, position: [0, 0.2, -8], pickable: false }))

  const settings = { auto: true, every: 0.8 }
  /** @type {{ at: number, origin: number[] }[]} */
  const later = []
  let now = 0

  const burst = (origin, color) => {
    const shape = SHAPES[Math.floor(Math.random() * SHAPES.length)]
    const fade = ['#ffffff', color, color, '#000000']
    if (shape === 'peony') sparks.burst(Math.round(rand(350, 550)), { origin, velocitySpread: rand(14, 19), color: fade })
    if (shape === 'ring') {
      // a flat ring of sparks, tilted and turned at random
      const tilt = rand(0.2, 1.3), turn = rand(0, Math.PI * 2), speed = rand(13, 17)
      for (let i = 0; i < 90; i++) {
        const a = (i / 90) * Math.PI * 2, x = Math.cos(a), z = Math.sin(a)
        const y = -z * Math.sin(tilt), zt = z * Math.cos(tilt)
        const v = [x * Math.cos(turn) + zt * Math.sin(turn), y, -x * Math.sin(turn) + zt * Math.cos(turn)]
        sparks.burst(4, { origin, velocity: v.map((c) => c * speed), velocitySpread: 1.2, color: fade })
      }
    }
    if (shape === 'willow') willow.burst(450, { origin, velocitySpread: rand(9, 12) })
    if (shape === 'crackle') {
      sparks.burst(220, { origin, velocitySpread: rand(12, 15), color: fade })
      for (let i = 0; i < 28; i++) later.push({ at: now + rand(0.7, 1.4), origin: origin.map((c) => c + rand(-7, 7)) })
    }
    flash.position.copy(origin)
    flash.color.set(shape === 'willow' ? '#ffb347' : color)
    flash.intensity = 900
  }

  const trailSprite = glow(32)
  const launch = () => {
    const rocket = scene.add(new Group({ position: [rand(-15, 15), 0.6, rand(-9, -7)] }))
    const body = new Body({ velocity: [rand(-1.5, 1.5), rand(20, 25), rand(-1.5, 1.5)], gravity: [0, -9.8, 0] })
    const trail = scene.add(new Emitter({
      max: 600, rate: 160, follow: rocket, velocity: [0, -2, 0], velocitySpread: 0.8, lifetime: [0.3, 0.7], renderOrder: 1,
      color: ['#ffd9a0', '#ff6a00', '#000000'], material: { map: trailSprite, size: 0.6 },
    }))
    const color = COLORS[Math.floor(Math.random() * COLORS.length)]
    rocket.onUpdate(body.update)
    rocket.onUpdate(() => {
      // burst once the climb has nearly stopped
      if (body.velocity.y > 3) return
      burst(rocket.position.toArray(), color)
      scene.remove(rocket)
      trail.follow = null
      trail.rate = 0
      // the trail goes once its last particle has
      trail.onUpdate(() => { if (trail.count === 0) scene.remove(trail) })
    })
  }

  canvas.addEventListener('click', launch)
  document.addEventListener('keydown', (e) => { if (e.code === 'Space') launch() })

  const f = gui.addFolder('Show')
  f.add(settings, 'auto')
  f.add(settings, 'every', 0.2, 3, 0.1).name('seconds between')
  f.add(sparks.gravity, 'y', -10, 0, 0.5).name('gravity')
  f.add(sparks.material, 'size', 0.2, 2, 0.05).name('spark size')

  let wait = 0
  return view.start((dt) => {
    now += dt
    flash.intensity *= Math.exp(-4 * dt)
    // a crackle's late flashes, each a handful of very short-lived sparks
    for (let i = later.length - 1; i >= 0; i--) {
      if (later[i].at > now) continue
      crackles.burst(14, { origin: later[i].origin, velocitySpread: 6 })
      later.splice(i, 1)
    }
    if (!settings.auto) return
    wait -= dt
    if (wait > 0) return
    launch()
    wait = settings.every * rand(0.5, 1.5)
  })
}

/** The night sky as a panorama: dark overhead, a faint glow along the horizon. */
function sky() {
  const c = document.createElement('canvas')
  c.width = 4
  c.height = 256
  const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'))
  const g = ctx.createLinearGradient(0, 0, 0, 256)
  g.addColorStop(0, '#010106')
  g.addColorStop(0.38, '#060818')
  g.addColorStop(0.5, '#1c2244')
  g.addColorStop(0.53, '#05060c')
  g.addColorStop(1, '#000000')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 4, 256)
  return new Texture({ image: c })
}
