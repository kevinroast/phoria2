import { DirectionalLight, Group, Lines, Mesh, View, edges, fromPolygons, grid } from 'phoria2'
import { cobra } from './data/cobra.js'
import { head } from './data/head.js'
import { teapot } from './data/teapot.js'

// Hand-made models: raw points and polygons, as v1 models were written, turned into geometry by
// fromPolygons() - faceted, or smooth where the points are shared. Each is scaled to a common size.
const MODELS = {
  teapot: { data: teapot, smooth: true, material: { color: '#e8e0d0', roughness: 0.25 } },
  head: { data: head, smooth: false, material: { color: '#d0a080', roughness: 0.7 } },
  cobra: { data: cobra, smooth: false, material: { color: '#c8cad2', roughness: 0.35, metalness: 0.7 } },
}

export default function run({ canvas, gui }) {
  const view = new View({ canvas, orbit: true, background: '#1c1c20', camera: { position: [3, 2.5, 5] } })
  view.scene.environment = 'studio'
  view.scene.add(new DirectionalLight({ direction: [-1, -1.5, -1], intensity: 1.2 }))
  view.scene.add(new Lines({ geometry: grid({ size: 10, divisions: 10 }), material: { color: '#3a3a40' } }))

  const settings = { model: 'teapot', smooth: true, edges: false, spin: 0.4 }
  // models are centred on a turntable, so spinning it turns them about their middle
  const turntable = view.scene.add(new Group())
  const show = () => {
    turntable.remove(...turntable.children)
    const { data, material } = MODELS[settings.model]
    const geometry = fromPolygons({ ...data, smooth: settings.smooth })
    // scale to about 2 units across, sitting on the grid
    const box = geometry.bounds, s = 2 / (box.getRadius() || 1), c = box.getCenter()
    const model = turntable.add(new Mesh({ geometry, material, scale: s, position: [-c.x * s, -box.min[1] * s, -c.z * s] }))
    model.add(new Lines({ geometry: edges(geometry), material: { color: '#000000', opacity: 0.4 }, visible: settings.edges }))
    view.frame(model, { padding: 1.4 })
  }
  const pick = () => {
    settings.smooth = MODELS[settings.model].smooth
    gui.updateDisplay()
    show()
  }
  show()

  const f = gui.addFolder('Model')
  f.add(settings, 'model', Object.keys(MODELS)).onChange(pick)
  f.add(settings, 'smooth').onChange(show)
  f.add(settings, 'edges').onChange(show)
  f.add(settings, 'spin', 0, 2, 0.05)

  return view.start((dt) => turntable.rotateY(settings.spin * dt))
}
