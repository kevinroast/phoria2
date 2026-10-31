import { View, Mesh, DirectionalLight, box } from 'phoria2'

const view = new View({ canvas: '#scene', background: '#1c1c22', orbit: true })
view.scene.add(new DirectionalLight({ direction: [-1, -2, -1] }))
const cube = view.scene.add(new Mesh({
  geometry: box(), material: { color: 'tomato' },
}))

view.start((dt) => cube.rotateY(0.6 * dt))
