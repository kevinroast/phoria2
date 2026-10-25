import {
  CanvasRenderer, DistantLight, Entity, RADIANS, Scene, addMouseEvents, calculateClickPointAndVector,
  generateTesselatedPlane, generateUnitCube, getIntersectedObjects,
} from 'phoria2'
import { addCameraControls, animate, fitScene } from './shell.js'

// Object picking - click a spinning cube to select it and flash it white.
export default function run({ canvas, gui, info }) {
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

  const c1 = generateUnitCube()
  const cube1 = Entity.create({
    id: 'Cube Red',
    points: c1.points,
    polygons: c1.polygons,
    style: {
      color: [120, 0, 0],
    },
  })
  cube1.scaleN(1.25).rotateY(0.5).translateX(3)
  scene.graph.push(cube1)

  const c2 = generateUnitCube()
  const cube2 = Entity.create({
    id: 'Cube Blue',
    points: c2.points,
    polygons: c2.polygons,
    style: {
      color: [0, 0, 120],
    },
  })
  cube2.rotateY(1.5).translateZ(-4)
  scene.graph.push(cube2)

  const cube3 = Entity.create({
    id: 'Cube Green',
    ...generateUnitCube(),
    style: {
      color: [0, 120, 0],
    },
  })
  cube3.scaleN(0.7).rotateX(0.8).translateY(3)
  scene.graph.push(cube3)

  scene.graph.push(DistantLight.create({
    direction: { x: 0, y: -0.5, z: 1 },
    intensity: 1.25,
  }))

  info.textContent = 'Selected: [none]'

  // the picked entity and its original colour, restored after a short flash
  let lastPicked = null
  let timer = null
  const unpick = () => {
    if (lastPicked !== null) {
      lastPicked.entity.style.color = lastPicked.color
      lastPicked.entity.style.emit = 0
      lastPicked = null
    }
  }

  // pick object detection on mouse click
  const mouse = addMouseEvents(canvas, () => {
    const { clickPoint, clickVector } = calculateClickPointAndVector(scene, mouse.clickPositionX, mouse.clickPositionY)
    const intersects = getIntersectedObjects(scene, clickPoint, clickVector)
    info.textContent = `Selected: ${intersects.length !== 0 ? intersects[0].entity.id : '[none]'}`

    unpick()
    if (intersects.length !== 0) {
      const { entity } = intersects[0]
      lastPicked = { entity, color: entity.style.color }
      entity.style.color = [255, 255, 255]
      entity.style.emit = 0.5
      clearTimeout(timer)
      timer = setTimeout(unpick, 300)
    }
  })

  addCameraControls(gui, scene)
  const f = gui.addFolder('Camera Up').close()
  f.add(scene.camera.up, 'x', -10, 10, 0.1)
  f.add(scene.camera.up, 'y', -10, 10, 0.1)
  f.add(scene.camera.up, 'z', -10, 10, 0.1)

  animate(() => {
    cube1.rotateY(0.5 * RADIANS)
    cube2.rotateX(0.5 * RADIANS)
    cube3.rotateZ(0.5 * RADIANS)
    scene.modelView()
    renderer.render(scene)
  })
}
