import {
  Entity, OrbitControl, PointLight, RADIANS, Scene, generateSphere, generateTesselatedPlane,
} from 'phoria2'
import { CanvasRenderer } from 'phoria2/canvas'
import { animate, fitScene } from './shell.js'

// Material test: a 3x3 grid of spheres - diffuse increases bottom to top, specular power left to right.
export default function run({ canvas, gui }) {
  const scene = new Scene()
  scene.camera.position = { x: 0.0, y: 5.0, z: -15.0 }
  fitScene(scene, canvas)
  new OrbitControl(canvas, scene)
  const renderer = new CanvasRenderer(canvas)

  // a grid to help visualise the camera position
  scene.graph.push(Entity.create({
    ...generateTesselatedPlane(8, 8, 0, 20),
    style: {
      drawmode: 'wireframe',
      shademode: 'plain',
      linewidth: 0.5,
      objectsortmode: 'back',
    },
  }))

  const spheres = []
  for (let x = 0; x < 3; x++) {
    for (let y = 0; y < 3; y++) {
      const { points, polygons } = generateSphere(1, 12, 24)
      const sphere = Entity.create({
        points,
        polygons,
        style: {
          color: [255, 100 + (y * 32), x * 64],
          diffuse: 0.25 * (y + 1),
          specular: 64 * (x + 1),
        },
      })
      scene.graph.push(sphere)
      spheres.push(sphere)
      sphere.translateX(x * 2 - 1.5).translateY(y * 2 - 1.5)
    }
  }

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
    position: { x: -3, y: 4, z: -5 },
    intensity: 1.0,
    attenuation: 0.05,
  })
  visibleLightObj.children.push(light)

  const f = gui.addFolder('Light')
  f.add(light.position, 'x', -25, 25, 0.1)
  f.add(light.position, 'y', -25, 25, 0.1)
  f.add(light.position, 'z', -25, 25, 0.1)
  f.add(light.color, '0', 0, 1, 0.1).name('red')
  f.add(light.color, '1', 0, 1, 0.1).name('green')
  f.add(light.color, '2', 0, 1, 0.1).name('blue')
  f.add(light, 'intensity', 0, 1, 0.1)
  f.add(light, 'attenuation', 0.01, 0.25, 0.01)

  animate(() => {
    for (const sphere of spheres) sphere.rotateY(0.5 * RADIANS)
    // the light position is edited directly via the GUI - update the visible indicator
    Object.assign(visibleLightObj.points[0], light.position)
    scene.modelView()
    renderer.render(scene)
  })
}
