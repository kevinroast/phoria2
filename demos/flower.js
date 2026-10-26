import { Geometry, Group, InstancedMesh, Mesh, icosphere, sphere } from 'phoria2'
import { random } from './kit.js'

// A daisy, built from geometry made in code: petals are curved, tapering strips in two rings;
// the centre is a dome covered in florets laid out on a sunflower spiral (one InstancedMesh); a
// stem curves away below, with green sepals under the head and a leaf part way down. The head
// faces +z, tilted up a little; the stem hangs below the origin.

/**
 * A petal or leaf: a strip along +x, widest past its middle with a rounded tip, cupped across and
 * curving up then down along its length.
 * @param {{ length?: number, width?: number, lift?: number, droop?: number, cup?: number }} [shape]
 */
function petal({ length = 1, width = 0.3, lift = 0.06, droop = 0.14, cup = 0.025 } = {}) {
  const along = 14, across = 6
  const positions = [], indices = []
  for (let i = 0; i <= along; i++) {
    const u = i / along
    // narrow at the base, widening to full width at 55%, then a rounded (elliptical) tip
    const half = width / 2 * (u < 0.55 ? 0.35 + 0.65 * u / 0.55 : Math.sqrt(Math.max(0, 1 - ((u - 0.55) / 0.45) ** 2)))
    for (let j = 0; j <= across; j++) {
      const v = j / across * 2 - 1
      positions.push(u * length, lift * u - droop * u * u + cup * (1 - v * v), v * half)
    }
  }
  for (let i = 0; i < along; i++) {
    for (let j = 0; j < across; j++) {
      const a = i * (across + 1) + j, b = a + across + 1
      indices.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
  return new Geometry({ positions, indices })
}

/** A tube along a list of points, its radius tapering from `start` to `end`. */
function tube(points, start, end, sides = 10) {
  const positions = [], indices = []
  points.forEach((p, i) => {
    const q = points[Math.min(i + 1, points.length - 1)], o = points[Math.max(i - 1, 0)]
    // the direction along the tube here, and two directions square to it for the ring
    const t = norm(q.map((v, k) => v - o[k]))
    const n = norm(cross(t, Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]))
    const b = cross(t, n)
    const r = start + (end - start) * i / (points.length - 1)
    for (let s = 0; s < sides; s++) {
      const a = s / sides * Math.PI * 2, c = Math.cos(a) * r, d = Math.sin(a) * r
      positions.push(p[0] + n[0] * c + b[0] * d, p[1] + n[1] * c + b[1] * d, p[2] + n[2] * c + b[2] * d)
    }
  })
  for (let i = 0; i < points.length - 1; i++) {
    for (let s = 0; s < sides; s++) {
      const a = i * sides + s, b = i * sides + (s + 1) % sides
      indices.push(a, a + sides, b, b, a + sides, b + sides)
    }
  }
  return new Geometry({ positions, indices })
}

/** A daisy, about 2.5 units tall, its head at the origin. */
export function daisy() {
  const r = random(5)
  const flower = new Group()
  const head = flower.add(new Group({ rotation: [-0.5, 0, 0.35] }))
  // the head is built facing up (+y); this turns it to face +z
  const face = head.add(new Group({ rotation: [Math.PI / 2, 0, 0] }))

  const white = { color: '#f7f6f0', roughness: 0.55, doubleSided: true }
  const shapes = [petal({ length: 0.85 }), petal({ length: 0.8, width: 0.28, droop: 0.22 }), petal({ length: 0.82, width: 0.26, lift: 0.1 })]
  for (const [ring, count, rise] of [[0, 15, 0.02], [1, 15, 0]]) {
    for (let i = 0; i < count; i++) {
      const a = (i + ring * 0.5) / count * Math.PI * 2 + (r() - 0.5) * 0.08
      // each petal turned out from the centre, tipped up or down a little, and twisted
      face.add(new Mesh({
        geometry: shapes[Math.floor(r() * shapes.length)], material: white,
        position: [Math.cos(a) * 0.22, rise, -Math.sin(a) * 0.22],
        rotation: [(r() - 0.5) * 0.3, a, (r() - 0.5) * 0.1 + (ring ? -0.1 : 0.03)],
        scale: 0.9 + r() * 0.2,
      }))
    }
  }

  // the centre: a dome, and florets packed on it in the sunflower's spiral
  face.add(new Mesh({ geometry: sphere({ radius: 1, segments: 32, rings: 16 }), material: { color: '#e9a810', roughness: 0.7 }, scale: [0.3, 0.12, 0.3], position: [0, 0.02, 0] }))
  const FLORETS = 260, golden = Math.PI * (3 - Math.sqrt(5))
  const florets = face.add(new InstancedMesh({ geometry: icosphere({ radius: 0.026, detail: 1 }), material: { roughness: 0.6 }, count: FLORETS }))
  for (let i = 0; i < FLORETS; i++) {
    const d = Math.sqrt(i / FLORETS), a = i * golden
    // on the dome's surface, deeper orange towards the middle
    florets.setInstance(i, {
      position: [Math.cos(a) * d * 0.29, 0.02 + 0.12 * Math.sqrt(Math.max(0, 1 - d * d)) + 0.008, Math.sin(a) * d * 0.29],
      color: d < 0.35 ? '#e8890c' : d < 0.7 ? '#f4b41a' : '#ffd23f',
    })
  }

  // green sepals under the head, pointing back and out
  const green = { color: '#4f9a3a', roughness: 0.6, doubleSided: true }
  const sepal = petal({ length: 0.3, width: 0.13, lift: -0.1, droop: 0.1, cup: 0.02 })
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2
    face.add(new Mesh({ geometry: sepal, material: green, position: [0, -0.05, 0], rotation: [0, a, -0.7] }))
  }

  // the stem: a curve from the back of the head, down and away
  const stem = []
  for (let i = 0; i <= 24; i++) {
    const t = i / 24, s = 1 - t
    // a quadratic curve through a control point that bows it out
    const p0 = [0, -0.1, -0.1], p1 = [0.05, -0.9, -0.4], p2 = [0.35, -2, -0.2]
    stem.push([0, 1, 2].map((k) => s * s * p0[k] + 2 * s * t * p1[k] + t * t * p2[k]))
  }
  flower.add(new Mesh({ geometry: tube(stem, 0.045, 0.035), material: { color: '#3f8a2e', roughness: 0.55 } }))
  // a leaf from part way down
  const leafAt = stem[14]
  flower.add(new Mesh({
    geometry: petal({ length: 0.8, width: 0.3, lift: 0.3, droop: 0.45, cup: 0.05 }), material: green,
    position: leafAt, rotation: [0.3, 0.6, 0.35], scale: [0.85, 1, 1],
  }))
  return flower
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function norm(v) {
  const l = Math.hypot(...v) || 1
  return v.map((x) => x / l)
}
