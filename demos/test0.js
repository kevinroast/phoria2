import {
  CanvasRenderer, DistantLight, Entity, RADIANS, Scene, generateTesselatedPlane, generateUnitCube,
} from 'phoria2'
import { addCameraControls, animate, fitScene } from './shell.js'

// A lit cube spinning on a wireframe grid - the minimal phoria scene.
export default function run({ canvas, gui }) {
  const scene = new Scene()
  scene.camera.position = { x: 0.0, y: 5.0, z: -15.0 }
  fitScene(scene, canvas)
  const renderer = new CanvasRenderer(canvas)

  // a grid to help visualise the camera position
  const plane = generateTesselatedPlane(8, 8, 0, 20)
  scene.graph.push(Entity.create({
    points: plane.points,
    edges: plane.edges,
    polygons: plane.polygons,
    style: {
      drawmode: 'wireframe',
      shademode: 'plain',
      linewidth: 0.5,
      objectsortmode: 'back',
    },
  }))

  const c = generateUnitCube()
  const cube = Entity.create({
    points: c.points,
    edges: c.edges,
    polygons: c.polygons,
  })
  scene.graph.push(cube)
  scene.graph.push(new DistantLight())

  addCameraControls(gui, scene)
  let f = gui.addFolder('Camera Up').close()
  f.add(scene.camera.up, 'x', -10, 10, 0.1)
  f.add(scene.camera.up, 'y', -10, 10, 0.1)
  f.add(scene.camera.up, 'z', -10, 10, 0.1)
  f = gui.addFolder('Rendering')
  f.add(cube.style, 'drawmode', ['point', 'wireframe', 'solid'])
  f.add(cube.style, 'shademode', ['plain', 'lightsource'])
  f.add(cube.style, 'fillmode', ['fill', 'filltwice', 'inflate', 'fillstroke', 'hiddenline'])

  animate(() => {
    cube.rotateY(0.5 * RADIANS)
    scene.modelView()
    renderer.render(scene)
  })
}
