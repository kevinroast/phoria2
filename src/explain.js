// view.explain(): what the View is drawing, in plain text, with warnings for the usual reasons a
// picture is wrong. A coding agent can't see the canvas; this lets it debug without screenshots.

import { Box3 } from './value/Box3.js'

/** @import { FrameDescription } from './frame.js' */
/** @import { LabelStats } from './labels.js' */

/**
 * @typedef {object} ExplainInfo
 * @property {number} width CSS pixels
 * @property {number} height
 * @property {number} pixelRatio
 * @property {string} renderMode
 * @property {boolean} running
 * @property {FrameDescription} frame
 * @property {LabelStats | null} labels
 * @property {Box3} bounds the scene's world bounds
 * @property {number} nodes
 * @property {boolean} autoLight
 * @property {boolean} contextLost
 * @property {{ hover: number, click: number, tooltip: boolean, highlight: boolean }} interaction
 */

const fmt = (n) => (Math.abs(n) >= 1e4 || (n !== 0 && Math.abs(n) < 1e-3) ? n.toExponential(2) : String(+n.toFixed(2)))
const vec = (v) => `[${fmt(v[0])}, ${fmt(v[1])}, ${fmt(v[2])}]`
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/** World bounds of the drawn meshes, or null when there are none. @param {import('./frame.js').DrawItem[]} items */
function solidBounds(items) {
  let box = null
  for (const { node } of items) {
    if (/** @type {any} */ (node).drawMode !== 'triangles') continue
    box = node.expandBounds(box ?? new Box3())
  }
  return box
}

/** @param {ExplainInfo} info @returns {string} */
export function explain(info) {
  const { frame, bounds } = info
  const cam = /** @type {any} */ (frame.camera.camera)
  const ortho = cam.constructor.type === 'orthographic-camera'
  const lines = []
  const warnings = []

  lines.push(`View ${info.width} x ${info.height} CSS px at pixel ratio ${fmt(info.pixelRatio)}; ` +
    `draws ${info.renderMode === 'auto' ? 'when something changes' : info.renderMode === 'always' ? 'every frame' : 'only on view.render()'}; ` +
    `loop ${info.running ? 'running' : 'stopped'}`)
  lines.push(`Camera: ${ortho ? `orthographic, ${fmt(cam.height)} units high` : `perspective, fov ${fmt(cam.fov)}`}, ` +
    `at ${vec(cam.position)}${cam.target ? ` looking at ${vec(cam.target)}` : ''}, near ${fmt(cam.near)}, far ${fmt(cam.far)}`)

  // what was drawn, by kind
  const items = [...frame.opaque, ...frame.transparent]
  const kinds = new Map()
  for (const { node, instances } of items) {
    const kind = instances ? 'instanced mesh' : /** @type {any} */ (node).drawMode === 'points' ? 'points' : /** @type {any} */ (node).drawMode === 'lines' ? 'lines' : 'mesh'
    const k = kinds.get(kind) ?? { n: 0, items: 0 }
    k.n++
    k.items += instances ? instances.count : kind === 'points' ? node.geometry.drawnCount : 0
    kinds.set(kind, k)
  }
  const drawn = [...kinds].map(([kind, k]) => `${k.n} ${kind}${k.items ? ` (${k.items.toLocaleString('en')} ${kind === 'points' ? 'points' : 'instances'})` : ''}`)
  lines.push(`Scene: ${plural(info.nodes, 'node')}; drew ${frame.stats.drawn}${drawn.length ? ` - ${drawn.join(', ')}` : ''}; ` +
    `${frame.stats.culled} outside the view`)

  // how much of the view the scene fills
  if (!bounds.isEmpty()) {
    const centre = bounds.getCenter(), radius = bounds.getRadius()
    const distance = Math.hypot(cam.position[0] - centre[0], cam.position[1] - centre[1], cam.position[2] - centre[2])
    const viewHeight = ortho ? cam.height : 2 * distance * Math.tan(cam.fov * Math.PI / 360)
    const fill = (2 * radius) / viewHeight
    lines.push(`Bounds: ${vec(bounds.min)} to ${vec(bounds.max)}, centre ${vec(centre)}, radius ${fmt(radius)}; ` +
      `about ${Math.round(fill * 100)}% of the view's height`)
    if (frame.stats.drawn && fill < 0.05) warnings.push(`the scene fills only ${Math.round(fill * 100)}% of the view - call view.frame() to fit the camera to it`)
    // only solid meshes count here: starfields and floor grids are meant to surround the camera
    const solid = solidBounds(items)
    if (!ortho && solid && solid.containsPoint(cam.position)) warnings.push("the camera is inside the solid objects' bounds - call view.frame() to step back")
    if (distance - radius > cam.far) warnings.push(`the scene is beyond camera.far (${fmt(cam.far)}) - raise camera.far or call view.frame()`)
    else if (distance + radius > cam.far) warnings.push(`the far side of the scene is beyond camera.far (${fmt(cam.far)}) and is cut off`)
  }

  // lights
  const lightKinds = new Map()
  for (const l of frame.lights) lightKinds.set(l.kind, (lightKinds.get(l.kind) ?? 0) + 1)
  lines.push(`Lights: ${lightKinds.size ? [...lightKinds].map(([k, n]) => `${n} ${k}`).join(', ') : 'none'}` +
    `${frame.environment !== 'none' ? `; environment '${frame.environment}'` : ''}`)
  const lit = items.filter((i) => !i.material.unlit && /** @type {any} */ (i.node).drawMode === 'triangles')
  if (lit.length && !frame.lights.length && frame.environment === 'none' && !info.autoLight) {
    warnings.push(`${plural(lit.length, 'lit object')} but no lights and autoLight is off - they draw black; add a light, set scene.environment = 'studio' or use unlit materials`)
  }

  const invisible = items.filter((i) => i.material.opacity === 0).length
  if (invisible) warnings.push(`${plural(invisible, 'object')} with material opacity 0 - drawn but invisible`)

  if (info.labels && info.labels.total) {
    const s = info.labels
    lines.push(`Labels: ${s.shown} shown, ${s.overlapped} hidden by overlap, ${s.occluded} behind geometry, ${s.offscreen} off screen`)
    if (s.overlapped > s.shown * 3) warnings.push(`${s.overlapped} labels are hidden by overlap - give the important ones a higher priority, label fewer things, or use overlap: 'show'`)
    if (s.offscreen === s.total) warnings.push('every label is off screen - check their positions, or call view.frame()')
  }

  const ix = info.interaction
  if (ix.hover || ix.click || ix.tooltip || ix.highlight) {
    lines.push(`Interaction: ${[ix.hover && plural(ix.hover, 'hover handler'), ix.click && plural(ix.click, 'click handler'),
      ix.tooltip && 'tooltip', ix.highlight && 'hover highlight'].filter(Boolean).join(', ')}`)
  }

  if (info.width < 2 || info.height < 2) warnings.unshift(`the canvas is ${info.width} x ${info.height} - give it a size in the page (CSS width and height)`)
  if (info.contextLost) warnings.unshift('the WebGL context is lost - nothing draws until the browser restores it')
  if (bounds.isEmpty()) warnings.unshift('the scene has nothing to draw - add a Mesh, InstancedMesh, Points or Lines')
  else if (!frame.stats.drawn && frame.stats.culled) {
    warnings.unshift(`nothing is in view: ${plural(frame.stats.culled, 'object')} are outside the camera's view - call view.frame() to fit the camera to the scene`)
  }

  lines.push(warnings.length ? `Warnings:\n${warnings.map((w) => `- ${w}`).join('\n')}` : 'No warnings.')
  return lines.join('\n')
}
