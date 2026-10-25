import {
  CanvasRenderer, Entity, OrbitControl, PointLight, RADIANS, Scene, generateTesselatedPlane,
  generateUnitCube,
} from 'phoria2'
import { animate, fitScene } from './shell.js'

// Live debug information - id, position and axes drawn for a cube and its animated child.
export default function run({ canvas, gui }) {
  const scene = new Scene()
  scene.camera.position = { x: 0.0, y: 5.0, z: -15.0 }
  fitScene(scene, canvas)
  new OrbitControl(canvas, scene)
  const renderer = new CanvasRenderer(canvas)

  // a grid to help visualise the camera position
  scene.graph.push(Entity.create({
    ...generateTesselatedPlane(16, 16, 0, 20),
    style: {
      drawmode: 'wireframe',
      shademode: 'lightsource',
      linewidth: 0.5,
      objectsortmode: 'back',
    },
  }))

  const testCube = Entity.create({
    id: 'cube1',
    ...generateUnitCube(1),
    style: {
      drawmode: 'solid',
    },
  })
  scene.graph.push(testCube)
  // add live debug information to the entity
  Entity.debug(testCube, {
    showId: true,
    showAxis: true,
    showPosition: true,
  })

  const childCube = Entity.create({
    id: 'cube2',
    ...generateUnitCube(0.5),
  })
  testCube.children.push(childCube)
  Entity.debug(childCube, {
    showId: true,
    showAxis: true,
    showPosition: true,
  })

  // a visible point with a light of the same colour as its child
  const addLight = (position, color) => {
    const lightObj = Entity.create({
      points: [{ ...position }],
      style: {
        color: color.map((c) => c * 255),
        drawmode: 'point',
        shademode: 'plain',
        linewidth: 5,
        linescale: 2,
      },
    })
    scene.graph.push(lightObj)
    lightObj.children.push(PointLight.create({ position, color }))
    return lightObj
  }
  const blueLightObj = addLight({ x: 0, y: 2, z: -5 }, [0, 0, 1])
  const redLightObj = addLight({ x: 0, y: 2, z: 5 }, [1, 0, 0])
  const greenLightObj = addLight({ x: 0, y: 2, z: 5 }, [0, 1, 0])

  const rotates = [0, 0, 0]

  const f = gui.addFolder('Rendering')
  f.add(testCube.style, 'drawmode', ['point', 'wireframe', 'solid'])
  f.add(testCube.style, 'shademode', ['plain', 'lightsource'])
  f.add(testCube.style, 'fillmode', ['fill', 'filltwice', 'inflate', 'fillstroke', 'hiddenline'])

  animate(() => {
    testCube.rotateY(0.5 * RADIANS)
    // the child's transform is in its parent's frame, so its swing turns with the parent
    const t = Math.sin(Date.now() / 1000)
    childCube.identity().rotateX(t).translateY(t + 3)
    // move the visible light objects around the origin - their child lights follow
    const sine = Math.sin(Date.now() / 500)
    blueLightObj.identity().rotateY(rotates[0] += 1 * RADIANS).translateY(sine)
    redLightObj.identity().rotateY(rotates[1] += 0.5 * RADIANS).translateY(sine)
    greenLightObj.identity().rotateY(rotates[2] += 1.5 * RADIANS).translateY(sine)

    scene.modelView()
    renderer.render(scene)
  })
}
