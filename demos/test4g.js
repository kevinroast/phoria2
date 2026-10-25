import {
  CanvasRenderer, DistantLight, EmitterEntity, Entity, OrbitControl, Scene, clone,
  generateTesselatedPlane,
} from 'phoria2'
import { animate, fitScene } from './shell.js'

// A particle emitter with gravity - particles fountain up and fall, cycling through colours.
export default function run({ canvas, gui }) {
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
    rate: 100,
    velocity: { x: 0, y: 0.2, z: 0 },
    velocityRnd: { x: 0.05, y: 0.05, z: 0.05 },
    lifetime: 3000,
    lifetimeRnd: 300,
    onParticle(p) {
      // style references the parent emitter config - so clone a new one and modify it
      // sine/cosine a colour cycle for the particles
      const t = Date.now() / 1000
      p.style = clone(p.style)
      p.style.color = [~~(Math.sin(t) * 128) + 128, ~~(Math.sin(t / 2) * 128) + 128, ~~(Math.cos(t) * 128) + 128]
    },
  })
  scene.graph.push(emitter)

  const f = gui.addFolder('Emitter')
  f.add(emitter, 'rate', 0, 250)
  f.add(emitter, 'lifetime', 0, 5000)
  f.add(emitter, 'lifetimeRnd', 0, 5000)
  f.add(emitter, 'gravity')
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
