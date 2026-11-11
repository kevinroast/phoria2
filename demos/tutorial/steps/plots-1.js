import { View } from 'phoria2'
import { chart } from 'phoria2/charts'

const view = new View({ canvas: '#scene', orbit: true, background: '#1c1c22' })

// a function and the ranges to sample it over, in place of rows of data
view.scene.add(chart({
  mark: 'surface',
  fn: (x, z) => Math.sin(x) * Math.cos(z),
  x: [-3, 3], z: [-3, 3],
}))
