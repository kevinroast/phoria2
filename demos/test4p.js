import {
  DistantLight, Entity, OrbitControl, PointLight, RADIANS, Scene, clone, generateTesselatedPlane,
  mat4, vec4,
} from 'phoria2'
import { CanvasRenderer } from 'phoria2/canvas'
import { EmitterEntity } from 'phoria2/particles'
import { animate, fitScene } from './shell.js'

// Particles that are point lights - each one lights the floor as it falls.
export default function run({ canvas, gui }) {
  canvas.style.backgroundColor = '#000'

  const scene = new Scene()
  scene.camera.position = { x: 0.0, y: 5.0, z: -25.0 }
  scene.camera.lookat = { x: 0.0, y: 2.0, z: 0.0 }
  fitScene(scene, canvas)
  new OrbitControl(canvas, scene)
  // swing the camera back and forth around the scene
  scene.onCamera((position) => {
    const rotMatrix = mat4.create()
    mat4.rotateY(rotMatrix, rotMatrix, Math.sin(Date.now() / 10000) * RADIANS * 360)
    vec4.transformMat4(position, position, rotMatrix)
  })
  const renderer = new CanvasRenderer(canvas)

  // a lit floor for the particles to illuminate
  scene.graph.push(Entity.create({
    ...generateTesselatedPlane(32, 32, 0, 20),
    style: {
      color: [160, 160, 160],
      drawmode: 'solid',
      shademode: 'lightsource',
      linewidth: 0.5,
      objectsortmode: 'back',
    },
  }))
  scene.graph.push(new DistantLight())

  const emitter = EmitterEntity.create({
    position: { x: 0, y: 0, z: 0 },
    positionRnd: { x: 5, y: 0, z: 5 },
    rate: 5,
    velocity: { x: 0, y: 0.2, z: 0 },
    velocityRnd: { x: 0.2, y: 0.05, z: 0.2 },
    lifetime: 0,
    lifetimeRnd: 0,
    onParticle(p) {
      // style references the parent emitter config - so clone a new one and modify it
      // sine/cosine a colour cycle for the particles
      const t = Date.now() / 1000
      p.style = clone(p.style)
      p.style.color = [~~(Math.sin(t) * 128) + 128, ~~(Math.sin(t / 2) * 128) + 128, ~~(Math.cos(t) * 128) + 128]

      // add light to the particle as a child object, yep I know, mental.
      p.children.push(PointLight.create({
        intensity: 0.75,
        attenuation: 0.2,
        attenuationFactor: 'squared',
        color: p.style.color.map((c) => c / 255),
      }))
    },
    onScene() {
      // remove particle if it impacts the floor at Y=0
      const { children } = this
      for (let i = children.length - 1; i >= 0; i--) {
        const p = children[i]
        if (p._worldcoords && p._worldcoords[0][1] < 0) children.splice(i, 1)
      }
    },
  })
  scene.graph.push(emitter)

  const f = gui.addFolder('Emitter')
  f.add(emitter, 'rate', 0, 250)
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
