import { Color, Geometry, Points, View } from 'phoria2'

// A spiral galaxy: tens of thousands of stars in one Points object, coloured per vertex, sized in
// world units and blended additively so the dense core and arms glow.
export default function run({ canvas, gui }) {
  const view = new View({ canvas, orbit: { autoRotate: 0.1 }, background: '#000000', camera: { position: [0, 7, 11] } })

  const settings = { stars: 50000, arms: 3, twist: 0.7, spread: 0.45 }
  const galaxy = view.scene.add(new Points({
    geometry: makeGalaxy(settings),
    material: { size: 0.05, vertexColors: true, blending: 'additive', depthWrite: false },
  }))
  const rebuild = () => {
    galaxy.geometry.dispose()
    galaxy.geometry = makeGalaxy(settings)
  }

  let f = gui.addFolder('Galaxy')
  f.add(settings, 'stars', 5000, 500000, 5000).onChange(rebuild)
  f.add(settings, 'arms', 1, 7, 1).onChange(rebuild)
  f.add(settings, 'twist', 0, 2, 0.05).onChange(rebuild)
  f.add(settings, 'spread', 0.05, 1, 0.05).onChange(rebuild)
  f = gui.addFolder('Stars')
  f.add(galaxy.material, 'size', 0.01, 0.2, 0.005)
  f.add(galaxy.material, 'opacity', 0.1, 1, 0.05)

  return view.start((dt) => galaxy.rotateY(-0.05 * dt))
}

// geometry colours are sRGB, like every colour input
const CORE = new Color('#ffcf8a').toSRGB(), EDGE = new Color('#5b7dff').toSRGB()

// cubed, so most stars stay close to where they belong, with a few strays
const scatter = () => (Math.random() * 2 - 1) ** 3 * 2.5

/** Stars along spiral arms around a central bulge, densest and warmest at the core. */
function makeGalaxy({ stars, arms, twist, spread }) {
  const positions = new Float32Array(stars * 3)
  const colors = new Float32Array(stars * 3)
  const radius = 6
  for (let i = 0; i < stars; i++) {
    // one star in six is in the bulge, the rest are on an arm
    const bulge = i % 6 === 0
    const r = bulge ? 1.5 * Math.random() ** 2 : radius * Math.random() ** 1.6
    const angle = bulge ? Math.random() * Math.PI * 2 : Math.floor(Math.random() * arms) / arms * Math.PI * 2 + r * twist
    const s = bulge ? 0.3 : spread * (0.3 + r / radius)
    positions[i * 3] = Math.cos(angle) * r + scatter() * s
    positions[i * 3 + 1] = scatter() * s * 0.5
    positions[i * 3 + 2] = Math.sin(angle) * r + scatter() * s
    const t = Math.min(1, r / radius * 1.3)
    for (let c = 0; c < 3; c++) colors[i * 3 + c] = CORE[c] + (EDGE[c] - CORE[c]) * t
  }
  return new Geometry({ positions, colors })
}
