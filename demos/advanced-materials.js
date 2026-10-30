import { Box3, DirectionalLight, Label, Mesh, PointLight, Texture, View, plane, sphere } from 'phoria2'

// Materials beyond roughness and metalness, a row each so the differences show, in pairs from the
// back: glass - opacity fades a surface, reflections too, while transmission lets light through and
// keeps them - and clearcoat, one red metallic paint under no coat, half a coat, a full one and a
// satin one; sheen, the soft bright rim of cloth, and reflectance, how strongly a non-metal reflects
// from its ior; brushed metal, highlights drawn out along the brushing, and translucency - paper
// lanterns lit from inside. Bright stripes behind everything show what the glass lets through.

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
// the rows, in pairs from the back: what each is, and where its middle is
const ROWS = {
  glass: { title: 'Glass', x: -7, z: -6.5 },
  clearcoat: { title: 'Clearcoat', x: 7, z: -6.5 },
  sheen: { title: 'Sheen', x: -7, z: 0 },
  reflectance: { title: 'Reflectance', x: 7, z: 0 },
  brushed: { title: 'Brushed metal', x: -7, z: 6.5 },
  translucency: { title: 'Translucency', x: 7, z: 6.5 },
}
// all of them, and one up close
// wider to the right, clear of the controls
const ALL = { box: [[-12.5, 0, -7.5], [17, 2.6, 8.2]], direction: [0, 1.3, 1], padding: 0.02 }
/** @param {keyof ROWS} key */
const closeUp = (key) => {
  const { x, z } = ROWS[key]
  return { box: [[x - 6, 0, z - 1.2], [x + 9, 2.6, z + 1.8]], direction: [0, 0.75, 1], padding: 0.04 }
}
const PAINT = { color: '#a3121f', metalness: 0.6, roughness: 0.45 }
const CLOTH = { color: '#1f2d6e', roughness: 0.9, sheenColor: '#9fb0ff' }
const ENAMEL = { color: '#1d5c44', roughness: 0.12 }
const STEEL = { color: '#c9ccd2', metalness: 1, roughness: 0.3 }
const PAPER = { color: '#f2e4c4', roughness: 0.8 }

export default function run({ canvas, gui }) {
  const view = new View({ canvas, orbit: true, background: '#121216' })
  const { scene } = view
  // a photographed studio: its windows show as sharp reflections in the glass, the coats and the metal
  const hdr = new Texture({ url: 'hdr/studio_small_09_1k.hdr', colorSpace: 'linear', mipmaps: false })
  scene.environment = hdr
  scene.add(new DirectionalLight({ direction: [0.5, -1, -0.6], intensity: 1.6 }))

  const floor = checks()
  floor.repeat = [20, 12]
  scene.add(new Mesh({ geometry: plane({ width: 40, depth: 24 }), position: [0, 0, 0.5], material: { map: floor, roughness: 0.7 } }))
  const backdrop = stripes()
  backdrop.repeat = [8.75, 1.4]
  scene.add(new Mesh({ name: 'backdrop', geometry: plane({ width: 40, depth: 6 }), rotation: [Math.PI / 2, 0, 0], position: [0, 3, -10.5], material: { map: backdrop, unlit: true } }))

  const ball = sphere({ radius: 1, segments: 48, rings: 32 })
  /** A row's sample spheres, titled over them and captioned in front. @param {keyof ROWS} row @param {[object, string][]} samples */
  const row = (row, samples) => {
    const { title, x, z } = ROWS[row]
    scene.add(new Label({ text: title, position: [x, 2.1, z], place: 'above', className: 'demo-label row-title', overlap: 'show' }))
    return samples.map(([material, caption], i) => {
      scene.add(new Label({ text: caption, position: [x + X[i], 0, z + 1.4], className: 'demo-label sample-caption', overlap: 'show' }))
      return scene.add(new Mesh({ geometry: ball, position: [x + X[i], 1, z], material }))
    })
  }

  // glass - and plain opacity beside it, for the difference
  const [, , glass] = row('glass', [
    [{ color: '#9fd3ff', opacity: 0.3, roughness: 0.05 }, 'opacity 0.3'],
    [{ color: '#3d7fd6', transmission: 0.6, roughness: 0.05 }, 'tinted\ntransmission 0.6'],
    [{ color: '#ffffff', transmission: 1, roughness: 0.05 }, 'clear\ntransmission 1'],
    [{ color: '#ffffff', transmission: 1, roughness: 0.45 }, 'frosted\nroughness 0.45'],
  ])
  // one red metallic paint under coats
  const [, , coated] = row('clearcoat', [
    [PAINT, 'paint\nno coat'],
    [{ ...PAINT, clearcoat: 0.5 }, 'clearcoat 0.5'],
    [{ ...PAINT, clearcoat: 1 }, 'clearcoat 1'],
    [{ ...PAINT, clearcoat: 1, clearcoatRoughness: 0.35 }, 'satin coat\nroughness 0.35'],
  ])
  // velvet: the same blue cloth, bare and with sheens
  const [, cloth] = row('sheen', [
    [CLOTH, 'cloth\nno sheen'],
    [{ ...CLOTH, sheen: 1 }, 'sheen 1'],
    [{ ...CLOTH, sheen: 1, sheenRoughness: 0.15 }, 'sheen 1\nroughness 0.15'],
    [{ ...CLOTH, color: '#4a1028', sheen: 1, sheenColor: '#ffc86b' }, 'gold sheen'],
  ])
  // one green enamel, reflecting more the higher its ior - and not at all with no specular
  const [, , , gem] = row('reflectance', [
    [{ ...ENAMEL, specularIntensity: 0 }, 'no reflections\nspecularIntensity 0'],
    [{ ...ENAMEL, ior: 1.33 }, 'water\nior 1.33'],
    [ENAMEL, 'the default\nior 1.5'],
    [{ ...ENAMEL, ior: 2.4 }, 'diamond\nior 2.4'],
  ])
  // steel, polished and brushed - around the spheres, and turned to run over them
  const [, , brushed] = row('brushed', [
    [STEEL, 'polished'],
    [{ ...STEEL, anisotropy: 0.5 }, 'anisotropy 0.5'],
    [{ ...STEEL, anisotropy: 0.9 }, 'anisotropy 0.9'],
    [{ ...STEEL, anisotropy: 0.9, anisotropyRotation: Math.PI / 2 }, 'turned 90°\nanisotropyRotation'],
  ])
  // paper lanterns, each with a bulb inside: only translucent paper lets its light through
  const lanterns = row('translucency', [
    [PAPER, 'translucency 0'],
    [{ ...PAPER, translucency: 0.5 }, 'translucency 0.5'],
    [{ ...PAPER, translucency: 1 }, 'translucency 1'],
    [{ ...PAPER, translucency: 1, translucencyColor: '#ff8a3c' }, 'orange\ntranslucencyColor'],
  ])
  // range keeps each bulb's light inside its lantern
  const bulbs = lanterns.map((l) => scene.add(new PointLight({ position: [l.position[0], 1, l.position[2]], color: '#ffa04d', intensity: 6, range: 1.3 })))
  const lantern = lanterns[2]

  // ---- the view: everything, or a row up close
  /** @param {{ box: number[][], direction: number[], padding: number }} shot @param {number} [duration] */
  const look = ({ box, direction, padding }, duration = 0) => view.frame(new Box3(box[0], box[1]), { direction, padding, duration })
  look(ALL)

  // ---- controls: the scene's light, and a sample in each row to try settings on
  let f = gui.addFolder('Scene')
  const lighting = { environment: 'HDR studio', show: 'everything', bulbs: 6 }
  f.add(lighting, 'environment', ['built-in studio', 'HDR studio', 'none']).onChange((v) => {
    scene.environment = v === 'HDR studio' ? hdr : v === 'none' ? 'none' : 'studio'
  })
  f.add(view.controls, 'autoRotate').name('turn')
  /** @type {Record<string, any>} */
  const folders = {}
  f.add(lighting, 'show', { everything: 'everything', ...Object.fromEntries(Object.entries(ROWS).map(([key, r]) => [r.title.toLowerCase(), key])) }).onChange((key) => {
    look(key === 'everything' ? ALL : closeUp(key), 0.8)
    for (const [name, folder] of Object.entries(folders)) name === key ? folder.open() : folder.close()
  })

  f = folders.glass = gui.addFolder('Clear glass').close()
  const glassStyle = { color: '#ffffff' }
  f.add(glass.material, 'transmission', 0, 1, 0.01)
  f.add(glass.material, 'roughness', 0, 1, 0.01)
  f.add(glass.material, 'ior', 1, 2.5, 0.01)
  f.add(glass.material, 'opacity', 0, 1, 0.01)
  f.add(glassStyle, 'color', { clear: '#ffffff', blue: '#6fb3ff', green: '#7fe0a0', amber: '#ffc46b' }).onChange((v) => glass.material.color.set(v))

  f = folders.clearcoat = gui.addFolder('Clearcoat').close()
  const paintStyle = { color: PAINT.color }
  f.add(coated.material, 'clearcoat', 0, 1, 0.01)
  f.add(coated.material, 'clearcoatRoughness', 0, 1, 0.01).name('coat roughness')
  f.add(coated.material, 'roughness', 0, 1, 0.01).name('paint roughness')
  f.add(coated.material, 'metalness', 0, 1, 0.01)
  f.add(paintStyle, 'color', { red: PAINT.color, blue: '#163f8c', green: '#0f5a36', black: '#0c0c0e', white: '#e8e8ea' }).onChange((v) => coated.material.color.set(v))

  f = folders.sheen = gui.addFolder('Sheen').close()
  const clothStyle = { color: CLOTH.color, sheenColor: CLOTH.sheenColor }
  f.add(cloth.material, 'sheen', 0, 1, 0.01)
  f.add(cloth.material, 'sheenRoughness', 0, 1, 0.01).name('sheen roughness')
  f.add(clothStyle, 'color', { blue: CLOTH.color, wine: '#4a1028', moss: '#2c4220', charcoal: '#202024' }).onChange((v) => cloth.material.color.set(v))
  f.add(clothStyle, 'sheenColor', { 'pale blue': CLOTH.sheenColor, white: '#ffffff', gold: '#ffc86b', pink: '#ff9ccf' }).name('sheen colour').onChange((v) => cloth.material.sheenColor.set(v))

  f = folders.reflectance = gui.addFolder('Reflectance').close()
  const gemStyle = { specularColor: '#ffffff' }
  f.add(gem.material, 'ior', 1, 3, 0.01)
  f.add(gem.material, 'specularIntensity', 0, 1, 0.01).name('specular')
  f.add(gem.material, 'roughness', 0, 1, 0.01)
  f.add(gemStyle, 'specularColor', { white: '#ffffff', gold: '#ffcf6b', cyan: '#7fe8ff' }).name('specular colour').onChange((v) => gem.material.specularColor.set(v))

  f = folders.brushed = gui.addFolder('Brushed metal').close()
  const brushing = { turn: 0 }
  f.add(brushed.material, 'anisotropy', 0, 1, 0.01)
  f.add(brushing, 'turn', 0, 180, 1).name('turn (degrees)').onChange((v) => { brushed.material.anisotropyRotation = (v * Math.PI) / 180 })
  f.add(brushed.material, 'roughness', 0, 1, 0.01)

  f = folders.translucency = gui.addFolder('Translucency').close()
  const lanternStyle = { light: '#ffffff' }
  f.add(lantern.material, 'translucency', 0, 1, 0.01)
  f.add(lanternStyle, 'light', { white: '#ffffff', orange: '#ff8a3c', red: '#ff4d4d', green: '#7dff8a' }).name('colour through').onChange((v) => lantern.material.translucencyColor.set(v))
  f.add(lighting, 'bulbs', 0, 30, 0.1).name('bulbs').onChange((v) => { for (const b of bulbs) b.intensity = v })

  return view.start()
}
