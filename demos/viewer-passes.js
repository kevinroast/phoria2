import { Mesh, View, box, cylinder, fromPolygons, lathe, sphere, torus } from 'phoria2'
import { teapot } from './data/teapot.js'

// The product viewer's passes, each on its own switch, over a still life lit only by an HDR studio:
// - ambient occlusion shades the creases - the teapot's lid and handle, under the ball in its bowl,
//   between the stacked blocks and the pegs - dimming the studio's light from all round there;
// - the ground shadow sits under everything, darkest where things touch the ground - on the floor,
//   or with the floor off on nothing at all: no light needed;
// - FXAA smooths jagged edges in one pass over the picture. Multisampling is off here, as a phone
//   viewer would have it to save work, so FXAA is all the antialiasing there is: turn it on and
//   watch the spokes and the blocks' edges.
export default function run({ canvas, gui }) {
  const view = new View({
    canvas, background: '#e7e5e1', camera: { position: [5.2, 3.6, 6.4], target: [0, 0.7, 0], fov: 35 },
    orbit: { autoRotate: false, maxPitch: 1.35 },
    // no multisampling, as on a phone: FXAA stands in for it
    antialias: false, ambientOcclusion: true, groundShadow: true, fxaa: true, autoLight: false,
  })
  const { scene } = view
  scene.environment = 'hdr/studio_small_09_1k.hdr'

  const solid = (geometry, color, position, extra = {}) => scene.add(new Mesh({ geometry, position, material: { color, roughness: 0.45, ...extra } }))

  // a teapot, glazed - both sides drawn: the Utah teapot's body is a shell open at the top, so over
  // the rim the inside of the far wall shows, and that is its back
  const pot = fromPolygons({ ...teapot, smooth: true })
  const b = pot.bounds, s = 1.5 / (b.getRadius() || 1), c = b.getCenter()
  scene.add(new Mesh({ geometry: pot, material: { color: '#f3efe8', roughness: 0.18, doubleSided: true }, scale: s, position: [-c[0] * s - 0.6, -b.min[1] * s, -c[2] * s - 0.4] }))

  // a ball in a bowl
  solid(lathe({ points: [[0, 0], [0.55, 0], [0.62, 0.05], [0.9, 0.45], [0.86, 0.47], [0.58, 0.1], [0, 0.1]], segments: 64 }), '#3f6fa3', [2.1, 0, 1.1])
  solid(sphere({ radius: 0.42, segments: 48, rings: 24 }), '#e8b04a', [2.1, 0.52, 1.1], { roughness: 0.3, metalness: 0.2 })

  // blocks stacked off true
  solid(box({ width: 1.1, height: 0.5, depth: 1.1 }), '#c4533f', [-2.3, 0.25, 1.6])
  solid(box({ width: 0.8, height: 0.5, depth: 0.8 }), '#d9774f', [-2.25, 0.75, 1.55]).rotateY(0.35)
  solid(box({ width: 0.5, height: 0.5, depth: 0.5 }), '#e9a27a', [-2.3, 1.25, 1.6]).rotateY(0.8)

  // a ring lying flat, a wheel of thin spokes standing up, and pegs in a row
  solid(torus({ radius: 0.55, tube: 0.16, segments: 64, tubeSegments: 24 }), '#5a8f6a', [0.9, 0.16, 2.3])
  solid(torus({ radius: 0.7, tube: 0.04, segments: 96 }), '#2c2f36', [1.6, 0.74, -1.6], { metalness: 0.8, roughness: 0.3 })
  for (let i = 0; i < 12; i++) {
    const spoke = solid(cylinder({ radius: 0.012, height: 1.4, segments: 8 }), '#2c2f36', [1.6, 0.74, -1.6], { metalness: 0.8, roughness: 0.3 })
    spoke.rotateZ((i / 12) * Math.PI)
  }
  for (let i = 0; i < 6; i++) solid(cylinder({ radius: 0.09, height: 0.6, segments: 24 }), '#7d6aa8', [-1.4 + i * 0.28, 0.3, -2.2])

  // a floor: it only receives shadows, so it casts no ground shadow of its own
  const floor = scene.add(new Mesh({ geometry: cylinder({ radius: 4.5, height: 0.02, segments: 96 }), position: [0, -0.01, 0], material: { color: '#ddd8d1', roughness: 0.8 }, receiveShadow: true, pickable: false }))

  // ---- each pass on its own switch, and its settings
  const settings = { turntable: false, occlusion: true, strength: 1, radius: 0, ground: true, opacity: 0.6, softness: 0.5, height: 0, fxaa: true, floor: true }
  const occlusion = () => { view.ambientOcclusion = settings.occlusion && { strength: settings.strength, ...(settings.radius > 0 ? { radius: settings.radius } : {}) } }
  const ground = () => { view.groundShadow = settings.ground && { opacity: settings.opacity, softness: settings.softness, ...(settings.height > 0 ? { height: settings.height } : {}) } }
  gui.add(settings, 'turntable').onChange((v) => { view.controls.autoRotate = v })
  const a = gui.addFolder('ambient occlusion')
  a.add(settings, 'occlusion').name('on').onChange(occlusion)
  a.add(settings, 'strength', 0, 3, 0.05).onChange(occlusion)
  a.add(settings, 'radius', 0, 1.5, 0.05).name('radius (0: auto)').onChange(occlusion)
  const g = gui.addFolder('ground shadow')
  g.add(settings, 'ground').name('on').onChange(ground)
  g.add(settings, 'opacity', 0, 1, 0.05).onChange(ground)
  g.add(settings, 'softness', 0, 1, 0.05).onChange(ground)
  g.add(settings, 'height', 0, 4, 0.1).name('height (0: auto)').onChange(ground)
  g.add(settings, 'floor').onChange((v) => { floor.visible = v; view.invalidate() })
  gui.add(settings, 'fxaa').name('FXAA').onChange((v) => { view.fxaa = v })
  return view
}
