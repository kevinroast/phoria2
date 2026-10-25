// Shader programs, compiled on first use and cached by kind and feature defines.
import { shaderSource } from './shaders.js'

/** @import { ShaderKind } from './shaders.js' */

/**
 * @typedef {object} Program
 * @property {WebGLProgram} program
 * @property {string} key
 * @property {(name: string, value: any) => void} set set a uniform by name (ignored if the shader doesn't use it)
 * @property {number} frame the frame its per-frame uniforms were last set for
 */

export class Programs {
  /** @type {Map<string, Program>} */ #cache = new Map()

  /** @param {WebGL2RenderingContext} gl */
  constructor(gl) {
    this.gl = gl
  }

  get count() {
    return this.#cache.size
  }

  /**
   * @param {ShaderKind | string} kind a drawable kind, or a pass's name when it brings its sources
   * @param {string[]} defines
   * @param {[string, string]} [sources] a pass's vertex and fragment shaders
   * @returns {Program}
   */
  get(kind, defines, sources) {
    const key = `${kind}|${defines.join(',')}`
    let p = this.#cache.get(key)
    if (!p) {
      p = this.#build(key, ...shaderSource(sources ?? /** @type {ShaderKind} */ (kind), defines))
      this.#cache.set(key, p)
    }
    return p
  }

  /** Forget everything - after a lost context. */
  reset() {
    this.#cache.clear()
  }

  dispose() {
    for (const p of this.#cache.values()) this.gl.deleteProgram(p.program)
    this.#cache.clear()
  }

  /** @param {string} key @param {string} vsSource @param {string} fsSource @returns {Program} */
  #build(key, vsSource, fsSource) {
    const gl = this.gl
    const compile = (type, source) => {
      const shader = /** @type {WebGLShader} */ (gl.createShader(type))
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        const log = gl.getShaderInfoLog(shader)
        throw new Error(`phoria2: ${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} shader '${key}' failed to compile:\n${log}\n${numbered(source)}`)
      }
      return shader
    }
    const program = /** @type {WebGLProgram} */ (gl.createProgram())
    const vs = compile(gl.VERTEX_SHADER, vsSource)
    const fs = compile(gl.FRAGMENT_SHADER, fsSource)
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(`phoria2: shader program '${key}' failed to link: ${gl.getProgramInfoLog(program)}`)
    }

    // every active uniform, with a setter for its type; arrays are set from flat typed arrays
    /** @type {Map<string, (value: any) => void>} */
    const setters = new Map()
    const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS)
    let unit = 0
    for (let i = 0; i < n; i++) {
      const info = /** @type {WebGLActiveInfo} */ (gl.getActiveUniform(program, i))
      const name = info.name.replace(/\[0\]$/, '')
      const loc = gl.getUniformLocation(program, info.name)
      const sampler = info.type === gl.SAMPLER_2D || info.type === gl.SAMPLER_2D_SHADOW
      setters.set(name, setterFor(gl, info.type, loc, sampler ? unit++ : 0))
    }
    return {
      program,
      key,
      frame: -1,
      set(name, value) {
        setters.get(name)?.(value)
      },
    }
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
    case gl.FLOAT_MAT3: return (v) => gl.uniformMatrix3fv(loc, false, v)
    case gl.FLOAT_MAT4: return (v) => gl.uniformMatrix4fv(loc, false, v)
    case gl.SAMPLER_2D:
    case gl.SAMPLER_2D_SHADOW: return (texture) => {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.uniform1i(loc, unit)
    }
    default: return () => {}
  }
}

/** @param {string} source */
const numbered = (source) => source.split('\n').map((line, i) => `${String(i + 1).padStart(4)}  ${line}`).join('\n')
