import { mat3, mat4, vec3, vec4 } from 'gl-matrix'
import { EPSILON, RADIANS } from './math.js'
import { merge, sortEdges, sortPoints, sortPolygons } from './util.js'
import { Entity } from './entity/Entity.js'
import { BaseLight } from './entity/lights.js'

// The scene: camera, perspective and viewport settings plus the graph of entities to process.
// Call modelView() once per frame to run the transformation pipeline, then hand the scene to a
// renderer: renderer.render(scene).
export class Scene {
  camera = {
    up: { x: 0.0, y: 1.0, z: 0.0 },
    lookat: { x: 0.0, y: 0.0, z: 0.0 },
    position: { x: 0.0, y: 0.0, z: -10.0 },
  }

  // near/far are distances from the camera view plane and always positive
  perspective = {
    // vertical field of view in degrees
    fov: 35.0,
    aspect: 1.0,
    near: 1.0,
    far: 10000.0,
  }

  // typically the size of the canvas
  viewport = { x: 0, y: 0, width: 1024, height: 1024 }

  // root entities - manipulate directly e.g. push/splice
  graph = []

  // [{ trigger: function(cameraPosition, lookat, up) this = scene }] run once per frame after
  // the scene is processed. A trigger returns true when finished, removing it from the list; it can
  // also add new triggers to chain a sequence of actions.
  triggerHandlers = []

  // function(cameraPosition, lookat, up) this = scene - adjust the camera vectors before the
  // lookAt matrix is built, e.g. to orbit the camera
  onCameraHandlers = []

  // read only, set by modelView(): flattened list of entities to render, and the lights found
  renderlist = []
  lights = []

  _entities = {}
  _lastTime = 0
  _cameraPosition = null
  _perspectiveScale = 0.0

  // Object literal description: { camera, perspective, viewport, graph, onCamera }
  static create(desc) {
    const s = new Scene()
    if (desc.camera) s.camera = merge(s.camera, desc.camera)
    if (desc.perspective) s.perspective = merge(s.perspective, desc.perspective)
    if (desc.viewport) s.viewport = merge(s.viewport, desc.viewport)
    if (desc.graph) s.graph = desc.graph
    if (desc.onCamera) s.onCamera(desc.onCamera)
    return s
  }

  // Entity by id, as of the last modelView() - for trigger handlers that don't want to walk the graph.
  findEntity(id) {
    return this._entities[id]
  }

  onCamera(fn) {
    this.onCameraHandlers = this.onCameraHandlers.concat(fn)
    return this
  }

  // The transformation pipeline:
  //  . camera and perspective matrices from the scene description
  //  . local transforms combined with parent transforms down the graph
  //  . world -> camera -> clip space, flagging vertices outside the frustum
  //  . perspective divide to NDC, then to viewport
  //  . Z-sort points/edges/polygons and transform polygon normals for lighting
  modelView() {
    // seconds since the last frame
    const now = Date.now()
    const time = (now - this._lastTime) / 1000
    this._lastTime = now

    // kept as a vec4 for the specular lighting calculations later
    const { camera: cam } = this
    this._cameraPosition = vec4.fromValues(cam.position.x, cam.position.y, cam.position.z, 0)
    const cameraLookat = vec4.fromValues(cam.lookat.x, cam.lookat.y, cam.lookat.z, 0)
    const cameraUp = vec4.fromValues(cam.up.x, cam.up.y, cam.up.z, 0)
    for (const h of this.onCameraHandlers) h.call(this, this._cameraPosition, cameraLookat, cameraUp)

    const camera = mat4.lookAt(mat4.create(), this._cameraPosition, cameraLookat, cameraUp)
    // negative fov flips the projection so +y is up on a canvas where screen y points down
    const p = this.perspective
    const perspective = mat4.perspective(mat4.create(), -p.fov * RADIANS, p.aspect, p.near, p.far)
    // scaling factor for rendering points with respect to the fov
    this._perspectiveScale = (256 - p.fov) / 16

    const vp = this.viewport
    const frame = {
      camera,
      perspective,
      matNormals: mat3.create(),
      vpx: vp.x, vpy: vp.y, vpw: vp.width * 0.5, vph: vp.height * 0.5,
    }
    const renderlist = [], lights = [], entityById = {}

    const processEntities = (entities, matParent) => {
      for (const obj of entities) {
        if (obj.disabled) continue
        if (obj.id) entityById[obj.id] = obj

        for (const h of obj.onBeforeSceneHandlers) h.call(obj, this, time)

        // world = parent x local: the entity's own transform is applied first, in its parent's frame
        let matLocal = obj.matrix
        if (matParent) matLocal = matLocal ? mat4.multiply(mat4.create(), matParent, matLocal) : matParent

        for (const h of obj.onSceneHandlers) h.call(obj, this, matLocal, time)

        if (obj instanceof BaseLight) {
          lights.push(obj)
        } else if (obj instanceof Entity) {
          if (this.#processEntity(obj, matLocal, frame)) renderlist.push(obj)
        }

        if (obj.children?.length) processEntities(obj.children, matLocal)
      }
    }
    processEntities(this.graph, null)

    this.renderlist = renderlist
    this.lights = lights
    this._entities = entityById

    // Index loop rather than for...of as triggers may add to or remove from the list.
    const triggers = this.triggerHandlers
    for (let t = 0; t < triggers.length; t++) {
      if (triggers[t].trigger.call(this, this._cameraPosition, cameraLookat, cameraUp)) {
        triggers.splice(t--, 1)
      }
    }
  }

  // Transform one entity's vertices; returns false if it is entirely clipped.
  #processEntity(obj, matLocal, { camera, perspective, matNormals, vpx, vpy, vpw, vph }) {
    const { style } = obj
    const len = obj.points.length
    obj.initCoordinateBuffers()

    // large points (e.g. sprites) are clipped by their size, not their centre, so they don't
    // vanish while still partly on screen
    let clipOffset = 0
    if (style.drawmode === 'point') {
      clipOffset = style.linescale === 0
        ? style.linewidth * 0.5
        : (style.linewidth * style.linescale) / this._perspectiveScale * 0.5
    }

    let objClip = 0, avz = 0
    for (let v = 0; v < len; v++) {
      // homogeneous coordinate local -> world -> camera -> clip space
      const point = obj.points[v]
      const world = vec4.set(obj._worldcoords[v], point.x, point.y, point.z, 1.0)
      if (matLocal) vec4.transformMat4(world, world, matLocal)
      vec4.transformMat4(obj._cameracoords[v], world, camera)
      const vec = vec4.transformMat4(obj._coords[v], obj._cameracoords[v], perspective)

      let w = vec[3]
      if (w === 0) w = EPSILON

      // outside the frustum? (tested in clip space, before the divide)
      objClip += (obj._clip[v] = (
        vec[0] > w + clipOffset || vec[0] < -w - clipOffset ||
        vec[1] > w + clipOffset || vec[1] < -w - clipOffset ||
        vec[2] > w || vec[2] < -w) ? 1 : 0)

      // perspective divide then viewport transform; Z stays as is for coarse depth sorting
      vec[0] = vpw * (vec[0] / w) + vpx + vpw
      vec[1] = vph * (vec[1] / w) + vpy + vph
      avz += vec[2]
    }
    obj._averagez = len > 1 ? avz / len : avz

    // entirely clipped - nothing more to do
    if (objClip === len) return false

    // Solid objects are always sorted as each polygon can be a different shade or texture;
    // wireframe and points only when lit (or when sorting is forced).
    const sortmode = style.geometrysortmode
    if (sortmode !== 'none' &&
        (sortmode === 'sorted' || style.drawmode === 'solid' || style.shademode === 'lightsource')) {
      switch (style.drawmode) {
        case 'solid': sortPolygons(obj.polygons, obj._cameracoords); break
        case 'wireframe': sortEdges(obj.edges, obj._cameracoords); break
        case 'point': sortPoints(obj._coords, obj._worldcoords); break
      }
    }

    // polygon normals -> world space via the inverse transpose, so non-uniform scaling is correct
    if (style.drawmode === 'solid' && obj.polygons.length) {
      if (!matLocal || !mat3.normalFromMat4(matNormals, matLocal)) mat3.identity(matNormals)
      for (const poly of obj.polygons) {
        poly._worldnormal ??= vec4.create()
        vec3.transformMat3(poly._worldnormal, poly.normal, matNormals)
        vec3.normalize(poly._worldnormal, poly._worldnormal)
      }
    }

    return true
  }
}
