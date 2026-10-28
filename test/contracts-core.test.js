// Option contracts for the core: every option each class and function takes - see contract.js.
import { expect, it } from 'vitest'
import {
  AmbientLight, DirectionalLight, Geometry, Group, HemisphereLight, InstancedMesh, Label, Lines, Material, Mesh,
  OrthographicCamera, PerspectiveCamera, PointLight, Points, Scene, SpotLight, Texture, box, create, curve, cylinder,
  ellipse, extrude, grid, icosphere, lathe, outline, plane, sphere, torus, axes,
} from '../src/index.js'
import { NODE_HINTS, NODE_OPTIONS } from '../src/scene/Node.js'
import { GENERATOR_OPTIONS } from '../src/geometry/generators.js'
import { OUTLINE_OPTIONS } from '../src/geometry/outline.js'
import { CURVE_HINTS, CURVE_OPTIONS, ELLIPSE_OPTIONS, LINE_HINTS, LINE_OPTIONS, TUBE_HINTS, TUBE_OPTIONS } from '../src/geometry/Curve.js'
import { contract, rounded } from './contract.js'
import { nodeRows } from './node-rows.js'

const hex = (c) => c.getHex()
const pixels = () => ({ data: new Uint8Array([255, 0, 0, 255]), width: 1, height: 1 })
const viaJSON = (n) => create(n.toJSON())
const viaClone = (n) => n.clone()

/** A node class's contract: the node rows and its own. */
const nodeContract = (Class, make, rows = {}, deadHints = {}) => contract(Class.name, {
  options: Class.OPTIONS ?? NODE_OPTIONS, hints: { ...NODE_HINTS, ...Class.HINTS }, make, rows: { ...nodeRows(), ...rows }, json: viaJSON, clone: viaClone, deadHints,
})

nodeContract(Group, (o) => new Group(o))

nodeContract(Scene, (o) => new Scene(o), {
  background: { value: '#102030', read: (s) => (s.background ? hex(s.background) : null), expect: 0x102030, default: null, bad: 'notacolour', error: 'notacolour' },
  environment: { value: 'studio', read: (s) => s.environment, bad: 42, error: 'environment' },
  environmentIntensity: { value: 0.5, read: (s) => s.environmentIntensity, default: 1, bad: 'bright', error: 'environmentIntensity' },
  backgroundBlur: { value: 0.3, read: (s) => s.backgroundBlur, default: 0, bad: 'soft', error: 'backgroundBlur' },
  fog: { value: { color: '#203040', density: 0.08 }, read: (s) => s.fog?.toJSON() ?? null, default: null, bad: 'thick', error: "'fog' must be" },
})

// --- drawables
const drawableRows = (geometry = () => box(1)) => ({
  geometry: { fresh: geometry, check: (n, g) => { if (n.geometry !== g) throw new Error('not the geometry given') }, keep: false, bad: 'cube', error: 'geometry' },
  material: { value: { color: '#ff0000' }, read: (n) => hex(n.material.color), expect: 0xff0000, bad: 'red', error: 'material' },
  castShadow: { value: true, read: (n) => n.castShadow, default: false },
  receiveShadow: { value: true, read: (n) => n.receiveShadow, default: false },
  renderOrder: { value: 2, read: (n) => n.renderOrder, default: 0, bad: 'first', error: 'renderOrder' },
  frustumCulled: { value: false, read: (n) => n.frustumCulled, default: true },
  data: { value: { id: 3 }, read: (n) => n.data, default: null },
})
const labelsRow = { value: { text: (d) => d, place: 'above' }, read: (n) => n.labels?.place, expect: 'above', bad: { text: 'not a function' }, error: 'labels', keep: /** @type {false} */ (false) }

nodeContract(Mesh, (o) => new Mesh({ geometry: box(1), ...o }), drawableRows())

nodeContract(InstancedMesh, (o) => new InstancedMesh({ geometry: box(1), ...(o.count ?? o.instances ?? o.data ? {} : { count: 1 }), ...o }), {
  ...drawableRows(),
  data: { value: [{ id: 1 }, { id: 2 }], read: (n) => [n.data, n.count], expect: [[{ id: 1 }, { id: 2 }], 2] },
  count: { value: 3, read: (n) => n.count, bad: 1.5, error: 'count' },
  instances: { value: [{ position: [1, 2, 3] }, { scale: 2 }], read: (n) => [n.count, n.instanceMatrices[12], n.instanceMatrices[16 + 5]], expect: [2, 1, 2], bad: [{ spin: 1 }], error: 'spin' },
  instanceMatrices: { value: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1], read: (n) => n.instanceMatrices[12], expect: 5, bad: [1, 2, 3], error: 'instanceMatrices' },
  instanceColors: { value: [1, 0, 0], read: (n) => Array.from(n.instanceColors), expect: [1, 0, 0], bad: [1, 0], error: 'instanceColors' },
  labels: labelsRow,
})

nodeContract(Points, (o) => new Points({ geometry: new Geometry({ positions: [0, 0, 0, 1, 1, 1] }), ...o }), {
  ...drawableRows(() => new Geometry({ positions: [0, 0, 0] })),
  labels: labelsRow,
})

nodeContract(Lines, (o) => new Lines({ geometry: new Geometry({ positions: [0, 0, 0, 1, 0, 0] }), ...o }), drawableRows(() => new Geometry({ positions: [0, 0, 0, 0, 1, 0] })))

nodeContract(Label, (o) => new Label({ text: 'label', ...o }), {
  text: { value: 'Crater', read: (l) => l.text, bad: {}, error: 'text' },
  place: { value: 'above', read: (l) => l.place, default: 'center', bad: 'top', error: 'place' },
  offset: { value: [4, -2], read: (l) => l.offset, default: [0, 0], bad: [1], error: 'offset' },
  className: { value: 'tag', read: (l) => l.className, default: '' },
  priority: { value: 3, read: (l) => l.priority, default: 0, bad: 'high', error: 'priority' },
  overlap: { value: 'dim', read: (l) => l.overlap, default: 'hide', bad: 'fade', error: 'overlap' },
  occlude: { value: true, read: (l) => l.occlude, default: false },
  leader: { value: true, read: (l) => l.leader, default: false },
  edge: { value: 'left', read: (l) => l.edge, default: null, bad: 'top', error: 'edge' },
})

it('points labels per instance away from position, where a Label takes it', () => {
  expect(() => new InstancedMesh({ geometry: box(1), count: 1, labels: { text: () => 'x', position: [0, 1, 0] } })).toThrow('offset moves them in pixels')
  expect(new Label({ text: 'x', position: [0, 1, 0] }).position.toArray()).toEqual([0, 1, 0])
})

// --- cameras
const cameraRows = () => ({
  near: { value: 0.5, read: (c) => c.near, default: 0.1, bad: 'close', error: 'near' },
  far: { value: 500, read: (c) => c.far, default: 1000, bad: 0.01, error: 'near < far' },
  target: { value: [1, 2, 3], read: (c) => c.target?.toArray() ?? null, default: null, bad: 'up', error: "'up'" },
  aspect: { value: 2, read: (c) => c.aspect, default: 1, bad: 'wide', error: 'aspect', keep: /** @type {false} */ (false) },
})
nodeContract(PerspectiveCamera, (o) => new PerspectiveCamera(o), {
  ...cameraRows(),
  fov: { value: 30, read: (c) => c.fov, default: 50, bad: 200, error: 'fov' },
})
nodeContract(OrthographicCamera, (o) => new OrthographicCamera(o), {
  ...cameraRows(),
  height: { value: 4, read: (c) => c.height, default: 10, bad: 'tall', error: 'height' },
})

// --- lights
const lightRows = () => ({
  color: { value: '#ff8000', read: (l) => hex(l.color), expect: 0xff8000, default: 0xffffff, bad: 'notacolour', error: 'notacolour' },
  intensity: { value: 2, read: (l) => l.intensity, default: 1, bad: -1, error: 'intensity' },
})
const aimRows = () => ({
  direction: { value: [0, -2, 0], read: (l) => rounded(l.direction), expect: [0, -1, 0], bad: [0, 0, 0], error: "can't be [0, 0, 0]" },
  target: { value: [1, 2, 3], read: (l) => l.target?.toArray() ?? null, default: null, bad: 'up', error: "'up'" },
})
nodeContract(AmbientLight, (o) => new AmbientLight(o), lightRows())
nodeContract(HemisphereLight, (o) => new HemisphereLight(o), {
  ...lightRows(),
  sky: { value: '#80c0ff', read: (l) => hex(l.sky), expect: 0x80c0ff, bad: 'notacolour', error: 'notacolour' },
  ground: { value: '#402010', read: (l) => hex(l.ground), expect: 0x402010, default: 0x444444, bad: 'notacolour', error: 'notacolour' },
})
nodeContract(DirectionalLight, (o) => new DirectionalLight(o), {
  ...lightRows(), ...aimRows(),
  castShadow: { value: true, read: (l) => l.castShadow, default: false },
})
nodeContract(PointLight, (o) => new PointLight(o), {
  ...lightRows(),
  range: { value: 5, read: (l) => l.range, default: 0, bad: -1, error: 'range' },
  castShadow: { value: true, read: (l) => l.castShadow, default: false },
})
nodeContract(SpotLight, (o) => new SpotLight(o), {
  ...lightRows(), ...aimRows(),
  range: { value: 5, read: (l) => l.range, default: 0, bad: -1, error: 'range' },
  angle: { value: 0.4, read: (l) => l.angle, default: Math.PI / 6, bad: 2, error: 'angle' },
  penumbra: { value: 0.5, read: (l) => l.penumbra, default: 0.1, bad: 2, error: 'penumbra' },
  castShadow: { value: true, read: (l) => l.castShadow, default: false },
})

// --- materials and textures
const materialMap = (name) => ({ fresh: () => new Texture({ image: pixels() }), read: (m) => m[name] instanceof Texture, expect: true, bad: 42, error: name })
contract('Material', {
  options: Material.OPTIONS, hints: Material.HINTS, make: (o) => new Material(o),
  json: (m) => new Material(m.toJSON(true)), clone: (m) => m.clone(),
  rows: {
    name: { value: 'shiny', read: (m) => m.name, default: '' },
    color: { value: '#ff0000', read: (m) => hex(m.color), expect: 0xff0000, default: 0xffffff, bad: 'notacolour', error: 'notacolour' },
    emissive: { value: '#00ff00', read: (m) => hex(m.emissive), expect: 0x00ff00, default: 0x000000, bad: 'notacolour', error: 'notacolour' },
    map: materialMap('map'),
    roughnessMap: materialMap('roughnessMap'),
    metalnessMap: materialMap('metalnessMap'),
    normalMap: materialMap('normalMap'),
    bumpMap: materialMap('bumpMap'),
    aoMap: materialMap('aoMap'),
    emissiveMap: materialMap('emissiveMap'),
    unlit: { value: true, read: (m) => m.unlit, default: false, bad: 'yes', error: 'unlit' },
    flatShading: { value: true, read: (m) => m.flatShading, default: false, bad: 'yes', error: 'flatShading' },
    doubleSided: { value: true, read: (m) => m.doubleSided, default: false, bad: 'yes', error: 'doubleSided' },
    fog: { value: false, read: (m) => m.fog, default: true, bad: 'thick', error: 'fog' },
    vertexColors: { value: true, read: (m) => m.vertexColors, default: false, bad: 'yes', error: 'vertexColors' },
    depthWrite: { value: false, read: (m) => m.depthWrite, default: true, bad: 'no', error: 'depthWrite' },
    depthTest: { value: false, read: (m) => m.depthTest, default: true, bad: 'no', error: 'depthTest' },
    sizeAttenuation: { value: false, read: (m) => m.sizeAttenuation, default: true, bad: 'no', error: 'sizeAttenuation' },
    transparent: { value: true, read: (m) => m.transparent, default: false, bad: 'yes', error: 'transparent' },
    opacity: { value: 0.5, read: (m) => m.opacity, default: 1, bad: 2, error: 'opacity' },
    roughness: { value: 0.2, read: (m) => m.roughness, default: 0.5, bad: 2, error: 'roughness' },
    metalness: { value: 0.8, read: (m) => m.metalness, default: 0, bad: -1, error: 'metalness' },
    emissiveIntensity: { value: 3, read: (m) => m.emissiveIntensity, default: 1, bad: -1, error: 'emissiveIntensity' },
    size: { value: 4, read: (m) => m.size, default: 1, bad: -1, error: 'size' },
    width: { value: 3, read: (m) => m.width, default: 1, bad: -1, error: 'width' },
    alphaTest: { value: 0.5, read: (m) => m.alphaTest, default: 0, bad: 2, error: 'alphaTest' },
    normalScale: { value: 0.5, read: (m) => m.normalScale, default: 1, bad: 'strong', error: 'normalScale' },
    bumpScale: { value: 0.002, read: (m) => m.bumpScale, default: 1, bad: 'deep', error: 'bumpScale' },
    aoMapIntensity: { value: 0.5, read: (m) => m.aoMapIntensity, default: 1, bad: 2, error: 'aoMapIntensity' },
    triplanar: { value: 4, read: (m) => m.triplanar, default: 0, bad: -1, error: 'triplanar' },
    blending: { value: 'additive', read: (m) => m.blending, default: 'normal', bad: 'screen', error: 'blending' },
  },
})

contract('Texture', {
  options: Texture.OPTIONS, hints: Texture.HINTS, make: (o) => new Texture({ ...(o.url === undefined ? { image: pixels() } : {}), ...o }),
  rows: {
    image: { fresh: pixels, check: (t, image) => { if (t.image !== image) throw new Error('not the image given') } },
    url: { value: 'textures/missing.png', read: (t) => t.url, only: 'loading needs a browser' },
    colorSpace: { value: 'linear', read: (t) => t.colorSpace, default: 'srgb', bad: 'rgb', error: 'colorSpace' },
    wrap: { value: 'clamp', read: (t) => t.wrap, default: 'repeat', bad: 'tile', error: 'wrap' },
    repeat: { value: [2, 3], read: (t) => t.repeat, default: [1, 1], bad: [2], error: 'repeat' },
    offset: { value: [0.5, 0.25], read: (t) => t.offset, default: [0, 0], bad: 'left', error: 'offset' },
    filter: { value: 'nearest', read: (t) => t.filter, default: 'linear', bad: 'blurry', error: 'filter' },
    mipmaps: { value: false, read: (t) => t.mipmaps, default: true },
    anisotropy: { value: 4, read: (t) => t.anisotropy, default: 8, bad: 0.5, error: 'anisotropy' },
    flipY: { value: true, read: (t) => t.flipY, default: false },
  },
})

contract('Geometry', {
  options: Geometry.OPTIONS, make: (o) => new Geometry({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], ...o }),
  rows: {
    positions: { value: [0, 0, 0, 2, 0, 0, 0, 2, 0], read: (g) => Array.from(g.positions), bad: [0, 0], error: 'positions' },
    normals: { value: [0, 0, 1, 0, 0, 1, 0, 0, 1], read: (g) => Array.from(g.normals), bad: [0, 0, 1], error: 'normals' },
    uvs: { value: [0, 0, 1, 0, 0, 1], read: (g) => Array.from(g.uvs), bad: [0, 0], error: 'uvs' },
    colors: { value: [1, 0, 0, 0, 1, 0, 0, 0, 1], read: (g) => Array.from(g.colors), bad: [1, 0, 0], error: 'colors' },
    indices: { value: [0, 1, 2], read: (g) => Array.from(g.indices), bad: [0, 1, 9], error: 'indices' },
  },
})

// --- the generators: each records what it was made with in geometry.source
const generator = (name, fn, rows) => contract(`${name}()`, { options: GENERATOR_OPTIONS[name], make: (o) => fn(o), rows })
const src = (key) => (g) => g.source[key]
generator('box', box, {
  size: { value: 2, read: (g) => [g.source.width, g.source.height, g.source.depth], expect: [2, 2, 2], bad: -1, error: 'size' },
  width: { value: 3, read: src('width'), default: 1, bad: 0, error: 'width' },
  height: { value: 3, read: src('height'), default: 1, bad: 'tall', error: 'height' },
  depth: { value: 3, read: src('depth'), default: 1, bad: -2, error: 'depth' },
  segments: { value: 2, read: src('segments'), default: 1, bad: 1.5, error: 'segments' },
})
generator('sphere', sphere, {
  radius: { value: 2, read: src('radius'), default: 1, bad: 0, error: 'radius' },
  segments: { value: 12, read: src('segments'), bad: 2, error: 'segments' },
  rings: { value: 6, read: src('rings'), bad: 1, error: 'rings' },
})
generator('plane', plane, {
  size: { value: 2, read: (g) => [g.source.width, g.source.depth], expect: [2, 2], bad: -1, error: 'size' },
  width: { value: 3, read: src('width'), default: 1, bad: 0, error: 'width' },
  depth: { value: 3, read: src('depth'), default: 1, bad: 0, error: 'depth' },
  segments: { value: 4, read: src('segments'), default: 1, bad: 0, error: 'segments' },
})
generator('cylinder', cylinder, {
  radius: { value: 2, read: src('radius'), bad: -1, error: 'radius' },
  radiusTop: { value: 0, read: src('radiusTop'), bad: -1, error: 'radiusTop' },
  height: { value: 3, read: src('height'), bad: 0, error: 'height' },
  segments: { value: 12, read: src('segments'), bad: 2, error: 'segments' },
  caps: { value: false, read: src('caps'), default: true },
  axis: { value: 'x', read: (g) => g.source.axis ?? 'y', default: 'y', bad: 'up', error: 'axis' },
})
generator('torus', torus, {
  radius: { value: 2, read: src('radius'), bad: 0, error: 'radius' },
  tube: { value: 0.5, read: src('tube'), bad: 0, error: 'tube' },
  segments: { value: 12, read: src('segments'), bad: 2, error: 'segments' },
  tubeSegments: { value: 6, read: src('tubeSegments'), bad: 2, error: 'tubeSegments' },
})
generator('icosphere', icosphere, {
  radius: { value: 2, read: (g) => Math.round(Math.hypot(g.positions[0], g.positions[1], g.positions[2]) * 1e4) / 1e4, expect: 2, bad: 0, error: 'radius' },
  detail: { value: 0, read: (g) => g.vertexCount > 0 && g.indices.length / 3, expect: 20, bad: 9, error: 'detail' },
})
const profile = [[0, 0], [1, 0], [1, 1], [0, 1]]
contract('lathe()', {
  options: GENERATOR_OPTIONS.lathe, make: (o) => lathe({ points: profile, ...o }),
  rows: {
    points: { value: [[1, 0], [1, 2]], read: src('points'), bad: [[1, 0]], error: 'points' },
    segments: { value: 12, read: src('segments'), bad: 2, error: 'segments' },
    axis: { value: 'z', read: (g) => g.source.axis ?? 'y', default: 'y', bad: 'sideways', error: 'axis' },
  },
})
const square = [[0, 0], [1, 0], [1, 1], [0, 1]]
contract('extrude()', {
  options: GENERATOR_OPTIONS.extrude, make: (o) => extrude({ shape: square, ...o }),
  rows: {
    shape: { value: [[0, 0], [2, 0], [0, 2]], read: src('shape'), bad: [[0, 0]], error: 'shape' },
    holes: { value: [[[0.2, 0.2], [0.4, 0.2], [0.2, 0.4]]], read: src('holes'), default: [], bad: 'none', error: 'holes' },
    depth: { value: 3, read: src('depth'), default: 1, bad: 0, error: 'depth' },
    axis: { value: 'y', read: (g) => g.source.axis ?? 'z', default: 'z', bad: 'up', error: 'axis' },
  },
})
// --- outlines: lists of [x, y] points
const shapeContract = (name, rows) => contract(`outline.${name}()`, { options: OUTLINE_OPTIONS[name], make: (o) => outline[name](o), rows })
const first = (p) => rounded(p[0])
const far = (p) => Math.round(Math.max(...p.map(([x, y]) => Math.hypot(x, y))) * 1e4) / 1e4
const spanX = (p) => Math.round((Math.max(...p.map(([x]) => x)) - Math.min(...p.map(([x]) => x))) * 1e4) / 1e4
const spanY = (p) => Math.round((Math.max(...p.map(([, y]) => y)) - Math.min(...p.map(([, y]) => y))) * 1e4) / 1e4
shapeContract('circle', {
  radius: { value: 2, read: far, default: 1, bad: -1, error: 'radius' },
  segments: { value: 8, read: (p) => p.length, default: 32, bad: 2, error: 'segments' },
  center: { value: [3, 0], read: first, expect: [4, 0], default: [1, 0], bad: [1], error: 'center' },
})
shapeContract('rect', {
  size: { value: 2, read: (p) => [spanX(p), spanY(p)], expect: [2, 2], bad: 0, error: 'size' },
  width: { value: 3, read: spanX, default: 1, bad: -1, error: 'width' },
  height: { value: 3, read: spanY, default: 1, bad: 'tall', error: 'height' },
  radius: { value: 0.2, read: (p) => p.length, expect: 36, default: 4, bad: 0.9, error: 'radius' },
  // corners only round with a radius, so check what segments does on a rounded one
  segments: { value: 2, check: (_, v) => expect(outline.rect({ radius: 0.2, segments: v })).toHaveLength(4 * (v + 1)), bad: 0, error: 'segments' },
  center: { value: [1, 1], read: first, expect: [0.5, 0.5], default: [-0.5, -0.5], bad: 'here', error: 'center' },
})
shapeContract('polygon', {
  radius: { value: 2, read: far, default: 1, bad: 0, error: 'radius' },
  sides: { value: 3, read: (p) => p.length, default: 6, bad: 2, error: 'sides' },
  angle: { value: Math.PI / 2, read: first, expect: [0, 1], default: [1, 0], bad: 'up', error: 'angle' },
  center: { value: [0, 2], read: first, expect: [1, 2], bad: [Infinity, 0], error: 'center' },
})
shapeContract('arc', {
  radius: { value: 2, read: far, default: 1, bad: 0, error: 'radius' },
  from: { value: Math.PI / 2, read: first, expect: [0, 1], default: [1, 0], bad: 'top', error: 'from' },
  to: { value: Math.PI, read: (p) => rounded(p.at(-1)).map((v) => v || 0), expect: [-1, 0], default: [1, 0], bad: 0, error: 'to' },
  segments: { value: 4, read: (p) => p.length, expect: 5, default: 33, bad: 0, error: 'segments' },
  center: { value: [1, 1], read: first, expect: [2, 1], bad: null, error: 'center' },
})
shapeContract('gear', {
  radius: { value: 2, read: far, default: 1, bad: 0, error: 'radius' },
  teeth: { value: 8, read: (p) => p.length / 4, default: 24, bad: 2, error: 'teeth' },
  depth: { value: 0.2, read: (p) => Math.round(Math.min(...p.map(([x, y]) => Math.hypot(x, y))) * 1e4) / 1e4, expect: 0.8, bad: 1, error: 'depth' },
  center: { value: [5, 0], read: first, expect: [5 + 1 - Math.PI / 24, 0].map((v) => Math.round(v * 1e4) / 1e4), bad: 'x', error: 'center' },
})

generator('axes', axes, {
  size: { value: 3, read: src('size'), default: 1, bad: 0, error: 'size' },
})
generator('grid', grid, {
  size: { value: 4, read: src('size'), default: 10, bad: 0, error: 'size' },
  divisions: { value: 4, read: src('divisions'), default: 10, bad: 0, error: 'divisions' },
})

// --- curves
const line2 = [[0, 0, 0], [4, 0, 0]]
contract('curve()', {
  options: CURVE_OPTIONS, hints: CURVE_HINTS, make: (o) => curve(line2.concat([[4, 0, 4]]), o),
  rows: {
    closed: { value: true, read: (c) => c.closed, default: false },
    tension: { value: 1, read: (c) => Math.round(c.length * 1000) / 1000, expect: 8, bad: 'tight', error: 'tension' },
  },
})
contract('curve.line()', {
  options: LINE_OPTIONS, hints: LINE_HINTS, make: (o) => curve(line2).line(o),
  rows: {
    segments: { value: 4, read: (g) => g.vertexCount, expect: 8, bad: 'many', error: 'segments' },
    dash: { value: [1, 1], read: (g) => g.vertexCount > 0 && g.vertexCount < curve(line2).line().vertexCount, expect: true, bad: [1], error: 'dash' },
  },
})
contract('curve.tube()', {
  options: TUBE_OPTIONS, hints: TUBE_HINTS, make: (o) => curve(line2).tube(o),
  rows: {
    radius: { value: 0.5, read: (g) => Math.round(Math.hypot(g.positions[1], g.positions[2]) * 1e4) / 1e4, expect: 0.5, bad: 'thick', error: 'radius' },
    segments: { value: 4, read: (g) => g.vertexCount / 8, expect: 5, bad: 'many', error: 'segments' },
    sides: { value: 6, read: (g) => g.vertexCount % 6 === 0 && g.vertexCount !== curve(line2).tube().vertexCount, expect: true, bad: 'six', error: 'sides' },
  },
})
contract('ellipse()', {
  // the radii it takes are those of its plane: radiusX and radiusZ in the default 'xz'
  options: [...ELLIPSE_OPTIONS, 'radiusX', 'radiusZ'], make: (o) => ellipse(o),
  rows: {
    plane: { value: 'xz', read: (c) => rounded(c.at(0.25)).map(Math.abs), expect: [0, 0, 1], bad: 'zx', error: 'plane' },
    radius: { value: 2, read: (c) => rounded(c.at(0)), expect: [2, 0, 0], bad: 'big', error: 'radius' },
    radiusX: { value: 3, read: (c) => rounded(c.at(0)), expect: [3, 0, 0], bad: 'wide', error: 'radiusX' },
    radiusZ: { value: 2, read: (c) => rounded(c.at(0.25)).map(Math.abs), expect: [0, 0, 2], bad: 'deep', error: 'radiusZ' },
    center: { value: [5, 0, 0], read: (c) => rounded(c.at(0)), expect: [6, 0, 0], bad: 'here', error: "'here'" },
    tilt: { value: Math.PI / 2, read: (c) => rounded(c.at(0.25)).map(Math.abs), expect: [0, 1, 0], bad: 'up', error: 'tilt' },
  },
})
