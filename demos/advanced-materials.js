import { DirectionalLight, Label, Mesh, Texture, View, plane, sphere } from 'phoria2'

// Materials beyond roughness and metalness, side by side so the differences show. In front, glass:
// opacity fades a surface - its reflections too - while transmission lets light through and keeps
// them, the glass showing less of what is behind it towards its edges. Behind, clearcoat: one red
// metallic paint with no coat, half a coat, a full one and a satin one - the coat's sharp reflection
// over the paint's soft one. Bright stripes behind everything show what the glass lets through.

/** Bright diagonal stripes, to see through the glass. */
function stripes() {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'))
  // eight stripes across a tile, so as many colours: the tiles meet seamlessly
  const colours = ['#f2c14e', '#f78154', '#4d9de0', '#3bb273', '#e15554', '#7768ae', '#5cc8d6', '#f4f1de']
  g.fillStyle = '#16161c'
  g.fillRect(0, 0, 256, 256)
  g.lineWidth = 22
  for (let i = -8; i < 16; i++) {
    g.strokeStyle = colours[((i % colours.length) + colours.length) % colours.length]
    g.beginPath()
    // past the tile's edges, so no stripe's end shows where tiles meet
    g.moveTo(i * 32 - 32, -32)
    g.lineTo(i * 32 + 288, 288)
    g.stroke()
  }
  return new Texture({ image: c, wrap: 'repeat' })
}

/** A dark checked floor. */
function checks() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'))
  g.fillStyle = '#2a2a31'
  g.fillRect(0, 0, 64, 64)
  g.fillStyle = '#3a3a43'
  g.fillRect(0, 0, 32, 32)
  g.fillRect(32, 32, 32, 32)
  return new Texture({ image: c, wrap: 'repeat', filter: 'nearest' })
}

const X = [-4.5, -1.5, 1.5, 4.5]
const PAINT = { color: '#a3121f', metalness: 0.6, roughness: 0.45 }

export default function run({ canvas, gui }) {
  const view = new View({ canvas, orbit: true, background: '#121216', camera: { position: [0, 6.2, 12.5], target: [0, 0.9, 0] } })
  const { scene } = view
  // a photographed studio: its windows show as sharp reflections in the glass and the coats
  const hdr = new Texture({ url: 'hdr/studio_small_09_1k.hdr', colorSpace: 'linear', mipmaps: false })
  scene.environment = hdr
  scene.add(new DirectionalLight({ direction: [0.5, -1, -0.6], intensity: 1.6 }))

  const floor = checks()
  floor.repeat = [10, 7]
  scene.add(new Mesh({ geometry: plane({ width: 20, depth: 14 }), material: { map: floor, roughness: 0.7 } }))
  const backdrop = stripes()
  backdrop.repeat = [4, 1.4]
  scene.add(new Mesh({ geometry: plane({ width: 18, depth: 6 }), rotation: [Math.PI / 2, 0, 0], position: [0, 3, -4], material: { map: backdrop, unlit: true } }))

  const ball = sphere({ radius: 1, segments: 48, rings: 32 })
  /** A sample sphere with its caption, under it or over it. @param {number} x @param {number} z @param {object} material @param {string} caption @param {boolean} [over] */
  const sample = (x, z, material, caption, over = false) => {
    const mesh = scene.add(new Mesh({ geometry: ball, position: [x, 1, z], material }))
    scene.add(new Label({ text: caption, position: over ? [x, 2.25, z] : [x, -0.1, z + 1.1], place: over ? 'above' : 'center', className: 'demo-label' }))
    return mesh
  }

  // in front: glass - and plain opacity beside it, for the difference
  sample(X[0], 2.4, { color: '#9fd3ff', opacity: 0.3, roughness: 0.05 }, 'opacity 0.3')
  sample(X[1], 2.4, { color: '#3d7fd6', transmission: 0.6, roughness: 0.05 }, 'tinted · transmission 0.6')
  const glass = sample(X[2], 2.4, { color: '#ffffff', transmission: 1, roughness: 0.05 }, 'clear · transmission 1')
  sample(X[3], 2.4, { color: '#ffffff', transmission: 1, roughness: 0.45 }, 'frosted · roughness 0.45')

  // behind: one red metallic paint under coats
  sample(X[0], -1.8, PAINT, 'paint, no coat', true)
  sample(X[1], -1.8, { ...PAINT, clearcoat: 0.5 }, 'clearcoat 0.5', true)
  const coated = sample(X[2], -1.8, { ...PAINT, clearcoat: 1 }, 'clearcoat 1', true)
  sample(X[3], -1.8, { ...PAINT, clearcoat: 1, clearcoatRoughness: 0.35 }, 'satin coat · roughness 0.35', true)

  // ---- controls: the scene's light, and the clear glass and the full coat to try settings on
  let f = gui.addFolder('Scene')
  const lighting = { environment: 'HDR studio' }
  f.add(lighting, 'environment', ['built-in studio', 'HDR studio', 'none']).onChange((v) => {
    scene.environment = v === 'HDR studio' ? hdr : v === 'none' ? 'none' : 'studio'
  })
  f.add(view.controls, 'autoRotate').name('turn')

  f = gui.addFolder('Clear glass')
  const glassStyle = { color: '#ffffff' }
  f.add(glass.material, 'transmission', 0, 1, 0.01)
  f.add(glass.material, 'roughness', 0, 1, 0.01)
  f.add(glass.material, 'opacity', 0, 1, 0.01)
  f.add(glassStyle, 'color', { clear: '#ffffff', blue: '#6fb3ff', green: '#7fe0a0', amber: '#ffc46b' }).onChange((v) => glass.material.color.set(v))

  f = gui.addFolder('Clearcoat')
  const paintStyle = { color: PAINT.color }
  f.add(coated.material, 'clearcoat', 0, 1, 0.01)
  f.add(coated.material, 'clearcoatRoughness', 0, 1, 0.01).name('coat roughness')
  f.add(coated.material, 'roughness', 0, 1, 0.01).name('paint roughness')
  f.add(coated.material, 'metalness', 0, 1, 0.01)
  f.add(paintStyle, 'color', { red: PAINT.color, blue: '#163f8c', green: '#0f5a36', black: '#0c0c0e', white: '#e8e8ea' }).onChange((v) => coated.material.color.set(v))

  return view.start()
}
