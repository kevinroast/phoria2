import { DirectionalLight, InstancedMesh, Label, Lines, View, box, grid } from 'phoria2'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const SERIES = [['North', '#4e79a7'], ['South', '#f28e2b'], ['East', '#59a14f'], ['West', '#e15759']]
// made-up but repeatable monthly sales, in thousands - later series sell more, so sit further back
const sales = (s, m) => Math.round(20 + 12 * Math.sin(m / 2 + s * 1.3) + s * 6 + ((m * 7 + s * 3) % 5) * 3)
const HEIGHT_PER_UNIT = 0.08

// A 3D bar chart: one InstancedMesh draws every bar, HTML labels name the axes, and the bar under
// the pointer is picked to highlight it and show its value.
export default function run({ canvas, gui }) {
  const view = new View({ canvas, orbit: true, background: '#1c1c20', camera: { position: [4, 9, 12], target: [0, 1.5, 0] } })
  view.scene.environment = 'studio'
  view.scene.add(new DirectionalLight({ direction: [-1, -2, -1.5] }))
  view.scene.add(new Lines({ geometry: grid({ size: 14, divisions: 14 }), material: { color: '#3a3a40' }, pickable: false }))

  const bars = SERIES.flatMap((_, s) => MONTHS.map((_, m) => ({ s, m, value: sales(s, m), x: m - 5.5, z: (1.5 - s) * 1.2 })))
  const chart = view.scene.add(new InstancedMesh({ geometry: box(1), material: { roughness: 0.5 }, count: bars.length }))
  bars.forEach((b, i) => chart.setColor(i, SERIES[b.s][1]))

  // grow the bars from the floor; a zero height would leave the normals undefined
  const place = (grow) => bars.forEach((b, i) => {
    const h = Math.max(0.001, b.value * HEIGHT_PER_UNIT * grow)
    chart.setInstance(i, { position: [b.x, h / 2, b.z], scale: [0.7, h, 0.7] })
  })

  MONTHS.forEach((name, m) => view.scene.add(new Label({ text: name, position: [m - 5.5, 0, 3.1], className: 'demo-tick' })))
  SERIES.forEach(([name], s) => view.scene.add(new Label({ text: name, position: [-7, 0, (1.5 - s) * 1.2], className: 'demo-tick' })))

  const tip = view.scene.add(new Label({ text: '', className: 'demo-label', visible: false }))
  let hovered = -1
  canvas.addEventListener('pointermove', (e) => {
    const hit = view.pick(e)
    const i = hit?.node === chart ? hit.instance : -1
    if (i === hovered) return
    if (hovered >= 0) chart.setColor(hovered, SERIES[bars[hovered].s][1])
    hovered = i
    tip.visible = i >= 0
    if (i < 0) return
    const b = bars[i]
    chart.setColor(i, '#ffffff')
    tip.text = `${SERIES[b.s][0]}, ${MONTHS[b.m]}: ${b.value}k`
    tip.position.set(b.x, b.value * HEIGHT_PER_UNIT + 0.5, b.z)
  })

  let age = 0
  const actions = { replay() { age = 0 } }
  const f = gui.addFolder('Chart')
  f.add(actions, 'replay')
  f.add(chart.material, 'roughness', 0, 1, 0.01)
  f.add(chart.material, 'metalness', 0, 1, 0.01)

  return view.start((dt) => {
    if (age > 1.5) return
    age += dt
    const k = Math.min(1, age / 1.5)
    place(1 - (1 - k) ** 3)
  })
}
