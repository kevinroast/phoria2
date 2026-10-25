// Plain-data descriptions: create() builds any node from { type: 'mesh', ... }, the inverse of
// node.toJSON(). Every constructor's options are its description, plus the type. This is the one
// place descriptions are accepted, so apps that never use them don't carry this module (or every
// geometry generator).
import { describe, didYouMean, fail, checkOneOf } from './validate.js'
import { Geometry } from './geometry/Geometry.js'
import * as generators from './geometry/generators.js'
import { Node, Group } from './scene/Node.js'
import { Scene } from './scene/Scene.js'
import { InstancedMesh, Label, Lines, Mesh, Points } from './scene/drawables.js'
import { OrthographicCamera, PerspectiveCamera } from './scene/cameras.js'
import { AmbientLight, DirectionalLight, HemisphereLight, PointLight, SpotLight } from './scene/lights.js'

/** Generator types usable in geometry descriptions: { type: 'box', size: 2 }. */
export const GEOMETRY_TYPES = ['box', 'sphere', 'plane', 'cylinder', 'torus', 'icosphere', 'axes', 'grid']

// Built on first use, not at module load, so these modules can import each other in any order.
/** @type {Map<string, new (options: any) => Node> | null} */
let types = null
const typeMap = () => types ??= new Map([
  Node, Group, Scene, Mesh, InstancedMesh, Points, Lines, Label, PerspectiveCamera, OrthographicCamera,
  AmbientLight, HemisphereLight, DirectionalLight, PointLight, SpotLight,
].map((Class) => [Class.type, Class]))

// The names people coming from three.js will type
const THREE_TYPES = {
  Mesh: 'mesh', Group: 'group', Object3D: 'node', Points: 'points', LineSegments: 'lines', Line: 'lines',
  InstancedMesh: 'instanced-mesh', PerspectiveCamera: 'perspective-camera', OrthographicCamera: 'orthographic-camera',
  AmbientLight: 'ambient-light', HemisphereLight: 'hemisphere-light', DirectionalLight: 'directional-light',
  PointLight: 'point-light', SpotLight: 'spot-light', Scene: 'scene', light: 'directional-light', camera: 'perspective-camera',
}

// geometry names people reach for, and three.js geometry classes
const GEOMETRY_ALIASES = {
  cube: 'box', ball: 'sphere', globe: 'sphere', quad: 'plane', tube: 'cylinder', ring: 'torus', donut: 'torus',
  BoxGeometry: 'box', SphereGeometry: 'sphere', PlaneGeometry: 'plane', CylinderGeometry: 'cylinder',
  TorusGeometry: 'torus', IcosahedronGeometry: 'icosphere', GridHelper: 'grid', AxesHelper: 'axes',
}

/** @param {string} type @returns {string | null} a hint when a material or geometry is described as a node */
function notANode(type) {
  if (/Material$/.test(type)) return `materials aren't nodes - give a mesh material: { color, roughness, metalness, ... }`
  const geometry = GEOMETRY_ALIASES[type]
  if (geometry) return `geometry isn't a node - give a mesh geometry: { type: '${geometry}', ... }`
  return null
}

/**
 * Build a node (and its children) from a description: its constructor options plus a `type`, as
 * produced by node.toJSON(). Children and geometry may be descriptions too.
 *
 *     scene.add(create({ type: 'mesh', geometry: { type: 'box', size: 2 }, material: { color: 'orange' } }))
 *
 * Textures named by url start loading straight away; `await scene.ready` waits for them.
 * @template {Node} [T=Node]
 * @param {{ type: string } & Record<string, any>} description
 * @returns {T}
 */
export function create(description) {
  if (description instanceof Node) return /** @type {T} */ (description)
  if (!description || typeof description !== 'object' || Array.isArray(description)) {
    fail('create()', `expected a description such as { type: 'mesh', ... }, got ${describe(description)}`)
  }
  const { type, ...options } = description
  if (typeof type !== 'string') {
    fail('create()', `a description needs a 'type': one of ${[...typeMap().keys()].join(', ')}`)
  }
  const Class = typeMap().get(type)
  if (!Class) {
    const three = THREE_TYPES[type], misplaced = notANode(type)
    fail('create()', `unknown type '${type}' - ${three ? `use '${three}'` : misplaced ?? `expected one of ${[...typeMap().keys()].join(', ')}${didYouMean(type, typeMap().keys())}`}`)
  }
  if (Array.isArray(options.children)) options.children = options.children.map((c) => create(c))
  if (options.geometry && !(options.geometry instanceof Geometry) && typeof options.geometry === 'object' && 'type' in options.geometry) {
    options.geometry = createGeometry(options.geometry, `create({ type: '${type}' })`)
  }
  return /** @type {T} */ (new Class(options))
}

/**
 * A Geometry from a generator description such as { type: 'sphere', radius: 2 }.
 * @param {{ type: string } & Record<string, unknown>} description
 * @param {string} [owner]
 * @returns {Geometry}
 */
export function createGeometry(description, owner = 'createGeometry()') {
  const { type, ...options } = description
  const alias = GEOMETRY_ALIASES[type]
  if (alias) fail(owner, `geometry type '${type}' - use '${alias}'`)
  checkOneOf(owner, 'geometry.type', type, GEOMETRY_TYPES)
  const make = /** @type {(o: any) => Geometry} */ (generators[type])
  return make(Object.keys(options).length ? options : undefined)
}
