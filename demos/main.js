import GUI from 'lil-gui'
import { DEMOS } from './registry.js'

// Host for a single demo: demo.html?name=test0 loads demos/test0.js and calls its default export
// with { canvas, gui, info }. Each demo owns its scene and animation loop from there.
const modules = import.meta.glob(['./*.js', '!./main.js', '!./shell.js', '!./registry.js', '!./gallery.js'])

const name = new URLSearchParams(location.search).get('name') ?? DEMOS[0].name
const demo = DEMOS.find((d) => d.name === name)
const load = modules[`./${name}.js`]

const info = document.getElementById('info')
if (!demo || !load) {
  info.textContent = `Unknown demo '${name}'`
} else {
  document.title = `phoria2 - ${demo.name} - ${demo.title}`
  document.getElementById('title').textContent = `${demo.name} - ${demo.title}`
  const canvas = document.getElementById('canvas')
  const gui = new GUI({ title: 'Controls' })
  const { default: run } = await load()
  await run({ canvas, gui, info })
  // keep the bar readable on demos that darken the page
  const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/\d+/g).map(Number)
  if (r * 0.3 + g * 0.6 + b * 0.1 < 128) document.body.classList.add('dark')
  // demos without controls don't need the empty panel
  if (gui.children.length === 0) gui.destroy()
}
