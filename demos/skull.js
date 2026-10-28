import { Color, DirectionalLight, Group, HemisphereLight, Label, Mesh, View } from 'phoria2'
import { loadGLTF } from 'phoria2/gltf'

// The human skull from the front, as an old anatomy plate draws it: each bone in its own colour,
// named in Latin down both sides. Hover a bone - both of a pair light together - for its English
// name and what it does; click it, or its name, to draw it out of the skull while the rest fade,
// so even the small bones hidden inside can be seen. The model is
// BodyParts3D's 22 bones and 28 teeth (see public/models/CREDITS.md), one node per bone.

// each bone: its Latin name, the poster's colour, the side of the page its name goes down, its
// English name and a line about it. Paired bones are named once, on the side the bone is on
const BONES = {
  frontal: { latin: 'os frontale', color: '#bba27c', edge: 'left', english: 'Frontal bone', about: 'The forehead, and the roofs of the eye sockets.' },
  parietal: { latin: 'os parietale', color: '#caa05a', edge: 'left', face: 'side', english: 'Parietal bones', about: 'The pair that make the top and sides of the skull, meeting at the sagittal suture.' },
  temporal: { latin: 'os temporale', color: '#ece8df', edge: 'left', face: 'side', english: 'Temporal bones', about: 'The sides and base of the skull, holding the ear and the jaw joint.' },
  zygomatic: { latin: 'os zygomaticum', color: '#e9b3a3', edge: 'left', english: 'Zygomatic bones', about: 'The cheekbones, and the outer rims of the eye sockets.' },
  lacrimal: { latin: 'os lacrimale', color: '#cf9873', edge: 'left', english: 'Lacrimal bones', about: 'The smallest bones of the face, in each eye socket, carrying the tear duct.' },
  maxilla: { latin: 'maxilla', color: '#ebe29b', edge: 'left', english: 'Maxillae', about: 'The upper jaw: it holds the upper teeth and forms the floor of each eye socket.' },
  teeth: { latin: 'dentes', color: '#f6f3ea', edge: 'left', english: 'Teeth', about: '28 permanent teeth here - incisors, canines, premolars and molars; wisdom teeth make 32.' },
  mandible: { latin: 'mandibula', color: '#bfe1d4', edge: 'left', english: 'Mandible', about: 'The lower jaw, and the only bone of the skull that moves.' },
  sphenoid: { latin: 'os sphenoidale', color: '#a9c98b', edge: 'right', english: 'Sphenoid bone', about: 'The butterfly-shaped keystone of the skull base, its wings in the eye sockets.' },
  ethmoid: { latin: 'os ethmoidale', color: '#c6b4d8', edge: 'right', english: 'Ethmoid bone', about: 'A light, honeycombed bone between the eyes, roofing the nose.' },
  nasal: { latin: 'os nasale', color: '#eda96b', edge: 'right', english: 'Nasal bones', about: 'Two small bones forming the bridge of the nose.' },
  concha: { latin: 'concha nasalis inferior', color: '#8fbfb2', edge: 'right', english: 'Inferior nasal conchae', about: 'Curled shelves inside the nose that warm and moisten the air.' },
  vomer: { latin: 'vomer', color: '#d77d7a', edge: 'right', english: 'Vomer', about: 'A thin plate dividing the nose in two, behind the cartilage.' },
  palatine: { latin: 'os palatinum', color: '#a6c7e6', edge: 'right', english: 'Palatine bones', about: 'The back of the hard palate, the roof of the mouth.' },
  occipital: { latin: 'os occipitale', color: '#dcd1ba', edge: 'right', face: 'back', english: 'Occipital bone', about: 'The back and base of the skull, with the hole the spinal cord passes through.' },
}
// how far a hovered part draws out: a share of its distance from the middle of the skull
const OUT = 0.4
// how far past the rest of the skull a buried part's middle comes, in metres
const CLEAR = 0.01
// how far the parts not drawn out fade towards the paper
const FADE = 0.6
// which bone a model part belongs to, by its BodyParts3D name
const kindOf = (name) => (/tooth$/.test(name) ? 'teeth' : /concha/.test(name) ? 'concha' : Object.keys(BONES).find((k) => name.includes(k)))
// a pair is named on the bone on its own side of the page: the skull's right shows on the left
const named = (name, edge) => !/^(left|right) /.test(name) || name.startsWith(edge === 'left' ? 'right ' : 'left ')

export default async function run({ canvas, info }) {
  const view = new View({
    canvas, background: '#f1ece0',
    orbit: { minDistance: 0.35, maxDistance: 1.4, minPitch: -0.6, maxPitch: 1.2 },
    camera: { position: [0, 0.115, 0.62], target: [0, 0.105, 0], fov: 35 },
    tooltip: (hit) => {
      // the English name, the Latin under it, and a line about the bone
      const kind = kindAbove(hit?.node)
      if (!kind) return null
      const card = document.createElement('div')
      card.className = 'skull-tip'
      card.innerHTML = '<b></b><i></i><p></p>'
      card.children[0].textContent = BONES[kind].english
      card.children[1].textContent = BONES[kind].latin
      card.children[2].textContent = BONES[kind].about
      return card
    },
  })
  const { scene } = view
  scene.environment = 'studio'
  // an engraver's light: from the upper left, raking across the face so the sockets, the cheeks and
  // the nose fall into shadow, with a weak cool fill from the right to keep the shadowed side
  // readable, and little ambient - the inks still read true, but the bone has form
  scene.environmentIntensity = 0.18
  scene.add(new HemisphereLight({ sky: '#fffaf0', ground: '#a99e88', intensity: 0.26 }))
  scene.add(new DirectionalLight({ direction: [0.95, -0.55, -0.4], intensity: 1.35, castShadow: true }))
  scene.add(new DirectionalLight({ direction: [-0.8, -0.1, -0.45], color: '#dfe7f2', intensity: 0.28 }))

  const model = await loadGLTF('models/skull.glb')
  scene.add(model)
  const cranium = model.find('cranium'), jaw = model.find('jaw')
  model.updateWorld()

  // regroup: a pair of bones, and each row of teeth, lights up as one thing when any part is hovered
  /** @type {Record<string, import('phoria2').Node>} */
  const groups = {}
  /** @param {string} kind @param {import('phoria2').Node} parent */
  const groupFor = (kind, parent) => {
    const key = `${kind} ${parent.name}`
    groups[key] ??= parent.add(new Group({ name: key, highlight: '#fff6cf', highlightWhole: true, userData: { kind } }))
    return groups[key]
  }
  /** @type {Mesh[]} */
  const parts = []
  model.traverse((n) => { if (n instanceof Mesh) parts.push(n) })
  for (const part of parts) {
    const kind = kindOf(part.name)
    part.userData.kind = kind
    part.material = part.material.clone()
    part.material.color.set(BONES[kind].color)
    // each bone shadows the next: the brow over the sockets, the cheekbones over the maxillae
    part.castShadow = part.receiveShadow = true
    groupFor(kind, part.parent === jaw ? jaw : cranium).add(part)
  }

  // each name down its side of the page, its leader pointing at the middle of the bone's face
  /** @type {Record<string, Label>} */
  const labels = {}
  for (const part of parts) {
    const kind = part.userData.kind, bone = BONES[kind]
    if (labels[kind] || !named(part.name, bone.edge) || (kind === 'teeth' && !/upper (central|lateral)/.test(part.name))) continue
    labels[kind] = part.add(new Label({
      text: bone.latin, position: facePoint(part, bone.face), edge: bone.edge, leader: true,
      className: 'skull-callout', overlap: 'dim', occlude: true,
    }))
  }
  /** @type {string | null} */
  let hovered = null
  /** @type {import('phoria2').Node | null} */
  let chosen = null
  // a callout is red while its bone is hovered, and set in bold while its bone is drawn out
  const restyle = () => {
    for (const [k, label] of Object.entries(labels)) {
      label.className = `skull-callout${k === hovered ? ' now' : ''}${k === chosen?.userData.kind ? ' chosen' : ''}`
    }
  }
  // clicking a bone - or its name - draws it out of the skull: a pair of bones, a row of teeth, the
  // jaw - straight out along the line from the skull's middle through its own, the same whichever
  // way the skull is turned; the rest fade back like a faint print. Click it again, click empty
  // space or press Esc to put it back
  const pulls = []
  /** @param {import('phoria2').Node} node @param {import('phoria2').Node[]} owners the groups that move it */
  const pull = (node, owners) => {
    const box = node.bounds
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i & 1 ? box.max[0] : box.min[0], i & 2 ? box.max[1] : box.min[1], i & 4 ? box.max[2] : box.min[2]])
    pulls.push({ node, owners, corners, centre: box.getCenter(), rest: node.position.clone(), go: [0, 0, 0], shown: 0 })
  }
  for (const g of Object.values(groups)) {
    if (g.parent !== cranium) continue
    if (g.userData.kind === 'teeth') pull(g, [g])
    else for (const bone of g.children) pull(bone, [g])
  }
  pull(jaw, Object.values(groups).filter((g) => g.parent === jaw))
  // where each part goes: out along its own line from the middle - each of a pair to its own side
  // - OUT of the way again, or until its middle is past the outermost point of the rest of the
  // skull along that line, so a bone buried inside (the sphenoid, the vomer) comes all the way out
  const all = pulls.flatMap((p) => p.corners)
  const middle = [0, 1, 2].map((k) => (Math.min(...all.map((c) => c[k])) + Math.max(...all.map((c) => c[k]))) / 2)
  for (const p of pulls) {
    const away = [0, 1, 2].map((k) => p.centre[k] - middle[k]), reach = Math.hypot(...away) || 1
    const dir = away.map((v) => v / reach)
    const along = (c) => (c[0] - middle[0]) * dir[0] + (c[1] - middle[1]) * dir[1] + (c[2] - middle[2]) * dir[2]
    const others = pulls.filter((q) => !q.owners.some((o) => p.owners.includes(o))).flatMap((q) => q.corners)
    const clear = Math.max(...others.map(along)) - along(p.centre) + CLEAR
    const distance = Math.max(reach * OUT, clear)
    p.go = dir.map((v) => v * distance)
  }
  // each part fades on its own, so it keeps its own colour to fade from
  const paper = new Color('#f1ece0')
  // and stays in colour along with whatever draws it out - its pair, its row of teeth, the jaw
  const fades = parts.map((part) => {
    const p = pulls.find((q) => {
      for (let n = /** @type {import('phoria2').Node | null} */ (part); n; n = n.parent) if (n === q.node) return true
      return false
    })
    return { part, owners: p?.owners ?? [], base: part.material.color.clone(), faded: 0 }
  })

  /** The group a node belongs to - what lights up, and what is drawn out, as one. @param {any} node */
  const groupOf = (node) => {
    for (let n = node; n; n = n.parent) if (n.parent && groups[n.name] === n) return n
    return null
  }
  /** Draw a group out, or put back what is out (null). @param {import('phoria2').Node | null} group */
  const choose = (group) => {
    chosen = group === chosen ? null : group
    restyle()
  }
  view.on('hover', (hit) => {
    hovered = kindAbove(hit?.node)
    restyle()
  })
  view.on('click', (hit) => choose(groupOf(hit?.node)))
  // the names down the sides are a menu: the way to the bones hidden inside the skull
  const byLatin = Object.fromEntries(Object.entries(BONES).map(([kind, bone]) => [bone.latin, kind]))
  const onName = (e) => {
    const el = /** @type {HTMLElement} */ (e.target).closest?.('.skull-callout')
    if (!el) return
    const kind = byLatin[el.textContent?.trim() ?? '']
    // the upper teeth and the mandible are named; their groups are the upper row and the jaw's bone
    const group = Object.values(groups).find((g) => g.userData.kind === kind && (kind === 'mandible' ? g.parent === jaw : g.parent === cranium))
    if (group) choose(group)
  }
  const onKey = (e) => { if (e.key === 'Escape') choose(null) }
  document.addEventListener('click', onName)
  window.addEventListener('keydown', onKey)

  view.frame(model, { padding: 0.12 })
  const credit = document.createElement('div')
  credit.className = 'skull-credit'
  credit.textContent = 'Model: BodyParts3D, © The Database Center for Life Science, CC BY 4.0'
  document.body.append(credit)
  info.textContent = 'Click a bone or its name to draw it out · click again or Esc to put it back · drag to turn'
  if (import.meta.env.DEV) Object.assign(window, { view, model, choose })

  return view.start((dt) => {
    const k = 1 - Math.exp(-dt * 9)
    /** @param {number} from @param {number} to */
    const ease = (from, to) => (Math.abs(to - from) < 0.002 ? to : from + (to - from) * k)
    for (const p of pulls) {
      const want = chosen && p.owners.includes(chosen) ? 1 : 0
      if (p.shown === want) continue
      p.shown = ease(p.shown, want)
      p.node.position.set(p.rest[0] + p.go[0] * p.shown, p.rest[1] + p.go[1] * p.shown, p.rest[2] + p.go[2] * p.shown)
    }
    for (const f of fades) {
      const want = chosen && !f.owners.includes(chosen) ? FADE : 0
      if (f.faded === want) continue
      f.faded = ease(f.faded, want)
      f.part.material.color.set(f.base.clone().lerp(paper, f.faded))
    }
  })
}

/** The bone kind a node belongs to: its own, or its nearest ancestor's. @param {any} node */
function kindAbove(node) {
  for (let n = node; n; n = n.parent) if (n.userData?.kind) return n.userData.kind
  return null
}

/**
 * Where a callout's leader should point on a part: on its outer surface facing the way the bone is
 * seen - from the front, the side or the back - nearest the middle of that face, so the leader lands
 * on the bone where you see it, not on its inside.
 * @param {any} part
 * @param {'front' | 'side' | 'back'} [face]
 * @returns {number[]}
 */
function facePoint(part, face = 'front') {
  const p = part.geometry.positions, n = part.geometry.normals, count = p.length / 3
  let mx = 0
  for (let i = 0; i < p.length; i += 3) mx += p[i]
  // which way is out: forward, back, or away from the middle on the bone's own side
  const dir = face === 'front' ? [0, 0, 1] : face === 'back' ? [0, 0, -1] : [Math.sign(mx) || 1, 0, 0]
  const along = (i) => p[i] * dir[0] + p[i + 1] * dir[1] + p[i + 2] * dir[2]
  let facing = []
  for (let i = 0; i < count * 3; i += 3) if (n[i] * dir[0] + n[i + 1] * dir[1] + n[i + 2] * dir[2] > 0.5) facing.push(i)
  if (!facing.length) facing = Array.from({ length: count }, (_, i) => i * 3)
  // the outer surface: the quarter of those furthest out
  const reach = facing.map(along), hi = Math.max(...reach), lo = Math.min(...reach)
  const outer = facing.filter((i, k) => reach[k] >= hi - (hi - lo) * 0.25)
  // its middle, across the view from that side, and the vertex nearest it
  const across = (i) => [p[i] * (1 - Math.abs(dir[0])) + p[i + 2] * Math.abs(dir[0]), p[i + 1]]
  let ca = 0, cb = 0
  for (const i of outer) { const [a2, b2] = across(i); ca += a2; cb += b2 }
  ca /= outer.length; cb /= outer.length
  let best = outer[0], bestD = Infinity
  for (const i of outer) {
    const [a2, b2] = across(i), d = (a2 - ca) ** 2 + (b2 - cb) ** 2
    if (d < bestD) { bestD = d; best = i }
  }
  return [p[best], p[best + 1], p[best + 2]]
}
