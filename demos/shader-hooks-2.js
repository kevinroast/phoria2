import { Box3, DirectionalLight, HemisphereLight, InstancedMesh, Mesh, View, box, cylinder, icosphere, plane, torus } from 'phoria2'

// More shader hooks, for the everyday functions every hook can call: a hologram glowing at its edges
// (fresnel) with scrolling scanlines and a flicker (hash), a column twisting as it's turned through
// its height (rotate2, its normals turned too) in a hue that climbs it (hsv2rgb), a blob of simplex
// fbm in a cosine palette whose noise turns in 3D (rotate3, palette - lit by flatShading, the
// screen's slope, since its normals don't move), bars rising and falling from one sine, each its
// index's phase (remap, saturate), and a floor whose stripes spin (rotate2 on the uvs, srgb for
// colours as picked). Everything reads uTime: no frame loop. Click a piece to see its hooks.

const HOLOGRAM = {
  uniforms: { uGlow: 2.2 },
  // a faint cyan body, bright at its edges - fresnel is how side-on the surface is to the camera
  fragment: `vec3 cyan = srgb(vec3(0.25, 0.9, 1.0));
base.rgb = cyan * 0.15;
emissive += cyan * fresnel(vNormal, vWorldPosition, 2.5) * uGlow;`,
  // after the light: scanlines climbing it, the edges more solid than the middle, and a flicker -
  // a new hash a twentieth of a second
  lit: `color *= 0.65 + 0.35 * step(0.5, fract(vWorldPosition.y * 22.0 - uTime * 1.5));
color *= 0.85 + 0.15 * step(0.1, hash(floor(uTime * 20.0)));
base.a *= 0.3 + 0.7 * fresnel(vNormal, vWorldPosition, 1.5);`,
}
const TWISTER = {
  uniforms: { uTwist: 1.2 },
  // each height turned a little further round the column's axis, and its normal with it
  vertex: `mat2 turn = rotate2(local.y * uTwist * sin(uTime * 0.6));
local.xz = turn * local.xz;
n.xz = turn * n.xz;`,
  // a hue that climbs it and keeps climbing
  fragment: 'base.rgb = hsv2rgb(fract(vWorldPosition.y * 0.18 - uTime * 0.08), 0.75, 1.0);',
}
const BLOB = {
  uniforms: { uSwell: 0.55 },
  // pushed out along its normal by simplex fbm whose field turns slowly in 3D
  vertex: `vec3 q = rotate3(vec3(1.0, 1.0, 0.3), uTime * 0.35) * local;
local += n * (sfbm(q * 1.6, 4) - 0.5) * uSwell;`,
  // a cosine palette swept up through it
  fragment: 'base.rgb = palette(vWorldPosition.y * 0.45 + uTime * 0.07, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67));',
}
const BARS = {
  uniforms: { uSpeed: 1.6 },
  // each bar's height from one sine, a phase apart by its index: remapped from -1-1 to a share of its
  // full height, saturated so none goes below a sliver
  vertex: `float h = saturate(remap(sin(uTime * uSpeed + float(index) * 0.55), -1.0, 1.0, 0.05, 1.0));
local.y = (local.y + 0.5) * h - 0.5;`,
  // green to amber to red with height, as a meter
  fragment: `float t = saturate(remap(vWorldPosition.y, 0.0, 2.6, 0.0, 1.0));
base.rgb = hsv2rgb(0.33 - t * 0.33, 0.85, 1.0);`,
}
const FLOOR = {
  uniforms: { uSpin: 0.25 },
  // stripes turning round the middle, in two colours as picked - srgb makes them linear
  fragment: `vec2 uv = rotate2(uTime * uSpin) * (vUv - 0.5);
float stripe = step(0.5, fract(uv.x * 14.0));
float ring = smoothstep(0.5, 0.47, length(vUv - 0.5));
base.rgb = mix(srgb(vec3(0.16, 0.17, 0.22)), srgb(vec3(0.23, 0.25, 0.34)), stripe * ring);`,
}

export default function run({ canvas, gui }) {
  const view = new View({
    canvas, orbit: { maxPitch: 1.2 }, background: '#0b0c11',
    camera: { position: [0, 7, 15], target: [0, 1.2, 0] },
    bloom: { strength: 0.8, radius: 0.5, threshold: 0.75 },
  })
  const { scene } = view
  scene.environment = 'studio'
  scene.environmentIntensity = 0.5
  scene.add(new HemisphereLight({ sky: '#6f8bd0', ground: '#1a1612', intensity: 0.3 }))
  scene.add(new DirectionalLight({ color: '#fff0dc', direction: [-0.4, -1, -0.5], intensity: 2.2, castShadow: true }))
  const floor = scene.add(new Mesh({ name: 'floor', geometry: plane(18), material: { roughness: 0.9, shader: FLOOR }, receiveShadow: true }))

  // a hologram: a ring round a sphere, on a little projector
  const hologram = scene.add(new Mesh({
    name: 'hologram', geometry: torus({ radius: 0.9, tube: 0.32, segments: 64 }), position: [-5.2, 1.9, 0], rotation: [0.5, 0, 0.3],
    material: { transparent: true, depthWrite: false, doubleSided: true, shader: HOLOGRAM },
  }))
  scene.add(new Mesh({ geometry: icosphere({ radius: 0.45, detail: 3 }), position: [-5.2, 1.9, 0], material: { transparent: true, depthWrite: false, shader: HOLOGRAM }, pickable: false }))
  scene.add(new Mesh({ geometry: cylinder({ radius: 0.6, radiusTop: 0.45, height: 0.35 }), position: [-5.2, 0.18, 0], material: { color: '#2b2e38', metalness: 0.8, roughness: 0.35 }, castShadow: true, pickable: false }))

  // a column, twisting
  const twister = scene.add(new Mesh({
    name: 'twister', geometry: box({ width: 0.9, height: 3.4, depth: 0.9, segments: 32 }), position: [-1.9, 1.7, 0],
    material: { roughness: 0.35, shader: { ...TWISTER, bounds: 0.3 } }, castShadow: true,
  }))

  // a blob of noise
  const blob = scene.add(new Mesh({
    name: 'blob', geometry: icosphere({ radius: 1.1, detail: 5 }), position: [1.6, 1.6, 0],
    material: { roughness: 0.3, metalness: 0.2, flatShading: true, shader: { ...BLOB, bounds: 0.4 } }, castShadow: true,
  }))

  // a meter of bars
  const bars = scene.add(new InstancedMesh({
    name: 'bars', geometry: box({ width: 0.32, height: 2.6, depth: 0.32 }), count: 9,
    material: { roughness: 0.4, shader: BARS }, castShadow: true,
  }))
  for (let i = 0; i < 9; i++) bars.setInstance(i, { position: [4.2 + i * 0.42, 1.3, 0] })

  // ---- the hooks of the piece picked, shown bottom left - the pieces run off to the right
  const pieces = { hologram, twister, blob, bars, floor }
  const panel = document.createElement('div')
  panel.className = 'code-panel'
  Object.assign(panel.style, { bottom: '16px', maxWidth: 'min(460px, calc(100vw - 32px))', maxHeight: '40vh', overflow: 'auto' })
  const title = document.createElement('p'), code = document.createElement('pre')
  panel.append(title, code)
  document.body.append(panel)
  const settings = { show: 'hologram' }
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

  const f = gui.addFolder('Hooks')
  f.add(settings, 'show', Object.keys(pieces)).name('show hooks of').onChange(show)
  f.add(hologram.material.shader.uniforms, 'uGlow', 0, 5, 0.1).name('hologram glow')
  f.add(twister.material.shader.uniforms, 'uTwist', 0, 3, 0.05).name('twist')
  f.add(blob.material.shader.uniforms, 'uSwell', 0, 1.2, 0.05).name('blob swell')
  f.add(bars.material.shader.uniforms, 'uSpeed', 0, 5, 0.1).name('meter speed')
  f.add(floor.material.shader.uniforms, 'uSpin', -1, 1, 0.05).name('floor spin')
  show('hologram')

  view.frame(new Box3([-6.4, 0, -1.4], [8.1, 3.6, 1.4]), { padding: 0.08 })
  return view.start()
}
