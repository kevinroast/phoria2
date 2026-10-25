import {
  CanvasRenderer, EmitterEntity, Entity, Scene, clone, generateTesselatedPlane, generateUnitCube, loadImage,
} from 'phoria2'
import { addCameraControls, animate, fitScene } from './shell.js'

// Blob sprite for the liquid particles - a solid centre fading out at the edge.
function generateBlob(size) {
  const buffer = document.createElement('canvas')
  const width = size << 1
  buffer.width = buffer.height = width
  const ctx = buffer.getContext('2d')
  const radgrad = ctx.createRadialGradient(size, size, size >> 1, size, size, size)
  radgrad.addColorStop(0.7, 'rgba(0,64,255,1)')
  radgrad.addColorStop(1.0, 'rgba(0,64,255,0)')
  ctx.fillStyle = radgrad
  ctx.fillRect(0, 0, width, width)
  return buffer
}

// Dynamic texturing - a paint gun of particles that splat onto a wall by drawing into its texture.
export default async function run({ canvas, gui, info }) {
  info.textContent = 'Press SPACE to reset wall texture'
  const wallImage = await loadImage('images/texture-wall.png')
  const blob = generateBlob(32)

  const scene = new Scene()
  scene.camera.position = { x: -10, y: 12, z: -22.0 }
  scene.camera.lookat = { x: 6, y: 4, z: -1 }
  fitScene(scene, canvas)
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

  // offscreen canvas for the wall texture, so the particles can paint onto it
  const TEXTURESIZE = wallImage.width
  const buffer = document.createElement('canvas')
  buffer.width = buffer.height = TEXTURESIZE
  const ctx = buffer.getContext('2d')
  ctx.drawImage(wallImage, 0, 0)

  // wall plane object - constructed in-place to avoid rotations of texture coordinates
  const wall = Entity.create({
    points: [{ x: 10, y: 0, z: -5 }, { x: 10, y: 10, z: -5 }, { x: 10, y: 10, z: 5 }, { x: 10, y: 0, z: 5 }],
    polygons: [{ vertices: [2, 1, 0, 3], texture: 0 }],
    style: {
      shademode: 'plain',
      doublesided: true,
    },
  })
  wall.textures.push(buffer)
  scene.graph.push(wall)

  // visible object to be parent of the particle emitter
  const { points: cubePoints, polygons: cubePolygons } = generateUnitCube(1)
  const cube = Entity.create({
    points: cubePoints,
    polygons: cubePolygons,
    style: {
      color: [0, 64, 255],
      shademode: 'plain',
    },
  })
  cube.translateX(-2)
  scene.graph.push(cube)

  // liquid particle emitter
  const emitter = EmitterEntity.create({
    position: { x: 0.0, y: 0.0, z: 0.0 },
    rate: 20,
    velocity: { x: 0.12, y: 0.2, z: 0.0 },
    velocityRnd: { x: 0.02, y: 0.07, z: 0.07 },
    lifetime: 5000,
    style: {
      objectsortmode: 'sorted',
      shademode: 'sprite',
      sprite: 0,
    },
    onParticle(p) {
      // style references the parent emitter config - so clone a new one and modify it
      p.style = clone(p.style)
      p.style.linewidth = 12 + (Math.random() * 8 - 4)
    },
    onScene() {
      // if a particle impacts the wall then "splat" onto the wall texture
      const { children } = this
      for (let i = children.length - 1; i >= 0; i--) {
        const p = children[i]
        if (p._worldcoords && p._worldcoords[0][0] > 10) {
          // apply decal to the texture used by the wall - map particle coordinate to a texture coordinate on the plane

          // - the texture size is a hack due to perspective scaling etc. that
          // is applied to the linewidth during rendering of the particle sprite
          const size = p.style.linewidth << 2

          // calc the offset given the texture image size and knowing that; the plane is size 10 units centred on Z axis
          // and the position of the particle is the centre point of the blob image, then invert the offset as
          // canvas draws from top left corner and our coordinate system is from the bottom corner
          const [, y, z] = p._worldcoords[0]
          ctx.drawImage(
            blob,
            TEXTURESIZE - (z + 5) * (TEXTURESIZE / 10) - size / 2,
            TEXTURESIZE - y * (TEXTURESIZE / 10) - size / 2,
            size, size,
          )

          // remove particle from scene
          children.splice(i, 1)
        }
      }
    },
  })
  emitter.textures.push(blob)
  cube.children.push(emitter)

  document.addEventListener('keydown', (e) => {
    // reset texture image
    if (e.code === 'Space') ctx.drawImage(wallImage, 0, 0)
  })

  addCameraControls(gui, scene, { lookatOpen: false })
  let f = gui.addFolder('Camera Up').close()
  f.add(scene.camera.up, 'x', -10, 10, 0.1)
  f.add(scene.camera.up, 'y', -10, 10, 0.1)
  f.add(scene.camera.up, 'z', -10, 10, 0.1)
  f = gui.addFolder('Emitter')
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
