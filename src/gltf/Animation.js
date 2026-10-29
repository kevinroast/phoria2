// glTF node animations: keyframed position, rotation and scale, played by the scene clock through
// the model's onUpdate, so they pause and run with the View like everything else.
import * as quat from '../math/quat.js'

/** @import { Node } from '../scene/Node.js' */

/**
 * One animated property of one node.
 * @typedef {object} Track
 * @property {Node} node
 * @property {'position' | 'quaternion' | 'scale'} path
 * @property {Float32Array} times seconds, ascending
 * @property {Float32Array} values per key: 3 numbers (4 for rotation); cubic splines store in-tangent, value, out-tangent
 * @property {'LINEAR' | 'STEP' | 'CUBICSPLINE'} interpolation
 */

/** A named clip from a model: play(), stop(), and a few settings. */
export class Animation {
  /** @type {string} */ name
  /** Seconds. @type {number} */ duration
  /** @type {Track[]} */ tracks
  /** Seconds into the clip. */
  time = 0
  /** 1 = as authored; 2 = twice as fast; negative plays backwards. */
  speed = 1
  /** Start again at the end (default), or stop on the last frame. */
  loop = true
  playing = false

  /** @param {string} name @param {Track[]} tracks */
  constructor(name, tracks) {
    this.name = name
    this.tracks = tracks
    this.duration = tracks.reduce((d, t) => Math.max(d, t.times[t.times.length - 1] ?? 0), 0)
  }

  /** Start (or carry on) playing - from the start again, for a clip that doesn't loop and has finished. @returns {this} */
  play() {
    if (!this.loop && this.duration) {
      // at the end it is heading for: start over (from the end, playing backwards)
      if (this.speed >= 0 && this.time >= this.duration) this.seek(0)
      else if (this.speed < 0 && this.time <= 0) this.seek(this.duration)
    }
    this.playing = true
    return this
  }

  /** Pause where it is. @returns {this} */
  pause() {
    this.playing = false
    return this
  }

  /** Stop and go back to the first frame. @returns {this} */
  stop() {
    this.playing = false
    this.seek(0)
    return this
  }

  /** Jump to a time, in seconds, and pose the nodes there. @param {number} t @returns {this} */
  seek(t) {
    this.time = t
    this.apply()
    return this
  }

  /** @internal Advance by dt seconds when playing. @param {number} dt */
  advance(dt) {
    if (!this.playing) return
    // a clip of one key is a pose: hold it
    if (!this.duration) {
      this.apply()
      return
    }
    let t = this.time + dt * this.speed
    if (this.loop) t = ((t % this.duration) + this.duration) % this.duration
    else if (this.speed >= 0 ? t >= this.duration : t <= 0) {
      // it has run off the end it is heading for - not the one it starts at, as on the first frame
      t = Math.min(Math.max(t, 0), this.duration)
      this.playing = false
    }
    this.seek(t)
  }

  /** Pose every animated node for the current time. */
  apply() {
    for (const track of this.tracks) sample(track, this.time)
  }
}

const scratch = new Float32Array(4)

/** @param {Track} track @param {number} t */
function sample(track, t) {
  const { times, values, node, path, interpolation } = track
  const size = path === 'quaternion' ? 4 : 3
  const cubic = interpolation === 'CUBICSPLINE'
  // values per key: cubic splines hold [in-tangent, value, out-tangent]
  const stride = cubic ? size * 3 : size
  const at = (/** @type {number} */ k) => (cubic ? k * stride + size : k * stride)
  const last = times.length - 1
  const out = scratch
  if (t <= times[0] || last === 0) {
    for (let i = 0; i < size; i++) out[i] = values[at(0) + i]
  } else if (t >= times[last]) {
    for (let i = 0; i < size; i++) out[i] = values[at(last) + i]
  } else {
    // binary search for the key at or before t
    let lo = 0, hi = last
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (times[mid] <= t) lo = mid
      else hi = mid
    }
    const t0 = times[lo], t1 = times[hi], dt = t1 - t0
    const u = dt > 0 ? (t - t0) / dt : 0
    if (interpolation === 'STEP') {
      for (let i = 0; i < size; i++) out[i] = values[at(lo) + i]
    } else if (cubic) {
      // Hermite: p0, out-tangent of the first key, in-tangent of the second, p1
      const u2 = u * u, u3 = u2 * u
      const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2
      const a = lo * stride, b = hi * stride
      for (let i = 0; i < size; i++) {
        out[i] = h00 * values[a + size + i] + h10 * dt * values[a + size * 2 + i] + h01 * values[b + size + i] + h11 * dt * values[b + i]
      }
      if (size === 4) quat.normalize(out, out)
    } else if (size === 4) {
      quat.slerp(out, values.subarray(lo * 4, lo * 4 + 4), values.subarray(hi * 4, hi * 4 + 4), u)
    } else {
      for (let i = 0; i < 3; i++) out[i] = values[lo * 3 + i] + (values[hi * 3 + i] - values[lo * 3 + i]) * u
    }
  }
  if (path === 'quaternion') node.quaternion.set(out[0], out[1], out[2], out[3])
  else node[path].set(out[0], out[1], out[2])
}
