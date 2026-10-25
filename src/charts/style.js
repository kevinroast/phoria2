// Default looks for chart HTML - ticks, titles, value labels, legends - in :where() rules, which
// have no specificity, so any app CSS for these classes wins. Added once, on first use.

const CSS = `
/* ticks are bare text: the padding is breathing room, so the overlap the label layout allows never runs them together */
:where(.phoria-axis-tick) { padding: 0 4px; color: #8b909c; font: 11px/1.2 system-ui, sans-serif; font-variant-numeric: tabular-nums; }
:where(.phoria-axis-title) { color: #c8ccd4; font: 600 12px/1.2 system-ui, sans-serif; }
:where(.phoria-value) { padding: 1px 5px; border-radius: 4px; background: rgba(16, 16, 20, 0.72); color: #eee;
  font: 11px/1.3 system-ui, sans-serif; font-variant-numeric: tabular-nums; }
:where(.phoria-light.phoria-axis-tick) { color: #5d6370; }
:where(.phoria-light.phoria-axis-title) { color: #2b2f37; }
:where(.phoria-light.phoria-value) { background: rgba(255, 255, 255, 0.85); color: #222; }
:where(.phoria-legend) { position: absolute; display: flex; flex-direction: column; gap: 3px; padding: 8px 10px;
  border-radius: 8px; background: rgba(20, 20, 24, 0.78); color: #e6e6e6; font: 12px/1.3 system-ui, sans-serif;
  pointer-events: auto; max-height: calc(100% - 24px); overflow: auto; }
:where(.phoria-light.phoria-legend) { background: rgba(255, 255, 255, 0.88); color: #222; }
:where(.phoria-legend-top-right) { top: 12px; right: 12px; }
:where(.phoria-legend-top-left) { top: 12px; left: 12px; }
:where(.phoria-legend-bottom-right) { bottom: 12px; right: 12px; }
:where(.phoria-legend-bottom-left) { bottom: 12px; left: 12px; }
:where(.phoria-legend-title) { opacity: 0.7; font-size: 11px; margin-bottom: 2px; }
:where(.phoria-legend-item) { display: flex; align-items: center; gap: 6px; padding: 0; border: 0; background: none;
  color: inherit; font: inherit; text-align: left; cursor: pointer; }
:where(.phoria-legend-item.off) { opacity: 0.35; }
:where(.phoria-legend-swatch) { width: 10px; height: 10px; border-radius: 2px; flex: none; }
:where(.phoria-legend-ramp) { width: 120px; height: 8px; border-radius: 2px; }
:where(.phoria-legend-scale) { display: flex; justify-content: space-between; opacity: 0.7; font-size: 11px; }
`

export function addStyle() {
  if (typeof document === 'undefined' || document.getElementById('phoria-chart-style')) return
  const style = document.createElement('style')
  style.id = 'phoria-chart-style'
  style.textContent = CSS
  document.head.prepend(style)
}
