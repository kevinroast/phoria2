import { DEMOS, REPO } from './registry.js'
import { Panel } from './panel.js'

// Host for a single demo: demo.html?name=hello loads demos/hello.js and calls its default export
// with { canvas, gui, info }. Each demo owns its scene and animation loop from there, and returns
// its View - in dev it is window.view, for poking at from the console.
/** @typedef {(ctx: { canvas: HTMLCanvasElement, gui: Panel, info: HTMLElement }) => unknown} DemoRun */
const modules = /** @type {Record<string, () => Promise<{ default: DemoRun }>>} */ (import.meta.glob(['./*.js', '!./main.js', '!./registry.js', '!./gallery.js', '!./panel.js', '!./kit.js', '!./planets.js', '!./flower.js', '!./hero.js']))

const name = new URLSearchParams(location.search).get('name') ?? DEMOS[0].name
const demo = DEMOS.find((d) => d.name === name)
const load = modules[`./${name}.js`]

const info = document.getElementById('info')

// back to the gallery where the visitor left it: when they came from it, step back in history so the
// browser restores their place; opened directly or in a new tab, the link loads the gallery
document.querySelector('.back')?.addEventListener('click', (e) => {
  const from = document.referrer ? new URL(document.referrer) : null
  const gallery = new URL('./', location.href).pathname
  if (from?.origin === location.origin && from.pathname.replace(/index\.html$/, '') === gallery && history.length > 1) {
    e.preventDefault()
    history.back()
  }
})
if (!demo || !load) {
  info.textContent = `Unknown demo '${name}'`
} else {
  document.title = `phoria2 - ${demo.name} - ${demo.title}`
  document.getElementById('name').textContent = demo.name
  document.getElementById('title').textContent = demo.title
  const hint = /** @type {HTMLElement} */ (document.getElementById('hint'))
  // a demo that handles the pointer its own way says how - or, with hint: '', shows no hint at all
  if (demo.hint !== undefined) hint.textContent = demo.hint
  hint.hidden = demo.orbit === false || demo.hint === ''
  const source = /** @type {HTMLAnchorElement} */ (document.getElementById('source'))
  source.href = `${REPO}/blob/main/demos/${demo.name}.js`
  source.hidden = false

  // the canvas fills the window (CSS); each demo's View sizes its drawing buffer to match
  const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('canvas'))
  showFps(/** @type {HTMLElement} */ (document.getElementById('fps')))

  const gui = new Panel({ title: 'Controls' })
  const { default: run } = await load()
  const view = await run({ canvas, gui, info })
  if (import.meta.env.DEV && view) Object.assign(window, { view })
  // demos without controls don't need an empty panel
  if (gui.isEmpty) gui.destroy()
}

// Frames per second, counted from the page's animation frames and shown once a second.
function showFps(el) {
  let frames = 0, last = performance.now()
  const tick = (now) => {
    frames++
    if (now - last >= 1000) {
      el.textContent = `${Math.round(frames * 1000 / (now - last))} fps`
      frames = 0
      last = now
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}
