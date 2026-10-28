// glTF animation playback: how each kind of keyframe is sampled, and how clips run over time.
import { describe, expect, it } from 'vitest'
import { Group } from '../src/index.js'
import { Animation } from '../src/gltf/index.js'

const round = (v) => Array.from(v, (x) => Math.round(x * 1e4) / 1e4)
/** A track moving a node's position from (0, 0, 0) at 0 s to (0, 4, 0) at 2 s, by an interpolation. */
const rise = (interpolation = 'LINEAR') => {
  const node = new Group()
  const values = interpolation === 'CUBICSPLINE'
    // per key: in-tangent, value, out-tangent - flat tangents, so it eases in and out
    ? new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0])
    : new Float32Array([0, 0, 0, 0, 4, 0])
  return { node, clip: new Animation('Rise', [{ node, path: 'position', times: new Float32Array([0, 2]), values, interpolation }]) }
}
const s = Math.SQRT1_2

describe('keyframes', () => {
  it('blend straight between keys with LINEAR, and hold the first and last keys outside them', () => {
    const { node, clip } = rise()
    expect(clip.duration).toBe(2)
    clip.seek(0.5)
    expect(round(node.position)).toEqual([0, 1, 0])
    clip.seek(-1)
    expect(round(node.position)).toEqual([0, 0, 0])
    clip.seek(5)
    expect(round(node.position)).toEqual([0, 4, 0])
  })

  it('hold each key until the next with STEP', () => {
    const { node, clip } = rise('STEP')
    clip.seek(1.99)
    expect(round(node.position)).toEqual([0, 0, 0])
    clip.seek(2)
    expect(round(node.position)).toEqual([0, 4, 0])
  })

  it('ease along a Hermite curve with CUBICSPLINE', () => {
    const { node, clip } = rise('CUBICSPLINE')
    // flat tangents: smoothstep, so half way is half way and a quarter is 0.15625 of it
    clip.seek(1)
    expect(round(node.position)).toEqual([0, 2, 0])
    clip.seek(0.5)
    expect(round(node.position)).toEqual([0, 0.625, 0])
  })

  it('turn rotations the short way round at an even speed, and keep them unit length', () => {
    const node = new Group()
    // a quarter turn about y
    const clip = new Animation('Turn', [{ node, path: 'quaternion', times: new Float32Array([0, 1]), values: new Float32Array([0, 0, 0, 1, 0, s, 0, s]), interpolation: 'LINEAR' }])
    clip.seek(0.5)
    expect(round(node.quaternion)).toEqual(round([0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8)]))
    const cubic = new Animation('Turn', [{
      node, path: 'quaternion', times: new Float32Array([0, 1]), interpolation: 'CUBICSPLINE',
      values: new Float32Array([0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, s, 0, s, 0, 0, 0, 0]),
    }])
    cubic.seek(0.3)
    expect(Math.round(Math.hypot(...node.quaternion) * 1e6) / 1e6).toBe(1)
  })

  it('scale too, and take their length from the longest track', () => {
    const node = new Group()
    const clip = new Animation('Grow', [
      { node, path: 'scale', times: new Float32Array([0, 1]), values: new Float32Array([1, 1, 1, 3, 3, 3]), interpolation: 'LINEAR' },
      { node, path: 'position', times: new Float32Array([0, 4]), values: new Float32Array([0, 0, 0, 8, 0, 0]), interpolation: 'LINEAR' },
    ])
    expect(clip.duration).toBe(4)
    clip.seek(0.5)
    expect(round(node.scale)).toEqual([2, 2, 2])
    expect(round(node.position)).toEqual([1, 0, 0])
  })
})

describe('clips over time', () => {
  it('advance only while playing, and pause where they are', () => {
    const { node, clip } = rise()
    clip.advance(0.5)
    expect(clip.time).toBe(0)
    clip.play().advance(0.5)
    expect(clip.time).toBe(0.5)
    expect(round(node.position)).toEqual([0, 1, 0])
    clip.pause().advance(0.5)
    expect(clip.time).toBe(0.5)
    expect(clip.playing).toBe(false)
  })

  it('go round again when they loop - forwards, faster, or backwards', () => {
    const { clip } = rise()
    clip.play().advance(2.5)
    expect(clip.time).toBe(0.5)
    clip.speed = 2
    clip.advance(1)
    expect(clip.time).toBe(0.5)
    clip.speed = -1
    clip.advance(1)
    expect(clip.time).toBe(1.5)
    expect(clip.playing).toBe(true)
  })

  it('stop on the last frame when they do not loop, and stop() goes back to the first', () => {
    const { node, clip } = rise()
    clip.loop = false
    clip.play().advance(3)
    expect([clip.time, clip.playing]).toEqual([2, false])
    expect(round(node.position)).toEqual([0, 4, 0])
    clip.stop()
    expect(clip.time).toBe(0)
    expect(round(node.position)).toEqual([0, 0, 0])
  })

  it('play again from the start once a clip that does not loop has finished - or from the end, playing backwards', () => {
    const { node, clip } = rise()
    clip.loop = false
    clip.play().advance(3)
    clip.play().advance(0.5)
    expect([clip.time, clip.playing]).toEqual([0.5, true])
    expect(round(node.position)).toEqual([0, 1, 0])
    // paused part way, play() carries on from there
    clip.pause().play().advance(0.5)
    expect(clip.time).toBe(1)
    clip.speed = -1
    clip.advance(2)
    expect([clip.time, clip.playing]).toEqual([0, false])
    clip.play().advance(0.5)
    expect([clip.time, clip.playing]).toEqual([1.5, true])
  })

  it('do nothing when they have no length', () => {
    const node = new Group()
    const clip = new Animation('Still', [{ node, path: 'position', times: new Float32Array([0]), values: new Float32Array([1, 2, 3]), interpolation: 'LINEAR' }])
    clip.play().advance(1)
    expect(clip.time).toBe(0)
    clip.seek(0)
    expect(round(node.position)).toEqual([1, 2, 3])
  })
})
