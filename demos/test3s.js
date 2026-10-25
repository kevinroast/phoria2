import { DistantLight, Entity, PointLight, RADIANS, Scene, SoftwareRenderer, generateSphere } from 'phoria2'
import { addCameraControls, animate, fitScene } from './shell.js'

// The prototype software renderer rasterising a finely tesselated lit sphere into an ImageData buffer.
export default function run({ canvas, gui }) {
  const scene = new Scene()
  scene.camera.position = { x: 0.0, y: 5.0, z: -15.0 }
  fitScene(scene, canvas)
  const renderer = new SoftwareRenderer(canvas)

  const sphere = Entity.create({
    ...generateSphere(1, 64, 128),
    style: {
      diffuse: 1,
      specular: 64,
      shademode: 'lightsource',
    },
  })
  sphere.scaleN(3)
  scene.graph.push(sphere)

  scene.graph.push(DistantLight.create({
    color: [0.5, 0.5, 1.0],
    intensity: 0.25,
    direction: { x: 0, y: -1, z: 1 },
  }))
  // the software renderer only draws solid polygons, so this indicator point is not visible
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
    Object.assign(visibleLightObj.points[0], light.position)
    scene.modelView()
    renderer.render(scene)
  })
}
