import { AmbientLight, DirectionalLight, Geometry, Group, Lines, Material, Mesh, PointLight, Points, View, edges, fromPolygons, sphere } from 'phoria2'
import { Emitter } from 'phoria2/particles'
import { cobra } from './data/cobra.js'
import { glow, starfield } from './kit.js'
import { banded } from './planets.js'

const LOOP = 24
const SUN = [-300, 120, -600]
const PLANET = [-120, -300, -560], PLANET_RADIUS = 220
const ELITE = '#4dff6a'

// A short flight, on a loop: three Cobra Mk IIIs climb out over a gas giant as a comet streaks by,
// lighting them with the point light it carries. The camera picks the comet up, chases it as it
// climbs, and the comet bursts. Everything is driven from one clock, so the speed control slows
// the whole scene. Elite mode draws it as the 1984 game did: green edges, with each ship's faces
// filled in black so they hide the edges behind them.
export default function run({ canvas, gui }) {
  const view = new View({ canvas, background: '#020205', camera: { position: [-45, 6, 28], far: 3000 } })
  const { scene, camera } = view
  scene.add(starfield(2500, 900))

  // the sun: a bright disc with a glow, and the light it gives; the planet below lights things a little too
  const flare = glow(64)
  const sun = scene.add(new Points({ geometry: new Geometry({ positions: SUN }), material: { color: '#fff1c8', size: 160, map: flare, blending: 'additive', depthWrite: false } }))
  scene.add(new DirectionalLight({ color: '#fff1d6', intensity: 1.3, direction: SUN.map((v) => -v) }))
  scene.add(new DirectionalLight({ color: '#5fb4d0', intensity: 0.35, direction: [0.3, 1, 0.4] }))
  scene.add(new AmbientLight({ color: '#8090ff', intensity: 0.08 }))

  // the planet: banded clouds with a storm, a haze round its edge, and a lat-long grid for Elite mode
  const planet = scene.add(new Group({ position: PLANET, rotation: [-0.2, 0, 0.15], pickable: false }))
  // the sun is behind it from here, so it has a little light of its own for its bands to show
  const clouds = banded(['#3a7fa6', '#6cbcd0', '#c8ece6', '#f6ead0', '#7cc4d4', '#4a90b8'], { seed: 4, storms: [{ at: [0.3, 0.62, 0.05, 0.035], color: '#f0e6cc' }] })
  const surface = planet.add(new Mesh({
    geometry: sphere({ radius: PLANET_RADIUS, segments: 96, rings: 48 }),
    material: { map: clouds, emissive: '#ffffff', emissiveMap: clouds, emissiveIntensity: 0.1, roughness: 0.9 },
  }))
  const haze = planet.add(new Points({ geometry: new Geometry({ positions: [0, 0, 0] }), material: { color: '#4fa8ff', size: PLANET_RADIUS * 2.5, map: flare, blending: 'additive', depthWrite: false, opacity: 0.5 } }))
  const grid = sphere({ radius: PLANET_RADIUS, segments: 24, rings: 12 })
  const planetVector = planet.add(new Group({ visible: false }))
  planetVector.add(new Mesh({ geometry: grid, material: { color: '#000000', unlit: true } }))
  planetVector.add(new Lines({ geometry: edges(grid), material: { color: '#1f8a34' } }))

  // ships: the model's nose is +z, so it turns inside its group to face -z, the way lookAt() aims;
  // two engine glows sit at the back
  const hull = fromPolygons(cobra), outline = edges(hull)
  const lit = new Material({ color: '#d4d6de', metalness: 0.15, roughness: 0.4 })
  const black = new Material({ color: '#000000', unlit: true })
  const ships = [[-22, -90, -6, 0.6], [6, -104, -14, -0.4], [26, -84, 2, 0.3]].map(([x, y, z, roll]) => {
    const ship = scene.add(new Group())
    const model = ship.add(new Group({ scale: 0.06, rotation: [0, Math.PI, 0] }))
    const body = model.add(new Mesh({ geometry: hull, material: lit }))
    const lines = model.add(new Lines({ geometry: outline, material: { color: ELITE }, visible: false }))
    const engines = model.add(new Points({ geometry: new Geometry({ positions: [10, 0, -34, -10, 0, -34] }), material: { color: '#8fd8ff', size: 1.6, map: flare, blending: 'additive', depthWrite: false } }))
    return { ship, model, body, lines, engines, start: [x, y, z], roll }
  })

  // the comet: a glowing head carrying a point light, a trail that follows it, and one burst
  const comet = scene.add(new Group())
  const head = comet.add(new Points({ geometry: new Geometry({ positions: [0, 0, 0] }), material: { color: '#e8f0ff', size: 3, map: flare, blending: 'additive', depthWrite: false } }))
  const light = comet.add(new PointLight({ color: '#cfe0ff', intensity: 900, range: 120 }))
  const trail = scene.add(new Emitter({
    max: 2000, follow: comet, rate: 160, velocity: [-2, 0, 0], velocitySpread: 1.2, lifetime: [1.2, 2],
    color: ['#7088c0', '#304080', '#101830', '#000000'], material: { map: flare, size: 1.4 },
  }))
  const sparks = scene.add(new Emitter({ max: 4000, rate: 0, drag: 0.5, lifetime: [2.5, 4], material: { map: flare, size: 0.9 } }))

  let t = 0, exploded = false
  const velocity = [0, 0, 0]
  const reset = () => {
    t = 0
    exploded = false
    comet.position.set(-90, 3, 0)
    velocity.splice(0, 3, 9, 0, 0)
    head.visible = true
    trail.rate = 160
    trail.clear()
    sparks.clear()
    camera.position.set(-45, 6, 28)
    for (const { ship, start } of ships) {
      ship.position.set(start[0], start[1], start[2])
      ship.lookAt([start[0] + 2, start[1] + 10, start[2] - 3])
    }
  }
  reset()

  const settings = { speed: 1, elite: false, restart: reset }
  const elite = () => {
    const on = settings.elite
    for (const { body, lines } of ships) {
      body.material = on ? black : lit
      lines.visible = on
    }
    surface.visible = haze.visible = sun.visible = !on
    planetVector.visible = on
    head.material.color.set(on ? ELITE : '#e8f0ff')
    trail.set({ color: on ? [ELITE, '#1f8a34', '#0a3014', '#000000'] : ['#7088c0', '#304080', '#101830', '#000000'] })
  }
  gui.add(settings, 'speed', 0.1, 2, 0.05)
  gui.add(settings, 'elite').name('Elite mode').onChange(elite)
  gui.add(settings, 'restart')

  return view.start((frameDt) => {
    const dt = frameDt * settings.speed
    t += dt
    if (t > LOOP) reset()

    for (const { ship, model, engines, roll } of ships) {
      ship.translate(0, 0, -10 * dt)
      model.rotateZ(roll * dt)
      // the engines flicker
      engines.material.size = 1.5 + 0.25 * Math.sin(t * 40 + ship.position.x)
    }
    planet.rotateY(0.01 * dt)

    // the comet crosses, then pulls up into a climb once it is past the camera
    if (comet.position.x > 0 && !exploded) {
      velocity[0] += (5 - velocity[0]) * dt * 0.6
      velocity[1] += (12 - velocity[1]) * dt * 0.6
    }
    for (let k = 0; k < 3; k++) comet.position[k] += velocity[k] * dt
    if (!exploded && comet.position.y > 45) {
      exploded = true
      const color = settings.elite ? ['#c8ffd0', ELITE, '#0a3014', '#000000'] : ['#ffe0b0', '#ff8a3a', '#802010', '#000000']
      sparks.burst(900, { origin: comet.position, velocity: velocity.map((v) => v * 0.3), velocitySpread: 22, color })
      head.visible = false
      trail.rate = 0
      light.intensity = 6000
      velocity.fill(0)
    }
    // the flash fades
    if (exploded) light.intensity *= Math.exp(-3 * dt)

    // watch from where the ships are, chase once the comet has passed, and pull back for the burst
    const c = comet.position
    const goal = c.x < 0 ? [-45, 6, 28] : exploded ? [c.x - 30, c.y + 4, c.z + 60] : [c.x - 16, c.y + 6, c.z + 22]
    const ease = 1 - Math.exp(-1.5 * dt)
    camera.position.lerp(goal, ease)
    camera.target = camera.target ? camera.target.lerp(comet.position, ease * 2) : comet.position.clone()
  })
}
