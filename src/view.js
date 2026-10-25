import { vec2, vec3 } from 'gl-matrix'
import { intersectionInsidePolygon, planeLineIntersection } from './intersect.js'

// View helpers: drag tracking for rotating a view with the mouse or touch, and reverse object
// selection (picking) - contributed to phoria by Ruan Moolman.

const trackers = new WeakMap()

// Track pointer drags on an element. Returns a live state object - velocityH/velocityV accumulate
// the drag distance and are typically used as rotation angles; clickPositionX/Y is the last press
// position in element (canvas pixel) coordinates. fnOnClick is added as a click listener.
export function addMouseEvents(el, fnOnClick) {
  const mouse = {
    velocityH: 0,
    velocityLastH: 0,
    positionX: 0,
    clickPositionX: 0,
    velocityV: 0,
    velocityLastV: 0,
    positionY: 0,
    clickPositionY: 0,
  }

  // element relative position, scaled to canvas pixels if the element is CSS scaled
  const local = (evt) => {
    const rect = el.getBoundingClientRect()
    const sx = el.width ? el.width / rect.width : 1
    const sy = el.height ? el.height / rect.height : 1
    return [(evt.clientX - rect.left) * sx, (evt.clientY - rect.top) * sy]
  }

  mouse.onMouseMove = (evt) => {
    [mouse.positionX, mouse.positionY] = local(evt)
    mouse.velocityH = mouse.velocityLastH + (mouse.positionX - mouse.clickPositionX) * 0.5
    mouse.velocityV = mouse.velocityLastV + (mouse.positionY - mouse.clickPositionY) * 0.5
  }

  mouse.onMouseUp = (evt) => {
    el.removeEventListener('pointermove', mouse.onMouseMove)
    if (el.hasPointerCapture?.(evt.pointerId)) el.releasePointerCapture(evt.pointerId)
  }

  mouse.onMouseDown = (evt) => {
    evt.preventDefault()
    el.setPointerCapture?.(evt.pointerId)
    el.addEventListener('pointermove', mouse.onMouseMove)
    ;[mouse.clickPositionX, mouse.clickPositionY] = local(evt)
    mouse.velocityLastH = mouse.velocityH
    mouse.velocityLastV = mouse.velocityV
  }

  // stop the browser claiming touch drags for scrolling
  el.style.touchAction = 'none'
  el.addEventListener('pointerdown', mouse.onMouseDown)
  el.addEventListener('pointerup', mouse.onMouseUp)
  el.addEventListener('pointercancel', mouse.onMouseUp)
  if (fnOnClick) el.addEventListener('click', fnOnClick)

  trackers.set(el, mouse)
  return mouse
}

export function removeMouseEvents(el, fnOnClick) {
  const mouse = trackers.get(el)
  if (!mouse) return
  el.removeEventListener('pointermove', mouse.onMouseMove)
  el.removeEventListener('pointerdown', mouse.onMouseDown)
  el.removeEventListener('pointerup', mouse.onMouseUp)
  el.removeEventListener('pointercancel', mouse.onMouseUp)
  if (fnOnClick) el.removeEventListener('click', fnOnClick)
  trackers.delete(el)
}

export const getMouse = (el) => trackers.get(el)

// World space ray for a viewport position: { clickPoint, clickVector }. clickPoint lies on the
// plane through the camera lookat point facing the camera.
export function calculateClickPointAndVector(scene, mousex, mousey) {
  const { camera, viewport, perspective } = scene
  const camLookAt = vec3.fromValues(camera.lookat.x, camera.lookat.y, camera.lookat.z)
  const camOff = vec3.subtract(vec3.create(), scene._cameraPosition, camLookAt)

  // pixels per world unit on the click plane
  const pixelsPerUnit = (viewport.height / 2) / (vec3.length(camOff) * Math.tan((perspective.fov / 180 * Math.PI) / 2))

  // world units from the centre of the viewport to the click
  const units = vec2.fromValues(
    (mousex - viewport.width / 2) / pixelsPerUnit,
    (mousey - viewport.height / 2) / pixelsPerUnit)

  // move along the click plane horizontally...
  const up = vec3.fromValues(camera.up.x, camera.up.y, camera.up.z)
  const side = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), camOff, up))
  const clickPoint = vec3.scaleAndAdd(vec3.create(), camLookAt, side, units[0])

  // ...and vertically (screen y points down)
  const planeUp = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), side, camOff))
  vec3.scaleAndAdd(clickPoint, clickPoint, planeUp, -units[1])

  // ray from the camera position through the click point
  const camPosition = vec3.add(vec3.create(), camLookAt, camOff)
  return {
    clickPoint,
    clickVector: vec3.subtract(vec3.create(), clickPoint, camPosition),
  }
}

// Solid entity polygons hit by a ray, nearest first: [{ entity, polygonIndex, intersectionPoint, distance }]
export function getIntersectedObjects(scene, clickPoint, clickVector) {
  const intersections = []
  for (const entity of scene.renderlist) {
    if (entity.style.drawmode !== 'solid') continue
    entity.polygons.forEach((poly, polygonIndex) => {
      const point = planeLineIntersection(poly._worldnormal, entity._worldcoords[poly.vertices[0]], clickVector, clickPoint)
      if (point && intersectionInsidePolygon(poly, entity._worldcoords, point)) {
        intersections.push({
          entity,
          polygonIndex,
          intersectionPoint: point,
          distance: vec3.distance(scene._cameraPosition, point),
        })
      }
    })
  }
  return intersections.sort((a, b) => a.distance - b.distance)
}
