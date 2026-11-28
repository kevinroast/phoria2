// glTF animations: keyframed position, rotation and scale of nodes, and the weights of meshes' blend
// shapes, played by the scene clock through the model's onUpdate, so they pause and run with the View
// like everything else. Clips playing together are mixed by weight - a crossfade eases one out as
// another comes in - and what weight is left over goes to the pose the model was loaded in.
import * as quat from '../math/quat.js'

/** @import { Node } from '../scene/Node.js' */

/**
 * One animated property: a node's position, rotation or scale, or a mesh's morph weights.
 * @typedef {object} Track
 * @property {Node} node
 * @property {'position' | 'quaternion' | 'scale' | 'weights'} path
 * @property {Float32Array | null} weights the morph weights it sets, for path 'weights' - shared by the node's mesh parts
 * @property {Float32Array} times seconds, ascending
 * @property {Float32Array} values per key: 3 numbers (4 for rotation, one a target for weights); cubic
 *   splines store in-tangent, value, out-tangent
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
  /** @internal How much of the pose it gives when clips are mixed, 0-1 - eased by a fade. */
  weight = 1
  /** @internal A fade under way: the weight it goes from and to, over how long, how far in, and whether it stops at the end. @type {{ from: number, to: number, duration: number, elapsed: number, stop: boolean } | null} */
  fade = null

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
    this.fade = null
    this.weight = 1
    this.seek(0)
    return this
  }

  /** Jump to a time, in seconds, and pose the nodes there. @param {number} t @returns {this} */
  seek(t) {
    this.time = t
    this.apply()
    return this
  }

  /**
   * @internal Ease this clip's weight to `to` over `seconds` - and stop it once it gets there, when
   * `stop`. No time: at once.
   * @param {number} to @param {number} seconds @param {boolean} [stop]
   */
  fadeTo(to, seconds, stop = false) {
    if (seconds > 0) {
      this.fade = { from: this.weight, to, duration: seconds, elapsed: 0, stop }
      return
    }
    this.fade = null
    if (stop) {
      this.playing = false
      this.time = 0
      this.weight = 1
    } else this.weight = to
  }

  /** @internal Advance by dt seconds when playing, and pose the nodes there - this clip alone. @param {number} dt */
  advance(dt) {
    if (!this.playing) return
    this.step(dt)
    this.apply()
  }

  /** @internal Advance by dt seconds when playing - its time and any fade - leaving the posing to mix(). @param {number} dt */
  step(dt) {
    if (!this.playing) return
    if (this.fade) {
      const f = this.fade
      f.elapsed += dt
      const u = Math.min(1, f.elapsed / f.duration)
      this.weight = f.from + (f.to - f.from) * u
      if (u >= 1) {
        this.fade = null
        if (f.stop) {
          // faded right out: stopped, ready to play again at full weight, its last pose left to the rest
          this.playing = false
          this.time = 0
          this.weight = 1
          return
        }
      }
    }
    // a clip of one key is a pose: hold it
    if (!this.duration) return
    let t = this.time + dt * this.speed
    if (this.loop) t = ((t % this.duration) + this.duration) % this.duration
    else if (this.speed >= 0 ? t >= this.duration : t <= 0) {
      // it has run off the end it is heading for - not the one it starts at, as on the first frame -
      // and stops there, posed on its last frame now, as the mix leaves out what isn't playing
      this.time = Math.min(Math.max(t, 0), this.duration)
      this.playing = false
      this.apply()
      return
    }
    this.time = t
  }

  /** @internal Pose every animated node for the current time - this clip alone, at full weight. */
  apply() {
    for (const track of this.tracks) write(track, sample(track, this.time))
  }
}

/** How many numbers a track's property has. @param {Track} track */
const sizeOf = (track) => (track.path === 'weights' ? /** @type {Float32Array} */ (track.weights).length : track.path === 'quaternion' ? 4 : 3)

/** Scratch for one sample, grown for blend shapes with many targets. */
let scratch = new Float32Array(4)

/**
 * A track's value at a time, into a scratch array - valid until the next sample.
 * @param {Track} track @param {number} t
 * @returns {Float32Array}
 */
function sample(track, t) {
  const { times, values, interpolation } = track
  const size = sizeOf(track)
  if (scratch.length < size) scratch = new Float32Array(size)
  const out = scratch
  const cubic = interpolation === 'CUBICSPLINE'
  // values per key: cubic splines hold [in-tangent, value, out-tangent]
  const stride = cubic ? size * 3 : size
  const at = (/** @type {number} */ k) => (cubic ? k * stride + size : k * stride)
  const last = times.length - 1
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
      if (track.path === 'quaternion') quat.normalize(out, out)
    } else if (track.path === 'quaternion') {
      quat.slerp(out, values.subarray(lo * 4, lo * 4 + 4), values.subarray(hi * 4, hi * 4 + 4), u)
    } else {
      for (let i = 0; i < size; i++) out[i] = values[lo * size + i] + (values[hi * size + i] - values[lo * size + i]) * u
    }
  }
  return out
}

/** Set a track's property to a value. @param {Track} track @param {ArrayLike<number>} v */
function write(track, v) {
  const { node, path } = track
  if (path === 'weights') /** @type {Float32Array} */ (track.weights).set(Array.prototype.slice.call(v, 0, /** @type {Float32Array} */ (track.weights).length))
  else if (path === 'quaternion') node.quaternion.set(v[0], v[1], v[2], v[3])
  else node[path].set(v[0], v[1], v[2])
}

/** The thing a track animates, so tracks of different clips on the same property meet: the weights, or the node's property. @param {Track} track */
const targetOf = (track) => (track.path === 'weights' ? track.weights : track.node[track.path])

/**
 * A model's rest pose: every animated property as it was loaded, for mixing to fill what the clips'
 * weights leave over - a clip fading in from nothing starts from it.
 * @param {Animation[]} animations
 * @returns {Map<object, Float32Array>}
 */
export function restPose(animations) {
  /** @type {Map<object, Float32Array>} */
  const rest = new Map()
  for (const a of animations) {
    for (const track of a.tracks) {
      const target = targetOf(track)
      if (rest.has(target)) continue
      const { node, path } = track
      rest.set(target, path === 'weights' ? Float32Array.from(/** @type {Float32Array} */ (track.weights))
        : path === 'quaternion' ? Float32Array.from([node.quaternion.x, node.quaternion.y, node.quaternion.z, node.quaternion.w])
          : Float32Array.from([node[path].x, node[path].y, node[path].z]))
    }
  }
  return rest
}

/**
 * Pose a model from the clips playing: one at full weight writes its values as they are; more, or one
 * fading, are mixed - each property the weighted sum of the clips that animate it, with what weight
 * is left over (when they add up to less than 1) given to its rest pose.
 * @param {Animation[]} animations @param {Map<object, Float32Array>} rest
 */
export function mix(animations, rest) {
  /** @type {Animation[]} */
  const active = []
  for (const a of animations) if (a.playing && a.weight > 0) active.push(a)
  if (!active.length) return
  if (active.length === 1 && active[0].weight >= 1) {
    active[0].apply()
    return
  }
  /** @type {Map<object, { track: Track, sum: Float64Array, weight: number }>} */
  const blends = new Map()
  for (const a of active) {
    for (const track of a.tracks) {
      const target = targetOf(track)
      const v = sample(track, a.time), size = sizeOf(track)
      let b = blends.get(target)
      if (!b) blends.set(target, b = { track, sum: new Float64Array(size), weight: 0 })
      // quaternions q and -q are the same turn: add each on the same side as the first, or they cancel
      const flip = track.path === 'quaternion' && b.weight > 0 && b.sum[0] * v[0] + b.sum[1] * v[1] + b.sum[2] * v[2] + b.sum[3] * v[3] < 0 ? -1 : 1
      for (let i = 0; i < size; i++) b.sum[i] += a.weight * flip * v[i]
      b.weight += a.weight
    }
  }
  for (const [target, b] of blends) {
    const { track, sum } = b
    const left = 1 - b.weight, base = rest.get(target)
    if (left > 0 && base) {
      const flip = track.path === 'quaternion' && sum[0] * base[0] + sum[1] * base[1] + sum[2] * base[2] + sum[3] * base[3] < 0 ? -1 : 1
      for (let i = 0; i < sum.length; i++) sum[i] += left * flip * base[i]
    } else if (b.weight > 0) for (let i = 0; i < sum.length; i++) sum[i] /= b.weight
    if (track.path === 'quaternion') {
      const l = Math.hypot(sum[0], sum[1], sum[2], sum[3]) || 1
      for (let i = 0; i < 4; i++) sum[i] /= l
    }
    write(track, sum)
  }
}
