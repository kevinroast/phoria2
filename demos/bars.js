import { DirectionalLight, InstancedMesh, Label, Lines, View, box, grid } from 'phoria2'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const SERIES = [['North', '#4e79a7'], ['South', '#f28e2b'], ['East', '#59a14f'], ['West', '#e15759']]
// made-up but repeatable monthly sales, in thousands - later series sell more, so sit further back
const sales = (s, m) => Math.round(20 + 12 * Math.sin(m / 2 + s * 1.3) + s * 6 + ((m * 7 + s * 3) % 5) * 3)
const HEIGHT_PER_UNIT = 0.08

// A 3D bar chart: one InstancedMesh draws every bar, with the rows of data bound to it. Hovering
// highlights a bar and shows its row in a tooltip; value labels sit on the bars and give way to
// each other when they would overlap, nearest first.
export default function run({ canvas, gui, info }) {
  const rows = SERIES.flatMap(([region], s) => MONTHS.map((month, m) => ({ region, month, s, m, sales: sales(s, m) })))

  const view = new View({
    canvas, orbit: true, background: '#1c1c20', camera: { position: [4, 9, 12], target: [0, 1.5, 0] },
    highlight: '#ffffff',
    tooltip: (hit) => hit.datum && { title: `${hit.datum.region}, ${hit.datum.month}`, rows: { Sales: `${hit.datum.sales}k` } },
  })
  view.scene.environment = 'studio'
  view.scene.add(new DirectionalLight({ direction: [-1, -2, -1.5] }))
  view.scene.add(new Lines({ geometry: grid({ size: 14, divisions: 14 }), material: { color: '#3a3a40' }, pickable: false }))

  const chart = view.scene.add(new InstancedMesh({
    geometry: box(1), material: { roughness: 0.5 }, data: rows,
    // the value on top of each bar, hidden when a nearer bar is in front of it
    labels: { text: (row) => row.sales, place: 'above', className: 'demo-value', occlude: true },
  }))
  const x = (row) => row.m - 5.5, z = (row) => (1.5 - row.s) * 1.2
  rows.forEach((row, i) => chart.setColor(i, SERIES[row.s][1]))

  // grow the bars from the floor; a zero height would leave the normals undefined
  const place = (grow) => rows.forEach((row, i) => {
    const h = Math.max(0.001, row.sales * HEIGHT_PER_UNIT * grow)
    chart.setInstance(i, { position: [x(row), h / 2, z(row)], scale: [0.7, h, 0.7] })
  })

  // axis labels always show; the value labels give way around them
  MONTHS.forEach((name, m) => view.scene.add(new Label({ text: name, position: [m - 5.5, 0, 3.1], className: 'demo-tick', overlap: 'show' })))
  SERIES.forEach(([name], s) => view.scene.add(new Label({ text: name, position: [-6.6, 0, (1.5 - s) * 1.2], place: 'left', className: 'demo-tick', overlap: 'show' })))

  view.on('click', (hit) => {
    info.textContent = hit?.datum ? `${hit.datum.region} sold ${hit.datum.sales}k in ${hit.datum.month}` : 'Click a bar'
  })
  info.textContent = 'Click a bar'

  let age = 0
  const labels = chart.labels
  const settings = {
    replay() { age = 0 },
    get values() { return !!chart.labels },
    set values(v) { chart.labels = v ? labels : null },
  }
  const f = gui.addFolder('Chart')
  f.add(settings, 'replay')
  f.add(settings, 'values').name('value labels')
  f.add(chart.material, 'roughness', 0, 1, 0.01)
  f.add(chart.material, 'metalness', 0, 1, 0.01)

  return view.start((dt) => {
    if (age > 1.5) return
    age += dt
    const k = Math.min(1, age / 1.5)
    place(1 - (1 - k) ** 3)
  })
}
