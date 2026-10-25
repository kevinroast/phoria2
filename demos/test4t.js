import {
  DistantLight, Entity, OrbitControl, Scene, generateRadialGradientBitmap, generateTesselatedPlane,
} from 'phoria2'
import { CanvasRenderer } from 'phoria2/canvas'
import { EmitterEntity } from 'phoria2/particles'
import { animate, fitScene } from './shell.js'

// Sprite particles drawn with additive blending - a flame effect.
export default function run({ canvas, gui }) {
  canvas.style.backgroundColor = '#000'

  const scene = new Scene()
  scene.camera.position = { x: 0.0, y: 5.0, z: -25.0 }
  scene.camera.lookat = { x: 0.0, y: 2.0, z: 0.0 }
  fitScene(scene, canvas)
  new OrbitControl(canvas, scene)
  const renderer = new CanvasRenderer(canvas)

  // a grid to help visualise the camera position
  const { points, edges } = generateTesselatedPlane(8, 8, 0, 20)
  scene.graph.push(Entity.create({
    points,
    edges,
    style: {
      drawmode: 'wireframe',
      shademode: 'plain',
      linewidth: 0.5,
      objectsortmode: 'back',
    },
  }))
  scene.graph.push(new DistantLight())

  const emitter = EmitterEntity.create({
    position: { x: 0, y: 0, z: 0 },
    positionRnd: { x: 0.25, y: 0.1, z: 0.25 },
    rate: 75,
    velocity: { x: 0.15, y: 0.15, z: 0 },
    velocityRnd: { x: 0.05, y: 0.05, z: 0.05 },
    lifetime: 2500,
    lifetimeRnd: 250,
    style: {
      compositeOperation: 'lighter',
      shademode: 'sprite',
      linewidth: 32,
      objectsortmode: 'front',
      sprite: 0,
    },
  })
  emitter.textures.push(generateRadialGradientBitmap(32, 'rgba(128,64,32,1)', 'rgba(128,64,32,0)'))
  scene.graph.push(emitter)

  const f = gui.addFolder('Emitter')
  f.add(emitter.style, 'linewidth', 8, 64)
  f.add(emitter, 'rate', 0, 250)
  f.add(emitter, 'lifetime', 0, 5000)
  f.add(emitter, 'lifetimeRnd', 0, 5000)
  const addXYZ = (prop, min, max, step) => {
    for (const k of ['x', 'y', 'z']) f.add(emitter[prop], k, min, max, step).name(`${prop}.${k}`)
  }
  addXYZ('position', -10, 10, 0.1)
  addXYZ('positionRnd', 0, 5, 0.05)
  addXYZ('velocity', -1, 1, 0.01)
  addXYZ('velocityRnd', 0, 1, 0.01)

  animate(() => {
    scene.modelView()
    renderer.render(scene)
  })
}
