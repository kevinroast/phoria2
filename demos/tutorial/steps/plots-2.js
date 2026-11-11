import { View } from 'phoria2'
import { chart } from 'phoria2/charts'

const view = new View({ canvas: '#scene', orbit: true, background: '#1c1c22' })

// params are handed to fn, after the point; y is pinned, so a change shows as the surface moving
const params = { a: 1 }
const plot = view.scene.add(chart({
  mark: 'surface',
  fn: (x, z, { a }) => Math.sin(a * x) * Math.cos(z),
  x: [-3, 3], z: [-3, 3], y: [-1, 1],
  params,
}))

// a new value, and the surface tweens to its new shape
const slider = document.querySelector('input')
slider.addEventListener('input', () => {
  params.a = Number(slider.value)
  plot.update({ params })
})
