import { Label, Lines, Mesh, PointLight, View, grid, sphere } from 'phoria2'

// Material test: a 3x3 grid of spheres - roughness falls left to right, metalness rises bottom to
// top. The studio environment gives the metals something to reflect.
export default function run({ canvas, gui }) {
  const view = new View({ canvas, orbit: true, background: '#1c1c20', camera: { position: [0, 3.5, 13], target: [0, 3.5, 0] } })
  view.scene.environment = 'studio'
  view.scene.add(new Lines({ geometry: grid({ size: 20, divisions: 8 }), material: { color: '#505058' } }))

  const geometry = sphere({ segments: 32, rings: 16 })
  const spheres = []
  for (let x = 0; x < 3; x++) {
    for (let y = 0; y < 3; y++) {
      spheres.push(view.scene.add(new Mesh({
        geometry,
        material: { color: '#e0a050', roughness: 0.8 - x * 0.3, metalness: y * 0.5 },
        position: [(x - 1) * 2.5, 1 + y * 2.5, 0],
      })))
    }
  }
  view.scene.add(new Label({ text: 'roughness 0.8 → 0.2', position: [0, -0.6, 0], className: 'demo-label' }))
  view.scene.add(new Label({ text: 'metalness 0 → 1', position: [-5.6, 3.5, 0], className: 'demo-label' }))

  const light = view.scene.add(new PointLight({ intensity: 60, position: [-3, 7.5, 5] }))
  light.add(new Mesh({ geometry: sphere({ radius: 0.15 }), material: { color: '#ffffff', unlit: true } }))

  let f = gui.addFolder('Scene')
  f.add(view.scene, 'environment', ['studio', 'none'])
  f = gui.addFolder('Light')
  f.add(light.position, 'x', -25, 25, 0.1)
  f.add(light.position, 'y', -25, 25, 0.1)
  f.add(light.position, 'z', -25, 25, 0.1)
  f.add(light.color, '0', 0, 1, 0.01).name('red')
  f.add(light.color, '1', 0, 1, 0.01).name('green')
  f.add(light.color, '2', 0, 1, 0.01).name('blue')
  f.add(light, 'intensity', 0, 150, 1)
  f.add(light, 'range', 0, 50, 0.5)

  return view.start((dt) => { for (const s of spheres) s.rotateY(0.5 * dt) })
}
