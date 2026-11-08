// Render targets - the textures and buffers passes draw into - made, kept and freed in one place, so
// every pass follows the same rules: a target is described (its size, colour formats, depth,
// multisampling), made from the description, and kept in its context's pool under a name. Views of
// different sizes sharing a context each have their own; a target no frame has used for a while is
// freed, so a pass turned off gives its memory back without anything telling it to.

/**
 * @typedef {object} TargetSpec what a target is
 * @property {number} width
 * @property {number} height
 * @property {number | number[] | null} [color] the colour attachments' formats - one, a list for drawing
 *   several at once, or null for none (default RGBA8)
 * @property {'texture' | 'buffer' | 'stencil' | null} [depth] depth as a texture passes can read, a
 *   depth buffer, a depth and stencil buffer, or none (default)
 * @property {number} [samples] multisampling: colour and depth are then buffers, read by resolving
 *   into a target with textures (blit) - 0 for none (default)
 * @property {'linear' | 'nearest'} [filter] how its colour textures are read (default 'linear')
 */

/**
 * @typedef {object} Target a framebuffer and what is attached to it
 * @property {WebGLFramebuffer} framebuffer
 * @property {number} width
 * @property {number} height
 * @property {WebGLTexture | null} texture the first colour attachment, when it is a texture
 * @property {WebGLTexture[]} textures every colour attachment that is a texture
 * @property {WebGLTexture | null} depthTexture
 * @property {WebGLRenderbuffer[]} renderbuffers
 */

/**
 * Make a target. Leaves the framebuffer bound to null.
 * @param {WebGL2RenderingContext} gl @param {TargetSpec} spec
 * @returns {Target}
 */
export function makeTarget(gl, spec) {
  const { width, height, depth = null, samples = 0, filter = 'linear' } = spec
  const colors = spec.color === null ? [] : Array.isArray(spec.color) ? spec.color : [spec.color ?? gl.RGBA8]
  const framebuffer = /** @type {WebGLFramebuffer} */ (gl.createFramebuffer())
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  /** @type {Target} */
  const target = { framebuffer, width, height, texture: null, textures: [], depthTexture: null, renderbuffers: [] }
  const buffer = (/** @type {number} */ format, /** @type {number} */ attachment) => {
    const b = /** @type {WebGLRenderbuffer} */ (gl.createRenderbuffer())
    gl.bindRenderbuffer(gl.RENDERBUFFER, b)
    if (samples > 0) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, format, width, height)
    else gl.renderbufferStorage(gl.RENDERBUFFER, format, width, height)
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, attachment, gl.RENDERBUFFER, b)
    target.renderbuffers.push(b)
  }
  const texture = (/** @type {number} */ format, /** @type {number} */ attachment, /** @type {number} */ glFilter) => {
    const t = /** @type {WebGLTexture} */ (gl.createTexture())
    // unit 15 is kept for making and uploading, so no draw's sampler is disturbed
    gl.activeTexture(gl.TEXTURE15)
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, glFilter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, glFilter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment, gl.TEXTURE_2D, t, 0)
    return t
  }
  colors.forEach((format, i) => {
    if (samples > 0) buffer(format, gl.COLOR_ATTACHMENT0 + i)
    else target.textures.push(texture(format, gl.COLOR_ATTACHMENT0 + i, filter === 'nearest' ? gl.NEAREST : gl.LINEAR))
  })
  target.texture = target.textures[0] ?? null
  if (colors.length > 1) gl.drawBuffers(colors.map((_, i) => gl.COLOR_ATTACHMENT0 + i))
  if (!colors.length) {
    gl.drawBuffers([gl.NONE])
    gl.readBuffer(gl.NONE)
  }
  if (depth === 'texture') target.depthTexture = texture(gl.DEPTH_COMPONENT24, gl.DEPTH_ATTACHMENT, gl.NEAREST)
  else if (depth === 'buffer') buffer(gl.DEPTH_COMPONENT24, gl.DEPTH_ATTACHMENT)
  else if (depth === 'stencil') buffer(gl.DEPTH24_STENCIL8, gl.DEPTH_STENCIL_ATTACHMENT)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.bindRenderbuffer(gl.RENDERBUFFER, null)
  return target
}

/** Free a target and everything attached to it. @param {WebGL2RenderingContext} gl @param {Target} target */
export function freeTarget(gl, target) {
  gl.deleteFramebuffer(target.framebuffer)
  for (const t of target.textures) gl.deleteTexture(t)
  if (target.depthTexture) gl.deleteTexture(target.depthTexture)
  for (const b of target.renderbuffers) gl.deleteRenderbuffer(b)
}

/**
 * Copy one colour attachment of a target into another - resolving a multisampled one into textures.
 * Leaves the framebuffer bound to null.
 * @param {WebGL2RenderingContext} gl @param {Target} from @param {Target} to @param {number} [attachment]
 */
export function blit(gl, from, to, attachment = 0) {
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, from.framebuffer)
  gl.readBuffer(gl.COLOR_ATTACHMENT0 + attachment)
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, to.framebuffer)
  gl.blitFramebuffer(0, 0, from.width, from.height, 0, 0, to.width, to.height, gl.COLOR_BUFFER_BIT, gl.NEAREST)
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
}

// frames a target is kept unused, for each view drawing with the context - views take turns on a
// shared one - before it is freed
const KEEP_FRAMES = 30

/** A spec as a key: the same description is the same target. @param {TargetSpec} spec */
const keyOf = (spec) => `${spec.width}x${spec.height}|${spec.color === undefined ? '' : String(spec.color)}|${spec.depth ?? ''}|${spec.samples ?? 0}|${spec.filter ?? ''}`

/** A context's render targets, by name and description. */
export class TargetPool {
  /** @type {Map<string, { target: Target, used: number }>} */ #entries = new Map()
  /** Frames drawn on the context, as the pool counts them. */
  frame = 0

  /** @param {WebGL2RenderingContext} gl */
  constructor(gl) {
    this.gl = gl
  }

  /**
   * The target for a name and description: the one made before, or a new one.
   * @param {string} name what it is for, such as 'bloom-2' or 'ao-normals'
   * @param {TargetSpec} spec
   * @returns {Target}
   */
  get(name, spec) {
    const key = `${name}|${keyOf(spec)}`
    let entry = this.#entries.get(key)
    if (!entry) this.#entries.set(key, entry = { target: makeTarget(this.gl, spec), used: this.frame })
    entry.used = this.frame
    return entry.target
  }

  /** How many targets are kept now. */
  get size() {
    return this.#entries.size
  }

  /**
   * End of a frame: free what no frame has used lately.
   * @param {number} views the views drawing with this context, which take turns
   */
  sweep(views) {
    const keep = KEEP_FRAMES * Math.max(1, views)
    for (const [key, entry] of this.#entries) {
      if (this.frame - entry.used < keep) continue
      freeTarget(this.gl, entry.target)
      this.#entries.delete(key)
    }
    this.frame++
  }

  /** Forget every target - after a lost context, when they are already gone. */
  reset() {
    this.#entries.clear()
  }

  /** Free every target. */
  dispose() {
    for (const { target } of this.#entries.values()) freeTarget(this.gl, target)
    this.#entries.clear()
  }
}
