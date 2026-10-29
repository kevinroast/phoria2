// The options every node takes, as contract rows - shared by the contracts of every node class.
import { vi } from 'vitest'
import { Group, Scene } from '../src/index.js'
import { rounded } from './contract.js'

const hex = (c) => c.getHex()

// --- every node takes these
export const nodeRows = () => ({
  name: { value: 'thing', read: (n) => n.name, default: '', quiet: 'a name' },
  position: { value: [1, 2, 3], read: (n) => n.position.toArray(), default: [0, 0, 0], bad: 'up', error: "'up'" },
  rotation: { value: [0.1, 0.2, 0.3], read: (n) => rounded([n.rotation.x, n.rotation.y, n.rotation.z]), bad: 'up', error: "'up'" },
  quaternion: { value: [0, 0, 0.6, 0.8], read: (n) => rounded(n.quaternion), bad: 'up', error: "'up'" },
  scale: { value: [2, 3, 4], read: (n) => n.scale.toArray(), default: [1, 1, 1], bad: 'up', error: "'up'" },
  visible: { value: false, read: (n) => n.visible, default: true },
  pickable: { value: false, read: (n) => n.pickable, default: true, quiet: 'picking only' },
  matrixAutoUpdate: { value: false, read: (n) => n.matrixAutoUpdate, default: true, quiet: 'freezes the transform where it is' },
  children: { fresh: () => [new Group({ name: 'kid' })], read: (n) => n.children.map((c) => c.name).filter((c) => c === 'kid'), expect: ['kid'], apply: (n, kids) => n.add(...kids) },
  userData: { value: { id: 7 }, read: (n) => n.userData, quiet: "the app's own data" },
  onUpdate: {
    fresh: () => vi.fn(), keep: false, quiet: 'runs each frame; what it changes is watched',
    check: (n, fn) => {
      const scene = n instanceof Scene ? n : /** @type {Scene} */ (new Scene().add(n).root)
      scene.update(0.1, 1)
      if (!fn.mock.calls.length) throw new Error('onUpdate was not called')
    },
  },
  tooltip: { value: () => 'tip', read: (n) => typeof n.tooltip, expect: 'function', bad: 'tip', error: 'function', keep: false },
  highlight: { value: '#ff0000', read: (n) => hex(n.highlight), expect: 0xff0000, bad: 'notacolour', error: 'notacolour' },
  highlightWhole: { value: true, read: (n) => n.highlightWhole, default: false, bad: 'yes', error: 'highlightWhole' },
  onHover: { value: () => {}, read: (n) => typeof n.onHover, expect: 'function', bad: 1, error: 'function', keep: false },
  onClick: { value: () => {}, read: (n) => typeof n.onClick, expect: 'function', bad: 1, error: 'function', keep: false },
  showFrom: { value: () => {}, read: (n) => typeof n.showFrom, expect: 'function', bad: 1, error: 'function', keep: false },
  onDrag: { value: () => {}, read: (n) => typeof n.onDrag, expect: 'function', bad: 1, error: 'function', keep: false },
  outline: { value: { color: '#00ff00', width: 3 }, read: (n) => n.outline && [n.outline.color.getHex(), n.outline.width], expect: [0x00ff00, 3], default: null, bad: { width: 20 }, error: 'outline.width' },
  clip: { value: { normal: [1, 0, 0], offset: 0.5, cap: '#ff0000' }, read: (n) => n.clip && n.clip.toJSON(), expect: { normal: [1, 0, 0], offset: 0.5, cap: '#ff0000' }, default: null, bad: 'front', error: "'clip' must be" },
})
