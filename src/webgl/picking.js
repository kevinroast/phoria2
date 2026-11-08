// GPU picking: draw what is under the pointer into a small integer target - each pickable drawable's
// number, the instance, point or segment, and the depth - and read it back. One pass however many
// instances there are, where testing rays against 100,000 instances on the CPU takes milliseconds.
// Loaded the first time a View picks.
import { CLIP, COMMON, CUTOUT, LINES_VERTEX, MESH_VERTEX, POINTS_VERTEX } from './shaders.js'
import { hookFor, passDefines, setHookUniforms } from './hooks.js'
import { setShapeUniforms, shapeDefines } from './shape.js'
import { makeTarget } from './targets.js'
import * as mat4 from '../math/mat4.js'

/** @import { Programs } from './programs.js' */
/** @import { Resources } from './resources.js' */
/** @import { DrawItem, FrameDescription } from '../frame.js' */

/** Pixels drawn around the pointer: room for a point sprite or wide line centred off the pointer. */
const REGION = 33
/** How far (pixels) from the pointer a point or line still counts as under it. */
const TOLERANCE = 4

const PICK_FRAGMENT = /* glsl */ `
precision highp float;
precision highp int;
flat in uint vPickElement;
#if defined(SPRITES) || defined(HOOK_FRAGMENT) || defined(ALPHA_TEST)
in vec2 vUv;
#endif
#if defined(CLIP) || defined(HOOK_FRAGMENT)
in vec3 vWorldPosition;
#endif
#ifdef HOOK_FRAGMENT
// a mesh's fragment hook: what it cuts away can't be picked
in vec3 vNormal;
in vec3 vColor;
#endif
//@hook uniforms
uniform uint uPickId;
layout(location = 0) out uvec4 pickOut;
${COMMON}
${CLIP}
// a cut-out's holes can't be picked: the pointer goes through to what is behind
${CUTOUT}
void main() {
#ifdef CLIP
  clipAway(vWorldPosition);
#endif
#ifdef HOOK_FRAGMENT
  {
    vec4 base = vec4(vColor, 1.0);
    vec3 emissive = vec3(0.0);
    vec3 normal = normalize(vNormal);
//@hook fragment
    if (base.a <= 0.0) discard;
  }
#endif
  cutOut();
#ifdef ROUND
#ifdef SPRITES
  vec2 p = vUv * 2.0 - 1.0;
#else
  vec2 p = gl_PointCoord * 2.0 - 1.0;
#endif
  if (dot(p, p) > 1.0) discard;
#endif
  pickOut = uvec4(uPickId, vPickElement, floatBitsToUint(gl_FragCoord.z), 1u);
}
`
const SOURCES = {
  mesh: /** @type {[string, string]} */ ([MESH_VERTEX, PICK_FRAGMENT]),
  points: /** @type {[string, string]} */ ([POINTS_VERTEX, PICK_FRAGMENT]),
  lines: /** @type {[string, string]} */ ([LINES_VERTEX, PICK_FRAGMENT]),
}

/**
 * @typedef {object} GPUHit
 * @property {DrawItem} item what was hit
 * @property {number} element the instance (InstancedMesh), point (Points) or segment (Lines); 0 for a mesh
 * @property {[number, number, number]} ndc where, with its depth, in normalised device coordinates
 */

export class Picker {
  /** @type {import('./targets.js').Target | null} */ #target = null
  #pixels = new Uint32Array(REGION * REGION * 4)
  #projection = new Float32Array(16)
  #viewProjection = new Float32Array(16)
  #normal = new Float32Array(9)
  /** A buffer the asynchronous read-back lands in. @type {WebGLBuffer | null} */ #pack = null
  #waiting = false

  /** @param {WebGL2RenderingContext} gl @param {Programs} programs @param {Resources} resources */
  constructor(gl, programs, resources) {
    this.gl = gl
    this.programs = programs
    this.resources = resources
  }

  /** Forget the GL objects - after a lost context. */
  reset() {
    this.#target = null
    this.#pack = null
    this.#waiting = false
  }

  /**
   * What is drawn at a pixel of a frame, nearest first by the depth test. Waits for the GPU (a
   * millisecond or two) - right for a click; hovering uses pickAsync().
   * @param {FrameDescription} frame
   * @param {number} x @param {number} y drawing-buffer pixels from the top left
   * @param {number} width @param {number} height the drawing buffer's size
   * @param {number} pixelRatio drawing-buffer pixels per CSS pixel, for line widths and point sizes
   * @returns {GPUHit | null}
   */
  pick(frame, x, y, width, height, pixelRatio) {
    const gl = this.gl
    const region = this.#drawRegion(frame, x, y, width, height, pixelRatio)
    if (!region) return null
    gl.readPixels(0, 0, REGION, REGION, gl.RGBA_INTEGER, gl.UNSIGNED_INT, this.#pixels)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return this.#decode(region)
  }

  /**
   * The same, without waiting: the read-back goes into a buffer, and the answer comes once the GPU
   * has finished - the main thread never stalls, so hovering stays smooth at any size. One request
   * at a time; null when another is still out.
   * @param {FrameDescription} frame
   * @param {number} x @param {number} y @param {number} width @param {number} height @param {number} pixelRatio
   * @returns {Promise<GPUHit | null> | null}
   */
  pickAsync(frame, x, y, width, height, pixelRatio) {
    if (this.#waiting) return null
    const gl = this.gl
    const region = this.#drawRegion(frame, x, y, width, height, pixelRatio)
    if (!region) return Promise.resolve(null)
    const buffer = this.#readBuffer()
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer)
    gl.readPixels(0, 0, REGION, REGION, gl.RGBA_INTEGER, gl.UNSIGNED_INT, 0)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    const fence = /** @type {WebGLSync} */ (gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0))
    gl.flush()
    this.#waiting = true
    return new Promise((resolve) => {
      const poll = () => {
        if (gl.isContextLost()) {
          this.#waiting = false
          resolve(null)
          return
        }
        if (gl.clientWaitSync(fence, 0, 0) === gl.TIMEOUT_EXPIRED) {
          setTimeout(poll, 1)
          return
        }
        gl.deleteSync(fence)
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer)
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.#pixels)
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
        this.#waiting = false
        resolve(this.#decode(region))
      }
      setTimeout(poll, 0)
    })
  }

  /**
   * Draw the pickable items around a pixel into the target, left bound for reading.
   * @param {FrameDescription} frame @param {number} x @param {number} y
   * @param {number} width @param {number} height @param {number} pixelRatio
   * @returns {{ items: DrawItem[], cx: number, cy: number, width: number, height: number } | null}
   */
  #drawRegion(frame, x, y, width, height, pixelRatio) {
    const gl = this.gl
    const items = pickable(frame)
    if (!items.length) return null
    const target = this.#ensureTarget()
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
    gl.viewport(0, 0, REGION, REGION)
    gl.disable(gl.BLEND)
    gl.disable(gl.SCISSOR_TEST)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.depthMask(true)
    gl.clearBufferuiv(gl.COLOR, 0, [0, 0, 0, 0])
    gl.clearBufferfv(gl.DEPTH, 0, [1])

    // a projection that blows the region around the pixel up to fill the target
    const s = REGION
    // centred on the pointer itself, so the middle texel is the pointer and the hit ray is the pointer's
    const cx = (x / width) * 2 - 1, cy = 1 - (y / height) * 2
    const zoom = new Float32Array([width / s, 0, 0, 0, 0, height / s, 0, 0, 0, 0, 1, 0, -cx * width / s, -cy * height / s, 0, 1])
    mat4.multiply(this.#projection, zoom, frame.camera.projection)
    mat4.multiply(this.#viewProjection, this.#projection, frame.camera.view)

    items.forEach((item, i) => this.#draw(item, i + 1, frame, height, pixelRatio))
    gl.bindVertexArray(null)
    return { items, cx, cy, width, height }
  }

  /**
   * The pixel under the pointer; failing that, the nearest point or line within a few pixels.
   * @param {{ items: DrawItem[], cx: number, cy: number, width: number, height: number }} region
   * @returns {GPUHit | null}
   */
  #decode({ items, cx, cy, width, height }) {
    const p = this.#pixels
    const centre = REGION >> 1
    const at = (/** @type {number} */ px, /** @type {number} */ py) => (py * REGION + px) * 4
    let best = p[at(centre, centre)] ? at(centre, centre) : -1
    let bestX = 0, bestY = 0
    if (best < 0) {
      let bestD = Infinity
      for (let dy = -TOLERANCE; dy <= TOLERANCE; dy++) {
        for (let dx = -TOLERANCE; dx <= TOLERANCE; dx++) {
          const d = dx * dx + dy * dy
          if (d > TOLERANCE * TOLERANCE || d >= bestD) continue
          const o = at(centre + dx, centre + dy)
          const id = p[o]
          if (!id || /** @type {any} */ (items[id - 1].node).drawMode === 'triangles') continue
          best = o
          bestD = d
          bestX = dx
          bestY = dy
        }
      }
    }
    if (best < 0) return null
    const depth = new Float32Array(new Uint32Array([p[best + 2]]).buffer)[0]
    // the hit pixel's centre in the full view (the region's rows run bottom to top)
    const ndc = /** @type {[number, number, number]} */ ([cx + (bestX * 2) / width, cy + (bestY * 2) / height, depth * 2 - 1])
    return { item: items[p[best] - 1], element: p[best + 1], ndc }
  }

  #readBuffer() {
    if (this.#pack) return this.#pack
    const gl = this.gl
    this.#pack = /** @type {WebGLBuffer} */ (gl.createBuffer())
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.#pack)
    gl.bufferData(gl.PIXEL_PACK_BUFFER, this.#pixels.byteLength, gl.STREAM_READ)
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    return this.#pack
  }

  /** @param {DrawItem} item @param {number} id @param {FrameDescription} frame @param {number} height @param {number} pixelRatio */
  #draw(item, id, frame, height, pixelRatio) {
    const gl = this.gl
    const { node, geometry, material, worldMatrix, instances } = item
    const mode = /** @type {any} */ (node).drawMode
    const kind = mode === 'points' ? 'points' : mode === 'lines' ? 'lines' : 'mesh'
    // a mesh as the picture draws its shape - instanced, clipped, cut out, moved by its hooks
    const shape = kind === 'mesh' ? shapeDefines(item, true) : null
    const defines = ['PICK', ...(shape ? shape.defines : instances ? ['INSTANCED'] : [])]
    const sprites = kind === 'points' && /** @type {any} */ (node).drawsSprites
    if (kind === 'points') {
      if (material.sizeAttenuation) defines.push('SIZE_ATTENUATION')
      if (!material.map) defines.push('ROUND')
      if (sprites) defines.push('SPRITES')
    }
    const hook = shape ? shape.hook : hookFor(material)
    if (hook && !shape) defines.push(...passDefines(hook, false))
    const program = this.programs.ready(`pick-${kind}`, defines, SOURCES[kind], hook?.source)
    if (program.failed) return
    gl.useProgram(program.program)
    program.set('uView', frame.camera.view)
    program.set('uProjection', this.#projection)
    program.set('uViewProjection', this.#viewProjection)
    program.set('uModel', worldMatrix)
    program.set('uPickId', id)
    program.set('uHighlightIndex', -2)
    if (shape) setShapeUniforms(program, item, shape.cutout, (t) => this.resources.texture(t))
    if (hook) setHookUniforms(program, material, frame.time ?? 0, frame.camera.position, (t) => this.resources.texture(t))

    if (kind === 'lines') {
      gl.disable(gl.CULL_FACE)
      // the region is REGION pixels across, so line widths in pixels stay true
      program.set('uResolution', [REGION, REGION])
      program.set('uWidth', material.width * pixelRatio)
      program.set('uNear', frame.camera.near)
      // arrowheads pick as their segment; dashes' gaps do too, so a dashed link is as easy to hit
      const arrows = /** @type {any} */ (node).arrowBits ?? 0
      program.set('uArrows', arrows)
      program.set('uArrowSize', /** @type {any} */ (node).arrowPixels?.(material.width) * pixelRatio || 0)
      const buffers = this.resources.lines(geometry)
      gl.bindVertexArray(buffers.vao)
      gl.drawArraysInstanced(gl.TRIANGLES, 0, arrows ? 12 : 6, Math.min(buffers.count, Math.floor(geometry.drawnCount / 2)))
      return
    }
    if (kind === 'points') {
      gl.disable(gl.CULL_FACE)
      // sizes as drawn: world sizes scale by the real projection, not the zoomed one
      program.set('uSize', material.sizeAttenuation ? material.size : material.size * pixelRatio)
      program.set('uScale', frame.camera.projection[5] * height / 2)
      if (sprites) {
        // squares, in whatever order they were last drawn - each says which point it is
        program.set('uResolution', [REGION, REGION])
        const buffers = this.resources.sprites(geometry)
        gl.bindVertexArray(buffers.vao)
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, buffers.count)
        return
      }
      const buffers = this.resources.mesh(geometry, null, false)
      gl.bindVertexArray(buffers.vao)
      gl.drawArrays(gl.POINTS, 0, geometry.drawnVertices)
      return
    }
    program.set('uNormalMatrix', this.#normal)
    // something drawn over everything is picked over everything too
    if (material.depthTest) gl.enable(gl.DEPTH_TEST)
    else gl.disable(gl.DEPTH_TEST)
    if (material.doubleSided || item.clip?.cap) gl.disable(gl.CULL_FACE)
    else {
      gl.enable(gl.CULL_FACE)
      gl.cullFace(gl.BACK)
      gl.frontFace(mat4.determinant(worldMatrix) < 0 ? gl.CW : gl.CCW)
    }
    this.resources.drawTriangles(geometry, instances)
  }

  #ensureTarget() {
    // what is under the pointer, as integers: the drawable, its element, the depth - with a depth test
    this.#target ??= makeTarget(this.gl, { width: REGION, height: REGION, color: this.gl.RGBA32UI, filter: 'nearest', depth: 'buffer' })
    return this.#target
  }
}

/** The frame's drawables that can be picked: visible (as drawn) and pickable all the way up. @param {FrameDescription} frame */
function pickable(frame) {
  /** @type {Map<any, boolean>} */
  const seen = new Map()
  const ok = (/** @type {any} */ n) => {
    if (!n) return true
    let v = seen.get(n)
    if (v === undefined) seen.set(n, v = n.pickable !== false && ok(n.parent))
    return v
  }
  const items = [...frame.opaque, ...frame.transparent].filter((item) => ok(item.node))
  // what is drawn over everything goes last, so it is picked over everything too
  return [...items.filter((item) => item.material.depthTest), ...items.filter((item) => !item.material.depthTest)]
}

