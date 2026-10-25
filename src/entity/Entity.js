import { vec4 } from '../math.js'
import { calcNormalVector, combine } from '../util.js'
import { BaseEntity } from './BaseEntity.js'

/** @import { Edge, EntityDescription, Polygon, RenderHandler, Style, XYZ } from '../types.js' */

/**
 * The main renderable 3D object: vertices, edges, polygons and textures, plus a style object that
 * selects how the renderer draws it (see the Style type for every option and its default).
 */
export class Entity extends BaseEntity {
  /** @type {XYZ[]} */
  points = []
  /** Wireframe edges as pairs of vertex indices. @type {Edge[]} */
  edges = []
  /** @type {Polygon[]} */
  polygons = []
  /** Images available to polygons and sprites by index. @type {CanvasImageSource[]} */
  textures = []
  /** @type {Style} */
  style = Entity.createStyle()
  /** Called for each point when shademode is 'callback'. @type {RenderHandler[]} */
  onRenderHandlers = []

  // per-frame pipeline buffers, sized in initCoordinateBuffers()
  /** @type {Float32Array[] | null} */
  _worldcoords = null
  /** @type {Float32Array[] | null} */
  _cameracoords = null
  /** @type {Float32Array[] | null} screen x, y, clip z, w */
  _coords = null
  /** @type {Uint32Array | null} 1 where a vertex is outside the view frustum */
  _clip = null
  _averagez = 0

  /**
   * Create an entity from an object literal description. Geometry from the generate* functions
   * can be spread straight in: Entity.create({ ...generateUnitCube(), style: { color } })
   * @param {EntityDescription} desc
   * @param {Entity} [e] instance to apply the description to - subclasses pass their own
   * @returns {Entity}
   */
  static create(desc, e = new this()) {
    super.create(desc, e)
    if (desc.points) e.points = desc.points
    if (desc.polygons) e.polygons = desc.polygons
    if (desc.edges) e.edges = desc.edges
    if (desc.style) combine(e.style, desc.style)
    if (desc.onRender) e.onRender(desc.onRender)
    // call again if points/polygons are changed at runtime
    e.generatePolygonNormals()
    return e
  }

  /**
   * A complete default style, optionally combined with overrides.
   * @param {Style} [s]
   * @returns {Style}
   */
  static createStyle(s) {
    /** @type {Style} */
    const style = {
      color: [128, 128, 128],
      diffuse: 1.0,
      specular: 0,
      drawmode: 'solid',
      shademode: 'lightsource',
      fillmode: 'inflate',
      objectsortmode: 'sorted',
      geometrysortmode: 'automatic',
      linewidth: 1.0,
      linescale: 0.0,
      opacity: 1.0,
      doublesided: false,
    }
    return s ? combine(style, s) : style
  }

  /** @param {RenderHandler | RenderHandler[]} fn @returns {this} */
  onRender(fn) {
    this.onRenderHandlers = this.onRenderHandlers.concat(fn)
    return this
  }

  /** Face normals from the first three vertices of each polygon, stored as polygon.normal. */
  generatePolygonNormals() {
    const { points, polygons } = this
    for (const poly of polygons) {
      const [v0, v1, v2] = poly.vertices
      const a = points[v0], b = points[v1], c = points[v2]
      poly.normal = calcNormalVector(
        b.x - a.x, b.y - a.y, b.z - a.z,
        c.x - a.x, c.y - a.y, c.z - a.z)
    }
  }

  /** (Re)allocate the per-vertex pipeline buffers when the vertex count grows. */
  initCoordinateBuffers() {
    const len = this.points.length
    const vec4s = () => Array.from({ length: len }, () => vec4.create())
    if (this._worldcoords === null || this._worldcoords.length < len) this._worldcoords = vec4s()
    if (this._cameracoords === null || this._cameracoords.length < len) this._cameracoords = vec4s()
    if (this._coords === null || this._coords.length < len) this._coords = vec4s()
    if (this._clip === null || this._clip.length < len) this._clip = new Uint32Array(len)
  }

  /**
   * Screen space bounding rectangle, as of the last frame.
   * @returns {{ minx: number, miny: number, maxx: number, maxy: number }}
   */
  getScreenBounds() {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity
    for (const p of this._coords) {
      if (p[0] < minx) minx = p[0]
      if (p[0] > maxx) maxx = p[0]
      if (p[1] < miny) miny = p[1]
      if (p[1] > maxy) maxy = p[1]
    }
    return { minx, miny, maxx, maxy }
  }

  /**
   * World space bounding box, as of the last frame.
   * @returns {{ minx: number, miny: number, minz: number, maxx: number, maxy: number, maxz: number }}
   */
  getWorldBounds() {
    let minx = Infinity, miny = Infinity, minz = Infinity
    let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity
    for (const p of this._worldcoords) {
      if (p[0] < minx) minx = p[0]
      if (p[0] > maxx) maxx = p[0]
      if (p[1] < miny) miny = p[1]
      if (p[1] > maxy) maxy = p[1]
      if (p[2] < minz) minz = p[2]
      if (p[2] > maxz) maxz = p[2]
    }
    return { minx, miny, maxx, maxy, minz, maxz }
  }

  /**
   * Attach (or update) debug output drawn at an entity: its id, world position and axes.
   * @param {BaseEntity & { worldposition?: Float32Array }} entity
   * @param {{ showId?: boolean, showAxis?: boolean, showPosition?: boolean }} config
   */
  static debug(entity, config) {
    const id = 'Phoria.Debug' + (entity.id ? ' ' + entity.id : '')
    /** @type {any} - an Entity carrying its debug config */
    let debugEntity = entity.children.find((c) => c.id === id)

    if (!debugEntity) {
      // a child point entity with a custom renderer that draws text at the parent's position
      debugEntity = new Entity()
      debugEntity.id = id
      debugEntity.points = [{ x: 0, y: 0, z: 0 }]
      debugEntity.style = {
        drawmode: 'point',
        shademode: 'callback',
        geometrysortmode: 'none',
        objectsortmode: 'front', // render on top of everything else
      }
      debugEntity.config = {}
      debugEntity.onRender(function (ctx, x, y) {
        ctx.fillStyle = '#333'
        ctx.font = '14pt Helvetica'
        let textPos = y
        if (this.config.showId) {
          ctx.fillText(entity.id ?? "unknown - set Entity 'id' property", x, textPos)
          textPos += 16
        }
        if (this.config.showPosition) {
          const p = entity.worldposition ?? debugEntity._worldcoords[0]
          ctx.fillText(`{x:${p[0].toFixed(2)}, y:${p[1].toFixed(2)}, z:${p[2].toFixed(2)}}`, x, textPos)
        }
      })
      entity.children.push(debugEntity)

      // axis lines as children of the debug entity, enabled by showAxis
      const axis = (x, y, z, color) => {
        const e = new Entity()
        e.points = [{ x: 0, y: 0, z: 0 }, { x: 2 * x, y: 2 * y, z: 2 * z }]
        e.edges = [{ a: 0, b: 1 }]
        e.style = {
          drawmode: 'wireframe',
          shademode: 'plain',
          geometrysortmode: 'none',
          objectsortmode: 'front',
          linewidth: 2.0,
          color,
        }
        e.disabled = true
        return e
      }
      debugEntity.children.push(
        axis(1, 0, 0, [255, 0, 0]),
        axis(0, 1, 0, [0, 255, 0]),
        axis(0, 0, 1, [0, 0, 255]))
    }

    combine(debugEntity.config, config)
    for (const child of debugEntity.children) child.disabled = !debugEntity.config.showAxis
  }
}
