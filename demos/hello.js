import { DirectionalLight, Label, Mesh, View, box, cylinder } from 'phoria2'
import source from './hello.js?raw'

// The minimal phoria2 scene - and the panel beside it shows the whole program, read from this
// file between the markers, so what you read is exactly what runs.
export default function run({ canvas }) {
  showSource()
  // program
  const view = new View({ canvas, orbit: true, background: '#1c1c22' })
  view.scene.environment = 'hdr/studio_small_09_1k.hdr'
  view.scene.add(new DirectionalLight({ direction: [-1, -2, -1], castShadow: true }))
  view.scene.add(new Mesh({
    geometry: cylinder({ radius: 2.4, height: 0.2 }),
    position: [0, -0.1, 0],
    receiveShadow: true,
  }))
  const cube = view.scene.add(new Mesh({
    geometry: box(2),
    material: { color: 'orange', roughness: 0.3 },
    position: [0, 1, 0],
    castShadow: true,
  }))
  view.scene.add(new Label({ text: 'Hello, phoria2', position: [0, 2.6, 0] }))
  view.start((dt) => cube.rotateY(0.6 * dt))
  // end
  return view
}

function showSource() {
  const lines = source.split('\n')
  const from = lines.findIndex((l) => l.trim() === '// program') + 1
  const to = lines.findIndex((l) => l.trim() === '// end')
  const body = lines.slice(from, to).map((l) => l.replace(/^ {2}/, '')).join('\n')
  const panel = document.createElement('div')
  panel.className = 'code-panel'
  const title = document.createElement('p')
  title.textContent = 'The whole program'
  const code = document.createElement('pre')
  code.textContent = `import { View, Mesh, box, cylinder, DirectionalLight, Label } from 'phoria2'\n\n${body.replace('{ canvas,', "{ canvas: '#c',")}`
  panel.append(title, code)
  document.body.append(panel)
}
