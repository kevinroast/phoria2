import { DirectionalLight, Mesh, View, cylinder } from 'phoria2'
import { loadGLTF } from 'phoria2/gltf'

// Khronos's glTF sample models, pinned to one commit, from jsDelivr's mirror of their repository -
// the compressed ones load from there rather than from this site
const KHRONOS = 'https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets@e124e8d8d7330a5372bc2b4d00d39a4a9d7997ea/Models/'

/**
 * Each model: where it loads from, how it is compressed (tagged on its button, spelled out under its
 * name), and its credit and licence - and a material made double-sided, for a sample's backdrop
 * that the turntable shows from behind. The local ones are in public/models (see CREDITS.md).
 * @type {{ name: string, url: string, compression: string, credit: string, twoSided?: string }[]}
 */
const MODELS = [
  { name: 'sci-fi helmet', url: 'models/DamagedHelmet.glb', compression: '',
    credit: '"Battle Damaged Sci-fi Helmet" by theblueturtle_, glTF by Khronos - CC BY 4.0' },
  { name: 'chess set', url: `${KHRONOS}ABeautifulGame/glTF-Binary-KTX-ETC1S-Draco/ABeautifulGame.glb`, compression: 'Draco + KTX2',
    credit: '"A Beautiful Game" © 2020 ASWF (MaterialX Project), glTF © 2022 Ed Mackey - CC BY 4.0' },
  // with the checked cloth it comes with: thick amber glass needs something bright behind it, or it
  // shows the dark of the studio
  { name: 'glass dragon', url: `${KHRONOS}DragonAttenuation/glTF-Meshopt/DragonAttenuation.gltf`, compression: 'meshopt', twoSided: 'Cloth Backdrop',
    credit: 'Dragon © 1996 Stanford University Computer Graphics Laboratory, cleaned up by Morgan McGuire - non-commercial use; cloth backdrop by Adobe - CC0' },
  { name: 'watch', url: `${KHRONOS}ChronographWatch/glTF-WEBP/ChronographWatch.gltf`, compression: 'WebP',
    credit: '"Chronograph Watch" © 2025 Darmstadt Graphics Group, by Eric Chadwick - CC BY 4.0' },
  { name: 'flight helmet', url: `${KHRONOS}FlightHelmet/glTF-KTX-BasisU/FlightHelmet.gltf`, compression: 'KTX2',
    credit: '"Flight Helmet", glTF by Gary Hsu - CC0' },
  { name: 'stained-glass lamp', url: `${KHRONOS}StainedGlassLamp/glTF-KTX-BasisU/StainedGlassLamp.gltf`, compression: 'KTX2',
    credit: '"Stained Glass Lamp" © 2021 Wayfair, by Eric Chadwick - CC BY 4.0' },
  // velvet with sheen, occlusion baked onto a second UV set, tiled, turned wood and fabric - and two
  // colourways, as material variants
  { name: 'velvet chair', url: 'models/SheenChair.glb', compression: '',
    credit: '"Sheen Chair" © 2020 Wayfair, by Eric Chadwick - CC0' },
  { name: 'milk truck', url: 'models/CesiumMilkTruck.glb', compression: '',
    credit: '"Cesium Milk Truck" by Cesium - CC BY 4.0' },
]
// each compression, spelled out under the model's name
const COMPRESSION = {
  'Draco + KTX2': 'Draco geometry and KTX2 (Basis Universal) textures',
  meshopt: 'meshopt geometry, quantized',
  WebP: 'WebP textures',
  KTX2: 'KTX2 (Basis Universal) textures',
}
const HDR = 'hdr/studio_small_09_1k.hdr'
const TURN = 0.20

// A product viewer: a glTF model with its full material maps, lit by an HDR studio that also shows
// as a soft backdrop, standing on a plinth in the sun's shadow. The models along the bottom include
// Khronos samples in compressed forms - Draco and meshopt geometry, KTX2 and WebP textures - decoded
// as they load, and glass: the dragon's amber body (its thickness from a map) and the lamp's stained
// glass. The chair's occlusion is baked onto its own UV set, as Blender and Unreal export it, apart
// from the tiling of its fabric and wood. A model with material variants - the chair's velvets - gets
// a choice of them, as a configurator would. With the turntable off, the picture refines.
export default function run({ canvas, gui }) {
  // a slow turntable: a quarter of a radian a second
  const view = new View({ canvas, orbit: { autoRotate: TURN }, camera: { position: [2.4, 1.6, 3.2], fov: 35 } })
  const scene = view.scene
  scene.environment = HDR
  scene.background = scene.environment
  scene.backgroundBlur = 0.15
  scene.environmentIntensity = 0.5
  // a soft sun, as a studio's big light: shadows sharp where the model meets the plinth, softer further off
  const sun = scene.add(new DirectionalLight({ direction: [-0.5, -1, -0.35], intensity: 1.2, castShadow: true, shadowSoftness: 0.15 }))
  const plinth = scene.add(new Mesh({
    geometry: cylinder({ radius: 1.6, height: 0.1, segments: 96 }),
    material: { color: '#d8d6d2', roughness: 0.6, environmentIntensity: 0.70 },
    position: [0, -0.05, 0],
    receiveShadow: true,
  }))

  const settings = { variant: '', environment: 'studio HDR', backdrop: true, turntable: true }
  /** @type {import('phoria2/gltf').Model | null} */
  let model = null
  let loading = 0

  // the models along the bottom: a button each, its compression tagged, and the one shown named
  // over them with its compression and credit
  const el = (/** @type {string} */ tag, /** @type {string} */ className, /** @type {string} */ text = '') => Object.assign(document.createElement(tag), { className, textContent: text })
  const bar = el('div', 'viewer-models'), caption = el('div', 'viewer-caption'), row = el('div', 'viewer-buttons')
  const buttons = MODELS.map((m, i) => {
    const button = Object.assign(el('button', ''), { type: 'button' })
    button.append(m.name)
    if (m.compression) button.append(el('small', '', m.compression))
    // focus let go after a click, so the space bar - the turntable's key - doesn't press it again
    button.addEventListener('click', () => {
      button.blur()
      show(i)
    })
    row.append(button)
    return button
  })
  bar.append(caption, row)
  document.body.append(bar)

  /** @param {number} index */
  const show = async (index) => {
    const id = ++loading
    const m = MODELS[index]
    buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === index)))
    const how = m.compression ? COMPRESSION[/** @type {keyof typeof COMPRESSION} */ (m.compression)] : 'uncompressed'
    // loading, said after its name until it's here
    const state = el('span', '', ' - loading...')
    caption.replaceChildren(el('strong', '', m.name), state, el('small', '', m.credit))
    let next
    try {
      next = await loadGLTF(m.url)
    } catch (e) {
      if (id === loading) state.textContent = ` - couldn't load: ${/** @type {Error} */ (e).message}`
      return
    }
    state.textContent = ` - ${how}`
    if (id !== loading) return
    if (model) scene.remove(model)
    model = next
    for (const mesh of model.meshes) if (mesh.material.name === m.twoSided) mesh.material.doubleSided = true
    // stand it on the plinth at about 2 units tall, casting and catching shadows - a hair above its
    // top, so a flat underside (the dragon's cloth) doesn't share its depth and flicker
    const box = model.bounds, size = box.getSize(), s = 2 / Math.max(size[0], size[1], size[2])
    const c = box.getCenter()
    model.scale.set(s, s, s)
    model.position.set(-c[0] * s, -box.min[1] * s + 0.003, -c[2] * s)
    for (const mesh of model.meshes) mesh.castShadow = mesh.receiveShadow = true
    scene.add(model)
    if (model.animations.length) model.play()
    // its variants to choose from, if it has any - shown in the first
    settings.variant = model.variants[0] ?? ''
    model.variant = model.variants[0] ?? null
    variants.options(model.variants)
    variants.root.style.display = model.variants.length ? '' : 'none'
    frameAbove()
  }
  // the plinth and the model on it, framed in the picture above the bar along the bottom: framed in
  // the whole picture, turning about the plinth's axis (so the turntable turns it in place), the
  // camera drawn back by the share the bar takes, then lowered - straight down, with what it looks
  // at - by about a third of the bar's height, so they sit above it
  const frameAbove = () => {
    if (!model) return
    view.frame(model.bounds.union(plinth.bounds), { padding: 0.1 })
    const { position: p, target: t } = view.camera
    p.set(p[0] - t[0], p[1], p[2] - t[2])
    t.set(0, t[1], 0)
    const height = canvas.clientHeight || 1, below = bar.getBoundingClientRect().height + 24
    // drawn back for the bar, then in by a quarter: the model fills more of the picture
    const back = (height / Math.max(height - below, height * 0.4)) * 0.76
    p.set(p[0] * back, t[1] + (p[1] - t[1]) * back, p[2] * back)
    // how far a pixel is at what it looks at, and how much of a drop straight down shows as one
    // up the picture (less, the more it looks down)
    const d = Math.hypot(p[0], p[1] - t[1], p[2]), level = Math.hypot(p[0], p[2]) / d
    const perPixel = (2 * d * Math.tan((/** @type {any} */ (view.camera).fov * Math.PI) / 360)) / height
    const drop = (below * 0.33 * perPixel) / Math.max(level, 0.2)
    p.set(p[0], p[1] - drop, p[2])
    t.set(0, t[1] - drop, 0)
  }
  // the model's material variants: all its parts in another colourway at once
  const variants = gui.add(settings, 'variant', []).onChange((v) => {
    if (!model) return
    model.variant = v
  })
  show(0)
  gui.add(settings, 'environment', ['studio HDR', 'built-in studio', 'none']).onChange((v) => {
    scene.environment = v === 'studio HDR' ? HDR : v === 'built-in studio' ? 'studio' : 'none'
    scene.background = settings.backdrop && v === 'studio HDR' ? scene.environment : '#1c1c20'
  })
  gui.add(settings, 'backdrop').name('HDR backdrop').onChange((on) => {
    scene.background = on && typeof scene.environment === 'object' ? scene.environment : '#1c1c20'
  })
  gui.add(scene, 'backgroundBlur', 0, 1, 0.05).name('backdrop blur')
  gui.add(scene, 'environmentIntensity', 0, 3, 0.05).name('environment')
  // the plinth alone: less of the studio in it, so the model stands out
  gui.add(plinth.material, 'environmentIntensity', 0, 2, 0.05).name('plinth reflections')
  gui.add(sun, 'intensity', 0, 4, 0.05).name('sun')
  gui.add(sun, 'shadowSoftness', 0, 1, 0.05).name('shadow softness')
  gui.add(view.renderer, 'exposure', 0.2, 3, 0.05)
  gui.add(view.renderer, 'toneMapping', ['neutral', 'aces', 'none']).name('tone mapping')
  const turntable = (/** @type {boolean} */ on) => { view.controls.autoRotate = on ? TURN : false }
  gui.add(settings, 'turntable').onChange(turntable)
  // the space bar turns the turntable on and off - unless typing in a field
  window.addEventListener('keydown', (e) => {
    if (e.key !== ' ' || /^(INPUT|TEXTAREA|SELECT)$/.test(/** @type {HTMLElement} */ (e.target).tagName ?? '')) return
    e.preventDefault()
    settings.turntable = !settings.turntable
    turntable(settings.turntable)
    gui.updateDisplay()
  })
  // the controls folded away to start, so the model has the picture
  const panel = /** @type {any} */ (gui).panel
  panel?.classList.add('collapsed')
  return view
}
