import { AmbientLight, Geometry, Group, Label, Lines, Mesh, PointLight, Points, View, sphere, torus } from 'phoria2'
import { glow, starfield } from './kit.js'

// distance from the sun, size, days per orbit and colour - squeezed, so it all fits on screen
const PLANETS = [
  { name: 'Mercury', distance: 6, radius: 0.35, year: 88, color: '#a8a29a' },
  { name: 'Venus', distance: 9, radius: 0.6, year: 225, color: '#e6c58f' },
  { name: 'Earth', distance: 12.5, radius: 0.65, year: 365, color: '#3d7bd9', moon: true },
  { name: 'Mars', distance: 16, radius: 0.45, year: 687, color: '#c4532f' },
  { name: 'Jupiter', distance: 23, radius: 1.8, year: 4333, color: '#d2a878' },
  { name: 'Saturn', distance: 31, radius: 1.5, year: 10759, color: '#e3cf9a', rings: true },
]

// A solar system: each planet rides on a pivot at the sun, so turning the pivot moves it round
// its orbit; the Moon rides on Earth's group the same way. The sun is a point light. Click a planet
// to follow it - the orbit control keeps working around whatever it follows.
export default function run({ canvas, gui, info }) {
  info.textContent = 'Click a planet to follow it, or the sun to come back'
  const view = new View({ canvas, orbit: { maxDistance: 150 }, background: '#03030a', camera: { position: [0, 22, 44], far: 3000 } })
  const { scene, camera } = view
  scene.add(starfield(3000, 900))
  scene.add(new AmbientLight({ intensity: 0.03 }))

  const sun = scene.add(new Mesh({ name: 'Sun', geometry: sphere({ radius: 2.6, segments: 48, rings: 24 }), material: { color: '#ffd76a', unlit: true } }))
  sun.add(new Points({ geometry: new Geometry({ positions: [0, 0, 0] }), material: { color: '#ff9a30', size: 16, map: glow(), blending: 'additive', depthWrite: false }, pickable: false }))
  sun.add(new PointLight({ color: '#fff4e0', intensity: 400 }))

  const ball = sphere({ segments: 32, rings: 16 })
  const orbits = scene.add(new Group({ pickable: false }))
  const labels = []
  const planets = PLANETS.map((p) => {
    const pivot = scene.add(new Group({ rotation: [0, Math.random() * Math.PI * 2, 0] }))
    // the planet's group stays upright as it orbits; the globe inside it spins
    const body = pivot.add(new Group({ position: [p.distance, 0, 0] }))
    const globe = body.add(new Mesh({ name: p.name, geometry: ball, material: { color: p.color, roughness: 0.8 }, scale: p.radius }))
    labels.push(body.add(new Label({ text: p.name, position: [0, p.radius + 0.8, 0], className: 'demo-tick' })))
    orbits.add(new Lines({ geometry: circle(p.distance), material: { color: '#2a2f45' } }))
    if (p.rings) {
      body.add(new Mesh({ name: p.name, geometry: torus({ radius: p.radius * 1.9, tube: p.radius * 0.45, segments: 64 }), material: { color: '#c9b48a', roughness: 0.9 }, scale: [1, 0.06, 1], rotation: [0.3, 0, 0.15] }))
    }
    let moon = null
    if (p.moon) {
      const moonPivot = body.add(new Group())
      moon = { pivot: moonPivot, globe: moonPivot.add(new Mesh({ name: 'Moon', geometry: ball, material: { color: '#bdbdbd', roughness: 0.9 }, scale: 0.18, position: [1.6, 0, 0] })) }
    }
    return { ...p, pivot, body, globe, moon }
  })

  // following: the camera and its target move with the followed body, so orbiting still works
  let followed = /** @type {import('phoria2').Node} */ (sun)
  // for a moment after picking, the camera also flies to a distance that suits the body's size
  let arriving = 0, distance = 0
  const follow = (node, size) => {
    followed = node
    arriving = 2
    distance = size * 9 + 3
  }
  canvas.addEventListener('click', (e) => {
    const hit = view.pick(e)
    if (!hit) return
    const planet = planets.find((p) => p.name === hit.node.name)
    if (planet) follow(planet.body, planet.radius)
    else if (hit.node.name === 'Moon') follow(/** @type {any} */ (planets[2].moon).globe, 0.18)
    else follow(sun, 5)
  })
  canvas.addEventListener('pointermove', (e) => {
    // every body is named; the starfield, glow and orbits aren't pickable
    canvas.style.cursor = view.pick(e)?.node.name ? 'pointer' : ''
  })

  const settings = { daysPerSecond: 20, labels: true, orbits: true }
  const f = gui.addFolder('Solar system')
  f.add(settings, 'daysPerSecond', 0, 200, 1).name('days per second')
  f.add(settings, 'labels').onChange((v) => labels.forEach((l) => { l.visible = v }))
  f.add(orbits, 'visible').name('orbits')
  f.add({ sun: () => follow(sun, 5) }, 'sun').name('back to the sun')

  return view.start((dt) => {
    const days = settings.daysPerSecond * dt
    for (const p of planets) {
      p.pivot.rotateY(days / p.year * Math.PI * 2)
      p.globe.rotateY(days * 0.5)
      if (p.moon) p.moon.pivot.rotateY(days / 27 * Math.PI * 2)
    }
    // ease the target onto the followed body, and move the camera by the same amount
    const target = /** @type {import('phoria2').Vec3} */ (camera.target)
    const goal = followed.updateWorld().worldPosition
    const before = target.clone()
    target.lerp(goal, 1 - Math.exp(-4 * dt))
    camera.position.add(target.clone().sub(before))
    if (arriving > 0) {
      arriving -= dt
      const offset = camera.position.clone().sub(target)
      const len = offset.len()
      camera.position.copy(target).add(offset.multiplyScalar((len + (distance - len) * (1 - Math.exp(-3 * dt))) / len))
    }
  })
}

/** An orbit: a circle of line segments in the x-z plane. */
function circle(radius, segments = 128) {
  const positions = []
  for (let i = 0; i < segments; i++) {
    const a = i / segments * Math.PI * 2, b = (i + 1) / segments * Math.PI * 2
    positions.push(Math.cos(a) * radius, 0, Math.sin(a) * radius, Math.cos(b) * radius, 0, Math.sin(b) * radius)
  }
  return new Geometry({ positions })
}
