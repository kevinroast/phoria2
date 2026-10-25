import { DirectionalLight, Group, Lines, Mesh, Points, View, box, edges, grid } from 'phoria2'

// A lit cube spinning on a grid - the minimal scene. v1's draw modes are now separate objects:
// the solid mesh, its edges() as Lines and its vertices as Points, shown or hidden independently.
export default function run({ canvas, gui }) {
  const view = new View({ canvas, orbit: true, background: '#eeeeee', camera: { position: [0, 5, 15] } })
  view.scene.add(new Lines({ geometry: grid({ size: 20, divisions: 8 }), material: { color: '#aaaaaa' } }))
  view.scene.add(new DirectionalLight({ direction: [0, -0.5, -1], intensity: 1.5 }))

  const geometry = box(2)
  const cube = view.scene.add(new Group({ position: [0, 1, 0] }))
  const solid = cube.add(new Mesh({ geometry, material: { color: '#808080' } }))
  const wire = cube.add(new Lines({ geometry: edges(geometry), material: { color: '#222222', width: 2 }, visible: false }))
  const dots = cube.add(new Points({ geometry, material: { color: '#222222', size: 8, sizeAttenuation: false }, visible: false }))

  const f = gui.addFolder('Rendering')
  f.add(solid, 'visible').name('solid')
  f.add(wire, 'visible').name('edges')
  f.add(dots, 'visible').name('points')
  f.add(solid.material, 'unlit')
  f.add(solid.material, 'flatShading')
  f.add(solid.material, 'opacity', 0, 1, 0.01)

  return view.start((dt) => cube.rotateY(0.5 * dt))
}
