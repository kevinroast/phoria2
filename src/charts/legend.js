// A chart's legend as HTML: swatches for categories (click to hide or show them), or a ramp with its
// range for numbers.

/** @import { ColorScale } from './scales.js' */

/**
 * @param {ColorScale} scale
 * @param {{ title: string, theme: 'dark' | 'light', position?: string, format: (v: any) => string,
 *   onToggle?: (value: any, on: boolean) => void }} options
 * @returns {HTMLDivElement}
 */
export function legend(scale, { title, theme, position = 'top-right', format, onToggle }) {
  const el = document.createElement('div')
  el.className = `phoria-legend phoria-legend-${position} phoria-${theme}`
  const head = document.createElement('div')
  head.className = 'phoria-legend-title'
  head.textContent = title
  el.append(head)
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
    const ramp = document.createElement('div')
    ramp.className = 'phoria-legend-ramp'
    ramp.style.background = `linear-gradient(to right, ${scale.range.join(', ')})`
    const ends = document.createElement('div')
    ends.className = 'phoria-legend-scale'
    ends.innerHTML = '<span></span><span></span>'
    ends.children[0].textContent = format(scale.domain[0])
    ends.children[1].textContent = format(scale.domain[1])
    el.append(ramp, ends)
  }
  return el
}
