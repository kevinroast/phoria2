import { Group, Lines, Mesh, PointLight, View, box, edges, grid, sphere } from 'phoria2'
import { DEMOS } from './registry.js'

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
