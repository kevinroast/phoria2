import { View } from 'phoria2'
import { chart } from 'phoria2/charts'

const view = new View({ canvas: '#scene', orbit: true, background: '#1c1c22' })

// hills and hollows - MATLAB's peaks, scaled to within -1 and 1
const peaks = (x, z) => (3 * (1 - x) ** 2 * Math.exp(-(x * x) - (z + 1) ** 2)
  - 10 * (x / 5 - x ** 3 - z ** 5) * Math.exp(-(x * x) - z * z)
  - Math.exp(-((x + 1) ** 2) - z * z) / 3) / 8.5

view.scene.add(chart({
  mark: 'surface', fn: peaks, x: [-3, 3], z: [-3, 3], y: [-1, 1], samples: 64,
  // lines of equal height, on the surface and on the floor beneath it
  contours: { count: 12, place: 'both' },
}))
