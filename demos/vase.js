import { DirectionalLight, Mesh, View, cylinder } from 'phoria2'
import { loadGLTF } from 'phoria2/gltf'

// A glass vase of flowers on a plinth, from Khronos's glTF sample models (see public/models/CREDITS.md).
// Its glass has a thickness map (KHR_materials_volume's thicknessTexture): thin walls you see the
// stems through cleanly, and a solid foot and bulb that bend what is behind them as a lens. The sun
// casts the vase's faint shadow - darker at its outline, where the light grazes the walls - and its
// caustics: the light the thick foot bends, while the thin walls only tint it. The sample model sets
// alpha-blended glass beside this one for comparison; that one is left out. Still, the picture
// refines - 64 samples, the soft shadow and the glass settling smooth.

const MODEL = 'models/GlassVaseFlowers.glb'
const SAMPLES = 128

export default function run({ canvas, gui, info }) {
  const view = new View({ canvas, orbit: true, refine: { samples: SAMPLES }, camera: { position: [2.4, 1.6, 3.2], fov: 35 } })
  const scene = view.scene
  // clear glass shows by what it reflects and bends: a surround with dark in it, not all white
  scene.environment = 'studio'
  scene.background = '#3a3a40'
  const sun = scene.add(new DirectionalLight({ direction: [-0.5, -1, -0.35], intensity: 1.2, castShadow: true, shadowSoftness: 0.1, caustics: true }))
  scene.add(new Mesh({
    geometry: cylinder({ radius: 1.6, height: 0.1, segments: 96 }),
    material: { color: '#d8d6d2', roughness: 0.6, environmentIntensity: 0.7 },
    position: [0, -0.05, 0],
    receiveShadow: true,
  }))

  info.textContent = 'Loading...'
  loadGLTF(MODEL).then((model) => {
    // the transmission vase and its flowers only
    for (const name of ['GlassAlpha', 'Flowers1']) {
      const n = model.find(name)
      n?.parent?.remove(n)
    }
    // about 2 units tall, centred on the vase - the flowers lean to one side - standing on the plinth
    const box = model.bounds, s = 2 / Math.max(...box.getSize())
    const c = /** @type {import('phoria2').Node} */ (model.find('GlassTransmission')).bounds.getCenter()
    model.scale.set(s, s, s)
    model.position.set(-c[0] * s, -box.min[1] * s, -c[2] * s)
    for (const m of model.meshes) m.castShadow = m.receiveShadow = true
    scene.add(model)
    view.frame(model, { padding: 0.15 })
    info.textContent = 'Glass vase with flowers, CC0 - Eric Chadwick and Rico Cilliers (Khronos glTF sample models)'
  })

  gui.add(sun, 'caustics')
  gui.add({ refine: true }, 'refine').name('refine when still').onChange((on) => { view.refine = on ? { samples: SAMPLES } : false })

  return view.start()
}
