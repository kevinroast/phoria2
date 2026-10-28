// A timeline of named steps played one after another - for stories, explainers and guided tours.
// Each step is a function given its own progress (0 before it starts, 0-1 while it plays, 1 once
// it's done), every frame. Steps set the scene from their progress rather than nudging it, so
// seeking, stepping back and looping always leave the scene right.

import { checkNumber, checkOptions, describe, fail } from '../validate.js'
import { EASES } from './ease.js'

/** @import { EaseName } from './ease.js' */

/**
 * @typedef {object} StepOptions
 * @property {string} [label] what the step shows, for captions - timeline.label is the current one
 * @property {EaseName | ((t: number) => number)} [ease] how progress runs through the step, default 'linear'
 */

/**
 * @typedef {object} TimelineOptions
 * @property {boolean} [loop] start again at the end, default false
 * @property {number} [speed] 1 is real time, default 1
 */

/** @typedef {{ start: number, duration: number, run: (t: number) => void, label: string, ease: (t: number) => number }} Step */

/**
 * Steps played in order, each a function of its progress.
 *
 *     const story = new Timeline({ loop: true })
 *     story.add(3, (t) => follow(rocket, ascent, t), { label: 'Launch' })
 *     story.add(2, (t) => { capsule.visible = t > 0 }, { label: 'Separation' })
 *     view.start((dt) => story.update(dt))
 */
const OPTIONS = ['loop', 'speed']
const HINTS = { repeat: "use 'loop: true'", autoplay: 'a timeline plays from the start - call pause() to hold it' }
/** What add() takes, and hints for names people reach for instead. */
export const STEP_OPTIONS = ['label', 'ease']
export const STEP_HINTS = { name: "use 'label'", easing: "use 'ease'" }

export class Timeline {
  /** The options it takes, and hints for names people reach for instead. */
  static OPTIONS = OPTIONS
  static HINTS = HINTS
  /** @type {Step[]} */ #steps = []
  #time = 0
  #playing = true
  #current = -1
  /** @type {((index: number, label: string) => void)[]} */ #onStep = []
  loop = false
  speed = 1

  /** @param {TimelineOptions} [options] */
  constructor(options = {}) {
    checkOptions('Timeline', options, OPTIONS, HINTS)
    if (options.loop !== undefined) this.loop = !!options.loop
    if (options.speed !== undefined) this.speed = checkNumber('Timeline', 'speed', options.speed)
  }

  /**
   * Add a step after the last one.
   * @param {number} duration seconds; 0 for an instant change
   * @param {(t: number) => void} run called every frame with this step's progress, 0-1
   * @param {StepOptions} [options]
   * @returns {this}
   */
  add(duration, run, options = {}) {
    checkNumber('Timeline.add()', 'duration', duration)
    if (duration < 0) fail('Timeline.add()', `'duration' is seconds, 0 or more, got ${duration}`)
    if (typeof run !== 'function') fail('Timeline.add()', `takes (duration, (t) => { ... }), got ${describe(run)} for the step`)
    checkOptions('Timeline.add()', options, STEP_OPTIONS, STEP_HINTS)
    const ease = typeof options.ease === 'function' ? options.ease : EASES[options.ease ?? 'linear']
    if (!ease) fail('Timeline.add()', `ease '${options.ease}' - expected ${Object.keys(EASES).map((e) => `'${e}'`).join(', ')}, or a function`)
    this.#steps.push({ start: this.duration, duration, run, label: options.label ?? '', ease })
    this.#apply()
    return this
  }

  /** Total length in seconds. */
  get duration() {
    const last = this.#steps[this.#steps.length - 1]
    return last ? last.start + last.duration : 0
  }

  /** Seconds since the start. */
  get time() {
    return this.#time
  }

  /** The step playing now, by index - -1 before any are added. */
  get step() {
    return this.#current
  }

  /** The label of the step playing now. */
  get label() {
    return this.#steps[this.#current]?.label ?? ''
  }

  /** The steps, in order, with their start times and labels. */
  get steps() {
    return this.#steps.map(({ start, duration, label }) => ({ start, duration, label }))
  }

  get playing() {
    return this.#playing
  }

  /** @returns {this} */
  play() {
    if (this.#time >= this.duration && !this.loop) this.#time = 0
    this.#playing = true
    return this
  }

  /** @returns {this} */
  pause() {
    this.#playing = false
    return this
  }

  /**
   * Jump to a time in seconds, setting the scene to match.
   * @param {number} time @returns {this}
   */
  seek(time) {
    this.#time = Math.min(this.duration, Math.max(0, checkNumber('Timeline.seek()', 'time', time)))
    this.#apply()
    return this
  }

  /**
   * Jump to the start of a step, by index or label.
   * @param {number | string} step @returns {this}
   */
  seekStep(step) {
    const i = typeof step === 'string' ? this.#steps.findIndex((s) => s.label === step) : step
    const target = this.#steps[i]
    if (!target) fail('Timeline.seekStep()', `no step ${describe(step)} - there are ${this.#steps.length}${typeof step === 'string' ? `: ${this.#steps.map((s) => `'${s.label}'`).join(', ')}` : ''}`)
    return this.seek(target.start)
  }

  /**
   * Call with the step playing now, and again whenever it changes: (index, label). Called straight
   * away too, so a caption set up after the steps starts right.
   * @param {(index: number, label: string) => void} fn @returns {this}
   */
  onStep(fn) {
    if (typeof fn !== 'function') fail('Timeline.onStep()', `takes (index, label) => { ... }, got ${describe(fn)}`)
    this.#onStep.push(fn)
    if (this.#current >= 0) fn(this.#current, this.label)
    return this
  }

  /**
   * Move time on by dt seconds (while playing) and set the scene - call every frame.
   * @param {number} dt @returns {this}
   */
  update(dt) {
    if (this.#playing && this.#steps.length) {
      let t = this.#time + dt * this.speed
      if (t >= this.duration) {
        if (this.loop && this.duration > 0) t %= this.duration
        else {
          t = this.duration
          this.#playing = false
        }
      }
      this.#time = t
    }
    this.#apply()
    return this
  }

  // set every step from the time: later steps back to their start, latest first, then each step
  // up to now in order - so whatever a step controls ends up as the latest one to touch it says
  #apply() {
    const steps = this.#steps, now = this.#time
    let current = steps.length - 1
    for (let i = 0; i < steps.length; i++) {
      if (now < steps[i].start + steps[i].duration || (steps[i].duration === 0 && now <= steps[i].start)) {
        current = i
        break
      }
    }
    for (let i = steps.length - 1; i > current; i--) steps[i].run(0)
    for (let i = 0; i <= current; i++) {
      const s = steps[i]
      const raw = s.duration > 0 ? Math.min(1, Math.max(0, (now - s.start) / s.duration)) : (now >= s.start ? 1 : 0)
      s.run(s.ease(raw))
    }
    if (current !== this.#current) {
      this.#current = current
      for (const fn of this.#onStep) fn(current, steps[current]?.label ?? '')
    }
  }
}
