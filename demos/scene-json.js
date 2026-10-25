import { Scene, View, create } from 'phoria2'

const START = {
  type: 'scene',
  background: '#1a1b20',
  environment: 'studio',
  children: [
    { type: 'directional-light', direction: [-0.6, -1, -0.4], intensity: 1.4, castShadow: true },
    { type: 'mesh', name: 'plinth', geometry: { type: 'cylinder', radius: 3.6, height: 0.2, segments: 96 }, material: { color: '#3a3b42', roughness: 0.6 }, position: [0, -0.1, 0], receiveShadow: true },
    {
      type: 'group',
      name: 'turntable',
      children: [
        { type: 'mesh', name: 'box', geometry: { type: 'box', size: 1.4 }, material: { color: 'tomato', roughness: 0.35 }, position: [-2.1, 0.7, 0], rotation: [0, 0.4, 0], castShadow: true },
        { type: 'mesh', name: 'ball', geometry: { type: 'sphere', radius: 0.9 }, material: { color: 'gold', metalness: 1, roughness: 0.2 }, position: [0, 0.9, 0], castShadow: true },
        { type: 'mesh', name: 'ring', geometry: { type: 'torus', radius: 0.65, tube: 0.24 }, material: { color: 'mediumseagreen', roughness: 0.3 }, position: [2.1, 0.9, 0], rotation: [1.2, 0, 0], castShadow: true },
      ],
    },
    { type: 'label', text: 'Edit the JSON', position: [0, 2.5, 0], className: 'demo-label' },
  ],
}

// "Try this": edits to the description in the editor, as an agent or a person would make them
const SNIPPETS = {
  'add a blue light': (d) => d.children.push({ type: 'point-light', color: '#4cc9ff', intensity: 40, range: 12, position: [2.5, 2.5, 2] }),
  'make the ball chrome': (d) => {
    const ball = find(d, 'ball')
    if (ball) ball.material = { color: '#eceef2', metalness: 1, roughness: 0.05 }
  },
  'add a cone': (d) => (find(d, 'turntable')?.children ?? d.children).push({
    type: 'mesh', geometry: { type: 'cylinder', radius: 0.6, radiusTop: 0, height: 1.4 }, material: { color: 'orchid', roughness: 0.4 },
    position: [0, 0.7, 2.1], castShadow: true,
  }),
  'add a label': (d) => d.children.push({ type: 'label', text: 'A new label', position: [2.1, 1.9, 0], className: 'demo-label' }),
  'evening light': (d) => {
    d.background = '#24162a'
    d.environment = 'none'
    d.children.push({ type: 'hemisphere-light', sky: '#ffb36b', ground: '#2a1630', intensity: 0.7 })
  },
}

/** The first node with this name, anywhere in a description. @param {any} d @param {string} name @returns {any} */
function find(d, name) {
  if (d.name === name) return d
  for (const c of d.children ?? []) {
    const hit = find(c, name)
    if (hit) return hit
  }
  return null
}

// Mistakes people (and coding agents) make, to show the messages that come back
const MISTAKES = {
  'colour, not color': (d) => { find(d, 'box').material = { colour: 'tomato' } },
  'a three.js class name': (d) => { find(d, 'ring').type = 'MeshStandardMaterial' },
  'a 0-255 colour': (d) => { find(d, 'ball').material.color = [255, 200, 0] },
  'a geometry name guess': (d) => { find(d, 'box').geometry = { type: 'cube' } },
  'a misspelt option': (d) => { find(d, 'ball').material.roughnes = 0.5 },
}

// A scene as plain data: the description in the editor goes through create() to become the
// scene, and Export writes scene.toJSON() back - the same form both ways. Edits apply as you type;
// a mistake leaves the last good scene showing and says what to write instead.
export default function run({ canvas, gui }) {
  // the target sits left of the scene, so it shows clear of the editor panel
  const view = new View({ canvas, orbit: true, camera: { position: [-1.2, 4.6, 10.5], target: [-2.4, 0.8, 0] } })

  const panel = document.createElement('div')
  panel.className = 'json-editor'
  panel.innerHTML = '<div class="json-snippets"></div><textarea spellcheck="false" aria-label="Scene description"></textarea><p class="json-status" role="status"></p>'
  document.body.append(panel)
  const text = /** @type {HTMLTextAreaElement} */ (panel.querySelector('textarea'))
  const status = /** @type {HTMLElement} */ (panel.querySelector('.json-status'))

  // how far the turntable has turned, so a rebuilt scene carries on from there rather than jumping back
  let spin = 0
  const apply = () => {
    try {
      const scene = create(JSON.parse(text.value))
      if (!(scene instanceof Scene)) throw new Error(`the top level must be { type: 'scene', ... }, got '${/** @type {any} */ (scene.constructor).type}'`)
      scene.find('turntable')?.rotateY(spin)
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

  // each snippet edits what is in the editor now (or the start, if that doesn't parse), once - it
  // comes back when the description starts again
  const snippets = /** @type {HTMLElement} */ (panel.querySelector('.json-snippets'))
  for (const [name, edit] of Object.entries(SNIPPETS)) {
    const button = document.createElement('button')
    button.textContent = name
    button.addEventListener('click', () => {
      let d
      try {
        d = JSON.parse(text.value)
      } catch {
        d = structuredClone(START)
      }
      edit(d)
      show(d)
      button.disabled = true
    })
    snippets.append(button)
  }

  const startAgain = (d) => {
    show(d)
    for (const b of snippets.querySelectorAll('button')) b.disabled = false
  }

  const settings = { mistake: 'colour, not color' }
  const f = gui.addFolder('Description')
  f.add({ reset: () => startAgain(START) }, 'reset').name('start again')
  // the export has the turntable's turn in it, so the count starts again from there
  f.add({ exportJSON: () => { spin = 0; show(view.scene.toJSON()) } }, 'exportJSON').name('export scene.toJSON()')
  f.add(settings, 'mistake', Object.keys(MISTAKES))
  f.add({
    make: () => {
      const d = structuredClone(START)
      MISTAKES[settings.mistake](d)
      startAgain(d)
    },
  }, 'make').name('make this mistake')

  return view.start((dt) => {
    spin += 0.4 * dt
    view.scene.find('turntable')?.rotateY(0.4 * dt)
  })
}
