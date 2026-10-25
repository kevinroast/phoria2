import {
  CanvasRenderer, DistantLight, Entity, OrbitControl, PointLight, RADIANS, Scene,
  generateTesselatedPlane, importGeometryWavefront,
} from 'phoria2'
import { animate, fitScene } from './shell.js'

// The Wavefront .obj importer - a teapot loaded from teapot.obj, lit by a movable point light.
export default async function run({ canvas, gui }) {
  const obj = await importGeometryWavefront({
    url: 'teapot.obj',
    scaleTo: 5,
    reorder: false,
    center: true,
  })

  const scene = new Scene()
  scene.camera.position = { x: 0.0, y: 4.0, z: -15.0 }
  fitScene(scene, canvas)
  new OrbitControl(canvas, scene)
  const renderer = new CanvasRenderer(canvas)

  // a grid to help visualise the camera position
  scene.graph.push(Entity.create({
    ...generateTesselatedPlane(16, 16, 0, 20),
    style: {
      drawmode: 'wireframe',
      shademode: 'plain',
      linewidth: 0.5,
      objectsortmode: 'back',
    },
  }))

  const teapot = Entity.create({
    points: obj.points,
    polygons: obj.polygons,
    style: {
      specular: 0,
      drawmode: 'solid',
      shademode: 'lightsource',
      fillmode: 'inflate',
    },
  })
  teapot.scaleN(2)
  scene.graph.push(teapot)

  scene.graph.push(DistantLight.create({
    color: [0.5, 0.5, 1.0],
    intensity: 0.25,
    direction: { x: 0, y: -1, z: 1 },
  }))
  const visibleLightObj = Entity.create({
    points: [{ x: -2, y: 4, z: -6 }],
    style: {
      color: [255, 255, 255],
      drawmode: 'point',
      shademode: 'plain',
      linewidth: 5,
      linescale: 2,
    },
  })
  scene.graph.push(visibleLightObj)
  const light = PointLight.create({
    color: [1, 0.4, 0],
    position: { x: -2, y: 4, z: -6 },
    intensity: 0.75,
    attenuation: 0.03,
  })
  visibleLightObj.children.push(light)

  let f = gui.addFolder('Rendering').close()
  f.add(teapot.style, 'shademode', ['plain', 'lightsource'])
  f.add(teapot.style, 'doublesided')
  f = gui.addFolder('Light')
  f.add(light.position, 'x', -25, 25, 0.1)
  f.add(light.position, 'y', -25, 25, 0.1)
  f.add(light.position, 'z', -25, 25, 0.1)
  f.add(light.color, '0', 0, 1, 0.1).name('red')
  f.add(light.color, '1', 0, 1, 0.1).name('green')
  f.add(light.color, '2', 0, 1, 0.1).name('blue')
  f.add(light, 'intensity', 0, 1, 0.1)
  f.add(light, 'attenuation', 0.01, 0.25, 0.01)

  animate(() => {
    teapot.rotateY(0.5 * RADIANS)
    // the light position is edited directly via the GUI - update the visible indicator
    Object.assign(visibleLightObj.points[0], light.position)
    scene.modelView()
    renderer.render(scene)
  })
}
