import { DEMOS } from './registry.js'
import { Panel } from './panel.js'

// Host for a single demo: demo.html?name=test0 loads demos/test0.js and calls its default export
// with { canvas, gui, info }. Each demo owns its scene and animation loop from there.
/** @typedef {(ctx: { canvas: HTMLCanvasElement, gui: Panel, info: HTMLElement }) => unknown} DemoRun */
const modules = /** @type {Record<string, () => Promise<{ default: DemoRun }>>} */ (import.meta.glob(['./*.js', '!./main.js', '!./shell.js', '!./registry.js', '!./gallery.js', '!./panel.js']))

const name = new URLSearchParams(location.search).get('name') ?? DEMOS[0].name
const demo = DEMOS.find((d) => d.name === name)
const load = modules[`./${name}.js`]

const info = document.getElementById('info')
if (!demo || !load) {
  info.textContent = `Unknown demo '${name}'`
} else {
  document.title = `phoria2 - ${demo.name} - ${demo.title}`
  document.getElementById('name').textContent = demo.name
  document.getElementById('title').textContent = demo.title
  document.getElementById('hint').hidden = demo.orbit === false

  // The canvas fills the window. It is sized here, before the demo runs, and resized before any
  // demo resize handler (see fitScene) runs as listeners fire in registration order.
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('canvas'))
  const resize = () => {
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight
  }
  window.addEventListener('resize', resize)
  resize()

  const gui = new Panel({ title: 'Controls' })
  const { default: run } = await load()
  await run({ canvas, gui, info })
  // demos without controls don't need an empty panel
  if (gui.isEmpty) gui.destroy()
}
