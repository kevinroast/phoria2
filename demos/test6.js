import {
  CanvasRenderer, Entity, OrbitControl, Scene, generateTesselatedPlane, mat4, vec4,
} from 'phoria2'
import { animate, fitScene } from './shell.js'

// some random x/y data to construct our graph object from
const DATA = [
  0, 0, 5, 15, 10, 10, 15, 25, 20, 25, 25, 20, 30, 30, 35, 15, 40, 20, 45, 25, 50, 20, 55, 20, 60, 25, 65, 35,
  70, 20, 75, 25, 80, 20, 85, 15, 90, 25, 100, 50,
]

// Convert an x/y dataset into a 3D object of points and lines - with optional scaling factor.
function generateGraph(data, scale) {
  const points = [], edges = []
  for (let i = 0; i < data.length; i += 2) {
    points.push({ x: data[i] * scale, y: data[i + 1] * scale, z: 0 })
    if (i > 0) edges.push({ a: i / 2 - 1, b: i / 2 })
  }
  return Entity.create({
    points,
    edges,
    style: {
      color: [255, 128, 64],
      drawmode: 'wireframe',
      shademode: 'plain',
      linewidth: 4,
      linescale: 1,
      objectsortmode: 'back',
    },
  })
}

// Data visualisation - a line graph in 3D on a grid, with the camera orbiting it.
export default function run({ canvas }) {
  canvas.style.backgroundColor = '#fff'

  const scene = new Scene()
  scene.camera.position = { x: 0.0, y: 2, z: -20.0 }
  scene.camera.lookat = { x: 0.0, y: 2, z: 0 }
  scene.perspective.fov = 25
  fitScene(scene, canvas)
  new OrbitControl(canvas, scene)

  // rotate the camera around the scene
  let rotation = 0.0
  scene.onCamera((position) => {
    const rotMatrix = mat4.create()
    mat4.rotateY(rotMatrix, rotMatrix, rotation)
    rotation -= 0.01
    vec4.transformMat4(position, position, rotMatrix)
  })
  const renderer = new CanvasRenderer(canvas)

  // a grid for the graph background
  const grid = Entity.create({
    ...generateTesselatedPlane(10, 10, 0, 10),
    style: {
      drawmode: 'wireframe',
      shademode: 'plain',
      linewidth: 0.5,
      objectsortmode: 'back',
    },
  })
  grid.translateY(5)
  grid.rotateX(Math.PI / 2)
  scene.graph.push(grid)

  // axis lines for the grid
  scene.graph.push(Entity.create({
    points: [{ x: -5, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }, { x: -5, y: 10, z: 0 }],
    edges: [{ a: 0, b: 1 }, { a: 0, b: 2 }],
    style: {
      color: [0, 0, 0],
      drawmode: 'wireframe',
      shademode: 'plain',
      linewidth: 4,
      linescale: 1,
      objectsortmode: 'back',
    },
  }))

  // the graph itself, translated to show it slightly away from the grid
  const graph = generateGraph(DATA, 0.1)
  graph.translateX(-5).translateZ(-0.5)
  scene.graph.push(graph)


  animate(() => {
    scene.modelView()
    renderer.render(scene)
  })
}
