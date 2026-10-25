import { vec4 } from 'gl-matrix'
import { vec4FromXYZ } from '../math.js'

// Mixin for entities that represent a position in the scene without necessarily being rendered
// (lights, emitters, physics objects). After scene processing `worldposition` holds the position
// transformed into world space - check it is not null before use.
export const Positional = (Base) => class extends Base {
  // {x,y,z} position in local space
  position = { x: 0, y: 0, z: 0 }
  // vec4 transformed world position, updated each frame
  worldposition = null

  updatePosition(matLocal) {
    const vec = vec4FromXYZ(this.position, 1)
    if (matLocal) vec4.transformMat4(vec, vec, matLocal)
    this.worldposition = vec
  }
}
