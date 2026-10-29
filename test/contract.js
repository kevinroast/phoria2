// Option contracts: one row per option a class or function takes, so what the library says it
// supports is what the tests check - and an option added without a row, or a row left for an option
// that has gone, fails the suite by name.
import { describe, expect, it } from 'vitest'
import { ChangeWatch } from '../src/watch.js'

/**
 * How one option is checked.
 * @typedef {object} Row
 * @property {any} [value] a value it takes
 * @property {() => any} [fresh] makes the value instead, for one that can't be shared between tests (a node, a spy)
 * @property {(made: any) => any} [read] reads the setting back
 * @property {any} [expect] what read gives for the value, when that isn't the value itself
 * @property {(made: any, value: any) => void} [check] asserts the value took effect, where read and expect can't say it
 * @property {any} [bad] a value it should refuse
 * @property {string} [error] part of the error for bad (default: the option's name)
 * @property {any} [default] what read gives with the option left out
 * @property {string} [gap] a known gap: bad is accepted when it should be refused. The test is expected to
 *   fail - it shows in the run as a known failure, and starts failing for real once the gap is closed
 * @property {string} [only] why taking the value is all that's checked: its effect is out of reach here
 * @property {false} [keep] leave it out of the JSON and clone round trips (functions, live objects)
 * @property {string} [jsonGap] a known gap: the setting is lost through toJSON() - expected to fail until fixed
 * @property {string} [cloneGap] a known gap: the setting is lost through clone() - expected to fail until fixed
 * @property {string} [quiet] why changing it needs no redraw - it doesn't change the picture (a name, user data)
 * @property {(made: any, value: any) => void} [apply] changes it on a live one, where plain assignment can't
 */

/**
 * The contract for something that takes options.
 * @param {string} name
 * @param {object} contract
 * @param {readonly string[]} contract.options the options it takes, from its own list
 * @param {Record<string, string>} [contract.hints] names people reach for, and what to use instead
 * @param {(options: Record<string, any>) => any} contract.make makes one with these options (and whatever else it needs)
 * @param {Record<string, Row>} contract.rows
 * @param {(made: any) => any} [contract.json] makes a new one from what made.toJSON() writes
 * @param {(made: any) => any} [contract.clone]
 * @param {Record<string, string>} [contract.deadHints] known gaps: hints for names it takes, so they never show
 * @param {(made: any) => { scene: any, camera: any }} [contract.watch] puts one in a scene, for checking that changing
 *   each option redraws a view - every option must, or say why not (quiet)
 * @param {(made: any, key: string, value: any) => void} [contract.change] how a live one is changed (default: assign it)
 */
export function contract(name, { options, hints = {}, make, rows, json, clone, deadHints = {}, watch, change }) {
  describe(`${name} options`, () => {
    it('has a row for every option it takes, and none for an option it does not', () => {
      expect(options.filter((o) => !Object.hasOwn(rows, o)), 'options with no row').toEqual([])
      expect(Object.keys(rows).filter((o) => !options.includes(o)), 'rows for options it does not take').toEqual([])
    })

    it('refuses an option it does not know, by name', () => {
      expect(() => make({ notAnOption: 1 })).toThrow('notAnOption')
    })

    const hinted = Object.keys(hints)
    if (hinted.length) {
      it('points names people reach for at the right option', () => {
        for (const key of hinted) if (!deadHints[key]) expect(() => make({ [key]: 1 }), key).toThrow(hints[key])
      })
      it('has no hint for a name it takes - the hint could never show', () => {
        expect(hinted.filter((k) => options.includes(k) && !deadHints[k])).toEqual([])
      })
      for (const [key, reason] of Object.entries(deadHints)) {
        it.fails(`shows its hint for ${key} - known gap: ${reason}`, () => expect(() => make({ [key]: 1 })).toThrow(hints[key]))
      }
    }

    for (const [key, row] of Object.entries(rows)) {
      const has = row.fresh !== undefined || Object.hasOwn(row, 'value')
      const value = () => (row.fresh ? row.fresh() : row.value)
      const verify = (made, v) => {
        if (row.check) row.check(made, v)
        else if (row.read) expect(row.read(made)).toEqual(Object.hasOwn(row, 'expect') ? row.expect : v)
      }
      if (has) {
        it(`takes ${key}${row.only ? ` (${row.only})` : ''}`, () => {
          const v = value()
          verify(make({ [key]: v }), v)
        })
        if (row.keep !== false && (row.read || row.check)) {
          if (json) (row.jsonGap ? it.fails : it)(`keeps ${key} through toJSON()${row.jsonGap ? ` - known gap: ${row.jsonGap}` : ''}`, () => {
            const v = value()
            verify(json(make({ [key]: v })), v)
          })
          if (clone) (row.cloneGap ? it.fails : it)(`keeps ${key} through clone()${row.cloneGap ? ` - known gap: ${row.cloneGap}` : ''}`, () => {
            const v = value()
            verify(clone(make({ [key]: v })), v)
          })
        }
      }
      if (watch && has && !row.quiet) {
        it(`redraws a view when ${key} changes`, () => {
          const made = make({})
          const { scene, camera } = watch(made)
          const watcher = new ChangeWatch()
          watcher.changed(scene, camera)
          expect(watcher.changed(scene, camera), 'settled').toBe(false)
          const v = value()
          if (row.apply) row.apply(made, v)
          else if (change) change(made, key, v)
          else made[key] = v
          expect(watcher.changed(scene, camera), `${key} changed and a view wouldn't redraw`).toBe(true)
        })
      }
      if (Object.hasOwn(row, 'default')) {
        it(`defaults ${key}`, () => expect(/** @type {(m: any) => any} */ (row.read)(make({}))).toEqual(row.default))
      }
      if (Object.hasOwn(row, 'bad')) {
        const test = row.gap ? it.fails : it
        test(`refuses a bad ${key}${row.gap ? ` - known gap: ${row.gap}` : ''}`, () => {
          expect(() => make({ [key]: row.bad })).toThrow(row.error ?? key)
        })
      }
    }
  })
}

/** A float array or vector read back, rounded so float32 noise doesn't fail an equality. @param {ArrayLike<number>} v */
export const rounded = (v) => Array.from(v, (x) => Math.round(x * 1e4) / 1e4)
