// Every demo, in gallery order. `name` is the module in demos/ and the ?name= of demo.html. A
// `section` starts a new heading in the gallery. `orbit: false` marks demos without mouse orbiting -
// they drive the camera, or use the mouse for something else - so the page doesn't advertise it.
// `hint` replaces the line under the title that says how to use the mouse; '' shows none. A name may
// have spaces - the page shows it as written; its module, its ?name= and its thumbnail use slug(name).
// where the code lives - the demos link to their own source there
export const REPO = 'https://github.com/kevinroast/phoria2'

/** A demo's name as its module, its ?name= and its thumbnail have it: spaces as hyphens. @param {string} name */
export const slug = (name) => name.replaceAll(' ', '-')

export const DEMOS = [
  { section: 'Charts and diagrams', name: 'bars', title: 'a bar chart from a spec - axes, legend, value labels, animated updates' },
  { name: 'scatter', title: 'a 3D scatter of customers from a spec - legend, tooltips, flat projections' },
  { name: 'timeseries', title: 'visitors over time - stacked areas, ribbons in depth or lines, live data' },
  { name: 'surface', title: 'latency by hour and day as heat-coloured surface, tweens to new data' },
  { name: 'network', title: 'a service dependency map - force or tiered layout, flowing traffic, failures' },
  { name: 'topology', title: 'a network topology built by hand - status colours, hover to trace links, live traffic' },
  { name: 'dashboard', title: 'eight chart tiles, each its own view, idle until touched' },
  { name: 'chartlab', title: 'every chart mark, axis and legend option, a view each - live updates, stress test' },
  { name: 'graph', title: 'a memory graph of points and thousands of additive links - hover to light a neighbourhood' },
  { name: 'floorplan', title: 'a data hall floor plan - isometric or plan view, rack heat map, image export' },
  { name: 'planner', title: 'office floor planner - drag furniture in, select, move and turn it with a handle, snapping, undo' },
  { name: 'city', title: 'a city as data - 1,500 instanced buildings coloured by energy use, occupancy, age or use' },
  
  { section: 'Features', name: 'hello', title: 'a minimal scene, with the whole program' },
  { name: 'scene-json', title: 'a scene as plain JSON - edit it, add to it, rebuild it, export it' },
  { name: 'materials', title: 'roughness and metalness under a movable light and the studio environment' },
  { name: 'advanced materials', title: 'glass, clearcoat, cloth sheen, reflectance, brushed metal and paper lanterns' },
  { name: 'lights', title: 'lights in two moods - sunset and neon - and a swinging lamp that carries its spot light' },
  { name: 'textures', title: 'photo textures with normal and ARM maps, a live canvas screen, nearest and linear filtering' },
  { name: 'colour', title: 'colour - HSL cylinder, RGB cube, light adding and filters multiplying, harmony swatches', hint: '' },
  { name: 'particles', title: 'particle emitters in three set pieces - a fountain, a brazier and falling snow' },
  { name: 'fog shadows', title: 'a harbour on a foggy night - lamps and a lighthouse beam casting shadows through mist' },
  { name: 'point lights', title: "a jack-o'-lantern - candle inside casting shadows, light escaping through the carved face" },
  { name: 'viewer', title: 'a glTF product viewer - full material maps, an HDR studio, shadows, animation' },
  { name: 'models', title: 'hand-made models from raw points and polygons - drawn solid, as edges and as points' },
  { name: 'guided tour', title: 'a guided tour of a data centre - cards pinned beside each stop, clickable pins, followable inspection robot', hint: 'Next and Back, the arrow keys or a numbered pin · drag to look around' },
  
  { section: 'Showcase', name: 'solar', title: 'a solar system - nested orbits, planets painted in code, click to follow a planet' },
  { name: 'artemis', title: 'an animated infographic of Artemis IV - the Blue Moon lander mission, step by step timeline' },
  { name: 'cpu', title: 'a processor going into its socket - exploded layers, glowing traces and bloom' },
  { name: 'engine', title: 'an inline four engine, cut away - pistons, valves and crank running inside' },
  { name: 'carbide', title: 'Carbide, the Robot Wars champion 2017 - a double wedge on yellow wheels, steel bar weapon' },
  { name: 'volcano', title: 'a volcano erupting, cut away to show the magma inside - callouts with leader lines' },
  { name: 'cells', title: 'an animal and a plant cell, cut open - a labelled science poster, hover a part to light it' },
  { name: 'skull', title: 'human skull as an anatomy plate - bones coloured and named in Latin, click to explode view' },
  { name: 'cad', title: 'a pillow-block bearing as an engineering drawing - four views, dimensions, exploded parts', hint: '' },
  { name: 'galaxy', title: 'a spiral galaxy - 200,000 additive stars, old and young, round a glowing core' },
  { name: 'fireworks', title: 'fireworks over a city across the water - rockets with physics, four burst shapes, reflections' },
  { name: 'paint', title: 'a paint cannon - click the wall to aim; drops splat and drip into its canvas textures', orbit: false },
  { name: 'schematic', title: 'a pistol as an exploded parts poster - numbered parts and legend, explode and assemble', hint: 'Explode or Assemble · hover a part or the legend' },

  // tests of the API on bigger tasks go here with hidden: true - reachable by name
  // (demo.html?name=...), not listed in the gallery
]
