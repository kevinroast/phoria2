import { DirectionalLight, Geometry, Group, Mesh, Texture, View, box, cylinder, icosphere, loadTexture, plane } from 'phoria2'
import { Emitter } from 'phoria2/particles'

const WALL_X = 6, WALL_SIZE = 10, SIDE = 1024, TILES = 2
const PAINTS = { blue: '#1f5cff', red: '#e8243c', green: '#1fbf5a', yellow: '#ffc400', white: '#f4f4f4', violet: '#8a3cff' }
const MOUNT = [-6, 1.6, 0], BARREL = 1.45, GRAVITY = 9.8

// A paint cannon: drops fly under gravity, and when one reaches the wall it is removed and a splat
// is drawn into two 2D canvases behind the wall's textures - its colour, and its roughness (wet
// paint is glossy) - and a big splat may run in a drip down the bricks. texture.needsUpdate()
// sends the changes to the GPU, once a frame. Click the wall to aim: the cannon works out the
// arc that lands there (view.on('click') picks the wall, and the hit says where).
export default async function run({ canvas, gui, info }) {
  info.textContent = 'Click the wall to aim · space cleans it'
  const [brick, arm] = await Promise.all(['diff', 'arm'].map((m) => loadTexture(`textures/red_brick_03_${m}_1k.jpg`)))

  // the wall's colour and ARM (occlusion, roughness, metal) textures are canvases, painted as drops land
  const layer = () => {
    const c = document.createElement('canvas')
    c.width = c.height = SIDE
    return /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'))
  }
  const colour = layer(), rough = layer()
  const colourMap = new Texture({ image: colour.canvas })
  const armMap = new Texture({ image: rough.canvas, colorSpace: 'linear' })
  /** @type {{ x: number, y: number, w: number, left: number, speed: number, paint: string }[]} */
  let drips = []
  let dirty = false
  const clean = () => {
    // the photo tiles TILES x TILES across the wall, as the normal map repeats
    const t = SIDE / TILES
    for (let i = 0; i < TILES; i++) {
      for (let j = 0; j < TILES; j++) {
        colour.drawImage(/** @type {CanvasImageSource} */ (brick.image), i * t, j * t, t, t)
        rough.drawImage(/** @type {CanvasImageSource} */ (arm.image), i * t, j * t, t, t)
      }
    }
    drips = []
    dirty = true
  }
  clean()

  // no orbit control: the mouse is for aiming
  const view = new View({ canvas, background: '#1b1c21', camera: { position: [-12.5, 6, 12], target: [1, 3.6, 0] } })
  const scene = view.scene
  scene.environment = 'hdr/studio_small_09_1k.hdr'
  scene.environmentIntensity = 0.6
  scene.add(new DirectionalLight({ direction: [1, -1.3, -0.45], intensity: 1.6, castShadow: true }))
  scene.add(new Mesh({ geometry: plane(300), material: { color: '#34353a', roughness: 0.9 }, receiveShadow: true, pickable: false }))

  // the wall faces the cannon (-x); built from corners so its textures run upright, u along +z
  const h = WALL_SIZE / 2
  const wall = scene.add(new Mesh({
    geometry: new Geometry({
      positions: [WALL_X, 0, -h, WALL_X, 0, h, WALL_X, WALL_SIZE, h, WALL_X, WALL_SIZE, -h],
      uvs: [0, 1, 1, 1, 1, 0, 0, 0],
      indices: [0, 1, 2, 0, 2, 3],
    }),
    material: {
      map: colourMap, roughnessMap: armMap, aoMap: armMap,
      normalMap: { url: 'textures/red_brick_03_nor_gl_1k.jpg', repeat: [TILES, TILES] },
    },
    receiveShadow: true,
  }))
  // the wall's body behind its face, and a coping along the top
  scene.add(new Mesh({ geometry: box({ width: 0.5, height: WALL_SIZE, depth: WALL_SIZE }), material: { color: '#5b3a31', roughness: 0.9 }, position: [WALL_X + 0.26, h, 0], castShadow: true, pickable: false }))
  scene.add(new Mesh({ geometry: box({ width: 0.7, height: 0.2, depth: WALL_SIZE + 0.2 }), material: { color: '#9a958d', roughness: 0.8 }, position: [WALL_X + 0.26, WALL_SIZE + 0.1, 0], castShadow: true, pickable: false }))

  // the cannon: a tripod, a head that turns (yaw) and a barrel that tilts (pitch)
  const steel = { color: '#4a4c52', metalness: 0.8, roughness: 0.35 }
  const mount = scene.add(new Group({ position: MOUNT, pickable: false }))
  for (let i = 0; i < 3; i++) {
    const leg = mount.add(new Group({ rotation: [0, (i / 3) * Math.PI * 2 + 0.5, 0] }))
    const spread = 0.9, tilt = Math.atan2(spread, MOUNT[1])
    leg.add(new Mesh({ geometry: cylinder({ radius: 0.05, height: Math.hypot(spread, MOUNT[1]) }), material: steel, position: [spread / 2, -MOUNT[1] / 2, 0], rotation: [0, 0, tilt], castShadow: true }))
  }
  mount.add(new Mesh({ geometry: icosphere({ radius: 0.2, detail: 2 }), material: steel, castShadow: true }))
  const yaw = mount.add(new Group())
  const pitch = yaw.add(new Group())
  // the barrel and its nozzle, lying along +x
  pitch.add(new Mesh({ geometry: cylinder({ radius: 0.28, height: 1.3, segments: 32, axis: 'x' }), material: steel, position: [0.25, 0, 0], castShadow: true }))
  pitch.add(new Mesh({ geometry: cylinder({ radius: 0.2, radiusTop: 0.08, height: 0.5, segments: 32, axis: 'x' }), material: { color: '#c79a4a', metalness: 1, roughness: 0.3 }, position: [1.15, 0, 0], castShadow: true }))
  const tank = pitch.add(new Mesh({ geometry: cylinder({ radius: 0.26, height: 0.55, segments: 32 }), material: { color: PAINTS.blue, roughness: 0.25 }, position: [-0.1, 0.5, 0], castShadow: true }))
  pitch.add(new Mesh({ geometry: cylinder({ radius: 0.12, height: 0.1 }), material: steel, position: [-0.1, 0.82, 0] }))

  const settings = { paint: 'blue', power: 12, turn: 0, aim: 0.5, spread: 0.7 }
  const direction = () => {
    const c = Math.cos(settings.aim)
    return [c * Math.cos(settings.turn), Math.sin(settings.aim), -c * Math.sin(settings.turn)]
  }
  const muzzle = () => direction().map((d, i) => MOUNT[i] + d * BARREL)

  // a splat: a blob with a ring of droplets, the same shapes drawn in colour and as wet gloss
  const splat = (y, z, paint) => {
    const x = (z + h) / WALL_SIZE * SIDE, py = (1 - y / WALL_SIZE) * SIDE
    const r = 12 + Math.random() * 22
    const shape = new Path2D()
    shape.arc(x, py, r, 0, Math.PI * 2)
    for (let i = 3 + Math.random() * 4; i > 0; i--) {
      const a = Math.random() * Math.PI * 2, d = r * (1 + Math.random() * 1.3), s = r * (0.12 + Math.random() * 0.22)
      shape.moveTo(x + Math.cos(a) * d + s, py + Math.sin(a) * d)
      shape.arc(x + Math.cos(a) * d, py + Math.sin(a) * d, s, 0, Math.PI * 2)
    }
    colour.fillStyle = paint
    colour.fill(shape)
    rough.fillStyle = 'rgb(255, 40, 0)' // no occlusion, roughness 0.16, not metal
    rough.fill(shape)
    if (r > 22 && Math.random() < 0.4 && drips.length < 80) {
      drips.push({ x: x + (Math.random() - 0.5) * r, y: py + r * 0.6, w: r * 0.45, left: 40 + Math.random() * 160, speed: 50 + Math.random() * 40, paint })
    }
    dirty = true
  }
  // drips run down, thinning and slowing until the paint runs out
  const runDrips = (dt) => {
    for (const d of drips) {
      const step = Math.min(d.left, d.speed * dt)
      for (const [ctx, style] of /** @type {[CanvasRenderingContext2D, string][]} */ ([[colour, d.paint], [rough, 'rgb(255, 40, 0)']])) {
        ctx.strokeStyle = style
        ctx.lineWidth = d.w
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(d.x, d.y)
        ctx.lineTo(d.x, d.y + step)
        ctx.stroke()
      }
      d.y += step
      d.left -= step
      d.w = Math.max(2, d.w * (1 - 0.6 * dt))
      d.speed *= 1 - 0.5 * dt
    }
    if (drips.length) dirty = true
    drips = drips.filter((d) => d.left > 0.5 && d.speed > 4)
  }

  const paint = scene.add(new Emitter({
    max: 3000, rate: 70, gravity: [0, -GRAVITY, 0], lifetime: 4,
    material: { map: drop(), size: 0.16, blending: 'normal' },
    onParticle: (p) => {
      if (p.position.x < WALL_X) return p.position.y > 0
      // past the wall plane: paint it if it hit the wall, and remove the particle either way
      if (p.position.y > 0 && p.position.y < WALL_SIZE && Math.abs(p.position.z) < h) splat(p.position.y, p.position.z, PAINTS[settings.paint])
      return false
    },
  }))
  const aim = () => {
    const d = direction()
    paint.set({
      origin: muzzle(),
      velocity: d.map((c) => c * settings.power),
      velocitySpread: settings.spread,
      color: PAINTS[settings.paint],
    })
    yaw.rotation.y = settings.turn
    pitch.rotation.z = settings.aim
    tank.material.color.set(PAINTS[settings.paint])
  }
  aim()

  // the low arc from the muzzle to a point, raising the power if it can't reach; a few rounds,
  // since the muzzle moves as the barrel turns
  const aimAt = (target) => {
    for (let round = 0; round < 3; round++) {
      const m = muzzle()
      const dx = target.x - m[0], dy = target.y - m[1], dz = target.z - m[2]
      const across = Math.hypot(dx, dz)
      const least = Math.sqrt(GRAVITY * (dy + Math.hypot(across, dy)))
      if (settings.power < least * 1.03) settings.power = Math.min(20, least * 1.03)
      const v2 = settings.power ** 2
      const reach = Math.max(0, v2 * v2 - GRAVITY * (GRAVITY * across * across + 2 * dy * v2))
      settings.turn = Math.atan2(-dz, dx)
      settings.aim = Math.atan((v2 - Math.sqrt(reach)) / (GRAVITY * across))
    }
    aim()
    gui.updateDisplay()
  }
  view.on('click', (hit) => { if (hit?.node === wall) aimAt(hit.point) })

  document.addEventListener('keydown', (e) => { if (e.code === 'Space') clean() })
  const f = gui.addFolder('Paint cannon')
  f.add(paint, 'rate', 0, 300, 5)
  f.add(settings, 'power', 5, 20, 0.1).onChange(aim)
  f.add(settings, 'turn', -0.8, 0.8, 0.01).onChange(aim)
  f.add(settings, 'aim', -0.2, 1.2, 0.01).onChange(aim)
  f.add(settings, 'spread', 0, 2, 0.05).onChange(aim)
  f.add({ clean }, 'clean').name('clean the wall')

  // the paint changes colour every two seconds - the drops in flight change with it (an emitter's
  // colour applies to all its particles), and so does what they paint
  let since = 0
  return view.start((dt) => {
    if ((since += dt) > 2) {
      since = 0
      const names = Object.keys(PAINTS)
      settings.paint = names[(names.indexOf(settings.paint) + 1) % names.length]
      aim()
    }
    runDrips(dt)
    if (dirty) {
      colourMap.needsUpdate()
      armMap.needsUpdate()
      dirty = false
    }
  })
}

/** A shaded drop: a highlight up and to the left, darkening to the rim (grey, so the paint tints it). */
function drop(size = 64) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'))
  const r = size / 2
  const g = ctx.createRadialGradient(r * 0.7, r * 0.7, 0, r, r, r)
  g.addColorStop(0, '#ffffff')
  g.addColorStop(0.18, '#e6e6e6')
  g.addColorStop(0.75, '#8c8c8c')
  g.addColorStop(0.92, '#5a5a5a')
  g.addColorStop(1, 'rgba(90, 90, 90, 0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return new Texture({ image: c })
}
