import { View, Mesh, DirectionalLight, box, sphere, plane } from 'phoria2'

const view = new View({ canvas: '#scene', background: '#1c1c22', orbit: true })
view.scene.environment = 'studio'
view.scene.add(new DirectionalLight({ direction: [-1, -2, -1], castShadow: true }))
view.scene.add(new Mesh({
  geometry: plane(8), receiveShadow: true,
  material: { color: '#44444f' },
}))
const cube = view.scene.add(new Mesh({
  geometry: box(), position: [-1, 0.5, 0], castShadow: true,
  material: { color: 'tomato', roughness: 0.3 },
}))
view.scene.add(new Mesh({
  geometry: sphere(0.6), position: [1, 0.6, 0], castShadow: true,
  material: { color: 'gold', metalness: 1, roughness: 0.2 },
}))

view.start((dt) => cube.rotateY(0.6 * dt))
