import { View } from 'phoria2'
import { chart } from 'phoria2/charts'

// an isometric camera looks down on the plane, fitted to what's there
const view = new View({ canvas: '#scene', orbit: true, background: '#1c1c22', camera: 'isometric' })

// a vector field: fn gives a direction at each point - here, everything turning round the middle,
// faster further out - drawn as arrows coloured by their strength
view.scene.add(chart({
  mark: 'vector',
  fn: (x, y, z) => [-z, 0, x],
  x: [-2, 2], z: [-2, 2], samples: 11,
  // axes through zero, as on a blackboard
  frame: 'origin', legend: false,
}))
