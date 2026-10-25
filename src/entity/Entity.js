import { vec4 } from 'gl-matrix'
import { calcNormalVector, combine } from '../util.js'
import { BaseEntity } from './BaseEntity.js'

// The main renderable 3D object: vertices, edges, polygons and textures plus a style object that
// selects how the renderer draws it.
//
// Style options:
//   color: [128,128,128]          RGB colour of the surface, 0-255
//   specular: 0                   specular power if non-zero - e.g. 16 or 64
//   diffuse: 1.0                  material diffusion, generally 0-1
//   emit: 0.0                     material emission (glow) 0-1
//   opacity: 1.0                  0-1
//   drawmode: 'solid'             'point' | 'wireframe' | 'solid'
//   shademode: 'lightsource'      'plain' | 'lightsource' | 'sprite' | 'callback' (last two for points)
//   fillmode: 'inflate'           'fill' | 'filltwice' | 'inflate' | 'fillstroke' | 'hiddenline'
//   objectsortmode: 'sorted'      coarse object sort - 'sorted' | 'front' | 'back'
//   geometrysortmode: 'automatic' point/edge/polygon sort - 'sorted' | 'automatic' | 'none'
//   linewidth: 1.0                wireframe line or point size
//   linescale: 0.0                depth based line scaling factor, zero for none
//   doublesided: false            true to skip the hidden surface test
//   texture: undefined            default texture index for polygons that don't specify one
//   sprite: undefined             texture index for shademode 'sprite'
//   compositeOperation: undefined canvas globalCompositeOperation for the entity
export class Entity extends BaseEntity {
  // [{x,y,z}] vertices
  points = []
  // [{a,b}] wireframe edges as pairs of vertex indices
  edges = []
  // [{vertices:[...], color?, texture?, uvs?, emit?, opacity?}] - minimum 3 vertices per polygon
  polygons = []
  // texture images available to polygons by index
  textures = []
  style = Entity.createStyle()
  // function(ctx, x, y, w) this = entity - called for points when shademode is 'callback'
  onRenderHandlers = []

  // per-frame pipeline buffers, sized in initCoordinateBuffers()
  _worldcoords = null
  _cameracoords = null
  _coords = null
  _clip = null
  _averagez = 0

  // Object literal description: BaseEntity options plus { points, edges, polygons, style, onRender }
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

  // A complete default style, optionally combined with overrides.
  static createStyle(s) {
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

  onRender(fn) {
    this.onRenderHandlers = this.onRenderHandlers.concat(fn)
    return this
  }

  // Face normals from the first three vertices of each polygon, stored as polygon.normal.
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

  // (Re)allocate the per-vertex pipeline buffers when the vertex count grows.
  initCoordinateBuffers() {
    const len = this.points.length
    const vec4s = () => Array.from({ length: len }, () => vec4.create())
    if (this._worldcoords === null || this._worldcoords.length < len) this._worldcoords = vec4s()
    if (this._cameracoords === null || this._cameracoords.length < len) this._cameracoords = vec4s()
    if (this._coords === null || this._coords.length < len) this._coords = vec4s()
    if (this._clip === null || this._clip.length < len) this._clip = new Uint32Array(len)
  }

  // Screen space bounding rectangle: { minx, miny, maxx, maxy }
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

  // World space bounding box: { minx, miny, minz, maxx, maxy, maxz }
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

  // Attach (or update) debug output for an entity: { showId, showAxis, showPosition }
  static debug(entity, config) {
    const id = 'Phoria.Debug' + (entity.id ? ' ' + entity.id : '')
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
