import { Group, Lines, Mesh, PointLight, View, box, edges, grid, sphere } from 'phoria2'

// Coloured point lights orbiting a cube with a bobbing child cube - children inherit their
// parent's transform.
export default function run({ canvas, gui }) {
  const view = new View({ canvas, orbit: true, background: '#1c1c20', camera: { position: [0, 5, 15] } })
  view.scene.add(new Lines({ geometry: grid({ size: 20, divisions: 16 }), material: { color: '#505058' } }))

  const cube = view.scene.add(new Mesh({ geometry: box(2), material: { color: '#ffffff', roughness: 0.5 }, position: [0, 1, 0] }))
  // the child's position is relative to the cube, so it turns with it as well
  const child = cube.add(new Lines({ geometry: edges(box(1)), material: { color: '#ffffff' } }))

  // each light rides on a pivot at the origin, with a small unlit bulb to show where it is
  const bulb = sphere({ radius: 0.15 })
  const lights = [
    { color: '#0000ff', z: -5, speed: 1 },
    { color: '#ff0000', z: 5, speed: 0.5 },
    { color: '#00ff00', z: 5, speed: 1.5 },
  ].map(({ color, z, speed }) => {
    const pivot = view.scene.add(new Group())
    const light = pivot.add(new PointLight({ color, intensity: 30, position: [0, 2.5, z] }))
    light.add(new Mesh({ geometry: bulb, material: { color, unlit: true } }))
    return { pivot, light, speed }
  })

  const settings = { speed: 1, intensity: 30, range: 0 }
  let f = gui.addFolder('Lights')
  f.add(settings, 'speed', 0, 3, 0.1)
  f.add(settings, 'intensity', 0, 100, 1)
  f.add(settings, 'range', 0, 20, 0.5)
  f = gui.addFolder('Cube')
  f.add(cube.material, 'roughness', 0, 1, 0.01)
  f.add(cube.material, 'metalness', 0, 1, 0.01)
  f.add(cube.material, 'flatShading')

  return view.start((dt, t) => {
    cube.rotateY(0.5 * dt)
    child.position.y = Math.sin(t) + 3
    for (const { pivot, light, speed } of lights) {
      pivot.rotateY(speed * settings.speed * dt)
      pivot.position.y = Math.sin(t * 2)
      light.intensity = settings.intensity
      light.range = settings.range
    }
  })
}
