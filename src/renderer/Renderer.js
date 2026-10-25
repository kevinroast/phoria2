import { vec3 } from 'gl-matrix'
import { EPSILON } from '../math.js'
import { DistantLight, PointLight } from '../entity/lights.js'

// scratch vectors for the lighting calculations - avoids allocating per polygon
const toLight = vec3.create()
const toView = vec3.create()
const halfV = vec3.create()

function attenuate(light, distance) {
  switch (light.attenuationFactor) {
    case 'linear': return light.attenuation * distance
    case 'squared': return light.attenuation * distance * distance
    default: return light.attenuation
  }
}

// Shared helpers for the concrete renderers: object sorting, lighting and polygon inflation.
export class Renderer {
  // true to sort objects by average Z before rendering (painter's algorithm)
  sort = true

  // Sort the scene renderlist back to front by average Z, honouring each style's objectsortmode.
  sortObjects(scene) {
    if (!this.sort) return
    for (const obj of scene.renderlist) {
      switch (obj.style.objectsortmode) {
        case 'sorted': break // average Z was calculated during scene processing
        case 'front': obj._averagez = -Infinity; break
        default: obj._averagez = Infinity; break // 'back'
      }
    }
    scene.renderlist.sort((a, b) => a._averagez < b._averagez ? 1 : -1)
  }

  // RGB 0-1+ brightness of a surface at `position` facing `normal`, summed over the scene lights,
  // using the object style's diffuse and specular values.
  calcNormalBrightness(position, normal, scene, obj) {
    const rgb = [0.0, 0.0, 0.0]
    const { diffuse, specular } = obj.style
    for (const light of scene.lights) {
      let brightness
      if (light instanceof DistantLight) {
        // parallel rays from an infinitely distant light - worlddirection points back at the light
        const dotVP = vec3.dot(normal, light.worlddirection)
        if (dotVP <= 0) continue
        brightness = dotVP * light.intensity * diffuse
      } else if (light instanceof PointLight) {
        vec3.subtract(toLight, light.worldposition, position)
        const distance = vec3.length(toLight)
        vec3.normalize(toLight, toLight)
        const dotVP = vec3.dot(normal, toLight)
        if (dotVP <= 0) continue
        const attenuation = attenuate(light, distance)

        if (specular !== 0) {
          // Blinn-Phong: half vector between the directions to the light and to the viewer
          vec3.normalize(toView, vec3.subtract(toView, scene._cameraPosition, position))
          vec3.normalize(halfV, vec3.add(halfV, toLight, toView))
          const dotHV = vec3.dot(normal, halfV)
          if (dotHV > 0) {
            const pf = Math.pow(dotHV, specular) * light.intensity / attenuation
            rgb[0] += pf * light.color[0]
            rgb[1] += pf * light.color[1]
            rgb[2] += pf * light.color[2]
          }
        }
        brightness = diffuse * dotVP * light.intensity / attenuation
      } else {
        continue
      }
      rgb[0] += brightness * light.color[0]
      rgb[1] += brightness * light.color[1]
      rgb[2] += brightness * light.color[2]
    }
    return rgb
  }

  // RGB brightness at a position with no surface normal - points and wireframe edges.
  calcPositionBrightness(position, lights) {
    const rgb = [0.0, 0.0, 0.0]
    for (const light of lights) {
      let brightness
      if (light instanceof DistantLight) {
        brightness = light.intensity
      } else if (light instanceof PointLight) {
        const distance = vec3.distance(position, light.worldposition)
        // doubled attenuation keeps lit wires roughly as bright as polygons lit by the same light;
        // the accurate alternative is normals from the polygons sharing each edge
        brightness = light.intensity / (attenuate(light, distance) * 2)
      } else {
        continue
      }
      rgb[0] += brightness * light.color[0]
      rgb[1] += brightness * light.color[1]
      rgb[2] += brightness * light.color[2]
    }
    return rgb
  }

  // Push a polygon's screen edges outwards by `pixels` to cover the anti-aliasing cracks canvas
  // leaves between adjacent fills. Much faster than inflatePolygonFull() but can misbehave when the
  // camera lines up exactly with perpendicular edges.
  inflatePolygon(vertices, coords, pixels = 0.5) {
    const n = vertices.length
    const inflated = new Array(n)
    for (let i = 0; i < n; i++) inflated[i] = [coords[vertices[i]][0], coords[vertices[i]][1]]
    for (let i = 0; i < n; i++) {
      const k = i < n - 1 ? i + 1 : 0
      let x = inflated[k][0] - inflated[i][0]
      let y = inflated[k][1] - inflated[i][1]
      let det = x * x + y * y
      if (det === 0) det = EPSILON
      const idet = pixels / Math.sqrt(det)
      x *= idet
      y *= idet
      inflated[i][0] -= x
      inflated[i][1] -= y
      inflated[k][0] += x
      inflated[k][1] += y
    }
    return inflated
  }

  // Inflate a polygon properly: offset every edge along its outward normal and intersect
  // neighbouring edges for the new vertices. See:
  //   http://stackoverflow.com/questions/3749678/expand-fill-of-convex-polygon
  //   http://stackoverflow.com/questions/1109536/an-algorithm-for-inflating-deflating-offsetting-buffering-polygons
  inflatePolygonFull(vertices, coords, pixels = 0.5) {
    const n = vertices.length
    const edges = []
    for (let i = 0; i < n; i++) {
      const [x1, y1] = coords[vertices[i]]
      const [x2, y2] = coords[vertices[(i + 1) % n]]
      // outward facing unit normal scaled to the offset distance
      const len = Math.sqrt((y2 - y1) ** 2 + (x2 - x1) ** 2)
      const dx = (y2 - y1) / len * pixels
      const dy = -(x2 - x1) / len * pixels
      edges.push({ x: x1 + dx, y: y1 + dy }, { x: x2 + dx, y: y2 + dy })
    }
    const inflated = new Array(n)
    for (let i = 0; i < n; i++) {
      const prev = (i === 0 ? n - 1 : i - 1) * 2
      const vec = this.intersection(edges[prev], edges[prev + 1], edges[i * 2], edges[i * 2 + 1])
      // near-parallel edges send the intersection off towards infinity - keep the original vertex
      const c = coords[vertices[i]]
      if (Math.abs(vec[0] - c[0]) > 1.5 || Math.abs(vec[1] - c[1]) > 1.5) {
        vec[0] = c[0]
        vec[1] = c[1]
      }
      inflated[i] = vec
    }
    return inflated
  }

  // Intersection of two infinite lines, each given by two points.
  intersection(l0v0, l0v1, l1v0, l1v1) {
    const a1 = l0v1.x - l0v0.x, b1 = l1v0.x - l1v1.x, c1 = l1v0.x - l0v0.x
    const a2 = l0v1.y - l0v0.y, b2 = l1v0.y - l1v1.y, c2 = l1v0.y - l0v0.y
    const t = (b1 * c2 - b2 * c1) / (a2 * b1 - a1 * b2)
    return [l0v0.x + t * (l0v1.x - l0v0.x), l0v0.y + t * (l0v1.y - l0v0.y)]
  }
}
