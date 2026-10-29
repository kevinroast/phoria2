import { View } from 'phoria2'
import { chart } from 'phoria2/charts'
import { random, showSpec } from './kit.js'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Service latency as a surface over hour of day and day of week, coloured by height. A new week
// of data tweens the whole surface; hovering reads off the nearest grid point.
export default function run({ canvas, gui, info }) {
  const rand = random(13)
  const week = () => DAYS.flatMap((day, d) => Array.from({ length: 24 }, (_, hour) => {
    // busy working hours, a heavier Monday morning, quiet weekends, and a little noise
    const work = Math.exp(-((hour - 14) ** 2) / 18) * (d < 5 ? 1 : 0.35)
    const monday = d === 0 ? Math.exp(-((hour - 9) ** 2) / 4) * 0.6 : 0
    return { day, hour, latency: Math.round(40 + 160 * work + 120 * monday + rand() * 25) }
  }))

  const view = new View({ canvas, orbit: true, background: '#16171c', camera: 'perspective' })
  const settings = { scheme: 'heat' }
  const spec = (scheme) => ({
    color: { field: 'latency', title: 'Latency (ms)', scale: { scheme } },
  })
  const surface = view.scene.add(chart({
    mark: 'surface', data: week(),
    x: { field: 'hour', title: 'Hour of day' }, z: { field: 'day', title: 'Day' }, y: { field: 'latency', title: 'Latency (ms)' },
    ...spec(settings.scheme),
    tooltip: ['day', 'hour', 'latency'], legend: { position: 'bottom-right' }, transition: { duration: 0.8 },
  }))

  info.textContent = 'Hover the surface to read off a value'
  gui.add({ next: () => surface.update(week()) }, 'next').name('next week')
  gui.add(settings, 'scheme', ['heat', 'viridis', 'cool', 'blues']).onChange((scheme) => surface.update(spec(scheme)))
  showSpec(gui, surface)
  return view
}
