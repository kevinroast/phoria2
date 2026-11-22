import { Box3, DirectionalLight, Group, HemisphereLight, Mesh, PointLight, View, box, cylinder, extrude, icosphere, lathe, outline, plane } from 'phoria2'
import { Emitter } from 'phoria2/particles'
import { glow, random } from './kit.js'

// Particle emitters from phoria2/particles, each in a small set piece: a fountain at night whose
// drops fall into its basin or bounce off the paving - lamps at its foot washing the stone and
// the courtyard in colour, the water rippling where the spray lands and glowing under the jet - a
// brazier whose flame lights the rocks around it with
// a flickering point light while embers drift up, and snow drifting down over a few houses. Each
// is just a set of Emitter options - origin and spread, velocity, gravity, drag, lifetime and the
// colours a particle fades through - plus onParticle, called for every particle each frame.

// the water's height and edge, and the outside and top of the stone rim round it
const WATER = 0.5, BASIN = 1.95, RIM = 2.22, RIM_TOP = 0.66
// the basin's foot: its outside flares out from the rim to this at the ground
const FOOT = 2.5
// the water's ripples: how many at once, and the share of the drops landing in it that start one -
// so more drops, more ripples
const RIPPLES = 12, RIPPLE_CHANCE = 0.006
/** Set by the scene: a drop has landed in the water at (x, z). @type {((x: number, z: number) => void) | null} */
let landed = null
// how high each set's particles go
const ROOM = { fountain: 3.2, snow: 0 }
// the flame close up: the brazier and its fire filling the view, the rocks round it running off the edges
const FLAME_CLOSE = new Box3([-2.65, -0.1, -2.65], [2.65, 3.4, 2.65])
const PRESETS = {
  fountain: {
    rate: 2000, origin: [0, 1.45, 0], originSpread: 0.05, velocity: [0, 5.4, 0], velocitySpread: [0.85, 0.45, 0.85],
    gravity: [0, -9.8, 0], drag: 0, lifetime: [2.2, 2.8], color: ['#ffffff', '#d6ecff', '#7ab8ff', '#2a5cd0'], size: 0.035,
    blending: 'additive',
    // drops landing in the water - some starting a ripple where they land - or on the rim are gone;
    // those that miss splash on the paving - a bounce or two, losing most of their speed, then gone
    onParticle: (p) => {
      const r = Math.hypot(p.position.x, p.position.z)
      if (r < RIM && p.position.y < (r < BASIN ? WATER : RIM_TOP)) {
        if (r < BASIN) landed?.(p.position.x, p.position.z)
        return false
      }
      // or on the bowl's flared outside
      if (r >= RIM && r < FOOT && p.position.y < RIM_TOP * Math.sqrt((FOOT - r) / (FOOT - RIM))) return false
      if (p.position.y < 0) {
        if (p.velocity.y > -1) return false
        p.position.y = 0
        p.velocity.y *= -0.25
        p.velocity.x *= 0.3
        p.velocity.z *= 0.3
      }
    },
  },
  flame: {
    rate: 320, origin: [0, 1.05, 0], originSpread: 0.35, velocity: [0, 1.4, 0], velocitySpread: 0.35,
    gravity: [0, 1.8, 0], drag: 0.4, lifetime: [0.7, 1.2], color: ['#fff3c0', '#ffa630', '#d2400c', '#300800'], size: 0.5,
    blending: 'additive', onParticle: null,
  },
  snow: {
    rate: 500, origin: [0, 9, 0], originSpread: 9, velocity: [0, -1, 0], velocitySpread: [0.3, 0.2, 0.3],
    gravity: [0, 0, 0], drag: 0, lifetime: [9, 10], color: ['#ffffff', '#f2f6ff'], size: 0.15,
    blending: 'normal',
    // a slow sideways drift that differs from flake to flake, and gone on reaching the ground
    onParticle: (p) => {
      p.velocity.x = 0.45 * Math.sin(p.age * 0.9 + p.position.z * 0.7)
      p.velocity.z = 0.25 * Math.cos(p.age * 0.7 + p.position.x * 0.5)
      return p.position.y > 0.02
    },
  },
}

export default function run({ canvas, gui, info }) {
  // bloom: additive flames pile past white where they crowd, and glow most there; the coals and
  // windows, emissive, glow a little
  const view = new View({ canvas, orbit: { maxPitch: 1.25 }, background: '#0b0d13', bloom: { strength: 0.6, radius: 0.6, threshold: 0.8 }, camera: { position: [0, 4, 11], target: [0, 1.5, 0] } })
  const scene = view.scene
  scene.add(new HemisphereLight({ sky: '#2a3550', ground: '#0d0d10', intensity: 0.7 }))
  scene.add(new DirectionalLight({ color: '#b8c8ff', direction: [-0.4, -1, -0.6], intensity: 0.35, castShadow: true }))
  // the ground; round the fountain it is a paved courtyard - square flags and their joints, a few lines
  // of shader hook, faded out at the courtyard's edge, and switched off for the other sets (uPave)
  const ground = scene.add(new Mesh({
    geometry: plane(240), receiveShadow: true,
    material: {
      color: '#2a2c33', roughness: 0.95,
      shader: {
        uniforms: { uPave: 0 },
        fragment: `
          vec2 p = vWorldPosition.xz / 0.9;
          vec2 cell = floor(p), f = fract(p);
          vec2 w = fwidth(p) * 1.5;
          // the joints: thin dark lines, antialiased by how fast they change across a pixel
          vec2 joint = smoothstep(vec2(0.0), w + 0.03, f) * smoothstep(vec2(0.0), w + 0.03, 1.0 - f);
          float flag = 0.82 + 0.3 * hash(cell);
          float court = uPave * (1.0 - smoothstep(6.0, 8.5, length(vWorldPosition.xz)));
          base.rgb = mix(base.rgb, base.rgb * 1.25 * flag * mix(0.35, 1.0, joint.x * joint.y), court);
        `,
      },
    },
  }))
  const rand = random(7)
  const stone = { color: '#8d8a84', roughness: 0.9 }

  // the fountain: a stone bowl turned in one profile - up the outside, curving in from its broad foot
  // to the rounded rim, down the inside to its floor - the water a little above the floor, and a
  // spout in the middle
  const fountain = scene.add(new Group())
  const shoulder = RIM_TOP - (RIM - BASIN) / 2
  const flare = Array.from({ length: 7 }, (_, k) => { const s = k / 6; return [FOOT - (FOOT - RIM) * s * s, shoulder * s] })
  const rim = outline.arc({ radius: (RIM - BASIN) / 2, from: 0, to: Math.PI, center: [(RIM + BASIN) / 2, shoulder], segments: 12 })
  fountain.add(new Mesh({ geometry: lathe({ points: [[0, 0], ...flare, ...rim.slice(1), [BASIN, 0.44], [0, 0.44]], segments: 96 }), material: stone, castShadow: true, receiveShadow: true }))
  // the water: glossy, its surface bent by ripples - each where a drop really landed (RIPPLE_CHANCE
  // of them), a few wavelets spreading out, weakening as they go and fading. Lamps set in the basin's
  // floor glow up through it, blue, magenta and amber, shimmering as the ripples pass; and it glows
  // under the jet, as the lit spray shows in it. A ripple is a uniform each - x, z, when it started,
  // how strong - written in turn
  const ripple = (/** @type {number} */ i) => `
          {
            vec4 r = uRipple${i};
            float age = uTime - r.z;
            if (age > 0.0 && age < 1.8) {
              vec2 d = p - r.xy;
              float dist = length(d);
              float front = dist - age * 0.42;
              float packet = exp(-front * front * 55.0) * (1.0 - age / 1.8) * r.w / (1.0 + dist * 4.0);
              slope += d / max(dist, 1e-3) * sin(front * 70.0) * packet;
            }
          }`
  const water = fountain.add(new Mesh({
    geometry: cylinder({ radius: BASIN, height: 0.04, segments: 96 }), position: [0, WATER, 0],
    material: {
      color: '#0c2636', roughness: 0.06, metalness: 0.25,
      shader: {
        uniforms: Object.fromEntries(Array.from({ length: RIPPLES }, (_, i) => [`uRipple${i}`, [0, 0, -100, 0]])),
        fragment: `
          vec2 p = vWorldPosition.xz;
          vec2 slope = vec2(0.0);
          ${Array.from({ length: RIPPLES }, (_, i) => ripple(i)).join('')}
          normal = normalize(normal + vec3(slope.x, 0.0, slope.y) * 0.6);
          float shimmer = 1.0 + 1.2 * dot(slope, vec2(0.7, 0.7));
          vec3 glow = vec3(0.0);
          for (int i = 0; i < 3; i++) {
            float a = float(i) * 2.0944 + 0.5;
            vec2 lamp = vec2(sin(a), cos(a)) * 1.45;
            float d = length(p - lamp);
            vec3 tint = i == 0 ? vec3(0.23, 0.42, 1.0) : i == 1 ? vec3(1.0, 0.23, 0.78) : vec3(1.0, 0.69, 0.23);
            glow += tint * exp(-d * d * 2.2);
          }
          float c = length(p);
          emissive += (glow * 0.9 + vec3(0.35, 0.55, 0.95) * 0.5 * exp(-c * c * 1.6)) * max(shimmer, 0.2);
        `,
      },
    },
  }))
  const spout = [[0, 0.44], [0.22, 0.44], [0.16, 0.6], [0.1, 1.25], [0.17, 1.38], [0.14, 1.41], [0.06, 1.37], [0, 1.37]]
  fountain.add(new Mesh({ geometry: lathe({ points: spout, segments: 24 }), material: stone, castShadow: true }))
  // three lamps set in the paving at the bowl's foot - blue, magenta and amber - washing the stone
  // and the courtyard; their lenses glow, and bloom catches them
  for (const [i, color] of ['#3a6bff', '#ff3ac8', '#ffb03a'].entries()) {
    const a = (i / 3) * Math.PI * 2 + 0.5, x = Math.sin(a) * (FOOT + 0.3), z = Math.cos(a) * (FOOT + 0.3)
    fountain.add(new PointLight({ color, intensity: 5, range: 7, position: [x, 0.18, z] }))
    fountain.add(new Mesh({ geometry: cylinder({ radius: 0.12, height: 0.03, segments: 24 }), position: [x, 0.015, z], material: { color: '#111', emissive: color, emissiveIntensity: 4 } }))
  }

  // the brazier: a bowl of glowing coals on a pedestal - one turned iron profile - in a ring of
  // rocks, lit by its own fire
  const brazier = scene.add(new Group())
  const iron = [[0, 0], [0.45, 0], [0.43, 0.06], [0.16, 0.14], [0.12, 0.5], [0.3, 0.62], [0.85, 0.86], [0.9, 0.93], [0.82, 0.93], [0.3, 0.72], [0, 0.72]]
  brazier.add(new Mesh({ geometry: lathe({ points: iron, segments: 32 }), material: { color: '#352d29', metalness: 0.8, roughness: 0.42 }, castShadow: true }))
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2, r = rand() * 0.45
    brazier.add(new Mesh({ geometry: icosphere({ radius: 0.16, detail: 0 }), material: { color: '#1a0a05', emissive: '#ff5a1a', emissiveIntensity: 0.6 + rand(), flatShading: true }, position: [Math.cos(a) * r, 0.84, Math.sin(a) * r] }))
  }
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rand() * 0.2, r = 2.4 + rand() * 0.6, s = 0.6 + rand() * 0.9
    brazier.add(new Mesh({ geometry: icosphere({ radius: 0.3, detail: 0 }), material: { color: '#77706a', roughness: 0.85, flatShading: true }, position: [Math.cos(a) * r, 0.15 * s, Math.sin(a) * r], scale: [s, s * 0.7, s], rotation: [rand(), rand() * 3, rand()], castShadow: true, receiveShadow: true }))
  }
  const fire = brazier.add(new PointLight({ color: '#ff8a3a', intensity: 14, range: 10, position: [0, 1.6, 0] }))
  const embers = brazier.add(new Emitter({
    max: 300, rate: 30, origin: [0, 1.2, 0], originSpread: 0.4, velocity: [0, 2.2, 0], velocitySpread: [0.6, 0.6, 0.6],
    gravity: [0, 0.4, 0], drag: 0.3, lifetime: [1.5, 2.6], color: ['#ffd27a', '#ff6a00', '#200000'],
    material: { map: glow(), size: 0.06, blending: 'additive' },
  }))

  // the village: a few houses with snowy gable roofs and warm windows
  const village = scene.add(new Group())
  // a roof: a triangle in section, its ridge running along x, overhanging the walls
  const roof = extrude({ shape: [[-0.72, 0], [0.72, 0], [0, 0.62]], depth: 1.6, axis: 'x' })
  const HOUSES = [[-2.6, -1, 0.3], [0, -2.2, -0.2], [2.7, -0.8, 0.5], [-1.2, 1.6, 1.2], [1.7, 1.9, -0.6]]
  for (const [x, z, turn] of HOUSES) {
    const house = village.add(new Group({ position: [x, 0, z], rotation: [0, turn, 0] }))
    house.add(new Mesh({ geometry: box({ width: 1.4, height: 1, depth: 1.1 }), material: { color: '#6b4f3f', roughness: 0.9 }, position: [0, 0.5, 0], castShadow: true, receiveShadow: true }))
    house.add(new Mesh({ geometry: roof, material: { color: '#f4f6fa', roughness: 0.7 }, position: [0, 1, 0], castShadow: true }))
    house.add(new Mesh({ geometry: box({ width: 0.3, height: 0.3, depth: 0.02 }), material: { color: '#ffc46b', emissive: '#ffb050', emissiveIntensity: 1.6 }, position: [0.3, 0.55, 0.56] }))
  }

  // a drop landing in the water starts a ripple there now and then - in the next slot, the oldest
  const shader = /** @type {NonNullable<typeof water.material.shader>} */ (water.material.shader)
  let next = 0
  landed = (x, z) => {
    if (rand() > RIPPLE_CHANCE) return
    shader.uniforms[`uRipple${next}`] = [x, z, view.time, 0.6 + rand() * 0.6]
    next = (next + 1) % RIPPLES
  }

  const flakes = glow(32, { core: 0.4 })
  const soft = glow()
  // enough for the most the rate slider gives, at snow's ten-second lives
  const emitter = scene.add(new Emitter({ max: 20000, material: { map: soft } }))
  const sets = { fountain, flame: brazier, snow: village }
  const settings = { preset: 'flame' }
  const apply = () => {
    const { size, blending, ...options } = PRESETS[settings.preset]
    emitter.set(options)
    emitter.material.size = size
    emitter.material.blending = blending
    emitter.material.map = settings.preset === 'snow' ? flakes : soft
    emitter.clear()
    for (const [name, set] of Object.entries(sets)) set.visible = name === settings.preset
    const paving = /** @type {NonNullable<typeof ground.material.shader>} */ (ground.material.shader)
    paving.uniforms.uPave = settings.preset === 'fountain' ? 1 : 0
    embers.rate = settings.preset === 'flame' ? 30 : 0
    // the fountain seen low from the side, the blue and magenta lamps in front and the amber behind
    if (settings.preset === 'fountain') view.camera.position.set(7.4, 2.6, 0.5)
    else view.camera.position.set(0, settings.preset === 'snow' ? 5 : 3.5, 11)
    view.camera.target?.set(0, 1.2, 0)
    // the set piece, and the air its particles fill above it
    const room = settings.preset === 'flame' ? FLAME_CLOSE : sets[settings.preset].bounds.expandByPoint([0, ROOM[settings.preset], 0])
    view.frame(room, { padding: { flame: 0.1, snow: 0.15, fountain: 0 }[settings.preset] ?? 0.3 })
    gui.updateDisplay()
  }
  apply()

  const f = gui.addFolder('Emitter')
  f.add(settings, 'preset', Object.keys(PRESETS)).onChange(apply)
  f.add(emitter, 'rate', 0, 2000, 10)
  f.add(emitter, 'drag', 0, 3, 0.05)
  f.add(emitter.gravity, 'y', -15, 5, 0.1).name('gravity')
  f.add(emitter.material, 'size', 0.03, 1.5, 0.01)

  let shown = -1
  return view.start((dt, t) => {
    // the fire breathes: two slow waves and a fast one
    fire.intensity = 13 + 3 * Math.sin(t * 7.3) + 2 * Math.sin(t * 13.1 + 1) + 1.5 * Math.sin(t * 2.1)
    const n = emitter.count + (settings.preset === 'flame' ? embers.count : 0)
    if (Math.abs(n - shown) >= 10) {
      shown = n
      info.textContent = `${n.toLocaleString()} particles`
    }
  })
}
