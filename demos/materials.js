import { DirectionalLight, Group, Label, Mesh, Texture, View, plane, roundedBox } from 'phoria2'

// Material test: a 5x5 chart of spheres on a matte floor - roughness from 0 (a mirror) to 1 left to
// right, metalness from 0 (paint, plastic) to 1 (bare metal) front to back. A non-metal's colour is
// its diffuse colour under a thin clear shine; a metal has no diffuse colour, and tints its
// reflections instead - which is why the metals need something to reflect: an HDR photo of a studio,
// or the built-in one. Pick a colour to see the same chart in gold, copper or plastic; turn the light
// to move the highlights and shadows. Still, the picture refines - the rough highlights and the soft
// shadows settling smooth.

const STEPS = [0, 0.25, 0.5, 0.75, 1], GAP = 2.4, RADIUS = 0.9
// base colours (sRGB): a non-metal's diffuse colour, a metal's tint. Gold and copper deeper than their
// measured reflectance, which reads pale - near cream and pink - on the rough spheres in a bright room
const COLOURS = {
  gold: '#d4a640', copper: '#c0703f', iron: '#c4c7c7',
  'red plastic': '#c0262b', 'blue paint': '#2f6fd6', 'white ceramic': '#e8e8e8', orange: '#e0a050',
}
const LIGHTS = { white: '#ffffff', warm: '#ffd9a8', cool: '#bcd4ff' }
// each step's place along the chart, centred
const at = (/** @type {number} */ i) => (i - (STEPS.length - 1) / 2) * GAP

export default function run({ canvas, gui }) {
  const view = new View({ canvas, orbit: { maxPitch: 1.45 }, refine: true, background: '#1c1c20', camera: { position: [0, 9.5, 13.5], target: [0, 0, -0.6], fov: 40 } })
  const scene = view.scene
  // an HDR loads once and is kept, so switching back to it is instant
  const hdr = new Texture({ url: 'hdr/studio_small_09_1k.hdr', colorSpace: 'linear', mipmaps: false })
  // the HDR studio is bright from every side - at full strength it fills in every shadow side, and the
  // chart looks washed out - so it lights at half; the built-in one is darker below, and lights in full
  const environment = (/** @type {string} */ v) => {
    scene.environment = v === 'HDR studio' ? hdr : v === 'none' ? 'none' : 'studio'
    scene.environmentIntensity = v === 'HDR studio' ? 0.5 : 1
  }
  environment('HDR studio')

  scene.add(new Mesh({ geometry: plane(30), material: { color: '#3a3a3f', roughness: 0.9, environmentIntensity: 0.6 }, receiveShadow: true }))
  const light = scene.add(new DirectionalLight({ intensity: 1.5, castShadow: true, shadowSoftness: 0.25 }))

  // rounded boxes, turned to show two faces and the curve between them
  // smaller than the spacing, so there's floor between them
  const SIZE = 1.5
  const geometry = roundedBox({ size: SIZE, radius: 0.3, segments: 10 })
  const chart = scene.add(new Group())
  /** @type {Mesh[]} */
  const spheres = []
  STEPS.forEach((roughness, x) => STEPS.forEach((metalness, z) => {
    spheres.push(chart.add(new Mesh({
      geometry, material: { roughness, metalness },
      position: [at(x), SIZE / 2, -at(z)], rotation: [0, 0.6, 0], castShadow: true, receiveShadow: true,
    })))
  }))
  // each column's roughness along the front, each row's metalness down the left
  const front = -at(0) + RADIUS + 0.6, left = at(0) - RADIUS - 0.7
  STEPS.forEach((v, i) => {
    chart.add(new Label({ text: String(v), position: [at(i), 0, front], className: 'demo-label' }))
    chart.add(new Label({ text: String(v), position: [left, RADIUS, -at(i)], className: 'demo-label' }))
  })
  chart.add(new Label({ text: 'roughness →', position: [0, 0, front + 1], className: 'demo-label' }))
  // metalness runs away from the viewer - up the screen
  chart.add(new Label({ text: 'metalness ↑', position: [left, RADIUS, -at(STEPS.length - 1) - 1.6], className: 'demo-label' }))

  const settings = { colour: 'orange', angle: 50, height: 40, light: 'white' }
  const colour = () => { for (const s of spheres) s.material.color.set(COLOURS[/** @type {keyof typeof COLOURS} */ (settings.colour)]) }
  // the light from an angle round the chart and a height above it, in degrees
  const aim = () => {
    const a = (settings.angle * Math.PI) / 180, h = (settings.height * Math.PI) / 180
    light.direction = [-Math.cos(h) * Math.sin(a), -Math.sin(h), -Math.cos(h) * Math.cos(a)]
    light.color.set(LIGHTS[/** @type {keyof typeof LIGHTS} */ (settings.light)])
  }
  colour()
  aim()
  // the whole chart in view, from the front and above
  view.frame(chart, { padding: 0.18 })

  let f = gui.addFolder('Material')
  f.add(settings, 'colour', Object.keys(COLOURS)).onChange(colour)
  f = gui.addFolder('Lighting')
  const lighting = { environment: 'HDR studio' }
  f.add(lighting, 'environment', ['HDR studio', 'built-in studio', 'none']).onChange(environment)
  f.add(settings, 'angle', -180, 180, 1).name('light angle').onChange(aim)
  f.add(settings, 'height', 10, 90, 1).name('light height').onChange(aim)
  f.add(settings, 'light', Object.keys(LIGHTS)).name('light colour').onChange(aim)
  f.add(light, 'intensity', 0, 5, 0.05).name('light intensity')
  gui.add({ refine: true }, 'refine').name('refine when still').onChange((on) => { view.refine = on })

  return view.start()
}
