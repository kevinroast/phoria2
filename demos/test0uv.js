import {
  CanvasRenderer, DistantLight, Entity, RADIANS, Scene, combine, generatePyramid, generateSphere,
  generateTesselatedPlane, generateUnitCube, loadImages, vec3,
} from 'phoria2'
import { addCameraControls, animate, fitScene } from './shell.js'

// UV coordinates selecting parts of a texture: a tiled plane, quarters of a texture on cube faces,
// a section of a wall texture on a pyramid, and lit and plain textured spheres.
export default async function run({ canvas, gui }) {
  const [wall, texture5] = await loadImages(['images/texture-wall.png', 'images/texture5.png'])

  const scene = new Scene()
  scene.camera.position = { x: 0.0, y: 20.0, z: -25.0 }
  scene.camera.lookat = { x: 0.0, y: 1.0, z: 0.0 }
  fitScene(scene, canvas)
  const renderer = new CanvasRenderer(canvas)

  // a subdivided plane to show the benefit of uv coords on a large object
  const plane = Entity.create({
    ...generateTesselatedPlane(4, 4, 0, 20, true),
    style: {
      shademode: 'plain',
      texture: 0,
    },
  })
  plane.translateY(-1)
  plane.textures.push(texture5)
  scene.graph.push(plane)

  const cube = Entity.create(generateUnitCube(2))
  cube.textures.push(texture5)
  // select a quarter of the texture for each of the first four cube faces
  const quarters = [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]]
  quarters.forEach(([x, y], i) => {
    cube.polygons[i].texture = 0
    cube.polygons[i].uvs = [0 + x, 0 + y, 0.5 + x, 0 + y, 0.5 + x, 0.5 + y, 0 + x, 0.5 + y]
  })
  scene.graph.push(cube)

  const pyramid = Entity.create({
    ...generatePyramid(2),
    style: {
      texture: 0,
    },
  })
  pyramid.textures.push(wall)
  // select a section of the wall texture for the pyramid sides
  for (let i = 0; i < 4; i++) pyramid.polygons[i].uvs = [0.5, 0, 1, 0, 0.75, 0.5]
  pyramid.translateY(2)
  scene.graph.push(pyramid)

  const { points, polygons } = generateSphere(1.5, 8, 16, true)
  const sphere = Entity.create({
    points,
    polygons,
    style: {
      color: [255, 128, 64],
      diffuse: 0.5,
      specular: 64,
      texture: 0,
    },
  })
  sphere.translateY(6)
  sphere.translateX(2)
  const spherePlain = new Entity()
  combine(spherePlain, sphere)
  spherePlain.style.shademode = 'plain'
  spherePlain.translateX(-5)
  spherePlain.scale(vec3.fromValues(1, 3, 1))
  sphere.textures.push(texture5)
  spherePlain.textures.push(texture5)
  scene.graph.push(sphere, spherePlain)

  scene.graph.push(DistantLight.create({
    direction: { x: 0, y: -1, z: 1 },
    intensity: 1.5,
  }))

  addCameraControls(gui, scene)
  const f = gui.addFolder('Camera Up').close()
  f.add(scene.camera.up, 'x', -10, 10, 0.1)
  f.add(scene.camera.up, 'y', -10, 10, 0.1)
  f.add(scene.camera.up, 'z', -10, 10, 0.1)

  animate(() => {
    cube.rotateY(0.5 * RADIANS)
    pyramid.rotateY(-0.25 * RADIANS)
    sphere.rotateY(-0.25 * RADIANS)
    spherePlain.rotateY(0.25 * RADIANS)
    scene.modelView()
    renderer.render(scene)
  })
}
