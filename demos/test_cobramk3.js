import { Entity, OrbitControl, PointLight, RADIANS, Scene } from 'phoria2'
import { CanvasRenderer } from 'phoria2/canvas'
import { animate, fitScene } from './shell.js'

// The Elite Cobra Mk III, lit by a point light - set its yaw, pitch and roll from the controls.
export default function run({ canvas, gui }) {
  const scene = new Scene()
  scene.camera.position = { x: 0.0, y: 5.0, z: -35.0 }
  fitScene(scene, canvas)
  new OrbitControl(canvas, scene)
  const renderer = new CanvasRenderer(canvas)

  const cobra1 = Entity.create({
    points: [
      { x: 0.00000, y: 15.00000, z: 0.00000 },
      { x: 16.00000, y: -0.50000, z: 32.50000 },
      { x: -16.00000, y: -0.50000, z: 32.50000 },
      { x: 16.00000, y: -15.00000, z: -32.50000 }, // 3
      { x: -16.00000, y: -15.00000, z: -32.50000 },
      { x: -44.00000, y: 10.00000, z: -32.50000 },
      { x: -60.00000, y: -3.00000, z: -13.00000 },
      { x: -65.00000, y: -3.00000, z: -32.50000 },
      { x: 44.00000, y: 10.00000, z: -32.50000 }, // 8
      { x: 60.00000, y: -3.00000, z: -13.00000 },
      { x: 65.00000, y: -3.00000, z: -32.50000 }, // 10
      { x: 0.00000, y: 15.00000, z: -32.50000 },
    ],
    polygons: [
      { vertices: [8, 0, 1] },
      { vertices: [1, 0, 2] },
      { vertices: [9, 1, 3] },
      { vertices: [1, 2, 4] },
      { vertices: [3, 1, 4] },
      { vertices: [6, 7, 4] },
      { vertices: [2, 0, 5] },
      { vertices: [6, 2, 5] },
      { vertices: [4, 2, 6] },
      { vertices: [6, 5, 7] },
      { vertices: [11, 0, 8] },
      { vertices: [5, 11, 8] },
      { vertices: [7, 5, 8] },
      { vertices: [4, 7, 8] },
      { vertices: [3, 4, 8] },
      { vertices: [10, 3, 8] },
      { vertices: [8, 1, 9] },
      { vertices: [10, 8, 9] },
      { vertices: [3, 10, 9] },
      { vertices: [5, 0, 11] },
    ],
    style: {
      color: [200, 202, 210],
    },
  })
  scene.graph.push(cobra1)

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

  const ypr = { yaw: 0, pitch: 0, roll: 0 }

  let f = gui.addFolder('Light').close()
  f.add(light.position, 'x', -25, 25, 0.1)
  f.add(light.position, 'y', -25, 25, 0.1)
  f.add(light.position, 'z', -25, 25, 0.1)
  f.add(light.color, '0', 0, 1, 0.1).name('red')
  f.add(light.color, '1', 0, 1, 0.1).name('green')
  f.add(light.color, '2', 0, 1, 0.1).name('blue')
  f.add(light, 'intensity', 0, 1, 0.1)
  f.add(light, 'attenuation', 0.01, 0.25, 0.01)
  f = gui.addFolder('YawPitchRoll')
  f.add(ypr, 'yaw', -180, 180)
  f.add(ypr, 'pitch', -180, 180)
  f.add(ypr, 'roll', -180, 180)

  animate(() => {
    // the model is defined at 10x scale - scale it down each frame along with the rotation
    cobra1.identity().scaleN(0.1).rotateYPR(ypr.yaw * RADIANS, ypr.pitch * RADIANS, ypr.roll * RADIANS)
    // the light position is edited directly via the GUI - update the visible indicator
    Object.assign(visibleLightObj.points[0], light.position)
    scene.modelView()
    renderer.render(scene)
  })
}
