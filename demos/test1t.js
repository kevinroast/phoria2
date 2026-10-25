import {
  CanvasRenderer, Entity, PointLight, RADIANS, Scene, generateIcosahedron, generateTesselatedPlane,
  generateUnitCube, loadImage, subdivide,
} from 'phoria2'
import { addCameraControls, animate, fitScene } from './shell.js'

// Transparent polygons, plain and textured: a see-through textured cube with a transparent child
// sphere, lit by three coloured point lights orbiting the origin.
export default async function run({ canvas, gui }) {
  // load the wall texture before anything else
  const wall = await loadImage('images/texture-wall.png')

  const scene = new Scene()
  scene.camera.position = { x: 0.0, y: 5.0, z: -15.0 }
  fitScene(scene, canvas)
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
    ...generateUnitCube(1.5),
    style: {
      texture: 0,
      opacity: 0.5,
      fillmode: 'fill',
      doublesided: true,
    },
  })
  testCube.textures.push(wall)
  scene.graph.push(testCube)

  const ico = generateIcosahedron(1.5)
  const childObj = Entity.create({
    ...subdivide(ico.points, ico.polygons),
    style: {
      opacity: 0.5,
      fillmode: 'fill',
      doublesided: true,
    },
  })
  testCube.children.push(childObj)

  // a visible point for each light - the light is a child so it follows the point around
  const lightObj = (color, z) => {
    const obj = Entity.create({
      points: [{ x: 0, y: 2, z }],
      style: {
        color: color.map((c) => c * 255),
        drawmode: 'point',
        shademode: 'plain',
        linewidth: 5,
        linescale: 2,
      },
    })
    obj.children.push(PointLight.create({ position: { x: 0, y: 2, z }, color }))
    scene.graph.push(obj)
    return obj
  }
  const blueLightObj = lightObj([0, 0, 1], -5)
  const redLightObj = lightObj([1, 0, 0], 5)
  const greenLightObj = lightObj([0, 1, 0], 5)

  addCameraControls(gui, scene)
  let f = gui.addFolder('Camera Up').close()
  f.add(scene.camera.up, 'x', -10, 10, 0.1)
  f.add(scene.camera.up, 'y', -10, 10, 0.1)
  f.add(scene.camera.up, 'z', -10, 10, 0.1)
  f = gui.addFolder('Rendering')
  f.add(childObj.style, 'shademode', ['plain', 'lightsource'])
  f.add(childObj.style, 'fillmode', ['fill', 'filltwice', 'inflate', 'fillstroke'])

  const rotates = [0, 0, 0]
  animate(() => {
    testCube.rotateY(0.5 * RADIANS)
    // the child's transform is in its parent's frame, so its swing turns with the parent
    const s = Math.sin(Date.now() / 1000)
    childObj.identity().rotateX(s).translateY(s + 3)
    // move the visible light objects around the origin - which carries their child lights too
    const sine = Math.sin(Date.now() / 500)
    blueLightObj.identity().rotateY(rotates[0] += 1 * RADIANS).translateY(sine)
    redLightObj.identity().rotateY(rotates[1] += 0.5 * RADIANS).translateY(sine)
    greenLightObj.identity().rotateY(rotates[2] += 1.5 * RADIANS).translateY(sine)
    scene.modelView()
    renderer.render(scene)
  })
}
