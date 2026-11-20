// The render state the scene's draws set - program, depth, culling, winding, blending, polygon offset
// - remembered, so a draw sends only what differs from the last. Two thousand meshes of one material
// each set the same depth mask, culling and offset; this sends them once. It knows only what went
// through it: the renderer calls reset() before each run of draws, after anything that sets state
// directly (passes, effects, the clip-cap stencil, picking) - and a lost context starts it again.

export class GLState {
  /** @param {WebGL2RenderingContext} gl */
  constructor(gl) {
    this.gl = gl
    this.reset()
  }

  /** Forget everything: the next of each call is sent. */
  reset() {
    /** @type {WebGLProgram | null | undefined} */ this.program = undefined
    /** @type {boolean | undefined} */ this.depthWrite = undefined
    /** @type {Map<number, boolean>} capabilities on or off */ this.caps = new Map()
    /** @type {number | undefined} */ this.cull = undefined
    /** @type {number | undefined} */ this.winding = undefined
    /** @type {number | undefined} */ this.blendSource = undefined
    /** @type {number | undefined} */ this.blendDest = undefined
    /** @type {number | undefined} */ this.offsetFactor = undefined
    /** @type {number | undefined} */ this.offsetUnits = undefined
  }

  /** @param {WebGLProgram} program */
  useProgram(program) {
    if (program === this.program) return
    this.gl.useProgram(program)
    this.program = program
  }

  /** @param {boolean} on */
  depthMask(on) {
    if (on === this.depthWrite) return
    this.gl.depthMask(on)
    this.depthWrite = on
  }

  /** gl.enable or gl.disable. @param {number} cap @param {boolean} on */
  set(cap, on) {
    if (this.caps.get(cap) === on) return
    if (on) this.gl.enable(cap)
    else this.gl.disable(cap)
    this.caps.set(cap, on)
  }

  /** @param {number} face */
  cullFace(face) {
    if (face === this.cull) return
    this.gl.cullFace(face)
    this.cull = face
  }

  /** @param {number} winding */
  frontFace(winding) {
    if (winding === this.winding) return
    this.gl.frontFace(winding)
    this.winding = winding
  }

  /** @param {number} source @param {number} dest */
  blendFunc(source, dest) {
    if (source === this.blendSource && dest === this.blendDest) return
    this.gl.blendFunc(source, dest)
    this.blendSource = source
    this.blendDest = dest
  }

  /** @param {number} factor @param {number} units */
  polygonOffset(factor, units) {
    if (factor === this.offsetFactor && units === this.offsetUnits) return
    this.gl.polygonOffset(factor, units)
    this.offsetFactor = factor
    this.offsetUnits = units
  }
}
