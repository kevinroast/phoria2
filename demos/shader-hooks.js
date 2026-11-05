import { Box3, DirectionalLight, Geometry, HemisphereLight, Lines, Mesh, Points, Texture, View, cylinder, icosphere, plane, torus } from 'phoria2'
import { random } from './kit.js'

// Shader hooks: a few lines of GLSL of your own, run inside phoria2's shader, for what the material
// options can't do. Five set pieces, each a hook or two - a flag waving over rippling water (both
// moving vertices and bending normals, so the light follows), a ring dissolving through a noise
// texture with a glowing edge (its shadow dissolves too), a cloud of twinkling points turning, and
// a network whose lines sway and carry pulses. Every one reads uTime, the View's clock, so there is
// no frame loop here at all - and lighting, shadows, picking and outlines all keep working. Click a
// piece to see its hooks.

const FLAG = {
  uniforms: { uAmp: 0.22 },
  // a wave down the flag, growing from the pole; its normal bent to match, so the light follows the folds
  vertex: `float along = (local.x + 1.5) / 3.0;
float phase = local.x * 3.2 - uTime * 4.0;
local.y += sin(phase) * uAmp * along;
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
  uniforms: { uNoise: null, uSpeed: 0.6 },
  // cut away where the noise is below a level that rises and falls, the edge glowing hot
  fragment: `float level = 0.5 - 0.56 * cos(uTime * uSpeed);
float v = texture(uNoise, vUv * vec2(3.0, 1.0)).r;
if (v < level) discard;
emissive += vec3(1.0, 0.18, 0.02) * smoothstep(level + 0.05, level, v) * 6.0;`,
}
const STARS = {
  uniforms: { uSpin: 0.15, uTwinkle: 1 },
  // the cloud turning, each point twinkling at its own rate
  vertex: `float a = uTime * uSpin;
local.xz = mat2(cos(a), sin(a), -sin(a), cos(a)) * local.xz;
float rate = 1.5 + mod(float(index) * 0.618, 1.0) * 3.0;
size *= 1.0 + uTwinkle * 0.6 * sin(uTime * rate + float(index));`,
  // soft round points, each warm or cool by its index
  fragment: `base.rgb *= mix(vec3(1.0, 0.35, 0.05), vec3(0.15, 0.45, 1.0), step(0.6, fract(float(index) * 0.37)));
base.a *= smoothstep(1.0, 0.0, length(pointUv * 2.0 - 1.0));`,
}
const NETWORK = {
  uniforms: { uPulse: 0.8 },
  // the far ends sway a little
  vertex: 'local.y += sin(uTime * 1.3 + float(index)) * 0.12 * along;',
  // pulses running out along each link
  fragment: `float p = fract(distance * 0.6 - uTime * uPulse);
base.rgb += vec3(0.3, 0.9, 1.0) * smoothstep(0.85, 1.0, p) * 4.0;`,
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
    material: { color: '#d4a2ff', metalness: 1, roughness: 0.22, shader: { ...DISSOLVE, uniforms: { ...DISSOLVE.uniforms, uNoise: noise(128) } } },
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

  // ---- the hooks of the piece picked, shown bottom left
  const pieces = { flag, water, dissolve: ring, points: stars, lines: network }
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
    const uniforms = Object.entries(s.uniforms).map(([k, v]) => `${k}: ${v instanceof Texture ? 'noiseTexture' : JSON.stringify(v)}`).join(', ')
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
  show('points')

  // the five pieces, not the floor round them
  view.frame(new Box3([-8.3, 0, -8.2], [8, 4.8, 3.3]), { padding: 0.12 })
  // everything moves on uTime: nothing to do each frame
  return view.start()
}

/** Smooth value noise in a texture: a few octaves of random values, eased between. @param {number} size */
function noise(size) {
  const r = random(17), data = new Uint8Array(size * size * 4)
  const octaves = [4, 8, 16, 32].map((cells) => ({ cells, grid: Array.from({ length: cells * cells }, () => r()) }))
  const ease = (t) => t * t * (3 - 2 * t)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0, total = 0, w = 1
      for (const { cells, grid } of octaves) {
        const gx = x / size * cells, gy = y / size * cells
        const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = ease(gx - x0), fy = ease(gy - y0)
        // wrapping round, so the texture repeats without a seam
        const at = (i, j) => grid[((j % cells) * cells) + (i % cells)]
        const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx
        const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx
        v += (top + (bottom - top) * fy) * w
        total += w
        w *= 0.5
      }
      const o = (y * size + x) * 4
      data[o] = data[o + 1] = data[o + 2] = Math.round(v / total * 255)
      data[o + 3] = 255
    }
  }
  return new Texture({ image: { data, width: size, height: size }, colorSpace: 'linear' })
}
