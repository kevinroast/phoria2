import { averagePolyVertex } from '../util.js'
import { Renderer } from './Renderer.js'

// Prototype renderer that rasterises flat shaded triangles into an ImageData buffer. Based on
// mr.doob's port of http://devmaster.net/forums/topic/1145-advanced-rasterization/
// With lots of small polygons on a fast JS engine it can beat canvas path filling, but it has no
// anti-aliasing and is slower for large polygons. Only solid polygons are rendered.
export class SoftwareRenderer extends Renderer {
  constructor(canvas) {
    super()
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this._imagedata = this.ctx.getImageData(0, 0, canvas.width, canvas.height)
    this._data = this._imagedata.data
  }

  render(scene) {
    // the canvas was resized - the pixel buffer must match it
    if (this._imagedata.width !== this.canvas.width || this._imagedata.height !== this.canvas.height) {
      this._imagedata = this.ctx.createImageData(this.canvas.width, this.canvas.height)
      this._data = this._imagedata.data
    }
    this.sortObjects(scene)
    // TODO: only clear and put the dirty rectangle
    this.clearCanvasRect(0, 0, this.canvas.width, this.canvas.height)
    for (const obj of scene.renderlist) {
      if (obj.style.drawmode === 'solid') {
        for (const poly of obj.polygons) this.renderPolygon(null, obj, scene, poly)
      }
    }
    this.ctx.putImageData(this._imagedata, 0, 0)
  }

  // Clear by zeroing the alpha channel only.
  clearCanvasRect(xmin, ymin, xmax, ymax) {
    const data = this._data
    const width = this.canvas.width
    for (let y = ymin; y < ymax; y++) {
      for (let offset = (xmin + y * width) * 4 + 3, end = (xmax + y * width) * 4; offset < end; offset += 4) {
        data[offset] = 0
      }
    }
  }

  // Returns true if the polygon was drawn.
  renderPolygon(ctx, obj, scene, poly) {
    const coords = obj._coords
    const clip = obj._clip
    const { vertices } = poly
    const color = poly.color ?? obj.style.color

    let clipped = 1
    for (let i = 0; i < vertices.length; i++) clipped &= clip[vertices[i]]
    if (clipped) return false

    if (!obj.style.doublesided &&
        ((coords[vertices[0]][0] * coords[vertices[1]][1] - coords[vertices[1]][0] * coords[vertices[0]][1]) +
         (coords[vertices[1]][0] * coords[vertices[2]][1] - coords[vertices[2]][0] * coords[vertices[1]][1]) +
         (coords[vertices[2]][0] * coords[vertices[0]][1] - coords[vertices[0]][0] * coords[vertices[2]][1]) < 0)) return false

    let rgb
    switch (obj.style.shademode) {
      case 'plain':
        rgb = [color[0], color[1], color[2]]
        break
      case 'lightsource':
        rgb = this.calcNormalBrightness(averagePolyVertex(vertices, obj._worldcoords), poly._worldnormal, scene, obj)
        rgb[0] = Math.ceil(Math.min(rgb[0] * color[0], 255))
        rgb[1] = Math.ceil(Math.min(rgb[1] * color[1], 255))
        rgb[2] = Math.ceil(Math.min(rgb[2] * color[2], 255))
        break
      default:
        return false
    }

    const c = (i) => coords[vertices[i]]
    this.drawTriangle(c(2)[0], c(2)[1], c(1)[0], c(1)[1], c(0)[0], c(0)[1], rgb[0], rgb[1], rgb[2])
    // TODO: polygons with more than 4 vertices need splitting into triangles
    if (vertices.length === 4) {
      this.drawTriangle(c(0)[0], c(0)[1], c(3)[0], c(3)[1], c(2)[0], c(2)[1], rgb[0], rgb[1], rgb[2])
    }
    return true
  }

  // Half-space triangle rasteriser using 28.4 fixed point coordinates.
  drawTriangle(fx1, fy1, fx2, fy2, fx3, fy3, r, g, b) {
    const x1 = Math.round(16 * fx1), x2 = Math.round(16 * fx2), x3 = Math.round(16 * fx3)
    const y1 = Math.round(16 * fy1), y2 = Math.round(16 * fy2), y3 = Math.round(16 * fy3)

    // deltas
    const dx12 = x1 - x2, dx23 = x2 - x3, dx31 = x3 - x1
    const dy12 = y1 - y2, dy23 = y2 - y3, dy31 = y3 - y1

    // fixed point deltas
    const fdx12 = dx12 << 4, fdx23 = dx23 << 4, fdx31 = dx31 << 4
    const fdy12 = dy12 << 4, fdy23 = dy23 << 4, fdy31 = dy31 << 4

    const width = this.canvas.width, height = this.canvas.height
    const data = this._data

    // bounding rectangle
    const xmin = Math.max((Math.min(x1, x2, x3) + 0xf) >> 4, 0)
    const xmax = Math.min((Math.max(x1, x2, x3) + 0xf) >> 4, width)
    const ymin = Math.max((Math.min(y1, y2, y3) + 0xf) >> 4, 0)
    const ymax = Math.min((Math.max(y1, y2, y3) + 0xf) >> 4, height)
    if (xmax <= xmin || ymax <= ymin) return

    // constant part of the half-edge functions, corrected for the fill convention
    let c1 = dy12 * x1 - dx12 * y1
    let c2 = dy23 * x2 - dx23 * y2
    let c3 = dy31 * x3 - dx31 * y3
    if (dy12 < 0 || (dy12 === 0 && dx12 > 0)) c1++
    if (dy23 < 0 || (dy23 === 0 && dx23 > 0)) c2++
    if (dy31 < 0 || (dy31 === 0 && dx31 > 0)) c3++

    let cy1 = c1 + dx12 * (ymin << 4) - dy12 * (xmin << 4)
    let cy2 = c2 + dx23 * (ymin << 4) - dy23 * (xmin << 4)
    let cy3 = c3 + dx31 * (ymin << 4) - dy31 * (xmin << 4)

    for (let y = ymin; y < ymax; y++) {
      let cx1 = cy1, cx2 = cy2, cx3 = cy3
      for (let x = xmin; x < xmax; x++) {
        if (cx1 > 0 && cx2 > 0 && cx3 > 0) {
          const offset = (x + y * width) << 2
          data[offset] = r
          data[offset + 1] = g
          data[offset + 2] = b
          data[offset + 3] = 255
        }
        cx1 -= fdy12
        cx2 -= fdy23
        cx3 -= fdy31
      }
      cy1 += fdx12
      cy2 += fdx23
      cy3 += fdx31
    }
  }
}
