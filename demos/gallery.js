import {
  CanvasRenderer, Entity, PointLight, RADIANS, Scene, generateTesselatedPlane, generateUnitCube,
} from 'phoria2'
import { DEMOS } from './registry.js'
import { animate, fitScene } from './shell.js'

const list = document.getElementById('demos')
for (const { name, title } of DEMOS) {
  const li = document.createElement('li')
  li.innerHTML = `<a href="demo.html?name=${name}"><span class="name">${name}</span>${title}</a>`
  list.append(li)
}

// The front page scene: a spinning cube with a bobbing child cube, lit by three coloured point
// lights orbiting at different speeds.
const canvas = document.getElementById('canvas')
const scene = new Scene()
scene.camera.position = { x: 0.0, y: 5.0, z: -15.0 }
fitScene(scene, canvas)
const renderer = new CanvasRenderer(canvas)

const plane = generateTesselatedPlane(16, 16, 0, 20)
scene.graph.push(Entity.create({
  points: plane.points,
  edges: plane.edges,
  polygons: plane.polygons,
  style: {
    drawmode: 'wireframe',
    linewidth: 0.5,
    objectsortmode: 'back',
  },
}))

const testCube = Entity.create({ ...generateUnitCube(1), style: { drawmode: 'solid' } })
scene.graph.push(testCube)
const childCube = Entity.create({
  ...generateUnitCube(0.5),
  style: { color: [0, 0, 0], drawmode: 'wireframe' },
})
testCube.children.push(childCube)

// a visible point for each light, with the light itself as a child so it follows the point
const orbitingLight = (position, color) => {
  const marker = Entity.create({
    points: [position],
    style: {
      color: color.map((c) => c * 255),
      drawmode: 'point',
      shademode: 'plain',
      linewidth: 5,
      linescale: 2,
    },
  })
  marker.children.push(PointLight.create({ position, color }))
  scene.graph.push(marker)
  return marker
}
const lights = [
  { marker: orbitingLight({ x: 0, y: 2, z: -5 }, [0, 0, 1]), speed: 1, angle: 0 },
  { marker: orbitingLight({ x: 0, y: 2, z: 5 }, [1, 0, 0]), speed: 0.5, angle: 0 },
  { marker: orbitingLight({ x: 0, y: 2, z: 5 }, [0, 1, 0]), speed: 1.5, angle: 0 },
]

animate(() => {
  testCube.rotateY(0.5 * RADIANS)
  // the child's translation combines with the parent's rotation
  childCube.identity().translateY(Math.sin(Date.now() / 1000) + 3)
  const sine = Math.sin(Date.now() / 500)
  for (const light of lights) {
    light.marker.identity().rotateY(light.angle += light.speed * RADIANS).translateY(sine)
  }
  scene.modelView()
  renderer.render(scene)
})
