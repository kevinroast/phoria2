import Module from 'manifold-3d'
import wasmUrl from 'manifold-3d/manifold.wasm?url'
import { Box3, DirectionalLight, Geometry, Label, Lines, Mesh, View, edges, plane } from 'phoria2'

// A metal block carved by three cutters you drag over it, with Manifold (manifoldcad.org) - a library
// for solid modelling, written in C++, compiled to WebAssembly. Manifold owns the solids: the block, the
// cutters, and the boolean operations - subtract, union, intersect - that make one solid of them,
// always watertight. phoria2 owns the picture and the hands: each cutter is a see-through ghost you
// drag across the block's faces, by mouse or finger, turning to face out of whichever face it's on; at
// every move Manifold builds the solid again, and the bridge turns its mesh into a phoria2 Geometry -
// its normals smooth on the curves and sharp at the machined edges, which are drawn as lines. The
// solid's volume and area show as you carve.

const BLOCK = /** @type {[number, number, number]} */ ([3, 1.6, 2]) // the block's size, in m; it stands on the ground, centred
const SHARP = 40 // degrees: creases sharper than this stay sharp edges, gentler ones shade smooth
const OPS = {
  subtract: { label: 'Subtract', color: '#e4572e', title: 'Subtract: cut the cutter out of the block' },
  add: { label: 'Union', color: '#3fa34d', title: 'Union: join the cutter on to the block' },
  intersect: { label: 'Intersect', color: '#3d7dd8', title: 'Intersect: keep only where the cutter and the block overlap' },
}

/**
 * The rotation that turns +z to face along n: Manifold's cylinders run along z, so a cutter's own z
 * points out of the face it's on.
 * @param {number[]} n unit
 * @returns {[number, number, number, number]}
 */
const facing = (n) => {
  if (n[2] < -0.9999) return [1, 0, 0, 0]
  const q = [-n[1], n[0], 0, 1 + n[2]], l = Math.hypot(...q)
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]
}

/**
 * Where a ray first meets the block's box, and the outward normal of the face it meets there - the
 * block as made, so a cutter slides over its faces rather than sinking into its own hole.
 * @param {import('phoria2').Ray} ray
 * @returns {{ point: number[], normal: number[] } | null}
 */
const onBlock = (ray) => {
  const lo = [-BLOCK[0] / 2, 0, -BLOCK[2] / 2], hi = [BLOCK[0] / 2, BLOCK[1], BLOCK[2] / 2]
  let near = -Infinity, far = Infinity, axis = -1, side = 0
  for (let i = 0; i < 3; i++) {
    const o = ray.origin[i], d = ray.direction[i]
    if (Math.abs(d) < 1e-9) {
      if (o < lo[i] || o > hi[i]) return null
      continue
    }
    let t0 = (lo[i] - o) / d, t1 = (hi[i] - o) / d, s = -1
    if (t0 > t1) [t0, t1, s] = [t1, t0, 1]
    if (t0 > near) [near, axis, side] = [t0, i, s]
    far = Math.min(far, t1)
  }
  if (near > far || near < 0 || axis < 0) return null
  const normal = [0, 0, 0]
  normal[axis] = side
  return { point: ray.at(near).toArray(), normal }
}

/** A cutter's icon for its button, in the button's text colour. @param {string} shape */
const icon = (shape) => {
  const body = {
    drill: '<ellipse cx="12" cy="5" rx="6" ry="2.5"/><path d="M6 5v14c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V5" fill="none"/>',
    scoop: '<circle cx="12" cy="12" r="8" fill="none"/><ellipse cx="12" cy="12" rx="8" ry="3" fill="none"/>',
    notch: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z M4 7.5l8 4.5 8-4.5 M12 12v9" fill="none"/>',
  }[shape]
  return `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none" aria-hidden="true">${body}</svg>`
}

export default async function run({ canvas, info }) {
  // the WebAssembly loads here: its own .wasm file, which Vite serves and fingerprints like any asset
  const wasm = await Module({ locateFile: () => wasmUrl })
  wasm.setup()
  const { Manifold } = wasm

  const view = new View({ canvas, orbit: true, background: '#e6e8ec', highlight: '#ffffff' })
  const { scene } = view
  scene.environment = 'studio'
  scene.environmentIntensity = 0.9
  scene.add(new DirectionalLight({ direction: [-0.4, -1, -0.6], intensity: 1.2, castShadow: true,
    shadowBounds: { min: [-4, 0, -4], max: [4, 3, 4] } }))
  scene.add(new Mesh({ geometry: plane(60), material: { color: '#d5d8de', roughness: 0.9 }, receiveShadow: true, pickable: false }))

  // ---- the solid as drawn: machined aluminium, its sharp edges inked in. Not pickable, so a press
  // on it orbits the view; only the cutters are for dragging
  const solid = scene.add(new Mesh({ geometry: plane(1), castShadow: true, receiveShadow: true, pickable: false,
    material: { color: '#d4d8de', metalness: 0.45, roughness: 0.35 } }))
  const lines = scene.add(new Lines({ geometry: edges(plane(1)), material: { color: '#3a3f47' }, pickable: false }))

  // ---- the bridge: a Manifold solid into a phoria2 Geometry. Manifold works out normals itself -
  // splitting the vertices along creases sharper than SHARP, so curves are smooth and edges crisp -
  // as extra properties after each vertex's position
  /** @param {import('manifold-3d').Manifold} m */
  const geometryOf = (m) => {
    const shaded = m.calculateNormals(0, SHARP)
    const { vertProperties: p, numProp, triVerts } = shaded.getMesh()
    shaded.delete()
    const n = p.length / numProp, positions = new Float32Array(n * 3), normals = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      positions.set(p.subarray(i * numProp, i * numProp + 3), i * 3)
      normals.set(p.subarray(i * numProp + 3, i * numProp + 6), i * 3)
    }
    return new Geometry({ positions, normals, indices: triVerts })
  }

  // ---- the block and the cutters, as Manifold solids made once; each rebuild places the cutters by
  // their ghosts' world matrices (column-major, as Manifold takes them) and combines them in turn
  const block = Manifold.cube(BLOCK, true).translate([0, BLOCK[1] / 2, 0])
  const blockVolume = block.volume()
  const CUTTERS = [
    { shape: 'drill', name: 'Drill', solid: Manifold.cylinder(1.4, 0.32, 0.32, 48, true), sink: 0.2, reach: 0.7, at: [-0.75, BLOCK[1], 0.15], normal: [0, 1, 0] },
    { shape: 'scoop', name: 'Scoop', solid: Manifold.sphere(0.6, 48), sink: 0.1, reach: 0.6, at: [0.35, 0.8, BLOCK[2] / 2], normal: [0, 0, 1] },
    { shape: 'notch', name: 'Notch', solid: Manifold.cube([0.8, 0.8, 0.8], true), sink: 0, reach: 0.4, at: [BLOCK[0] / 2, BLOCK[1], -BLOCK[2] / 2], normal: [0, 1, 0] },
  ]
  /** @typedef {keyof typeof OPS} Op */
  const cutters = CUTTERS.map((c) => {
    const ghost = scene.add(new Mesh({ geometry: geometryOf(c.solid), castShadow: false, renderOrder: 1,
      // seen through the block, so you can always see and grab it
      material: { color: OPS.subtract.color, opacity: 0.2, depthTest: false, depthWrite: false } }))
    // its name, beyond its tip - a child, so it follows the cutter
    ghost.add(new Label({ text: c.name, position: [0, 0, c.reach + 0.15], className: 'csg-tag', overlap: 'show' }))
    const cutter = { ...c, ghost, op: /** @type {Op} */ ('subtract') }
    ghost.onDrag = (drag) => {
      if (drag.phase === 'start') select(cutter)
      const hit = onBlock(drag.ray)
      if (hit) {
        place(cutter, hit.point, hit.normal)
        rebuild()
      }
    }
    return cutter
  })

  /** Stand a cutter on the block: sunk in by its sink, facing out of the face. @param {typeof cutters[number]} c @param {number[]} point @param {number[]} normal */
  const place = (c, point, normal) => {
    c.ghost.position.set(point[0] - normal[0] * c.sink, point[1] - normal[1] * c.sink, point[2] - normal[2] * c.sink)
    c.ghost.quaternion = facing(normal)
  }

  // ---- carving: the block, then each cutter in turn - subtracted, unioned or intersected - one solid, drawn
  const rebuild = () => {
    scene.updateWorldTree()
    let carved = block
    for (const c of cutters) {
      const placed = c.solid.transform(/** @type {any} */ (Array.from(c.ghost.worldMatrix)))
      const next = carved[c.op](placed)
      placed.delete()
      if (carved !== block) carved.delete()
      carved = next
    }
    const volume = carved.volume(), area = carved.surfaceArea()
    const was = solid.geometry, wasLines = lines.geometry
    solid.geometry = geometryOf(carved)
    lines.geometry = edges(solid.geometry, { angle: SHARP })
    was.dispose()
    wasLines.dispose()
    if (carved !== block) carved.delete()
    const change = Math.round((volume / blockVolume - 1) * 100)
    // each figure kept with its unit, so a narrow screen wraps between them
    info.textContent = `Volume\u00a0${volume.toFixed(2)}\u00a0m³\u00a0(${change > 0 ? '+' : change < 0 ? '−' : ''}${Math.abs(change)}%) · Area\u00a0${area.toFixed(1)}\u00a0m²`
  }

  // ---- the controls: which cutter, and what it does
  let chosen = cutters[0]
  const bar = document.createElement('div')
  bar.className = 'hud csg-bar'
  bar.innerHTML = `
    ${cutters.map((c, i) => `<button type="button" class="csg-icon" data-cutter="${i}" title="${c.name}" aria-label="${c.name}">${icon(c.shape)}</button>`).join('')}
    <span class="csg-gap"></span>
    ${Object.entries(OPS).map(([op, o]) => `<button type="button" data-op="${op}" title="${o.title}">${o.label}</button>`).join('')}
    <button type="button" class="csg-reset" data-reset title="Start again">⟲</button>`
  document.body.append(bar)
  /** @param {typeof cutters[number]} c */
  const select = (c) => {
    chosen = c
    show()
  }
  const show = () => {
    for (const [i, c] of cutters.entries()) {
      const mine = c === chosen
      c.ghost.material.color = OPS[c.op].color
      c.ghost.material.opacity = mine ? 0.38 : 0.18
      bar.querySelector(`[data-cutter="${i}"]`)?.classList.toggle('now', mine)
    }
    for (const b of bar.querySelectorAll('[data-op]')) b.classList.toggle('now', /** @type {HTMLElement} */ (b).dataset.op === chosen.op)
    // each op button in its colour, so it matches the ghost it turns the cutter
    for (const b of bar.querySelectorAll('[data-op]')) /** @type {HTMLElement} */ (b).style.setProperty('--op', OPS[/** @type {Op} */ (/** @type {HTMLElement} */ (b).dataset.op)].color)
  }
  const reset = () => {
    for (const c of cutters) {
      c.op = 'subtract'
      place(c, c.at, c.normal)
    }
    chosen = cutters[0]
    show()
    rebuild()
  }
  bar.addEventListener('click', (event) => {
    const button = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (event.target).closest('button'))
    if (!button) return
    if (button.dataset.cutter) chosen = cutters[Number(button.dataset.cutter)]
    else if (button.dataset.op) {
      chosen.op = /** @type {Op} */ (button.dataset.op)
      rebuild()
    } else if ('reset' in button.dataset) reset()
    show()
  })

  reset()
  view.frame(new Box3([-BLOCK[0] / 2 - 0.8, 0, -BLOCK[2] / 2 - 0.8], [BLOCK[0] / 2 + 0.8, BLOCK[1] + 1, BLOCK[2] / 2 + 0.8]), { direction: [1.1, 1, 1.5], padding: 0.08 })
  if (import.meta.env.DEV) Object.assign(window, { view, cutters, rebuild })
  return view.start()
}
