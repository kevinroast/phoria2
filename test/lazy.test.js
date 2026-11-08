// Code loaded on first use: once, however often it's wanted - and when it can't load, said once and
// tried again a little later, never left silently missing.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lazy } from '../src/lazy.js'

afterEach(() => vi.restoreAllMocks())
const settle = () => new Promise((r) => setTimeout(r, 0))

describe('lazy()', () => {
  it('imports once, and hands the module on to the first want only', async () => {
    const importer = vi.fn(async () => ({ value: 42 }))
    const load = lazy('a feature', importer)
    const got = []
    load((m) => got.push(m.value))
    load((m) => got.push(m.value))
    await settle()
    load((m) => got.push(m.value))
    expect(importer).toHaveBeenCalledTimes(1)
    expect(got).toEqual([42])
  })

  it('says, once, when the code fails to load - then tries again after a pause, not at every want', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    let fail = true
    const importer = vi.fn(async () => {
      if (fail) throw new Error('Failed to fetch dynamically imported module')
      return { ok: true }
    })
    const load = lazy('bloom', importer)
    const got = []
    load((m) => got.push(m))
    await settle()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain("bloom: its code couldn't be loaded (Failed to fetch dynamically imported module)")
    // wanted again at once - each frame, say: no new request, no new warning
    now += 100
    load((m) => got.push(m))
    await settle()
    expect([importer.mock.calls.length, warn.mock.calls.length]).toEqual([1, 1])
    // a few seconds on, tried again - and this time it loads
    now += 5000
    fail = false
    load((m) => got.push(m))
    await settle()
    expect(importer).toHaveBeenCalledTimes(2)
    expect(got).toEqual([{ ok: true }])
  })
})
