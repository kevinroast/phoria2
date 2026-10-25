import {
  Entity, OrbitControl, PointLight, RADIANS, Scene, generatePyramid, generateTesselatedPlane, mat4,
  quat, vec3,
} from 'phoria2'
import { CanvasRenderer } from 'phoria2/canvas'
import { animate, fitScene } from './shell.js'

// Rotate an object about the WORLD or its LOCAL X/Y/Z axes using quaternions, lit by a movable
// point light. Arrow keys also rotate.
export default function run({ canvas, gui }) {
  const scene = new Scene()
  scene.camera.position = { x: 0.0, y: 5.0, z: -35.0 }
  fitScene(scene, canvas)
  new OrbitControl(canvas, scene)
  const renderer = new CanvasRenderer(canvas)

  // a grid to help visualise the camera position
  scene.graph.push(Entity.create({
    ...generateTesselatedPlane(8, 8, 0, 40),
    style: {
      shademode: 'plain',
      drawmode: 'wireframe',
      linewidth: 0.5,
      objectsortmode: 'back',
    },
  }))

  const { points, polygons } = generatePyramid(3)
  points[4].y *= 2
  const obj = Entity.create({ points, polygons })
  scene.graph.push(obj)
  Entity.debug(obj, {
    showAxis: true,
  })

  // a point light with a visible indicator
  const visibleLightObj = Entity.create({
    points: [{ x: -3, y: 4, z: -5 }],
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
    position: { x: -6, y: 6, z: -5 },
    intensity: 1,
    attenuation: 0.05,
  })
  visibleLightObj.children.push(light)

  const rot = {
    x: 0,
    y: 0,
    z: 0,
    lastx: 0,
    lasty: 0,
    lastz: 0,
    worldaxis: true,
  }

  // rotate the object's matrix about a world or local axis
  const rotateAbout = (axis, degrees) => {
    const q = quat.setAxisAngle(quat.create(), axis, degrees * RADIANS)
    const m = mat4.fromQuat(mat4.create(), q)
    if (rot.worldaxis) {
      mat4.mul(obj.matrix, m, obj.matrix) // WORLD AXIS ORDER
    } else {
      mat4.mul(obj.matrix, obj.matrix, m) // LOCAL AXIS ORDER
    }
  }
  const X_AXIS = vec3.fromValues(1, 0, 0)
  const Y_AXIS = vec3.fromValues(0, 1, 0)
  const Z_AXIS = vec3.fromValues(0, 0, 1)

  let f = gui.addFolder('Light').close()
  f.add(light.position, 'x', -25, 25, 0.1)
  f.add(light.position, 'y', -25, 25, 0.1)
  f.add(light.position, 'z', -25, 25, 0.1)
  f.add(light.color, '0', 0, 1, 0.1).name('red')
  f.add(light.color, '1', 0, 1, 0.1).name('green')
  f.add(light.color, '2', 0, 1, 0.1).name('blue')
  f.add(light, 'intensity', 0, 1, 0.1)
  f.add(light, 'attenuation', 0.01, 0.25, 0.01)
  f = gui.addFolder('Rotate XYZ')
  f.add(rot, 'worldaxis')
  f.add(rot, 'x', -180, 180)
  f.add(rot, 'y', -180, 180)
  f.add(rot, 'z', -180, 180)

  document.addEventListener('keydown', (e) => {
    switch (e.code) {
      case 'ArrowLeft':
        rot.y -= 2
        break
      case 'ArrowRight':
        rot.y += 2
        break
      case 'ArrowUp':
        rot.x -= 2
        e.preventDefault()
        break
      case 'ArrowDown':
        rot.x += 2
        e.preventDefault()
        break
    }
  })

  animate(() => {
    // apply the change in each GUI angle since the last frame
    if (rot.lastx - rot.x) {
      rotateAbout(X_AXIS, rot.lastx - rot.x)
      rot.lastx = rot.x
    }
    if (rot.lasty - rot.y) {
      rotateAbout(Y_AXIS, rot.lasty - rot.y)
      rot.lasty = rot.y
    }
    if (rot.lastz - rot.z) {
      rotateAbout(Z_AXIS, rot.lastz - rot.z)
      rot.lastz = rot.z
    }

    // the light position is edited directly via the GUI - update the visible indicator
    const [p] = visibleLightObj.points
    p.x = light.position.x
    p.y = light.position.y
    p.z = light.position.z

    scene.modelView()
    renderer.render(scene)
  })
}
