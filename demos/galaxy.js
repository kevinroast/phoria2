import { Color, Geometry, Group, Points, View } from 'phoria2'
import { glow, starfield } from './kit.js'

// A spiral galaxy that turns slowly against still background stars: tens of thousands of stars in
// one Points object, coloured per vertex (old yellow ones in the bulge, young blue ones along the
// arms), round a glowing core. Stars and core blend additively, so dense places glow.
export default function run({ canvas, gui }) {
  const view = new View({ canvas, orbit: true, background: '#000000', camera: { position: [0, 7.5, 13.5] } })
  view.scene.add(starfield(3000, 400))

  const soft = glow(64)
  const settings = { stars: 200000, arms: 3, twist: 0.7, spread: 0.65 }
  const galaxy = view.scene.add(new Group({ rotation: [0.15, 0, 0.1] }))
  const stars = galaxy.add(new Points({
    geometry: makeStars(settings),
    material: { size: 0.025, map: glow(16, { core: 0.35 }), vertexColors: true, blending: 'additive', depthWrite: false, opacity: 0.75 },
  }))
  // the core: a bright centre in a wide, faint halo
  const centre = new Geometry({ positions: [0, 0, 0] })
  galaxy.add(new Points({ geometry: centre, material: { color: '#ffd9a0', size: 3, map: soft, blending: 'additive', depthWrite: false } }))
  galaxy.add(new Points({ geometry: centre, material: { color: '#ffb070', size: 8, map: soft, blending: 'additive', depthWrite: false, opacity: 0.18 } }))

  const rebuild = () => {
    stars.geometry.dispose()
    stars.geometry = makeStars(settings)
  }

  let f = gui.addFolder('Galaxy')
  f.add(settings, 'stars', 5000, 500000, 5000).onChange(rebuild)
  f.add(settings, 'arms', 1, 7, 1).onChange(rebuild)
  f.add(settings, 'twist', 0, 2, 0.05).onChange(rebuild)
  f.add(settings, 'spread', 0.05, 1, 0.05).onChange(rebuild)
  f = gui.addFolder('Stars')
  f.add(stars.material, 'size', 0.01, 0.2, 0.005)
  f.add(stars.material, 'opacity', 0.1, 1, 0.05)

  return view.start((dt) => galaxy.rotateY(-0.05 * dt))
}

const RADIUS = 6
// geometry colours are sRGB, like every colour input
const srgb = (c) => new Color(c).toSRGB()
const OLD = [srgb('#ffcf8a'), srgb('#ffb070'), srgb('#ffe2b8')]
const YOUNG = [srgb('#9fbfff'), srgb('#cfe0ff'), srgb('#ffffff'), srgb('#7f9fff')]
const pick = (list) => list[Math.floor(Math.random() * list.length)]

// cubed, so most things stay close to where they belong, with a few strays
const scatter = () => (Math.random() * 2 - 1) ** 3 * 2.5

/** The angle of an arm at a distance from the centre: arms wind further round the further out. */
const armAngle = (arms, twist, r) => Math.floor(Math.random() * arms) / arms * Math.PI * 2 + r * twist

/**
 * Points in a disc, each placed by a function that returns [r, angle, spread, rgb, brightness].
 * @param {number} count @param {() => [number, number, number, number[], number]} place
 */
function disc(count, place) {
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const [r, angle, s, rgb, b] = place()
    positions[i * 3] = Math.cos(angle) * r + scatter() * s
    positions[i * 3 + 1] = scatter() * s * 0.4
    positions[i * 3 + 2] = Math.sin(angle) * r + scatter() * s
    for (let c = 0; c < 3; c++) colors[i * 3 + c] = rgb[c] * b
  }
  return new Geometry({ positions, colors })
}

/** Stars: one in five in the old, warm bulge, the rest along the arms, bluer further out. */
function makeStars({ stars, arms, twist, spread }) {
  let i = 0
  return disc(stars, () => {
    if (i++ % 5 === 0) {
      const r = 1.6 * Math.random() ** 2
      return [r, Math.random() * Math.PI * 2, 0.35, pick(OLD), 0.5 + Math.random() * 0.5]
    }
    const r = RADIUS * Math.random() ** 1.5
    const young = Math.random() < 0.3 + 0.6 * (r / RADIUS)
    return [r, armAngle(arms, twist, r), spread * (0.3 + r / RADIUS), young ? pick(YOUNG) : pick(OLD), 0.3 + Math.random() * 0.7]
  })
}
