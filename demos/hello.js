import { DirectionalLight, Label, Lines, Mesh, View, box, grid } from 'phoria2'

// The minimal phoria2 scene: a lit, spinning cube on a grid, with a label and orbit controls.
export default function run({ canvas, gui }) {
  const view = new View({ canvas, orbit: true, background: '#e8e8e8', camera: { position: [4, 3, 6] } })
  view.scene.environment = 'studio'

  const cube = view.scene.add(new Mesh({ geometry: box(2), material: { color: 'orange', roughness: 0.4 }, position: [0, 1, 0] }))
  view.scene.add(new Lines({ geometry: grid({ size: 10, divisions: 10 }), material: { color: '#999' } }))
  view.scene.add(new DirectionalLight({ direction: [-1, -2, -1], intensity: 1.5 }))
  view.scene.add(new Label({ text: 'Hello, phoria2', position: [0, 2.6, 0], className: 'demo-label' }))

  const spin = { speed: 0.6 }
  const f = gui.addFolder('Cube')
  f.add(spin, 'speed', 0, 3, 0.1)
  f.add(cube.material, 'roughness', 0, 1, 0.01)
  f.add(cube.material, 'metalness', 0, 1, 0.01)
  f.add(cube.material, 'flatShading')

  return view.start((dt) => cube.rotateY(spin.speed * dt))
}
