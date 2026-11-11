import { View } from 'phoria2'
import { chart } from 'phoria2/charts'

const view = new View({ canvas: '#scene', orbit: true, background: '#1c1c22' })

// a ripple spreading out from a point as t goes on, fading as it goes
const ripple = (r, t, wavelength) => Math.sin((2 * Math.PI / wavelength) * r - 3 * t) / Math.sqrt(1 + r)

const params = { wavelength: 1.6 }
const plot = view.scene.add(chart({
  mark: 'surface',
  // two ripples meeting: with time: true, t is the chart's clock in seconds
  fn: (x, z, { t, wavelength }) => ripple(Math.hypot(x - 1, z), t, wavelength) + ripple(Math.hypot(x + 1, z), t, wavelength),
  x: [-4, 4], z: [-4, 4], y: [-1.6, 1.6], box: [10, 2.5, 10],
  params, time: true, samples: 84,
  color: { field: 'y', scale: { scheme: 'blues' } },
}))

const slider = document.querySelector('input')
slider.addEventListener('input', () => {
  params.wavelength = Number(slider.value)
  plot.update({ params })
})
