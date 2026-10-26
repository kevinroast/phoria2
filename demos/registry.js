// Every demo, in gallery order. `name` is the module in demos/ and the ?name= of demo.html. A
// `section` starts a new heading in the gallery. `orbit: false` marks demos without mouse orbiting -
// they drive the camera, or use the mouse for something else - so the page doesn't advertise it.
export const DEMOS = [
  { section: 'Charts and diagrams', name: 'bars', title: 'a bar chart from a spec - axes, legend, value labels, animated updates' },
  { name: 'scatter', title: 'a 3D scatter of customers from a spec - legend, tooltips, flat projections' },
  { name: 'timeseries', title: 'visitors over time - stacked areas, ribbons in depth or lines, with live data' },
  { name: 'surface', title: 'latency by hour and day as a heat-coloured surface that tweens to new data' },
  { name: 'network', title: 'a service dependency map - force or tiered layout, flowing traffic, failures' },
  { name: 'graph', title: 'a memory graph of points and thousands of additive links - hover to light a neighbourhood' },
  { name: 'dashboard', title: 'eight chart tiles, each its own view, idle until touched' },
  { name: 'topology', title: 'a network topology built by hand - status colours, hover to trace links, live traffic' },
  { name: 'floorplan', title: 'a data hall floor plan - isometric or plan view, rack heat map, image export' },
  { name: 'city', title: 'a city as data - 1,500 instanced buildings coloured by energy use, occupancy, age or use, with tooltips' },
  { section: 'Features', name: 'hello', title: 'the minimal scene, with the whole program beside it' },
  { name: 'scene-json', title: 'a scene as plain JSON - edit it, add to it, rebuild it, export it' },
  { name: 'materials', title: 'roughness and metalness under a movable light and the studio environment' },
  { name: 'lights', title: 'lights in two moods - sunset and neon - and a swinging lamp that carries its spot light' },
  { name: 'textures', title: 'photo textures with normal and ARM maps, a live canvas screen, nearest and linear filtering' },
  { name: 'particles', title: 'particle emitters in three set pieces - a fountain, a brazier and falling snow' },
  { name: 'viewer', title: 'a glTF product viewer - full material maps, an HDR studio, shadows, animation' },
  { name: 'models', title: 'hand-made models from raw points and polygons - drawn solid, as edges and as points' },
  { section: 'Showcase', name: 'solar', title: 'a solar system - nested orbits, planets painted in code, a sun that lights them, click to follow' },
  { name: 'galaxy', title: 'a spiral galaxy - 60,000 additive stars, old and young, round a glowing core' },
  { name: 'fireworks', title: 'fireworks over a city across the water - rockets with physics, four burst shapes, reflections' },
  { name: 'paint', title: 'a paint cannon - click the wall to aim; drops splat and drip into its canvas textures', orbit: false },
  //{ name: 'space', title: 'Cobra Mk IIIs over a gas giant as a comet flies by - and an Elite mode in green vector lines', orbit: false },
]
