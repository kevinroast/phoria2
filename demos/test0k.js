import {
  CanvasRenderer, DistantLight, Entity, OrbitControl, RADIANS, Scene, generateTesselatedPlane,
  generateUnitCube, loadImages, vec3,
} from 'phoria2'
import { animate, fitScene } from './shell.js'

// Move the camera around the scene - W/S forward and back, A/D strafe, left/right arrows turn,
// up/down arrows raise and lower the lookat point.
export default async function run({ canvas }) {
  const bitmaps = await loadImages([0, 1, 2, 3, 4, 5].map((i) => `images/texture${i}.png`))

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

  const cube = Entity.create(generateUnitCube())
  bitmaps.forEach((bitmap, i) => {
    cube.textures.push(bitmap)
    cube.polygons[i].texture = i
  })
  scene.graph.push(cube)
  scene.graph.push(DistantLight.create({
    direction: { x: 0, y: -0.5, z: 1 },
  }))

  // keep track of heading to generate position
  let heading = 0.0
  const lookAt = vec3.fromValues(0, -5, 15)

  // Move the camera by the `forward` offset rotated to `heading` (radians), then point it at the
  // `lookAt` offset from the new position, also rotated to the heading.
  const positionLookAt = (forward, heading, lookAt) => {
    const { position, lookat } = scene.camera
    const pos = vec3.fromValues(position.x, position.y, position.z)
    const ca = Math.cos(heading), sa = Math.sin(heading)
    let rx = forward[0] * ca - forward[2] * sa
    let rz = forward[0] * sa + forward[2] * ca
    forward[0] = rx
    forward[2] = rz
    vec3.add(pos, pos, forward)
    position.x = pos[0]
    position.y = pos[1]
    position.z = pos[2]

    rx = lookAt[0] * ca - lookAt[2] * sa
    rz = lookAt[0] * sa + lookAt[2] * ca
    vec3.add(pos, pos, vec3.fromValues(rx, lookAt[1], rz))
    lookat.x = pos[0]
    lookat.y = pos[1]
    lookat.z = pos[2]
  }

  document.addEventListener('keydown', (e) => {
    switch (e.code) {
      case 'KeyW': // move forward along current heading
        positionLookAt(vec3.fromValues(0, 0, 1), heading, lookAt)
        break
      case 'KeyS': // move back along current heading
        positionLookAt(vec3.fromValues(0, 0, -1), heading, lookAt)
        break
      case 'KeyA': // strafe left from current heading
        positionLookAt(vec3.fromValues(-1, 0, 0), heading, lookAt)
        break
      case 'KeyD': // strafe right from current heading
        positionLookAt(vec3.fromValues(1, 0, 0), heading, lookAt)
        break
      case 'ArrowLeft': // turn left - project the lookat along the new heading
        heading += RADIANS * 4
        positionLookAt(vec3.create(), heading, lookAt)
        break
      case 'ArrowRight': // turn right
        heading -= RADIANS * 4
        positionLookAt(vec3.create(), heading, lookAt)
        break
      case 'ArrowUp':
        lookAt[1]++
        positionLookAt(vec3.create(), heading, lookAt)
        break
      case 'ArrowDown':
        lookAt[1]--
        positionLookAt(vec3.create(), heading, lookAt)
        break
    }
  })


  animate(() => {
    cube.rotateY(0.5 * RADIANS)
    scene.modelView()
    renderer.render(scene)
  })
}
