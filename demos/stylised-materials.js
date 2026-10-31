import { Box3, DirectionalLight, HemisphereLight, Label, Mesh, Texture, View, icosphere, lathe, plane, sphere, torus } from 'phoria2'

// Looks that aren't meant to be real, on the same four shapes, a row each: lit, for comparison; matcap,
// where a picture of a lit sphere gives the whole look - clay, red wax, a painted ball, chrome - with no
// lights; and toon, the lit row's materials in flat tones with a hard highlight, inked round with outlines.

/**
 * A matcap drawn on a canvas: a lit sphere filling it.
 * @param {(g: CanvasRenderingContext2D, size: number) => void} paint
 */
function matcap(paint) {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  paint(/** @type {CanvasRenderingContext2D} */ (c.getContext('2d')), 256)
  return new Texture({ image: c })
}

/** A soft sphere lit from the top left: its colours from the light to the rim. @param {[number, string][]} stops */
const softBall = (stops) => matcap((g, s) => {
  const light = g.createRadialGradient(s * 0.36, s * 0.3, 0, s * 0.45, s * 0.42, s * 0.62)
  for (const [at, colour] of stops) light.addColorStop(at, colour)
  g.fillStyle = light
  g.fillRect(0, 0, s, s)
})

const MATCAPS = {
  clay: softBall([[0, '#f6eee4'], [0.35, '#cdbca9'], [0.8, '#83725f'], [1, '#3e342c']]),
  'red wax': softBall([[0, '#ffffff'], [0.07, '#ff9c8f'], [0.3, '#d2342c'], [0.8, '#621010'], [1, '#2a0505']]),
  // a painted ball: flat bands with hard edges, and a dab of white
  painted: matcap((g, s) => {
    for (const [r, x, y, colour] of [[0.75, 0.5, 0.5, '#1c5a52'], [0.42, 0.44, 0.42, '#2f9c8c'], [0.24, 0.38, 0.34, '#74d8c6'], [0.06, 0.33, 0.28, '#ffffff']]) {
      g.fillStyle = /** @type {string} */ (colour)
      g.beginPath()
      g.arc(/** @type {number} */ (x) * s, /** @type {number} */ (y) * s, /** @type {number} */ (r) * s, 0, Math.PI * 2)
      g.fill()
    }
  }),
  // chrome: a bright sky over a dark ground, meeting at a hard horizon, darker towards the rim
  chrome: matcap((g, s) => {
    const sky = g.createLinearGradient(0, 0, 0, s)
    /** @type {[number, string][]} */
    const stops = [[0, '#f4f8ff'], [0.46, '#9db6d6'], [0.5, '#3a3029'], [0.66, '#75624f'], [1, '#18130f']]
    for (const [at, colour] of stops) sky.addColorStop(at, colour)
    g.fillStyle = sky
    g.fillRect(0, 0, s, s)
    const rim = g.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s * 0.5)
    rim.addColorStop(0, 'rgba(0, 0, 0, 0)')
    rim.addColorStop(1, 'rgba(0, 0, 0, 0.55)')
    g.fillStyle = rim
    g.fillRect(0, 0, s, s)
    g.fillStyle = '#ffffff'
    g.beginPath()
    g.ellipse(s * 0.36, s * 0.26, s * 0.07, s * 0.04, -0.5, 0, Math.PI * 2)
    g.fill()
  }),
}

const X = [-4.5, -1.5, 1.5, 4.5]
const ROWS = { lit: { title: 'Basic surface', z: -5 }, matcap: { title: 'Matcap', z: 0 }, toon: { title: 'Toon', z: 5 } }
// the four columns' colours, lit and toon
const PAINTS = [
  { color: '#e4572e', roughness: 0.35 },
  { color: '#29a3a3', roughness: 0.3 },
  { color: '#6c5ce7', roughness: 0.4 },
  { color: '#e0a526', metalness: 1, roughness: 0.3 },
]
const INK = '#1b1b20'

export default function run({ canvas, gui }) {
  const view = new View({ canvas, orbit: true, background: '#efe9dd', camera: { fov: 28 } })
  const { scene } = view
  scene.environment = 'studio'
  const sun = scene.add(new DirectionalLight({ direction: [0.85, -0.75, -0.25], intensity: 1.5, castShadow: true }))
  // a warm fill from all round: what the toon shapes' shaded tone is, so it reads as shade, not black
  scene.add(new HemisphereLight({ sky: '#fff4e0', ground: '#d8cbb5', intensity: 0.45 }))
  scene.add(new Mesh({ geometry: plane({ width: 40, depth: 26 }), material: { color: '#e3dccd', roughness: 0.9 }, receiveShadow: true }))

  // the same four shapes in every row: a ball, an upright ring, a vase and a cut gem
  const vase = [[0, 0], [0.55, 0], [0.7, 0.3], [0.85, 0.85], [0.62, 1.45], [0.38, 1.8], [0.46, 2.05], [0.4, 2.1], [0, 2.1]]
  const SHAPES = [
    { geometry: sphere({ radius: 1, segments: 48, rings: 32 }), y: 1 },
    { geometry: torus({ radius: 0.72, tube: 0.32, segments: 64, tubeSegments: 24 }), y: 1.05, rotation: [Math.PI / 2, 0, 0] },
    { geometry: lathe({ points: vase, segments: 48 }), y: 0 },
    { geometry: icosphere({ radius: 1, detail: 1 }), y: 1, flat: true },
  ]

  /** A row of the four shapes, titled and captioned. @param {keyof typeof ROWS} row @param {[object, string][]} samples */
  const row = (row, samples) => {
    const { title, z } = ROWS[row]
    scene.add(new Label({ text: title, position: [0, 2.4, z], place: 'above', className: 'demo-label row-title', overlap: 'show' }))
    return samples.map(([material, caption], i) => {
      const { geometry, y, rotation = [0, 0, 0], flat } = SHAPES[i]
      const label = scene.add(new Label({ text: caption, position: [X[i], 0, z + 1.45], className: 'demo-label sample-caption', overlap: 'show' }))
      const mesh = scene.add(new Mesh({ geometry, position: [X[i], y, z], rotation, material: { ...material, flatShading: !!flat }, castShadow: true }))
      // the caption goes with it, to follow the controls
      mesh.userData.caption = label
      return mesh
    })
  }

  const lit = row('lit', PAINTS.map((p, i) => [p, ['roughness 0.35', 'roughness 0.3', 'roughness 0.4', 'gold\nmetalness 1'][i]]))
  const matcaps = row('matcap', Object.entries(MATCAPS).map(([name, map]) => [{ matcap: map }, name]))
  const TONES = [2, 3, 4, 3]
  const toons = row('toon', PAINTS.map((p, i) => [{ ...p, toon: TONES[i] }, i === 3 ? 'toon 3\ngold metal' : `toon ${TONES[i]}`]))
  for (const mesh of toons) mesh.outline = { color: INK, width: 2 }

  // ---- the view: everything, clear of the controls on the right
  view.frame(new Box3([-6.5, 0, -6], [9, 2.6, 6.8]), { direction: [0, 1.2, 1], padding: 0.03 })

  // ---- controls: the light, and each row's own settings
  let f = gui.addFolder('Scene')
  const settings = { light: 0, matcap: 'per shape', tones: 3, outlines: true, ink: 2 }
  f.add(settings, 'light', -180, 180, 1).name('light (degrees)').onChange((deg) => {
    const a = (deg * Math.PI) / 180, x = 0.85, z = -0.25
    sun.direction = [x * Math.cos(a) - z * Math.sin(a), -0.75, x * Math.sin(a) + z * Math.cos(a)]
  })
  f.add(sun, 'intensity', 0, 3, 0.01).name('light strength')
  f.add(view.controls, 'autoRotate').name('turn')

  f = gui.addFolder('Matcap')
  f.add(settings, 'matcap', ['per shape', ...Object.keys(MATCAPS)]).name('picture').onChange((name) => {
    const names = Object.keys(MATCAPS)
    matcaps.forEach((m, i) => {
      const picture = name === 'per shape' ? names[i] : name
      m.material.matcap = MATCAPS[picture]
      m.userData.caption.text = picture
    })
  })

  f = gui.addFolder('Toon')
  f.add(settings, 'tones', 2, 8, 1).onChange((n) => {
    toons.forEach((m, i) => {
      m.material.toon = n
      m.userData.caption.text = i === 3 ? `toon ${n}\ngold metal` : `toon ${n}`
    })
  })
  f.add(settings, 'outlines').onChange((on) => { for (const m of toons) m.outline = on ? { color: INK, width: settings.ink } : null })
  f.add(settings, 'ink', 0.5, 6, 0.5).name('outline width').onChange((w) => { if (settings.outlines) for (const m of toons) m.outline = { color: INK, width: w } })
  // the lit row follows the tones' surfaces, so the two compare like for like
  f.add(toons[1].material, 'roughness', 0, 1, 0.01).name('ring roughness').onChange((r) => { lit[1].material.roughness = r })

  return view.start()
}
