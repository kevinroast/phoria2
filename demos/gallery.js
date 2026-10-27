import { Box3, DirectionalLight, Group, View } from 'phoria2'
import { daisy } from './flower.js'
import { hero } from './hero.js'
import { DEMOS } from './registry.js'
import { version } from '../package.json'

// the header: the version, and an install command that copies itself
document.getElementById('version').textContent = `v${version}`
const install = /** @type {HTMLButtonElement} */ (document.querySelector('.install'))
install.addEventListener('click', async () => {
  const note = /** @type {HTMLElement} */ (install.querySelector('.install-note'))
  try {
    await navigator.clipboard.writeText('npm install phoria2')
    note.textContent = 'copied'
  } catch {
    note.textContent = 'select to copy'
  }
  setTimeout(() => { note.textContent = 'copy' }, 1500)
})

// one heading and grid of links per section
const sections = /** @type {HTMLElement} */ (document.getElementById('demo-sections'))
/** @type {HTMLUListElement | null} */
let list = null
for (const { section, name, title, hidden } of DEMOS) {
  if (hidden) continue
  if (section || !list) {
    const heading = document.createElement('h2')
    heading.className = 'section-heading'
    heading.textContent = section ?? 'Demos'
    list = document.createElement('ul')
    list.className = 'demo-grid'
    sections.append(heading, list)
  }
  const li = document.createElement('li')
  // the picture is made by npm run thumbs; a card without one just has no picture
  li.innerHTML = `<a href="demo.html?name=${name}"><img class="thumb" src="thumbs/${name}.webp" alt="" width="480" height="300" loading="lazy"><span class="name">${name}</span><span class="title">${title}</span></a>`
  li.querySelector('img')?.addEventListener('error', (e) => /** @type {HTMLElement} */ (e.target).remove())
  list.append(li)
}

// The front scene: a 3D bar chart that builds itself and runs through what charts can do (demos/hero.js)
const heroView = hero('#canvas', /** @type {HTMLElement} */ (document.getElementById('hero-caption')))
if (import.meta.env.DEV) Object.assign(window, { heroView })

// The masthead's flower: a daisy turning slowly on a transparent canvas, so the page shows through
const flowerView = new View({ canvas: '#flower', camera: { position: [0, 0.4, 6], target: [0, -1, 0], fov: 30 } })
flowerView.scene.environment = 'studio'
flowerView.scene.add(new DirectionalLight({ direction: [-0.4, -0.6, -1], intensity: 1.2 }))
// the sway tips an outer group; the flower turns inside it - one rotation per node, so neither
// undoes the other
const sway = flowerView.scene.add(new Group())
const flower = sway.add(daisy())
// framed for the whole turn: as wide as the flower reaches, whichever way it faces
const reach = flower.bounds, wide = Math.max(...[reach.min[0], reach.max[0], reach.min[2], reach.max[2]].map(Math.abs))
flowerView.frame(new Box3([-wide, reach.min[1], -wide], [wide, reach.max[1], wide]), { padding: 0.02 })
if (import.meta.env.DEV) Object.assign(window, { flowerView })
flowerView.start((dt, t) => {
  flower.rotateY(0.35 * dt)
  // a gentle sway, as if in a breeze
  sway.rotation.z = Math.sin(t * 0.8) * 0.04
})
