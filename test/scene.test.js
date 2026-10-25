import { describe, expect, it } from 'vitest'
import { vec3 } from 'gl-matrix'
import { Scene } from '../src/scene.js'
import { Entity } from '../src/entity/Entity.js'
import { EmitterEntity } from '../src/entity/EmitterEntity.js'
import { PhysicsEntity } from '../src/entity/PhysicsEntity.js'
import { DistantLight, PointLight } from '../src/entity/lights.js'
import { Renderer } from '../src/renderer/Renderer.js'
import { generateUnitCube } from '../src/geometry.js'

function makeScene() {
  const scene = new Scene()
  scene.viewport.width = 200
  scene.viewport.height = 100
  scene.perspective.aspect = 2
  return scene
}

describe('Scene.modelView', () => {
  it('projects the look-at point to the viewport centre', () => {
    const scene = makeScene()
    const e = Entity.create({ points: [{ x: 0, y: 0, z: 0 }] })
    scene.graph.push(e)
    scene.modelView()
    expect(scene.renderlist).toEqual([e])
    expect(e._coords[0][0]).toBeCloseTo(100)
    expect(e._coords[0][1]).toBeCloseTo(50)
  })

  it('puts +y up and +x right on screen (camera looking down +z)', () => {
    const scene = makeScene()
    const e = Entity.create({ points: [{ x: 1, y: 1, z: 0 }] })
    scene.graph.push(e)
    scene.modelView()
    expect(e._coords[0][0]).toBeGreaterThan(100)
    expect(e._coords[0][1]).toBeLessThan(50)
  })

  it('drops entities that are entirely clipped', () => {
    const scene = makeScene()
    const behind = Entity.create({ points: [{ x: 0, y: 0, z: -20 }] })
    scene.graph.push(behind)
    scene.modelView()
    expect(scene.renderlist).toEqual([])
    expect(behind._clip[0]).toBe(1)
  })

  it('applies parent matrices to children and skips disabled entities', () => {
    const scene = makeScene()
    const parent = Entity.create({ points: [{ x: 0, y: 0, z: 0 }] }).translateX(2)
    const child = Entity.create({ id: 'child', points: [{ x: 0, y: 0, z: 0 }] })
    const hidden = Entity.create({ points: [{ x: 0, y: 0, z: 0 }], disabled: true })
    parent.children.push(child, hidden)
    scene.graph.push(parent)
    scene.modelView()
    expect(child._worldcoords[0][0]).toBeCloseTo(2)
    expect(scene.renderlist).toEqual([parent, child])
    expect(scene.findEntity('child')).toBe(child)
  })

  it('applies a child transform in its parent frame (world = parent x child)', () => {
    const scene = makeScene()
    const parent = Entity.create({ points: [{ x: 0, y: 0, z: 0 }] }).rotateY(Math.PI / 2)
    const child = Entity.create({ points: [{ x: 0, y: 0, z: 0 }] }).translateX(2)
    parent.children.push(child)
    scene.graph.push(parent)
    scene.modelView()
    // the child's +x offset is turned by the parent's rotation: +x -> -z
    const [x, y, z] = child._worldcoords[0]
    expect(x).toBeCloseTo(0)
    expect(y).toBeCloseTo(0)
    expect(z).toBeCloseTo(-2)
  })

  it('collects lights and resolves their world positions', () => {
    const scene = makeScene()
    const light = PointLight.create({ position: { x: 1, y: 2, z: 3 } })
    const holder = Entity.create({ points: [{ x: 0, y: 0, z: 0 }] }).translateY(1)
    holder.children.push(light)
    scene.graph.push(holder, DistantLight.create({ direction: { x: 0, y: -2, z: 0 } }))
    scene.modelView()
    expect(scene.lights).toHaveLength(2)
    expect([...light.worldposition]).toEqual([1, 3, 3, 1])
    expect([...scene.lights[1].worlddirection]).toEqual([-0, 1, -0])
  })

  it('transforms normals with the inverse transpose under non-uniform scale', () => {
    const scene = makeScene()
    const cube = Entity.create({ ...generateUnitCube() }).scale(vec3.fromValues(1, 4, 1)).rotateZ(Math.PI / 4)
    scene.graph.push(cube)
    scene.modelView()
    for (const poly of cube.polygons) {
      expect(vec3.length(poly._worldnormal)).toBeCloseTo(1)
      // normal stays perpendicular to the transformed face
      const [a, b] = poly.vertices.map((v) => cube._worldcoords[v])
      const edge = vec3.subtract(vec3.create(), b, a)
      expect(vec3.dot(edge, poly._worldnormal)).toBeCloseTo(0)
    }
  })

  it('runs every trigger and removes finished ones without skipping the next', () => {
    const scene = makeScene()
    const calls = []
    scene.triggerHandlers.push(
      { trigger: () => { calls.push('a'); return true } },
      { trigger: () => { calls.push('b'); return true } },
      { trigger: () => { calls.push('c'); return false } })
    scene.modelView()
    expect(calls).toEqual(['a', 'b', 'c'])
    expect(scene.triggerHandlers).toHaveLength(1)
  })
})

describe('entities', () => {
  it('physics applies gravity to velocity and position', () => {
    const scene = makeScene()
    const e = PhysicsEntity.create({ points: [{ x: 0, y: 0, z: 0 }] })
    scene.graph.push(e)
    scene.modelView()
    expect(e.velocity.y).toBeLessThan(0)
    expect(e.worldposition[1]).toBeLessThan(0)
  })

  it('emitter spawns particles sharing its style, up to the maximum', () => {
    const scene = makeScene()
    const emitter = EmitterEntity.create({ rate: 1000, maximum: 5, style: { color: [1, 2, 3] } })
    emitter._lastEmitTime = Date.now() - 1000
    scene.graph.push(emitter)
    scene.modelView()
    expect(emitter.children).toHaveLength(5)
    expect(emitter.children[0].style).toBe(emitter.style)
    expect(emitter.style.drawmode).toBe('point')
    expect(emitter.style.color).toEqual([1, 2, 3])
  })
})

describe('Renderer.calcNormalBrightness', () => {
  const surface = vec3.fromValues(0, 0, 5)
  const normal = vec3.fromValues(0, 0, -1)
  const lightAt = (x, y, z) => {
    const light = PointLight.create({ position: { x, y, z }, attenuationFactor: 'none', attenuation: 1 })
    light.updatePosition(null)
    return light
  }
  const brightness = (light, camera, style) =>
    new Renderer().calcNormalBrightness(surface, normal, { lights: [light], _cameraPosition: camera }, { style })

  it('peaks the specular highlight where the normal bisects light and view directions', () => {
    // light and camera mirrored either side of the normal: half vector == normal, full highlight
    const rgb = brightness(lightAt(-10, 0, -5), vec3.fromValues(10, 0, -5), { diffuse: 0, specular: 16 })
    for (const c of rgb) expect(c).toBeCloseTo(1)
  })

  it('fades the highlight as the viewer moves off the reflection', () => {
    const on = brightness(lightAt(-10, 0, -5), vec3.fromValues(10, 0, -5), { diffuse: 0, specular: 16 })
    const off = brightness(lightAt(-10, 0, -5), vec3.fromValues(-10, 0, -5), { diffuse: 0, specular: 16 })
    expect(off[0]).toBeLessThan(on[0] * 0.5)
  })
})

describe('Renderer.sortObjects', () => {
  it('honours objectsortmode front and back', () => {
    const scene = makeScene()
    const mk = (z, objectsortmode) => Entity.create({ points: [{ x: 0, y: 0, z }], style: { objectsortmode } })
    const front = mk(5, 'front'), back = mk(-5, 'back'), near = mk(-5, 'sorted'), far = mk(5, 'sorted')
    scene.graph.push(front, near, back, far)
    scene.modelView()
    new Renderer().sortObjects(scene)
    expect(scene.renderlist).toEqual([back, far, near, front])
  })
})
