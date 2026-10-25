// The renderer contract: what to draw this frame, as plain data. The scene never talks to WebGL -
// a renderer draws a FrameDescription, so renderers are replaceable and frames testable without a GPU.
import { Mat4 } from './value/Mat4.js'
import { Vec3 } from './value/Vec3.js'
import { warnOnce } from './validate.js'

/** @import { Scene } from './scene/Scene.js' */
/** @import { Camera } from './scene/cameras.js' */
/** @import { Node } from './scene/Node.js' */
/** @import { Color } from './value/Color.js' */
/** @import { Texture } from './material/Texture.js' */
/** @import { Geometry } from './geometry/Geometry.js' */
/** @import { Material } from './material/Material.js' */
/** @import { Drawable, InstancedMesh, Label, LabelPlacement } from './scene/drawables.js' */
/** @import { Light, HemisphereLight, DirectionalLight, PointLight, SpotLight } from './scene/lights.js' */

// Nodes are told apart by markers (isDrawable, isLabel, lightKind) rather than instanceof, so
// collecting a frame doesn't pull every node class into an app's bundle.

/** Per-scene light limits for the WebGL 2 renderer; extras are dropped with a warning. */
export const LIGHT_LIMITS = { punctual: 4, directional: 2 }

/**
 * @typedef {object} FrameLight
 * @property {'ambient' | 'hemisphere' | 'directional' | 'point' | 'spot'} kind
 * @property {Node} node
 * @property {Color} color
 * @property {number} intensity
 * @property {Color} [ground] hemisphere
 * @property {Vec3} [position] point, spot (world)
 * @property {Vec3} [direction] directional, spot (world, the way the light travels)
 * @property {number} [range] point, spot (0 = unlimited)
 * @property {number} [angle] spot
 * @property {number} [penumbra] spot
 * @property {boolean} [castShadow] directional
 */

/**
 * @typedef {object} DrawItem
 * @property {Drawable} node
 * @property {Geometry} geometry
 * @property {Material} material
 * @property {Mat4} worldMatrix
 * @property {InstancedMesh | null} instances
 * @property {number} depth view-space distance of the bounds centre, for sorting
 */

/**
 * @typedef {object} FrameLabel
 * @property {any} key stable identity across frames: the Label node, or a key per instance or point
 * @property {Node} node the Label, or the InstancedMesh or Points it labels
 * @property {number | null} index the instance or point, for labels made from `labels`
 * @property {string} text
 * @property {Required<LabelPlacement>} style
 * @property {Vec3} position world
 * @property {[number, number]} ndc [x, y] in -1..1
 * @property {number} depth
 * @property {boolean} visible in front of the camera and inside the view
 */

/**
 * The hovered thing to tint: a whole node, or one of its instances or points.
 * @typedef {object} FrameHighlight
 * @property {Node} node
 * @property {number | null} index instance (InstancedMesh) or point (Points); null for the whole node
 * @property {Color} color linear
 * @property {number} amount 0-1, how far the colour moves towards it
 */

/**
 * @typedef {object} FrameDescription
 * @property {{ view: Mat4, projection: Mat4, viewProjection: Mat4, position: Vec3, near: number, far: number, camera: Camera }} camera
 * @property {FrameLight[]} lights
 * @property {DrawItem[]} opaque sorted by renderOrder, then material variant, then front to back
 * @property {DrawItem[]} transparent sorted by renderOrder, then back to front
 * @property {FrameLabel[]} labels
 * @property {Color | Texture | null} background
 * @property {Scene['environment']} environment
 * @property {{ drawn: number, culled: number }} stats
 * @property {FrameHighlight | null} highlight set by the View for hover highlighting
 */

/**
 * What to draw: everything visible, culled to the camera's view, sorted for drawing. Expects world
 * matrices to be current (scene.update() or scene.updateWorld()); the camera is brought up to date
 * here, since it often isn't in the scene.
 * @param {Scene} scene
 * @param {Camera} camera
 * @returns {FrameDescription}
 */
export function collect(scene, camera) {
  camera.updateWorld()
  const view = camera.viewMatrix
  const projection = camera.projectionMatrix
  const viewProjection = new Mat4().multiplyMatrices(projection, view)
  const planes = frustumPlanes(viewProjection)

  /** @type {FrameDescription} */
  const frame = {
    camera: { view, projection, viewProjection, position: camera.worldPosition, near: camera.near, far: camera.far, camera },
    lights: [],
    opaque: [],
    transparent: [],
    labels: [],
    background: scene.background,
    environment: scene.environment,
    stats: { drawn: 0, culled: 0 },
    highlight: null,
  }
  let punctual = 0, directional = 0

  /** @param {any} node */
  const visit = (node) => {
    if (!node.visible) return
    if (node.isDrawable) {
      const item = drawItem(node, view, planes)
      if (item) {
        // point sprites with a map nearly always have soft alpha edges, so they blend too
        const blended = node.material.transparent || (node.drawMode === 'points' && node.material.map)
        ;(blended ? frame.transparent : frame.opaque).push(item)
        frame.stats.drawn++
        if (node.labels) instanceLabels(node, viewProjection, frame.labels)
      } else {
        frame.stats.culled++
      }
    } else if (node.isLabel) {
      const position = node.worldPosition
      frame.labels.push({ key: node, node, index: null, text: node.text, style: node, position, ...project(position, viewProjection) })
    } else if (node.lightKind) {
      addLight(/** @type {Light} */ (node))
    }
    for (const child of node.children) visit(child)
  }

  /** @param {any} node */
  const addLight = (node) => {
    const kind = node.lightKind
    if (kind === 'ambient') {
      frame.lights.push({ kind: 'ambient', node, color: node.color, intensity: node.intensity })
    } else if (kind === 'hemisphere') {
      frame.lights.push({ kind: 'hemisphere', node, color: node.sky, ground: node.ground, intensity: node.intensity })
    } else if (kind === 'directional') {
      if (++directional > LIGHT_LIMITS.directional) {
        warnOnce(scene, `more than ${LIGHT_LIMITS.directional} directional lights - the extras are ignored; use scene.environment for more light`)
      } else {
        frame.lights.push({ kind: 'directional', node, color: node.color, intensity: node.intensity, direction: node.worldDirection, castShadow: node.castShadow })
      }
    } else {
      if (++punctual > LIGHT_LIMITS.punctual) {
        warnOnce(scene, `more than ${LIGHT_LIMITS.punctual} point and spot lights - the extras are ignored`)
      } else if (kind === 'spot') {
        frame.lights.push({ kind: 'spot', node, color: node.color, intensity: node.intensity, position: node.worldPosition,
          direction: node.worldDirection, range: node.range, angle: node.angle, penumbra: node.penumbra })
      } else {
        frame.lights.push({ kind: 'point', node, color: node.color, intensity: node.intensity, position: node.worldPosition, range: node.range })
      }
    }
  }
  visit(scene)

  // opaque: front to back lets the depth test reject hidden pixels early; grouping by material
  // variant keeps shader switches down
  frame.opaque.sort((x, y) => x.node.renderOrder - y.node.renderOrder ||
    (x.material.variant < y.material.variant ? -1 : x.material.variant > y.material.variant ? 1 : 0) ||
    x.depth - y.depth)
  // transparent: back to front so blending composes correctly
  frame.transparent.sort((x, y) => x.node.renderOrder - y.node.renderOrder || y.depth - x.depth)
  return frame
}

/**
 * @param {Drawable} node @param {Mat4} view @param {Float32Array[]} planes
 * @returns {DrawItem | null} null when culled
 */
function drawItem(node, view, planes) {
  const { geometry, material, worldMatrix } = node
  const instances = 'instanceMatrices' in node ? /** @type {InstancedMesh} */ (node) : null
  if (instances && instances.count === 0) return null
  if (!geometry.vertexCount) return null

  const box = geometry.bounds
  const center = box.getCenter().applyMatrix4(worldMatrix)
  const scale = Math.max(Math.hypot(worldMatrix[0], worldMatrix[1], worldMatrix[2]),
    Math.hypot(worldMatrix[4], worldMatrix[5], worldMatrix[6]), Math.hypot(worldMatrix[8], worldMatrix[9], worldMatrix[10]))
  // instanced meshes spread their copies anywhere, so they aren't culled as a whole
  if (node.frustumCulled && !instances && !sphereInFrustum(planes, center, box.getRadius() * scale)) return null

  // distance in front of the camera, along its view direction
  const depth = -(view[2] * center[0] + view[6] * center[1] + view[10] * center[2] + view[14])
  return { node, geometry, material, worldMatrix, instances, depth }
}

// a stable key per labelled node, so label elements survive from frame to frame
/** @type {WeakMap<object, number>} */
const ids = new WeakMap()
let nextId = 1

/**
 * Labels for every instance or point that has text, from the node's `labels` option.
 * @param {any} node InstancedMesh or Points @param {Mat4} viewProjection @param {FrameLabel[]} out
 */
function instanceLabels(node, viewProjection, out) {
  const { labels, worldMatrix: w } = node
  let id = ids.get(node)
  if (id === undefined) ids.set(node, id = nextId++)
  const instanced = 'instanceMatrices' in node
  const n = instanced ? node.count : node.geometry.drawnCount
  let px = 0, py = 0, pz = 0
  if (instanced) {
    // where on each instance: the top centre or the centre of its geometry
    const box = node.geometry.bounds, c = box.getCenter()
    px = c[0]; py = labels.at === 'top' ? box.max[1] : c[1]; pz = c[2]
  }
  const data = Array.isArray(node.data) ? node.data : null
  const byRow = typeof labels.priority === 'function'
  for (let i = 0; i < n; i++) {
    const row = data ? data[i] : null
    const text = labels.text(row, i)
    if (text === null || text === undefined || text === '') continue
    let x, y, z
    if (instanced) {
      const m = node.instanceMatrices, o = i * 16
      x = m[o] * px + m[o + 4] * py + m[o + 8] * pz + m[o + 12]
      y = m[o + 1] * px + m[o + 5] * py + m[o + 9] * pz + m[o + 13]
      z = m[o + 2] * px + m[o + 6] * py + m[o + 10] * pz + m[o + 14]
    } else {
      const p = node.geometry.positions
      x = p[i * 3]; y = p[i * 3 + 1]; z = p[i * 3 + 2]
    }
    const position = new Vec3(
      w[0] * x + w[4] * y + w[8] * z + w[12],
      w[1] * x + w[5] * y + w[9] * z + w[13],
      w[2] * x + w[6] * y + w[10] * z + w[14])
    const style = byRow ? { ...labels, priority: labels.priority(row, i) } : labels
    out.push({ key: `${id}:${i}`, node, index: i, text: String(text), style, position, ...project(position, viewProjection) })
  }
}

/** Where a world position lands on screen. @param {Vec3} position @param {Mat4} viewProjection */
function project(position, viewProjection) {
  const m = viewProjection
  const x = m[0] * position[0] + m[4] * position[1] + m[8] * position[2] + m[12]
  const y = m[1] * position[0] + m[5] * position[1] + m[9] * position[2] + m[13]
  const z = m[2] * position[0] + m[6] * position[1] + m[10] * position[2] + m[14]
  const w = m[3] * position[0] + m[7] * position[1] + m[11] * position[2] + m[15]
  const ndc = /** @type {[number, number]} */ ([x / w, y / w])
  const visible = w > 0 && Math.abs(ndc[0]) <= 1 && Math.abs(ndc[1]) <= 1 && z / w <= 1
  return { ndc, depth: w, visible }
}

// The six planes (a, b, c, d with the normal pointing inwards) of a view-projection matrix.
/** @param {Float32Array} m @returns {Float32Array[]} */
function frustumPlanes(m) {
  const rows = (i) => [m[i], m[4 + i], m[8 + i], m[12 + i]]
  const r0 = rows(0), r1 = rows(1), r2 = rows(2), r3 = rows(3)
  return [
    [r3[0] + r0[0], r3[1] + r0[1], r3[2] + r0[2], r3[3] + r0[3]],
    [r3[0] - r0[0], r3[1] - r0[1], r3[2] - r0[2], r3[3] - r0[3]],
    [r3[0] + r1[0], r3[1] + r1[1], r3[2] + r1[2], r3[3] + r1[3]],
    [r3[0] - r1[0], r3[1] - r1[1], r3[2] - r1[2], r3[3] - r1[3]],
    [r3[0] + r2[0], r3[1] + r2[1], r3[2] + r2[2], r3[3] + r2[3]],
    [r3[0] - r2[0], r3[1] - r2[1], r3[2] - r2[2], r3[3] - r2[3]],
  ].map((p) => {
    const len = Math.hypot(p[0], p[1], p[2]) || 1
    return new Float32Array([p[0] / len, p[1] / len, p[2] / len, p[3] / len])
  })
}

/** @param {Float32Array[]} planes @param {ArrayLike<number>} c @param {number} radius */
function sphereInFrustum(planes, c, radius) {
  for (const p of planes) {
    if (p[0] * c[0] + p[1] * c[1] + p[2] * c[2] + p[3] < -radius) return false
  }
  return true
}

/**
 * A renderer that records frames instead of drawing them - for tests, doc-tests and server-side
 * checks. Same render() contract as the WebGL renderer.
 */
export class NullRenderer {
  /** @type {FrameDescription | null} */
  lastFrame = null
  frameCount = 0

  /**
   * Bring world matrices up to date and record what would be drawn. Doesn't run update handlers -
   * the View's loop (or your own) does that with scene.update(dt, t).
   * @param {Scene} scene @param {Camera} camera
   * @returns {FrameDescription}
   */
  render(scene, camera) {
    scene.updateWorldTree()
    return this.renderFrame(collect(scene, camera))
  }

  /** @param {FrameDescription} frame @returns {FrameDescription} */
  renderFrame(frame) {
    this.lastFrame = frame
    this.frameCount++
    return frame
  }

  dispose() {}
}

