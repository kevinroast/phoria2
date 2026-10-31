import { View } from 'phoria2'
import { chart } from 'phoria2/charts'

// six months of sales, in thousands, for four regions
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']
const regions = ['North', 'South', 'East', 'West']
const rows = regions.flatMap((region, r) => months.map((month, m) => ({
  region, month, sales: Math.round(20 + 5 * r + 4 * m + 10 * Math.random()),
})))

const view = new View({ canvas: '#scene', background: '#1c1c22', orbit: true })
const sales = view.scene.add(chart({
  mark: 'bar', data: rows,
  x: 'month', z: 'region', y: 'sales',
  color: 'region',
  tooltip: true,
}))
view.frame(sales)
