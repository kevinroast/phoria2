import { DirectionalLight, HemisphereLight, InstancedMesh, Mesh, PointLight, SpotLight, View, box, cylinder, icosphere, plane, sphere, torus } from 'phoria2'

// The View's debug drawing, over a small scene with something for each helper: a sun whose shadow
// box swings round as it moves across the sky, a lamp's spot light swaying on its post, a coloured
// point light circling with its range, shapes to box and to show the normals of, and a ring of
// instances, each boxed on its own when hovered. view.debug is one option - each checkbox below
// changes one part of it - and none of what it draws is part of the scene: hovering, framing and
// explain() see only the scene.

export default function run({ canvas, gui }) {
  const view = new View({ canvas, orbit: { maxPitch: 1.3 }, background: '#14161b', camera: { position: [7.7, 7.6, 12.1], target: [0, 1, 0] } })
  const { scene } = view
  scene.add(new HemisphereLight({ sky: '#7d8fb8', ground: '#2b2622', intensity: 0.45 }))
  const sun = scene.add(new DirectionalLight({ color: '#fff1dc', intensity: 1.6, direction: [-0.6, -1, -0.4], castShadow: true }))
  scene.add(new Mesh({ geometry: plane(14), material: { color: '#3a3d46', roughness: 0.9 }, receiveShadow: true, pickable: false }))

  // shapes to box, and to see the normals of
  const shape = (geometry, color, position) => scene.add(new Mesh({ geometry, position, material: { color, roughness: 0.4 }, castShadow: true, receiveShadow: true }))
  const cube = shape(box(1.3), '#e15759', [-2.4, 0.65, 0.4])
  const ball = shape(sphere({ radius: 0.8, segments: 24, rings: 14 }), '#4e79a7', [0, 0.8, -1.6])
  const ring = shape(torus({ radius: 0.7, tube: 0.25, segments: 32 }), '#f28e2b', [2.3, 0.9, 0.6])
  const gem = shape(icosphere({ radius: 0.55, detail: 0 }), '#76b7b2', [0.2, 0.55, 1.9])
  gem.material.flatShading = true

  // a ring of instances: the node is boxed as a whole, an instance on its own when hovered
  const posts = scene.add(new InstancedMesh({ geometry: cylinder({ radius: 0.12, height: 0.6 }), count: 14, material: { color: '#b07aa1', roughness: 0.5 }, castShadow: true }))
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * Math.PI * 2
    posts.setInstance(i, { position: [Math.cos(a) * 5, 0.3, Math.sin(a) * 5] })
  }

  // a lamp: a post with a spot light hanging from its arm, swaying
  scene.add(new Mesh({ geometry: cylinder({ radius: 0.07, height: 4 }), position: [-4.4, 2, -2.6], material: { color: '#6b6f78', metalness: 0.8, roughness: 0.3 }, castShadow: true, pickable: false }))
  const lamp = scene.add(new SpotLight({ color: '#ffd59a', intensity: 30, position: [-3.2, 3.8, -2.6], range: 8, angle: 0.45, penumbra: 0.3, castShadow: true, target: [-1.5, 0, -0.5] }))
  // a coloured point light circling, its range showing as a ring
  const bulb = scene.add(new PointLight({ color: '#ff4fd8', intensity: 6, range: 4.5, position: [2, 1.8, 2] }))
  scene.add(new Mesh({ geometry: icosphere({ radius: 0.08, detail: 1 }), material: { unlit: true, color: '#ff8fe8' }, pickable: false })).onUpdate((m) => m.position.copy(bulb.position))

  // ---- debug: on from the start, each part a checkbox; the stats readout bottom left, where this
  // demo leaves room for it
  const settings = { animate: true, lights: true, shadows: true, bounds: 'hovered', normals: 'hovered', axes: false, camera: false, stats: true }
  const apply = () => {
    const pick = (v) => (v === 'all' ? true : v === 'off' ? false : v)
    view.debug = {
      lights: settings.lights, shadows: settings.shadows, bounds: pick(settings.bounds), normals: pick(settings.normals),
      axes: settings.axes, camera: settings.camera, stats: settings.stats ? 'bottom-left' : false,
    }
  }
  apply()
  gui.add(settings, 'animate')
  const f = gui.addFolder('view.debug')
  f.add(settings, 'lights').onChange(apply)
  f.add(settings, 'shadows').onChange(apply)
  f.add(settings, 'bounds', ['all', 'hovered', 'off']).onChange(apply)
  f.add(settings, 'normals', ['hovered', 'all', 'off']).onChange(apply)
  f.add(settings, 'axes').onChange(apply)
  f.add(settings, 'camera').name('orbit target').onChange(apply)
  f.add(settings, 'stats').onChange(apply)

  let t = 0
  return view.start((dt) => {
    if (!settings.animate) return
    t += dt
    // the sun moving across the sky, its shadow box turning with it
    const a = t * 0.25
    sun.direction.set(Math.cos(a) * 0.7, -1, Math.sin(a) * 0.7 - 0.2)
    // the lamp swaying, the bulb circling
    lamp.target?.set(-1.5 + Math.sin(t * 0.9) * 1.5, 0, -0.5 + Math.cos(t * 0.7) * 1.2)
    bulb.position.set(Math.cos(t * 0.6) * 3, 1.8 + Math.sin(t * 1.3) * 0.4, Math.sin(t * 0.6) * 3)
    cube.rotateY(0.5 * dt)
    ring.rotateX(0.7 * dt)
    gem.rotateY(-0.8 * dt)
    ball.position.y = 0.8 + Math.abs(Math.sin(t * 1.6)) * 0.6
  })
}
