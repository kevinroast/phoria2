import { DirectionalLight, Group, Lines, Mesh, Points, View, cylinder, edges, fromPolygons } from 'phoria2'
import { cobra } from './data/cobra.js'
import { head } from './data/head.js'
import { teapot } from './data/teapot.js'

// Hand-made models: raw points and polygons, as v1 models were written, turned into geometry by
// fromPolygons() - faceted (low-poly, like the head and the Cobra), or smooth where the points are
// shared. Each is scaled to a common size and stood on a plinth in an HDR studio. One geometry can
// be drawn three ways at once: solid (a Mesh), as its edges (Lines of edges()) and as its vertices
// (Points) - each shown, hidden or made see-through on its own.
const MODELS = {
  teapot: { data: teapot, smooth: true, material: { color: '#f2ede4', roughness: 0.15 } },
  head: { data: head, smooth: false, material: { color: '#d8a47f', roughness: 0.6 } },
  cobra: { data: cobra, smooth: false, material: { color: '#c8cad2', roughness: 0.3, metalness: 0.75 } },
}
const FINISHES = {
  'its own': null,
  porcelain: { color: '#f4f1ea', roughness: 0.12, metalness: 0 },
  chrome: { color: '#eceef2', roughness: 0.06, metalness: 1 },
  gold: { color: '#f4c24d', roughness: 0.22, metalness: 1 },
  'matte clay': { color: '#b86f50', roughness: 0.95, metalness: 0 },
}

export default function run({ canvas, gui }) {
  const view = new View({ canvas, orbit: true, background: '#17171b', camera: { position: [3.2, 2.2, 4.8] } })
  view.scene.environment = 'hdr/studio_small_09_1k.hdr'
  view.scene.add(new DirectionalLight({ direction: [-0.6, -1, -0.5], intensity: 1.2, castShadow: true }))
  view.scene.add(new Mesh({ geometry: cylinder({ radius: 1.7, height: 0.16, segments: 96 }), material: { color: '#a8a39c', roughness: 0.6 }, position: [0, -0.08, 0], receiveShadow: true }))

  const settings = { model: 'teapot', finish: 'its own', smooth: true, solid: true, edges: true, points: true, opacity: 0.6, spin: 0.2 }
  // models are centred on a turntable, so spinning it turns them about their middle
  const turntable = view.scene.add(new Group())
  const show = () => {
    turntable.remove(...turntable.children)
    const { data, material } = MODELS[settings.model]
    const geometry = fromPolygons({ ...data, smooth: settings.smooth })
    // scale to about 2 units across, standing on the plinth
    const box = geometry.bounds, s = 2 / (box.getRadius() || 1), c = box.getCenter()
    const model = turntable.add(new Group({ scale: s, position: [-c.x * s, -box.min[1] * s, -c.z * s] }))
    const finish = FINISHES[settings.finish] ?? material
    model.add(new Mesh({ geometry, material: { ...finish, opacity: settings.opacity }, visible: settings.solid, castShadow: true }))
    model.add(new Lines({ geometry: edges(geometry), material: { color: settings.solid ? '#000000' : '#7fd1ff', opacity: settings.solid ? 0.35 : 1 }, visible: settings.edges }))
    model.add(new Points({ geometry, material: { color: '#ffb347', size: 4, sizeAttenuation: false }, visible: settings.points }))
  }
  const pick = () => {
    settings.smooth = MODELS[settings.model].smooth
    gui.updateDisplay()
    show()
    // the model and its plinth
    view.frame(view.scene, { padding: 0.25 })
  }
  pick()

  const f = gui.addFolder('Model')
  f.add(settings, 'model', Object.keys(MODELS)).onChange(pick)
  f.add(settings, 'finish', Object.keys(FINISHES)).onChange(show)
  f.add(settings, 'smooth').onChange(show)
  f.add(settings, 'spin', 0, 2, 0.05)
  const d = gui.addFolder('Draw as')
  d.add(settings, 'solid').onChange(show)
  d.add(settings, 'edges').onChange(show)
  d.add(settings, 'points').onChange(show)
  d.add(settings, 'opacity', 0.1, 1, 0.05).name('see-through').onChange(show)

  return view.start((dt) => turntable.rotateY(settings.spin * dt))
}
