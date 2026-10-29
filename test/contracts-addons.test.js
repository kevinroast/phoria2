// Option contracts for charts, particles and motion - see contract.js.
import { expect, it } from 'vitest'
import { Group, box, curve } from '../src/index.js'
import { NODE_OPTIONS } from '../src/scene/Node.js'
import { chart } from '../src/charts/index.js'
import { CHANNEL_HINTS, CHANNEL_OPTIONS, OPTIONS as CHART_OPTIONS, OPTION_HINTS } from '../src/charts/spec.js'
import { Body, Emitter } from '../src/particles/index.js'
import { Timeline, face, follow } from '../src/motion/index.js'
import { STEP_HINTS, STEP_OPTIONS } from '../src/motion/Timeline.js'
import { FACE_HINTS, FACE_OPTIONS, FOLLOW_HINTS, FOLLOW_OPTIONS } from '../src/motion/follow.js'
import { contract, rounded } from './contract.js'
import { nodeRows } from './node-rows.js'

const hex = (c) => c.getHex()

// --- charts: a bar chart of sales, or a small network for the network-only options
const rows = ['North', 'South'].flatMap((region, s) => ['Jan', 'Feb', 'Mar'].map((month, m) => ({ id: `${region}-${month}`, month, region, sales: 10 + s * 5 + m })))
const network = {
  nodes: [{ id: 'a', tier: 1 }, { id: 'b', tier: 2 }, { id: 'c', tier: 2 }],
  links: [{ source: 'a', target: 'b', from: 'a', to: 'b', w: 2 }, { source: 'a', target: 'c', from: 'a', to: 'c', w: 1 }],
}
const NETWORK_ONLY = ['layout', 'flat', 'steps', 'seed', 'source', 'target', 'link']
const makeChart = (o) => chart(Object.keys(o).some((k) => NETWORK_ONLY.includes(k))
  ? { mark: 'network', data: network, transition: false, ...o }
  : { mark: 'bar', data: rows, x: 'month', y: 'sales', transition: false, ...o })
const opt = (key) => (c) => c.spec.options[key]
const channel = (name, key = 'field') => (c) => c.spec.channels[name]?.[key]
// a chart takes the node options too, but makes its own children, tooltip and highlight
const chartNodeRows = () => {
  const { children, tooltip, highlight, ...rest } = nodeRows()
  void children, tooltip, highlight
  return rest
}

contract('chart()', {
  options: [...new Set([...CHART_OPTIONS, ...NODE_OPTIONS.filter((k) => k !== 'children')])], hints: OPTION_HINTS, make: makeChart,
  clone: (c) => c.clone(),
  rows: {
    ...chartNodeRows(),
    mark: { value: 'point', read: (c) => c.spec.mark, bad: 'pie', error: 'pie' },
    data: { fresh: () => rows.slice(0, 2), read: (c) => c.data.length, expect: 2, bad: 'rows', error: 'data' },
    encoding: { value: { color: { field: 'region' } }, read: channel('color'), expect: 'region', bad: { colour: 'region' }, error: "isn't a channel" },
    tooltip: { value: false, read: (c) => c.tooltip, expect: null, keep: false },
    box: { value: [4, 2, 1], read: opt('box'), bad: [1, 2], error: 'box' },
    stack: { value: true, read: opt('stack') },
    width: { value: 0.5, read: opt('width'), bad: 50, error: 'width' },
    layout: { value: { tiers: 'tier' }, read: opt('layout'), bad: 'circle', error: 'layout' },
    flat: { value: true, read: opt('flat') },
    steps: { value: 20, read: opt('steps'), bad: 'many', error: 'steps' },
    seed: { value: 3, read: opt('seed'), bad: 'random', error: 'seed' },
    source: { value: 'from', read: opt('source'), bad: 'nowhere', error: 'nowhere' },
    target: { value: 'to', read: opt('target'), bad: 'nowhere', error: 'nowhere' },
    link: { value: { width: 'w' }, only: "a network's link channels, drawn as its links", bad: { thickness: 'w' }, error: 'link has no' },
    highlight: { value: '#ff0000', read: (c) => hex(c.highlight), expect: 0xff0000, bad: 'notacolour', error: 'notacolour' },
    legend: { value: false, read: opt('legend'), only: 'the legend is drawn on the page, in a browser' },
    theme: { value: 'light', read: opt('theme'), bad: 'blue', error: 'theme' },
    overlap: { value: 'hide', read: opt('overlap'), bad: 'fade', error: 'overlap' },
    transition: { value: false, read: opt('transition') },
    title: { value: 'Sales', read: (c) => c.children.some((n) => n.text === 'Sales'), expect: true },
    $schema: { value: 'https://example.com/chart.json', only: 'metadata, for editors' },
    description: { value: 'Monthly sales', read: opt('description') },
    x: { value: 'region', read: channel('x'), bad: 'nofield', error: "isn't in the data" },
    y: { value: { field: 'sales' }, read: channel('y'), expect: 'sales', bad: 'nofield', error: "isn't in the data" },
    z: { value: 'region', read: channel('z'), bad: 'nofield', error: "isn't in the data" },
    color: { value: 'region', read: channel('color'), bad: 'nofield', error: "isn't in the data" },
    size: { value: 'sales', read: channel('size'), bad: 'nofield', error: "isn't in the data" },
    opacity: { value: 0.5, read: channel('opacity', 'value'), bad: 'nofield', error: "isn't in the data" },
    label: { value: 'sales', read: channel('label'), bad: 'nofield', error: "isn't in the data" },
    key: { value: 'id', read: channel('key'), bad: 'nofield', error: "isn't in the data" },
    detail: { value: 'region', read: channel('detail'), bad: 'nofield', error: "isn't in the data" },
  },
})

it("tells a chart's size [x, y, z] from its size channel", () => {
  expect(() => makeChart({ size: [4, 2, 2] })).toThrow("the chart's size in the scene is 'box: [x, y, z]'")
  expect(makeChart({ mark: 'point', size: 'sales' }).spec.channels.size.field).toBe('sales')
})

contract('chart() channel', {
  options: CHANNEL_OPTIONS, hints: CHANNEL_HINTS,
  // a constant value is checked on color: a bar chart's y has to be a field (checked below)
  make: (o) => (o.value === undefined ? makeChart({ y: { field: 'sales', ...o } }).spec.channels.y : makeChart({ color: o }).spec.channels.color),
  rows: {
    field: { value: 'sales', read: (c) => c.field, bad: 'nofield', error: "isn't in the data" },
    type: { value: 'ordinal', read: (c) => c.type, default: 'quantitative', bad: 'number', error: 'type' },
    title: { value: 'Revenue', read: (c) => c.title, default: 'sales' },
    format: { value: { maximumFractionDigits: 0 }, read: (c) => c.format },
    scale: { value: { domain: [0, 100] }, read: (c) => c.scale.domain, expect: [0, 100] },
    axis: { value: { title: 'Revenue' }, read: (c) => c.axis.title, expect: 'Revenue' },
    value: { value: '#ff0000', read: (c) => [c.field, c.value], expect: [null, '#ff0000'] },
    priority: { value: 2, read: (c) => c.priority },
    legend: { value: false, only: 'the legend is drawn on the page, in a browser' },
  },
})

// --- particles
contract('Emitter', {
  options: Emitter.OPTIONS, hints: Emitter.HINTS, make: (o) => new Emitter(o),
  rows: {
    ...nodeRows(),
    // an Emitter makes its own geometry, sized by max - so of the drawable options, geometry is refused
    geometry: { bad: box(1), error: 'makes its own geometry' },
    material: { value: { size: 0.3 }, read: (e) => e.material.size, expect: 0.3, bad: 'big', error: 'material' },
    castShadow: { value: true, read: (e) => e.castShadow, default: false },
    receiveShadow: { value: true, read: (e) => e.receiveShadow, default: false },
    renderOrder: { value: 2, read: (e) => e.renderOrder, default: 0, bad: 'first', error: 'renderOrder' },
    frustumCulled: { value: true, read: (e) => e.frustumCulled, default: false },
    data: { value: { id: 3 }, read: (e) => e.data, default: null },
    labels: { value: { text: () => 'p' }, read: (e) => typeof e.labels?.text, expect: 'function', bad: { text: 'p' }, error: 'labels' },
    origin: { value: [1, 2, 3], read: (e) => e.origin.toArray(), default: [0, 0, 0], bad: 'here', error: "'here'" },
    originSpread: { value: 0.5, read: (e) => e.originSpread, default: 0, bad: 'wide', error: 'originSpread' },
    velocity: { value: [0, 5, 0], read: (e) => e.velocity.toArray(), default: [0, 1, 0], bad: 'up', error: "'up'" },
    velocitySpread: { value: [1, 0, 1], read: (e) => e.velocitySpread.toArray(), bad: 'wide', error: "'wide'" },
    lifetime: { value: [0.5, 2], read: (e) => e.lifetime, default: [1, 1], bad: -1, error: 'lifetime' },
    color: { value: ['#ff0000', '#000000'], read: (e) => e.color.length, expect: 2, bad: 'notacolour', error: 'notacolour' },
    max: { value: 50, read: (e) => e.max, default: 1000, bad: 0.5, error: 'max' },
    rate: { value: 20, read: (e) => e.rate, default: 100, bad: 'lots', error: 'rate' },
    gravity: { value: [0, -9.8, 0], read: (e) => rounded(e.gravity), bad: 'down', error: "'down'" },
    drag: { value: 0.5, read: (e) => e.drag, default: 0, bad: 'some', error: 'drag' },
    follow: { fresh: () => new Group(), check: (e, n) => { if (e.follow !== n) throw new Error('not the node given') }, bad: 'it', error: 'follow' },
    onParticle: { value: () => true, read: (e) => typeof e.onParticle, expect: 'function', keep: false },
  },
})

contract('Body', {
  options: Body.OPTIONS, hints: Body.HINTS, make: (o) => new Body(o),
  rows: {
    velocity: { value: [1, 2, 3], read: (b) => b.velocity.toArray(), default: [0, 0, 0], bad: 'up', error: "'up'" },
    gravity: { value: [0, -9.8, 0], read: (b) => rounded(b.gravity), default: [0, 0, 0], bad: 'down', error: "'down'" },
    drag: { value: 0.5, read: (b) => b.drag, default: 0, bad: 'some', error: 'drag' },
  },
})

// --- motion
contract('Timeline', {
  options: Timeline.OPTIONS, hints: Timeline.HINTS, make: (o) => new Timeline(o),
  rows: {
    loop: { value: true, read: (t) => t.loop, default: false },
    speed: { value: 2, read: (t) => t.speed, default: 1, bad: 'fast', error: 'speed' },
  },
})
contract('Timeline.add()', {
  options: STEP_OPTIONS, hints: STEP_HINTS, make: (o) => new Timeline().add(1, () => {}, o),
  rows: {
    label: { value: 'Launch', read: (t) => t.steps[0].label, default: '' },
    ease: { value: 'inOut', check: (t) => { t.update(0.25); if (Math.abs(t.time - 0.25) > 1e-9) throw new Error('time moved wrongly') }, bad: 'bouncy', error: 'bouncy' },
  },
})
const path = curve([[0, 0, 0], [10, 0, 0]])
const craft = () => new Group()
const nose = (n, axis) => rounded([...axis].length && new (/** @type {any} */ (n.position.constructor))(...axis).applyQuaternion(n.quaternion))
contract('follow()', {
  options: FOLLOW_OPTIONS, hints: FOLLOW_HINTS, make: (o) => follow(craft(), path, 0.5, o),
  rows: {
    orient: { value: false, read: (n) => rounded(n.quaternion), expect: [0, 0, 0, 1] },
    forward: { value: '+y', read: (n) => nose(n, [0, 1, 0]), expect: [1, 0, 0], bad: 'up', error: 'forward' },
    up: { value: [0, 0, 1], read: (n) => nose(n, [0, 1, 0]), expect: [0, 0, 1], bad: 'sky', error: "'sky'" },
  },
})
contract('face()', {
  options: FACE_OPTIONS, hints: FACE_HINTS, make: (o) => face(craft(), [1, 0, 0], o),
  rows: {
    forward: { value: '+y', read: (n) => nose(n, [0, 1, 0]), expect: [1, 0, 0], bad: 'up', error: 'forward' },
    up: { value: [0, 0, 1], read: (n) => nose(n, [0, 1, 0]), expect: [0, 0, 1], bad: 'sky', error: "'sky'" },
  },
})

it('says when a chart needs a field where it was given a constant position', () => {
  const grid = [0, 1].flatMap((x) => [0, 1].map((z) => ({ x, z, v: x + z })))
  for (const mark of ['bar', 'line', 'area']) {
    for (const name of ['x', 'y']) {
      expect(() => chart({ mark, data: rows, x: 'month', y: 'sales', [name]: { value: 1 } }), `${mark} ${name}`).toThrow(`${name} on a '${mark}' chart lays its marks out along a scale`)
    }
  }
  for (const name of ['x', 'y', 'z']) {
    expect(() => chart({ mark: 'surface', data: grid, x: 'x', z: 'z', y: 'v', [name]: { value: 1 } })).toThrow('needs a field, not a constant')
  }
  // points can sit at a constant, and a bar chart's depth can be one
  expect(() => chart({ mark: 'point', data: rows, x: 'month', y: { value: 3 } })).not.toThrow()
  expect(() => chart({ mark: 'bar', data: rows, x: 'month', y: 'sales', z: { value: 2 } })).not.toThrow()
})
