import { vec3 } from 'gl-matrix'
import { TWOPI } from '../math.js'
import { averagePolyVertex } from '../util.js'
import { Renderer } from './Renderer.js'

const rgbString = ([r, g, b]) => `rgb(${r},${g},${b})`
// lit colour as an "r,g,b" string, 0-255 integers
const litColor = (rgb, color, emit = 0) =>
  Math.min(Math.ceil(rgb[0] * color[0] + color[0] * emit), 255) + ',' +
  Math.min(Math.ceil(rgb[1] * color[1] + color[1] * emit), 255) + ',' +
  Math.min(Math.ceil(rgb[2] * color[2] + color[2] * emit), 255)

// Screen space signed area test - works for perspective projection, unlike a normal-to-camera dot test.
const isBackface = (coords, vertices) =>
  (coords[vertices[0]][0] * coords[vertices[1]][1] - coords[vertices[1]][0] * coords[vertices[0]][1]) +
  (coords[vertices[1]][0] * coords[vertices[2]][1] - coords[vertices[2]][0] * coords[vertices[1]][1]) +
  (coords[vertices[2]][0] * coords[vertices[0]][1] - coords[vertices[0]][0] * coords[vertices[2]][1]) < 0

const isClipped = (clip, vertices) => {
  for (let i = 0; i < vertices.length; i++) if (!clip[vertices[i]]) return false
  return true
}

const tracePath = (ctx, points) => {
  ctx.beginPath()
  ctx.moveTo(points[0][0], points[0][1])
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1])
  ctx.closePath()
}

// Renders the scene with standard canvas 2D operations - arcs, lines, filled paths and affine
// transformed images for textures. Many of the techniques come from my first JavaScript 3D library,
// K3D (bit.ly/canvask3d).
export class CanvasRenderer extends Renderer {
  constructor(canvas) {
    super()
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
  }

  // Render a scene processed by scene.modelView(). fnClear(ctx) optionally replaces clearRect().
  render(scene, fnClear) {
    this.sortObjects(scene)

    const { ctx } = this
    if (fnClear) {
      fnClear.call(this, ctx)
    } else {
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    }

    for (const obj of scene.renderlist) {
      const { style } = obj
      ctx.save()
      if (style.compositeOperation) ctx.globalCompositeOperation = style.compositeOperation
      switch (style.drawmode) {
        case 'solid':
          if (style.fillmode === 'fillstroke' || style.fillmode === 'hiddenline') ctx.lineWidth = 1.0
          // polygons were pre-sorted by the scene
          for (const poly of obj.polygons) this.renderPolygon(ctx, obj, scene, poly)
          break

        case 'wireframe':
          ctx.lineWidth = style.linewidth
          ctx.globalAlpha = style.opacity
          if (style.shademode === 'plain') {
            // one path for every edge - one stroke() call
            ctx.strokeStyle = rgbString(style.color)
            ctx.beginPath()
            for (const edge of obj.edges) this.renderEdge(ctx, obj, scene, edge)
            ctx.closePath()
            ctx.stroke()
          } else {
            for (const edge of obj.edges) this.renderEdge(ctx, obj, scene, edge)
          }
          break

        case 'point': {
          if (style.shademode === 'sprite' && style.sprite !== undefined) {
            if (!obj.textures) {
              throw new Error("Entity has shademode 'sprite' but no textures defined on parent emitter.")
            }
            if (style.sprite > obj.textures.length - 1) {
              throw new Error("Entity has shademode 'sprite' index but references missing texture on parent emitter.")
            }
          }
          ctx.globalAlpha = style.opacity
          if (style.shademode === 'plain') ctx.fillStyle = rgbString(style.color)
          const coords = obj._coords
          for (let i = 0; i < coords.length; i++) this.renderPoint(ctx, obj, scene, coords[i], i)
          break
        }
      }
      ctx.restore()
    }
  }

  renderPoint(ctx, obj, scene, coord, index) {
    if (obj._clip[index]) return

    const { style } = obj
    let w = style.linewidth
    if (style.linescale !== 0) {
      // scale by the perspective divisor - keep in sync with the scene's point clipOffset
      w = (style.linewidth * style.linescale * scene._perspectiveScale) / obj._coords[index][3]
    }

    switch (style.shademode) {
      case 'plain':
        ctx.beginPath()
        ctx.arc(coord[0], coord[1], w, 0, TWOPI, true)
        ctx.closePath()
        ctx.fill()
        break

      case 'sprite':
        if (style.sprite !== undefined) {
          ctx.drawImage(obj.textures[style.sprite], coord[0] - w, coord[1] - w, w + w, w + w)
        }
        break

      case 'callback':
        for (const h of obj.onRenderHandlers) h.call(obj, ctx, coord[0], coord[1], w)
        break

      case 'lightsource': {
        const rgb = this.calcPositionBrightness(obj._worldcoords[index], scene.lights)
        ctx.fillStyle = `rgb(${litColor(rgb, style.color)})`
        ctx.beginPath()
        ctx.arc(coord[0], coord[1], w, 0, TWOPI, true)
        ctx.closePath()
        ctx.fill()
        break
      }
    }
  }

  renderEdge(ctx, obj, scene, edge) {
    if (obj._clip[edge.a] & obj._clip[edge.b]) return

    const { style } = obj
    const coords = obj._coords
    const a = coords[edge.a], b = coords[edge.b]
    if (style.linescale !== 0) {
      // scale by the average perspective divisor of the two vertices
      ctx.lineWidth = ((style.linewidth * style.linescale) / ((a[3] + b[3]) * 0.5)) * scene._perspectiveScale
    }

    if (style.shademode === 'lightsource') {
      // each edge is lit at its midpoint, so needs its own path and stroke
      const wa = obj._worldcoords[edge.a], wb = obj._worldcoords[edge.b]
      const mid = vec3.fromValues((wa[0] + wb[0]) * 0.5, (wa[1] + wb[1]) * 0.5, (wa[2] + wb[2]) * 0.5)
      const rgb = this.calcPositionBrightness(mid, scene.lights)
      ctx.beginPath()
      ctx.strokeStyle = `rgb(${litColor(rgb, style.color)})`
      ctx.moveTo(a[0], a[1])
      ctx.lineTo(b[0], b[1])
      ctx.closePath()
      ctx.stroke()
    } else {
      // added to the caller's path
      ctx.moveTo(a[0], a[1])
      ctx.lineTo(b[0], b[1])
    }
  }

  renderPolygon(ctx, obj, scene, poly) {
    const { style } = obj
    const coords = obj._coords
    const { vertices } = poly
    const color = poly.color ?? style.color
    const opacity = poly.opacity || style.opacity

    if (isClipped(obj._clip, vertices)) return
    if (!style.doublesided && isBackface(coords, vertices)) return

    const textureIndex = poly.texture ?? style.texture
    // "r,g,b" fill colour, or null for an unlit texture
    let fillStyle = null
    let rgb
    switch (style.shademode) {
      case 'plain':
        if (textureIndex === undefined) fillStyle = color[0] + ',' + color[1] + ',' + color[2]
        break

      case 'lightsource':
        // one pass per light - a simple linear additive lighting model
        rgb = this.calcNormalBrightness(averagePolyVertex(vertices, obj._worldcoords), poly._worldnormal, scene, obj)
        fillStyle = litColor(rgb, color, poly.emit || style.emit || 0)
        break
    }

    ctx.save()
    if (textureIndex !== undefined) {
      this.renderTexturedPolygon(ctx, obj.textures[textureIndex], poly, coords, fillStyle, rgb, opacity)
    } else {
      // inflate the screen coords to cover the half pixel cracks between canvas filled polygons
      if (style.fillmode === 'inflate') {
        tracePath(ctx, this.inflatePolygon(vertices, coords, 0.5))
      } else {
        tracePath(ctx, vertices.map((v) => coords[v]))
      }

      const fill = `rgba(${fillStyle},${opacity})`
      switch (style.fillmode) {
        case 'fill':
        case 'inflate':
          // single fill - 'fill' leaves visible edge cracks, 'inflate' covers them
          ctx.fillStyle = fill
          ctx.fill()
          break

        case 'filltwice':
          // overdraw towards the edges hides enough of the cracks for dense objects and small faces
          ctx.fillStyle = fill
          ctx.fill()
          ctx.fill()
          break

        case 'fillstroke':
          // nicer edges but slower
          ctx.fillStyle = fill
          ctx.fill()
          ctx.strokeStyle = fill
          ctx.stroke()
          break

        case 'hiddenline':
          ctx.strokeStyle = fill
          ctx.stroke()
          break
      }
    }
    ctx.restore()
  }

  // Textures can only be mapped onto triangles, so quads are split in two. Lighting is applied as
  // a translucent fill over the image, darker where the light is weaker.
  // TODO: polygons with more than 4 vertices need splitting into triangles
  renderTexturedPolygon(ctx, bitmap, poly, coords, fillStyle, rgb, opacity) {
    const { vertices, uvs } = poly
    const w = bitmap.width, h = bitmap.height

    if (fillStyle !== null) {
      // brightness as luminance; the overlay alpha is the shade left to apply
      const lum = Math.min(rgb[0] * 0.3 + rgb[1] * 0.6 + rgb[2] * 0.1, 1.0)
      // fixed decimal places to avoid exponent notation in the colour string
      ctx.fillStyle = `rgba(${fillStyle},${(1.0 - lum).toFixed(3)})`
    }

    // TODO: Chrome does not need the texture polygons inflated
    if (vertices.length === 3) {
      const t = uvs
        ? [w * uvs[0], h * uvs[1], w * uvs[2], h * uvs[3], w * uvs[4], h * uvs[5]]
        : [0, 0, w, 0, w, h]
      this.renderTexturedTriangle(ctx, bitmap, this.inflatePolygon(vertices, coords, 0.5), t, opacity)
      if (fillStyle !== null) ctx.fill()
    } else if (vertices.length === 4) {
      let t = uvs
        ? [w * uvs[0], h * uvs[1], w * uvs[2], h * uvs[3], w * uvs[4], h * uvs[5]]
        : [0, 0, w, 0, w, h]
      ctx.save()
      this.renderTexturedTriangle(ctx, bitmap, this.inflatePolygon(vertices.slice(0, 3), coords, 0.5), t, opacity)
      ctx.restore()

      t = uvs
        ? [w * uvs[4], h * uvs[5], w * uvs[6], h * uvs[7], w * uvs[0], h * uvs[1]]
        : [w, h, 0, h, 0, 0]
      ctx.save()
      this.renderTexturedTriangle(ctx, bitmap, this.inflatePolygon([vertices[2], vertices[3], vertices[0]], coords, 0.5), t, opacity)
      ctx.restore()

      if (fillStyle !== null) {
        tracePath(ctx, this.inflatePolygon(vertices, coords, 0.75))
        ctx.globalAlpha = opacity
        ctx.fill()
      }
    }
  }

  // Clip to the screen triangle then draw the whole image through the affine transform that maps
  // the texture triangle onto it. Transformation code originally by Thatcher Ulrich. Affine only, so
  // no perspective correction: http://tulrich.com/geekstuff/canvas/perspective.html
  renderTexturedTriangle(ctx, bitmap, vs, [sx0, sy0, sx1, sy1, sx2, sy2], opacity) {
    const [x0, y0] = vs[0], [x1, y1] = vs[1], [x2, y2] = vs[2]
    tracePath(ctx, vs)
    ctx.clip()

    const denom = 1.0 / (sx0 * (sy2 - sy1) - sx1 * sy2 + sx2 * sy1 + (sx1 - sx2) * sy0)
    const m11 = -(sy0 * (x2 - x1) - sy1 * x2 + sy2 * x1 + (sy1 - sy2) * x0) * denom
    const m12 = (sy1 * y2 + sy0 * (y1 - y2) - sy2 * y1 + (sy2 - sy1) * y0) * denom
    const m21 = (sx0 * (x2 - x1) - sx1 * x2 + sx2 * x1 + (sx1 - sx2) * x0) * denom
    const m22 = -(sx1 * y2 + sx0 * (y1 - y2) - sx2 * y1 + (sx2 - sx1) * y0) * denom
    const dx = (sx0 * (sy2 * x1 - sy1 * x2) + sy0 * (sx1 * x2 - sx2 * x1) + (sx2 * sy1 - sx1 * sy2) * x0) * denom
    const dy = (sx0 * (sy2 * y1 - sy1 * y2) + sy0 * (sx1 * y2 - sx2 * y1) + (sx2 * sy1 - sx1 * sy2) * y0) * denom
    ctx.transform(m11, m12, m21, m22, dx, dy)

    ctx.globalAlpha = opacity
    ctx.drawImage(bitmap, 0, 0)
  }
}
