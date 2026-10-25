import { Color, DirectionalLight, HemisphereLight, InstancedMesh, Mesh, OrthographicCamera, PerspectiveCamera, View, box, plane } from 'phoria2'

const BLOCKS = 14, LOTS = 3, LOT = 2, ROAD = 1.6
const SPAN = BLOCKS * (LOTS * LOT + ROAD)
const PALETTE = ['#d9d4c7', '#c2c8cf', '#a9b4c2', '#e2d2b8', '#9aa3ad', '#cfd8dc']

// An isometric city: every building is an instance of one box, so thousands draw in one call. The
// camera switches between orthographic (the isometric look) and perspective - the view moves the
// orbit control over to whichever is current. Time of day turns the sun, swings the shadows and tints the sky.
export default function run({ canvas, gui }) {
  const iso = new OrthographicCamera({ position: [60, 60, 60], target: [0, 0, 0], height: 100, near: 1, far: 500 })
  const persp = new PerspectiveCamera({ position: [70, 50, 70], target: [0, 0, 0], fov: 45, near: 1, far: 800 })
  const view = new View({ canvas, camera: persp, orbit: { maxPitch: 1.45, minDistance: 10, maxDistance: 250 }, background: '#9fc4e8' })
  const sky = view.scene.add(new HemisphereLight({ sky: '#cfe3ff', ground: '#5a5040', intensity: 0.7 }))
  const sun = view.scene.add(new DirectionalLight({ intensity: 1.6, castShadow: true }))
  view.scene.add(new Mesh({ geometry: plane(SPAN + 6), material: { color: '#3c4048', roughness: 1 }, pickable: false, receiveShadow: true }))

  const lots = []
  for (let bx = 0; bx < BLOCKS; bx++) {
    for (let bz = 0; bz < BLOCKS; bz++) {
      for (let lx = 0; lx < LOTS; lx++) {
        for (let lz = 0; lz < LOTS; lz++) {
          const x = -SPAN / 2 + bx * (LOTS * LOT + ROAD) + ROAD / 2 + (lx + 0.5) * LOT
          const z = -SPAN / 2 + bz * (LOTS * LOT + ROAD) + ROAD / 2 + (lz + 0.5) * LOT
          // taller towards the middle, with the odd tower and some empty lots
          const centre = 1 - Math.min(1, Math.hypot(x, z) / (SPAN * 0.6))
          if (Math.random() < 0.12) continue
          const height = 1 + Math.random() * 3 + centre ** 2 * 18 * Math.random() + (Math.random() < 0.02 ? 12 : 0)
          lots.push({ x, z, height, width: LOT * (0.6 + Math.random() * 0.3), depth: LOT * (0.6 + Math.random() * 0.3) })
        }
      }
    }
  }
  const city = view.scene.add(new InstancedMesh({ geometry: box(1), material: { roughness: 0.75 }, count: lots.length, castShadow: true, receiveShadow: true }))
  lots.forEach((b, i) => city.setInstance(i, {
    position: [b.x, b.height / 2, b.z], scale: [b.width, b.height, b.depth], color: PALETTE[i % PALETTE.length],
  }))

  // the sun swings over from east to west; low sun means warm light and a dusky sky
  const day = new Color('#9fc4e8'), dusk = new Color('#e8a37a'), noon = new Color('#ffffff'), evening = new Color('#ffb070')
  const settings = { hour: 15, perspective: true }
  const setTime = () => {
    const a = (settings.hour - 6) / 12 * Math.PI, height = Math.sin(a)
    sun.direction.set(-Math.cos(a), -Math.max(0.08, height), -0.45)
    const warm = 1 - Math.min(1, Math.max(0, height) * 2.5)
    sun.color.set(noon).lerp(evening, warm)
    sun.intensity = 0.4 + 1.4 * Math.max(0, height)
    sky.intensity = 0.3 + 0.5 * Math.max(0, height)
    view.scene.background = day.clone().lerp(dusk, warm)
  }
  setTime()

  const f = gui.addFolder('City')
  f.add(settings, 'hour', 6, 18, 0.1).onChange(setTime)
  f.add(sun, 'castShadow').name('shadows')
  f.add(settings, 'perspective').onChange((v) => {
    // keep looking at the same spot from the same direction
    const from = view.camera, to = v ? persp : iso
    to.target = from.target?.clone() ?? null
    to.position.copy(from.position)
    view.camera = to
  })
  f.add({ rebuild: () => location.reload() }, 'rebuild').name('build another')

  return view.start()
}
