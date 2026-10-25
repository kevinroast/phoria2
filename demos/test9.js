import {
  Entity, OrbitControl, RADIANS, Scene, TWOPI, generateRadialGradientBitmap,
  generateTesselatedPlane, mat4, vec4,
} from 'phoria2'
import { CanvasRenderer } from 'phoria2/canvas'
import { EmitterEntity, PhysicsEntity } from 'phoria2/particles'
import { animate, fitScene } from './shell.js'

const Rnd = (s) => Math.random() * s

// random starfield object - centered on the origin
function generateStarfield(num, scale = 1) {
  const s = scale / 2
  const points = []
  for (let i = 0; i < num; i++) {
    // TODO: points too close to the origin (i.e. camera view point) should be discarded
    points.push({ x: Math.random() * scale - s, y: Math.random() * scale - s, z: Math.random() * scale - s })
  }
  return Entity.create({
    points,
    style: {
      color: [200 + ~~(Math.random() * 55), 200 + ~~(Math.random() * 55), 200 + ~~(Math.random() * 55)],
      drawmode: 'point',
      shademode: 'plain',
      linewidth: 0.75,
      objectsortmode: 'back',
    },
  })
}

// sparkle bitmap - random lines radiating from the centre
function generateSparkle(size, color) {
  const buffer = document.createElement('canvas')
  buffer.width = buffer.height = size
  const w = size / 2, ww = w - (size / 8)
  const ctx = buffer.getContext('2d')
  ctx.strokeStyle = color
  ctx.beginPath()
  for (let i = 0; i < 128; i++) {
    ctx.moveTo(w, w)
    ctx.lineTo(Math.cos(Rnd(TWOPI)) * ww + w, Math.sin(Rnd(TWOPI)) * ww + w)
  }
  ctx.closePath()
  ctx.stroke()
  return buffer
}

// Full window fireworks: each launch is a physics entity carrying a particle emitter, with
// scene handlers switching the emitter from rocket trail to sparkle explosion.
export default function run({ canvas }) {
  canvas.style.backgroundColor = '#000'
  const overlay = document.createElement('div')
  overlay.textContent = 'Press SPACE or click to launch a firework!'
  Object.assign(overlay.style, {
    position: 'absolute', top: '0', width: '100%', zIndex: '100', pointerEvents: 'none',
    color: '#fff', textAlign: 'center', fontFamily: 'monospace',
  })
  document.body.append(overlay)

  const scene = new Scene()
  scene.camera.position = { x: 0, y: 25.0, z: -60.0 }
  scene.camera.lookat = { x: 0.0, y: 15.0, z: 0.0 }
  fitScene(scene, canvas)
  new OrbitControl(canvas, scene)
  const renderer = new CanvasRenderer(canvas)

  // a grid to help visualise the camera position
  scene.graph.push(Entity.create({
    ...generateTesselatedPlane(16, 16, 0, 40),
    style: {
      color: [160, 255, 160],
      drawmode: 'wireframe',
      shademode: 'plain',
      linewidth: 0.5,
      objectsortmode: 'back',
    },
  }))
  scene.graph.push(generateStarfield(500, 2000))

  // firework bitmap effect - sparkle/flicker etc.
  //  - is a firework an emitter that itself has physics, is shot up into the air and eventually explodes
  const bitmaps = [
    generateRadialGradientBitmap(16, 'rgba(128,64,32,1)', 'rgba(128,64,32,0)'),
    ...['rgba(255,128,160,0.2)', 'rgba(128,255,160,0.2)', 'rgba(128,160,255,0.2)', 'rgba(255,128,255,0.2)',
      'rgba(255,255,160,0.2)', 'rgba(160,255,255,0.2)', 'rgba(255,255,255,0.2)'].map((c) => generateSparkle(32, c)),
  ]

  // rotate the camera around the scene
  scene.onCamera((position) => {
    const rotMatrix = mat4.create()
    mat4.rotateY(rotMatrix, rotMatrix, Math.sin(Date.now() / 10000) * RADIANS * 360)
    vec4.transformMat4(position, position, rotMatrix)
  })

  let emit = false
  scene.triggerHandlers.push({
    trigger() {
      if (!emit) return
      emit = false
      const emitter = EmitterEntity.create({
        position: { x: Rnd(-20) + 10, y: 0, z: Rnd(-20) + 10 },
        positionRnd: { x: 0.12 + Rnd(0.05), y: 0.12 + Rnd(0.05), z: 0.12 + Rnd(0.05) },
        rate: 50 + ~~Rnd(50),
        velocity: { x: 0, y: 0, z: 0 },
        velocityRnd: { x: 0.0, y: 0.12 + Rnd(0.05), z: 0.0 },
        lifetime: 450 + ~~Rnd(100),
        lifetimeRnd: 150 + ~~Rnd(100),
        gravity: true,
        style: {
          compositeOperation: 'lighter',
          linewidth: 12 + ~~Rnd(4),
          // start with the sprite for a rocket engine effect
          shademode: 'sprite',
          sprite: 0,
        },
        onParticle(particle) {
          // add custom render method to particle - randomly rotating sprite effect
          // not actually used until the 'callback' sprite mode is set later
          particle.onRender((ctx, x, y, w) => {
            ctx.translate(x, y)
            // v1 passed TWOPI to Math.random(), which ignores it - kept for the same look
            ctx.rotate(Math.random())
            ctx.drawImage(emitter.textures[0], -w, -w, w + w, w + w)
          })
        },
      })
      emitter.textures.push(bitmaps[0])

      const emitterHandle = new PhysicsEntity()
      // per-firework state lives in the closure rather than as ad-hoc properties on the entity
      const explodeY = 7 + Rnd(3)
      let exploded = 0
      emitterHandle.onScene(function () {
        if (!exploded && explodeY < this.worldposition[1]) {
          exploded = Date.now()
          emitter.velocity = { x: 0, y: -0.2, z: 0 }
          emitter.velocityRnd = { x: 0.4 + Rnd(0.2), y: 0.4 + Rnd(0.2), z: 0.4 + Rnd(0.2) }
          emitter.gravity = false
          emitter.rate = 300 + ~~Rnd(200)

          // change sprite style to star sparkle effect
          // select a random bitmap from the list of sparkle bitmap images
          emitter.style.shademode = 'callback'
          emitter.textures[0] = bitmaps[~~Rnd(bitmaps.length - 1) + 1]
        }
        if (exploded && Date.now() - exploded > 200) {
          emitter.rate = 0
          // remove once the last particle has gone
          if (emitter.children.length === 0) {
            const i = scene.graph.indexOf(this)
            if (i !== -1) scene.graph.splice(i, 1)
          }
        }
      })
      emitterHandle.impulse({ x: 0, y: 1700 + Rnd(300), z: 0 })
      emitterHandle.children.push(emitter)
      scene.graph.push(emitterHandle)
    },
  })

  canvas.addEventListener('click', () => {
    emit = true
  })
  canvas.addEventListener('touchend', (e) => {
    e.preventDefault()
    emit = true
  })
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') emit = true
  })

  animate(() => {
    scene.modelView()
    renderer.render(scene)
  })
}
