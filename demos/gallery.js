import { Box3, DirectionalLight, Group, Lines, Mesh, PointLight, View, box, edges, grid, sphere } from 'phoria2'
import { daisy } from './flower.js'
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
for (const { section, name, title } of DEMOS) {
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

// The front page scene: a spinning cube with a bobbing child, lit by three coloured point lights
// orbiting at different speeds. No wheel zoom here - the wheel should scroll the page.
const view = new View({ canvas: '#canvas', orbit: { zoom: false }, background: '#141414', camera: { position: [0, 5, 13] } })
view.scene.add(new Lines({ geometry: grid({ size: 20, divisions: 16 }), material: { color: '#3c3c44' } }))
const cube = view.scene.add(new Mesh({ geometry: box(2), material: { color: '#ffffff', roughness: 0.5 }, position: [0, 1, 0] }))
const child = cube.add(new Lines({ geometry: edges(box(1)), material: { color: '#e6e6e6' } }))
const bulb = sphere({ radius: 0.12 })
const lights = [['#0000ff', -5, 1], ['#ff0000', 5, 0.5], ['#00ff00', 5, 1.5]].map(([color, z, speed]) => {
  const pivot = view.scene.add(new Group())
  const light = pivot.add(new PointLight({ color, intensity: 30, position: [0, 2.5, Number(z)] }))
  light.add(new Mesh({ geometry: bulb, material: { color, unlit: true } }))
  return { pivot, speed: Number(speed) }
})

view.start((dt, t) => {
  cube.rotateY(0.5 * dt)
  child.position.y = Math.sin(t) + 3
  for (const { pivot, speed } of lights) {
    pivot.rotateY(speed * dt)
    pivot.position.y = Math.sin(t * 2)
  }
})

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
