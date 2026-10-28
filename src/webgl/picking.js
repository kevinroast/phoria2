// GPU picking: draw what is under the pointer into a small integer target - each pickable drawable's
// number, the instance, point or segment, and the depth - and read it back. One pass however many
// instances there are, where testing rays against 100,000 instances on the CPU takes milliseconds.
// Loaded the first time a View picks.
import { CLIP, COMMON, LINES_VERTEX, MESH_VERTEX, POINTS_VERTEX } from './shaders.js'
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
#ifdef CLIP
in vec3 vWorldPosition;
#endif
uniform uint uPickId;
layout(location = 0) out uvec4 pickOut;
${COMMON}
${CLIP}
void main() {
#ifdef CLIP
  clipAway(vWorldPosition);
#endif
#ifdef ROUND
  vec2 p = gl_PointCoord * 2.0 - 1.0;
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
  /** @type {{ framebuffer: WebGLFramebuffer, color: WebGLTexture, depth: WebGLRenderbuffer } | null} */ #target = null
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
    const defines = ['PICK']
    if (instances) defines.push('INSTANCED')
    if (kind === 'points') {
      if (material.sizeAttenuation) defines.push('SIZE_ATTENUATION')
      if (!material.map) defines.push('ROUND')
    }
    if (kind === 'mesh' && item.clip) defines.push('CLIP')
    const program = this.programs.ready(`pick-${kind}`, defines, SOURCES[kind])
    gl.useProgram(program.program)
    program.set('uView', frame.camera.view)
    program.set('uProjection', this.#projection)
    program.set('uViewProjection', this.#viewProjection)
    program.set('uModel', worldMatrix)
    program.set('uPickId', id)
    program.set('uHighlightIndex', -2)
    program.set('uUvTransform', [1, 1, 0, 0])
    if (item.clip) program.set('uClipPlane', item.clip.plane)

    if (kind === 'lines') {
      gl.disable(gl.CULL_FACE)
      // the region is REGION pixels across, so line widths in pixels stay true
      program.set('uResolution', [REGION, REGION])
      program.set('uWidth', material.width * pixelRatio)
      program.set('uNear', frame.camera.near)
      const buffers = this.resources.lines(geometry)
      gl.bindVertexArray(buffers.vao)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Math.min(buffers.count, Math.floor(geometry.drawnCount / 2)))
      return
    }
    if (kind === 'points') {
      gl.disable(gl.CULL_FACE)
      // sizes as drawn: world sizes scale by the real projection, not the zoomed one
      program.set('uSize', material.sizeAttenuation ? material.size : material.size * pixelRatio)
      program.set('uScale', frame.camera.projection[5] * height / 2)
      const buffers = this.resources.mesh(geometry, null, false)
      gl.bindVertexArray(buffers.vao)
      gl.drawArrays(gl.POINTS, 0, geometry.drawnVertices)
      return
    }
    program.set('uNormalMatrix', this.#normal)
    if (material.doubleSided || item.clip?.cap) gl.disable(gl.CULL_FACE)
    else {
      gl.enable(gl.CULL_FACE)
      gl.cullFace(gl.BACK)
      gl.frontFace(mirrored(worldMatrix) ? gl.CW : gl.CCW)
    }
    const buffers = this.resources.mesh(geometry, instances, true)
    gl.bindVertexArray(buffers.vao)
    const count = instances ? instances.count : 1
    const elements = geometry.drawnCount - geometry.drawnCount % 3
    if (buffers.indexType) gl.drawElementsInstanced(gl.TRIANGLES, elements, buffers.indexType, 0, count)
    else gl.drawArraysInstanced(gl.TRIANGLES, 0, elements, count)
  }

  #ensureTarget() {
    if (this.#target) return this.#target
    const gl = this.gl
    const color = /** @type {WebGLTexture} */ (gl.createTexture())
    gl.activeTexture(gl.TEXTURE15)
    gl.bindTexture(gl.TEXTURE_2D, color)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32UI, REGION, REGION)
    const depth = /** @type {WebGLRenderbuffer} */ (gl.createRenderbuffer())
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth)
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, REGION, REGION)
    const framebuffer = /** @type {WebGLFramebuffer} */ (gl.createFramebuffer())
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0)
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.#target = { framebuffer, color, depth }
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
  return [...frame.opaque, ...frame.transparent].filter((item) => ok(item.node))
}

/** @param {ArrayLike<number>} m 4x4 */
function mirrored(m) {
  return m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]) < 0
}
