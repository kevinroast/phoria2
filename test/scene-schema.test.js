// schema/scene.schema.json describes what create() takes and toJSON() writes. It's written by hand, so
// these pin it to the code: each type's properties are its constructor's options (less the handlers),
// and real toJSON() output validates against it.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  AmbientLight, DirectionalLight, Geometry, Group, HemisphereLight, InstancedMesh, Label, Lines, Material, Mesh, Node,
  OrthographicCamera, PerspectiveCamera, PointLight, Points, Scene, SpotLight, Texture, box, create,
} from '../src/index.js'
import { GEOMETRY_TYPES } from '../src/describe.js'
import { GENERATOR_OPTIONS } from '../src/geometry/generators.js'
import { CLIP_OPTIONS } from '../src/clip.js'
import { FOG_OPTIONS } from '../src/fog.js'
import '../src/charts/index.js'

const schema = JSON.parse(readFileSync(new URL('../schema/scene.schema.json', import.meta.url), 'utf8'))
const defs = schema.$defs
// behaviour, not data: functions can't be written as JSON
const HANDLERS = ['onUpdate', 'onHover', 'onClick', 'onDrag', 'showFrom', 'tooltip', 'labels']

const deref = (s) => (s.$ref ? defs[s.$ref.split('/').pop()] : s)
// the property names a subschema allows, following its $refs
const names = (s) => [...new Set([...(s.$ref ? names(deref(s)) : []), ...Object.keys(s.properties ?? {})])].sort()
const variant = (type) => defs.node.anyOf.find((v) => v.properties.type.const === type)

// The parts of JSON Schema 2020-12 the scene schema uses - enough to check documents against it.
function errors(s, value, at = '') {
  const out = []
  if (s.$ref) out.push(...errors(deref(s), value, at))
  if (s.anyOf && !s.anyOf.some((sub) => errors(sub, value, at).length === 0)) out.push(`${at}: matches none of anyOf`)
  if ('const' in s && value !== s.const) out.push(`${at}: not ${s.const}`)
  if (s.enum && !s.enum.includes(value)) out.push(`${at}: ${value} not in ${s.enum}`)
  const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value
  if (s.type && !(s.type === kind || (s.type === 'number' && kind === 'integer'))) return [...out, `${at}: ${kind}, not ${s.type}`]
  if (typeof value === 'number') {
    if (s.minimum !== undefined && value < s.minimum) out.push(`${at}: below ${s.minimum}`)
    if (s.maximum !== undefined && value > s.maximum) out.push(`${at}: above ${s.maximum}`)
  }
  if (Array.isArray(value)) {
    if (s.minItems !== undefined && value.length < s.minItems) out.push(`${at}: fewer than ${s.minItems} items`)
    if (s.maxItems !== undefined && value.length > s.maxItems) out.push(`${at}: more than ${s.maxItems} items`)
    if (s.items) value.forEach((v, i) => out.push(...errors(s.items, v, `${at}[${i}]`)))
  }
  if (kind === 'object') {
    for (const key of s.required ?? []) if (!(key in value)) out.push(`${at}: no ${key}`)
    for (const [key, sub] of Object.entries(s.properties ?? {})) if (key in value) out.push(...errors(sub, value[key], `${at}.${key}`))
    const known = s.unevaluatedProperties === false ? names(s) : s.additionalProperties === false ? Object.keys(s.properties ?? {}) : null
    if (known) for (const key of Object.keys(value)) if (!known.includes(key)) out.push(`${at}: unknown ${key}`)
  }
  return out
}
const validate = (value) => errors(schema, value)

describe('the scene description schema', () => {
  it('has ids that resolve to the files, for the 1.x line - changing one later breaks $refs to it', () => {
    for (const name of ['scene', 'chart']) {
      const { $id } = JSON.parse(readFileSync(new URL(`../schema/${name}.schema.json`, import.meta.url), 'utf8'))
      expect($id).toBe(`https://cdn.jsdelivr.net/npm/phoria2@1/schema/${name}.schema.json`)
    }
  })

  it('allows exactly each node type\'s options, less its handlers', () => {
    const classes = [Node, Group, Scene, Mesh, Points, Lines, InstancedMesh, Label, PerspectiveCamera, OrthographicCamera,
      AmbientLight, HemisphereLight, DirectionalLight, PointLight, SpotLight]
    const types = defs.node.anyOf.map((v) => v.properties.type.const)
    expect(types).toEqual([...classes.map((C) => C.type), 'chart'])
    for (const C of classes) {
      expect([C.type, names(variant(C.type))]).toEqual([C.type, [...C.OPTIONS.filter((o) => !HANDLERS.includes(o)), 'type'].sort()])
    }
  })

  it('allows exactly the options of materials, textures, clipping, fog and each generator', () => {
    expect(names(defs.material)).toEqual([...Material.OPTIONS].sort())
    expect(names(defs.textureOptions)).toEqual(Texture.OPTIONS.filter((o) => o !== 'image').sort())
    expect(names(defs.clip)).toEqual([...CLIP_OPTIONS].sort())
    expect(names(defs.fog)).toEqual([...FOG_OPTIONS].sort())
    const generators = defs.geometry.anyOf.filter((g) => g.properties.type)
    expect(generators.map((g) => g.properties.type.const)).toEqual(GEOMETRY_TYPES)
    for (const g of generators) {
      const type = g.properties.type.const
      expect([type, names(g)]).toEqual([type, [...GENERATOR_OPTIONS[type], 'type'].sort()])
    }
  })

  it('accepts what toJSON() writes', () => {
    const scene = new Scene({ background: '#123', environment: 'studio', environmentIntensity: 0.5, fog: { color: 'white', density: 0.02 } })
    const raw = new Geometry({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], uvs: [0, 0, 1, 0, 0, 1], indices: [0, 1, 2] })
    const crate = new Mesh({
      name: 'crate', geometry: box({ size: 2 }), position: [0, 1, 0], rotation: [0, 0.5, 0], scale: 2, castShadow: true, data: { id: 7 },
      material: new Material({ color: 'orange', roughness: 0.4, map: { url: 'crate.png', repeat: [2, 2] }, normalMap: 'n.png', blending: 'multiply' }),
    })
    scene.add(
      new Group({
        clip: { normal: [1, 0, 0], offset: 0.5, cap: 'red' }, outline: { color: 'cyan', width: 3 }, highlight: 'yellow', highlightWhole: true, userData: { a: 1 }, pickable: false,
        children: [crate, new Mesh({ geometry: raw, material: new Material({ unlit: true, doubleSided: true }) })],
      }),
      new InstancedMesh({ geometry: box(), count: 2, instances: [{ position: [1, 0, 0], color: 'red' }, { position: [2, 0, 0], scale: [1, 2, 1] }] }),
      new Points({ geometry: raw, material: new Material({ size: 4, sizeAttenuation: false }) }),
      new Lines({ geometry: new Geometry({ positions: [0, 0, 0, 1, 0, 0] }), material: new Material({ width: 2 }), visible: false }),
      new Label({ text: 'Crate', position: [0, 2.4, 0], place: 'above', offset: [0, -4], overlap: 'dim', leader: true, edge: 'left' }),
      new PerspectiveCamera({ fov: 40, near: 0.5, target: [0, 0, 0] }),
      new OrthographicCamera({ height: 20, far: 50 }),
      new AmbientLight({ intensity: 0.2 }),
      new HemisphereLight({ sky: 'skyblue', ground: 'brown' }),
      new DirectionalLight({ direction: [-1, -2, -1], castShadow: true }),
      new PointLight({ range: 10, color: 'red' }),
      new SpotLight({ target: [0, 0, 0], angle: 0.4, penumbra: 0.3, range: 20 }),
    )
    const json = JSON.parse(JSON.stringify(scene.toJSON()))
    // every part made it into the description
    expect(json.children.length).toBe(12)
    expect(json.children[0].children[0].material.map).toEqual({ url: 'crate.png', repeat: [2, 2] })
    expect(json.children[0].children[1].geometry.indices).toEqual([0, 1, 2])
    expect(validate(json)).toEqual([])
    // and what it accepts, create() builds
    expect(validate(create(json).toJSON())).toEqual([])
  })

  it('turns away descriptions create() would reject', () => {
    expect(validate({ type: 'mesh', geometry: { type: 'box', size: 2 } })).toEqual([])
    expect(validate({ type: 'meshy' })).not.toEqual([])
    expect(validate({ type: 'mesh', colour: 'red' })).not.toEqual([])
    expect(validate({ type: 'mesh', geometry: { type: 'box', radius: 2 } })).not.toEqual([])
    expect(validate({ type: 'mesh', material: { roughness: 2 } })).not.toEqual([])
    expect(validate({ type: 'group', children: [{ type: 'label', text: 'a', place: 'top' }] })).not.toEqual([])
    expect(validate({ type: 'scene', fog: { colour: 'white' } })).not.toEqual([])
  })
})
