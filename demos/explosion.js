import { DirectionalLight, Group, HemisphereLight, Mesh, PointLight, Texture, View, box, cylinder, extrude, icosphere, plane, sphere } from 'phoria2'
import { Emitter } from 'phoria2/particles'
import { random } from './kit.js'

// A fuel tank at a test range, blown up the way real ones go: fuel first, then fire. The tank
// splits and its fuel bursts out as a pale cloud of vapour and mist, which hangs for a moment
// before it catches. Then a flame front runs out through the cloud from the ignition point, turning
// each parcel of fuel into fire as it passes - white-hot, then yellow, orange and dull red as it
// cools - and the gases' expansion throws the fireball outward. Hot gas is light: the fireball rises
// and rolls over on itself as a vortex ring, its cooling edges shedding soot, and the dust the blast
// wave kicks up across the ground is drawn in under it into a stem. A light at the fireball's heart
// flashes and fades with it, the blast shakes the view when it arrives, burning fragments arc away
// and the ground is left scorched.
//
// The particles are emitters sharing one soft puff texture, each particle its own size, opacity and
// angle. Fuel, fire and dust are sorted and blended normally, so they hide what is behind them - fire
// and soot are one emitter, each parcel cooling from flame to smoke, so the soot wrapping the fireball
// covers it as real smoke does. Sparks and fragment trails are additive. Everything runs on one clock
// that the speed slider slows down.

const TANK = [0, 1.45, 0]   // the tank's middle, where the fuel comes from and is lit
const FRONT = 16            // the flame front's speed through the fuel, units a second
const SHOCK = 34            // the blast wave's speed over the ground
const FUEL = 1.2            // how much fuel the tank holds, as a share of the cloud it was tuned on
const DELAY = 0.2           // seconds from the tank splitting to the fuel catching
const SKY = '#2c3140'
// what a parcel of fuel cools through as it burns, by how rich the mix was: rich in the middle,
// burning long and hot; lean at the edge of the cloud, a quick orange flash and then soot. Each
// runs on into the same soot, greying as it thins, over a dozen evenly spaced stops
const SOOT = ['#2a2420', '#2c2724', '#302b28', '#34302d', '#383431', '#3c3835', '#403c39', '#44403d', '#484441', '#4c4845']
const FLAMES = [
  ['#fff6dc', '#ffd27a', '#ffa040', '#f06a1e', '#a8380e', '#4a2414'],
  ['#ffe2a0', '#ffa443', '#e8601c', '#8a300e', '#3a2016'],
  ['#ffb45a', '#d0561a', '#5a2a14'],
].map((fire) => [...fire, ...SOOT.slice(Math.max(0, fire.length - 4))])

export default function run({ canvas, gui, info }) {
  const view = new View({
    canvas, background: sky(), orbit: { maxPitch: 0.6, minDistance: 12, maxDistance: 80 },
    camera: { position: [-7, 6, 44], target: [0, 9, 0], far: 1200 },
    bloom: { strength: 0.85, radius: 0.65, threshold: 0.75 },
  })
  const { scene } = view
  scene.fog = { color: SKY, density: 0.006 }
  scene.add(new HemisphereLight({ sky: '#5a6582', ground: '#2a2218', intensity: 0.55 }))
  scene.add(new DirectionalLight({ color: '#ffb98a', direction: [0.8, -0.35, -0.5], intensity: 0.7, castShadow: true }))
  // the whole world in one group, so the blast can shake it
  const world = scene.add(new Group())
  range(world)

  // the tank on its saddles: the saddles stay, the tank goes
  const paint = { color: '#e4e1d8', roughness: 0.45, metalness: 0.25 }
  const tank = world.add(new Group({ position: TANK }))
  tank.add(new Mesh({ geometry: cylinder({ radius: 1.05, height: 4.6, segments: 40, axis: 'x' }), material: paint, castShadow: true }))
  for (const x of [-2.3, 2.3]) tank.add(new Mesh({ geometry: sphere({ radius: 1.05, segments: 32, rings: 16 }), material: paint, position: [x, 0, 0], scale: [0.45, 1, 1], castShadow: true }))
  tank.add(new Mesh({ geometry: cylinder({ radius: 0.12, height: 0.4 }), material: { color: '#8b8d92', metalness: 0.8, roughness: 0.3 }, position: [0.6, 1.15, 0] }))
  for (const x of [-1.5, 1.5]) world.add(new Mesh({ geometry: box({ width: 0.5, height: 0.9, depth: 1.9 }), material: { color: '#8c8780', roughness: 0.9 }, position: [x, 0.45, 0], castShadow: true, receiveShadow: true }))

  // the ground the fire leaves black: a soft dark patch, faded in as the fire burns
  const scorch = world.add(new Mesh({ geometry: plane(22), material: { map: scorched(), color: '#000000', transparent: true, opacity: 0, depthWrite: false, roughness: 1 }, position: [0, 0.02, 0], receiveShadow: true }))

  const puff = puffs(128)
  // fuel: vapour and mist, pale and hanging
  const fuel = world.add(new Emitter({
    max: 2000, rate: 0, velocity: [0, 1.5, 0], drag: 3.4, lifetime: [5, 6], renderOrder: 1, sort: true,
    color: ['#b9b5a3', '#a29e8e'], size: [0.7, 2.4, 3.2], sizeSpread: 0.35, opacity: [0.24, 0.22, 0.16, 0], spin: 0.25,
    material: { map: puff, size: 1.5, blending: 'normal', depthWrite: false },
    onParticle: (p) => burnFuel(p),
  }))
  // fire: each parcel of fuel as it burns - white-hot, cooling through yellow, orange and dull red
  // to soot, which rolls on up with the rest. One emitter for flame and smoke, sorted, so the soot
  // wrapping the fireball hides the fire behind it as real smoke does
  const fire = world.add(new Emitter({
    max: 4000, rate: 0, velocity: [0, 0, 0], lifetime: [7, 10], renderOrder: 2, sort: true,
    color: FLAMES[0], size: [0.5, 1.2, 1.8, 2.4, 3, 3.5, 3.9], sizeSpread: 0.35, opacity: [0.95, 0.92, 0.88, 0.75, 0.55, 0.3, 0], spin: 0.9,
    material: { map: puff, size: 1.4, blending: 'normal', depthWrite: false },
    onParticle: (p) => burn(p),
  }))
  // dust: kicked up by the blast wave, then drawn in under the fireball
  const dust = world.add(new Emitter({
    max: 4000, rate: 0, velocity: [0, 0, 0], drag: 1.4, lifetime: [3, 5], renderOrder: 1, sort: true,
    color: ['#7a6851', '#5e5040'], size: [0.6, 2.2, 3], sizeSpread: 0.4, opacity: [0, 0.32, 0.2, 0], spin: 0.4,
    material: { map: puff, size: 1.5, blending: 'normal', depthWrite: false },
    onParticle: (p) => stem(p),
  }))
  // sparks: burning bits thrown out, falling and bouncing
  const sparks = world.add(new Emitter({
    max: 1500, rate: 0, velocity: [0, 6, 0], gravity: [0, -9.8, 0], drag: 0.5, lifetime: [1.2, 2.8], renderOrder: 4,
    color: ['#fff6d6', '#ffbf5a', '#ff6a1a', '#000000'], material: { size: 0.12, depthWrite: false },
    onParticle: (p) => {
      if (p.position.y < 0.05 && p.velocity.y < 0) {
        p.position.y = 0.05
        p.velocity.y *= -0.3
        p.velocity.x *= 0.5
        p.velocity.z *= 0.5
      }
    },
  }))
  // trails: fire and smoke behind each burning fragment
  const trail = world.add(new Emitter({
    max: 1500, rate: 0, velocity: [0, 0.6, 0], velocitySpread: 0.3, lifetime: [0.4, 0.8], renderOrder: 3,
    color: ['#ffe6a0', '#ff7a24', '#7a240a', '#000000'], size: [0.5, 1.1], spin: 2,
    material: { map: puff, size: 0.9, depthWrite: false },
  }))
  const emitters = [fuel, fire, dust, sparks, trail]
  // the speed slider: each emitter steps on the effect's clock, not the wall clock
  for (const e of emitters) {
    const step = e.step.bind(e)
    e.step = (dt) => step(dt * settings.speed)
  }

  // the light at the fireball's heart
  const glare = world.add(new PointLight({ color: '#ffd9a0', intensity: 0, range: 60, position: TANK, castShadow: true }))

  // the tank's skin in pieces, flung out and tumbling
  const r = random(3)
  const fragments = Array.from({ length: 150 }, (_, i) => {
    const mesh = world.add(new Mesh({ geometry: box({ width: 0.3 + r() * 0.5, height: 0.03, depth: 0.3 + r() * 0.4 }), material: { color: '#cfcac0', roughness: 0.5, metalness: 0.3 }, castShadow: true, visible: false }))
    return { mesh, velocity: [0, 0, 0], spin: [0, 0, 0], burning: i % 3 !== 2 }
  })

  // the state of one blast, on its own clock
  const settings = { speed: 1, detonate: () => detonate(), reset: () => reset() }
  /** @type {{ t: number, lit: number | null, front: number, shock: number, shaken: boolean }} */
  const blast = { t: -1, lit: null, front: 0, shock: 0, shaken: false }
  // the fireball: a vortex ring rising - its height, ring radius, how hard it rolls, and how fast it rises
  const ball = { y: TANK[1], ring: 1.5, roll: 0, rise: 0 }
  let dt = 0, peak = 1, shake = 0

  // a parcel of fuel the flame front has reached goes up: fire where it was, thrown outward by the
  // expanding gases, harder the nearer the middle it was lit
  /** @param {import('phoria2/particles').Particle} p */
  function burnFuel(p) {
    if (p.position.y < 0.25 && p.velocity.y < 0) {
      p.position.y = 0.25
      p.velocity.y *= -0.2
    }
    if (blast.lit === null) return
    const dx = p.position.x - TANK[0], dy = p.position.y - TANK[1], dz = p.position.z - TANK[2]
    const d = Math.hypot(dx, dy, dz) || 1e-3
    if (d > blast.front) return
    const push = 2.5 + 5 * Math.exp(-d / 2.5)
    const v = [p.velocity.x + dx / d * push, p.velocity.y + dy / d * push + 2, p.velocity.z + dz / d * push]
    const mix = Math.min(2, Math.floor(d / 2.2 + Math.random() * 1.2))
    fire.burst(2, { origin: p.position, originSpread: 0.4, velocity: v, velocitySpread: 1.5, color: FLAMES[mix] })
    return false
  }

  // fire: thrown out at first, then caught up in the rolling, rising fireball - lighter the hotter
  /** @param {import('phoria2/particles').Particle} p */
  function burn(p) {
    const life = p.age / p.lifetime
    billow(p, Math.min(1, 0.15 + life * 6), 2.5 * Math.max(0, 1 - life * 4))
    if (p.position.y < 0.2 && p.velocity.y < 0) {
      p.position.y = 0.2
      p.velocity.y = 0
    }
  }

  // steer a particle towards the flow round the fireball: up with it, and rolling over the top, out,
  // down its sides and in underneath - a vortex ring. hold is how much the flow has it (0-1 a second)
  /** @param {import('phoria2/particles').Particle} p @param {number} hold @param {number} [lift] */
  function billow(p, hold, lift = 0) {
    const dx = p.position.x, dz = p.position.z, dy = p.position.y - ball.y
    const r = Math.hypot(dx, dz) || 1e-3
    const dr = r - ball.ring, d = Math.hypot(dr, dy) + 0.4
    const reach = Math.exp(-(d * d) / (ball.ring * ball.ring * 3))
    const roll = ball.roll * reach / d
    const out = dy * roll, up = -dr * roll + ball.rise * (0.4 + 0.6 * reach) + lift
    const k = Math.min(1, dt * settings.speed * 2.2 * hold)
    p.velocity.x += (dx / r * out + 0.35 - p.velocity.x) * k
    p.velocity.y += (up - p.velocity.y) * k
    p.velocity.z += (dz / r * out - p.velocity.z) * k
  }

  // dust: blown out by the wave, then - once the fireball is rising - drawn in and up beneath it
  /** @param {import('phoria2/particles').Particle} p */
  function stem(p) {
    if (p.position.y < 0.1) p.position.y = 0.1
    if (blast.lit === null || blast.t - blast.lit < 1.2) return
    const r = Math.hypot(p.position.x, p.position.z) || 1e-3
    if (r > ball.ring * 4) return
    const k = Math.min(1, dt * settings.speed * 0.8)
    const pull = 2.5 * Math.exp(-r / (ball.ring * 2))
    p.velocity.x += (-p.position.x / r * pull - p.velocity.x) * k
    p.velocity.z += (-p.position.z / r * pull - p.velocity.z) * k
    p.velocity.y += ((r < ball.ring * 1.2 ? 3 : 0.6) * pull - p.velocity.y) * k
  }

  function detonate() {
    for (const e of emitters) e.clear()
    Object.assign(blast, { t: 0, lit: null, front: 0, shock: 0, shaken: false })
    Object.assign(ball, { y: TANK[1], ring: 1.5, roll: 0, rise: 0 })
    peak = 1
    tank.visible = false
    scorch.material.opacity = 0
    glare.intensity = 0
    // the tank splits: its fuel bursts out as a spreading cloud, its skin in pieces, a puff of dust
    fuel.burst(Math.round(900 * FUEL), { origin: TANK, originSpread: 0.9, velocitySpread: 15 * Math.sqrt(FUEL) })
    dust.burst(120, { origin: [0, 0.3, 0], originSpread: 2, velocity: [0, 0.8, 0], velocitySpread: [6, 0.5, 6] })
    for (const f of fragments) {
      const a = r() * Math.PI * 2, out = 4 + r() * 6
      f.mesh.position.set(TANK[0] + Math.cos(a) * 0.8, TANK[1] + (r() - 0.3), TANK[2] + Math.sin(a) * 0.8)
      f.mesh.rotation.set(r() * 6, r() * 6, r() * 6)
      f.mesh.visible = true
      f.velocity = [Math.cos(a) * out, 5 + r() * 9, Math.sin(a) * out]
      f.spin = [(r() - 0.5) * 14, (r() - 0.5) * 14, (r() - 0.5) * 14]
    }
  }

  // everything back as it was: the tank whole on its saddles, the ground clean, the air clear
  function reset() {
    for (const e of emitters) e.clear()
    Object.assign(blast, { t: -1, lit: null, front: 0, shock: 0, shaken: false })
    tank.visible = true
    for (const f of fragments) f.mesh.visible = false
    scorch.material.opacity = 0
    glare.intensity = 0
    shake = 0
  }

  function ignite() {
    blast.lit = blast.t
    // the gases' heat flings out burning bits
    sparks.burst(500, { origin: TANK, originSpread: 1, velocitySpread: 15 })
    ball.roll = 4.5
  }

  // the stages, for the caption
  const stage = () => {
    if (blast.t < 0) return 'Press Detonate (or space)'
    if (blast.lit === null) return 'Fuel release - a cloud of vapour and mist'
    const since = blast.t - blast.lit
    if (since < 0.5) return 'Ignition - the flame front runs through the cloud'
    if (since < 2.5) return 'Fireball - burning, expanding, rising'
    if (since < 7) return 'Soot - the cooling fireball rolls up as a vortex ring'
    return 'Smoke drifting'
  }

  gui.add(settings, 'detonate').name('Detonate')
  gui.add(settings, 'speed', 0.05, 1, 0.05).name('speed')
  gui.add(settings, 'reset').name('⟲ Start again')
  document.addEventListener('keydown', (e) => { if (e.code === 'Space') detonate() })

  const camera = view.camera
  let shown = ''
  detonate()
  return view.start((frameDt) => {
    dt = frameDt
    const s = frameDt * settings.speed
    if (blast.t >= 0) {
      blast.t += s
      if (blast.lit === null && blast.t >= DELAY) ignite()
      if (blast.lit !== null) {
        const since = blast.t - blast.lit
        blast.front = since * FRONT
        // the fireball: rising fast while hot, slowing as it cools; its ring widening, its roll easing
        ball.rise = 0.7 + 3.6 * Math.exp(-since / 3)
        ball.y += ball.rise * s
        ball.ring = 1.5 + 3.2 * (1 - Math.exp(-since / 1.8))
        ball.roll = 4.5 * Math.exp(-since / 7)
        // the blast wave across the ground, kicking up dust as it goes
        const was = blast.shock
        blast.shock = since * SHOCK
        if (was < 24) {
          const n = Math.round((Math.min(blast.shock, 24) ** 2 - was * was) * 0.35)
          for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, at = was + Math.random() * (Math.min(blast.shock, 24) - was)
            const push = 9 * Math.exp(-at / 18)
            dust.burst(1, { origin: [Math.cos(a) * at, 0.3, Math.sin(a) * at], velocity: [Math.cos(a) * push, 1.2 + push * 0.2, Math.sin(a) * push], velocitySpread: 0.8 })
          }
        }
        // the shake when the wave reaches the camera
        const away = Math.hypot(camera.position.x, camera.position.z)
        if (!blast.shaken && blast.shock >= away) {
          blast.shaken = true
          shake = 0.7
        }
        // the light: a flash, then the fire's own glow, reddening as it cools
        peak = Math.max(peak, fire.count)
        const heat = Math.exp(-since / 2.2) * fire.count / peak
        const flash = Math.exp(-since * 9)
        glare.intensity = 450 * flash + 260 * heat
        const white = Math.min(1, flash + heat * 0.6)
        glare.color.setSRGB(1, 0.42 + 0.47 * white, 0.16 + 0.53 * white)
        glare.position.set(0, Math.min(ball.y, 14), 0)
        scorch.material.opacity = Math.min(0.92, scorch.material.opacity + s * 0.5)
      }
      // the fragments: thrown, tumbling, bouncing to rest; the burning ones trail fire
      for (const f of fragments) {
        if (!f.mesh.visible) continue
        const v = f.velocity, m = f.mesh
        v[1] -= 9.8 * s
        m.position.x += v[0] * s
        m.position.y += v[1] * s
        m.position.z += v[2] * s
        m.rotation.x += f.spin[0] * s
        m.rotation.y += f.spin[1] * s
        m.rotation.z += f.spin[2] * s
        if (m.position.y < 0.05) {
          m.position.y = 0.05
          v[1] *= -0.25
          v[0] *= 0.45
          v[2] *= 0.45
          f.spin = f.spin.map((w) => w * 0.4)
        }
        if (f.burning && blast.lit !== null && blast.t - blast.lit < 4 && Math.random() < 0.7) trail.burst(1, { origin: m.position })
      }
    }
    if (shake > 0.001) {
      shake *= Math.exp(-frameDt * 5)
      world.position.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake * 0.5)
    } else world.position.set(0, 0, 0)
    const text = stage()
    if (text !== shown) info.textContent = shown = text
  })
}

/** The test range: sand, a concrete pad, blast barriers round it, posts and far hills. @param {Group} world */
function range(world) {
  const r = random(9)
  world.add(new Mesh({ geometry: plane(600), material: { color: '#6e5c46', roughness: 1 }, receiveShadow: true }))
  world.add(new Mesh({ geometry: box({ width: 10, height: 0.16, depth: 7 }), material: { color: '#86827a', roughness: 0.95 }, position: [0, 0.08, 0], receiveShadow: true }))
  // jersey barriers in an arc behind and beside the tank
  const jersey = extrude({ shape: [[-0.32, 0], [0.32, 0], [0.12, 0.25], [0.1, 0.8], [-0.1, 0.8], [-0.12, 0.25]], depth: 2.8 })
  const concrete = { color: '#a19c92', roughness: 0.9 }
  for (let i = -6; i <= 6; i++) {
    const a = i * 0.21 - Math.PI / 2, d = 17
    world.add(new Mesh({ geometry: jersey, material: concrete, position: [Math.cos(a) * d, 0, Math.sin(a) * d], rotation: [0, -a, 0], castShadow: true, receiveShadow: true }))
  }
  // marker posts at even distances out to the side, for scale
  for (let x = -40; x <= 40; x += 8) {
    if (Math.abs(x) < 10) continue
    world.add(new Mesh({ geometry: box({ width: 0.15, height: 2, depth: 0.15 }), material: { color: x % 16 ? '#d8d2c4' : '#d0582c', roughness: 0.7 }, position: [x, 1, 8], castShadow: true }))
  }
  // low hills on the horizon
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + r() * 0.3, d = 260 + r() * 120, s = 30 + r() * 50
    world.add(new Mesh({ geometry: icosphere({ radius: 1, detail: 1 }), material: { color: '#4a4038', roughness: 1, flatShading: true }, position: [Math.cos(a) * d, -s * 0.1, Math.sin(a) * d], scale: [s * 1.8, s * 0.32, s] }))
  }
}

/** A soft, lumpy puff: overlapping blurred blobs inside a round falloff - turned, it billows. @param {number} size */
function puffs(size) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'))
  const r = random(21), h = size / 2
  for (let i = 0; i < 22; i++) {
    const a = r() * Math.PI * 2, d = r() * h * 0.42, br = h * (0.25 + r() * 0.3)
    const x = h + Math.cos(a) * d, y = h + Math.sin(a) * d
    const g = ctx.createRadialGradient(x, y, 0, x, y, br)
    g.addColorStop(0, `rgba(255, 255, 255, ${0.22 + r() * 0.2})`)
    g.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
  }
  // fade the whole to nothing at the edge, so no square shows
  ctx.globalCompositeOperation = 'destination-in'
  const edge = ctx.createRadialGradient(h, h, 0, h, h, h)
  edge.addColorStop(0, 'rgba(0, 0, 0, 1)')
  edge.addColorStop(0.55, 'rgba(0, 0, 0, 0.8)')
  edge.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = edge
  ctx.fillRect(0, 0, size, size)
  return new Texture({ image: c })
}

/** The burn left on the ground: dark in the middle, ragged and fading at the edge. */
function scorched() {
  const size = 256, c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'))
  const r = random(5), h = size / 2
  for (let i = 0; i < 40; i++) {
    const a = r() * Math.PI * 2, d = r() * h * 0.5, br = h * (0.15 + r() * 0.35)
    const x = h + Math.cos(a) * d, y = h + Math.sin(a) * d
    const g = ctx.createRadialGradient(x, y, 0, x, y, br)
    g.addColorStop(0, 'rgba(0, 0, 0, 0.35)')
    g.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
  }
  return new Texture({ image: c })
}

/** Dusk: deep blue overhead, warm at the horizon, the ground below dark. */
function sky() {
  const c = document.createElement('canvas')
  c.width = 4
  c.height = 256
  const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'))
  const g = ctx.createLinearGradient(0, 0, 0, 256)
  g.addColorStop(0, '#141a2e')
  g.addColorStop(0.36, '#3a4058')
  g.addColorStop(0.5, '#a0705a')
  g.addColorStop(0.52, SKY)
  g.addColorStop(1, '#1a1612')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 4, 256)
  return new Texture({ image: c })
}
