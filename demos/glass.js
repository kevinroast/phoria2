import { Geometry, HemisphereLight, Mesh, RectAreaLight, View, box, cylinder, extrude, lathe, plane, sphere } from 'phoria2'

// A glass still life on a photographer's sweep, each piece the glass it would be made of: a dense
// flint prism and a cut gem whose hard facet edges split what they bend into rainbow fringes
// (dispersion), an iridescent amber pear, and two thin-walled vessels - a bell jar over a brass ball
// and a lead crystal tumbler, their far sides showing through their near ones. The solid pieces bend
// what is behind them by their ior through their thickness; the vessels' walls shift it a little, as
// panes do; the tinted ones tint deeper where there is more glass. The softbox throws their coloured light on the floor rather than grey
// shadows. Bold stripes on the backdrop give the bending and the fringes something to show against;
// still, the picture refines - the fringes settling into smooth rainbows, the softbox's shadows
// exact - and the lens can soften what is out of focus.

/**
 * A photographer's sweep: flat from `at` (z) back, curving up through a quarter circle into a wall.
 * @param {{ width: number, radius: number, height: number, at: number }} o
 */
function sweep({ width, radius, height, at }) {
  /** @type {[number, number, number, number][]} y, z and the normal's y, z along the profile */
  const profile = []
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI / 2
    profile.push([radius - radius * Math.cos(a), at - radius * Math.sin(a), Math.cos(a), Math.sin(a)])
  }
  profile.push([height, at - radius, 0, 1])
  const positions = [], normals = [], indices = []
  for (const [y, z, ny, nz] of profile) {
    for (const x of [-width / 2, width / 2]) {
      positions.push(x, y, z)
      normals.push(0, ny, nz)
    }
  }
  for (let i = 0; i < profile.length - 1; i++) {
    const a = i * 2
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  return new Geometry({ positions, normals, indices })
}

/**
 * A mesh moved so it stands on the floor - or on something `on` high - as turned, centred on (x, z).
 * @param {Mesh} mesh @param {number} x @param {number} z @param {number} [on]
 */
function standOnFloor(mesh, x, z, on = 0) {
  // its points as turned - not its turned box, whose corners stand off a round thing
  mesh.position.set(0, 0, 0)
  mesh.updateWorld()
  const m = mesh.worldMatrix, p = mesh.geometry.positions
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = m[k] * p[i] + m[4 + k] * p[i + 1] + m[8 + k] * p[i + 2]
      lo[k] = Math.min(lo[k], v)
      hi[k] = Math.max(hi[k], v)
    }
  }
  mesh.position.set(x - (lo[0] + hi[0]) / 2, on - lo[1], z - (lo[2] + hi[2]) / 2)
  return mesh
}

export default function run({ canvas, gui }) {
  const view = new View({
    canvas, background: '#0b0c10',
    camera: { position: [0.3, 1.8, 4.4], target: [0, 0.5, -1.5], fov: 40 },
    orbit: { minDistance: 2.5, maxDistance: 12, minPitch: 0.05, maxPitch: 1.2 },
    // the softbox's face and the glints off the facets glow; the lit floor doesn't
    bloom: { strength: 0.35, radius: 0.6, threshold: 1.6 },
    // still, the picture refines: dispersion's fringes average into rainbows, the shadows exact
    refine: true,
  })
  const scene = view.scene
  // the studio's light all round, for the glass to reflect - kept low, the softbox is the key
  scene.environment = 'studio'
  scene.environmentIntensity = 0.7

  const settings = { place: 0, turn: false, aperture: 0, focus: 0 }

  // the set: a pale floor, satin, so the coloured light reads on it - and behind, a sweep printed with
  // bold black and white stripes, for the glass to bend and split. The stripes are a few lines of
  // shader hook, antialiased by how fast they change across a pixel (fwidth)
  scene.add(new Mesh({ geometry: plane({ width: 14, depth: 9 }), position: [0, 0, 1.5], receiveShadow: true,
    material: { color: '#bdb9b2', roughness: 0.45 } }))
  scene.add(new Mesh({ geometry: sweep({ width: 14, radius: 1.6, height: 7, at: -3 }), receiveShadow: true,
    material: { color: '#f2f0ec', roughness: 0.85, shader: { fragment: `float k = sin(vWorldPosition.x * 9.0 + vWorldPosition.y * 4.0 - vWorldPosition.z * 3.0);
float w = fwidth(k);
base.rgb *= mix(0.05, 1.0, smoothstep(-w, w, k));` } } }))

  // Each piece as the glass it would be: its ior, how much it splits colours (dispersion, 20 over
  // its Abbe number), how smooth it is and what tints its body. Polished unless said otherwise
  /** @type {Mesh[]} */
  const pieces = []
  const piece = (/** @type {Mesh} */ mesh) => {
    mesh.castShadow = true
    mesh.receiveShadow = true
    scene.add(mesh)
    pieces.push(mesh)
    return mesh
  }

  // a prism in dense flint glass, the glass of optical prisms - high ior, and colours split by about
  // twice as much as window glass (Abbe 25.8). On end, its faces flat: three tall hard edges against
  // the stripes, splitting what they bend
  piece(standOnFloor(new Mesh({ geometry: extrude({ shape: [[-0.4, -0.23], [0.4, -0.23], [0, 0.46]], depth: 1.3, axis: 'y' }),
    material: { transmission: 1, roughness: 0.02, ior: 1.78, dispersion: 0.78, thickness: 1.2, flatShading: true }, rotation: [0, 0.4, 0] }), -2.5, -1.5))
  // a cut gem, a round brilliant in synthetic rutile - more fire than diamond, five times its spread
  // of colours (Abbe about 10), and a higher ior still. A lathe with few sides and flat shading makes
  // its facets; tilted towards the camera on a black velvet block, so they bend the stripes and the
  // dark velvet - the contrast its fringes need
  const plinth = scene.add(new Mesh({ geometry: box({ width: 0.8, height: 0.42, depth: 0.8 }), position: [-1.25, 0.21, -1.5], castShadow: true, receiveShadow: true,
    material: { color: '#131316', roughness: 0.95 } }))
  const gem = [[0, 0], [0.46, 0.4], [0.5, 0.44], [0.5, 0.47], [0.3, 0.64], [0, 0.64]]
  piece(standOnFloor(new Mesh({ geometry: lathe({ points: gem, segments: 16 }), rotation: [0.55, 0.2, 0],
    material: { transmission: 1, roughness: 0.01, ior: 2.61, dispersion: 2, thickness: 1.1, flatShading: true } }), plinth.position[0], plinth.position[2], 0.42))
  // a pear in art glass: smooth soda-lime, amber-bodied - deeper where it is fuller - under a thin
  // iridescent film, the picture that started all this. A brown stem in its top
  const pear = [[0, 0], [0.16, 0.02], [0.33, 0.13], [0.41, 0.3], [0.38, 0.5], [0.27, 0.68], [0.19, 0.84], [0.15, 0.98], [0.1, 1.08], [0, 1.12]]
  const pearMesh = piece(standOnFloor(new Mesh({ geometry: lathe({ points: pear, segments: 64 }),
    material: { transmission: 1, roughness: 0.02, ior: 1.52, thickness: 0.8, attenuationColor: '#e8a83a', attenuationDistance: 0.9, iridescence: 0.55, iridescenceThickness: 520 } }), 0, -1.5))
  pearMesh.add(new Mesh({ geometry: cylinder({ radius: 0.025, height: 0.22, segments: 8 }), position: [0.02, 1.18, 0], rotation: [0, 0, -0.25],
    material: { color: '#4a3020', roughness: 0.7 }, castShadow: true }))
  // The vessels are walls of glass, not solids: one surface each, open-ended, thin-walled - what is
  // behind shifts a little as through a pane, and the wall tints deepest seen edge-on - and
  // double-sided, so the far side shows through the near one
  // a bell jar on a wooden base, over a polished brass ball: clear soda-lime a few millimetres thick,
  // faintly green where its wall is seen edge-on, as window glass is. Open at the bottom, a knob on top.
  // (What it covers is solid: glass under glass shows only what is behind both)
  const base = scene.add(new Mesh({ geometry: cylinder({ radius: 0.5, height: 0.06, segments: 48 }), position: [1.25, 0.03, -1.5], castShadow: true, receiveShadow: true,
    material: { color: '#7a5636', roughness: 0.55 } }))
  scene.add(new Mesh({ geometry: sphere({ radius: 0.2, segments: 48 }), position: [base.position[0], 0.26, base.position[2]], castShadow: true, receiveShadow: true,
    material: { color: '#e0b25a', metalness: 1, roughness: 0.12 } }))
  const jar = [[0.42, 0], [0.42, 0.52], [0.4, 0.68], [0.33, 0.8], [0.2, 0.87], [0.07, 0.9], [0.05, 0.95], [0.08, 0.99], [0.07, 1.03], [0, 1.04]]
  piece(standOnFloor(new Mesh({ geometry: lathe({ points: jar, segments: 64 }),
    material: { transmission: 1, roughness: 0.02, ior: 1.52, thickness: 0.012, thinWalled: true, doubleSided: true, attenuationColor: '#e2f4e8', attenuationDistance: 0.04 } }), base.position[0], base.position[2], 0.06))
  // a tumbler in cut lead crystal: twelve flat sides, a little more ior and fire than plain glass (Abbe
  // about 44), with a subtle green to it
  // (its underside domed a little, as a glass's is: it stands on the ring of its foot, not flat on the floor)
  const tumbler = [[0, 0.015], [0.27, 0.004], [0.3, 0], [0.33, 0.05], [0.36, 0.62]]
  piece(standOnFloor(new Mesh({ geometry: lathe({ points: tumbler, segments: 12 }),
    material: { transmission: 1, roughness: 0.02, ior: 1.56, dispersion: 0.45, thickness: 0.03, thinWalled: true, doubleSided: true, flatShading: true, attenuationColor: '#b4dcb8', attenuationDistance: 0.06 } }), 2.5, -1.5))

  // a little light from all round, so nothing is quite black
  scene.add(new HemisphereLight({ sky: '#9aa4b8', ground: '#2a2826', intensity: 0.15 }))
  // the key: a softbox high to the left and in front, casting the glass's coloured light back across
  // the floor - drawn as its glowing face, for the facets to catch
  const key = scene.add(new RectAreaLight({ color: '#fff4e6', intensity: 20, castShadow: true }))
  const keyPanel = scene.add(new Mesh({ geometry: new Geometry({ positions: [], indices: [] }), castShadow: false, receiveShadow: false, pickable: false,
    material: { color: '#000000', emissive: '#fff4e6', emissiveIntensity: 7, doubleSided: true } }))
  const placeKey = () => {
    const a = 2.2 + settings.place * 0.6
    key.position.set(Math.cos(a) * 3.4, 3.4, Math.sin(a) * -3.4 + 0.6)
    key.target = [0, 0.3, -1.5]
    key.width = 1.6
    key.height = 0.96
    scene.updateWorldTree()
    const [hw, hh] = key.worldEdges, p = key.worldPosition
    const at = (/** @type {number} */ s, /** @type {number} */ t) => [0, 1, 2].map((i) => p[i] + hw[i] * s + hh[i] * t)
    keyPanel.geometry = new Geometry({ positions: [...at(1, -1), ...at(-1, -1), ...at(-1, 1), ...at(1, 1)], indices: [0, 1, 2, 0, 2, 3] })
  }

  const l = gui.addFolder('Softbox')
  l.add(settings, 'place', -1, 1, 0.01).name('position').onChange(placeKey)
  gui.add(settings, 'turn').name('turn the pieces')
  gui.add({ refine: true }, 'refine').name('refine when still').onChange((on) => { view.refine = on })
  // depth of field, shown as the picture refines: the lens's radius, and the focus nearer or further
  // than the orbit's pivot
  const camera = /** @type {import('phoria2').PerspectiveCamera} */ (view.camera)
  const lens = gui.addFolder('Lens (refined)').close()
  lens.add(settings, 'aperture', 0, 0.2, 0.005).name('aperture').onChange((v) => { camera.aperture = v })
  lens.add(settings, 'focus', -3, 3, 0.05).name('focus from pivot')
  placeKey()

  return view.start((dt) => {
    const pivot = camera.target ? camera.position.distanceTo(camera.target) : 10
    const focus = settings.focus ? Math.max(0.2, pivot + settings.focus) : null
    if (camera.focusDistance !== focus) camera.focusDistance = focus
    if (settings.turn) for (const mesh of pieces) mesh.rotation.y += dt * 0.3
  })
}
