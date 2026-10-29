// A chart's legend as HTML: swatches for categories (click to hide or show them), or for numbers a
// key - a ramp, highest at the top, with values marked up its side.
import { scaleLinear } from './scales.js'

/** @import { ColorScale } from './scales.js' */

/**
 * @param {ColorScale} scale
 * @param {{ title: string, theme: 'dark' | 'light', position?: string, format: (v: any) => string,
 *   ticks?: number[] | number, onToggle?: (value: any, on: boolean) => void }} options
 * @returns {HTMLDivElement}
 */
export function legend(scale, { title, theme, position = 'top-right', format, ticks, onToggle }) {
  const el = document.createElement('div')
  el.className = `phoria-legend phoria-legend-${position} phoria-${theme}`
  // an empty title leaves the legend untitled
  if (title) {
    const head = document.createElement('div')
    head.className = 'phoria-legend-title'
    head.textContent = title
    el.append(head)
  }
  if (scale.kind === 'categorical') {
    for (const { value, color } of scale.colors()) {
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'phoria-legend-item'
      const swatch = document.createElement('span')
      swatch.className = 'phoria-legend-swatch'
      swatch.style.background = color.getStyle()
      item.append(swatch, format(value))
      item.addEventListener('click', () => onToggle?.(value, !item.classList.toggle('off')))
      el.append(item)
    }
  } else {
    const lo = scale.domain[0], hi = scale.domain[scale.domain.length - 1]
    const along = scaleLinear({ domain: [lo, hi], range: [0, 100] })
    const key = document.createElement('div')
    key.className = 'phoria-legend-key'
    const ramp = document.createElement('div')
    ramp.className = 'phoria-legend-ramp'
    // sampled from the scale, so a ramp with more than two numbers in its domain is drawn as it colours
    const stops = Array.from({ length: 17 }, (_, i) => `${scale(lo + (hi - lo) * i / 16).getStyle()} ${i * 100 / 16}%`)
    ramp.style.background = `linear-gradient(to top, ${stops.join(', ')})`
    const marks = document.createElement('div')
    marks.className = 'phoria-legend-scale'
    const values = Array.isArray(ticks) ? ticks : along.ticks(ticks ?? 5)
    for (const v of values) {
      const at = along(v)
      if (!(at >= -1e-9 && at <= 100 + 1e-9)) continue
      const mark = document.createElement('span')
      mark.style.bottom = `${at}%`
      mark.textContent = format(v)
      marks.append(mark)
    }
    key.append(ramp, marks)
    el.append(key)
  }
  return el
}
