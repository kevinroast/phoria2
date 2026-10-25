import { DirectionalLight, Mesh, View, cylinder } from 'phoria2'
import { loadGLTF } from 'phoria2/gltf'

// glTF sample models (see public/models/CREDITS.md) and a Poly Haven studio HDR
const MODELS = {
  'sci-fi helmet': 'models/DamagedHelmet.glb',
  'milk truck (animated)': 'models/CesiumMilkTruck.glb',
}
const HDR = 'hdr/studio_small_09_1k.hdr'

// A product viewer: a glTF model with its full material maps, lit by an HDR studio that also
// shows as a soft backdrop, standing on a plinth in the sun's shadow.
export default function run({ canvas, gui, info }) {
  const view = new View({ canvas, orbit: { autoRotate: true }, camera: { position: [2.4, 1.6, 3.2], fov: 35 } })
  const scene = view.scene
  scene.environment = HDR
  scene.background = scene.environment
  scene.backgroundBlur = 0.5
  const sun = scene.add(new DirectionalLight({ direction: [-0.5, -1, -0.35], intensity: 1.2, castShadow: true }))
  scene.add(new Mesh({
    geometry: cylinder({ radius: 1.6, height: 0.1, segments: 96 }),
    material: { color: '#d8d6d2', roughness: 0.6 },
    position: [0, -0.05, 0],
    receiveShadow: true,
  }))

  const settings = { model: Object.keys(MODELS)[0], environment: 'studio HDR', backdrop: true, shadows: true, playing: true }
  /** @type {import('phoria2/gltf').Model | null} */
  let model = null
  let loading = 0

  const show = async () => {
    const id = ++loading
    info.textContent = 'Loading...'
    const next = await loadGLTF(MODELS[settings.model])
    if (id !== loading) return
    if (model) scene.remove(model)
    model = next
    // stand it on the plinth at about 2 units tall, casting and catching shadows
    const box = model.bounds, size = box.getSize(), s = 2 / Math.max(size[0], size[1], size[2])
    const c = box.getCenter()
    model.scale.set(s, s, s)
    model.position.set(-c[0] * s, -box.min[1] * s, -c[2] * s)
    for (const m of model.meshes) m.castShadow = m.receiveShadow = settings.shadows
    scene.add(model)
    if (settings.playing) model.play()
    view.frame(model, { padding: 1.5 })
    const maps = new Set()
    for (const m of model.meshes) for (const [slot] of m.material.textures) maps.add(slot)
    info.textContent = `${model.animations.length ? `${model.animations.length} animation(s), ` : ''}maps: ${[...maps].join(', ') || 'none'}`
  }
  show()

  gui.add(settings, 'model', Object.keys(MODELS)).onChange(show)
  gui.add(settings, 'environment', ['studio HDR', 'built-in studio', 'none']).onChange((v) => {
    scene.environment = v === 'studio HDR' ? HDR : v === 'built-in studio' ? 'studio' : 'none'
    scene.background = settings.backdrop && v === 'studio HDR' ? scene.environment : '#1c1c20'
  })
  gui.add(settings, 'backdrop').name('HDR backdrop').onChange((on) => {
    scene.background = on && typeof scene.environment === 'object' ? scene.environment : '#1c1c20'
  })
  gui.add(scene, 'backgroundBlur', 0, 1, 0.05).name('backdrop blur')
  gui.add(scene, 'environmentIntensity', 0, 3, 0.05).name('environment')
  gui.add(sun, 'intensity', 0, 4, 0.05).name('sun')
  gui.add(settings, 'shadows').onChange((on) => {
    sun.castShadow = on
    for (const m of model?.meshes ?? []) m.castShadow = m.receiveShadow = on
  })
  gui.add(view.renderer, 'exposure', 0.2, 3, 0.05)
  gui.add(view.renderer, 'toneMapping', ['neutral', 'aces', 'none']).name('tone mapping')
  gui.add(settings, 'playing').name('play animation').onChange((on) => {
    for (const a of model?.animations ?? []) on ? a.play() : a.pause()
  })
  gui.add(view.controls, 'autoRotate').name('turntable')
  return view
}
