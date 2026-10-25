import {
  DistantLight, Entity, Scene, generateRadialGradientBitmap, generateTesselatedPlane,
} from 'phoria2'
import { CanvasRenderer } from 'phoria2/canvas'
import { EmitterEntity } from 'phoria2/particles'
import { animate, fitScene } from './shell.js'

// Scene triggers chaining a sequence of actions - a comet flies past, climbs, then explodes.
export default function run({ canvas }) {
  const scene = new Scene()
  scene.camera.position = { x: -150, y: 15.0, z: -25.0 }
  scene.camera.lookat = { x: 0.0, y: 2.0, z: 0.0 }
  fitScene(scene, canvas)
  const renderer = new CanvasRenderer(canvas)

  // a big grid to help visualise the camera position
  const { points, edges } = generateTesselatedPlane(20, 20, 0, 500)
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

  // particle emitter
  const emitter = EmitterEntity.create({
    positionRnd: { x: 0, y: 0.15, z: 0 },
    rate: 75,
    velocity: { x: -0.15, y: 0, z: 0 },
    velocityRnd: { x: 0.05, y: 0, z: 0 },
    lifetime: 1000,
    lifetimeRnd: 500,
    gravity: false,
    style: {
      compositeOperation: 'lighter',
      shademode: 'sprite',
      linewidth: 16,
      sprite: 0,
    },
  })
  emitter.textures.push(generateRadialGradientBitmap(32, 'rgba(128,64,32,1)', 'rgba(128,64,32,0)'))
  // start over to the left, and move along the X axis
  emitter.translateX(-200)
  let emitterVel = [0.5, 0, 0]
  emitter.onScene(function () {
    this.translate(emitterVel)
  })
  scene.graph.push(emitter)

  // camera track the emitter object position
  scene.onCamera((position, lookAt) => {
    if (emitter.worldposition) {
      lookAt[0] = emitter.worldposition[0]
      lookAt[1] = emitter.worldposition[1]
      lookAt[2] = emitter.worldposition[2]
    }
  })

  // triggers for camera animation etc.
  scene.triggerHandlers.push({
    trigger() {
      // once emitter goes past us, move camera above the object and track along with it
      if (emitter.worldposition[0] > -50) {
        scene.camera.position.x = emitter.worldposition[0]
        scene.camera.position.y = 30
        scene.camera.position.z = -15
      }
      // emitter goes up when it passes a certain point
      if (emitter.worldposition[0] > 150) {
        // tween the velocity x/y of the object (and the particle output velocity)
        if (emitterVel[1] < 0.5) {
          emitter.velocity.x += 0.003
          emitter.velocity.y -= 0.003
          emitterVel[0] -= 0.01
          emitterVel[1] += 0.01
        } else {
          // once the velocity is fully set, start the next trigger
          scene.triggerHandlers.push({
            trigger() {
              // once it is high enough, blow it up!
              if (emitter.worldposition[1] > 100) {
                emitter.velocity = { x: 0, y: 0, z: 0 }
                emitter.velocityRnd = { x: 1, y: 1, z: 1 }
                emitter.gravity = true
                emitter.rate = 500
                emitter.style.linewidth = 32
                emitterVel = [0, 0, 0]
                const time = Date.now()
                scene.triggerHandlers.push({
                  trigger() {
                    // end the explosion after a few ms
                    if (Date.now() > time + 300) {
                      emitter.rate = 0
                      return true
                    }
                  },
                })
                return true
              }
            },
          })
          return true
        }
      }
    },
  })


  animate(() => {
    scene.modelView()
    renderer.render(scene)
  })
}
