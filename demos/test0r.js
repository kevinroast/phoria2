import {
  DistantLight, Entity, RADIANS, Scene, addMouseEvents, generateTesselatedPlane, generateUnitCube,
} from 'phoria2'
import { CanvasRenderer } from 'phoria2/canvas'
import { animate, fitScene } from './shell.js'

// Incremental rotation of a cube about its local axes, eased towards the GUI angles or a mouse drag.
export default function run({ canvas, gui }) {
  const scene = new Scene()
  scene.camera.position = { x: 0.0, y: 5.0, z: -15.0 }
  fitScene(scene, canvas)
  const renderer = new CanvasRenderer(canvas)

  // a grid to help visualise the camera position
  scene.graph.push(Entity.create({
    ...generateTesselatedPlane(8, 8, 0, 20),
    style: {
      shademode: 'plain',
      drawmode: 'wireframe',
      linewidth: 0.5,
      objectsortmode: 'back',
    },
  }))

  const cube = Entity.create(generateUnitCube(1.5))
  cube.polygons.forEach((poly, i) => {
    poly.color = [42 * i, 256 - (42 * i), (128 + (42 * i)) % 256]
  })
  scene.graph.push(cube)
  Entity.debug(cube, {
    showAxis: true,
  })

  scene.graph.push(DistantLight.create({
    direction: { x: 0, y: -0.5, z: 1 },
  }))

  // mouse rotation and position tracking
  const mouse = addMouseEvents(canvas)

  // target rotation, current rotation and the per-frame step towards it
  const rot = {
    x: 0, y: 0, z: 0,
    velx: 0, vely: 0, velz: 0,
    nowx: 0, nowy: 0, nowz: 0,
    ratio: 0.1,
  }

  const f = gui.addFolder('Spin Local Axis (or use mouse)')
  f.add(rot, 'x', -180, 180)
  f.add(rot, 'y', -180, 180)
  f.add(rot, 'z', -180, 180)

  animate(() => {
    rot.nowx += (rot.velx = (mouse.velocityV - rot.x - rot.nowx) * rot.ratio)
    rot.nowy += (rot.vely = (rot.y - rot.nowy) * rot.ratio)
    rot.nowz += (rot.velz = (mouse.velocityH - rot.z - rot.nowz) * rot.ratio)
    cube.rotateX(-rot.velx * RADIANS).rotateY(-rot.vely * RADIANS).rotateZ(-rot.velz * RADIANS)

    scene.modelView()
    renderer.render(scene)
  })
}
