// Where the labels' code (labels.js) puts itself once evaluated, for View to find. A view loads it
// the first time it has a label or an overlay to show; phoria2/charts imports it up front, as
// charts always have labels - so a chart's first frame has them.
/** @type {{ module: { LabelLayer: typeof import('./labels.js').LabelLayer } | null }} */
export const labelSlot = { module: null }
