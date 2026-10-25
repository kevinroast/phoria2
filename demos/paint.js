import { DirectionalLight, Geometry, Lines, Mesh, Texture, View, box, grid, loadTexture } from 'phoria2'
import { Emitter } from 'phoria2/particles'
import { glow } from './kit.js'

const WALL_X = 6, WALL_SIZE = 10
const PAINTS = { blue: '#1f5cff', red: '#e8243c', green: '#1fbf5a', yellow: '#ffc400', white: '#f4f4f4' }

// A paint gun: particles fly under gravity, and when one reaches the wall it is removed and a
// splat is drawn into the 2D canvas behind the wall's texture - texture.needsUpdate() sends the
// change to the GPU. Space or the button cleans the wall.
export default async function run({ canvas, gui, info }) {
  info.textContent = 'Press space to clean the wall'
  const brick = await loadTexture('images/texture-wall.png')

  // the wall's texture is a canvas, painted over as particles land
  const paper = document.createElement('canvas')
  paper.width = paper.height = 512
  const ctx = /** @type {CanvasRenderingContext2D} */ (paper.getContext('2d'))
  const clean = () => {
    ctx.drawImage(/** @type {CanvasImageSource} */ (brick.image), 0, 0, paper.width, paper.height)
    wallTexture.needsUpdate()
  }
  const wallTexture = new Texture({ image: paper })
  clean()

  const view = new View({ canvas, orbit: true, background: '#202026', camera: { position: [-11, 7, 13], target: [1, 3.5, 0] } })
  view.scene.add(new Lines({ geometry: grid({ size: 20, divisions: 10 }), material: { color: '#44444c' }, pickable: false }))
  view.scene.environment = 'studio'
  view.scene.add(new DirectionalLight({ direction: [1, -1.5, -0.6], intensity: 1.2 }))

  // the wall faces the gun (-x); built from corners so its texture runs upright, u along +z
  const h = WALL_SIZE / 2
  view.scene.add(new Mesh({
    geometry: new Geometry({
      positions: [WALL_X, 0, -h, WALL_X, 0, h, WALL_X, WALL_SIZE, h, WALL_X, WALL_SIZE, -h],
      uvs: [0, 1, 1, 1, 1, 0, 0, 0],
      indices: [0, 1, 2, 0, 2, 3],
    }),
    material: { map: wallTexture, roughness: 0.9 },
  }))

  const gun = view.scene.add(new Mesh({ geometry: box({ width: 1.6, height: 0.6, depth: 0.6 }), material: { color: '#55565c', metalness: 0.6, roughness: 0.4 }, position: [-6, 1.5, 0] }))
  const settings = { paint: 'blue', power: 11.5, spread: 1.2, aim: 0.55 }

  // the splat: a soft blob of paint where the particle met the wall
  const splat = (y, z) => {
    const x = (z + h) / WALL_SIZE * paper.width, py = (1 - y / WALL_SIZE) * paper.height
    const r = 6 + Math.random() * 10
    const g = ctx.createRadialGradient(x, py, r * 0.5, x, py, r)
    g.addColorStop(0, PAINTS[settings.paint])
    g.addColorStop(1, `${PAINTS[settings.paint]}00`)
    ctx.fillStyle = g
    ctx.fillRect(x - r, py - r, r * 2, r * 2)
    wallTexture.needsUpdate()
  }

  const paint = view.scene.add(new Emitter({
    max: 3000, rate: 60, gravity: [0, -9.8, 0], lifetime: 4,
    material: { map: glow(32, { core: 0.6 }), size: 0.35, blending: 'normal' },
    onParticle: (p) => {
      if (p.position.x < WALL_X) return p.position.y > -1
      // past the wall plane: paint it if it hit the wall, and remove the particle either way
      if (p.position.y > 0 && p.position.y < WALL_SIZE && Math.abs(p.position.z) < h) splat(p.position.y, p.position.z)
      return false
    },
  }))
  const aim = () => {
    const dx = Math.cos(settings.aim), dy = Math.sin(settings.aim)
    paint.set({
      origin: [gun.position.x + dx * 0.9, gun.position.y + dy * 0.9, 0],
      velocity: [settings.power * dx, settings.power * dy, 0],
      velocitySpread: settings.spread,
      color: PAINTS[settings.paint],
    })
    gun.rotation.z = settings.aim
  }
  aim()

  document.addEventListener('keydown', (e) => { if (e.code === 'Space') clean() })
  const f = gui.addFolder('Paint gun')
  f.add(settings, 'paint', Object.keys(PAINTS)).onChange(aim)
  f.add(paint, 'rate', 0, 300, 5)
  f.add(settings, 'power', 5, 14, 0.1).onChange(aim)
  f.add(settings, 'aim', 0, 1.2, 0.01).onChange(aim)
  f.add(settings, 'spread', 0, 3, 0.05).onChange(aim)
  f.add({ clean }, 'clean').name('clean the wall')

  return view.start()
}
