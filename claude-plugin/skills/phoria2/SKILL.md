---
name: phoria2
description: Build 3D for the web with phoria2, a small WebGL 2 library for business apps. Use when asked for a 3D chart or 3D data visualisation (bar, scatter, line, area, surface, network), a labelled 3D diagram, floor plan or topology, a cutaway explainer with callouts, an animated 3D infographic or guided tour, a dashboard of 3D tiles, a glTF product viewer, or an editor that drags, snaps and undoes - or whenever a project uses phoria2. Not for games or custom shader work, where three.js fits better.
license: MIT
---

# Building with phoria2

phoria2 is small 3D for the web: charts from a data spec, labelled scenes, diagrams, explainers,
dashboards, editors and product viewers. Picking, tooltips, hover highlights, HTML labels, shadows
and image-based light are built in, and a view draws only when something changes. Apps are short -
a few dozen lines - and every option is checked: a wrong or misspelt option throws an error that
names the fix.

## 1. Read the reference first

Don't write phoria2 from memory - read the reference before writing code. It is the whole API on
one page:

- `node_modules/phoria2/llms-full.txt` when phoria2 is installed - it matches that version
- otherwise [references/llms-full.txt](references/llms-full.txt) in this skill

For a chart, the spec `chart()` takes is a JSON Schema:
[references/chart.schema.json](references/chart.schema.json). Check a spec you generate against it.

## 2. Set up

With a bundler (Vite, etc.):

```sh
npm install phoria2
```

A single HTML file with no build: map the imports to the CDN, pinning a version (look it up with
`npm view phoria2 dist-tags`), and import as usual:

```html
<script type="importmap">
{ "imports": {
  "phoria2": "https://cdn.jsdelivr.net/npm/phoria2@VERSION/dist/phoria2.js",
  "phoria2/charts": "https://cdn.jsdelivr.net/npm/phoria2@VERSION/dist/charts.js"
} }
</script>
<script type="module">
  import { View } from 'phoria2'
  // ...
</script>
```

**A page that must open straight from a folder** (double-clicked, `file://`) has to keep its code
inline like this: browsers won't load `<script type="module" src="./main.js">` from `file://`, and
the page stays blank. A page that is served (a dev server, any static host) can use separate files.

Entry points: `phoria2` (core), `phoria2/charts`, `phoria2/gltf`, `phoria2/motion`,
`phoria2/particles`, `phoria2/edit` - each `dist/<name>.js` on the CDN.

## 3. Write it

```js
import { View, Mesh, box, DirectionalLight } from 'phoria2'

const view = new View({ canvas: '#c', orbit: true, background: '#1c1c20' })
const cube = view.scene.add(new Mesh({ geometry: box(2), material: { color: 'orange' } }))
view.scene.add(new DirectionalLight({ direction: [-1, -2, -1] }))
view.start((dt) => cube.rotateY(0.6 * dt))
window.view = view   // lets the check below run view.explain() - fine to leave in while developing
```

Things that trip people up:

- **The canvas needs a size from CSS** (`width: 100%; height: 100vh; display: block`, or a sized
  container). A canvas with no height draws nothing.
- **+Y is up**, units are metres, angles are radians (a perspective camera's `fov` is degrees).
- **One options object per constructor**, and unknown options throw - read the message, it names
  the fix. Don't pass three.js names (`new THREE...`, `MeshStandardMaterial`): materials are plain
  objects like `{ color, roughness, metalness }`.
- **Charts are one call**: `view.scene.add(chart({ mark: 'bar', data: rows, x: 'month', y: 'sales' }))`
  gives axes, legend, tooltips and animated `update()`. Prefer it to building bars by hand. A chart
  needs no lights of its own. Set `title` and `format` once, on the channel - tooltips and the legend
  use them. In depth (`z`) the first category is nearest the viewer, so put the tallest series last
  with `z.scale.domain`, or it hides the others.
- **The JSON Schema covers JSON**: in code, a `format` can also be a function, `(v) => \`£${v}k\``.
- **Interaction is options**: `highlight`, `tooltip`, `onClick`, `onHover`, `onDrag` on the View or
  any node; `view.on('click', (hit) => ...)` where `hit.datum` is the data row.
- **Framing**: the default camera fits the scene on the first frame. To fit a part, `view.frame(node)`
  - `padding` is the margin as a fraction (0.2 leaves a fifth around it).
- **Don't add a render loop.** The view redraws by itself when something changes; use
  `view.start(fn)` only for your own per-frame work.

## 4. Check it - every time

You can't see the page, so look at it. The skill's check loads it in headless Chrome and reports
errors, failed requests, canvas sizes, `view.explain()` (what is drawn, culled and why), idle redraws,
tooltips at points you hover, and saves a screenshot:

```sh
node ${CLAUDE_SKILL_DIR}/scripts/check.mjs http://localhost:5173/          # a dev server's page
node ${CLAUDE_SKILL_DIR}/scripts/check.mjs index.html                      # a file, served from its folder
node ${CLAUDE_SKILL_DIR}/scripts/check.mjs index.html --hover 600,400 --hover 420,380
```

(`scripts/check.mjs` in this skill's folder. Needs Node 22+ and Chrome, Chromium or Edge; set
`CHROME` to its path if it isn't found. Options: `--size 1200x800`, `--wait 2` seconds before
looking, `--out shot.png`.)

Then:

1. **Fix every error** it lists. phoria2's errors name the option and the fix.
2. **Open the screenshot and look at it** against what was asked: is everything in view, the right
   way up, readable, lit? "Nothing in view" or labels hidden show up in `view.explain()` too.
3. **Hover** what should have a tooltip (`--hover x,y` in page pixels) and check the text.
4. **Idle draws** should be 0 unless something is meant to move.
5. Repeat until it is clean and the picture matches the brief.

It exits 1 when the page threw, logged an error, failed a request or has no canvas.
