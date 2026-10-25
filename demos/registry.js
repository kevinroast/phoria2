// Every demo, in gallery order. `name` is the module in demos/ and the ?name= of demo.html. A
// `section` starts a new heading in the gallery. `orbit: false` marks demos that drive the camera
// themselves, so the page doesn't advertise mouse orbiting.
export const DEMOS = [
  { section: 'Charts and diagrams', name: 'bars', title: 'a 3D bar chart - bound data, tooltips, value labels that give way' },
  { name: 'scatter', title: 'a 3D scatter of customers - tooltips, a legend, flat projections' },
  { name: 'topology', title: 'a network topology - status colours, hover to trace links, live traffic' },
  { name: 'floorplan', title: 'a data hall floor plan - isometric or plan view, rack heat map, image export' },
  { name: 'city', title: 'an isometric city of instanced buildings - orthographic or perspective' },
  { section: 'Features', name: 'hello', title: 'the minimal scene: a lit cube, a grid and a label' },
  { name: 'drawmodes', title: 'one geometry drawn solid, as edges and as points - and see-through' },
  { name: 'materials', title: 'roughness and metalness under a movable light and the studio environment' },
  { name: 'lights', title: 'coloured point lights orbiting a cube, with a child that follows its parent' },
  { name: 'textures', title: 'a texture per face - six textured planes in a group' },
  { name: 'models', title: 'hand-made models from raw points and polygons' },
  { name: 'particles', title: 'particle emitters - fountain, flame and snow' },
  { name: 'scene-json', title: 'a scene as plain JSON - edit it, rebuild it, export it' },
  { section: 'Showcase', name: 'solar', title: 'a solar system - nested orbits, a sun that lights the planets, click to follow' },
  { name: 'galaxy', title: 'a spiral galaxy of 50,000 additive points' },
  { name: 'fireworks', title: 'fireworks - rockets with physics, trails and sparkling bursts' },
  { name: 'paint', title: 'a paint gun - particles splat into a canvas texture on the wall' },
  { name: 'space', title: 'Cobra Mk IIIs and a comet - a short flight with a moving light', orbit: false },
]
