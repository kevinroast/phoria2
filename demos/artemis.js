import { AmbientLight, Box3, DirectionalLight, Geometry, Group, Label, Lines, Mesh, Points, Texture, View, box, curve, cylinder, ellipse, sphere } from 'phoria2'
import { Timeline, face, follow, reveal } from 'phoria2/motion'
import { glow, starfield } from './kit.js'
import { clouds } from './planets.js'

// An explainer of the Artemis IV concept of operations, with the Blue Moon Mark 2 lander: three
// transfer stages and the lander launch, stack and boost to the Moon; Orion follows on SLS, docks,
// and two crew go down and back up; then Orion brings them home. Schematic, not to scale - like the
// poster it's drawn from. Each step is a step on a Timeline (phoria2/motion) that moves its craft
// along a curve (follow) and draws its path in as it goes (reveal); the numbered badges and the
// caption follow the timeline.

// orbits sit well clear of their bodies, so the craft on them never touch the surface
const E = [-7, 0, 0], EARTH = 1.8, LEO = 3.3
const M = [8.2, -0.9, 0], MOON = 1.2, LLO = 2.35
const EPO_CENTER = [M[0], M[1] + 0.35, 0], EPO_X = 3.5, EPO_Y = 3
const BLUE = '#5ab4ff', ORANGE = '#ff8a3d', PURPLE = '#a35cff'

/** A point at an angle (degrees) round a centre, in the x-y plane - the poster's plane. */
const around = (c, rx, deg, ry = rx, z = 0) => {
  const a = deg * Math.PI / 180
  return [c[0] + Math.cos(a) * rx, c[1] + Math.sin(a) * ry, c[2] + z]
}
const leo = (deg) => around(E, LEO, deg)
const llo = (deg) => around(M, LLO, deg)
const epo = (deg) => around(EPO_CENTER, EPO_X, deg, EPO_Y)
/** Points along an arc of one of those, from one angle to another. */
const arc = (at, from, to, step = 6) => {
  const n = Math.max(1, Math.ceil(Math.abs(to - from) / step))
  return Array.from({ length: n + 1 }, (_, i) => at(from + (to - from) * i / n))
}
/** Progress through part of a step: 0 before a, 1 after b. */
const part = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)))
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const plus = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]
const unit = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l) }
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t)
/** Eased 0 - 1: starts and ends gently, so nothing jerks into motion or stops dead. */
const smooth = (t) => t * t * (3 - 2 * t)

// --- craft, built along +y with the nose up; follow() and face() are told so with NOSE. They turn
// through every heading in the x-y plane, so their up is out of it, toward the viewer
/** @type {import('phoria2/motion').FollowOptions} */
const NOSE = { forward: '+y', up: [0, 0, 1] }
// drawn larger than life - this is a schematic, and they need to read at a glance
const SCALE = 1.7
const MAT = {
  gold: { color: '#d8b25a', metalness: 0.7, roughness: 0.35 },
  white: { color: '#e8e8ec', roughness: 0.5 },
  grey: { color: '#8a8f99', metalness: 0.5, roughness: 0.45 },
  dark: { color: '#2a2c33', metalness: 0.6, roughness: 0.4 },
  panel: { color: '#1f3a7a', metalness: 0.4, roughness: 0.3, emissive: '#0a1430' },
  orange: { color: '#d9772b', roughness: 0.6 },
}
/** @param {...import('phoria2').Node} parts */
function craft(...parts) {
  const g = new Group({ scale: SCALE })
  g.add(...parts)
  return g
}
const part3 = (geometry, material, position = [0, 0, 0], rotation = [0, 0, 0]) => new Mesh({ geometry, material, position, rotation })

function transferStage() {
  return craft(
    part3(cylinder({ radius: 0.09, height: 0.32, segments: 16 }), MAT.gold),
    part3(cylinder({ radius: 0.07, radiusTop: 0.03, height: 0.09, segments: 12 }), MAT.dark, [0, -0.2, 0]),
    part3(box({ width: 0.46, height: 0.012, depth: 0.09 }), MAT.panel, [0, 0.04, 0]),
  )
}
function lander() {
  const legs = [0, 1, 2, 3].map((i) => {
    const a = i * Math.PI / 2 + Math.PI / 4
    return part3(cylinder({ radius: 0.01, height: 0.22, segments: 6 }), MAT.grey, [Math.cos(a) * 0.12, -0.2, Math.sin(a) * 0.12], [Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45])
  })
  return craft(
    part3(cylinder({ radius: 0.11, height: 0.4, segments: 16 }), MAT.white),
    part3(cylinder({ radius: 0.085, height: 0.12, segments: 16 }), MAT.gold, [0, 0.26, 0]),
    part3(cylinder({ radius: 0.06, radiusTop: 0.025, height: 0.08, segments: 12 }), MAT.dark, [0, -0.24, 0]),
    ...legs,
  )
}
/** Orion: capsule, service module and four solar wings; the service module is dropped for splashdown. */
function orion() {
  const service = new Group()
  service.add(part3(cylinder({ radius: 0.09, height: 0.16, segments: 16 }), MAT.grey, [0, -0.06, 0]))
  for (const a of [Math.PI / 4, -Math.PI / 4]) service.add(part3(box({ width: 0.62, height: 0.008, depth: 0.08 }), MAT.panel, [0, -0.08, 0], [0, a, 0]))
  const capsule = part3(cylinder({ radius: 0.1, radiusTop: 0.035, height: 0.13, segments: 20 }), MAT.white, [0, 0.085, 0])
  const g = craft(capsule, service)
  return { node: g, service }
}
/** A launch vehicle drawn under its payload while it climbs: New Glenn, or SLS with its boosters. */
function rocket(kind) {
  const body = kind === 'sls'
    ? [part3(cylinder({ radius: 0.075, height: 0.7, segments: 16 }), MAT.orange, [0, -0.5, 0]),
      ...[-1, 1].map((s) => part3(cylinder({ radius: 0.035, height: 0.6, segments: 10 }), MAT.white, [s * 0.11, -0.55, 0]))]
    : [part3(cylinder({ radius: 0.065, height: 0.6, segments: 14 }), MAT.white, [0, -0.45, 0])]
  return craft(...body)
}
/** Parachutes over the capsule: three striped domes. */
function parachutes() {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 8
  const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'))
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = i % 2 ? '#f4f1ea' : '#ff6a1a'
    ctx.fillRect(i * c.width / 12, 0, c.width / 12 + 1, c.height)
  }
  const stripes = new Texture({ image: c })
  const dome = sphere({ radius: 0.2, segments: 24, rings: 8 })
  const g = new Group()
  for (const [x, z] of [[-0.24, 0], [0.24, 0], [0, 0.22]]) g.add(new Mesh({ geometry: dome, material: { map: stripes, roughness: 0.8, doubleSided: true }, position: [x, 0.55, z], scale: [1, 0.6, 1] }))
  return g
}

/** A glowing dot: crew moving between craft, or a beacon. */
const dot = (color, size, sprite) => new Points({ geometry: new Geometry({ positions: [0, 0, 0] }), material: { color, size, map: sprite, blending: 'additive', depthWrite: false }, pickable: false })

export default function run({ canvas, gui, info }) {
  // framed to the whole Earth-to-Moon picture, kept in view whatever the window's shape; a narrow
  // field of view from further back, so the planets stay round out at the edges
  const view = new View({ canvas, orbit: true, background: '#04050a', framing: 'both', camera: { fov: 22, position: [1.5, 2.5, 20], target: [1.5, 0.4, 0] } })
  const { scene } = view
  // the lines don't write depth - where they cross or run together, the later one simply draws
  // over the earlier, rather than the two fighting over the same depth. So they draw first, in
  // order: stars, orbits, then routes; everything solid draws over them as usual
  const ORDER = { stars: -3, orbits: -2, routes: -1 }
  scene.add(starfield(12000, 300)).renderOrder = ORDER.stars
  scene.add(new AmbientLight({ intensity: 0.35 }))
  scene.add(new DirectionalLight({ direction: [0.45, -0.25, -1], intensity: 1.6 }))
  const sprite = glow(32)

  // --- Earth, Moon and orbits
  const earth = scene.add(new Group({ position: E, rotation: [0.4, 0, 0.2] }))
  const globe = earth.add(new Mesh({
    geometry: sphere({ radius: EARTH, segments: 64, rings: 32 }), pickable: false,
    // NASA's Blue Marble (public domain) - see public/textures/CREDITS.md
    material: { map: { url: 'textures/earth_blue_marble_2048.jpg' }, roughness: 0.8 },
  }))
  const cloudLayer = earth.add(new Mesh({ geometry: sphere({ radius: EARTH * 1.02, segments: 64, rings: 32 }), material: { map: clouds({ cover: 0.32 }), opacity: 0.85, transparent: true, depthWrite: false, roughness: 1 }, pickable: false }))
  earth.add(dot('#4f9cff', EARTH * 3, sprite)).material.opacity = 0.35
  scene.add(new Mesh({
    geometry: sphere({ radius: MOON, segments: 48, rings: 24 }), position: M, pickable: false,
    // NASA's LRO colour map (public domain) - see public/textures/CREDITS.md
    material: { map: { url: 'textures/moon_lroc_1k.jpg' }, roughness: 0.95 },
  }))
  const orbitLine = (path, color, width = 1.5) => scene.add(new Lines({ geometry: path.line(), material: { color, width, depthWrite: false }, renderOrder: ORDER.orbits, pickable: false }))
  orbitLine(ellipse({ plane: 'xy', radius: LEO, center: E }), '#26355f')
  orbitLine(ellipse({ plane: 'xy', radius: LLO, center: M }), '#3a3f52')
  orbitLine(ellipse({ plane: 'xy', radiusX: EPO_X, radiusY: EPO_Y, center: EPO_CENTER }), PURPLE, 2)

  // --- the routes. Everything in low Earth orbit runs clockwise over the top: the transfer stages
  // launch from the left and park spaced out along the orbit, the lander comes over them a little
  // higher and drops in ahead of them at S, and the stack leaves for the Moon from there
  const S = leo(40)
  // the way the orbit runs at S, so the stack lines up along it
  const ahead = [Math.sin(40 * Math.PI / 180), -Math.cos(40 * Math.PI / 180), 0]
  const PARK = [58, 74, 90]
  /** A gravity turn from the pad: straight up at first, levelling off into an orbit of radius r. */
  const ascent = (lift, r) => Array.from({ length: 8 }, (_, i) => {
    const s = i / 7
    return around(E, EARTH + (r - EARTH) * (1 - (1 - s) ** 2), lift - 28 * s * s)
  })
  const P = {
    stages: [0, 1, 2].map((k) => {
      const lift = 156 - k * 12
      return curve([...ascent(lift, LEO), ...arc(leo, lift - 34, PARK[k])])
    }),
    // over the parked stages, easing down into the orbit at S
    landerUp: curve([...ascent(172, LEO + 0.45), ...arc((deg) => around(E, LEO + 0.45 * smooth(part(deg, 40, 72)), deg), 138, 40)]),
    tli: curve([S, plus(S, ahead, 1.2), [-1, -0.3, 0.2], [3.4, -0.55, 0.3], epo(182)]),
    loiter: curve(arc(epo, 182, 207)),
  }
  const meet = P.loiter.at(1).toArray()
  P.orion = curve([around(E, EARTH, -26), [-1.5, -2.2, -0.2], [3.2, -2.5, -0.2], plus(meet, [-1.3, -0.3, 0])])
  const orionEnd = P.orion.at(1).toArray()
  const docked = plus(meet, unit(sub(orionEnd, meet)), 0.56)
  const backedOff = plus(meet, unit(sub(orionEnd, meet)), 1.15)
  P.toLLO = curve([meet, around(M, LLO + 0.6, 218), ...arc(llo, 236, 266)])
  P.orionLoiter = curve([backedOff, ...arc(epo, 222, 328)])
  const landing = around(M, MOON + 0.06, 256)
  P.down = curve([llo(266), around(M, (MOON + LLO) / 2, 262), landing])
  // the spent stage carries on round from where it rode behind the lander, climbing away
  const gap = 0.7, parted = 266 - gap / LLO * 180 / Math.PI
  P.stageAway = curve([...arc(llo, parted, parted + 12), around(M, LLO + 0.35, 290), around(M, LLO + 0.9, 320)])
  const wait = P.orionLoiter.at(1).toArray()
  const climb = around(M, LLO + 0.6, 312)
  P.up = curve([landing, llo(290), climb, plus(wait, unit(sub(climb, wait)), 0.5)])
  const rendezvous = P.up.at(1).toArray()
  P.undock = curve([wait, ...arc(epo, 336, 378)])
  const home = around(E, EARTH + 1.6, 126)
  P.home = curve([P.undock.at(1).toArray(), [10.6, 3.6, 0.6], [5.5, 6.2, 1], [-1.5, 6.6, 1], [-7.2, 5.3, 0.5], home])
  P.splash = curve([home, around(E, EARTH + 0.06, 140)])

  const path = (route, color, dash) => scene.add(new Lines({ geometry: route.line(dash ? { dash: [0.22, 0.14] } : {}), material: { color, width: 2.5, depthWrite: false }, renderOrder: ORDER.routes, pickable: false }))
  const L = {
    stages: P.stages.map((r) => path(r, BLUE)), landerUp: path(P.landerUp, BLUE), tli: path(P.tli, BLUE), loiter: path(P.loiter, BLUE),
    orion: path(P.orion, ORANGE), toLLO: path(P.toLLO, BLUE), orionLoiter: path(P.orionLoiter, ORANGE, true), down: path(P.down, BLUE),
    up: path(P.up, BLUE), undock: path(P.undock, ORANGE), home: path(P.home, ORANGE, true),
  }

  // --- the craft
  const stages = [0, 1, 2].map(() => scene.add(transferStage()))
  const stageRockets = stages.map((s) => s.add(rocket('glenn')))
  const blueMoon = scene.add(lander())
  const landerRocket = blueMoon.add(rocket('glenn'))
  const { node: capsule, service } = orion()
  scene.add(capsule)
  const sls = capsule.add(rocket('sls'))
  const chutes = capsule.add(parachutes())
  const crew = [scene.add(dot('#7fe8ff', 0.22, sprite)), scene.add(dot('#7fe8ff', 0.22, sprite))]
  const beacon = scene.add(dot('#ffe08a', 0.9, sprite))
  beacon.position.copy(plus(landing, unit(sub(landing, M)), 0.25))

  // --- moving them smoothly. A craft never snaps to a new heading: where its course changes - onto
  // a new route, or to face a docking port or stand on the surface - it turns over a short while
  const probe = new Group(), spot = new Group()
  /** The way a craft faces t along a route. */
  const along = (route, t) => follow(probe, route, t, NOSE).quaternion.clone()
  /** The way a craft at a point faces a direction. */
  const toward = (at, dir) => {
    probe.position.copy(at)
    return face(probe, dir, NOSE).quaternion.clone()
  }
  /** Turn a node from one heading to another: t 0 is the first, 1 the second. */
  const turn = (node, from, to, t) => node.quaternion.copy(from).slerp(to, smooth(t))
  /** Turn a node from a heading to the one it has now, over t. */
  const turnFrom = (node, from, t) => turn(node, from, node.quaternion.clone(), t)
  /** Upright on a body, nose out from its centre. */
  const upright = (at, centre) => toward(at, sub(at, centre))
  const TURN = 0.6 // distance along a new route over which a craft comes round to it

  /**
   * Put a craft some distance along a route. Before its start, it's still on the route before (or
   * straight back along its first direction) - so craft riding behind one another follow the same
   * track round a corner, each turning as it reaches it.
   */
  const ride = (node, route, distance, before) => {
    if (distance < 0 && before) return ride(node, before, before.length + distance)
    if (distance < 0) {
      node.position.copy(plus(route.at(0).toArray(), route.tangentAt(0).toArray(), distance))
      node.quaternion.copy(along(route, 0))
      return
    }
    follow(node, route, distance / route.length, NOSE)
    if (before && distance < TURN) turnFrom(node, along(before, 1), distance / TURN)
  }
  /** The stack: the lander leading, the transfer stages still attached riding behind it. */
  const stack = (route, t, attached, before) => {
    ride(blueMoon, route, t * route.length, before)
    attached.forEach((s, i) => ride(s, route, t * route.length - gap * (i + 1), before))
  }
  /** A point d behind the start of a route, straight back along its first direction. */
  const behind = (route, d) => plus(route.at(0).toArray(), route.tangentAt(0).toArray(), -d)
  /** A launch vehicle or spent stage parting: it drops back and shrinks away, s 0 - 1. */
  const separate = (node, s, back = 0.55) => {
    node.visible = s < 1
    node.position.y = -back * smooth(s)
    node.scale.setScalar(SCALE * (1 - smooth(s)))
  }
  /** Shrink a craft away as it leaves the story, s 0 - 1. */
  const fade = (node, s) => {
    node.visible = s < 1
    node.scale.setScalar(SCALE * (1 - smooth(s)))
  }
  /** Crew moving from one craft to the other. */
  const transfer = (from, to, t) => crew.forEach((c, i) => {
    const u = smooth(part(t, i * 0.2, 0.8 + i * 0.2))
    c.visible = u > 0 && u < 1
    c.position.copy(mix(from, to, u))
  })

  // headings where one move hands over to the next
  const Q = {
    parked: P.stages.map((r) => along(r, 1)), landerIn: along(P.landerUp, 1), tli: along(P.tli, 0), toLLO: along(P.toLLO, 1),
    orionIn: along(P.orion, 1), docking: toward(orionEnd, sub(meet, orionEnd)), loitered: along(P.orionLoiter, 1),
    redocking: toward(wait, sub(rendezvous, wait)), landed: upright(landing, M), undocked: along(P.undock, 1), home: along(P.home, 1),
  }

  // --- the story
  const STEPS = [
    'Transfer stages launch', 'Lander launch', 'Transfer stages stack with the lander', 'Transfer stages 3 and 2 boost the lander',
    'Trans-lunar injection', 'Lander loiters in elliptical polar orbit', 'Orion launches on SLS', 'Orion docks - two crew move into the lander',
    'Transfer stage takes the lander to low lunar orbit', 'Orion loiters', 'Lander descends', 'Crew on the surface', 'Lander ascends',
    'Orion redocks - crew return to Orion', 'Orion undocks', 'Crew return to Earth', 'Splashdown',
  ]
  const story = new Timeline({ loop: true })
  const [stage1, stage2, stage3] = stages
  story
    .add(5, (t) => stages.forEach((s, k) => {
      // each climbs, drops its launch vehicle, and eases into its parking spot
      const u = smooth(part(t, k * 0.17, k * 0.17 + 0.66))
      s.visible = u > 0
      s.scale.setScalar(SCALE)
      follow(s, P.stages[k], u, NOSE)
      stageRockets[k].visible = u > 0
      separate(stageRockets[k], part(u, 0.2, 0.42))
      reveal(L.stages[k], u)
    }), { label: STEPS[0] })
    .add(3.5, (t) => {
      blueMoon.visible = t > 0
      blueMoon.scale.setScalar(SCALE)
      follow(blueMoon, P.landerUp, t, NOSE)
      landerRocket.visible = t > 0
      separate(landerRocket, part(t, 0.12, 0.3))
      reveal(L.landerUp, t)
    }, { label: STEPS[1], ease: 'inOut' })
    .add(2.5, (t) => {
      // the stages close up behind the lander, all turning to the way they'll leave
      if (t > 0) {
        follow(blueMoon, P.tli, 0, NOSE)
        turn(blueMoon, Q.landerIn, Q.tli, t)
      }
      stages.forEach((s, k) => {
        s.position.copy(mix(P.stages[k].at(1).toArray(), behind(P.tli, gap * (k + 1)), t))
        if (t > 0) turn(s, Q.parked[k], Q.tli, t)
      })
    }, { label: STEPS[2], ease: 'inOut' })
    .add(3.5, (t) => {
      const u = t * 0.35
      reveal(L.tli, u)
      if (t === 0) return
      stack(P.tli, u, stages)
      // stage 3 burns out and drops away, then stage 2
      for (const [s, k, from] of /** @type {const} */ ([[stage3, 2, 0.3], [stage2, 1, 0.65]])) {
        const away = part(t, from, from + 0.35)
        if (away === 0) continue
        // from where it was when it let go, falling back
        const d = from * 0.35 * P.tli.length - gap * (k + 1)
        ride(spot, P.tli, d)
        const back = P.tli.tangentAt(Math.max(0, d) / P.tli.length).toArray()
        s.position.copy(plus(plus(spot.position.toArray(), back, -0.9 * smooth(away)), [0, 0.35, 0.3], smooth(away)))
        s.quaternion.copy(spot.quaternion)
        fade(s, part(away, 0.4, 1))
      }
    }, { label: STEPS[3], ease: 'in' })
    .add(4, (t) => {
      reveal(L.tli, 0.35 + 0.65 * t)
      if (t > 0) stack(P.tli, 0.35 + 0.65 * t, [stage1])
    }, { label: STEPS[4], ease: 'out' })
    .add(3.5, (t) => {
      reveal(L.loiter, t)
      if (t > 0) stack(P.loiter, t, [stage1], P.tli)
    }, { label: STEPS[5], ease: 'inOut' })
    .add(5, (t) => {
      capsule.visible = t > 0
      service.visible = true
      chutes.visible = false
      follow(capsule, P.orion, t, NOSE)
      sls.visible = t > 0
      separate(sls, part(t, 0.12, 0.26), 0.7)
      reveal(L.orion, t)
    }, { label: STEPS[6], ease: 'inOut' })
    .add(4.5, (t) => {
      if (t === 0) return
      // turn to the port and close in, crew across, then back off
      const close = smooth(part(t, 0, 0.32)), back = smooth(part(t, 0.75, 1))
      capsule.position.copy(back > 0 ? mix(docked, backedOff, back) : mix(orionEnd, docked, close))
      turn(capsule, Q.orionIn, Q.docking, part(t, 0, 0.2))
      transfer(docked, meet, part(t, 0.34, 0.72))
    }, { label: STEPS[7] })
    .add(4, (t) => {
      reveal(L.toLLO, t)
      if (t > 0) stack(P.toLLO, t, [stage1], P.loiter)
    }, { label: STEPS[8], ease: 'inOut' })
    .add(3.5, (t) => {
      reveal(L.orionLoiter, t)
      if (t === 0) return
      follow(capsule, P.orionLoiter, t, NOSE)
      turnFrom(capsule, Q.docking, part(t, 0, 0.4))
    }, { label: STEPS[9], ease: 'inOut' })
    .add(4, (t) => {
      reveal(L.down, t)
      if (t === 0) return
      // the last transfer stage lets go and climbs away, then the lander goes down, turning to land
      // engine first
      follow(stage1, P.stageAway, part(t, 0, 0.85), NOSE)
      fade(stage1, part(t, 0.55, 0.85))
      const down = part(t, 0.1, 1)
      follow(blueMoon, P.down, smooth(down), { orient: false })
      turn(blueMoon, Q.toLLO, upright(blueMoon.position.toArray(), M), part(down, 0, 0.45))
    }, { label: STEPS[10] })
    .add(3.5, (t) => { beacon.visible = t > 0 && t < 1 }, { label: STEPS[11] })
    .add(3.5, (t) => {
      reveal(L.up, t)
      if (t === 0) return
      follow(blueMoon, P.up, t, NOSE)
      turnFrom(blueMoon, Q.landed, part(t, 0, 0.3))
    }, { label: STEPS[12], ease: 'inOut' })
    .add(4, (t) => {
      if (t === 0) return
      const close = smooth(part(t, 0, 0.32))
      capsule.position.copy(mix(wait, plus(rendezvous, unit(sub(wait, rendezvous)), 0.56), close))
      turn(capsule, Q.loitered, Q.redocking, part(t, 0, 0.3))
      transfer(rendezvous, capsule.position.toArray(), part(t, 0.36, 0.76))
    }, { label: STEPS[13] })
    .add(3.5, (t) => {
      reveal(L.undock, t)
      if (t === 0) return
      follow(capsule, P.undock, t, NOSE)
      turnFrom(capsule, Q.redocking, part(t, 0, 0.4))
      fade(blueMoon, part(t, 0.25, 0.6))
    }, { label: STEPS[14], ease: 'inOut' })
    .add(6, (t) => {
      reveal(L.home, t)
      if (t === 0) return
      follow(capsule, P.home, t, NOSE)
      turnFrom(capsule, Q.undocked, part(t, 0, 0.12))
    }, { label: STEPS[15], ease: 'inOut' })
    .add(4, (t) => {
      if (t === 0) return
      // the service module is gone; the capsule turns top up and comes down under its parachutes
      service.visible = false
      follow(capsule, P.splash, t, { orient: false })
      turn(capsule, Q.home, upright(capsule.position.toArray(), E), part(t, 0, 0.25))
      chutes.visible = t > 0.18
      chutes.scale.set(1, smooth(part(t, 0.18, 0.45)), 1)
    }, { label: STEPS[16] })
    .add(1.5, () => {}, { label: STEPS[16] })

  // --- the numbered badges: the step playing now says what it is; earlier ones just their number
  const anchors = [
    plus(P.stages[1].at(0.15).toArray(), [-0.55, 0.3, 0]), plus(P.landerUp.at(0.32).toArray(), [-0.1, 0.5, 0]), plus(S, [0.75, 0.35, 0]),
    plus(P.tli.at(0.2).toArray(), [0.6, 0.2, 0]), plus(P.tli.at(0.7).toArray(), [0, 0.55, 0]), plus(P.loiter.at(0.5).toArray(), [-0.6, 0.4, 0]),
    plus(P.orion.at(0.45).toArray(), [0, -0.5, 0]), plus(meet, [-0.8, -0.65, 0]), plus(P.toLLO.at(0.5).toArray(), [-0.75, 0, 0]),
    plus(P.orionLoiter.at(0.5).toArray(), [0, -0.55, 0]), plus(P.down.at(0.4).toArray(), [-0.7, -0.15, 0]), plus(landing, [0.65, -0.35, 0]),
    plus(P.up.at(0.55).toArray(), [0.6, -0.2, 0]), plus(rendezvous, [0.55, -0.55, 0]), plus(P.undock.at(0.6).toArray(), [0.65, 0, 0]),
    plus(P.home.at(0.5).toArray(), [0, 0.5, 0]), plus(home, [1.1, 0.45, 0]),
  ]
  const badges = anchors.map((position, i) => scene.add(new Label({ text: String(i + 1), position, className: 'mission-step', overlap: 'show' })))
  story.onStep((index) => {
    const now = Math.min(index, STEPS.length - 1)
    badges.forEach((b, i) => {
      b.visible = i <= now
      b.text = i === now ? `${i + 1}  ${STEPS[i]}` : String(i + 1)
      b.className = i === now ? 'mission-step now' : 'mission-step'
      b.priority = i === now ? 2 : 1
    })
    info.textContent = `${now + 1} / ${STEPS.length}  ${STEPS[now]}`
  })
  story.seek(0)
  if (import.meta.env.DEV) Object.assign(window, { story, view, craft: { stages, blueMoon, capsule } })
  view.frame(new Box3([-10.6, -4.4, -1], [12.4, 7.2, 1]), { padding: 0.02 })

  const controls = {
    'play / pause': () => (story.playing ? story.pause() : story.play()),
    'previous step': () => story.seekStep(Math.max(0, Math.min(story.step, STEPS.length - 1) - 1)),
    'next step': () => story.seekStep(Math.min(STEPS.length - 1, story.step + 1)),
    restart: () => story.seek(0).play(),
  }
  for (const name of Object.keys(controls)) gui.add(controls, name)
  gui.add(story, 'speed', 0.25, 3, 0.25)

  return view.start((dt, t) => {
    story.update(dt)
    globe.rotateY(0.04 * dt)
    cloudLayer.rotateY(0.055 * dt)
    beacon.scale.setScalar(1 + 0.3 * Math.sin(t * 6))
  })
}
