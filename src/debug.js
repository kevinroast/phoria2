// view.debug: pictures for a person checking a scene - each light and the way it shines, the shadow
// cameras, bounding boxes, normals, the axes, the orbit target - and a corner readout of what a frame
// costs. view.explain() is the text an agent reads; this is what a person looks at. Loaded only when
// debug is turned on. The helpers are drawn by the View after the scene, not added to it, so they
// are never picked, saved, framed or counted: lines in the scene's depth, and faintly through
// whatever is in front of them, so a light inside a lamp can still be found.
import { collect } from './frame.js'
import { Geometry } from './geometry/Geometry.js'
import { Lines } from './scene/drawables.js'
import { Scene } from './scene/Scene.js'
import { Box3 } from './value/Box3.js'
import { Mat4 } from './value/Mat4.js'
import { Vec3 } from './value/Vec3.js'

/** @import { DrawItem, FrameDescription, FrameLight } from './frame.js' */
/** @import { Hit } from './Raycaster.js' */
/** @import { Camera } from './scene/cameras.js' */

/**
 * What debug draws. `true` for a helper shows it for everything; `'hovered'` (bounds and normals) only
 * for what is under the pointer.
 * @typedef {object} DebugOptions
 * @property {boolean} [lights] each light: an arrow for directional ones, a small sphere and its range
 *   for point lights, a cone for spot lights - in the light's colour
 * @property {boolean | 'texels'} [shadows] the box or cone each shadow is drawn from - the usual reason a
 *   shadow is cut off or soft. 'texels' also lays the shadow map's texels over everything that receives
 *   it, as a checkerboard: big squares mean the map is spread thin - its edges blur or step - and a
 *   tighter shadowBounds (or a smaller scene) sharpens them. Shown only where a texel is three
 *   pixels or more across: zoom in on an edge that looks soft
 * @property {boolean | 'hovered'} [bounds] world bounding boxes - what culling and view.frame() see
 * @property {boolean | 'hovered'} [normals] short lines along vertex normals (meshes up to 5,000
 *   vertices each when all are shown)
 * @property {boolean} [axes] x, y and z at the origin, red, green and blue
 * @property {boolean} [camera] the point the camera orbits round
 * @property {boolean | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'} [stats] a readout of
 *   frame time, draw calls, triangles, programs, textures and geometries, in a corner of the canvas
 */

const COLORS = { shadow: [1, 0.8, 0], bounds: [0, 0.9, 1], normal: [1, 0.31, 0.85], camera: [1, 1, 1] }
// normals, when shown for everything: past these a model would be a hedgehog
const NORMALS_PER_MESH = 5000, NORMALS_IN_ALL = 40000

/**
 * What a light's shape is drawn with: line segments and circles, in world space.
 * @typedef {object} Pen
 * @property {(a: ArrayLike<number>, b: ArrayLike<number>, c: ArrayLike<number>) => void} segment
 * @property {(centre: Vec3, u: Vec3, v: Vec3, r: number, c: ArrayLike<number>, segments?: number) => void} circle
 */

/**
 * How each kind of light is drawn, in its colour `c`, scaled to the scene's size round its middle.
 * Light from all round (ambient, hemisphere) has no shape to draw.
 * @type {Partial<Record<FrameLight['kind'], (l: FrameLight, pen: Pen, c: ArrayLike<number>, size: number, middle: Vec3) => void>>}
 */
const LIGHT_SHAPES = {
  // an arrow coming in over the scene's middle, the way the light travels
  directional: (l, pen, c, size, middle) => {
    if (!l.direction) return
    const d = new Vec3().copy(l.direction).normalize()
    const from = moved(middle, d, -size * 1.1), to = moved(middle, d, -size * 0.45)
    pen.segment(from, to, c)
    const [u, v] = across(d)
    for (const s of [u, v, u.clone().negate(), v.clone().negate()]) {
      pen.segment(to, moved(moved(to, d, -size * 0.08), s, size * 0.04), c)
    }
  },
  // a small sphere, and a ring at its range
  point: (l, pen, c, size) => {
    if (!l.position) return
    const p = new Vec3().copy(l.position), r = size * 0.06
    pen.circle(p, X, Y, r, c, 16)
    pen.circle(p, X, Z, r, c, 16)
    pen.circle(p, Y, Z, r, c, 16)
    if (l.range) pen.circle(p, X, Z, l.range, c, 48)
  },
  // the cone out to its range (or the scene's size), with a ring where its edge is
  spot: (l, pen, c, size) => {
    if (!l.position || !l.direction) return
    const p = new Vec3().copy(l.position), d = new Vec3().copy(l.direction).normalize()
    const length = l.range ? Math.min(l.range, size * 2) : size, r = length * Math.tan(l.angle ?? Math.PI / 4)
    const end = moved(p, d, length)
    const [u, v] = across(d)
    pen.circle(end, u, v, r, c, 32)
    for (const s of [u, v, u.clone().negate(), v.clone().negate()]) pen.segment(p, moved(end, s, r), c)
    pen.segment(p, end, c)
  },
}

export class DebugDraw {
  #scene = new Scene()
  #geometry = new Geometry({ positions: [0, 0, 0, 0, 0, 0] })
  // the same lines twice: in the scene's depth, and faintly through what is in front of them
  #solid = /** @type {Lines} */ (this.#scene.add(new Lines({ geometry: this.#geometry, pickable: false, frustumCulled: false,
    material: { vertexColors: true, width: 1.5, fog: false } })))
  #faint = /** @type {Lines} */ (this.#scene.add(new Lines({ geometry: this.#geometry, pickable: false, frustumCulled: false, renderOrder: 1e9,
    material: { vertexColors: true, width: 1, opacity: 0.22, depthTest: false, depthWrite: false, fog: false } })))
  /** @type {HTMLDivElement | null} */ #stats = null
  #statsAt = 0
  /** @type {number[]} */ #positions = []
  /** @type {number[]} */ #colors = []

  /** @param {HTMLElement | null} overlay where the stats readout goes - the layer over the canvas */
  constructor(overlay) {
    this.overlay = overlay
  }

  /**
   * Add the helpers to a frame about to be drawn, after everything in it. Returns how many items were
   * added to each list, to take out again once it is drawn.
   * @param {FrameDescription} frame @param {DebugOptions} o
   * @param {{ camera: Camera, hovered: Hit | null, bounds: Box3 }} at
   * @returns {{ opaque: number, transparent: number }}
   */
  add(frame, o, at) {
    this.#positions = []
    this.#colors = []
    const items = [...frame.opaque, ...frame.transparent]
    const size = at.bounds.isEmpty() ? 1 : Math.max(at.bounds.getRadius(), 1e-3)
    const middle = at.bounds.isEmpty() ? new Vec3() : at.bounds.getCenter()
    if (o.lights) this.#lights(frame, size, middle)
    if (o.shadows) this.#shadows(frame)
    if (o.bounds) this.#bounds(items, o.bounds === 'hovered' ? at.hovered : null, o.bounds === 'hovered')
    if (o.normals) this.#normals(items, o.normals === 'hovered' ? at.hovered : null, o.normals === 'hovered', size * 0.025)
    if (o.axes) {
      this.#segment([0, 0, 0], [size * 0.5, 0, 0], [1, 0.2, 0.2])
      this.#segment([0, 0, 0], [0, size * 0.5, 0], [0.3, 1, 0.3])
      this.#segment([0, 0, 0], [0, 0, size * 0.5], [0.3, 0.5, 1])
    }
    const target = /** @type {any} */ (at.camera).target
    if (o.camera && target) this.#cross(target, size * 0.04, COLORS.camera)
    if (!this.#positions.length) return { opaque: 0, transparent: 0 }

    // one buffer for all of it, made again only when it changes length
    const n = this.#positions.length
    const colors = this.#geometry.colors
    if (this.#geometry.positions.length === n && colors) {
      this.#geometry.positions.set(this.#positions)
      colors.set(this.#colors)
      this.#geometry.needsUpdate()
    } else {
      this.#geometry.dispose()
      this.#geometry = new Geometry({ positions: this.#positions, colors: this.#colors })
      this.#solid.geometry = this.#faint.geometry = this.#geometry
    }
    this.#scene.updateWorldTree()
    const drawn = collect(this.#scene, at.camera)
    frame.opaque.push(...drawn.opaque)
    frame.transparent.push(...drawn.transparent)
    return { opaque: drawn.opaque.length, transparent: drawn.transparent.length }
  }

  /**
   * The corner readout, refreshed a few times a second.
   * @param {DebugOptions['stats']} where
   * @param {{ drawCalls: number, triangles: number, programs: number, textures: number, geometries: number, compiling: number }} info
   * @param {number} frameMs time between drawn frames @param {number} cpuMs time the last frame took to draw
   */
  stats(where, info, frameMs, cpuMs) {
    if (!where || !this.overlay || typeof document === 'undefined') {
      this.#stats?.remove()
      this.#stats = null
      return
    }
    const corner = where === true ? 'top-left' : where
    if (!this.#stats) {
      this.#stats = document.createElement('div')
      this.#stats.className = 'phoria-debug-stats'
      Object.assign(this.#stats.style, { position: 'absolute', zIndex: '3', pointerEvents: 'none', padding: '6px 8px', borderRadius: '6px',
        background: 'rgba(10, 12, 16, 0.72)', color: '#e8ecf2', font: '11px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace', whiteSpace: 'pre' })
      this.overlay.append(this.#stats)
    }
    const [v, h] = corner.split('-')
    Object.assign(this.#stats.style, { top: v === 'top' ? '8px' : '', bottom: v === 'bottom' ? '8px' : '', left: h === 'left' ? '8px' : '', right: h === 'right' ? '8px' : '' })
    const now = performance.now()
    if (now - this.#statsAt < 250) return
    this.#statsAt = now
    const k = (x) => (x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e4 ? `${Math.round(x / 1e3)}k` : String(x))
    const fps = frameMs > 0 ? Math.round(1000 / frameMs) : 0
    this.#stats.textContent = [
      `${fps ? `${fps} fps  ${frameMs.toFixed(1)} ms` : 'idle'}  cpu ${cpuMs.toFixed(1)} ms`,
      `${info.drawCalls} draws  ${k(info.triangles)} triangles`,
      `${info.programs} programs${info.compiling ? ` (${info.compiling} compiling)` : ''}  ${info.textures} textures  ${info.geometries} geometries`,
    ].join('\n')
  }

  dispose() {
    this.#stats?.remove()
    this.#stats = null
    this.#geometry.dispose()
  }

  // ---- the helpers, as line segments in world space, colours sRGB

  /** @param {ArrayLike<number>} a @param {ArrayLike<number>} b @param {ArrayLike<number>} c */
  #segment(a, b, c) {
    this.#positions.push(a[0], a[1], a[2], b[0], b[1], b[2])
    this.#colors.push(c[0], c[1], c[2], c[0], c[1], c[2])
  }

  /** @param {ArrayLike<number>} p @param {number} r @param {ArrayLike<number>} c */
  #cross(p, r, c) {
    for (let k = 0; k < 3; k++) {
      const a = [p[0], p[1], p[2]], b = [p[0], p[1], p[2]]
      a[k] -= r
      b[k] += r
      this.#segment(a, b, c)
    }
  }

  /** A circle round a centre, in the plane of two unit axes. @param {Vec3} centre @param {Vec3} u @param {Vec3} v @param {number} r @param {ArrayLike<number>} c */
  #circle(centre, u, v, r, c, segments = 32) {
    const at = (i) => {
      const a = i / segments * Math.PI * 2, x = Math.cos(a) * r, y = Math.sin(a) * r
      return [centre[0] + u[0] * x + v[0] * y, centre[1] + u[1] * x + v[1] * y, centre[2] + u[2] * x + v[2] * y]
    }
    for (let i = 0; i < segments; i++) this.#segment(at(i), at(i + 1), c)
  }

  /** The twelve edges of a box. @param {Box3} box @param {ArrayLike<number>} c */
  #box(box, c) {
    const { min: a, max: b } = box
    const corner = (i) => [i & 1 ? b[0] : a[0], i & 2 ? b[1] : a[1], i & 4 ? b[2] : a[2]]
    for (const [i, j] of EDGES) this.#segment(corner(i), corner(j), c)
  }

  /** The edges of what a view-projection matrix sees: a box for an orthographic one, a frustum for a perspective one. @param {ArrayLike<number>} viewProjection @param {ArrayLike<number>} c */
  #frustum(viewProjection, c) {
    const inverse = new Mat4().copy(viewProjection).invert()
    const corner = (i) => new Vec3(i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1).applyMatrix4(inverse)
    for (const [i, j] of EDGES) this.#segment(corner(i), corner(j), c)
  }

  /** Each light, drawn as its kind is (LIGHT_SHAPES). @param {FrameDescription} frame @param {number} size @param {Vec3} middle */
  #lights(frame, size, middle) {
    /** @type {Pen} */
    const pen = { segment: (a, b, c) => this.#segment(a, b, c), circle: (...args) => this.#circle(...args) }
    for (const l of frame.lights) {
      const c = l.color.toSRGB().map((x) => Math.min(1, x))
      LIGHT_SHAPES[l.kind]?.(l, pen, c, size, middle)
    }
  }

  /** @param {FrameDescription} frame */
  #shadows(frame) {
    if (frame.shadow) this.#frustum(frame.shadow.viewProjection, COLORS.shadow)
    for (const s of frame.spotShadows) this.#frustum(s.viewProjection, COLORS.shadow)
  }

  /** @param {DrawItem[]} items @param {Hit | null} hovered @param {boolean} onlyHovered */
  #bounds(items, hovered, onlyHovered) {
    if (onlyHovered) {
      if (!hovered) return
      const node = /** @type {any} */ (hovered.node)
      // an instance's own box, or the whole node's
      if (hovered.instance !== null && typeof node.eachInstanceBox === 'function') {
        let i = 0
        node.eachInstanceBox((x0, y0, z0, x1, y1, z1) => {
          if (i++ === hovered.instance) this.#box(new Box3([x0, y0, z0], [x1, y1, z1]), COLORS.bounds)
        })
      } else this.#box(node.expandBounds(new Box3()), COLORS.bounds)
      return
    }
    const seen = new Set()
    for (const item of items) {
      if (seen.has(item.node)) continue
      seen.add(item.node)
      const box = /** @type {any} */ (item.node).expandBounds(new Box3())
      if (!box.isEmpty()) this.#box(box, COLORS.bounds)
    }
  }

  /** @param {DrawItem[]} items @param {Hit | null} hovered @param {boolean} onlyHovered @param {number} length */
  #normals(items, hovered, onlyHovered, length) {
    const meshes = onlyHovered
      ? (hovered && /** @type {any} */ (hovered.node).drawMode === 'triangles' ? [/** @type {any} */ (hovered.node)] : [])
      : [...new Set(items.map((i) => i.node))].filter((n) => /** @type {any} */ (n).drawMode === 'triangles')
    let budget = NORMALS_IN_ALL
    for (const node of /** @type {any[]} */ (meshes)) {
      if (node.instanceMatrices) continue
      const g = node.geometry, count = g.vertexCount
      if (!g.normals || (!onlyHovered && (count > NORMALS_PER_MESH || count > budget))) continue
      budget -= count
      const m = node.worldMatrix, p = g.positions, n = g.normals
      const a = new Vec3(), d = new Vec3()
      for (let i = 0; i < count; i++) {
        a.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]).applyMatrix4(m)
        // the normal turned with the node (the upper 3x3: right for rotation and even scale)
        d.set(m[0] * n[i * 3] + m[4] * n[i * 3 + 1] + m[8] * n[i * 3 + 2], m[1] * n[i * 3] + m[5] * n[i * 3 + 1] + m[9] * n[i * 3 + 2],
          m[2] * n[i * 3] + m[6] * n[i * 3 + 1] + m[10] * n[i * 3 + 2]).normalize()
        this.#segment(a, [a[0] + d[0] * length, a[1] + d[1] * length, a[2] + d[2] * length], COLORS.normal)
      }
    }
  }
}

const X = new Vec3(1, 0, 0), Y = new Vec3(0, 1, 0), Z = new Vec3(0, 0, 1)
// a box's corners by bit (x, y, z), and the twelve edges between them
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]

/** Two unit axes across a direction. @param {Vec3} d @returns {[Vec3, Vec3]} */
function across(d) {
  const up = Math.abs(d[1]) < 0.9 ? Y : X
  const u = d.clone().cross(up).normalize()
  return [u, d.clone().cross(u).normalize()]
}

/** p moved s along d, as a new point. @param {ArrayLike<number>} p @param {ArrayLike<number>} d @param {number} s */
function moved(p, d, s) {
  return new Vec3(p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s)
}
