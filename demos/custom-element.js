import 'phoria2/element'
import source from './custom-element.js?raw'

// <phoria-view>: phoria2 as an HTML tag. Each card below is its markup put into the page as it is
// shown beside it - what you read is exactly what runs. The last card's script is read from this
// file, between its markers, the same way.

const CDN = '<script type="module" src="https://cdn.jsdelivr.net/npm/phoria2/dist/element.js"></script>'

const EXAMPLES = [
  {
    title: 'A model',
    note: 'A glTF file in the studio light, turning slowly, with a soft shadow on the floor. Drag to look round it.',
    html: `<phoria-view src="models/SheenChair.glb" environment="studio"
  orbit='{ "pan": false }' auto-rotate ground-shadow ambient-occlusion></phoria-view>`,
  },
  {
    title: 'A chart, from JSON',
    note: 'A chart spec inside the tag. phoria2/charts loads only because the content asks for it.',
    html: `<phoria-view orbit='{ "pan": false }' background="#1b1c22">
  <script type="application/json">
  {
    "type": "chart", "mark": "bar", "x": "quarter", "y": "sales", "z": "region",
    "color": { "field": "region", "scale": { "range": ["#ff6b8b", "#4fc3f7"] } },
    "data": [
      { "quarter": "Q1", "region": "North", "sales": 30 }, { "quarter": "Q1", "region": "South", "sales": 42 },
      { "quarter": "Q2", "region": "North", "sales": 38 }, { "quarter": "Q2", "region": "South", "sales": 55 },
      { "quarter": "Q3", "region": "North", "sales": 52 }, { "quarter": "Q3", "region": "South", "sales": 61 },
      { "quarter": "Q4", "region": "North", "sales": 66 }, { "quarter": "Q4", "region": "South", "sales": 74 }
    ]
  }
  </script>
</phoria-view>`,
  },
  {
    title: 'A scene, from JSON',
    note: 'A scene description - the same JSON create() takes and node.toJSON() writes.',
    html: `<phoria-view camera="isometric" environment="studio" orbit>
  <script type="application/json">
  {
    "type": "scene", "background": "#1b1c22",
    "children": [
      { "type": "directional-light", "direction": [-1, -2, -1], "castShadow": true },
      { "type": "mesh", "geometry": { "type": "cylinder", "radius": 2.4, "height": 0.2 },
        "position": [0, -0.1, 0], "receiveShadow": true },
      { "type": "mesh", "geometry": { "type": "torus", "radius": 0.8, "tube": 0.3 },
        "material": { "color": "#e8b04a", "metalness": 1, "roughness": 0.25 },
        "position": [-0.9, 0.3, 0.4], "castShadow": true },
      { "type": "mesh", "geometry": { "type": "box", "size": 1 },
        "material": { "color": "#4fc3f7", "roughness": 0.4 },
        "position": [1, 0.5, -0.5], "castShadow": true },
      { "type": "label", "text": "Built from JSON", "position": [0, 1.7, 0] }
    ]
  }
  </script>
</phoria-view>`,
  },
  {
    title: 'With a little script',
    note: 'el.view is the View, for anything the attributes don\'t cover; pick, hover, load and error are events, and attributes change it live.',
    html: `<phoria-view id="truck" src="models/CesiumMilkTruck.glb" environment="studio"
  orbit autoplay highlight="#fff6e2" ground-shadow></phoria-view>
<p class="demo-ce-row">
  <button id="truck-night">Night</button> <span id="truck-part">Click a part of the truck</span>
</p>`,
    script: true,
  },
]

export default function run({ canvas }) {
  canvas.style.display = 'none'
  const page = document.createElement('div')
  page.className = 'demo-ce'
  // first, across the whole width: what a page needs before any of the tags below
  const intro = card('One script tag, then HTML', 'Load the module once - from the CDN, or import \'phoria2/element\' in a bundled app - then write tags.', CDN)
  intro.classList.add('demo-ce-intro')
  page.append(intro)
  for (const example of EXAMPLES) {
    const code = example.script ? `${example.html}\n\n<script type="module">\n${scriptSource()}\n</script>` : example.html
    const section = card(example.title, example.note, code)
    const live = document.createElement('div')
    live.className = 'demo-ce-live'
    live.innerHTML = example.html
    section.insertBefore(live, section.querySelector('pre'))
    page.append(section)
  }
  document.body.append(page)
  // the cards start below the title panel, with the page's usual 16px between - however many
  // lines its title wraps to at this width
  const title = document.querySelector('.hud-title')
  const place = () => { page.style.top = `${title.getBoundingClientRect().bottom + 16}px` }
  new ResizeObserver(place).observe(title)
  place()
  script()
}

// script
function script() {
  const truck = document.querySelector('#truck')
  const said = document.querySelector('#truck-part')
  const button = document.querySelector('#truck-night')
  truck.addEventListener('pick', (/** @type {CustomEvent} */ e) => {
    const part = e.detail.hit?.node.name
    said.textContent = part ? `Clicked: ${part}` : 'Clicked: nothing there'
  })
  button.addEventListener('click', () => {
    const night = !truck.hasAttribute('bloom')
    truck.toggleAttribute('bloom', night)
    truck.setAttribute('exposure', night ? '0.35' : '1')
    truck.setAttribute('environment-intensity', night ? '0.3' : '1')
    button.textContent = night ? 'Day' : 'Night'
  })
}
// end

/** The script above as it reads, between its markers - less the type comments only this repo's checks want. */
function scriptSource() {
  const lines = source.split('\n')
  const from = lines.findIndex((l) => l.trim() === '// script') + 2
  const to = lines.findIndex((l) => l.trim() === '// end') - 1
  return lines.slice(from, to).map((l) => l.replace(/^ {2}/, '').replace(/\/\*\* @type \{\w+\} \*\/ /g, '')).join('\n')
}

/** A card: a title, a line about it, and its code. @param {string} title @param {string} note @param {string} code */
function card(title, note, code) {
  const section = document.createElement('section')
  section.className = 'demo-ce-card'
  const h = document.createElement('h3')
  h.textContent = title
  const p = document.createElement('p')
  p.textContent = note
  const pre = document.createElement('pre')
  pre.textContent = code
  section.append(h, p, pre)
  return section
}
