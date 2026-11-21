// GLSL loaded the first time it's wanted (src/webgl/parts.js): the lit shader's bigger optional
// blocks live in modules of their own and fill its `#pragma part` lines. Every other test starts
// with all of them registered (test/setup.js); these forget them, to see a material wait for its
// part, the part load, and the material drawn - and put them back after.
import { afterEach, describe, expect, it } from 'vitest'
import { Material, Mesh, PerspectiveCamera, Scene, WebGLRenderer, box } from '../src/index.js'
import { loadsInFlight } from '../src/lazy.js'
import { addParts, forgetParts, hasParts, onParts, partText, withParts } from '../src/webgl/parts.js'
import { MATERIAL_PARTS } from '../src/webgl/parts-materials.js'
import { HOOK_PARTS } from '../src/webgl/parts-hooks.js'
import { SHADOW_PARTS } from '../src/webgl/parts-shadows.js'
import { RECT_PARTS } from '../src/webgl/parts-rect.js'
import { hookFor } from '../src/webgl/hooks.js'
import { fakeCanvas, fakeGL } from './fakes.js'

const ALL = { materials: MATERIAL_PARTS, hooks: HOOK_PARTS, shadows: SHADOW_PARTS, rect: RECT_PARTS }
const restore = () => {
  for (const [group, parts] of Object.entries(ALL)) addParts(/** @type {any} */ (group), parts)
}
afterEach(restore)

/** The `#pragma part` lines in the shaders' own source, by name. */
async function markers() {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(new URL('../src/webgl/shaders.js', import.meta.url), 'utf8')
  return [...source.matchAll(/^#pragma part ([\w-]+)$/gm)].map((m) => m[1])
}

/** A renderer drawing one box of a material; each frame's draw calls and compiling count. */
function oneBox(material) {
  const { gl } = fakeGL()
  const renderer = new WebGLRenderer({ canvas: fakeCanvas(gl) })
  renderer.setSize(64, 64)
  let ready = 0
  renderer.onReady = () => ready++
  const scene = new Scene()
  scene.add(new Mesh({ geometry: box(), material }))
  const camera = new PerspectiveCamera({ position: [0, 2, 5], target: [0, 0, 0], aspect: 1 })
  const frame = () => {
    renderer.render(scene, camera)
    return { drawCalls: renderer.info.drawCalls, compiling: renderer.info.compiling }
  }
  return { frame, ready: () => ready }
}

describe('GLSL parts', () => {
  it('every #pragma part line in the shaders names a part, and every part fills exactly one line', async () => {
    const lines = await markers()
    // (the hook functions are spliced in by hooks.js, with each hook's own code - no line of their own)
    const names = Object.entries(ALL).filter(([group]) => group !== 'hooks').flatMap(([, parts]) => Object.keys(parts))
    expect([...lines].sort()).toEqual([...names].sort())
    expect(new Set(lines).size).toBe(lines.length)
    for (const name of [...names, 'hook-helpers']) expect(partText(name).length).toBeGreaterThan(50)
  })

  it('fills its lines in a source, and leaves a line whose group is not here empty', () => {
    expect(withParts('a\n#pragma part clearcoat\nb')).toBe(`a\n${MATERIAL_PARTS.clearcoat}\nb`)
    forgetParts()
    expect(withParts('a\n#pragma part clearcoat\nb')).toBe('a\n\nb')
    // a source with none is the same string
    const plain = 'void main() {}'
    expect(withParts(plain)).toBe(plain)
  })

  it('loads a group the first time it is wanted, once, and tells its listeners when it is in', async () => {
    forgetParts()
    let heard = 0
    const stop = onParts(() => heard++)
    expect(hasParts('materials')).toBe(false)
    // asking again while it loads starts nothing more
    expect(hasParts('materials')).toBe(false)
    await loadsInFlight()
    expect(hasParts('materials')).toBe(true)
    expect(partText('iridescence')).toBe(MATERIAL_PARTS.iridescence)
    expect(heard).toBe(1)
    stop()
  })

  it('shadows and rect lights come with the modules that need them - not loaded on their own', () => {
    forgetParts()
    expect(hasParts('shadows')).toBe(false)
    expect(hasParts('rect')).toBe(false)
    expect(loadsInFlight()).toBeNull()
  })

  it('a material whose part is loading waits, as one still compiling, and is drawn when it arrives', async () => {
    forgetParts()
    const clearcoat = oneBox(new Material({ color: '#c0392b', clearcoat: 1 }))
    expect(clearcoat.frame()).toEqual({ drawCalls: 0, compiling: 1 })
    await loadsInFlight()
    // its renderer heard - its context listens for parts - so the View draws it
    expect(clearcoat.ready()).toBeGreaterThan(0)
    expect(clearcoat.frame()).toEqual({ drawCalls: 1, compiling: 0 })
  })

  it('a plain material never waits, and loads nothing', () => {
    forgetParts()
    const plain = oneBox(new Material({ color: '#888888', roughness: 0.4 }))
    expect(plain.frame()).toEqual({ drawCalls: 1, compiling: 0 })
    expect(loadsInFlight()).toBeNull()
    expect(hasParts('materials') || hasParts('hooks')).toBe(false)
  })

  it('a material with hooks waits for the functions hooks call - not drawn without its hooks', async () => {
    forgetParts()
    const material = new Material({ shader: { vertex: 'transformed.y += snoise(transformed * 2.0) * 0.1;' } })
    // no hook while they load - and that isn't kept: the next ask, once they're in, has one
    expect(hookFor(material)).toBeNull()
    const hooked = oneBox(material)
    expect(hooked.frame()).toEqual({ drawCalls: 0, compiling: 1 })
    await loadsInFlight()
    expect(hookFor(material)?.source.helpers).toBe(HOOK_PARTS['hook-helpers'])
    expect(hooked.frame()).toEqual({ drawCalls: 1, compiling: 0 })
  })
})

describe('labels load the first time a view has one', () => {
  it('draws without them, loads them, and shows them the frame after - a scene with none loads nothing', async () => {
    const { Label, View } = await import('../src/index.js')
    const { labelSlot } = await import('../src/labelSlot.js')
    const { fakePage } = await import('./fakes.js')
    const page = fakePage()
    const kept = labelSlot.module
    labelSlot.module = null
    try {
      const plain = new View({ canvas: page.canvas(), camera: { position: [0, 0, 10], target: [0, 0, 0] } })
      plain.scene.add(new Mesh({ geometry: box() }))
      plain.render()
      expect(loadsInFlight()).toBeNull()

      const view = new View({ canvas: page.canvas(), camera: { position: [0, 0, 10], target: [0, 0, 0] } })
      view.scene.add(new Label({ text: 'North' }))
      view.render()
      expect(labelSlot.module).toBeNull()
      expect(view.overlay).toBeNull()
      await loadsInFlight()
      // here now, the view drawn again - its label shown
      expect(labelSlot.module).not.toBeNull()
      view.render()
      const root = /** @type {any} */ (view.overlay)
      expect(root.children.some((el) => el.textContent === 'North')).toBe(true)
      plain.dispose()
      view.dispose()
    } finally {
      labelSlot.module = kept
      page.restore()
    }
  })
})
