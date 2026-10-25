import {
  DistantLight, Entity, OrbitControl, RADIANS, Scene, generateTesselatedPlane,
} from 'phoria2'
import { CanvasRenderer } from 'phoria2/canvas'
import { head as headModel } from './data/test2-data.js'
import { animate, fitScene } from './shell.js'

// A hand crafted object - a head model defined directly as points and polygons.
export default function run({ canvas, gui }) {
  const scene = new Scene()
  scene.camera.position = { x: 0.0, y: 5.0, z: -15.0 }
  fitScene(scene, canvas)
  new OrbitControl(canvas, scene)
  const renderer = new CanvasRenderer(canvas)

  // a grid to help visualise the camera position
  scene.graph.push(Entity.create({
    ...generateTesselatedPlane(16, 16, 0, 20),
    style: {
      drawmode: 'wireframe',
      shademode: 'plain',
      linewidth: 0.5,
      objectsortmode: 'back',
    },
  }))

  const head = Entity.create({
    ...headModel,
    style: {
      color: [245, 185, 240],
      drawmode: 'solid',
      fillmode: 'inflate',
    },
  })
  head.scaleN(0.75).translateY(-2)
  scene.graph.push(head)
  scene.graph.push(new DistantLight())

  const f = gui.addFolder('Rendering')
  f.add(head.style, 'drawmode', ['point', 'solid'])
  f.add(head.style, 'shademode', ['plain', 'lightsource'])
  f.add(head.style, 'fillmode', ['fill', 'filltwice', 'inflate', 'fillstroke', 'hiddenline'])

  animate(() => {
    head.rotateY(0.5 * RADIANS)
    scene.modelView()
    renderer.render(scene)
  })
}
