import { View } from 'phoria2'
import { chart } from 'phoria2/charts'

// six months of sales, in thousands, for four regions -
// new figures each time it's called
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']
const regions = ['North', 'South', 'East', 'West']
const latest = () => regions.flatMap((region, r) => months.map((month, m) => ({
  region, month, sales: Math.round(20 + 5 * r + 4 * m + 10 * Math.random()),
})))
const rows = latest()

/** A tile: its own view of the rows, kept whole whatever the tile's shape. */
const tile = (canvas, spec) => {
  const view = new View({ canvas, background: '#1c1c22', framing: 'both' })
  const shown = view.scene.add(chart({
    data: rows, x: 'month', color: 'region', ...spec,
  }))
  view.frame(shown, { padding: 0.1 })
  return { view, chart: shown }
}
const sales = { field: 'sales', title: 'Sales', format: (v) => `£${v}k` }
const bars = tile('#bars', {
  mark: 'bar', z: 'region', y: sales, tooltip: ['region', 'month', 'sales'],
})
const trend = tile('#trend', { mark: 'line', z: 'region', y: sales, legend: false })
const total = tile('#total', { mark: 'area', y: sales, stack: true, legend: false })

// click a bar to show just its region in the other tiles;
// click empty space for them all again
bars.view.on('click', (hit) => {
  const only = hit ? (row) => row.region === hit.datum.region : null
  trend.chart.filter(only)
  total.chart.filter(only)
})

setInterval(() => {
  const next = latest()
  for (const t of [bars, trend, total]) t.chart.update(next)
}, 2000)
