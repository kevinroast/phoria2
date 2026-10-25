import { Scene, View, create } from 'phoria2'

const START = {
  type: 'scene',
  background: '#1c1c20',
  environment: 'studio',
  children: [
    { type: 'directional-light', direction: [-1, -2, -1], intensity: 1.5 },
    {
      type: 'group',
      name: 'turntable',
      children: [
        { type: 'mesh', geometry: { type: 'box', size: 1.5 }, material: { color: 'tomato', roughness: 0.4 }, position: [-2.2, 0.75, 0] },
        { type: 'mesh', geometry: { type: 'sphere', radius: 0.9 }, material: { color: 'gold', metalness: 1, roughness: 0.25 }, position: [0, 0.9, 0] },
        { type: 'mesh', geometry: { type: 'torus', radius: 0.7, tube: 0.25 }, material: { color: 'mediumseagreen' }, position: [2.2, 0.95, 0], rotation: [1.2, 0, 0] },
      ],
    },
    { type: 'lines', geometry: { type: 'grid', size: 10, divisions: 10 }, material: { color: '#444444' } },
    { type: 'label', text: 'Edit the JSON', position: [0, 2.6, 0], className: 'demo-label' },
  ],
}

// Mistakes people (and coding agents) make, to show the messages that come back
const MISTAKES = {
  'colour, not color': (d) => { d.children[1].children[0].material = { colour: 'tomato' } },
  'a three.js class name': (d) => { d.children[1].children[2].type = 'MeshStandardMaterial' },
  'a 0-255 colour': (d) => { d.children[1].children[1].material.color = [255, 200, 0] },
  'a geometry name guess': (d) => { d.children[1].children[0].geometry = { type: 'cube' } },
  'a misspelt option': (d) => { d.children[1].children[1].material.roughnes = 0.5 },
}

// A scene as plain data: the description in the editor goes through create() to become the
// scene, and Export writes scene.toJSON() back - the same form both ways. Edits apply as you type;
// a mistake leaves the last good scene showing and says what to write instead.
export default function run({ canvas, gui }) {
  const view = new View({ canvas, orbit: true, camera: { position: [0, 3.5, 8], target: [0, 0.8, 0] } })

  const panel = document.createElement('div')
  panel.className = 'json-editor'
  panel.innerHTML = '<textarea spellcheck="false" aria-label="Scene description"></textarea><p class="json-status" role="status"></p>'
  document.body.append(panel)
  const text = /** @type {HTMLTextAreaElement} */ (panel.querySelector('textarea'))
  const status = /** @type {HTMLElement} */ (panel.querySelector('.json-status'))

  const apply = () => {
    try {
      const scene = create(JSON.parse(text.value))
      if (!(scene instanceof Scene)) throw new Error(`the top level must be { type: 'scene', ... }, got '${/** @type {any} */ (scene.constructor).type}'`)
      view.scene = scene
      status.textContent = 'OK'
      status.classList.remove('error')
    } catch (e) {
      status.textContent = /** @type {Error} */ (e).message
      status.classList.add('error')
    }
  }
  const show = (description) => {
    text.value = JSON.stringify(description, null, 2)
    apply()
  }
  let timer = 0
  text.addEventListener('input', () => {
    clearTimeout(timer)
    timer = window.setTimeout(apply, 300)
  })
  show(START)

  const settings = { mistake: 'colour, not color' }
  const f = gui.addFolder('Description')
  f.add({ reset: () => show(START) }, 'reset').name('start again')
  f.add({ exportJSON: () => show(view.scene.toJSON()) }, 'exportJSON').name('export scene.toJSON()')
  f.add(settings, 'mistake', Object.keys(MISTAKES))
  f.add({
    make: () => {
      const d = structuredClone(START)
      MISTAKES[settings.mistake](d)
      show(d)
    },
  }, 'make').name('make this mistake')

  return view.start((dt) => view.scene.find('turntable')?.rotateY(0.4 * dt))
}
