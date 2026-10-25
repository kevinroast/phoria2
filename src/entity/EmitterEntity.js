import { combine } from '../util.js'
import { BaseEntity } from './BaseEntity.js'
import { Entity } from './Entity.js'
import { PhysicsEntity } from './PhysicsEntity.js'
import { Positional } from './Positional.js'

const jitter = (base, rnd) => ({
  x: base.x + Math.random() * rnd.x - rnd.x * 0.5,
  y: base.y + Math.random() * rnd.y - rnd.y * 0.5,
  z: base.z + Math.random() * rnd.z - rnd.z * 0.5,
})

// Emits particle PhysicsEntity children at a given rate, with randomised start position, velocity
// and lifetime. The emitter itself is not rendered; its style and textures are shared by all its
// particles. onParticle handlers can decorate each particle as it is created.
//
// Description options (defaults):
//   position {0,0,0}, positionRnd {0,0,0}   particle start position and its randomness
//   velocity {0,1,0}, velocityRnd {0,0,0}   particle start velocity and its randomness
//   rate 0                                  particles per second
//   maximum 1000                            particle limit, zero for unlimited
//   lifetime 0, lifetimeRnd 0               particle lifetime in ms, zero for unlimited
//   gravity true                            apply gravity to particles
//   style                                   particle rendering style (see Entity)
//   onParticle function(particle) this = emitter
export class EmitterEntity extends Positional(BaseEntity) {
  positionRnd = { x: 0, y: 0, z: 0 }
  velocity = { x: 0, y: 1, z: 0 }
  velocityRnd = { x: 0, y: 0, z: 0 }
  rate = 0
  maximum = 1000
  lifetime = 0
  lifetimeRnd = 0
  gravity = true
  style = Entity.createStyle({
    drawmode: 'point',
    shademode: 'plain',
    geometrysortmode: 'none',
    linewidth: 5,
    linescale: 2,
  })
  textures = []
  onParticleHandlers = []
  _lastEmitTime = Date.now()

  constructor() {
    super()
    this.onScene(this.emitParticles)
  }

  static create(desc, e = new this()) {
    super.create(desc, e)
    if (desc.position) e.position = desc.position
    if (desc.positionRnd) e.positionRnd = desc.positionRnd
    if (desc.rate) e.rate = desc.rate
    if (desc.maximum) e.maximum = desc.maximum
    if (desc.velocity) e.velocity = desc.velocity
    if (desc.velocityRnd) e.velocityRnd = desc.velocityRnd
    if (desc.lifetime) e.lifetime = desc.lifetime
    if (desc.lifetimeRnd) e.lifetimeRnd = desc.lifetimeRnd
    if (desc.gravity !== undefined) e.gravity = desc.gravity
    if (desc.style) combine(e.style, desc.style)
    if (desc.onParticle) e.onParticle(desc.onParticle)
    return e
  }

  onParticle(fn) {
    this.onParticleHandlers = this.onParticleHandlers.concat(fn)
    return this
  }

  emitParticles(scene, matLocal) {
    this.updatePosition(matLocal)

    // expire particles past their lifetime - assumes every direct child is a particle
    const now = Date.now()
    const { children } = this
    for (let i = children.length - 1; i >= 0; i--) {
      if (children[i]._gravetime && now > children[i]._gravetime) children.splice(i, 1)
    }

    const count = Math.floor((this.rate / 1000) * (now - this._lastEmitTime))
    if (count <= 0) return
    for (let c = 0; c < count && (this.maximum === 0 || children.length < this.maximum); c++) {
      const pos = jitter(this.position, this.positionRnd)
      // construct directly rather than via create() - this is a hot path
      const particle = new PhysicsEntity()
      particle.position = pos
      particle.points = [pos]
      particle.velocity = jitter(this.velocity, this.velocityRnd)
      particle.gravity = this.gravity
      particle.style = this.style
      particle.textures = this.textures
      if (this.lifetime !== 0) {
        particle._gravetime = Math.floor(now + this.lifetime + this.lifetimeRnd * Math.random() - this.lifetimeRnd * 0.5)
      }
      for (const h of this.onParticleHandlers) h.call(this, particle)
      children.push(particle)
    }
    this._lastEmitTime = now
  }
}
