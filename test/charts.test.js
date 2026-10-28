import { describe, expect, it } from 'vitest'
import {
  Geometry, Group, Lines, Mesh, OrthographicCamera, PerspectiveCamera, Raycaster, Scene, box, collect, create,
} from '../src/index.js'
import { Chart, chart, scaleBand, scaleColor, scaleLinear, scaleLog, scaleTime, tickStep } from '../src/charts/index.js'
import { normalise } from '../src/charts/spec.js'

const MONTHS = ['Jan', 'Feb', 'Mar']
const rows = ['North', 'South'].flatMap((region, s) => MONTHS.map((month, m) => ({ id: `${region}-${month}`, month, region, sales: 10 + s * 5 + m })))
const camera = () => new PerspectiveCamera({ position: [12, 10, 16], target: [0, 2, 0], aspect: 1.5 })
/** Advance a scene's clock, as a View does each frame. */
const run = (scene, seconds) => {
  for (let t = 0; t < seconds; t += 1 / 30) scene.update(1 / 30, t)
  scene.updateWorldTree()
}

describe('scales', () => {
  it('maps, inverts and ticks linearly, with nice domains', () => {
    const y = scaleLinear({ domain: [0, 120], range: [0, 6] })
    expect(y(60)).toBe(3)
    expect(y.invert?.(3)).toBe(60)
    expect(y.ticks(5)).toEqual([0, 20, 40, 60, 80, 100, 120])
    expect(scaleLinear({ domain: [0, 117], range: [0, 6], nice: true }).domain).toEqual([0, 120])
    expect(scaleLinear({ domain: [5, 9], zero: true }).domain[0]).toBe(0)
    expect(tickStep(10, 5)).toBe(2)
    expect(scaleLinear({ domain: [0, 50000] }).format(12000)).toMatch(/12K/i)
    expect(scaleLinear({ domain: [0, 1], format: { style: 'percent' } }).format(0.25)).toBe('25%')
  })

  it('bands categories and ticks logs and dates on round boundaries', () => {
    const months = scaleBand({ domain: MONTHS, range: [0, 9], padding: 0.2 })
    expect(months('Feb')).toBe(4.5)
    expect(months.bandwidth).toBeCloseTo(2.4)
    expect(Number.isNaN(months('Dec'))).toBe(true)
    expect(scaleLog({ domain: [1, 1000], range: [0, 3] })(100)).toBeCloseTo(2)
    expect(scaleLog({ domain: [1, 100] }).ticks()).toEqual([1, 2, 5, 10, 20, 50, 100])
    expect(() => scaleLog({ domain: [0, 10] })).toThrow('a log scale needs a domain above 0')
    const t = scaleTime({ domain: ['2026-01-01', '2026-12-31'], range: [0, 12] })
    const ticks = t.ticks(6)
    expect(ticks.every((d) => d.getDate() === 1)).toBe(true)
    expect(t(new Date('2026-07-02'))).toBeCloseTo(6, 0)
  })

  it('colours categories and ramps', () => {
    const status = scaleColor({ domain: ['ok', 'down'], range: ['#00ff00', '#ff0000'] })
    expect(status('down').getStyle()).toBe('#ff0000')
    expect(status.kind).toBe('categorical')
    const heat = scaleColor({ domain: [0, 10], range: ['#000000', '#ffffff'] })
    expect(heat.kind).toBe('sequential')
    expect(heat(10).getStyle()).toBe('#ffffff')
    expect(() => scaleColor({ domain: [0, 1], scheme: /** @type {any} */ ('rainbow') })).toThrow("colour scheme 'rainbow' isn't one we have")
  })
})

describe('chart specs', () => {
  it('accepts flat channels and Vega-Lite nesting, and infers types', () => {
    const flat = normalise({ mark: 'bar', data: rows, x: 'month', y: 'sales', color: 'region' })
    const vega = normalise({ mark: { type: 'bar', tooltip: true }, data: { values: rows },
      encoding: { x: { field: 'month', type: 'nominal' }, y: { field: 'sales', type: 'quantitative' }, color: { field: 'region' } } })
    for (const s of [flat, vega]) {
      expect(s.mark).toBe('bar')
      expect(s.channels.x.type).toBe('nominal')
      expect(s.channels.y.type).toBe('quantitative')
      expect(s.channels.color.field).toBe('region')
    }
    expect(normalise({ mark: 'line', data: [{ t: '2026-01-05', v: 1 }], x: 't', y: 'v' }).channels.x.type).toBe('temporal')
    expect(normalise({ mark: 'point', data: rows, x: 'sales', y: 'sales', color: '#ff8800' }).channels.color.value).toBe('#ff8800')
  })

  it('reads a tooltip field named on its own as its channel does, title and format', () => {
    const s = normalise({ mark: 'bar', data: rows, x: { field: 'month', title: 'Month' }, y: { field: 'sales', format: (v) => `£${v}k` },
      tooltip: ['month', 'sales', 'region', { field: 'month', title: 'When' }] })
    expect(s.tooltip?.map((c) => c.title)).toEqual(['Month', s.channels.y.title, s.tooltip?.[2].title, 'When'])
    expect(s.tooltip?.[1].format).toBe(s.channels.y.format)
  })

  it('explains mistakes, naming the real fields and other libraries\' words', () => {
    const spec = (extra) => ({ mark: 'bar', data: rows, x: 'month', y: 'sales', ...extra })
    expect(() => normalise(spec({ y: 'sale' }))).toThrow("y: field 'sale' isn't in the data - fields are id, month, region, sales - did you mean 'sales'?")
    expect(() => normalise(spec({ mark: 'scatter' }))).toThrow("use 'point'")
    expect(() => normalise(spec({ mark: 'pie' }))).toThrow("pie and donut charts aren't supported")
    expect(() => normalise(spec({ series: [] }))).toThrow('map fields to channels')
    expect(() => normalise(spec({ transform: [] }))).toThrow('filter, sum or sort the rows')
    expect(() => normalise(spec({ y: { field: 'sales', aggregate: 'sum' } }))).toThrow('aggregate the rows first')
    expect(() => normalise(spec({ width: 400 }))).toThrow("in Vega-Lite it is pixels")
    expect(() => normalise(spec({ color: 'regon' }))).toThrow("did you mean 'region'?")
    expect(() => normalise(spec({ label: { field: 'sales', overlap: 'hide' } }))).toThrow('set overlap on the chart')
    expect(() => normalise({ mark: 'bar', data: rows, x: 'month' })).toThrow("a 'bar' chart needs y")
    expect(() => normalise(spec({ data: { url: 'x.csv' } }))).toThrow('fetch the rows')
    expect(() => normalise(spec({ widht: 0.5 }))).toThrow("did you mean 'width'?")
  })
})

describe('charts', () => {
  it('build every mark as ordinary nodes, with axes and labels', () => {
    const scene = new Scene()
    const bars = scene.add(chart({ mark: 'bar', data: rows, x: 'month', z: 'region', y: 'sales', color: 'region', label: 'sales' }))
    run(scene, 1)
    expect(bars).toBeInstanceOf(Group)
    const mesh = /** @type {any} */ (bars.marks[0])
    expect(mesh.count).toBe(6)
    expect(mesh.data).toHaveLength(6)
    const frame = collect(scene, camera())
    // three ticks, a title, two region ticks and a title, y ticks and title, and six value labels
    expect(frame.labels.filter((l) => l.text === 'Jan')).toHaveLength(1)
    expect(frame.labels.some((l) => l.text === 'sales')).toBe(true)
    expect(frame.labels.filter((l) => l.node === mesh)).toHaveLength(6)
    expect(bars.explain()).toBe('Chart (bar): 6 of 6 rows shown; x band of 3, y linear 0-20, z band of 2')
  })

  it('gives every label it draws one overlap rule, dim by default', () => {
    const rules = (o) => {
      const scene = new Scene()
      scene.add(chart({ mark: 'bar', data: rows, x: 'month', z: 'region', y: 'sales', label: 'sales', title: 'Sales', ...o }))
      run(scene, 1)
      const labels = collect(scene, camera()).labels
      // the chart title never competes
      return [...new Set(labels.filter((l) => l.text !== 'Sales').map((l) => l.style.overlap))]
    }
    expect(rules({})).toEqual(['dim'])
    expect(rules({ overlap: 'hide' })).toEqual(['hide'])
    expect(rules({ overlap: 'show' })).toEqual(['show'])
    expect(() => rules({ overlap: 'fade' })).toThrow("overlap 'fade' - expected 'dim', 'hide' or 'show'")
  })

  it('hands back the original row when a mark is picked, with a tooltip from the spec', () => {
    const scene = new Scene()
    const bars = scene.add(chart({ mark: 'bar', data: rows, x: 'month', y: 'sales', color: 'region', stack: true, transition: false,
      tooltip: ['region', 'month', { field: 'sales', format: { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 } }] }))
    scene.updateWorldTree()
    const hit = new Raycaster().setFromCamera([0, 0], new OrthographicCamera({ position: [0, 3, 20], target: [0, 3, 0], height: 12, aspect: 1 })).intersect(scene)[0]
    expect(rows).toContain(hit.datum)
    const tip = /** @type {any} */ (bars.tooltip)(hit)
    expect(tip.title).toBe(hit.datum.region)
    expect(tip.rows.month).toBe(hit.datum.month)
    expect(tip.rows.sales).toBe(`£${hit.datum.sales}`)
  })

  it('animates updates by key: entering grows, changing moves, leaving shrinks', () => {
    const scene = new Scene()
    const bars = scene.add(chart({ mark: 'bar', data: rows.slice(0, 2), x: 'month', y: 'sales', transition: { duration: 1, ease: 'linear' } }))
    run(scene, 1.1)
    const mesh = /** @type {any} */ (bars.marks[0])
    const height = (i) => mesh.instanceMatrices[i * 16 + 5]
    const h0 = height(0)
    bars.update([{ ...rows[0], sales: rows[0].sales * 2 }, rows[2]])
    // half way: the changed bar is between its heights, the new one part grown, the old one part shrunk
    run(scene, 0.5)
    expect(mesh.count).toBe(3)
    expect(height(0)).toBeGreaterThan(h0)
    expect(height(1)).toBeGreaterThan(0.01)
    expect(height(2)).toBeGreaterThan(0.01)
    run(scene, 0.7)
    expect(mesh.count).toBe(2)
    expect(mesh.data.map((r) => r.id)).toEqual([rows[0].id, rows[2].id])
  })

  it('lets rows that are leaving go, even when changes come faster than the animation', () => {
    const scene = new Scene()
    const bars = scene.add(chart({ mark: 'bar', data: rows, x: 'month', z: 'region', y: 'sales', transition: { duration: 0.5 } }))
    run(scene, 0.6)
    const mesh = /** @type {any} */ (bars.marks[0])
    // a live chart: one region hidden, then new data every 0.1 s - five times faster than the animation
    bars.filter((r) => r.region === 'North')
    for (let tick = 1; tick <= 10; tick++) {
      run(scene, 0.1)
      bars.update(rows.map((r) => ({ ...r, sales: r.sales + tick })))
    }
    run(scene, 0.1)
    // the hidden region's rows have gone, rather than staying on as flat leftovers
    expect(mesh.count).toBe(3)
    expect(mesh.data.every((r) => r.region === 'North')).toBe(true)
    // and once the changes stop, the shown bars reach their full heights
    run(scene, 0.6)
    const heights = [0, 1, 2].map((i) => mesh.instanceMatrices[i * 16 + 5])
    expect(Math.min(...heights)).toBeGreaterThan(0.5)
  })

  it('drops rows that were already leaving when a new change arrives', () => {
    const scene = new Scene()
    const bars = scene.add(chart({ mark: 'bar', data: rows, x: 'month', z: 'region', y: 'sales', transition: { duration: 0.5 } }))
    run(scene, 0.6)
    const mesh = /** @type {any} */ (bars.marks[0])
    bars.filter((r) => r.region === 'North')
    run(scene, 0.1)
    // the three South rows are on their way out
    expect(mesh.count).toBe(6)
    bars.filter((r) => r.region === 'North' && r.month !== 'Mar')
    run(scene, 0.1)
    // the South rows are gone; only North's Mar is leaving now
    expect(mesh.count).toBe(3)
    expect(mesh.data.filter((r) => r.region === 'South')).toHaveLength(0)
    run(scene, 0.6)
    expect(mesh.count).toBe(2)
  })

  it('filters rows, keeping the axes where they were', () => {
    const scene = new Scene()
    const bars = scene.add(chart({ mark: 'bar', data: rows, x: 'month', y: 'sales', color: 'region', stack: true, transition: false }))
    const domain = bars.scales.y?.domain
    bars.filter((r) => r.region === 'North')
    expect(/** @type {any} */ (bars.marks[0]).count).toBe(3)
    expect(bars.scales.y?.domain).toEqual(domain)
    bars.filter(null)
    expect(/** @type {any} */ (bars.marks[0]).count).toBe(6)
  })

  it('keeps its walls behind the data and its ticks on the near edges, per camera', () => {
    const scene = new Scene()
    scene.add(chart({ mark: 'point', data: rows, x: 'sales', y: 'sales', z: 'region', transition: false }))
    scene.updateWorldTree()
    const walls = (cam) => collect(scene, cam).opaque.concat(collect(scene, cam).transparent).filter((i) => i.node.drawMode === 'lines').length
    // from a corner, three walls; straight from the front, only the back wall
    expect(walls(camera())).toBe(3)
    expect(walls(new OrthographicCamera({ position: [0, 3, 30], target: [0, 3, 0], height: 10, aspect: 1 }))).toBe(1)
    // the x ticks sit on the edge nearest the camera: front from the front, back from behind
    const xTick = (cam) => collect(scene, cam).labels.find((l) => l.text === '12')?.position.z ?? 0
    expect(xTick(camera())).toBeGreaterThan(0)
    expect(xTick(new PerspectiveCamera({ position: [3, 10, -16], target: [0, 2, 0], aspect: 1 }))).toBeLessThan(0)
  })

  it('lays networks out the same way every time, and keeps nodes still across updates', () => {
    const nodes = [{ id: 'core' }, { id: 'a' }, { id: 'b' }, { id: 'c' }]
    const links = [{ source: 'core', target: 'a' }, { source: 'core', target: 'b' }, { source: 'core', target: 'c' }]
    const make = () => {
      const scene = new Scene()
      const net = scene.add(chart({ mark: 'network', data: { nodes, links }, transition: false }))
      return /** @type {any} */ (net.marks.find((n) => 'instanceMatrices' in n))
    }
    const one = make(), two = make()
    expect(Array.from(one.instanceMatrices.slice(0, 64))).toEqual(Array.from(two.instanceMatrices.slice(0, 64)))

    const scene = new Scene()
    const net = scene.add(chart({ mark: 'network', data: { nodes: nodes.map((n) => ({ ...n, status: 'ok' })), links }, color: 'status', transition: false }))
    const mesh = /** @type {any} */ (net.marks.find((n) => 'instanceMatrices' in n))
    const where = () => Array.from(mesh.instanceMatrices.slice(12, 15)).map((v) => +v.toFixed(2))
    const before = where()
    net.update({ nodes: nodes.map((n) => ({ ...n, status: n.id === 'core' ? 'down' : 'ok' })), links })
    const after = where()
    expect(after.map((v, k) => Math.abs(v - before[k]) < 0.5)).toEqual([true, true, true])
  })

  it('checks network data and lays out tiers', () => {
    const nodes = [{ id: 'r', role: 'core' }, { id: 's1', role: 'edge' }, { id: 's2', role: 'edge' }]
    expect(() => chart({ mark: 'network', data: { nodes, links: [{ source: 'r', target: 'x' }] } })).toThrow("link 0: target 'x' names no node")
    expect(() => chart({ mark: 'network', data: { nodes: [{ name: 'a' }], links: [] } })).toThrow("network nodes need an 'id' field")
    expect(() => chart({ mark: 'network', data: { nodes, links: [] }, x: 'role' })).toThrow("add layout: 'given'")
    const net = chart({ mark: 'network', data: { nodes, links: [{ source: 'r', target: 's1' }, { source: 'r', target: 's2' }] }, layout: { tiers: 'role' }, transition: false })
    const m = /** @type {any} */ (net.marks.find((n) => 'instanceMatrices' in n)).instanceMatrices
    // the core is on top, in the middle; the edge tier below it
    expect(m[13]).toBeGreaterThan(m[16 + 13])
    expect(Math.hypot(m[12], m[14])).toBeCloseTo(0)
  })

  it('gives line segments and surface vertices their rows', () => {
    const scene = new Scene()
    const surface = scene.add(chart({ mark: 'surface', data: [0, 1, 2].flatMap((x) => [0, 1, 2].map((z) => ({ x, z, v: x + z }))), x: 'x', z: 'z', y: 'v', transition: false }))
    scene.updateWorldTree()
    const hit = new Raycaster().setFromCamera([0, 0], new OrthographicCamera({ position: [0, 30, 0.01], target: [0, 0, 0], height: 12, aspect: 1 })).intersect(surface)[0]
    expect(hit.datum).toEqual({ x: 1, z: 1, v: 2 })
    expect(() => chart({ mark: 'surface', data: [{ x: 0, z: 0, v: 1 }, { x: 1, z: 1, v: 2 }], x: 'x', z: 'z', y: 'v' })).toThrow('2 of 4 are missing')

    const segments = new Lines({ geometry: new Geometry({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0] }), data: ['low', 'high'] })
    const rc = new Raycaster().setFromCamera([0, 0], new OrthographicCamera({ position: [0.5, 1, 5], target: [0.5, 1, 0], height: 2, aspect: 1 }))
    rc.threshold = 0.1
    expect(rc.intersect(segments)[0].datum).toBe('high')
  })

  it('saves to JSON and loads back through create()', () => {
    const c = chart({ mark: 'bar', data: rows, x: 'month', y: 'sales', position: [1, 0, 0], title: 'Sales' })
    const json = JSON.parse(JSON.stringify(c.toJSON()))
    expect(json).toMatchObject({ type: 'chart', mark: 'bar', x: 'month', position: [1, 0, 0] })
    expect(json.children).toBeUndefined()
    const back = create(json)
    expect(back).toBeInstanceOf(Chart)
    expect(back.toJSON()).toEqual(c.toJSON())
    expect(c.clone()).toBeInstanceOf(Chart)
  })
})

describe('node-level interaction', () => {
  it('reports interactive nodes, overlays and per-camera visibility in the frame', () => {
    const scene = new Scene()
    const back = scene.add(new Mesh({ geometry: box(1), showFrom: (cam) => cam.position.z > 0 }))
    const plain = new Scene()
    plain.add(new Mesh({ geometry: box(1) }))
    plain.updateWorldTree()
    expect(collect(plain, camera()).interactive).toBe(false)

    const group = scene.add(new Group({ tooltip: () => 'hi', highlight: '#ff0000', onClick: () => {} }))
    group.add(new Mesh({ geometry: box(1), position: [3, 0, 0] }))
    const el = /** @type {any} */ ({})
    group.overlay = el
    scene.updateWorldTree()
    const front = collect(scene, camera())
    expect(front.interactive).toBe(true)
    expect(front.tooltips).toBe(true)
    expect(front.overlays).toEqual([el])
    expect(front.opaque.some((i) => i.node === back)).toBe(true)
    const behind = collect(scene, new PerspectiveCamera({ position: [0, 0, -10], target: [0, 0, 0], aspect: 1 }))
    expect(behind.opaque.some((i) => i.node === back)).toBe(false)
    expect(() => new Group({ tooltip: 'text' })).toThrow("'tooltip' must be a function")
  })

  it('asks for the charts module when a description names a chart before it is imported', () => {
    expect(() => create({ type: 'emitter' })).toThrow("use new Emitter() from 'phoria2/particles'")
  })
})
