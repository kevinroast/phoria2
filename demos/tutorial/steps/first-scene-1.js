import { View, Mesh, box } from 'phoria2'

const view = new View({ canvas: '#scene', background: '#1c1c22' })
view.scene.add(new Mesh({ geometry: box(), material: { color: 'tomato' } }))
