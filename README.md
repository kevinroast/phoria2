# phoria2

Small, friendly 3D for the web. A WebGL 2 renderer with PBR materials, instancing, points, lines,
labels, picking and particles, behind an API small enough to learn in an afternoon - aimed at
business apps: charts, labelled scenes, diagrams, dashboards and product viewers.

- **Small**: about 57 KB gzipped for a lit, interactive scene, and about 116 KB for everything;
  charts, particles, glTF, motion and editing are separate imports, and the heavier parts (shadows,
  HDR environments, GPU picking) load only when used.
- **Idle when nothing changes**: a view draws only when something in it changed, so a dashboard of
  many views only updates when needed.
- **Any number of views on a page**: browsers allow about 16 WebGL contexts per page, so most
  libraries need one big canvas and scissoring for a dashboard of tiles. phoria2 gives the first four
  views their own context and draws the rest with one shared context, each still an ordinary canvas
  in your layout. The chart lab demo runs over 100 live chart views.
- **Tells you what to write**: every option is checked, and a mistake throws an error that names
  the fix - pass `colour` and you get `Material: use 'color'`. Written to be easy for coding
  agents too.
- **No runtime dependencies.** ES modules, with TypeScript types.

**Using a coding agent?** Point it at [llms-full.txt](https://kevs3d.co.uk/phoria2/llms-full.txt) - the whole API
in one page ([llms.txt](https://kevs3d.co.uk/phoria2/llms.txt) is the short index). Both ship in the
package too, at `node_modules/phoria2/llms-full.txt`.

**Claude Code**: install the phoria2 plugin, and Claude reaches for phoria2 when asked for 3D charts,
diagrams, explainers or dashboards - with the reference to hand and a check that loads the page in
Chrome and reports what's wrong:

```text
/plugin marketplace add kevinroast/phoria2
/plugin install phoria2@phoria2
```

The skill inside it ([claude-plugin/skills/phoria2](claude-plugin/skills/phoria2)) follows the Agent
Skills standard, so other agents that read skills can use the folder as it is.

## Install

```sh
npm install phoria2
```

Or straight from a CDN, with no build step:

```html
<script type="module">
  import { View, Mesh, box } from 'https://cdn.jsdelivr.net/npm/phoria2/+esm'
</script>
```

To use more than the core - charts, particles, glTF, motion or editing - map each import to the package's own
files, so they share one copy of the core (the CDN's ready-made `+esm` builds each bundle their
own). Pin the version so a new release can't change your page:

```html
<script type="importmap">
{
  "imports": {
    "phoria2": "https://cdn.jsdelivr.net/npm/phoria2@1.0.0-rc.7/dist/phoria2.js",
    "phoria2/charts": "https://cdn.jsdelivr.net/npm/phoria2@1.0.0-rc.7/dist/charts.js",
    "phoria2/particles": "https://cdn.jsdelivr.net/npm/phoria2@1.0.0-rc.7/dist/particles.js",
    "phoria2/gltf": "https://cdn.jsdelivr.net/npm/phoria2@1.0.0-rc.7/dist/gltf.js",
    "phoria2/motion": "https://cdn.jsdelivr.net/npm/phoria2@1.0.0-rc.7/dist/motion.js",
    "phoria2/edit": "https://cdn.jsdelivr.net/npm/phoria2@1.0.0-rc.7/dist/edit.js"
  }
}
</script>
<script type="module">
  import { View } from 'phoria2'
  import { chart } from 'phoria2/charts'
</script>
```

## A first scene

```html
<canvas id="c" style="width: 100%; height: 100vh; display: block"></canvas>
<script type="module" src="./main.js"></script>
```

```js
import { View, Mesh, box, DirectionalLight } from 'phoria2'

const view = new View({ canvas: '#c', orbit: true, background: '#1c1c20' })
const cube = view.scene.add(new Mesh({ geometry: box(2), material: { color: 'orange' } }))
view.scene.add(new DirectionalLight({ direction: [-1, -2, -1] }))
view.start((dt) => cube.rotateY(0.6 * dt))
```

The canvas takes its size from CSS; the view matches its drawing buffer to it and follows resizes.
The camera starts fitted to the scene, and `orbit: true` lets the user turn, pan and zoom it.

## Charts

```js
import { View } from 'phoria2'
import { chart } from 'phoria2/charts'

const view = new View({ canvas: '#c', orbit: true })
view.scene.add(chart({
  mark: 'bar',
  data: rows,                         // [{ month: 'Jan', region: 'North', sales: 41 }, ...]
  x: 'month', z: 'region', y: 'sales',
  color: 'region',
  tooltip: true,
}))
```

Marks: `bar`, `point`, `line`, `area`, `surface` and `network`, with axes, legends, labels, tooltips
and animated updates (`chart.update(newRows)`). A JSON schema for specs ships as
`phoria2/charts/schema.json`.

## Models

```js
import { loadGLTF } from 'phoria2/gltf'

const model = await loadGLTF('models/chair.glb')   // .glb or .gltf
view.scene.add(model)
view.frame(model)
model.play()                                        // its first animation
```

## With React

React owns the canvas; phoria2 draws on it. Make the view once, dispose of it on unmount, and
change the scene in place when props change:

```jsx
import { useEffect, useRef } from 'react'
import { View, Mesh, box } from 'phoria2'

export function SpinningBox({ color }) {
  const canvas = useRef(null)
  const mesh = useRef(null)

  useEffect(() => {
    const view = new View({ canvas: canvas.current, orbit: true })
    mesh.current = view.scene.add(new Mesh({ geometry: box(2) }))
    view.start((dt) => mesh.current.rotateY(0.6 * dt))
    return () => view.dispose()
  }, [])

  useEffect(() => {
    mesh.current.material.color.set(color)
  }, [color])

  return <canvas ref={canvas} style={{ width: '100%', height: 320 }} />
}
```

A full example, with a chart that follows its data, is in
[`examples/react`](https://github.com/kevinroast/phoria2/tree/main/examples/react).

## What's in the package

| Import | |
|---|---|
| `phoria2` | the view, scene graph, cameras, lights, materials, geometry, curves, textures, picking, labels, bloom, `create()` from JSON |
| `phoria2/charts` | `chart()` - charts from a spec of mark, data and channels, and the scales they use |
| `phoria2/particles` | `Emitter` and `Body` |
| `phoria2/gltf` | `loadGLTF()` - glTF 2.0 models with their materials and animations |
| `phoria2/motion` | `Timeline` - named steps played in order, `follow()` along a curve, `reveal()` a path as it's travelled - for explainers and guided tours |
| `phoria2/edit` | `TransformHandle` - a move and turn handle with grid and angle snapping - and `History` for undo, for planners and layout editors |
| `phoria2/schema.json`, `phoria2/charts/schema.json` | JSON Schemas for scene descriptions (`create()`) and chart specs |

## Browsers

Any browser with WebGL 2: current Chrome, Edge, Firefox and Safari (desktop and iOS 15+).

## Examples

The [demo gallery](https://kevs3d.co.uk/phoria2/) shows each feature and a few showcase scenes;
its source is in [`demos/`](https://github.com/kevinroast/phoria2/tree/main/demos).

## Licence

MIT - see [LICENSE](LICENSE). phoria2 is a rewrite of phoria, a 2013 library that drew 3D on the
canvas 2D context.
