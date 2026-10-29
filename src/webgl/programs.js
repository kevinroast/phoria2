// Shader programs, compiled on first use and cached by kind and feature defines. Compiling is the
// most of a first frame, so it runs in parallel where the browser can (KHR_parallel_shader_compile):
// programs are started without waiting, drawing skips the ones still compiling, and the renderer
// draws again when they are done. Nothing waits on a status check until a program is used.
import { shaderSource } from './shaders.js'

/** @import { ShaderKind } from './shaders.js' */

/**
 * @typedef {object} Program
 * @property {WebGLProgram} program
 * @property {string} key
 * @property {(name: string, value: any) => void} set set a uniform by name (ignored if the shader doesn't use it)
 * @property {number} frame the frame its per-frame uniforms were last set for
 * @property {boolean} ready compiled, linked and its uniforms found
 */

/**
 * @typedef {Program & { shaders: [WebGLShader, WebGLShader], sources: [string, string] }} Building
 */

export class Programs {
  /** @type {Map<string, Program>} */ #cache = new Map()
  /** Compiling off the main thread is possible. */
  #parallel

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
   * @returns {Program}
   */
  get(kind, defines, sources) {
    const key = `${kind}|${defines.join(',')}`
    let p = this.#cache.get(key)
    if (!p) {
      p = this.#start(key, shaderSource(sources ?? /** @type {ShaderKind} */ (kind), defines))
      this.#cache.set(key, p)
    }
    return p
  }

  /**
   * A program, waiting for it to finish compiling if it hasn't - for passes and picking, which
   * need their programs now.
   * @param {ShaderKind | string} kind @param {string[]} defines @param {[string, string]} [sources]
   * @returns {Program}
   */
  ready(kind, defines, sources) {
    const p = this.get(kind, defines, sources)
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
    // a lost context drops its extensions: ask again, which turns it back on (or finds it gone)
    this.#parallel = !!this.gl.getExtension('KHR_parallel_shader_compile')
  }

  dispose() {
    for (const p of this.#cache.values()) this.gl.deleteProgram(p.program)
    this.#cache.clear()
  }

  /**
   * Start compiling and linking, without asking how it went - that would wait for it.
   * @param {string} key @param {[string, string]} sources @returns {Program}
   */
  #start(key, sources) {
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
    const p = { program, key, frame: -1, ready: false, set() {}, shaders: [vs, fs], sources }
    // without parallel compiling there is nothing to gain by waiting until it's used
    if (!this.#parallel) this.#finish(p)
    return p
  }

  /** Check how compiling went - throwing the log if it failed - and find the uniforms. @param {Building} p */
  #finish(p) {
    const gl = this.gl
    const { program, key, shaders, sources } = p
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
      // the shader that failed says why, with its source numbered to match the log
      shaders.forEach((s, i) => {
        if (gl.getShaderParameter(s, gl.COMPILE_STATUS)) return
        throw new Error(`phoria2: ${i ? 'fragment' : 'vertex'} shader '${key}' failed to compile:\n${gl.getShaderInfoLog(s)}\n${numbered(sources[i])}`)
      })
      throw new Error(`phoria2: shader program '${key}' failed to link: ${gl.getProgramInfoLog(program)}`)
    }
    for (const s of shaders) gl.deleteShader(s)

    // every active uniform, with a setter for its type; arrays are set from flat typed arrays
    /** @type {Map<string, (value: any) => void>} */
    const setters = new Map()
    const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS)
    let unit = 0
    for (let i = 0; i < n; i++) {
      const info = /** @type {WebGLActiveInfo} */ (gl.getActiveUniform(program, i))
      const name = info.name.replace(/\[0\]$/, '')
      const loc = gl.getUniformLocation(program, info.name)
      const sampler = info.type === gl.SAMPLER_2D || info.type === gl.SAMPLER_2D_SHADOW || info.type === gl.SAMPLER_CUBE_SHADOW
      setters.set(name, setterFor(gl, info.type, loc, sampler ? unit++ : 0))
    }
    p.set = (name, value) => setters.get(name)?.(value)
    p.ready = true
  }
}

/** @param {WebGL2RenderingContext} gl @param {number} type @param {WebGLUniformLocation | null} loc @param {number} unit */
function setterFor(gl, type, loc, unit) {
  switch (type) {
    case gl.FLOAT: return (v) => typeof v === 'number' ? gl.uniform1f(loc, v) : gl.uniform1fv(loc, v)
    case gl.FLOAT_VEC2: return (v) => gl.uniform2fv(loc, v)
    case gl.FLOAT_VEC3: return (v) => gl.uniform3fv(loc, v)
    case gl.FLOAT_VEC4: return (v) => gl.uniform4fv(loc, v)
    case gl.INT:
    case gl.BOOL: return (v) => gl.uniform1i(loc, v)
    case gl.UNSIGNED_INT: return (v) => gl.uniform1ui(loc, v)
    case gl.FLOAT_MAT3: return (v) => gl.uniformMatrix3fv(loc, false, v)
    case gl.FLOAT_MAT4: return (v) => gl.uniformMatrix4fv(loc, false, v)
    case gl.SAMPLER_2D:
    case gl.SAMPLER_2D_SHADOW: return (texture) => {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.uniform1i(loc, unit)
    }
    case gl.SAMPLER_CUBE_SHADOW: return (texture) => {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture)
      gl.uniform1i(loc, unit)
    }
    default: return () => {}
  }
}

/** @param {string} source */
const numbered = (source) => source.split('\n').map((line, i) => `${String(i + 1).padStart(4)}  ${line}`).join('\n')
