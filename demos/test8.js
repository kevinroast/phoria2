import {
  CanvasRenderer, DistantLight, EmitterEntity, Entity, PointLight, Scene, generateRadialGradientBitmap,
} from 'phoria2'
import { animate, fitScene } from './shell.js'

// Cobra Mk III
const COBRA = {
  points: [
    { x: 0, y: 15, z: 0 }, { x: 16, y: -0.5, z: 32.5 }, { x: -16, y: -0.5, z: 32.5 },
    { x: 16, y: -15, z: -32.5 }, { x: -16, y: -15, z: -32.5 }, { x: -44, y: 10, z: -32.5 },
    { x: -60, y: -3, z: -13 }, { x: -65, y: -3, z: -32.5 }, { x: 44, y: 10, z: -32.5 },
    { x: 60, y: -3, z: -13 }, { x: 65, y: -3, z: -32.5 }, { x: 0, y: 15, z: -32.5 },
  ],
  polygons: [
    [8, 0, 1], [1, 0, 2], [9, 1, 3], [1, 2, 4], [3, 1, 4], [6, 7, 4], [2, 0, 5], [6, 2, 5], [4, 2, 6], [6, 5, 7],
    [11, 0, 8], [5, 11, 8], [7, 5, 8], [4, 7, 8], [3, 4, 8], [10, 3, 8], [8, 1, 9], [10, 8, 9], [3, 10, 9], [5, 0, 11],
  ],
}

// Each ship gets its own copy of the geometry, as the scene sorts polygons in place.
const createCobra = () => Entity.create({
  points: COBRA.points.map((p) => ({ ...p })),
  polygons: COBRA.polygons.map((vertices) => ({ vertices: [...vertices] })),
  style: {
    color: [200, 202, 210],
    shademode: 'lightsource',
  },
}).scaleN(0.2)

// random starfield object - centered on the origin
function generateStarfield(num, scale = 1) {
  const s = scale / 2
  const points = []
  for (let i = 0; i < num; i++) {
    points.push({ x: Math.random() * scale - s, y: Math.random() * scale - s, z: Math.random() * scale - s })
  }
  return Entity.create({
    points,
    style: {
      color: [200 + ~~(Math.random() * 55), 200 + ~~(Math.random() * 55), 200 + ~~(Math.random() * 55)],
      drawmode: 'point',
      shademode: 'plain',
      linewidth: 0.5,
      linescale: 200,
      objectsortmode: 'back',
    },
  })
}

// Full window space scene: a comet lights up passing ships, then triggers move the camera to
// follow it as it climbs and explodes.
export default function run({ canvas }) {
  canvas.style.backgroundColor = '#000'

  const scene = new Scene()
  scene.camera.position = { x: -150, y: 15.0, z: -25.0 }
  scene.camera.lookat = { x: 0.0, y: 2.0, z: 0.0 }
  fitScene(scene, canvas)
  const renderer = new CanvasRenderer(canvas)

  const starfield = generateStarfield(2000, 5000)
  starfield.matrix = null
  scene.graph.push(starfield)

  const sun = Entity.create({
    id: 'sun',
    points: [{ x: 0, y: 0, z: 100 }],
    style: {
      color: [255, 255, 0],
      drawmode: 'point',
      shademode: 'plain',
      linewidth: 1000,
      linescale: 1,
      objectsortmode: 'back',
    },
  })
  sun.matrix = null
  scene.graph.push(sun)

  // fake sun light
  scene.graph.push(DistantLight.create({
    color: [1, 1, 0.5],
    direction: { x: 0.5, y: 0.5, z: -1 },
    intensity: 1,
  }))

  const cobra1 = createCobra(), cobra2 = createCobra(), cobra3 = createCobra()
  cobra1.translateY(-500).rotateX(-Math.PI * 0.5)
  cobra1.onScene(function () {
    this.translateZ(2.5)
    this.rotateZ(Math.PI * 0.003)
  })
  cobra2.translateX(175).translateY(-600).rotateX(-Math.PI * 0.45)
  cobra2.onScene(function () {
    this.translateZ(2.75)
    this.rotateZ(-Math.PI * 0.001)
  })
  cobra3.translateZ(-100).translateY(-450).rotateX(-Math.PI * 0.55)
  cobra3.onScene(function () {
    this.translateZ(2.35)
    this.rotateZ(Math.PI * 0.002)
  })

  // comet - particle emitter
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
      linewidth: 32,
      sprite: 0,
    },
  })
  emitter.textures.push(generateRadialGradientBitmap(32, 'rgba(128,128,140,1)', 'rgba(128,128,160,0)'))
  // start over to the left, and move along the X axis
  emitter.translateX(-200)
  let emitterVel = [0.5, 0, 0]
  emitter.onScene(function () {
    this.translate(emitterVel)
  })
  scene.graph.push(emitter)
  // emitter is a source of light
  emitter.children.push(PointLight.create({
    color: [0.95, 0.95, 1],
    intensity: 5,
  }))

  // add the cobras last to make them easy to remove
  scene.graph.push(cobra1, cobra2, cobra3)

  // camera track the emitter object position
  scene.onCamera((position, lookAt) => {
    if (emitter.worldposition) {
      lookAt[0] = emitter.worldposition[0]
      lookAt[1] = emitter.worldposition[1]
      lookAt[2] = emitter.worldposition[2]
    }
  })

  // triggers for camera animation etc.
  const then = Date.now() / 100
  scene.triggerHandlers.push({
    trigger() {
      // once emitter goes past us, remove the cobras from the scene
      if (emitter.worldposition[0] > 0) {
        scene.graph.splice(scene.graph.length - 3, 3)
        return true
      }
    },
  })
  scene.triggerHandlers.push({
    trigger() {
      // once emitter goes past us, move camera above the object and track along with it
      if (emitter.worldposition[0] > 0) {
        scene.camera.position.x = emitter.worldposition[0]
        scene.camera.position.y = 30
        scene.camera.position.z = (Date.now() / 100) - then - 150
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
