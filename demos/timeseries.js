import { View } from 'phoria2'
import { chart } from 'phoria2/charts'
import { random, showSpec } from './kit.js'

const CHANNELS = [
  { name: 'Organic', base: 900, trend: 2.5 },
  { name: 'Paid', base: 600, trend: 4 },
  { name: 'Referral', base: 350, trend: 1 },
]
const DAYS = 90
const DAY = 24 * 3600 * 1000

// Daily visitors by channel over a time axis: stacked areas seen flat, or ribbons in depth seen in
// 3D. In live mode a day arrives every second and the window slides - the chart tweens to it.
export default function run({ canvas, gui, info }) {
  const rand = random(9)
  const start = new Date('2026-06-01').getTime()
  let day = 0
  const visitors = (c, d) => Math.round((c.base + c.trend * d) * (1 + 0.25 * Math.sin((d % 7) / 7 * Math.PI * 2)) * (0.85 + rand() * 0.3))
  const dayRows = (d) => CHANNELS.map((c) => ({ id: `${c.name}-${d}`, date: new Date(start + d * DAY), channel: c.name, visitors: visitors(c, d) }))
  let rows = []
  for (; day < DAYS; day++) rows.push(...dayRows(day))

  const view = new View({ canvas, orbit: true, background: '#17181d', camera: 'front' })
  const shared = {
    mark: 'area', x: { field: 'date', title: 'Day' }, y: { field: 'visitors', title: 'Visitors' },
    color: { field: 'channel', title: 'Channel' }, tooltip: ['channel', 'date', 'visitors'], legend: { position: 'bottom-right' },
  }
  const layouts = {
    'stacked areas': { ...shared, stack: true, z: null },
    // the first channel is nearest: the smallest in front, so the tallest stands behind, not in the way
    'ribbons in depth': { ...shared, stack: false, z: { field: 'channel', title: 'Channel', scale: { domain: CHANNELS.map((c) => c.name).reverse() } } },
    'lines': { ...shared, mark: 'line', stack: false, z: null },
  }
  const traffic = view.scene.add(chart({ ...layouts['stacked areas'], data: rows, box: [12, 6, 4] }))

  const settings = { layout: 'stacked areas', live: true }
  gui.add(settings, 'layout', Object.keys(layouts)).onChange((name) => {
    traffic.update(layouts[name])
    // ribbons read best from an angle, stacks and lines flat on
    view.camera = name === 'ribbons in depth' ? 'perspective' : 'front'
  })
  gui.add(settings, 'live').name('live data')
  showSpec(gui, traffic)
  info.textContent = 'Hover a point for its day'

  let wait = 0
  return view.start((dt) => {
    if (!settings.live || (wait -= dt) > 0) return
    wait = 1
    // a new day in, the oldest out: the same number of points, so the areas slide
    rows = [...rows.slice(CHANNELS.length), ...dayRows(day++)]
    traffic.update(rows)
    info.textContent = `Up to ${new Date(start + (day - 1) * DAY).toDateString()}`
  })
}
