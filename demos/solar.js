import { AmbientLight, Geometry, Group, Label, Lines, Mesh, PointLight, Points, Texture, View, ellipse, lathe, sphere } from 'phoria2'
import { glow, starfield } from './kit.js'
import { banded, clouds, terrain } from './planets.js'

/** @type {[number, string][]} */
const ROCK = [[0, '#4f4a45'], [0.5, '#857e75'], [1, '#bdb5aa']]

// distance from the sun, size, days per orbit and surface - squeezed, so it all fits on screen. The
// surfaces are drawn when the page loads: bands for the gas giants, noise for land and sea
const PLANETS = [
  { name: 'Mercury', distance: 6, radius: 0.35, year: 88, surface: () => terrain(ROCK, { seed: 2, scale: 4, width: 256 }) },
  { name: 'Venus', distance: 9, radius: 0.6, year: 225, surface: () => banded(['#d9b77a', '#ead19c', '#f4e2b8', '#cfa865'], { seed: 3, turbulence: 2.5, width: 256 }) },
  {
    name: 'Earth', distance: 12.5, radius: 0.65, year: 365, moon: true, clouds: true,
    surface: () => terrain([[0, '#0a2556'], [0.5, '#1f5fa8'], [0.53, '#d8c99a'], [0.56, '#3f7d35'], [0.72, '#5f7a3a'], [0.85, '#8a7550'], [1, '#e8e8e8']], { seed: 5, ice: 0.16 }),
  },
  { name: 'Mars', distance: 16, radius: 0.45, year: 687, surface: () => terrain([[0, '#5a2a1a'], [0.5, '#a4512c'], [0.75, '#c87a4a'], [1, '#e0a070']], { seed: 7, scale: 3, ice: 0.08, width: 256 }) },
  {
    name: 'Jupiter', distance: 23, radius: 1.8, year: 4333,
    surface: () => banded(['#c9a27a', '#ecdcc0', '#b07a50', '#f2e6d0', '#a0684a', '#dcc29e'], { seed: 8, storms: [{ at: [0.6, 0.64, 0.05, 0.035], color: '#c0583a' }] }),
  },
  { name: 'Saturn', distance: 31, radius: 1.5, year: 10759, rings: true, surface: () => banded(['#e3cf9a', '#d4b87e', '#efe0b8', '#c9ab72'], { seed: 9, turbulence: 0.4, width: 256 }) },
]

// A solar system: each planet rides on a pivot at the sun, so turning the pivot moves it round
// its orbit; the Moon rides on Earth's group the same way. The sun is a point light. Click a planet
// to follow it - the orbit control keeps working around whatever it follows.
export default function run({ canvas, gui, info }) {
  info.textContent = 'Click a planet to follow it, or the sun to come back'
  // far enough back that every orbit, Saturn's included, is in view
  const view = new View({ canvas, orbit: { maxDistance: 150 }, background: '#03030a', camera: { position: [0, 26, 58], far: 3000 } })
  const { scene, camera } = view
  scene.add(starfield(3000, 900))
  scene.add(new AmbientLight({ intensity: 0.07 }))

  const sun = scene.add(new Mesh({
    name: 'Sun', geometry: sphere({ radius: 2.6, segments: 48, rings: 24 }),
    material: { map: terrain([[0, '#ff7a10'], [0.5, '#ffb52e'], [1, '#fff2a8']], { seed: 1, scale: 7, width: 256 }), unlit: true },
  }))
  sun.add(new Points({ geometry: new Geometry({ positions: [0, 0, 0] }), material: { color: '#ff9a30', size: 16, map: glow(), blending: 'additive', depthWrite: false }, pickable: false }))
  sun.add(new PointLight({ color: '#fff4e0', intensity: 800 }))

  const ball = sphere({ segments: 48, rings: 24 })
  const orbits = scene.add(new Group({ pickable: false }))
  const labels = []
  const planets = PLANETS.map((p) => {
    const pivot = scene.add(new Group({ rotation: [0, Math.random() * Math.PI * 2, 0] }))
    // the planet's group stays upright as it orbits; the globe inside it spins
    const body = pivot.add(new Group({ position: [p.distance, 0, 0] }))
    const globe = body.add(new Mesh({ name: p.name, geometry: ball, material: { map: p.surface(), roughness: 0.8 }, scale: p.radius }))
    // a see-through shell of cloud, a little bigger than the globe
    if (p.clouds) globe.add(new Mesh({ geometry: ball, material: { map: clouds(), transparent: true, depthWrite: false, roughness: 1 }, scale: 1.025, pickable: false }))
    labels.push(body.add(new Label({ text: p.name, position: [0, p.radius + 0.8, 0], className: 'demo-tick' })))
    orbits.add(new Lines({ geometry: ellipse({ radius: p.distance }).line({ segments: 128 }), material: { color: '#2a2f45' } }))
    if (p.rings) {
      body.add(new Mesh({ name: p.name, geometry: lathe({ points: [[p.radius * 2.4, 0], [p.radius * 1.3, 0]], segments: 96 }), material: { map: ringBands(), transparent: true, doubleSided: true, roughness: 0.9 }, rotation: [0.3, 0, 0.15] }))
    }
    let moon = null
    if (p.moon) {
      const moonPivot = body.add(new Group())
      moon = { pivot: moonPivot, globe: moonPivot.add(new Mesh({ name: 'Moon', geometry: ball, material: { map: terrain(ROCK, { seed: 12, scale: 3, width: 128 }), roughness: 0.9 }, scale: 0.18, position: [1.6, 0, 0] })) }
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

/** Saturn's rings, inner edge (top) to outer: bands of dust, with the Cassini gap - down the image, as lathe() runs v. */
function ringBands() {
  const c = document.createElement('canvas')
  c.width = 1
  c.height = 256
  const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'))
  for (let y = 0; y < 256; y++) {
    const t = y / 256
    const gap = t > 0.62 && t < 0.68
    const a = gap ? 0.05 : (0.45 + 0.4 * Math.sin(t * 40) * Math.sin(t * 13)) * Math.min(1, t * 6, (1 - t) * 8)
    ctx.fillStyle = `rgba(${210 + 30 * Math.sin(t * 25)}, ${190 + 25 * Math.sin(t * 25)}, ${150 + 20 * Math.sin(t * 9)}, ${Math.max(0, a)})`
    ctx.fillRect(0, y, 1, 1)
  }
  return new Texture({ image: c })
}

