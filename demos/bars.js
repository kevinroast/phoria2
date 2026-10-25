import { View } from 'phoria2'
import { chart } from 'phoria2/charts'
import { random } from './kit.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const REGIONS = ['North', 'South', 'East', 'West']
const rand = random(5)
// made-up monthly sales in £k, with a seasonal swing; later regions sell more
const sales = (s, m) => Math.round(20 + 12 * Math.sin(m / 2 + s * 1.3) + s * 6 + rand() * 9)
const rowsFor = () => REGIONS.flatMap((region, s) => MONTHS.map((month, m) => ({ id: `${region}-${month}`, region, month, sales: sales(s, m) })))

// A 3D bar chart from a spec: axes, a legend that hides regions, value labels that give way,
// tooltips and highlight all come with it. New data animates; stacking swaps the depth for stacks.
export default function run({ canvas, gui, info }) {
  const view = new View({ canvas, orbit: true, background: '#1c1c20', camera: 'perspective' })
  view.scene.environment = 'studio'
  const bars = view.scene.add(chart({
    mark: 'bar', data: rowsFor(),
    x: 'month', z: 'region', y: { field: 'sales', title: 'Sales (£k)' }, color: 'region', label: 'sales',
    tooltip: ['region', 'month', { field: 'sales', title: 'Sales', format: { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 } }],
    legend: { position: 'bottom-right' },
  }))

  info.textContent = 'Click a bar - the chart hands back its row'
  view.on('click', (hit) => { if (hit?.datum) info.textContent = `${hit.datum.region} sold £${hit.datum.sales}k in ${hit.datum.month}` })

  const settings = { stacked: false, values: true, overlap: 'dim' }
  gui.add({ next: () => bars.update(rowsFor()) }, 'next').name('new year of data')
  gui.add(settings, 'stacked').onChange((stack) => bars.update({ z: stack ? null : 'region', stack }))
  gui.add(settings, 'values').name('value labels').onChange((on) => bars.update({ label: on ? 'sales' : null }))
  // what labels covered by another label or a bar do - one rule for values, ticks and axis titles
  gui.add(settings, 'overlap', { 'dim covered': 'dim', 'hide covered': 'hide', 'show all': 'show' }).name('covered labels')
    .onChange((overlap) => bars.update({ overlap }))
  return view
}
