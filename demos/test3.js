import {
  CanvasRenderer, DistantLight, Entity, PointLight, RADIANS, Scene, generateSphere, generateTesselatedPlane,
} from 'phoria2'
import { addCameraControls, animate, fitScene } from './shell.js'

// A sphere with specular point lighting - the light can be moved and recoloured from the controls.
export default function run({ canvas, gui }) {
  const scene = new Scene()
  scene.camera.position = { x: 0.0, y: 5.0, z: -15.0 }
  fitScene(scene, canvas)
  const renderer = new CanvasRenderer(canvas)

  // a grid to help visualise the camera position
  scene.graph.push(Entity.create({
    ...generateTesselatedPlane(8, 8, 0, 20),
    style: {
      drawmode: 'wireframe',
      shademode: 'plain',
      linewidth: 0.5,
      objectsortmode: 'unsorted',
    },
  }))

  const sphere = Entity.create({
    ...generateSphere(1, 24, 48),
    style: {
      diffuse: 1,
      specular: 128,
    },
  })
  sphere.scaleN(3)
  scene.graph.push(sphere)

  scene.graph.push(DistantLight.create({
    color: [0.5, 0.5, 1.0],
    intensity: 0.25,
    direction: { x: 0, y: -1, z: 1 },
  }))
  const visibleLightObj = Entity.create({
    points: [{ x: -3, y: 4, z: -5 }],
    style: {
      color: [255, 255, 255],
      drawmode: 'point',
      shademode: 'plain',
      linewidth: 5,
      linescale: 2,
    },
  })
  scene.graph.push(visibleLightObj)
  const light = PointLight.create({
    color: [1, 0.4, 0],
    position: { x: -3, y: 4, z: -5 },
    intensity: 0.75,
    attenuation: 0.05,
  })
  visibleLightObj.children.push(light)

  addCameraControls(gui, scene)
  let f = gui.addFolder('Camera Up').close()
  f.add(scene.camera.up, 'x', -10, 10, 0.1)
  f.add(scene.camera.up, 'y', -10, 10, 0.1)
  f.add(scene.camera.up, 'z', -10, 10, 0.1)
  f = gui.addFolder('Rendering')
  f.add(sphere.style, 'drawmode', ['point', 'wireframe', 'solid'])
  f.add(sphere.style, 'shademode', ['plain', 'lightsource'])
  f.add(sphere.style, 'fillmode', ['fill', 'filltwice', 'inflate', 'fillstroke', 'hiddenline'])
  f.add(sphere.style, 'doublesided')
  f = gui.addFolder('Light')
  f.add(light.position, 'x', -25, 25, 0.1)
  f.add(light.position, 'y', -25, 25, 0.1)
  f.add(light.position, 'z', -25, 25, 0.1)
  f.add(light.color, '0', 0, 1, 0.1).name('red')
  f.add(light.color, '1', 0, 1, 0.1).name('green')
  f.add(light.color, '2', 0, 1, 0.1).name('blue')
  f.add(light, 'intensity', 0, 1, 0.1)
  f.add(light, 'attenuation', 0.01, 0.25, 0.01)

  animate(() => {
    sphere.rotateY(0.5 * RADIANS)
    // the light position is edited directly via the GUI - update the visible indicator
    Object.assign(visibleLightObj.points[0], light.position)
    scene.modelView()
    renderer.render(scene)
  })
}
