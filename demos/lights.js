import {
  AmbientLight, DirectionalLight, Group, HemisphereLight, Mesh, PointLight, Points, SpotLight, Geometry, Texture, View,
  cylinder, fromPolygons, plane, sphere,
} from 'phoria2'
import { teapot } from './data/teapot.js'

// Lights on a small set - a teapot among columns - in two moods. Sunset: a low warm sun with long
// shadows. Neon: coloured point lights circling in the dark. Throughout, a lamp swings on an arm: its spot light is the lamp head's
// child, so it follows the swing - parenting, with no maths.

/** A soft round glow for light bulbs, drawn once into a canvas. */
function glowSprite() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'))
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.6)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  return new Texture({ image: c })
}

export default function run({ canvas, gui }) {
  const view = new View({ canvas, orbit: { maxPitch: 1.3 }, camera: { position: [7, 4.5, 9], target: [0, 1.2, 0] } })
  const scene = view.scene
  const glow = glowSprite()
  /** A bulb that glows: an unlit sphere and an additive halo. @param {string} color */
  const bulb = (color, radius = 0.12) => {
    const g = new Group()
    g.add(new Mesh({ geometry: sphere({ radius }), material: { color, unlit: true } }))
    g.add(new Points({ geometry: new Geometry({ positions: [0, 0, 0] }), material: { color, size: radius * 9, map: glow, blending: 'additive', depthWrite: false } }))
    return g
  }

  // the set: a floor, the teapot on a plinth, columns in a ring
  scene.add(new Mesh({ geometry: plane(16), material: { color: '#8a8a90', roughness: 0.85 }, receiveShadow: true }))
  scene.add(new Mesh({ geometry: cylinder({ radius: 1.3, height: 0.5, segments: 64 }), material: { color: '#d9d4cc', roughness: 0.5 }, position: [0, 0.25, 0], castShadow: true, receiveShadow: true }))
  const geometry = fromPolygons({ ...teapot, smooth: true })
  const box = geometry.bounds, s = 1.8 / (box.getRadius() || 1), c = box.getCenter()
  scene.add(new Mesh({ geometry, material: { color: '#f2ede4', roughness: 0.2 }, scale: s, position: [-c[0] * s, 0.5 - box.min[1] * s, -c[2] * s], castShadow: true, receiveShadow: true }))
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3
    scene.add(new Mesh({ geometry: cylinder({ radius: 0.28, height: 3.2, segments: 32 }), material: { color: '#c9c4bb', roughness: 0.6 }, position: [Math.cos(a) * 4.2, 1.6, Math.sin(a) * 4.2], castShadow: true, receiveShadow: true }))
  }

  // the lamp: an arm hung from a pivot overhead; the head and its spot light ride on the arm
  const pivot = scene.add(new Group({ position: [0, 5.6, 0] }))
  pivot.add(new Mesh({ geometry: cylinder({ radius: 0.03, height: 2.4 }), material: { color: '#222' }, position: [0, -1.2, 0] }))
  const head = pivot.add(new Group({ position: [0, -2.4, 0] }))
  head.add(new Mesh({ geometry: cylinder({ radius: 0.35, radiusTop: 0.08, height: 0.4, segments: 32 }), material: { color: '#2b2b30', roughness: 0.4, metalness: 0.6 }, castShadow: true }))
  head.add(bulb('#fff2d0', 0.1)).position.set(0, -0.22, 0)
  const lamp = head.add(new SpotLight({ color: '#fff2d0', direction: [0, -1, 0], angle: 0.55, penumbra: 0.5, range: 12, position: [0, -0.2, 0] }))

  // the moods' own lights, switched on and off as a mood is chosen
  const sky = scene.add(new HemisphereLight({ sky: '#dfe8ff', ground: '#3a3530' }))
  const ambient = scene.add(new AmbientLight({ color: '#1a1030' }))
  const sun = scene.add(new DirectionalLight({ castShadow: true }))
  const neon = ['#ff2bd6', '#2be8ff', '#ffd52b'].map((color, i) => {
    const orbit = scene.add(new Group({ rotation: [0, (i / 3) * Math.PI * 2, 0] }))
    const light = orbit.add(new PointLight({ color, position: [3, 1.6 + i * 0.5, 0], range: 14 }))
    light.add(bulb(color))
    return { orbit, light }
  })

  const MOODS = {
    sunset: { background: '#2a1e2e', environment: 'none', sky: 0.35, ambient: 0.4, sun: { color: '#ff9a52', intensity: 2.2, direction: [-1, -0.28, -0.35] }, neon: 0, lamp: 10 },
    neon: { background: '#07060c', environment: 'none', sky: 0.04, ambient: 0.6, sun: { color: '#ffffff', intensity: 0, direction: [0, -1, 0] }, neon: 22, lamp: 26 },
  }
  const settings = { mood: 'sunset', speed: 1, swing: 0.5 }
  const setMood = () => {
    const m = MOODS[settings.mood]
    scene.background = m.background
    scene.environment = m.environment
    sky.intensity = m.sky
    ambient.intensity = m.ambient
    sun.color.set(m.sun.color)
    sun.intensity = m.sun.intensity
    sun.direction.copy(m.sun.direction).normalize()
    sun.castShadow = m.sun.intensity > 0
    for (const n of neon) {
      n.light.intensity = m.neon
      n.light.visible = m.neon > 0
    }
    lamp.intensity = m.lamp
  }
  setMood()

  gui.add(settings, 'mood', Object.keys(MOODS)).onChange(setMood)
  gui.add(settings, 'speed', 0, 3, 0.1).name('neon speed')
  gui.add(settings, 'swing', 0, 1, 0.05).name('lamp swing')

  return view.start((dt, t) => {
    pivot.rotation.z = Math.sin(t * 1.1) * settings.swing * 0.6
    pivot.rotation.x = Math.sin(t * 0.7) * settings.swing * 0.3
    neon.forEach(({ orbit }, i) => orbit.rotateY((0.4 + i * 0.15) * settings.speed * dt))
  })
}
