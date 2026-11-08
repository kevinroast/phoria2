// Shader programs, compiled on first use and cached by kind and feature defines. Compiling is the
// most of a first frame, so it runs in parallel where the browser can (KHR_parallel_shader_compile):
// programs are started without waiting, drawing skips the ones still compiling, and the renderer
// draws again when they are done. Nothing waits on a status check until a program is used.
import { shaderSource } from './shaders.js'

// textures a program can sample: WebGL 2 guarantees 16 units, and the last is kept for uploads and
// making targets (resources.js, TEXTURE15), so a draw's samplers never have it taken from under them
export const SAMPLER_UNITS = 15

/** @import { HookSource, ShaderKind } from './shaders.js' */

/**
 * @typedef {object} Program
 * @property {WebGLProgram} program
 * @property {string} key
 * @property {(name: string, value: any) => void} set set a uniform by name (ignored if the shader doesn't use it)
 * @property {number} frame the frame its per-frame uniforms were last set for
 * @property {boolean} ready compiled, linked and its uniforms found
 * @property {string} [failed] the compiler's log, for a program with a material's shader hooks that
 *   failed - those are reported and drawn without, rather than thrown
 */

/**
 * @typedef {Program & { shaders: [WebGLShader, WebGLShader], sources: [string, string], hooked: boolean }} Building
 */

export class Programs {
  /** @type {Map<string, Program>} */ #cache = new Map()
  /** Compiling off the main thread is possible. */
  #parallel
  /** Full-screen passes have no attributes, but still want a vertex array of their own. @type {WebGLVertexArrayObject | null} */
  #empty = null

  /** @param {WebGL2RenderingContext} gl */
  constructor(gl) {
    this.gl = gl
    this.#parallel = !!gl.getExtension('KHR_parallel_shader_compile')
  }

  get count() {
    return this.#cache.size
  }

  /** Programs started but not finished compiling. */
  get compiling() {
    let n = 0
    for (const p of this.#cache.values()) if (!p.ready && !this.isReady(p)) n++
    return n
  }

  /**
   * A program, started compiling on first ask. It may not be ready yet - check isReady() before
   * drawing with it, or use ready() to wait.
   * @param {ShaderKind | string} kind a drawable kind, or a pass's name when it brings its sources
   * @param {string[]} defines
   * @param {[string, string]} [sources] a pass's vertex and fragment shaders
   * @param {HookSource | null} [hooks] a material's shader hooks, spliced in (its id is in the defines)
   * @returns {Program}
   */
  get(kind, defines, sources, hooks = null) {
    const key = `${kind}|${defines.join(',')}`
    let p = this.#cache.get(key)
    if (!p) {
      p = this.#start(key, shaderSource(sources ?? /** @type {ShaderKind} */ (kind), defines, hooks), !!hooks)
      this.#cache.set(key, p)
    }
    return p
  }

  /**
   * A program, waiting for it to finish compiling if it hasn't - for passes and picking, which
   * need their programs now.
   * @param {ShaderKind | string} kind @param {string[]} defines @param {[string, string]} [sources]
   * @param {HookSource | null} [hooks]
   * @returns {Program}
   */
  ready(kind, defines, sources, hooks = null) {
    const p = this.get(kind, defines, sources, hooks)
    if (!p.ready) this.#finish(/** @type {Building} */ (p))
    return p
  }

  /**
   * Has it finished compiling? Asks without waiting, and finishes it (finding its uniforms) once
   * it has.
   * @param {Program} p
   * @returns {boolean}
   */
  isReady(p) {
    if (p.ready) return true
    if (this.#parallel && !this.gl.getProgramParameter(p.program, 0x91b1 /* COMPLETION_STATUS_KHR */)) return false
    this.#finish(/** @type {Building} */ (p))
    return true
  }

  /** Forget everything - after a lost context. */
  /** Forget every program - after a lost context, when they are already gone. */
  reset() {
    this.#cache.clear()
    this.#empty = null
    // a lost context drops its extensions: ask again, which turns it back on (or finds it gone)
    this.#parallel = !!this.gl.getExtension('KHR_parallel_shader_compile')
  }

  /**
   * Draw one triangle over the whole target with the program in use - a full-screen pass, its corners
   * made in the vertex shader from the vertex index. Depth, culling and blending are the pass's own.
   */
  drawFullscreen() {
    const gl = this.gl
    this.#empty ??= gl.createVertexArray()
    gl.bindVertexArray(this.#empty)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  dispose() {
    for (const p of this.#cache.values()) this.gl.deleteProgram(p.program)
    this.#cache.clear()
    if (this.#empty) this.gl.deleteVertexArray(this.#empty)
    this.#empty = null
  }

  /**
   * Start compiling and linking, without asking how it went - that would wait for it.
   * @param {string} key @param {[string, string]} sources @param {boolean} [hooked] has a material's own code
   * @returns {Program}
   */
  #start(key, sources, hooked = false) {
    const gl = this.gl
    const shader = (type, source) => {
      const s = /** @type {WebGLShader} */ (gl.createShader(type))
      gl.shaderSource(s, source)
      gl.compileShader(s)
      return s
    }
    const program = /** @type {WebGLProgram} */ (gl.createProgram())
    const vs = shader(gl.VERTEX_SHADER, sources[0])
    const fs = shader(gl.FRAGMENT_SHADER, sources[1])
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    /** @type {Building} */
    const p = { program, key, frame: -1, ready: false, set() {}, shaders: [vs, fs], sources, hooked }
    // without parallel compiling there is nothing to gain by waiting until it's used
    if (!this.#parallel) this.#finish(p)
    return p
  }

  /** Check how compiling went - throwing the log if it failed - and find the uniforms. @param {Building} p */
  #finish(p) {
    const gl = this.gl
    const { program, key, shaders, sources } = p
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
      // a material's own code failing is its problem, not the frame's: kept to be reported
      if (p.hooked) {
        p.failed = shaders.map((s) => gl.getShaderParameter(s, gl.COMPILE_STATUS) ? '' : gl.getShaderInfoLog(s) ?? '').join('\n') || (gl.getProgramInfoLog(program) ?? 'failed to link')
        p.ready = true
        return
      }
      // the shader that failed says why, with its source numbered to match the log
      shaders.forEach((s, i) => {
        if (gl.getShaderParameter(s, gl.COMPILE_STATUS)) return
        throw new Error(`phoria2: ${i ? 'fragment' : 'vertex'} shader '${key}' failed to compile:\n${gl.getShaderInfoLog(s)}\n${numbered(sources[i])}`)
      })
      throw new Error(`phoria2: shader program '${key}' failed to link: ${gl.getProgramInfoLog(program)}`)
    }
    for (const s of shaders) gl.deleteShader(s)

    // every active uniform, with a setter for its type; arrays are set from flat typed arrays, and
    // each sampler gets a texture unit of its own
    /** @type {Map<string, (value: any) => void>} */
    const setters = new Map()
    const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS)
    let unit = 0
    for (let i = 0; i < n; i++) {
      const info = /** @type {WebGLActiveInfo} */ (gl.getActiveUniform(program, i))
      const name = info.name.replace(/\[0\]$/, '')
      const loc = gl.getUniformLocation(program, info.name)
      const target = samplerTarget(gl, info.type)
      if (target && info.size > 1) throw new Error(`phoria2: shader '${key}' has an array of samplers ('${name}'), which nothing binds`)
      const setter = target ? bindTo(gl, target, loc, unit++) : setterFor(gl, info.type, loc)
      if (!setter) throw new Error(`phoria2: shader '${key}' has uniform '${name}' of a type nothing sets (0x${info.type.toString(16)})`)
      setters.set(name, setter)
    }
    // more textures than the device has units: a material's own (its hooks') is reported and drawn
    // without them, as a hook that doesn't compile is; one of phoria2's own is a bug, said at once
    if (unit > SAMPLER_UNITS) {
      const why = `shader '${key}' samples ${unit} textures, more than the ${SAMPLER_UNITS} a draw can have`
      if (!p.hooked) throw new Error(`phoria2: ${why}`)
      p.failed = `${why} - give its hooks fewer texture uniforms`
    }
    p.set = (name, value) => setters.get(name)?.(value)
    p.ready = true
  }
}

/**
 * A setter for a uniform of a type that isn't a sampler, or null for a type nothing sets. A single
 * number sets a scalar; an array or typed array sets a vector, a matrix, or an array of them.
 * @param {WebGL2RenderingContext} gl @param {number} type @param {WebGLUniformLocation | null} loc
 * @returns {((value: any) => void) | null}
 */
function setterFor(gl, type, loc) {
  switch (type) {
    case gl.FLOAT: return (v) => typeof v === 'number' ? gl.uniform1f(loc, v) : gl.uniform1fv(loc, v)
    case gl.FLOAT_VEC2: return (v) => gl.uniform2fv(loc, v)
    case gl.FLOAT_VEC3: return (v) => gl.uniform3fv(loc, v)
    case gl.FLOAT_VEC4: return (v) => gl.uniform4fv(loc, v)
    case gl.INT:
    case gl.BOOL: return (v) => typeof v === 'number' || typeof v === 'boolean' ? gl.uniform1i(loc, +v) : gl.uniform1iv(loc, v)
    case gl.INT_VEC2:
    case gl.BOOL_VEC2: return (v) => gl.uniform2iv(loc, v)
    case gl.INT_VEC3:
    case gl.BOOL_VEC3: return (v) => gl.uniform3iv(loc, v)
    case gl.INT_VEC4:
    case gl.BOOL_VEC4: return (v) => gl.uniform4iv(loc, v)
    case gl.UNSIGNED_INT: return (v) => typeof v === 'number' ? gl.uniform1ui(loc, v) : gl.uniform1uiv(loc, v)
    case gl.UNSIGNED_INT_VEC2: return (v) => gl.uniform2uiv(loc, v)
    case gl.UNSIGNED_INT_VEC3: return (v) => gl.uniform3uiv(loc, v)
    case gl.UNSIGNED_INT_VEC4: return (v) => gl.uniform4uiv(loc, v)
    case gl.FLOAT_MAT2: return (v) => gl.uniformMatrix2fv(loc, false, v)
    case gl.FLOAT_MAT3: return (v) => gl.uniformMatrix3fv(loc, false, v)
    case gl.FLOAT_MAT4: return (v) => gl.uniformMatrix4fv(loc, false, v)
    default: return null
  }
}

/**
 * The texture target a sampler type reads, or null when the type isn't a sampler.
 * @param {WebGL2RenderingContext} gl @param {number} type
 * @returns {number | null}
 */
function samplerTarget(gl, type) {
  switch (type) {
    case gl.SAMPLER_2D:
    case gl.SAMPLER_2D_SHADOW:
    case gl.INT_SAMPLER_2D:
    case gl.UNSIGNED_INT_SAMPLER_2D: return gl.TEXTURE_2D
    case gl.SAMPLER_CUBE:
    case gl.SAMPLER_CUBE_SHADOW:
    case gl.INT_SAMPLER_CUBE:
    case gl.UNSIGNED_INT_SAMPLER_CUBE: return gl.TEXTURE_CUBE_MAP
    case gl.SAMPLER_3D:
    case gl.INT_SAMPLER_3D:
    case gl.UNSIGNED_INT_SAMPLER_3D: return gl.TEXTURE_3D
    case gl.SAMPLER_2D_ARRAY:
    case gl.SAMPLER_2D_ARRAY_SHADOW:
    case gl.INT_SAMPLER_2D_ARRAY:
    case gl.UNSIGNED_INT_SAMPLER_2D_ARRAY: return gl.TEXTURE_2D_ARRAY
    default: return null
  }
}

/**
 * A sampler's setter: binds the texture to the sampler's own unit, on its target.
 * @param {WebGL2RenderingContext} gl @param {number} target @param {WebGLUniformLocation | null} loc @param {number} unit
 * @returns {(texture: WebGLTexture) => void}
 */
function bindTo(gl, target, loc, unit) {
  return (texture) => {
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(target, texture)
    gl.uniform1i(loc, unit)
  }
}

/** @param {string} source */
const numbered = (source) => source.split('\n').map((line, i) => `${String(i + 1).padStart(4)}  ${line}`).join('\n')
