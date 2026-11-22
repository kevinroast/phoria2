import { Geometry, HemisphereLight, Mesh, SpotLight, View, box, cylinder, plane } from 'phoria2'

// A prism in a dark room: a narrow beam of white light from a small projector goes in, and comes out
// bent and spread into a rainbow across the curved white screen round it - each colour bent by an ior
// of its own (dispersion), red least and violet most. The rainbow is the projector's caustics
// (light.caustics): the light that goes through the glass leaves its straight path and lands where
// the glass sends it - bent through the prism's first face and out of its second - where the beam
// itself never reaches. Turn the prism and the rainbow swings round the screen; more dispersion
// spreads it wider; a wider beam softens it. Still, it refines - each sample's colours a little
// further along the spectrum - so the bands run into each other in a smooth spectrum.

// the screen's radius and height, the beam's height, and the projector's place
const SCREEN = 1.15, TALL = 0.8, BEAM = 0.27, PROJECTOR = [-0.95, BEAM, 0]

/** A curved screen round the back of the prism, open towards the projector: a strip of the inside of a ring. */
function screen() {
  const positions = [], normals = [], indices = [], segments = 96
  const from = -1.9, to = 1.9
  for (let i = 0; i <= segments; i++) {
    const a = from + ((to - from) * i) / segments, x = Math.cos(a), z = Math.sin(a)
    positions.push(x * SCREEN, 0, z * SCREEN, x * SCREEN, TALL, z * SCREEN)
    normals.push(-x, 0, -z, -x, 0, -z)
    // wound to face the middle, as its normals do
    if (i < segments) indices.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3)
  }
  return new Geometry({ positions, normals, indices })
}

export default function run({ canvas, gui }) {
  const view = new View({
    canvas, background: '#050507', fxaa: true, refine: true,
    camera: { position: [-2.3, 1.35, 1.2], target: [0.25, 0.3, -0.4], fov: 42 },
    orbit: { maxPitch: 1.4, minDistance: 0.8, maxDistance: 6 },
  })
  const scene = view.scene
  // a little light from all round, so the room and the glass's edges read in the dark
  scene.environment = 'studio'
  scene.environmentIntensity = 0.25
  scene.add(new HemisphereLight({ sky: '#8e97ad', ground: '#1c1c20', intensity: 0.12 }))

  // a dark table, and the white screen curving round it
  scene.add(new Mesh({ geometry: plane(8), material: { color: '#2b2b30', roughness: 0.85 }, receiveShadow: true }))
  scene.add(new Mesh({ geometry: screen(), material: { color: '#f2f2f2', roughness: 0.95, doubleSided: true }, receiveShadow: true }))

  // the prism: a triangle of flint-like glass standing on end
  const prism = scene.add(new Mesh({
    geometry: cylinder({ radius: 0.2, height: 0.5, segments: 3 }), position: [0, 0.25, 0], castShadow: true,
    material: { transmission: 1, ior: 1.62, dispersion: 6, thickness: 0.3, roughness: 0, flatShading: true },
  }))

  // the projector: a narrow spot - its caustics the rainbow - in a small dark housing with a glowing lens
  const projector = scene.add(new SpotLight({ position: PROJECTOR, target: [0, BEAM, 0], angle: 0.03, penumbra: 0.3, intensity: 20, castShadow: true, caustics: true }))
  scene.add(new Mesh({ geometry: box({ width: 0.16, height: 0.1, depth: 0.1 }), position: [PROJECTOR[0] - 0.09, BEAM, 0], material: { color: '#1a1a1d', metalness: 0.6, roughness: 0.4 } }))
  scene.add(new Mesh({ geometry: cylinder({ radius: 0.022, height: 0.012, segments: 24, axis: 'x' }), position: [PROJECTOR[0] - 0.004, BEAM, 0], material: { color: '#000000', emissive: '#fff6e6', emissiveIntensity: 3 } }))

  const settings = { turn: 0.5, dispersion: 6, beam: 0.03 }
  const place = () => {
    prism.rotation.set(0, settings.turn, 0)
    prism.material.dispersion = settings.dispersion
    projector.angle = settings.beam
  }
  place()
  gui.add(settings, 'turn', -0.6, 1, 0.01).name('turn the prism').onChange(place)
  gui.add(settings, 'dispersion', 0, 8, 0.1).onChange(place)
  gui.add(settings, 'beam', 0.01, 0.07, 0.005).name('beam width').onChange(place)
  gui.add({ refine: true }, 'refine').name('refine when still').onChange((on) => { view.refine = on })

  return view.start()
}
