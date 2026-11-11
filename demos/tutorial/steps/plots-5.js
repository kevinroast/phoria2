import { View } from 'phoria2'
import { chart } from 'phoria2/charts'

const view = new View({ canvas: '#scene', orbit: true, background: '#1c1c22' })
view.scene.environment = 'studio'

// both charts over the same ranges, so they share one box and line up
const cube = { x: [-1.6, 1.6], y: [-1.6, 1.6], z: [-1.6, 1.6], frame: false, legend: false }

// a parametric surface - [x, y, z] from u and v - folds back on itself: a torus
const torus = (u, v, r = 0.28) => [(1 + r * Math.cos(v)) * Math.cos(u), r * Math.sin(v), (1 + r * Math.cos(v)) * Math.sin(u)]
view.scene.add(chart({ mark: 'surface', fn: (u, v) => torus(u, v), u: [0, 2 * Math.PI], v: [0, 2 * Math.PI], ...cube }))

// a curve - [x, y, z] from t - winding round it: a trefoil knot, just off its surface
view.scene.add(chart({
  mark: 'curve', fn: (t) => torus(2 * t, 3 * t, 0.34), t: [0, 2 * Math.PI], samples: 400,
  color: '#ffffff', size: 3, ...cube,
}))
