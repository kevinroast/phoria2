import { View, Mesh, Label, DirectionalLight, box, sphere, plane } from 'phoria2'

const view = new View({
  canvas: '#scene', background: '#1c1c22', orbit: true,
  highlight: '#ffffff',
  tooltip: (hit) => `${hit.node.name} - click to change its colour`,
})
view.scene.environment = 'studio'
view.scene.add(new DirectionalLight({ direction: [-1, -2, -1], castShadow: true }))
view.scene.add(new Mesh({
  geometry: plane({ size: 8, segments: 80 }), receiveShadow: true, pickable: false,
  material: {
    color: '#44444f',
    shader: {
      vertex: `
        float r = length(local.xz), phase = r * 5.0 - uTime * 2.0;
        float h = 0.07 * exp(-r * 0.5);
        local.y += sin(phase) * h;
        vec2 slope = local.xz / max(r, 1e-3) * cos(phase) * 5.0 * h;
        n = normalize(vec3(-slope.x, 1.0, -slope.y));`,
    },
  },
}))
const cube = view.scene.add(new Mesh({
  name: 'Cube', geometry: box(), position: [-1, 0.5, 0], castShadow: true,
  material: { color: 'tomato', roughness: 0.3 },
}))
const ball = view.scene.add(new Mesh({
  name: 'Ball', geometry: sphere(0.6), position: [1, 0.6, 0], castShadow: true,
  material: { color: 'gold', metalness: 1, roughness: 0.2 },
}))
cube.add(new Label({ text: 'Cube', position: [0, 0.6, 0],
  place: 'above', className: 'tag' }))
ball.add(new Label({ text: 'Ball', position: [0, 0.7, 0],
  place: 'above', className: 'tag' }))

const colours = ['mediumseagreen', 'royalblue', 'orchid', 'tomato', 'gold']
let turn = 0
view.on('click', (hit) => {
  if (hit?.node instanceof Mesh) {
    hit.node.material.color.set(colours[turn++ % colours.length])
  }
})

view.start((dt) => cube.rotateY(0.6 * dt))
