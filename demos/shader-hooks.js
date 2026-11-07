import { Box3, DirectionalLight, Geometry, HemisphereLight, Lines, Mesh, Points, View, box, cylinder, icosphere, plane, torus } from 'phoria2'
import { random } from './kit.js'

// Shader hooks: a few lines of GLSL of your own, run inside phoria2's shader, for what the material
// options can't do. Six set pieces, each a hook or two - a flag waving over rippling water (both
// moving vertices and bending normals, so the light follows), a ring dissolving through value-noise
// fbm with a glowing edge (its shadow dissolves too), a cloud of twinkling points turning, a network
// whose lines sway and carry pulses, and a little terrain: a flat plane raised by simplex fbm, its
// normals from the noise's own gradient, coloured by height and slope, with its octaves on a slider.
// The randomness is the hooks' own hash(), vnoise(), snoise() and fbm of either - the same on every
// GPU. Most read uTime, the View's clock, so there is no frame loop here at all - and lighting,
// shadows, picking and outlines all keep working. Click a piece to see its hooks.

const FLAG = {
  uniforms: { uAmp: 0.22 },
  // a wave down the flag, growing from the pole, with a noisy flutter on top; its normal bent to match
  // the wave, so the light follows the folds
  vertex: `float along = (local.x + 1.5) / 3.0;
float phase = local.x * 3.2 - uTime * 4.0;
local.y += sin(phase) * uAmp * along;
local.y += (vnoise(vec2(local.x * 2.0 - uTime * 5.0, local.z * 3.0)) - 0.5) * 0.12 * along;
float slope = cos(phase) * 3.2 * uAmp * along;
n = normalize(vec3(-slope, 1.0, 0.0));`,
  // a made-up flag drawn from its uvs: a deep blue field, an orange stripe and a gold disc - colours
  // here are linear, as the shader works, so strong ones are low numbers squared, not sRGB values
  fragment: `vec3 field = vec3(0.01, 0.04, 0.42);
float stripe = step(abs(vUv.y - 0.5), 0.1);
float disc = step(length((vUv - vec2(0.3, 0.5)) * vec2(1.5, 1.0)), 0.24);
base.rgb = mix(mix(field, vec3(1.0, 0.22, 0.0), stripe), vec3(1.0, 0.62, 0.02), disc);`,
}
const WATER = {
  uniforms: { uAmp: 0.08, uPool: [-5, 0] },
  // rings spreading from the pole: height and slope from the same wave
  vertex: `float r = length(local.xz);
float phase = r * 7.0 - uTime * 3.0;
float fade = exp(-r * 0.35);
local.y += sin(phase) * uAmp * fade;
vec2 slope = local.xz / max(r, 1e-3) * cos(phase) * 7.0 * uAmp * fade;
n = normalize(vec3(-slope.x, 1.0, -slope.y));`,
  // a square of water, cut round to fit the pool
  fragment: 'if (length(vWorldPosition.xz - uPool) > 2.95) discard;',
}
const DISSOLVE = {
  uniforms: { uSpeed: 0.6 },
  // cut away where value-noise fbm is below a level that rises and falls, the edge glowing hot
  fragment: `float level = 0.5 - 0.56 * cos(uTime * uSpeed);
float v = vfbm(vUv * vec2(10.0, 3.0));
if (v < level) discard;
emissive += vec3(1.0, 0.18, 0.02) * smoothstep(level + 0.05, level, v) * 6.0;`,
}
const STARS = {
  uniforms: { uSpin: 0.15, uTwinkle: 1 },
  // the cloud turning, each point twinkling at its own rate - a hash of its index
  vertex: `float a = uTime * uSpin;
local.xz = mat2(cos(a), sin(a), -sin(a), cos(a)) * local.xz;
float rate = 1.5 + hash(float(index)) * 3.0;
size *= 1.0 + uTwinkle * 0.6 * sin(uTime * rate + float(index));`,
  // soft round points, each warm or cool by another hash of its index
  fragment: `base.rgb *= mix(vec3(1.0, 0.35, 0.05), vec3(0.15, 0.45, 1.0), step(0.6, hash(float(index) + 0.5)));
base.a *= smoothstep(1.0, 0.0, length(pointUv * 2.0 - 1.0));`,
}
const NETWORK = {
  uniforms: { uPulse: 0.8 },
  // the far ends sway a little
  vertex: 'local.y += sin(uTime * 1.3 + float(index)) * 0.12 * along;',
  // pulses running out along each link, each link's starting when its hash says
  fragment: `float p = fract(distance * 0.6 - uTime * uPulse + hash(float(index)));
base.rgb += vec3(0.3, 0.9, 1.0) * smoothstep(0.85, 1.0, p) * 4.0;`,
}

const TERRAIN = {
  uniforms: { uOctaves: 7, uBase: 0.62 },
  // simplex fbm lifts the plane - flat sea below a level - and its gradient, from the same call,
  // gives the normal: no extra samples for the slope
  vertex: `vec3 h = sfbmd(local.xz * 0.45 + 3.0, int(uOctaves));
float height = (h.x - 0.45) * 2.0;
local.y += max(height, -0.12);
n = height > -0.12 ? normalize(vec3(-h.y * 2.0 * 0.45, 1.0, -h.z * 2.0 * 0.45)) : vec3(0.0, 1.0, 0.0);`,
  // coloured by height and slope - sand, grass, rock, snow - with fine value-noise grain
  fragment: `float y = vWorldPosition.y - uBase;
float slope = 1.0 - normalize(vNormal).y;
float grain = vnoise(vWorldPosition.xz * 40.0);
vec3 c = mix(vec3(0.55, 0.38, 0.14), vec3(0.05, 0.2, 0.02), smoothstep(-0.06, 0.04, y));
c = mix(c, vec3(0.13, 0.1, 0.08), smoothstep(0.12, 0.3, slope));
c = mix(c, vec3(0.85, 0.88, 0.92), smoothstep(0.3, 0.42, y + grain * 0.08));
base.rgb = y < -0.115 ? vec3(0.0, 0.07, 0.3) : c * (0.85 + 0.3 * grain);`,
}

export default function run({ canvas, gui, info }) {
  const view = new View({
    canvas, orbit: { maxPitch: 1.2 }, background: '#0d0f14',
    camera: { position: [0, 9, 17], target: [0, 0.2, 0] },
    bloom: { strength: 0.7, radius: 0.5, threshold: 0.8 },
  })
  const { scene } = view
  // the studio for the metal's reflections, turned down so it doesn't flatten the colours; a warm key
  // light and a little cool fill
  scene.environment = 'studio'
  scene.environmentIntensity = 0.55
  scene.add(new HemisphereLight({ sky: '#6f8bd0', ground: '#1a1612', intensity: 0.25 }))
  scene.add(new DirectionalLight({ color: '#fff0dc', direction: [-0.5, -1, -0.4], intensity: 2.4, castShadow: true }))
  scene.add(new Mesh({ geometry: plane(40), material: { color: '#1e2027', roughness: 0.95 }, receiveShadow: true, pickable: false }))

  // the flag on its pole, over a pool whose water ripples out from it
  const flagAt = [-5, 0, 0]
  scene.add(new Mesh({ geometry: cylinder({ radius: 0.06, height: 4.4 }), material: { color: '#d8d2c6', metalness: 0.9, roughness: 0.25 }, position: [flagAt[0], 2.2, 0], castShadow: true, pickable: false }))
  const flag = scene.add(new Mesh({
    name: 'flag', geometry: plane({ width: 3, depth: 2, segments: 40 }), position: [flagAt[0] + 1.5, 3.3, 0], rotation: [Math.PI / 2, 0, 0],
    material: { doubleSided: true, roughness: 0.6, shader: { ...FLAG, bounds: 0.3 } }, castShadow: true,
  }))
  scene.add(new Mesh({ geometry: cylinder({ radius: 3.2, height: 0.2, segments: 64 }), material: { color: '#3d3a36', roughness: 0.85 }, position: [flagAt[0], 0.1, 0], receiveShadow: true, pickable: false }))
  const water = scene.add(new Mesh({
    name: 'water', geometry: plane({ width: 6, depth: 6, segments: 96 }), position: [flagAt[0], 0.22, 0],
    material: { color: '#0077c8', roughness: 0.05, shader: { ...WATER, bounds: 0.05 } }, receiveShadow: true,
  }))
  // a stone rim round the pool
  scene.add(new Mesh({ geometry: torus({ radius: 3.05, tube: 0.18, segments: 64 }), material: { color: '#8a8378', roughness: 0.7 }, position: [flagAt[0], 0.22, 0], castShadow: true, pickable: false }))

  // the ring that dissolves, on a plinth - its shadow dissolving with it
  const ring = scene.add(new Mesh({
    name: 'dissolve', geometry: torus({ radius: 1.2, tube: 0.42, segments: 96 }), position: [0, 2.2, 0],
    material: { color: '#d4a2ff', metalness: 1, roughness: 0.22, shader: DISSOLVE },
    castShadow: true,
  }))
  scene.add(new Mesh({ geometry: cylinder({ radius: 0.9, height: 0.6 }), material: { color: '#2e3038', roughness: 0.6 }, position: [0, 0.3, 0], castShadow: true, receiveShadow: true, pickable: false }))

  // a cloud of points, turning and twinkling
  const r = random(5), positions = []
  for (let i = 0; i < 2500; i++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * 2.4, h = (r() - 0.5) * 0.9 * (1 - d / 3)
    positions.push(Math.cos(a) * d, h, Math.sin(a) * d)
  }
  const stars = scene.add(new Points({
    name: 'points', geometry: new Geometry({ positions }), position: [5, 2.4, 0],
    material: { color: '#ffffff', size: 0.1, blending: 'additive', depthWrite: false, shader: STARS },
  }))

  // a network behind: a hub, a ring of nodes, links out and round
  const hub = [0, 1.2, -6], nodes = Array.from({ length: 10 }, (_, i) => {
    const a = i / 10 * Math.PI * 2
    return [Math.cos(a) * 4.5, 1.2 + Math.sin(i * 1.7) * 0.6, -6 + Math.sin(a) * 2]
  })
  const links = nodes.flatMap((p, i) => [...hub, ...p, ...p, ...nodes[(i + 1) % nodes.length]])
  const network = scene.add(new Lines({ name: 'lines', geometry: new Geometry({ positions: links }), material: { color: '#0a63c9', width: 2.5, shader: NETWORK } }))
  scene.add(new Mesh({ geometry: icosphere({ radius: 0.3, detail: 2 }), material: { color: '#00d4ff', emissive: '#00d4ff', emissiveIntensity: 1.4 }, position: hub, pickable: false }))
  for (const p of nodes) scene.add(new Mesh({ geometry: icosphere({ radius: 0.16, detail: 1 }), material: { color: '#ff4fa3', emissive: '#ff2f8f', emissiveIntensity: 0.9 }, position: p, pickable: false }))

  // a little terrain at the front: one flat plane, raised by its hook, on a slab whose top is just
  // under the sea - level with it, the two would fight for the same pixels
  const terrain = scene.add(new Mesh({
    name: 'terrain', geometry: plane({ width: 4.4, depth: 3, segments: 128 }), position: [0, TERRAIN.uniforms.uBase, 4.6],
    material: { roughness: 0.85, shader: { ...TERRAIN, bounds: 0.9 } }, castShadow: true, receiveShadow: true,
  }))
  scene.add(new Mesh({ geometry: box({ width: 4.4, height: 0.5, depth: 3 }), position: [0, TERRAIN.uniforms.uBase - 0.16 - 0.25, 4.6],
    material: { color: '#3b3128', roughness: 0.9 }, castShadow: true, receiveShadow: true, pickable: false }))

  // ---- the hooks of the piece picked, shown bottom left
  const pieces = { flag, water, dissolve: ring, points: stars, lines: network, terrain }
  const panel = document.createElement('div')
  panel.className = 'code-panel'
  // bottom right, clear of the title, the controls and the readout
  Object.assign(panel.style, { left: 'auto', right: '16px', bottom: '56px', maxWidth: 'min(460px, calc(100vw - 32px))', maxHeight: '40vh', overflow: 'auto' })
  const title = document.createElement('p'), code = document.createElement('pre')
  panel.append(title, code)
  document.body.append(panel)
  const settings = { show: 'points' }
  const show = (name) => {
    settings.show = name
    const s = /** @type {any} */ (pieces[name].material.shader)
    title.textContent = `${name}: material.shader`
    const uniforms = Object.entries(s.uniforms).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')
    code.textContent = ['vertex', 'fragment', 'lit'].filter((p) => s[p])
      .map((p) => `${p}: \`\n  ${s[p].split('\n').join('\n  ')}\`,`)
      .concat(uniforms ? [`uniforms: { ${uniforms} },`] : [], s.bounds !== null ? [`bounds: ${s.bounds},`] : []).join('\n')
    gui.updateDisplay?.()
  }
  view.on('click', (hit) => {
    const name = Object.keys(pieces).find((k) => pieces[k] === hit?.node)
    if (name) show(name)
  })
  info.textContent = 'Click a piece to see its shader hooks'

  const f = gui.addFolder('Hooks')
  f.add(settings, 'show', Object.keys(pieces)).name('show hooks of').onChange(show)
  f.add(flag.material.shader.uniforms, 'uAmp', 0, 0.5, 0.01).name('flag wave')
  f.add(water.material.shader.uniforms, 'uAmp', 0, 0.12, 0.005).name('ripples')
  f.add(ring.material.shader.uniforms, 'uSpeed', 0, 2, 0.05).name('dissolve speed')
  f.add(stars.material.shader.uniforms, 'uTwinkle', 0, 1.5, 0.05).name('twinkle')
  f.add(network.material.shader.uniforms, 'uPulse', 0, 2, 0.05).name('pulse speed')
  f.add(terrain.material.shader.uniforms, 'uOctaves', 1, 10, 1).name('terrain octaves')
  show('points')

  // the five pieces, not the floor round them
  view.frame(new Box3([-8.3, 0, -8.2], [8, 4.8, 6.2]), { padding: 0.1 })
  // everything moves on uTime: nothing to do each frame
  return view.start()
}
