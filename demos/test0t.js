import {
  CanvasRenderer, DistantLight, Entity, OrbitControl, RADIANS, Scene, generateTesselatedPlane,
  generateUnitCube, loadImages,
} from 'phoria2'
import { animate, fitScene } from './shell.js'

// A cube with a different texture on each face. Space reverses the texture order.
export default async function run({ canvas }) {
  const bitmaps = await loadImages([0, 1, 2, 3, 4, 5].map((i) => `images/texture${i}.png`))

  const scene = new Scene()
  scene.camera.position = { x: 0.0, y: 5.0, z: -15.0 }
  fitScene(scene, canvas)
  new OrbitControl(canvas, scene)
  const renderer = new CanvasRenderer(canvas)

  // a grid to help visualise the camera position
  scene.graph.push(Entity.create({
    ...generateTesselatedPlane(8, 8, 0, 20),
    style: {
      shademode: 'plain',
      drawmode: 'wireframe',
      linewidth: 0.5,
      objectsortmode: 'back',
    },
  }))

  const cube = Entity.create(generateUnitCube())
  bitmaps.forEach((bitmap, i) => {
    cube.textures.push(bitmap)
    cube.polygons[i].texture = i
  })
  scene.graph.push(cube)
  scene.graph.push(DistantLight.create({
    direction: { x: 0, y: -0.5, z: 1 },
  }))


  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      for (let i = 0; i < 6; i++) cube.polygons[i].texture = 5 - i
    }
  })

  animate(() => {
    cube.rotateY(0.5 * RADIANS)
    scene.modelView()
    renderer.render(scene)
  })
}
