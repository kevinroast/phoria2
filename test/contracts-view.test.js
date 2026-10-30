// Option contracts for the View, the renderer, bloom and orbiting - on a stand-in page and WebGL
// context, so what's checked is that each option is taken and lands where it acts, not the pixels.
import { afterAll, describe, expect, it } from 'vitest'
import { OrbitControl, PerspectiveCamera, Scene, View, WebGLRenderer } from '../src/index.js'
import { BLOOM_HINTS, BLOOM_OPTIONS, bloomSettings } from '../src/webgl/WebGLRenderer.js'
import { contract } from './contract.js'
import { fakeCanvas, fakeElement, fakeGL, fakePage } from './fakes.js'

const page = fakePage()
// code that loads on first use (the tooltip) settles before the page goes
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 50))
  page.restore()
})

const hex = (c) => c.getHex()

contract('View', {
  options: View.OPTIONS, hints: View.HINTS, make: (o) => new View({ canvas: page.canvas(), ...o }),
  rows: {
    canvas: { fresh: () => page.canvas(), check: (v, c) => { if (v.canvas !== c) throw new Error('not the canvas given') }, bad: 42, error: 'canvas' },
    scene: { fresh: () => new Scene({ name: 'mine' }), read: (v) => v.scene.name, expect: 'mine', bad: { type: 'scene' }, error: 'create(' },
    camera: { value: { fov: 30 }, read: (v) => v.camera.fov, expect: 30, bad: 'sideways', error: 'sideways' },
    orbit: { value: { autoRotate: true }, read: (v) => v.controls?.autoRotate, expect: true, default: undefined, bad: 'yes', error: 'orbit' },
    background: { value: '#112233', read: (v) => hex(v.scene.background), expect: 0x112233, bad: 'notacolour', error: 'notacolour' },
    renderMode: { value: 'manual', read: (v) => v.renderMode, default: 'auto', bad: 'never', error: 'renderMode' },
    framing: { value: { keep: 'both', aspect: 2 }, only: 'its effect is on the camera as the canvas changes shape', bad: { keep: 'all' }, error: 'framing.keep' },
    highlight: { value: '#ff0000', read: (v) => hex(v.highlight), expect: 0xff0000, bad: 'notacolour', error: 'notacolour' },
    tooltip: { value: () => 'tip', only: 'shown on hover, in a browser', bad: 42, error: 'tooltip' },
    pixelRatio: { value: 2, read: (v) => v.renderer.pixelRatio, bad: 'retina', error: 'pixelRatio' },
    antialias: { value: false, only: 'multisampling is the WebGL context\'s, made by the browser' },
    outlineAntialias: { value: false, read: (v) => v.renderer.outlineAntialias, default: true },
    context:{ value: 'shared', read: (v) => v.renderer.shared, expect: true, bad: 'mine', error: 'context' },
    toneMapping: { value: 'aces', read: (v) => v.renderer.toneMapping, default: 'neutral', bad: 'filmic', error: 'toneMapping' },
    exposure: { value: 2, read: (v) => v.renderer.exposure, default: 1, bad: 'bright', error: 'exposure' },
    bloom: { value: { strength: 2 }, read: (v) => v.bloom?.strength, expect: 2, bad: 'on', error: 'bloom' },
    autoLight: { value: false, read: (v) => v.autoLight, default: true },
    maxDelta: { value: 0.05, read: (v) => v.maxDelta, default: 0.1, bad: 'slow', error: 'maxDelta' },
  },
})

contract('View framing', {
  options: View.FRAMING_OPTIONS, make: (o) => new View({ canvas: page.canvas(), framing: o }),
  rows: {
    keep: { value: 'width', only: 'its effect is on the camera as the canvas changes shape', bad: 'all', error: 'framing.keep' },
    aspect: { value: 2, only: 'its effect is on the camera as the canvas changes shape', bad: -1, error: 'framing.aspect' },
  },
})

const glCanvas = () => fakeCanvas(fakeGL().gl)
contract('WebGLRenderer', {
  options: WebGLRenderer.OPTIONS, hints: WebGLRenderer.HINTS, make: (o) => new WebGLRenderer({ canvas: glCanvas(), ...o }),
  rows: {
    canvas: { fresh: glCanvas, check: (r, c) => { if (r.canvas !== c) throw new Error('not the canvas given') } },
    shared: { value: true, read: (r) => r.shared, default: false },
    antialias: { value: false, only: 'multisampling is the WebGL context\'s, made by the browser' },
    outlineAntialias: { value: false, read: (r) => r.outlineAntialias, default: true },
    toneMapping: { value: 'none', read: (r) => r.toneMapping, default: 'neutral', bad: 'filmic', error: 'toneMapping' },
    exposure: { value: 2, read: (r) => r.exposure, default: 1, bad: 'bright', error: 'exposure' },
    pixelRatio: { value: 2, read: (r) => r.pixelRatio, default: 1, bad: 'retina', error: 'pixelRatio' },
    bloom: { value: true, read: (r) => r.bloom, expect: { strength: 1, radius: 0.6, threshold: 0.6 }, default: null, bad: 'on', error: 'bloom' },
  },
})

contract('bloom', {
  options: BLOOM_OPTIONS, hints: BLOOM_HINTS, make: (o) => bloomSettings('View', o),
  rows: {
    strength: { value: 2, read: (b) => b.strength, default: 1, bad: 'lots', error: 'strength' },
    radius: { value: 0.3, read: (b) => b.radius, default: 0.6, bad: 'wide', error: 'radius' },
    threshold: { value: 0.8, read: (b) => b.threshold, default: 0.6, bad: 'high', error: 'threshold' },
  },
})

contract('OrbitControl', {
  options: OrbitControl.OPTIONS, hints: OrbitControl.HINTS,
  make: (o) => new OrbitControl(new PerspectiveCamera({ position: [0, 0, 5] }), fakeElement('canvas'), o),
  rows: {
    enabled: { value: false, read: (c) => c.enabled, default: true },
    mode: { value: 'map', read: (c) => c.mode, default: 'orbit', bad: 'pan', error: 'mode' },
    rotateSpeed: { value: 0.01, read: (c) => c.rotateSpeed, default: 0.005, bad: 'fast', error: 'rotateSpeed' },
    zoomSpeed: { value: 0.2, read: (c) => c.zoomSpeed, default: 0.1, bad: 'fast', error: 'zoomSpeed' },
    zoom: { value: false, read: (c) => c.zoom, default: true },
    zoomToCursor: { value: false, read: (c) => c.zoomToCursor, default: true },
    pan: { value: false, read: (c) => c.pan, default: true },
    inertia: { value: 0.5, read: (c) => c.inertia, default: 0.85, bad: 2, error: 'inertia' },
    autoRotate: { value: 0.5, read: (c) => c.autoRotate, default: false, bad: 'spin', error: 'autoRotate' },
    minDistance: { value: 2, read: (c) => c.minDistance, default: 0.1, bad: -1, error: 'minDistance' },
    maxDistance: { value: 20, read: (c) => c.maxDistance, default: Infinity, bad: 'far', error: 'maxDistance' },
    minPitch: { value: -0.5, read: (c) => c.minPitch, bad: 'low', error: 'minPitch' },
    maxPitch: { value: 1, read: (c) => c.maxPitch, bad: 'high', error: 'maxPitch' },
  },
})

describe('OrbitControl limits', () => {
  const make = (o) => new OrbitControl(new PerspectiveCamera({ position: [0, 0, 5] }), fakeElement('canvas'), o)
  it('refuses limits that cross, against each other or the defaults', () => {
    expect(() => make({ minDistance: 5, maxDistance: 2 })).toThrow("'minDistance' (5) is more than 'maxDistance' (2)")
    expect(() => make({ minPitch: 1, maxPitch: 0.5 })).toThrow("'minPitch' (1) is more than 'maxPitch' (0.5)")
    expect(() => make({ maxDistance: 0.05 })).toThrow('minDistance')
    expect(make({ autoRotate: true }).autoRotate).toBe(true)
  })
})
