import { View } from 'phoria2'
import { chart } from 'phoria2/charts'

// six months of sales, in thousands, for four regions -
// new figures each time it's called
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']
const regions = ['North', 'South', 'East', 'West']
const latest = () => regions.flatMap((region, r) => months.map((month, m) => ({
  region, month, sales: Math.round(20 + 5 * r + 4 * m + 10 * Math.random()),
})))

const view = new View({ canvas: '#scene', background: '#1c1c22', orbit: true })
const sales = view.scene.add(chart({
  mark: 'bar', data: latest(),
  x: 'month', z: 'region',
  y: { field: 'sales', title: 'Sales', format: (v) => `£${v}k` },
  color: 'region',
  tooltip: ['region', 'month', 'sales'],
}))
view.frame(sales)

// fresh figures every two seconds: the bars grow and shrink to them
setInterval(() => sales.update(latest()), 2000)
