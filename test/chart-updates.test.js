// A chart update keeps its frame, title and legend when nothing they show changed (Chart.js
// #frameKey, #titleKey, #legendKey; axes.js frameKey), and makes them again when anything they show
// did - a test here for each. And a colour by category is worked out once for all its rows.
import { afterAll, describe, expect, it } from 'vitest'
import { chart } from '../src/charts/index.js'
import { fakePage } from './fakes.js'

const page = fakePage()
afterAll(() => page.restore())

/** Nine bars, three regions by three months; k shuffles the sales within 10-22, scale multiplies them. */
const rows = (k = 0, scale = 1) => ['North', 'South', 'East'].flatMap((region, r) => ['Jan', 'Feb', 'Mar']
  .map((month, m) => ({ id: region + month, region, month, sales: (10 + ((m * 7 + r * 3 + k) % 13)) * scale })))

const make = (extra = {}) => /** @type {any} */ (chart({ mark: 'bar', data: rows(), x: 'month', z: 'region', y: 'sales', color: 'region', title: 'Sales', transition: false, ...extra }))
const frameOf = (c) => c.children.find((n) => n.name === 'axes') ?? null
const titleOf = (c) => c.children.find((n) => n.isLabel && n.className?.includes('phoria-axis-title')) ?? null

describe('a chart update', () => {
  it('keeps the frame, title and legend when it changes none of them', () => {
    const c = make()
    const frame = frameOf(c), title = titleOf(c), legend = c.overlay
    expect([frame, title, legend].every(Boolean)).toBe(true)
    const domain = c.scales.y.domain
    // the same sales, moved between the bars: the marks change, the axis doesn't
    c.update({ data: rows().map((r, i, all) => ({ ...r, sales: all[all.length - 1 - i].sales })) })
    expect(c.scales.y.domain).toEqual(domain)
    expect(frameOf(c)).toBe(frame)
    expect(titleOf(c)).toBe(title)
    expect(c.overlay).toBe(legend)
  })

  it('makes the frame again for anything it shows changing', () => {
    const c = make()
    /** @type {[string, object][]} */
    const changes = [
      ['y axis range', { data: rows(0, 10) }],
      // its ticks as they were: only that it is hidden differs
      ['an axis hidden', { y: { field: 'sales', axis: false } }],
      ['an axis shown again', { y: 'sales' }],
      ['a new category along x', { data: [...rows(), { id: 'NorthApr', region: 'North', month: 'Apr', sales: 12 }] }],
      ['an axis title', { y: { field: 'sales', title: 'Revenue' } }],
      ['tick text', { y: { field: 'sales', title: 'Revenue', format: { style: 'currency', currency: 'USD' } } }],
      ['tick count', { y: { field: 'sales', title: 'Revenue', axis: { ticks: 2 } } }],
      ['the theme', { theme: 'light' }],
      ['the box', { box: [6, 3, 4] }],
      ['the overlap rule', { overlap: 'hide' }],
      ['the origin frame', { frame: 'origin' }],
    ]
    for (const [what, change] of changes) {
      const before = frameOf(c)
      c.update(change)
      expect(frameOf(c), what).not.toBe(before)
      expect(frameOf(c), what).not.toBeNull()
    }
    c.update({ frame: false })
    expect(frameOf(c)).toBeNull()
    // and back
    c.update({ frame: true })
    expect(frameOf(c)).not.toBeNull()
  })

  it('makes the title again for its text, the box or the theme - and drops it when it goes', () => {
    const c = make()
    for (const change of [{ title: 'Revenue' }, { box: [6, 3, 4] }, { theme: 'light' }]) {
      const before = titleOf(c)
      c.update(change)
      expect(titleOf(c)).not.toBe(before)
    }
    const kept = titleOf(c)
    c.update({ data: rows(3) })
    expect(titleOf(c)).toBe(kept)
    c.update({ title: undefined })
    expect(titleOf(c)).toBeNull()
  })

  it('makes the legend again for its colours, title, place or theme', () => {
    const c = make()
    /** @type {object[]} */
    const changes = [
      { data: [...rows(), { id: 'WestJan', region: 'West', month: 'Jan', sales: 12 }] },
      { color: { field: 'region', title: 'Area' } },
      { color: { field: 'region', title: 'Area', scale: { range: ['#ff0000', '#00ff00', '#0000ff', '#ffff00'] } } },
      { legend: { position: 'bottom-left' } },
      { theme: 'light' },
    ]
    for (const change of changes) {
      const before = c.overlay
      c.update(change)
      expect(c.overlay).not.toBe(before)
    }
    c.update({ legend: false })
    expect(c.overlay).toBeNull()
  })
})

describe('a chart coloured by category', () => {
  it("gives every row its category's colour, the same as the scale's, through updates", () => {
    const c = make()
    const check = () => {
      const bars = c.marks.find((m) => m.instanceColors)
      for (let i = 0; i < bars.count; i++) {
        const expected = c.scales.color(bars.data[i].region)
        for (let k = 0; k < 3; k++) expect(bars.instanceColors[i * 3 + k]).toBeCloseTo(expected[k], 5)
      }
    }
    check()
    // a new category takes the next colour; the old ones keep theirs
    c.update({ data: [...rows(2), { id: 'WestJan', region: 'West', month: 'Jan', sales: 12 }] })
    check()
  })
})

describe('a chart coloured by a number', () => {
  it("gives every row its own colour along the ramp, the same as the scale's", () => {
    const c = make({ color: 'sales' })
    const bars = c.marks.find((m) => m.instanceColors)
    const colours = new Set()
    for (let i = 0; i < bars.count; i++) {
      const expected = c.scales.color(bars.data[i].sales)
      for (let k = 0; k < 3; k++) expect(bars.instanceColors[i * 3 + k]).toBeCloseTo(expected[k], 5)
      colours.add(Array.from(bars.instanceColors.subarray(i * 3, i * 3 + 3)).join())
    }
    expect(colours.size).toBeGreaterThan(3)
  })
})
