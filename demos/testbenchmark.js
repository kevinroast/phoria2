import {
  DistantLight, Entity, OrbitControl, PointLight, Scene, generateRadialGradientBitmap,
  generateSphere, generateTesselatedPlane, generateUnitCube, loadImages,
} from 'phoria2'
import { CanvasRenderer } from 'phoria2/canvas'
import { EmitterEntity } from 'phoria2/particles'
import { animate, fitScene } from './shell.js'

const DENSITY = 3

const sphere = (scale, generateUVs) => generateSphere(scale, DENSITY * 4, DENSITY * 8, generateUVs)

// Benchmark: one of each kind of object - plain, textured, point and wireframe cubes and spheres,
// sprite particles, distant and point lights - all spinning. Watch the FPS readout.
export default async function run({ canvas }) {
  canvas.style.backgroundColor = '#333'
  const [wallTexture, cubeTexture] = await loadImages(['images/texture-wall.png', 'images/texture5.png'])

  const scene = new Scene()
  scene.camera.position = { x: 0.0, y: 15.0, z: -30.0 }
  fitScene(scene, canvas)
  new OrbitControl(canvas, scene)
  const renderer = new CanvasRenderer(canvas)

  // a grid to help visualise the camera position
  const { points, edges } = generateTesselatedPlane(DENSITY * 2, DENSITY * 2, 0, 25)
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

  // plain cube
  scene.graph.push(Entity.create(generateUnitCube(1.5)).translateX(-3))

  // textured cube
  const texturedCube = Entity.create({
    ...generateUnitCube(1.5),
    style: {
      texture: 0,
    },
  })
  texturedCube.textures.push(cubeTexture)
  scene.graph.push(texturedCube.translateX(3))

  // plain sphere
  let s = sphere(2)
  scene.graph.push(Entity.create({
    points: s.points,
    polygons: s.polygons,
    style: {
      color: [255, 128, 64],
      diffuse: 0.5,
      specular: 64,
    },
  }).translateX(-3).translateY(4))

  // textured sphere
  s = sphere(2, true)
  const texturedSphere = Entity.create({
    points: s.points,
    polygons: s.polygons,
    style: {
      color: [255, 255, 255],
      texture: 0,
    },
  })
  texturedSphere.textures.push(wallTexture)
  scene.graph.push(texturedSphere.translateX(3).translateY(4))

  // point spheres
  scene.graph.push(Entity.create({
    points: sphere(2).points,
    style: {
      drawmode: 'point',
      shademode: 'plain',
      linewidth: 1,
    },
  }).translateX(8).translateY(4))
  scene.graph.push(Entity.create({
    points: sphere(1).points,
    style: {
      drawmode: 'point',
      linescale: 0.5,
    },
  }).translateX(8).translateY(8))

  // wireframe spheres
  s = sphere(2)
  scene.graph.push(Entity.create({
    points: s.points,
    edges: s.edges,
    style: {
      drawmode: 'wireframe',
      shademode: 'plain',
      linewidth: 1,
    },
  }).translateX(-8).translateY(4))
  s = sphere(1)
  scene.graph.push(Entity.create({
    points: s.points,
    edges: s.edges,
    style: {
      drawmode: 'wireframe',
      linescale: 0.5,
    },
  }).translateX(-8).translateY(8))

  // particle emitter bitmaps
  const emitter = EmitterEntity.create({
    position: { x: 0, y: -5, z: 0 },
    positionRnd: { x: 0.25, y: 0.1, z: 0.25 },
    rate: DENSITY * 50,
    velocity: { x: 0, y: 0.25, z: -0.2 },
    velocityRnd: { x: 0.05, y: 0.05, z: 0.05 },
    lifetime: 2500,
    lifetimeRnd: 0,
    style: {
      compositeOperation: 'lighter',
      shademode: 'sprite',
      objectsortmode: 'sorted',
      linewidth: 16,
      sprite: 0,
    },
  })
  emitter.textures.push(generateRadialGradientBitmap(16, 'rgba(128,64,32,1)', 'rgba(128,64,32,0)'))
  scene.graph.push(emitter)

  scene.graph.push(DistantLight.create({
    direction: { x: 0, y: 0.3, z: 1 },
  }))
  scene.graph.push(PointLight.create({
    position: { x: 5, y: 5, z: -8 },
    intensity: 1.0,
    attenuation: 0.1,
  }))


  animate(() => {
    // spin everything except the grid
    for (let i = 1; i < scene.graph.length; i++) {
      if (scene.graph[i] instanceof Entity) scene.graph[i].rotateY(0.005)
    }
    scene.modelView()
    renderer.render(scene)
  })
}
