import { DirectionalLight, HemisphereLight, Mesh, View, box, plane } from 'phoria2'

// A swimming pool in the sun: the light bent by the water's waves gathers into the bright, moving net
// of caustics on the pool's tiled floor and walls. The water is a sheet of glass as deep as the pool
// (its thickness), its waves a few lines of shader hook bending its normal - which bends the sun's
// light too (sun.caustics), drawn again each frame as the waves move. The sun's height and the waves'
// size are controls; the tiles and their grout are a shader hook as well.

// the pool's width (x), length (z) and depth, and the water's level below the deck
const W = 4, L = 7, DEPTH = 1.5, WATER = -0.12

// tiles on whichever face they're on - the two axes across it - with antialiased grout (fwidth), and a
// dark lane line down the floor
const TILES = `
  vec3 q = vWorldPosition / uTile;
  vec3 an = abs(vNormal);
  vec2 p = an.y > 0.5 ? q.xz : an.x > 0.5 ? q.zy : q.xy;
  vec2 f = abs(fract(p) - 0.5), w = fwidth(p);
  float grout = max(smoothstep(0.46 - w.x, 0.46 + w.x, f.x), smoothstep(0.46 - w.y, 0.46 + w.y, f.y));
  if (an.y > 0.5 && abs(vWorldPosition.x) < 0.18 && abs(vWorldPosition.z) < ${(L / 2 - 0.6).toFixed(2)}) base.rgb = vec3(0.04, 0.12, 0.3);
  base.rgb = mix(base.rgb, vec3(0.32, 0.5, 0.58), grout * 0.85);
`

// the water's waves: a small sea of them - sixteen, from 1.6 m long down to about 33 cm, mostly running
// with the breeze (down the pool, uWind) and fanned a little round it - off the diagonals, where they
// beat against the long wall's shadow edge and flicker - each at its deep-water speed (longer is
// faster). The short ones are the steeper: their curvature focuses the light at the floor, while the
// long ones' slope only sways the view through the water. Trochoidal (Gerstner): sharp crests and
// broad troughs gather the light into fine bright lines on the tiles rather than soft blobs. Only the
// normal is bent: the surface stays flat
const WAVES = `
  vec2 p = vWorldPosition.xz;
  vec3 n = vec3(0.0, 1.0, 0.0);
  float wind = uWind;
  for (int i = 0; i < 16; i++) {
    float k = float(i);
    float len = 1.6 * pow(0.9, k);
    float f = 6.2832 / len;
    float a = wind + 0.55 * sin(k * 2.39996 + 0.5);
    vec2 d = vec2(cos(a), sin(a));
    float phase = dot(d, p) * f - uTime * sqrt(9.8 * f) * 0.55 + k * 1.93;
    // steepness: slope at most this; sharpness: how far the crests pinch
    float s = 0.065 * uWave * mix(0.4, 1.6, k / 15.0), q = 0.4;
    n.xz -= d * s * cos(phase);
    n.y -= q * s * sin(phase);
  }
  normal = normalize(n);
`

export default function run({ canvas, gui }) {
  const view = new View({
    canvas, background: '#a9d3ef', fxaa: true,
    camera: { position: [5.34, 5.8, 5.79], target: [-0.26, -0.91, 0.27], fov: 45 },
    orbit: { maxPitch: 1.45, minDistance: 3, maxDistance: 18 },
  })
  const scene = view.scene
  scene.environment = 'studio'
  scene.environmentIntensity = 0.3
  scene.add(new HemisphereLight({ sky: '#cfe8ff', ground: '#cdbb9c', intensity: 0.2 }))
  const sun = scene.add(new DirectionalLight({ color: '#fff4e0', intensity: 2.1, castShadow: true, shadowSoftness: 0.04, caustics: true }))

  // the pool: a tiled floor and walls, inside a stone deck
  const tiles = { color: '#e6f5fa', roughness: 0.55, shader: { uniforms: { uTile: 0.25 }, fragment: TILES } }
  scene.add(new Mesh({ geometry: plane({ width: W, depth: L }), material: tiles, position: [0, -DEPTH, 0], receiveShadow: true }))
  const wall = 0.3
  for (const [x, z, w, d] of [[-(W + wall) / 2, 0, wall, L + 2 * wall], [(W + wall) / 2, 0, wall, L + 2 * wall], [0, -(L + wall) / 2, W, wall], [0, (L + wall) / 2, W, wall]]) {
    scene.add(new Mesh({ geometry: box({ width: w, height: DEPTH, depth: d }), material: tiles, position: [x, -DEPTH / 2, z], castShadow: true, receiveShadow: true }))
  }
  const stone = { color: '#d9cdb8', roughness: 0.85 }
  const deck = 3, outer = W + 2 * wall
  for (const [x, z, w, d] of [[-(outer + deck) / 2, 0, deck, L + 2 * wall + 2 * deck], [(outer + deck) / 2, 0, deck, L + 2 * wall + 2 * deck],
    [0, -(L + 2 * wall + deck) / 2, outer, deck], [0, (L + 2 * wall + deck) / 2, outer, deck]]) {
    scene.add(new Mesh({ geometry: box({ width: w, height: 0.2, depth: d }), material: stone, position: [x, -0.1, z], receiveShadow: true }))
  }

  // the water: glass as deep as the pool, faintly blue through its depth, its waves in a hook
  const water = scene.add(new Mesh({
    geometry: plane({ width: W, depth: L }), position: [0, WATER, 0], castShadow: true,
    material: {
      color: '#ffffff', transmission: 1, thickness: DEPTH + WATER, ior: 1.33, roughness: 0.03,
      attenuationColor: '#46b8d2', attenuationDistance: 3,
      shader: { uniforms: { uWave: 0.35, uWind: Math.PI / 2 }, fragment: WAVES },
    },
  }))
  const waves = /** @type {NonNullable<typeof water.material.shader>} */ (water.material.shader)

  const settings = { sun: 0.32, waves: 0.35, wind: 90 }
  const placeSun = () => {
    // from low in the south-west round to high overhead
    const up = 0.35 + settings.sun * 1.1, round = 0.6
    sun.direction.set(-Math.cos(up) * Math.cos(round), -Math.sin(up), -Math.cos(up) * Math.sin(round))
  }
  placeSun()
  gui.add(settings, 'sun', 0, 1, 0.01).name('sun height').onChange(placeSun)
  gui.add(settings, 'waves', 0, 1, 0.01).onChange((v) => { waves.uniforms.uWave = v })
  gui.add(settings, 'wind', 0, 180, 1).name('wind direction').onChange((v) => { waves.uniforms.uWind = (v * Math.PI) / 180 })
  gui.add(sun, 'caustics')

  return view.start()
}
