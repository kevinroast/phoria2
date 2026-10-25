import { DirectionalLight, Material, Mesh, Texture, View, box, cylinder, plane } from 'phoria2'

// Textures: a corner of a room in photo textures from Poly Haven (CC0) - a tiled wooden floor, a
// brick wall, a plank crate and a rusty barrel - each with colour, normal and ARM maps (ambient
// occlusion, roughness and metalness in red, green and blue: the three slots read those channels,
// so one texture fills all three). A screen on the wall is a canvas redrawn every half second
// (texture.needsUpdate()), and a pixel-art poster shows nearest against linear filtering.
// Toggle the maps to see what each adds.

/**
 * A Poly Haven texture set as a material: colour, normal, and one ARM texture for ambient
 * occlusion, roughness and metalness.
 * @param {string} name @param {{ repeat?: number[], metal?: boolean }} [options]
 */
function surface(name, { repeat = [1, 1], metal = false } = {}) {
  const url = (map) => `textures/${name}_${map}_1k.jpg`
  const arm = new Texture({ url: url('arm'), colorSpace: 'linear', repeat })
  return new Material({
    map: { url: url('diff'), repeat },
    normalMap: { url: url('nor_gl'), repeat },
    roughnessMap: arm,
    aoMap: arm,
    // metal's map says where the rust isn't; everything else is all dielectric
    ...(metal ? { metalness: 1, metalnessMap: arm } : {}),
  })
}

// 16 x 16 pixel art, drawn into a canvas
function pixelArt() {
  const art = [
    '................', '.....######.....', '...##########...', '..############..',
    '.###..####..###.', '.###..####..###.', '################', '################',
    '####.######.####', '.####......####.', '..####....####..', '...##########...',
    '....########....', '.....######.....', '................', '................',
  ]
  const c = document.createElement('canvas')
  c.width = c.height = 16
  const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'))
  ctx.fillStyle = '#1b2a4a'
  ctx.fillRect(0, 0, 16, 16)
  art.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch !== '#') return
    ctx.fillStyle = y < 5 ? '#ffd23f' : y < 9 ? '#ff9f1c' : '#ff4f5a'
    ctx.fillRect(x, y, 1, 1)
  }))
  return new Texture({ image: c, filter: 'nearest', mipmaps: false, wrap: 'clamp' })
}

export default function run({ canvas, gui, info }) {
  const view = new View({ canvas, orbit: { maxPitch: 1.2 }, background: '#16161a', camera: { position: [2.6, 2.2, 4.6], target: [0.3, 1.7, -2.2] } })
  view.scene.environment = 'hdr/studio_small_09_1k.hdr'
  view.scene.environmentIntensity = 0.55
  view.scene.add(new DirectionalLight({ direction: [-0.6, -1, -0.5], intensity: 1.6, castShadow: true }))

  const floor = surface('wood_floor', { repeat: [3, 3] })
  const brick = surface('red_brick_03', { repeat: [2, 1] })
  const planks = surface('weathered_brown_planks')
  const rust = surface('rusty_metal_02', { metal: true })
  const materials = [floor, brick, planks, rust]

  view.scene.add(new Mesh({ geometry: plane({ width: 8, depth: 8 }), material: floor, receiveShadow: true }))
  // plane() faces up; a quarter turn about x stands it up facing the viewer
  view.scene.add(new Mesh({ geometry: plane({ width: 8, depth: 4 }), material: brick, rotation: [Math.PI / 2, 0, 0], position: [0, 2, -4], receiveShadow: true }))
  const crate = view.scene.add(new Mesh({ geometry: box(1.3), material: planks, position: [-1.2, 0.65, -1.4], rotation: [0, 0.35, 0], castShadow: true, receiveShadow: true }))
  view.scene.add(new Mesh({ geometry: box(0.8), material: planks, position: [-1.35, 1.7, -1.5], rotation: [0, -0.2, 0], castShadow: true, receiveShadow: true }))
  view.scene.add(new Mesh({ geometry: cylinder({ radius: 0.5, height: 1.4, segments: 48 }), material: rust, position: [1.1, 0.7, -1.9], castShadow: true, receiveShadow: true }))

  // a live screen on the wall: a canvas redrawn and re-sent each half second
  const screenCanvas = document.createElement('canvas')
  screenCanvas.width = 512
  screenCanvas.height = 288
  const screen = new Texture({ image: screenCanvas, wrap: 'clamp' })
  const history = Array.from({ length: 48 }, (_, i) => 50 + 25 * Math.sin(i / 4))
  const draw = (t) => {
    const ctx = /** @type {CanvasRenderingContext2D} */ (screenCanvas.getContext('2d'))
    ctx.fillStyle = '#0b1220'
    ctx.fillRect(0, 0, 512, 288)
    ctx.fillStyle = '#7fd1ff'
    ctx.font = '600 28px system-ui, sans-serif'
    ctx.fillText('Live canvas texture', 28, 52)
    ctx.fillStyle = '#e8edf5'
    ctx.font = '700 64px ui-monospace, Consolas, monospace'
    ctx.fillText(new Date().toLocaleTimeString(), 28, 140)
    history.push(50 + 25 * Math.sin(t * 1.3) + 12 * Math.sin(t * 3.7))
    history.shift()
    ctx.strokeStyle = '#3ddc97'
    ctx.lineWidth = 4
    ctx.beginPath()
    history.forEach((v, i) => ctx.lineTo(28 + i * 9.6, 270 - v * 1.1))
    ctx.stroke()
    screen.needsUpdate()
  }
  draw(0)
  view.scene.add(new Mesh({ geometry: box({ width: 2.2, height: 1.3, depth: 0.08 }), material: { color: '#111', roughness: 0.3 }, position: [-1.4, 2.6, -3.95], castShadow: true }))
  view.scene.add(new Mesh({ geometry: plane({ width: 2.04, depth: 1.15 }), material: { map: screen, unlit: true }, rotation: [Math.PI / 2, 0, 0], position: [-1.4, 2.6, -3.9] }))

  // a pixel-art poster: nearest keeps the pixels crisp, linear blurs them together
  const poster = pixelArt()
  view.scene.add(new Mesh({ geometry: box({ width: 1.5, height: 1.5, depth: 0.06 }), material: { color: '#d8d0c0', roughness: 0.8 }, position: [1.6, 2.5, -3.96], castShadow: true }))
  view.scene.add(new Mesh({ geometry: plane(1.3), material: { map: poster, roughness: 0.9 }, rotation: [Math.PI / 2, 0, 0], position: [1.6, 2.5, -3.92] }))

  // what each map adds: switch them off and the surfaces flatten out
  const maps = { colour: true, normal: true, 'ao + roughness + metal': true, filter: 'nearest', 'floor tiles': 3 }
  const keep = new Map(materials.map((m) => [m, m.textures]))
  const apply = () => {
    for (const m of materials) {
      const set = Object.fromEntries(/** @type {[string, Texture][]} */ (keep.get(m)))
      m.map = maps.colour ? set.map : null
      m.normalMap = maps.normal ? set.normalMap : null
      const arm = maps['ao + roughness + metal']
      m.roughnessMap = arm ? set.roughnessMap : null
      m.aoMap = arm ? set.aoMap : null
      if (set.metalnessMap) m.metalnessMap = arm ? set.metalnessMap : null
    }
  }
  const f = gui.addFolder('Maps')
  f.add(maps, 'colour').onChange(apply)
  f.add(maps, 'normal').onChange(apply)
  f.add(maps, 'ao + roughness + metal').onChange(apply)
  f.add(maps, 'floor tiles', 1, 6, 1).onChange((n) => {
    for (const t of floor.textures.map(([, t]) => t)) t.repeat = [n, n]
  })
  f.add(maps, 'filter', ['nearest', 'linear']).name('poster filter').onChange((v) => {
    poster.filter = v
    poster.needsUpdate()
  })

  info.textContent = 'Photo textures: Poly Haven (CC0)'
  let next = 0
  return view.start((dt, t) => {
    crate.rotation.y = 0.35 + Math.sin(t * 0.3) * 0.05
    if (t >= next) {
      next = t + 0.5
      draw(t)
    }
  })
}
