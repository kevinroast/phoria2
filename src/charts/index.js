// phoria2/charts: charts from a spec of mark, data and channels, as ordinary scene nodes - plus the
// scales they are built on. Importing it registers the 'chart' type with create().
export { chart, Chart, formatValue } from './Chart.js'
export { scaleLinear, scaleLog, scaleTime, scaleBand, scaleColor, tickStep, SCHEMES } from './scales.js'

/** @typedef {import('./scales.js').Scale} Scale */
/** @typedef {import('./scales.js').ColorScale} ColorScale */
/** @typedef {import('./spec.js').Channel} Channel */
/** @typedef {import('./spec.js').Mark} Mark */
