import {
  DirectionalLight, Group, HemisphereLight, Label, Mesh, OrthographicCamera, PerspectiveCamera, RenderTexture, View,
  box, cylinder, plane, sphere,
} from 'phoria2'

// Render textures: what a camera sees, as a material's map. A control room overlooks a warehouse
// floor - a robot drives a loop round the racks and a forklift works an aisle - and the desk's
// monitors show three live feeds, each a RenderTexture drawn from a camera of its own:
// - a CCTV camera on a post in the corner, sweeping the floor;
// - an orthographic camera straight overhead - the floor as a map, drawn every few frames, as a map
//   needn't be drawn as often;
// - a camera riding on the robot, its child in the scene, so it goes where the robot goes.
// Each texture is drawn before the view's frame, plainly (lights, shadows, no effects), and leaves
// out whatever shows it - a monitor never films itself, though the CCTV sees the others.

export default function run({ canvas, gui }) {
  const view = new View({ canvas, background: '#1b1d22', camera: { position: [0, 15, 18.5], target: [0, 0, 0.8], fov: 42 }, orbit: { maxPitch: 1.3 } })
  const { scene } = view
  scene.add(new HemisphereLight({ sky: '#c7d2e6', ground: '#3a3530', intensity: 0.55 }))
  scene.add(new DirectionalLight({ color: '#fff3e0', intensity: 1.5, direction: [-0.5, -1, -0.35], castShadow: true }))

  // ---- the warehouse floor: painted aisles, racks of boxes, pallets
  scene.add(new Mesh({ geometry: plane({ width: 22, depth: 14 }), material: { color: '#6d7078', roughness: 0.9 }, receiveShadow: true, pickable: false }))
  for (const x of [-7, 0, 7]) scene.add(new Mesh({ geometry: plane({ width: 0.12, depth: 12 }), position: [x - 2.6, 0.005, 0], material: { color: '#e6c23a', unlit: true }, pickable: false }))
  const rack = (x, z) => {
    const g = scene.add(new Group({ name: 'rack', position: [x, 0, z] }))
    for (const px of [-1.6, 1.6]) for (const pz of [-0.5, 0.5]) g.add(new Mesh({ geometry: box({ width: 0.1, height: 3, depth: 0.1 }), position: [px, 1.5, pz], material: { color: '#2f5fa8', metalness: 0.6, roughness: 0.4 }, castShadow: true }))
    for (const y of [0.05, 1, 2]) g.add(new Mesh({ geometry: box({ width: 3.3, height: 0.08, depth: 1.1 }), position: [0, y, 0], material: { color: '#e07a2e' }, castShadow: true, receiveShadow: true }))
    const tints = ['#c9a77a', '#b98d5a', '#d8bc8c']
    for (const y of [0.09, 1.04, 2.04]) for (let i = 0; i < 3; i++) {
      if ((x + z + y * 3 + i) % 4 === 0) continue
      const s = 0.62 + ((i * 7 + x) % 3) * 0.1
      g.add(new Mesh({ geometry: box(s), position: [-1 + i, y + s / 2, 0], material: { color: tints[i % 3], roughness: 0.85 }, castShadow: true, receiveShadow: true }))
    }
  }
  for (const x of [-6.5, 0, 6.5]) for (const z of [-4, 1]) rack(x, z)
  for (const [x, z] of [[-9, 5], [-7.6, 5.4], [8.6, 5.2]]) scene.add(new Mesh({ geometry: box({ width: 1.2, height: 0.9, depth: 1 }), position: [x, 0.45, z], material: { color: '#b48a55' }, castShadow: true, receiveShadow: true }))

  // ---- the robot: a body, a head, wheels - and a camera of its own, riding on it
  const robot = scene.add(new Group({ name: 'robot' }))
  robot.add(new Mesh({ geometry: box({ width: 0.9, height: 0.5, depth: 1.2 }), position: [0, 0.45, 0], material: { color: '#f2f2f0', roughness: 0.3 }, castShadow: true }))
  robot.add(new Mesh({ geometry: cylinder({ radius: 0.22, height: 0.5 }), position: [0, 0.95, 0.25], material: { color: '#2b2e35' }, castShadow: true }))
  robot.add(new Mesh({ geometry: sphere({ radius: 0.09 }), position: [0, 1.15, 0.45], material: { color: '#ff3b30', emissive: '#ff3b30', emissiveIntensity: 0.6 } }))
  for (const x of [-0.5, 0.5]) for (const z of [-0.4, 0.4]) robot.add(new Mesh({ geometry: cylinder({ radius: 0.2, height: 0.12, axis: 'x' }), position: [x, 0.2, z], material: { color: '#1b1b1f' } }))
  const robotCam = robot.add(new PerspectiveCamera({ position: [0, 1.1, 0.55], target: [0, 0.9, 3], fov: 70, near: 0.05, far: 60 }))

  // ---- the forklift: along the back aisle, behind the far racks, its forks rising and falling
  const forklift = scene.add(new Group({ name: 'forklift', position: [0, 0, -6] }))
  forklift.add(new Mesh({ geometry: box({ width: 1.1, height: 0.9, depth: 1.6 }), position: [0, 0.6, 0], material: { color: '#f2b705', roughness: 0.5 }, castShadow: true }))
  forklift.add(new Mesh({ geometry: box({ width: 1, height: 0.8, depth: 0.9 }), position: [0, 1.45, -0.25], material: { color: '#2b2e35', roughness: 0.4 }, castShadow: true }))
  forklift.add(new Mesh({ geometry: box({ width: 0.1, height: 2.4, depth: 0.1 }), position: [0, 1.2, 0.85], material: { color: '#3a3d44' }, castShadow: true }))
  const forks = forklift.add(new Mesh({ geometry: box({ width: 0.9, height: 0.06, depth: 0.9 }), position: [0, 0.3, 1.3], material: { color: '#3a3d44' }, castShadow: true }))
  const load = forks.add(new Mesh({ geometry: box({ width: 0.8, height: 0.6, depth: 0.8 }), position: [0, 0.33, 0], material: { color: '#c9a77a' }, castShadow: true }))

  // ---- the CCTV camera: on a post in the near corner, sweeping the floor
  const post = scene.add(new Group({ position: [9.8, 0, 5.4] }))
  post.add(new Mesh({ geometry: cylinder({ radius: 0.08, height: 4.2 }), position: [0, 2.1, 0], material: { color: '#3a3d44' }, pickable: false }))
  const head = post.add(new Group({ position: [0, 4.3, 0] }))
  head.add(new Mesh({ geometry: box({ width: 0.3, height: 0.3, depth: 0.6 }), material: { color: '#e9e9e6' }, castShadow: true }))
  head.add(new Mesh({ geometry: cylinder({ radius: 0.11, height: 0.1, axis: 'z' }), position: [0, 0, 0.33], material: { color: '#111' } }))
  const cctv = head.add(new PerspectiveCamera({ position: [0, 0, 0.4], target: [0, -0.35, 1], fov: 62, near: 0.1, far: 80 }))

  // ---- the map: straight overhead, orthographic, the whole floor
  const overhead = new OrthographicCamera({ position: [0, 20, 0.001], target: [0, 0, 0], height: 15, near: 1, far: 40 })

  // ---- the feeds
  const feeds = {
    cctv: new RenderTexture({ camera: cctv, width: 512, height: 320 }),
    map: new RenderTexture({ camera: overhead, width: 448, height: 320, update: 3 }),
    robot: new RenderTexture({ camera: robotCam, width: 512, height: 320 }),
  }

  // ---- the control desk in the foreground, its monitors facing the room
  const desk = scene.add(new Group({ name: 'desk', position: [0, 0, 9.4] }))
  desk.add(new Mesh({ geometry: box({ width: 12.5, height: 0.12, depth: 1.7 }), position: [0, 1.15, 0], material: { color: '#40444d', roughness: 0.5 }, castShadow: true, receiveShadow: true, pickable: false }))
  for (const x of [-5.9, 5.9]) desk.add(new Mesh({ geometry: box({ width: 0.12, height: 1.15, depth: 1.5 }), position: [x, 0.58, 0], material: { color: '#30333a' }, pickable: false }))
  const titles = { cctv: 'CAM 1 · LOADING BAY', map: 'FLOOR MAP', robot: 'ROBOT R2 · ONBOARD' }
  Object.entries(feeds).forEach(([name, feed], i) => {
    const x = (i - 1) * 4.1
    const monitor = desk.add(new Group({ name, position: [x, 2.45, -0.15], rotation: [-0.12, -(i - 1) * 0.18, 0] }))
    monitor.add(new Mesh({ geometry: box({ width: 3.8, height: 2.45, depth: 0.12 }), position: [0, 0, -0.07], material: { color: '#15161a', roughness: 0.4 }, castShadow: true }))
    // the screen: the feed, lit by itself - its colours as the camera saw them
    monitor.add(new Mesh({ name: `${name} screen`, geometry: plane({ width: 3.56, depth: 2.2 }), rotation: [Math.PI / 2, 0, 0], position: [0, 0, 0.001], material: { map: feed, unlit: true } }))
    monitor.add(new Mesh({ geometry: box({ width: 0.25, height: 1, depth: 0.25 }), position: [0, -1.5, -0.2], material: { color: '#30333a' }, pickable: false }))
    desk.add(new Label({ text: titles[name], position: [x, 1.25, 0.6], className: 'demo-label feed-title', overlap: 'show' }))
  })

  // ---- switches: how often the map is drawn, the CCTV sweep, the feeds' size, a pause
  const settings = { animate: true, sweep: true, mapEvery: 5, resolution: 256 }
  gui.add(settings, 'animate').name('robot and forklift')
  gui.add(settings, 'sweep').name('CCTV sweep')
  gui.add(settings, 'mapEvery', { 'every frame': 1, 'every 5th': 5, 'every 10th': 10 }).name('map drawn').onChange((v) => { feeds.map.update = v === 1 ? 'frame' : v })
  gui.add(settings, 'resolution', { '128 px': 128, '256 px': 256, '512 px': 512 }).name('feed width').onChange((w) => {
    for (const feed of Object.values(feeds)) {
      feed.height = Math.round((w * feed.height) / feed.width)
      feed.width = w
    }
  })

  // the robot's loop round the near row of racks - a rounded rectangle, through the aisle between
  // the rows and along the front - and the forklift's back aisle
  const loop = (t) => {
    // centred on the near row (z = 1), from the aisle behind it (z = -1.1) to the front (z = 3.1)
    const w = 19, d = 4.2, r = 1.4, z = 1, straightX = w - 2 * r, straightZ = d - 2 * r
    const length = 2 * straightX + 2 * straightZ + 2 * Math.PI * r
    let s = (t % length + length) % length
    const corner = (cx, cz, a0) => (/** @type {number} */ u) => [cx + Math.cos(a0 + u / r) * r, cz + Math.sin(a0 + u / r) * r]
    /** @type {[number, (u: number) => number[]][]} */
    const legs = [
      [straightX, (u) => [-w / 2 + r + u, z - d / 2]],
      [Math.PI * r / 2, corner(w / 2 - r, z - d / 2 + r, -Math.PI / 2)],
      [straightZ, (u) => [w / 2, z - d / 2 + r + u]],
      [Math.PI * r / 2, corner(w / 2 - r, z + d / 2 - r, 0)],
      [straightX, (u) => [w / 2 - r - u, z + d / 2]],
      [Math.PI * r / 2, corner(-w / 2 + r, z + d / 2 - r, Math.PI / 2)],
      [straightZ, (u) => [-w / 2, z + d / 2 - r - u]],
      [Math.PI * r / 2, corner(-w / 2 + r, z - d / 2 + r, Math.PI)],
    ]
    for (const [len, at] of legs) {
      if (s <= len) return at(s)
      s -= len
    }
    return legs[0][1](0)
  }

  let t = 0, swept = 0
  return view.start((dt) => {
    if (settings.sweep) {
      swept += dt
      head.rotation.set(0, -2.35 + Math.sin(swept * 0.35) * 0.55, 0)
    }
    if (!settings.animate) return
    t += dt
    const [x, z] = loop(t * 1.6), [ax, az] = loop(t * 1.6 + 0.05)
    robot.position.set(x, 0, z)
    robot.rotation.set(0, Math.atan2(ax - x, az - z), 0)
    forklift.position.x = Math.sin(t * 0.3) * 7.5
    forklift.rotation.set(0, Math.cos(t * 0.3) >= 0 ? Math.PI / 2 : -Math.PI / 2, 0)
    forks.position.y = 0.3 + (Math.sin(t * 0.7) * 0.5 + 0.5) * 1.6
    load.visible = Math.sin(t * 0.2) > -0.6
  })
}
